import { toInputValue } from './money';
import { indexCategories } from './reports';
import type { Ledger, Transaction } from './schema';

/**
 * Neutralise spreadsheet formula injection (CWE-1236): a cell starting with
 * = + - @ or a control character is executed by Excel/Sheets, so prefix it.
 */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function transactionsToCsv(ledger: Ledger, txs: Transaction[]): string {
  const cats = indexCategories(ledger.categories);
  const currency = ledger.settings.currency;
  const header = ['Date', 'Type', 'Category', 'Group', 'Amount', 'Currency', 'Note', 'Reference'];
  const rows = txs.map((t) => {
    const cat = cats.get(t.categoryId);
    return [
      t.date,
      t.kind,
      cat?.name ?? '',
      cat?.group ?? '',
      // Signed number so the column sums to net cash flow in a spreadsheet.
      Number(toInputValue(t.kind === 'income' ? t.amount : -t.amount, currency)),
      currency,
      t.note,
      t.ref ?? '',
    ];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
