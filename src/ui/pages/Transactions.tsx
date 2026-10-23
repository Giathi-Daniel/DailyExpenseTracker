import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { transactionsToCsv } from '../../core/csv';
import { addDays, endOfMonth, endOfYear, formatDate, startOfMonth, startOfYear, today, addMonths } from '../../core/dates';
import { sortTransactions } from '../../core/ledger';
import { indexCategories } from '../../core/reports';
import type { Transaction } from '../../core/schema';
import { useEditor } from '../editor';
import { Card, downloadFile, EmptyState, Money } from '../components/common';
import { Icon } from '../components/Icon';
import { MpesaImportDialog } from '../components/MpesaImport';
import { CategorySelect } from '../components/TransactionDialog';
import { useLedger } from '../store';
import { useToast } from '../toast';

type Range = 'this-month' | 'last-month' | 'last-90' | 'this-year' | 'all' | 'custom';

function rangeDates(range: Range, from: string, to: string): { from: string; to: string } {
  const now = today();
  switch (range) {
    case 'this-month':
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case 'last-month': {
      const d = addMonths(startOfMonth(now), -1, 1);
      return { from: d, to: endOfMonth(d) };
    }
    case 'last-90':
      return { from: addDays(now, -89), to: now };
    case 'this-year':
      return { from: startOfYear(now), to: endOfYear(now) };
    case 'all':
      return { from: '0000-01-01', to: '9999-12-31' };
    case 'custom':
      return { from: from || '0000-01-01', to: to || '9999-12-31' };
  }
}

const PAGE_SIZE = 100;

