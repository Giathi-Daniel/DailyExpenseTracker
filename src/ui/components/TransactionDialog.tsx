import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { today } from '../../core/dates';
import { parseAmount, toInputValue } from '../../core/money';
import type { Category, CategoryGroup, Transaction, TxKind } from '../../core/schema';
import { useLedger } from '../store';
import { useToast } from '../toast';
import { Dialog, Segmented } from './common';

const GROUP_LABEL: Record<CategoryGroup, string> = {
  income: 'Income',
  needs: 'Needs',
  wants: 'Wants',
  savings: 'Savings',
};

export function CategorySelect({
  kind,
  value,
  onChange,
  categories,
  id,
  includeAll,
}: {
  kind?: TxKind;
  value: string;
  onChange: (id: string) => void;
  categories: Category[];
  id?: string;
  includeAll?: boolean;
}) {
  const groups = useMemo(() => {
    const visible = categories.filter((c) => !c.archived && (!kind || c.kind === kind));
    const order: CategoryGroup[] = ['income', 'needs', 'wants', 'savings'];
    return order
      .map((g) => ({ group: g, items: visible.filter((c) => c.group === g).sort((a, b) => a.name.localeCompare(b.name)) }))
      .filter((g) => g.items.length > 0);
  }, [categories, kind]);
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {includeAll && <option value="">All categories</option>}
      {groups.map((g) => (
        <optgroup key={g.group} label={GROUP_LABEL[g.group]}>
          {g.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

const defaultCategory = (kind: TxKind) => (kind === 'income' ? 'inc-salary' : 'exp-food');

export function TransactionDialog({
  open,
  onClose,
  initialKind = 'expense',
  editing,
}: {
  open: boolean;
  onClose: () => void;
  initialKind?: TxKind;
  editing?: Transaction | null;
}) {
  const { ledger, dispatch, currency } = useLedger();
  const notify = useToast();
  const uid = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<TxKind>(initialKind);
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState(defaultCategory(initialKind));
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setKind(editing.kind);
      setAmount(toInputValue(editing.amount, currency));
      setCategoryId(editing.categoryId);
      setDate(editing.date);
      setNote(editing.note);
    } else {
      setKind(initialKind);
      setAmount('');
      setCategoryId(defaultCategory(initialKind));
      setDate(today());
      setNote('');
    }
    setError(null);
    window.setTimeout(() => amountRef.current?.focus(), 0);
  }, [open, editing, initialKind, currency]);

  const changeKind = (k: TxKind) => {
    setKind(k);
    const current = ledger.categories.find((c) => c.id === categoryId);
    if (current?.kind !== k) setCategoryId(defaultCategory(k));
  };

  const submit = (another: boolean) => {
    const minor = parseAmount(amount, currency);
    if (minor === null) {
      setError('Enter an amount greater than zero, e.g. 1250 or 1,250.50.');
      amountRef.current?.focus();
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Choose a valid date.');
      return;
    }
    const draft = { kind, amount: minor, categoryId, date, note: note.trim().slice(0, 140) };
    if (editing) {
      dispatch({ type: 'tx/update', id: editing.id, patch: draft });
      notify('Transaction updated.');
      onClose();
      return;
    }
    dispatch({ type: 'tx/add', drafts: [draft] });
    notify(`${kind === 'income' ? 'Income' : 'Expense'} saved.`);
    if (another) {
      setAmount('');
      setNote('');
      setError(null);
      amountRef.current?.focus();
    } else onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={editing ? 'Edit transaction' : kind === 'income' ? 'Add income' : 'Add expense'}>
      <form
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          submit(false);
        }}
        noValidate
      >
        <div className="form-grid">
          <div className="span-2">
            <Segmented
              label="Transaction type"
              value={kind}
              onChange={changeKind}
              options={[
                { value: 'expense', label: 'Expense' },
                { value: 'income', label: 'Income' },
              ]}
            />
          </div>
          <label className="field span-2">
            <span>Amount ({currency})</span>
            <input
              ref={amountRef}
              className="input input-lg num"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amount}
              maxLength={20}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${uid}-err` : undefined}
              onChange={(e) => setAmount(e.target.value)}
            />
            {error && (
              <span className="error-text" id={`${uid}-err`} role="alert">
                {error}
              </span>
            )}
          </label>
          <label className="field">
            <span>{kind === 'income' ? 'Source' : 'Category'}</span>
            <CategorySelect kind={kind} value={categoryId} onChange={setCategoryId} categories={ledger.categories} />
          </label>
          <label className="field">
            <span>Date</span>
            <input className="input" type="date" value={date} max="2100-12-31" onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="field span-2">
            <span>Note (optional)</span>
            <input
              className="input"
              value={note}
              maxLength={140}
              placeholder={kind === 'income' ? 'e.g. October salary, weekend tips' : 'e.g. Lunch at work, matatu to town'}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {!editing && (
            <button type="button" className="btn" onClick={() => submit(true)}>
              Save and add another
            </button>
          )}
          <button type="submit" className="btn btn-primary">
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
