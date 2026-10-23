import { useMemo, useState } from 'react';
import { formatDate } from '../../core/dates';
import type { TxDraft } from '../../core/ledger';
import { parseMpesa, type ParsedMessage } from '../../core/mpesa';
import { useLedger } from '../store';
import { useToast } from '../toast';
import { Dialog, MessageBar, Money } from './common';
import { CategorySelect } from './TransactionDialog';

interface Row extends ParsedMessage {
  include: boolean;
  duplicate: boolean;
}

export function MpesaImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ledger, dispatch, currency } = useLedger();
  const notify = useToast();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [recordFees, setRecordFees] = useState(true);

  const existingRefs = useMemo(
    () => new Set(ledger.transactions.flatMap((t) => (t.ref ? [t.ref.replace(/-FEE$/, '')] : []))),
    [ledger.transactions],
  );

  const close = () => {
    setText('');
    setRows(null);
    onClose();
  };

  const review = () => {
    const { entries, skipped: s } = parseMpesa(text);
    setSkipped(s);
    setRows(entries.map((e) => ({ ...e, include: !existingRefs.has(e.ref), duplicate: existingRefs.has(e.ref) })));
    // The raw SMS text is discarded once parsed; only reviewed fields are kept.
    setText('');
  };

  const update = (ref: string, patch: Partial<Row>) =>
    setRows((r) => r?.map((row) => (row.ref === ref ? { ...row, ...patch } : row)) ?? null);

  const selected = rows?.filter((r) => r.include) ?? [];
  const fees = recordFees ? selected.reduce((s, r) => s + r.fee, 0) : 0;

  const commit = () => {
    const drafts: TxDraft[] = [];
    for (const r of selected) {
      drafts.push({ kind: r.kind, amount: r.amount, categoryId: r.categoryId, date: r.date, note: r.note, ref: r.ref });
      if (recordFees && r.fee > 0) {
        drafts.push({ kind: 'expense', amount: r.fee, categoryId: 'exp-fees', date: r.date, note: 'M-Pesa transaction cost', ref: `${r.ref}-FEE` });
      }
    }
    dispatch({ type: 'tx/add', drafts });
    notify(`Imported ${selected.length} M-Pesa ${selected.length === 1 ? 'transaction' : 'transactions'}.`);
    close();
  };

  return (
    <Dialog open={open} onClose={close} title="Import M-Pesa messages" wide>
      {!rows ? (
        <>
          <p className="muted">
            Copy one or more M-Pesa confirmation messages from your SMS app and paste them below. They are read on this
            device only, phone numbers are removed, and duplicates are skipped by transaction code.
          </p>
          {currency !== 'KES' && (
            <MessageBar intent="warning">
              M-Pesa amounts are in KES but your ledger currency is {currency}. Change the currency in Settings first if
              this is a KES ledger.
            </MessageBar>
          )}
          <label className="field">
            <span>Messages</span>
            <textarea
              className="textarea"
              value={text}
              maxLength={200_000}
              spellCheck={false}
              autoComplete="off"
              placeholder="QJK1ABC2DE Confirmed. Ksh1,250.00 paid to NAIVAS. on 5/10/26 at 1:05 PM. New M-PESA balance is…"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!text.trim()} onClick={review}>
              Review
            </button>
          </div>
        </>
      ) : (
        <>
          {rows.length === 0 ? (
            <MessageBar intent="warning">No M-Pesa confirmations were recognised in that text.</MessageBar>
          ) : (
            <p className="muted">
              Found {rows.length} transaction{rows.length === 1 ? '' : 's'}
              {skipped > 0 && `, ${skipped} message${skipped === 1 ? '' : 's'} could not be read`}. Check the categories,
              then import.
            </p>
          )}
          {rows.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: '50vh' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>
                      <span className="sr-only">Include</span>
                    </th>
                    <th>Date</th>
                    <th>Details</th>
                    <th>Category</th>
                    <th className="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.ref}>
                      <td>
                        <input
                          type="checkbox"
                          checked={r.include}
                          aria-label={`Include ${r.note}`}
                          onChange={(e) => update(r.ref, { include: e.target.checked })}
                        />
                      </td>
                      <td className="num">{formatDate(r.date, 'short')}</td>
                      <td>
                        <div>{r.note}</div>
                        <div className="subtle">
                          {r.ref}
                          {r.duplicate && ' · already imported'}
                        </div>
                      </td>
                      <td style={{ minWidth: 180 }}>
                        <CategorySelect
                          kind={r.kind}
                          value={r.categoryId}
                          categories={ledger.categories}
                          onChange={(id) => update(r.ref, { categoryId: id })}
                        />
                      </td>
                      <td className="right">
                        <Money
                          value={r.kind === 'income' ? r.amount : -r.amount}
                          currency={currency}
                          signed
                          className={r.kind === 'income' ? 'pos' : ''}
                        />
                        {r.fee > 0 && (
                          <div className="subtle">
                            + <Money value={r.fee} currency={currency} /> fee
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <label className="toolbar">
            <input type="checkbox" checked={recordFees} onChange={(e) => setRecordFees(e.target.checked)} />
            <span>
              Record transaction costs as “Fees &amp; charges”
              {fees > 0 && (
                <span className="muted">
                  {' '}
                  (<Money value={fees} currency={currency} />)
                </span>
              )}
            </span>
          </label>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setRows(null)}>
              Back
            </button>
            <button type="button" className="btn btn-primary" disabled={selected.length === 0} onClick={commit}>
              Import {selected.length}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
