import { useMemo, useState, type FormEvent } from 'react';
import { addDays, formatDate, today } from '../../core/dates';
import { formatMoney, fractionDigits, parseAmount, toInputValue } from '../../core/money';
import { customPeriod, summarize } from '../../core/reports';
import type { Goal } from '../../core/schema';
import {
  bpsToPct,
  formatYears,
  futureValue,
  goalProgress,
  monthsToTarget,
  projection,
  realReturnBps,
  wealthPicture,
} from '../../core/wealth';
import { GrowthChart } from '../charts/WealthCharts';
import { Card, ConfirmDialog, Dialog, EmptyState, Kpi, Money, Progress } from '../components/common';
import { Icon } from '../components/Icon';
import { bpsToInput, parsePct } from '../components/inputs';
import { useLedger } from '../store';
import { useToast } from '../toast';

function GoalDialog({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: Goal | null }) {
  const { ledger, dispatch, currency } = useLedger();
  const notify = useToast();
  const [name, setName] = useState(editing?.name ?? '');
  const [target, setTarget] = useState(editing ? toInputValue(editing.target, currency) : '');
  const [date, setDate] = useState(editing?.targetDate ?? '');
  const [assetIds, setAssetIds] = useState<string[]>(editing?.assetIds ?? []);
  const [manual, setManual] = useState(editing && editing.manualSaved ? toInputValue(editing.manualSaved, currency) : '');
  const [error, setError] = useState<string | null>(null);
  const assets = ledger.assets.filter((a) => !a.archived);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = parseAmount(target, currency);
    const m = manual.trim() === '' ? 0 : parseAmount(manual, currency);
    if (!name.trim()) return setError('Name your goal, e.g. "Emergency fund" or "Land deposit".');
    if (t === null) return setError('Enter the amount you are aiming for.');
    if (m === null) return setError('Enter the amount already saved, or leave it empty.');
    if (date && date <= today()) return setError('Pick a date in the future, or leave it empty.');
    dispatch({
      type: 'goal/upsert',
      goal: { id: editing?.id, name: name.trim(), target: t, targetDate: date || null, assetIds, manualSaved: m },
    });
    notify(editing ? 'Goal updated.' : 'Goal added.');
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={editing ? 'Edit goal' : 'New goal'}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <label className="field span-2">
            <span>Goal</span>
            <input className="input" maxLength={60} value={name} placeholder="e.g. Emergency fund, Laptop for freelancing, Land deposit" onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span>Target ({currency})</span>
            <input className="input num" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
          <label className="field">
            <span>By (optional)</span>
            <input className="input" type="date" value={date} min={addDays(today(), 1)} onChange={(e) => setDate(e.target.value)} />
          </label>
          {assets.length > 0 && (
            <fieldset className="field span-2 fieldset">
              <legend>Count these toward it</legend>
              <div className="check-list">
                {assets.map((a) => (
                  <label key={a.id} className="check-row">
                    <input
                      type="checkbox"
                      checked={assetIds.includes(a.id)}
                      onChange={(e) => setAssetIds((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id)))}
                    />
                    <span>
                      {a.name} <span className="subtle">· {formatMoney(a.value, currency, { whole: true })}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="field span-2">
            <span>Saved elsewhere (optional)</span>
            <input className="input num" inputMode="decimal" value={manual} onChange={(e) => setManual(e.target.value)} />
          </label>
          {error && (
            <span className="error-text span-2" role="alert">
              {error}
            </span>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save goal
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Amount input in major units for the planners: whole numbers, no cents. */
function useMajorInput(initialMinor: number, currency: string) {
  const scale = 10 ** fractionDigits(currency);
  const [text, setText] = useState(String(Math.max(0, Math.round(initialMinor / scale))));
  const minor = (() => {
    const n = Number(text.replace(/[,\s]/g, ''));
    return Number.isFinite(n) && n >= 0 && n < 1e13 ? Math.round(n * scale) : 0;
  })();
  return { text, setText, minor };
}

function GrowthPlanner() {
  const { ledger, currency } = useLedger();
  const now = today();
  const p = useMemo(() => wealthPicture(ledger, now), [ledger, now]);
  const start = useMajorInput(p.longTerm + p.byClass.income, currency);
  const monthly = useMajorInput(p.monthlyInvesting || Math.round(p.monthlyIncome * 0.1) || 100_000, currency);
  const [rate, setRate] = useState(bpsToInput(ledger.settings.projectionReturnBps));
  const [years, setYears] = useState(20);
  const [real, setReal] = useState(false);

  const nominalBps = parsePct(rate) ?? ledger.settings.projectionReturnBps;
  const bps = real ? Math.max(0, realReturnBps(nominalBps, ledger.settings.inflationBps)) : nominalBps;
  const points = useMemo(() => projection(start.minor, monthly.minor, bps, years), [start.minor, monthly.minor, bps, years]);
  const final = points.at(-1)!;
  const growth = final.value - final.contributed;
  const waitYears = Math.min(5, years - 1);
  const ifWaited = futureValue(start.minor, monthly.minor, bps, (years - waitYears) * 12);
  // The year the money's own yearly growth first beats what you add in a year.
  const crossover = points.find((pt, i) => i > 0 && pt.value * (bps / 10_000) >= monthly.minor * 12);
  const money = (n: number) => formatMoney(Math.round(n), currency, { whole: true });

  return (
    <Card title="Growth planner" action={<span className="subtle">What steady investing becomes · {currency}</span>}>
      <div className="planner">
        <div className="planner-inputs">
          <label className="field">
            <span>Starting amount ({currency})</span>
            <input className="input num" inputMode="numeric" value={start.text} onChange={(e) => start.setText(e.target.value)} />
          </label>
          <label className="field">
            <span>Invest every month ({currency})</span>
            <input className="input num" inputMode="numeric" value={monthly.text} onChange={(e) => monthly.setText(e.target.value)} />
          </label>
          <label className="field">
            <span>Expected yearly return (%)</span>
            <input className="input num" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} aria-invalid={parsePct(rate) === null || undefined} />
          </label>
          <label className="field">
            <span>
              Years: <strong className="num">{years}</strong>
            </span>
            <input type="range" min={1} max={45} value={years} onChange={(e) => setYears(Number(e.target.value))} />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={real} onChange={(e) => setReal(e.target.checked)} />
            <span>Show in today's money (after {bpsToPct(ledger.settings.inflationBps)} inflation)</span>
          </label>
        </div>
        <div className="planner-output">
          <div className="grid grid-kpi planner-kpis">
            <Kpi label={`In ${years} years`} value={money(final.value)} />
            <Kpi label="You put in" value={money(final.contributed)} />
            <Kpi label="Growth did the rest" value={money(growth)} foot={final.value > 0 ? `${Math.round((growth / final.value) * 100)}% of the total` : undefined} />
          </div>
          <GrowthChart points={points} currency={currency} height={240} />
          <ul className="planner-notes">
            {crossover &&
              (crossover.year <= 1 ? (
                <li>
                  Your money already earns more each year than you add to it — wealth is building itself. Keep adding
                  anyway; it compounds.
                </li>
              ) : (
                <li>
                  From <strong>year {crossover.year}</strong>, your money earns more each year than you add to it. That
                  is the point where wealth starts building itself.
                </li>
              ))}
            {waitYears > 0 && (
              <li>
                Waiting {waitYears} years to start would leave you with about <strong>{money(final.value - ifWaited)}</strong>{' '}
                less. Starting small now beats starting big later.
              </li>
            )}
            <li className="subtle">
              {real ? 'Shown in today’s money. ' : ''}Returns are your assumption ({bpsToPct(nominalBps)} a year) and are
              never guaranteed. For planning only, not financial advice.
            </li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

function HabitCost() {
  const { ledger, currency } = useLedger();
  const now = today();
  const wantsDaily = useMemo(() => {
    const s = summarize(ledger, customPeriod(addDays(now, -29), now), now);
    return Math.round(s.wants / 30);
  }, [ledger, now]);
  const scale = 10 ** fractionDigits(currency);
  const daily = useMajorInput(Math.min(wantsDaily, 50_000) || 200 * scale, currency);
  const bps = ledger.settings.projectionReturnBps;
  const monthly = (daily.minor * 365) / 12;
  const rows = [5, 10, 20, 30].map((y) => ({ y, spent: monthly * 12 * y, value: futureValue(0, monthly, bps, y * 12) }));
  const money = (n: number) => formatMoney(Math.round(n), currency, { whole: true });

  return (
    <Card title="What is a daily habit really costing?">
      <p className="muted">
        The wealthy rarely count every snack — but they know what a habit becomes when the same money is invested
        instead.
      </p>
      <label className="field habit-input">
        <span>Spent every day ({currency})</span>
        <input className="input num" inputMode="numeric" value={daily.text} onChange={(e) => daily.setText(e.target.value)} />
        {wantsDaily > 0 && <span className="subtle">You averaged {money(wantsDaily)} a day on wants in the last 30 days.</span>}
      </label>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Over</th>
              <th className="right">You would spend</th>
              <th className="right">Invested at {bpsToPct(bps)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.y}>
                <td>{r.y} years</td>
                <td className="right num">{money(r.spent)}</td>
                <td className="right num">
                  <strong>{money(r.value)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function GoalsPage() {
  const { ledger, dispatch, currency } = useLedger();
  const notify = useToast();
  const now = today();
  const [dialog, setDialog] = useState<{ open: boolean; editing: Goal | null }>({ open: false, editing: null });
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const p = useMemo(() => wealthPicture(ledger, now), [ledger, now]);
  const assetName = new Map(ledger.assets.map((a) => [a.id, a.name]));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Goals &amp; growth</h1>
          <p className="muted">Decide what your money is for, then see what steady investing turns it into.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setDialog({ open: true, editing: null })}>
          <Icon name="plus" size={16} />
          New goal
        </button>
      </div>

      {ledger.goals.length === 0 ? (
        <Card>
          <EmptyState title="No goals yet">
            <p>
              Start with an emergency fund of one month's essentials
              {p.monthlyEssentials > 0 ? ` (${formatMoney(p.monthlyEssentials, currency, { whole: true })})` : ''}, then
              grow it to three.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => setDialog({ open: true, editing: null })}>
              Set a goal
            </button>
          </EmptyState>
        </Card>
      ) : (
        <div className="grid goal-grid">
          {ledger.goals.map((g) => {
            const gp = goalProgress(g, ledger.assets, now);
            const pace = p.monthlyInvesting > 0 ? monthsToTarget(gp.saved, p.monthlyInvesting, 0, g.target) : null;
            const state = gp.ratio >= 1 ? 'good' : gp.monthlyNeeded !== null && p.monthlyInvesting > 0 && gp.monthlyNeeded > p.monthlyInvesting ? 'warning' : undefined;
            return (
              <section className="card goal-card" key={g.id}>
                <div className="card-header">
                  <h2>{g.name}</h2>
                  <div>
                    <button type="button" className="btn btn-subtle btn-icon" aria-label={`Edit ${g.name}`} onClick={() => setDialog({ open: true, editing: g })}>
                      <Icon name="edit" size={16} />
                    </button>
                    <button type="button" className="btn btn-subtle btn-icon" aria-label={`Delete ${g.name}`} onClick={() => setDeleting(g)}>
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </div>
                <div className="score-part-head">
                  <span className="num">
                    <Money value={gp.saved} currency={currency} /> <span className="muted">of</span> <Money value={g.target} currency={currency} />
                  </span>
                  <span className="subtle num">{Math.round(gp.ratio * 100)}%</span>
                </div>
                <Progress value={gp.ratio} max={1} state={state} />
                <p className="goal-meta">
                  {gp.ratio >= 1 ? (
                    <strong className="pos">Reached. Set the next goal.</strong>
                  ) : g.targetDate ? (
                    <>
                      <Money value={gp.monthlyNeeded ?? 0} currency={currency} whole /> a month to reach it by {formatDate(g.targetDate)}
                    </>
                  ) : pace !== null ? (
                    <>At your current investing pace: {formatYears(pace)}</>
                  ) : (
                    <>Add a date to see the monthly amount needed.</>
                  )}
                </p>
                {g.assetIds.length > 0 && (
                  <p className="subtle">Counting: {g.assetIds.map((id) => assetName.get(id)).filter(Boolean).join(', ')}</p>
                )}
              </section>
            );
          })}
        </div>
      )}

      <GrowthPlanner />
      <HabitCost />

      {dialog.open && <GoalDialog open onClose={() => setDialog({ open: false, editing: null })} editing={dialog.editing} />}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete "${deleting?.name ?? ''}"?`}
        body="The goal is removed. Your assets and transactions are not affected."
        confirmLabel="Delete goal"
        danger
        onConfirm={() => {
          if (!deleting) return;
          dispatch({ type: 'goal/delete', id: deleting.id });
          notify('Goal deleted.');
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