export function TransactionsPage() {
  const { ledger, dispatch, currency } = useLedger();
  const { add, edit } = useEditor();
  const notify = useToast();
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState<Range>('this-month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<'' | 'income' | 'expense'>('');
  const [categoryId, setCategoryId] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const importOpen = params.get('import') === 'mpesa';

  const cats = useMemo(() => indexCategories(ledger.categories), [ledger.categories]);

  const filtered = useMemo(() => {
    const r = rangeDates(range, from, to);
    const q = query.trim().toLowerCase();
    return sortTransactions(
      ledger.transactions.filter(
        (t) =>
          t.date >= r.from &&
          t.date <= r.to &&
          (!kind || t.kind === kind) &&
          (!categoryId || t.categoryId === categoryId) &&
          (!q ||
            t.note.toLowerCase().includes(q) ||
            (cats.get(t.categoryId)?.name.toLowerCase().includes(q) ?? false) ||
            (t.ref?.toLowerCase().includes(q) ?? false)),
      ),
    );
  }, [ledger.transactions, range, from, to, kind, categoryId, query, cats]);

  useEffect(() => setPage(0), [range, from, to, kind, categoryId, query]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of filtered) {
      if (t.kind === 'income') income += t.amount;
      else expense += t.amount;
    }
    return { income, expense };
  }, [filtered]);

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // Group the visible page by day so the list reads as a daily record.
  const days = useMemo(() => {
    const out: Array<{ date: string; rows: Transaction[]; net: number }> = [];
    for (const t of pageRows) {
      let day = out[out.length - 1];
      if (!day || day.date !== t.date) {
        day = { date: t.date, rows: [], net: 0 };
        out.push(day);
      }
      day.rows.push(t);
      day.net += t.kind === 'income' ? t.amount : -t.amount;
    }
    return out;
  }, [pageRows]);

  const remove = (t: Transaction) => {
    dispatch({ type: 'tx/delete', ids: [t.id] });
    notify('Transaction deleted.', { label: 'Undo', onAction: () => dispatch({ type: 'tx/restore', txs: [t] }) });
  };

  const exportCsv = () => {
    downloadFile(`transactions-${today()}.csv`, `﻿${transactionsToCsv(ledger, filtered)}`, 'text/csv;charset=utf-8');
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Transactions</h1>
          <p className="muted">Your daily record of money in and out.</p>
        </div>
        <div className="toolbar">
          <button type="button" className="btn" onClick={() => setParams({ import: 'mpesa' })}>
            <Icon name="phone" size={16} />
            Import M-Pesa
          </button>
          <button type="button" className="btn" onClick={exportCsv} disabled={filtered.length === 0}>
            <Icon name="download" size={16} />
            Export CSV
          </button>
        </div>
      </div>

      <Card>
        <div className="toolbar">
          <label className="grow">
            <span className="sr-only">Search</span>
            <input
              className="input"
              type="search"
              placeholder="Search notes, categories or M-Pesa codes"
              value={query}
              maxLength={80}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Date range</span>
            <select className="select" value={range} onChange={(e) => setRange(e.target.value as Range)}>
              <option value="this-month">This month</option>
              <option value="last-month">Last month</option>
              <option value="last-90">Last 90 days</option>
              <option value="this-year">This year</option>
              <option value="all">All time</option>
              <option value="custom">Custom range</option>
            </select>
          </label>
          {range === 'custom' && (
            <>
              <label>
                <span className="sr-only">From</span>
                <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                <span className="sr-only">To</span>
                <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </>
          )}
          <label>
            <span className="sr-only">Type</span>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="">Income and expenses</option>
              <option value="income">Income only</option>
              <option value="expense">Expenses only</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Category</span>
            <CategorySelect value={categoryId} onChange={setCategoryId} categories={ledger.categories} includeAll />
          </label>
        </div>
      </Card>

      <div className="grid grid-kpi">
        <div className="card kpi">
          <span className="kpi-label">Money in</span>
          <span className="kpi-value">
            <Money value={totals.income} currency={currency} />
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Money out</span>
          <span className="kpi-value">
            <Money value={totals.expense} currency={currency} />
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Net</span>
          <span className="kpi-value">
            <Money
              value={totals.income - totals.expense}
              currency={currency}
              signed
              className={totals.income - totals.expense >= 0 ? 'pos' : 'neg'}
            />
          </span>
          <span className="kpi-foot">
            {filtered.length} transaction{filtered.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <Card flush>
        {filtered.length === 0 ? (
          <EmptyState title="No transactions match">
            <p>Try a wider date range, or add a new entry.</p>
            <button type="button" className="btn btn-primary" onClick={() => add('expense')}>
              Add expense
            </button>
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="hide-sm">Category</th>
                    <th className="right">Amount</th>
                    <th className="actions">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <Fragment key={day.date}>
                      <tr className="group-row">
                        <td>{formatDate(day.date, 'long')}</td>
                        <td className="hide-sm" />
                        <td className="right">
                          <Money value={day.net} currency={currency} signed />
                        </td>
                        <td />
                      </tr>
                      {day.rows.map((t) => {
                        const cat = cats.get(t.categoryId);
                        return (
                          <tr key={t.id}>
                            <td>
                              <div className="note-cell note-primary">
                                {t.note || cat?.name}
                              </div>
                              <div className="subtle">
                                <span className="hide-sm">{t.kind === 'income' ? 'Income' : 'Expense'}</span>
                                <span className="show-sm">{cat?.name}</span>
                                {t.recurringId && ' · Scheduled'}
                                {t.ref && ` · ${t.ref.replace(/-FEE$/, '')}`}
                              </div>
                            </td>
                            <td className="hide-sm">
                              <span className={`badge ${cat?.group === 'savings' ? 'badge-good' : cat?.kind === 'income' ? 'badge-info' : ''}`}>
                                {cat?.name ?? 'Uncategorised'}
                              </span>
                            </td>
                            <td className="right">
                              <Money
                                value={t.kind === 'income' ? t.amount : -t.amount}
                                currency={currency}
                                signed
                                className={t.kind === 'income' ? 'pos' : ''}
                              />
                            </td>
                            <td className="actions">
                              <button type="button" className="btn btn-subtle btn-icon" aria-label="Edit" title="Edit" onClick={() => edit(t)}>
                                <Icon name="edit" size={16} />
                              </button>
                              <button type="button" className="btn btn-subtle btn-icon" aria-label="Delete" title="Delete" onClick={() => remove(t)}>
                                <Icon name="trash" size={16} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="pager">
                <span className="subtle">
                  {page * PAGE_SIZE + 1}–{Math.min(filtered.length, (page + 1) * PAGE_SIZE)} of {filtered.length}
                </span>
                <div className="toolbar">
                  <button type="button" className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </button>
                  <button type="button" className="btn" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <MpesaImportDialog open={importOpen} onClose={() => setParams({})} />
    </div>
  );
}
