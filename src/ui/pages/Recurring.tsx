import { useMemo, useState, type FormEvent } from 'react';
import { formatDate, today } from '../../core/dates';
import { nextOccurrence } from '../../core/ledger';
import { parseAmount, toInputValue } from '../../core/money';
import { indexCategories } from '../../core/reports';
import type { Frequency, RecurringRule, TxKind } from '../../core/schema';
import { Card, ConfirmDialog, Dialog, EmptyState, Money, Segmented } from '../components/common';
import { Icon } from '../components/Icon';
import { CategorySelect } from '../components/TransactionDialog';
import { useLedger } from '../store';
import { useToast } from '../toast';

function RuleDialog({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: RecurringRule | null }) {
  const { ledger, dispatch, currency } = useLedger();
  const notify = useToast();
  const [kind, setKind] = useState<TxKind>(editing?.kind ?? 'income');
  const [amount, setAmount] = useState(editing ? toInputValue(editing.amount, currency) : '');
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? 'inc-salary');
  const [note, setNote] = useState(editing?.note ?? '');
  const [frequency, setFrequency] = useState<Frequency>(editing?.frequency ?? 'monthly');
  const [startDate, setStartDate] = useState(editing?.startDate ?? today());
  const [assetId, setAssetId] = useState(editing?.assetId ?? '');
  const [error, setError] = useState<string | null>(null);
  const isSaving = kind === 'expense' && ledger.categories.find((c) => c.id === categoryId)?.group === 'savings';
  const assets = ledger.assets.filter((a) => !a.archived);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const minor = parseAmount(amount, currency);
    if (minor === null) return setError('Enter an amount greater than zero.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return setError('Choose a start date.');
    const before = dispatch({
      type: 'recurring/upsert',
      rule: {
        id: editing?.id,
        kind,
        amount: minor,
        categoryId,
        note: note.trim(),
        frequency,
        startDate,
        active: editing?.active ?? true,
        assetId: isSaving && assetId && assets.some((a) => a.id === assetId) ? assetId : undefined,
      },
    }).transactions.length;
    // Fill in dates that are already due now instead of waiting for the next launch.
    const posted = dispatch({ type: 'recurring/postDue', asOf: today() }).transactions.length - before;
    notify(
      posted > 0
        ? `Schedule saved. ${posted} past ${posted === 1 ? 'entry was' : 'entries were'} filled in.`
        : 'Schedule saved. Entries post automatically when due.',
    );
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={editing ? 'Edit schedule' : 'New scheduled entry'}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <div className="span-2">
            <Segmented
              label="Type"
              value={kind}
              onChange={(k) => {
                setKind(k);
                setCategoryId(k === 'income' ? 'inc-salary' : 'exp-rent');
              }}
              options={[
                { value: 'income', label: 'Income' },
                { value: 'expense', label: 'Expense' },
              ]}
            />
          </div>
          <label className="field">
            <span>Amount ({currency})</span>
            <input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span>{kind === 'income' ? 'Source' : 'Category'}</span>
            <CategorySelect kind={kind} value={categoryId} onChange={setCategoryId} categories={ledger.categories} />
          </label>
          <label className="field">
            <span>Repeats</span>
            <select className="select" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          <label className="field">
            <span>First date</span>
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          {isSaving && assets.length > 0 && (
            <label className="field span-2">
              <span>Put into (optional)</span>
              <select className="select" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                <option value="">Not linked</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <span className="subtle">Each entry adds to that investment's value automatically.</span>
            </label>
          )}
          <label className="field span-2">
            <span>Note</span>
            <input className="input" maxLength={140} value={note} placeholder="e.g. Salary, Rent, Chama contribution" onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && (
            <span className="error-text span-2" role="alert">
              {error}
            </span>
          )}
        </div>
        <p className="subtle" style={{ marginTop: 12 }}>
          Past dates are filled in once when you save. Monthly entries on the 29th–31st fall on the last day of shorter months.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function RecurringPage() {
  const { ledger, dispatch, currency } = useLedger();
  const [dialog, setDialog] = useState<{ open: boolean; editing: RecurringRule | null }>({ open: false, editing: null });
  const [deleting, setDeleting] = useState<RecurringRule | null>(null);
  const cats = useMemo(() => indexCategories(ledger.categories), [ledger.categories]);
  const now = today();

  const monthlyIn = ledger.recurring
    .filter((r) => r.active && r.kind === 'income')
    .reduce((s, r) => s + (r.frequency === 'weekly' ? Math.round((r.amount * 52) / 12) : r.amount), 0);
  const monthlyOut = ledger.recurring
    .filter((r) => r.active && r.kind === 'expense')
    .reduce((s, r) => s + (r.frequency === 'weekly' ? Math.round((r.amount * 52) / 12) : r.amount), 0);

  const closeDialog = () => setDialog({ open: false, editing: null });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Recurring</h1>
          <p className="muted">Salary, rent, school fees, savings transfers — entered once, posted automatically.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setDialog({ open: true, editing: null })}>
          <Icon name="plus" size={16} />
          New schedule
        </button>
      </div>

      <div className="grid grid-kpi">
        <div className="card kpi">
          <span className="kpi-label">Scheduled income per month</span>
          <span className="kpi-value">
            <Money value={monthlyIn} currency={currency} />
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Committed spending per month</span>
          <span className="kpi-value">
            <Money value={monthlyOut} currency={currency} />
          </span>
          <span className="kpi-foot">
            {monthlyIn > 0 ? `${Math.round((monthlyOut / monthlyIn) * 100)}% of scheduled income` : 'Add your salary to compare'}
          </span>
        </div>
      </div>

      <Card flush>
        {ledger.recurring.length === 0 ? (
          <EmptyState title="Nothing scheduled yet">
            <p>Add your salary and fixed bills so they appear without retyping every month.</p>
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="hide-sm">Repeats</th>
                  <th>Next</th>
                  <th className="right">Amount</th>
                  <th className="actions">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ledger.recurring.map((r) => {
                  const next = r.active ? nextOccurrence(r, now) : null;
                  return (
                    <tr key={r.id}>
                      <td>
                        <div>{r.note || cats.get(r.categoryId)?.name}</div>
                        <div className="subtle">{cats.get(r.categoryId)?.name}</div>
                      </td>
                      <td className="hide-sm">{r.frequency === 'monthly' ? 'Monthly' : 'Weekly'}</td>
                      <td>{r.active ? (next ? formatDate(next, 'short') : '—') : <span className="badge">Paused</span>}</td>
                      <td className="right">
                        <Money value={r.kind === 'income' ? r.amount : -r.amount} currency={currency} signed className={r.kind === 'income' ? 'pos' : ''} />
                      </td>
                      <td className="actions">
                        <button
                          type="button"
                          className="btn btn-subtle btn-sm"
                          onClick={() => dispatch({ type: 'recurring/upsert', rule: { ...r, active: !r.active } })}
                        >
                          {r.active ? 'Pause' : 'Resume'}
                        </button>
                        <button type="button" className="btn btn-subtle btn-icon" aria-label="Edit" onClick={() => setDialog({ open: true, editing: r })}>
                          <Icon name="edit" size={16} />
                        </button>
                        <button type="button" className="btn btn-subtle btn-icon" aria-label="Delete" onClick={() => setDeleting(r)}>
                          <Icon name="trash" size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog.open && <RuleDialog open onClose={closeDialog} editing={dialog.editing} />}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this schedule?"
        body="Future entries stop. Entries already posted stay in your transactions."
        confirmLabel="Delete"
        danger
        onConfirm={() => deleting && dispatch({ type: 'recurring/delete', id: deleting.id })}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
