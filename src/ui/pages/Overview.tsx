import { useMemo } from 'react';
import { Link } from 'react-router';
import { addDays, addMonths, formatDate, formatMonth, parts, startOfMonth, today } from '../../core/dates';
import { generateInsights } from '../../core/insights';
import { sortTransactions } from '../../core/ledger';
import { formatPct } from '../../core/money';
import {
  balanceAsOf,
  change,
  customPeriod,
  indexCategories,
  periodFor,
  summarize,
  timeSeries,
  totalSaved,
} from '../../core/reports';
import { useEditor } from '../editor';
import { AllocationBar, CashflowChart, SpendingChart } from '../charts/Charts';
import { Card, Delta, EmptyState, Kpi, Money, Progress } from '../components/common';
import { InsightRow } from './Insights';
import { currentStep, roadmap, wealthPicture } from '../../core/wealth';
import { Icon } from '../components/Icon';
import { useLedger } from '../store';

export function OverviewPage() {
  const { ledger, currency } = useLedger();
  const { add, edit } = useEditor();
  const now = today();

  const data = useMemo(() => {
    const month = periodFor('month', now);
    const prevStart = addMonths(startOfMonth(now), -1, 1);
    // Compare month-to-date against the same days of last month, not the whole month.
    const prevSameDays = customPeriod(prevStart, addMonths(now, -1));
    const cur = summarize(ledger, month, now);
    const prev = summarize(ledger, prevSameDays, now);
    const last30 = summarize(ledger, customPeriod(addDays(now, -29), now), now);
    const sixMonths = customPeriod(addMonths(startOfMonth(now), -5, 1), month.to);
    return {
      cur,
      prev,
      last30,
      daily: timeSeries(ledger, month, 'day'),
      monthly: timeSeries(ledger, sixMonths, 'month'),
      balance: balanceAsOf(ledger, now),
      wealth: wealthPicture(ledger, now),
      steps: roadmap(ledger, now),
      saved: totalSaved(ledger, now),
      insights: generateInsights(ledger, now).slice(0, 4),
      recent: sortTransactions(ledger.transactions.filter((t) => t.date <= now)).slice(0, 8),
    };
  }, [ledger, now]);

  const cats = useMemo(() => indexCategories(ledger.categories), [ledger.categories]);
  const dayOfMonth = parts(now).d;

  if (ledger.transactions.length === 0) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <h1>Overview</h1>
            <p className="muted">{formatDate(now, 'long')}</p>
          </div>
        </div>
        <NextStep steps={data.steps} />
        <Card>
          <EmptyState title="Your ledger is empty">
            <p>Start with what came in this month, then record today's spending. It takes seconds.</p>
            <div className="toolbar">
              <button type="button" className="btn btn-primary" onClick={() => add('income')}>
                Add income
              </button>
              <button type="button" className="btn" onClick={() => add('expense')}>
                Add expense
              </button>
              <Link className="btn" to="/transactions?import=mpesa">
                Import M-Pesa messages
              </Link>
            </div>
          </EmptyState>
        </Card>
      </div>
    );
  }

  const { cur, prev } = data;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Overview</h1>
          <p className="muted">
            {formatMonth(now)} · day {dayOfMonth}
          </p>
        </div>
      </div>

      <NextStep steps={data.steps} />

      <div className="grid grid-kpi">
        {data.wealth.hasWealthData ? (
          <Kpi
            label="Net worth"
            value={<Money value={data.wealth.netWorth} currency={currency} whole className={data.wealth.netWorth < 0 ? 'neg' : ''} />}
            foot={
              <>
                Own <Money value={data.wealth.assets} currency={currency} compact /> · owe{' '}
                <Money value={data.wealth.liabilities} currency={currency} compact />
              </>
            }
          />
        ) : (
          <Kpi
            label="Balance"
            value={<Money value={data.balance} currency={currency} />}
            foot={
              <>
                <Money value={data.saved} currency={currency} compact /> set aside ·{' '}
                <Link to="/wealth">track net worth</Link>
              </>
            }
          />
        )}
        <Kpi
          label="Income this month"
          value={<Money value={cur.income} currency={currency} />}
          foot={
            <>
              <Delta ratio={change(cur.income, prev.income)} goodWhen="up" /> vs same days last month
            </>
          }
        />
        <Kpi
          label="Spent this month"
          value={<Money value={cur.spending} currency={currency} />}
          foot={
            <>
              <Delta ratio={change(cur.spending, prev.spending)} goodWhen="down" /> vs same days last month
            </>
          }
        />
        <Kpi
          label="Kept (last 30 days)"
          value={formatPct(data.last30.savingsRate)}
          foot={
            <>
              <Money value={data.last30.kept} currency={currency} compact /> of{' '}
              <Money value={data.last30.income} currency={currency} compact /> · goal {ledger.settings.savingsTargetPct}%
            </>
          }
        />
      </div>

      <div className="grid grid-2">
        <Card
          className="card-fill"
          title="Daily spending"
          action={
            <span className="subtle">
              <Money value={cur.avgDailySpending} currency={currency} /> per day on average
            </span>
          }
        >
          <div className="chart-grow">
            <SpendingChart data={data.daily} currency={currency} average={cur.avgDailySpending} height="100%" />
          </div>
        </Card>
        <Card title="Top insights" action={<Link to="/insights">See all</Link>}>
          <div className="list">
            {data.insights.map((i) => (
              <InsightRow key={i.id} insight={i} currency={currency} compact />
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Last six months" action={<Link to="/reports">Open reports</Link>}>
          <CashflowChart data={data.monthly} currency={currency} height={260} />
        </Card>
        <Card title="Where your income went" action={<span className="subtle">Last 30 days</span>}>
          {data.last30.income > 0 ? (
            <AllocationBar
              income={data.last30.income}
              needs={data.last30.needs}
              wants={data.last30.wants}
              saved={data.last30.saved}
              currency={currency}
            />
          ) : (
            <p className="muted">Record income to see how it is split between needs, wants and savings.</p>
          )}
        </Card>
      </div>

      <div className="grid grid-halves">
        <Card title="Budgets this month" action={<Link to="/budgets">Manage</Link>}>
          {ledger.budgets.length === 0 ? (
            <p className="muted">
              No budgets yet. <Link to="/budgets">Set one</Link> for the categories you most want to control.
            </p>
          ) : (
            <div className="breakdown">
              {ledger.budgets.map((b) => {
                const spent = cur.expenseByCategory.find((r) => r.categoryId === b.categoryId)?.total ?? 0;
                const ratio = spent / b.monthlyLimit;
                const state = ratio > 1 ? 'critical' : ratio > 0.85 ? 'warning' : 'good';
                return (
                  <div className="breakdown-row" key={b.categoryId}>
                    <span>{cats.get(b.categoryId)?.name}</span>
                    <span className="num">
                      <Money value={spent} currency={currency} /> <span className="subtle">of</span>{' '}
                      <Money value={b.monthlyLimit} currency={currency} />
                    </span>
                    <Progress value={spent} max={b.monthlyLimit} state={state} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Card title="Recent activity" action={<Link to="/transactions">View all</Link>}>
          <div className="list">
            {data.recent.map((t) => (
              <button
                type="button"
                key={t.id}
                className="list-row list-row-button"
                onClick={() => edit(t)}
                aria-label={`Edit ${cats.get(t.categoryId)?.name} ${t.note}`}
              >
                <div className="grow">
                  <div className="title">{t.note || cats.get(t.categoryId)?.name}</div>
                  <div className="subtle">
                    {cats.get(t.categoryId)?.name} · {formatDate(t.date, 'short')}
                  </div>
                </div>
                <Money
                  value={t.kind === 'income' ? t.amount : -t.amount}
                  currency={currency}
                  signed
                  className={t.kind === 'income' ? 'pos' : ''}
                />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function NextStep({ steps }: { steps: ReturnType<typeof roadmap> }) {
  const step = currentStep(steps);
  if (!step) {
    return (
      <section className="card next-step" data-done="true">
        <Icon name="positive" />
        <div>
          <h2>Every step on your roadmap is done</h2>
          <p className="muted">Keep investing, keep reviewing monthly, and help someone else start.</p>
        </div>
      </section>
    );
  }
  const index = steps.indexOf(step) + 1;
  return (
    <section className="card next-step" aria-labelledby="next-step-title">
      <span className="next-step-index" aria-hidden="true">
        {index}
      </span>
      <div className="next-step-body">
        <span className="subtle">
          Your next step · {index} of {steps.length}
        </span>
        <h2 id="next-step-title">{step.title}</h2>
        <p>{step.action}</p>
      </div>
      <Link className="btn" to="/wealth">
        See your roadmap
      </Link>
    </section>
  );
}
