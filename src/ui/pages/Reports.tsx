import { useMemo, useState } from 'react';
import { transactionsToCsv } from '../../core/csv';
import { addDays, formatDate, today } from '../../core/dates';
import { sortTransactions } from '../../core/ledger';
import { formatMoney, formatPct } from '../../core/money';
import {
  balanceAsOf,
  change,
  customPeriod,
  granularityFor,
  indexCategories,
  inPeriod,
  periodFor,
  periodLabel,
  shiftPeriod,
  summarize,
  timeSeries,
  type Period,
  type PeriodKind,
} from '../../core/reports';
import { AllocationBar, BalanceChart, Breakdown, CashflowChart } from '../charts/Charts';
import { Card, Delta, downloadFile, EmptyState, Kpi, Money, Segmented } from '../components/common';
import { Icon } from '../components/Icon';
import { useLedger } from '../store';

export function ReportsPage() {
  const { ledger, currency } = useLedger();
  const now = today();
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const [customFrom, setCustomFrom] = useState(period.from);
  const [customTo, setCustomTo] = useState(period.to);

  const setKind = (kind: PeriodKind) => {
    if (kind === 'custom') setPeriod(customPeriod(customFrom, customTo));
    else setPeriod(periodFor(kind, period.from <= now && now <= period.to ? now : period.from));
  };

  const cats = useMemo(() => indexCategories(ledger.categories), [ledger.categories]);

  const report = useMemo(() => {
    const prevPeriod = shiftPeriod(period, -1);
    const cur = summarize(ledger, period, now);
    const prev = summarize(ledger, prevPeriod, now);
    const prevByCat = new Map(prev.expenseByCategory.map((r) => [r.categoryId, r.total]));
    return {
      cur,
      prev,
      prevPeriod,
      prevByCat,
      series: timeSeries(ledger, period),
      opening: balanceAsOf(ledger, addDays(period.from, -1)),
      txs: sortTransactions(ledger.transactions.filter((t) => inPeriod(t, period))),
    };
  }, [ledger, period, now]);

  const { cur, prev } = report;
  const name = (id: string) => cats.get(id)?.name ?? 'Uncategorised';
  const isFuture = period.from > now;
  const granularity = granularityFor(period);

  const exportCsv = () =>
    downloadFile(
      `report-${period.from}-to-${period.to}.csv`,
      `﻿${transactionsToCsv(ledger, report.txs)}`,
      'text/csv;charset=utf-8',
    );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="muted">
            {periodLabel(period)} · compared with {periodLabel(report.prevPeriod)}
          </p>
        </div>
        <div className="toolbar no-print">
          <button type="button" className="btn" onClick={exportCsv} disabled={report.txs.length === 0}>
            <Icon name="download" size={16} />
            CSV
          </button>
          <button type="button" className="btn" onClick={() => window.print()}>
            <Icon name="print" size={16} />
            Print / PDF
          </button>
        </div>
      </div>

      <div className="card no-print">
        <div className="toolbar">
          <Segmented
            label="Report period"
            value={period.kind}
            onChange={setKind}
            options={[
              { value: 'month', label: 'Month' },
              { value: 'quarter', label: 'Quarter' },
              { value: 'year', label: 'Year' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
          {period.kind === 'custom' ? (
            <>
              <label className="toolbar">
                <span className="muted">From</span>
                <input
                  className="input"
                  type="date"
                  value={customFrom}
                  onChange={(e) => {
                    setCustomFrom(e.target.value);
                    if (e.target.value) setPeriod(customPeriod(e.target.value, customTo));
                  }}
                />
              </label>
              <label className="toolbar">
                <span className="muted">To</span>
                <input
                  className="input"
                  type="date"
                  value={customTo}
                  onChange={(e) => {
                    setCustomTo(e.target.value);
                    if (e.target.value) setPeriod(customPeriod(customFrom, e.target.value));
                  }}
                />
              </label>
            </>
          ) : (
            <div className="toolbar">
              <button type="button" className="btn btn-icon" aria-label="Previous period" onClick={() => setPeriod(shiftPeriod(period, -1))}>
                <Icon name="chevronLeft" />
              </button>
              <strong style={{ minWidth: 130, textAlign: 'center' }}>{periodLabel(period)}</strong>
              <button type="button" className="btn btn-icon" aria-label="Next period" onClick={() => setPeriod(shiftPeriod(period, 1))}>
                <Icon name="chevronRight" />
              </button>
              <button type="button" className="btn btn-subtle" onClick={() => setPeriod(periodFor(period.kind as Exclude<PeriodKind, 'custom'>, now))}>
                Current
              </button>
            </div>
          )}
        </div>
      </div>

      <h2 className="print-only">Report: {periodLabel(period)}</h2>

      {cur.txCount === 0 ? (
        <Card>
          <EmptyState title={isFuture ? 'This period has not started yet' : 'No activity in this period'}>
            <p>Choose another period to see its report.</p>
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid grid-kpi">
            <Kpi
              label="Income"
              value={<Money value={cur.income} currency={currency} />}
              foot={
                <>
                  <Delta ratio={change(cur.income, prev.income)} goodWhen="up" /> vs previous
                </>
              }
            />
            <Kpi
              label="Spending"
              value={<Money value={cur.spending} currency={currency} />}
              foot={
                <>
                  <Delta ratio={change(cur.spending, prev.spending)} goodWhen="down" /> vs previous
                </>
              }
            />
            <Kpi
              label="Saved & invested"
              value={<Money value={cur.saved} currency={currency} />}
              foot={
                <>
                  <Delta ratio={change(cur.saved, prev.saved)} goodWhen="up" /> vs previous
                </>
              }
            />
            <Kpi
              label="Savings rate"
              value={formatPct(cur.savingsRate)}
              foot={
                <>
                  <Money value={cur.avgDailySpending} currency={currency} /> spent per day
                </>
              }
            />
          </div>

          <Card title="Cash flow" action={<span className="subtle">By {granularity}</span>}>
            <CashflowChart data={report.series} currency={currency} />
            <details className="no-print" style={{ marginTop: 12 }}>
              <summary className="muted">Show as table</summary>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th className="right">Income</th>
                      <th className="right">Spending</th>
                      <th className="right">Saved</th>
                      <th className="right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.series.map((b) => (
                      <tr key={b.key}>
                        <td>{b.from === b.to ? formatDate(b.from) : `${formatDate(b.from, 'short')} – ${formatDate(b.to, 'short')}`}</td>
                        <td className="right num">{formatMoney(b.income, currency)}</td>
                        <td className="right num">{formatMoney(b.spending, currency)}</td>
                        <td className="right num">{formatMoney(b.saved, currency)}</td>
                        <td className={`right num ${b.net < 0 ? 'neg' : ''}`}>{formatMoney(b.net, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>

          <div className="grid grid-halves">
            <Card title="Balance">
              <BalanceChart data={report.series} currency={currency} opening={report.opening} asOf={now} />
            </Card>
            <Card title="Where income went">
              {cur.income > 0 ? (
                <AllocationBar income={cur.income} needs={cur.needs} wants={cur.wants} saved={cur.saved} currency={currency} />
              ) : (
                <p className="muted">No income recorded in this period.</p>
              )}
            </Card>
          </div>

          <div className="grid grid-halves">
            <Card title="Spending by category">
              <Breakdown
                currency={currency}
                total={cur.spending + cur.saved}
                rows={cur.expenseByCategory.map((r) => ({ id: r.categoryId, label: name(r.categoryId), value: r.total, note: `${r.count}×` }))}
              />
            </Card>
            <Card title="Income by source">
              {cur.incomeBySource.length ? (
                <Breakdown
                  currency={currency}
                  total={cur.income}
                  rows={cur.incomeBySource.map((r) => ({ id: r.categoryId, label: name(r.categoryId), value: r.total, note: `${r.count}×` }))}
                />
              ) : (
                <p className="muted">No income recorded in this period.</p>
              )}
            </Card>
          </div>

          <Card title="Category comparison" flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="right">This period</th>
                    <th className="right hide-sm">Previous</th>
                    <th className="right">Change</th>
                    <th className="right hide-sm">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {cur.expenseByCategory.map((r) => {
                    const before = report.prevByCat.get(r.categoryId) ?? 0;
                    const isSaving = cats.get(r.categoryId)?.group === 'savings';
                    return (
                      <tr key={r.categoryId}>
                        <td>{name(r.categoryId)}</td>
                        <td className="right num">{formatMoney(r.total, currency)}</td>
                        <td className="right num hide-sm">{formatMoney(before, currency)}</td>
                        <td className="right">
                          <Delta ratio={change(r.total, before)} goodWhen={isSaving ? 'up' : 'down'} />
                        </td>
                        <td className="right num hide-sm">{formatPct(r.total / Math.max(1, cur.spending + cur.saved))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Largest expenses" flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="hide-sm">Category</th>
                    <th className="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {cur.largestExpenses.map((t) => (
                    <tr key={t.id}>
                      <td className="num">{formatDate(t.date, 'short')}</td>
                      <td>{t.note || name(t.categoryId)}</td>
                      <td className="hide-sm">{name(t.categoryId)}</td>
                      <td className="right num">{formatMoney(t.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
