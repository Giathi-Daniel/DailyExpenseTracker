import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { formatDate, today } from '../../core/dates';
import { parseAmount, toInputValue, formatMoney, formatPct } from '../../core/money';
import { AssetType, LiabilityType, type Asset, type Liability } from '../../core/schema';
import {
  ASSET_CLASS_LABEL,
  ASSET_TYPES,
  bpsToPct,
  HIGH_COST_APR_BPS,
  LIABILITY_TYPES,
  netWorthChange,
  roadmap,
  wealthPicture,
  type RoadmapStep,
} from '../../core/wealth';
import { NetWorthChart, SplitBar } from '../charts/WealthCharts';
import { Card, ConfirmDialog, Dialog, EmptyState, Kpi, MessageBar, Money, Progress } from '../components/common';
import { Icon } from '../components/Icon';
import { bpsToInput, parsePct } from '../components/inputs';
import { useLedger } from '../store';
import { useToast } from '../toast';

// ---- Roadmap ---------------------------------------------------------------

export function Roadmap({ steps, compact }: { steps: RoadmapStep[]; compact?: boolean }) {
  const doneCount = steps.filter((s) => s.state === 'done').length;
  return (
    <ol className="roadmap" aria-label={`Wealth roadmap: ${doneCount} of ${steps.length} steps done`}>
      {steps.map((s, i) => (
        <li key={s.id} className="roadmap-step" data-state={s.state}>
          <span className="roadmap-marker" aria-hidden="true">
            {s.state === 'done' ? <Icon name="check" size={14} /> : i + 1}
          </span>
          <div className="roadmap-body">
            <div className="roadmap-head">
              <h3>{s.title}</h3>
              <span className={`badge ${s.state === 'done' ? 'badge-good' : s.state === 'current' ? 'badge-info' : ''}`}>
                {s.state === 'done' ? 'Done' : s.state === 'current' ? 'You are here' : 'Next'}
              </span>
            </div>
            {s.state === 'current' && (
              <>
                <p className="muted">{s.why}</p>
                {s.progress !== null && (
                  <div className="roadmap-progress">
                    <Progress value={s.progress} max={1} />
                    <span className="subtle num">{formatPct(s.progress)}</span>
                  </div>
                )}
                <p className="roadmap-action">{s.action}</p>
              </>
            )}
            {s.state === 'upcoming' && !compact && <p className="subtle">{s.why}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---- Dialogs ---------------------------------------------------------------

function AssetDialog({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: Asset | null }) {
  const { dispatch, currency } = useLedger();
  const notify = useToast();
  const [name, setName] = useState(editing?.name ?? '');
  const [type, setType] = useState<AssetType>(editing?.type ?? 'mmf');
  const [value, setValue] = useState(editing ? toInputValue(editing.value, currency) : '');
  const [ret, setRet] = useState(bpsToInput(editing?.expectedReturnBps ?? ASSET_TYPES.mmf.defaultReturnBps));
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const minor = value.trim() === '0' ? 0 : parseAmount(value, currency);
    const bps = parsePct(ret);
    if (!name.trim()) return setError('Give it a name you will recognise.');
    if (minor === null) return setError('Enter what it is worth today, e.g. 25000.');
    if (bps === null) return setError('Enter the yearly return as a percentage, e.g. 9 or 9.5.');
    dispatch({ type: 'asset/upsert', asset: { id: editing?.id, name: name.trim(), type, value: minor, expectedReturnBps: bps } });
    notify(editing ? `${name.trim()} updated.` : `${name.trim()} added.`);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={editing ? 'Edit asset' : 'Add something you own'}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <label className="field span-2">
            <span>Type</span>
            <select
              className="select"
              value={type}
              onChange={(e) => {
                const t = e.target.value as AssetType;
                setType(t);
                if (!editing) setRet(bpsToInput(ASSET_TYPES[t].defaultReturnBps));
              }}
            >
              {AssetType.options.map((t) => (
                <option key={t} value={t}>
                  {ASSET_TYPES[t].label}
                </option>
              ))}
            </select>
            <span className="subtle">{ASSET_TYPES[type].hint}</span>
          </label>
          <label className="field span-2">
            <span>Name</span>
            <input className="input" maxLength={60} value={name} placeholder="e.g. Equity MMF, Stima SACCO, Plot in Kitengela" onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span>Worth today ({currency})</span>
            <input className="input num" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <label className="field">
            <span>Expected yearly return (%)</span>
            <input className="input num" inputMode="decimal" value={ret} onChange={(e) => setRet(e.target.value)} />
            <span className="subtle">Your own assumption, used for projections only.</span>
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
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function LiabilityDialog({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: Liability | null }) {
  const { dispatch, currency } = useLedger();
  const notify = useToast();
  const [name, setName] = useState(editing?.name ?? '');
  const [type, setType] = useState<LiabilityType>(editing?.type ?? 'mobile');
  const [balance, setBalance] = useState(editing ? toInputValue(editing.balance, currency) : '');
  const [apr, setApr] = useState(bpsToInput(editing?.aprBps ?? LIABILITY_TYPES.mobile.defaultAprBps));
  const [minPay, setMinPay] = useState(editing && editing.minPayment ? toInputValue(editing.minPayment, currency) : '');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const bal = balance.trim() === '0' ? 0 : parseAmount(balance, currency);
    const bps = parsePct(apr);
    const min = minPay.trim() === '' ? 0 : parseAmount(minPay, currency);
    if (!name.trim()) return setError('Give it a name, e.g. Fuliza or HELB.');
    if (bal === null) return setError('Enter how much you still owe.');
    if (bps === null) return setError('Enter the yearly interest rate as a percentage.');
    if (min === null) return setError('Enter the monthly payment, or leave it empty.');
    dispatch({
      type: 'liability/upsert',
      liability: { id: editing?.id, name: name.trim(), type, balance: bal, aprBps: bps, minPayment: min },
    });
    notify(editing ? `${name.trim()} updated.` : `${name.trim()} added.`);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={editing ? 'Edit debt' : 'Add something you owe'}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <label className="field span-2">
            <span>Type</span>
            <select
              className="select"
              value={type}
              onChange={(e) => {
                const t = e.target.value as LiabilityType;
                setType(t);
                if (!editing) setApr(bpsToInput(LIABILITY_TYPES[t].defaultAprBps));
              }}
            >
              {LiabilityType.options.map((t) => (
                <option key={t} value={t}>
                  {LIABILITY_TYPES[t].label}
                </option>
              ))}
            </select>
            {LIABILITY_TYPES[type].hint && <span className="subtle">{LIABILITY_TYPES[type].hint}</span>}
          </label>
          <label className="field span-2">
            <span>Name</span>
            <input className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span>Still owed ({currency})</span>
            <input className="input num" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
          </label>
          <label className="field">
            <span>Yearly interest incl. fees (%)</span>
            <input className="input num" inputMode="decimal" value={apr} onChange={(e) => setApr(e.target.value)} />
          </label>
          <label className="field span-2">
            <span>Monthly payment (optional)</span>
            <input className="input num" inputMode="decimal" value={minPay} onChange={(e) => setMinPay(e.target.value)} />
          </label>
          {error && (
            <span className="error-text span-2" role="alert">
              {error}
            </span>
          )}
        </div>
        <p className="subtle" style={{ marginTop: 12 }}>
          Mobile loans often charge a fee per loan; as a yearly rate that is usually far above 50%. The default is an
          estimate — change it if you know the real figure.
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

/** The monthly ritual: update every value in one place, two minutes a month. */
function ReviewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ledger, dispatch, currency } = useLedger();
  const notify = useToast();
  const active = ledger.assets.filter((a) => !a.archived);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries([
      ...active.map((a) => [a.id, toInputValue(a.value, currency)]),
      ...ledger.liabilities.map((l) => [l.id, toInputValue(l.balance, currency)]),
    ]),
  );
  const [error, setError] = useState<string | null>(null);

  const read = (id: string) => {
    const raw = (values[id] ?? '').trim();
    return raw === '0' || raw === '0.00' || raw === '' ? 0 : parseAmount(raw, currency);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const assets = active.map((a) => ({ id: a.id, value: read(a.id) }));
    const liabilities = ledger.liabilities.map((l) => ({ id: l.id, balance: read(l.id) }));
    if ([...assets.map((a) => a.value), ...liabilities.map((l) => l.balance)].some((v) => v === null)) {
      return setError('One of the amounts is not a valid number.');
    }
    dispatch({
      type: 'wealth/review',
      assets: assets as Array<{ id: string; value: number }>,
      liabilities: liabilities as Array<{ id: string; balance: number }>,
    });
    notify('Monthly review saved. Your net worth history is up to date.');
    onClose();
  };

  const row = (id: string, label: string, sub: string) => (
    <label className="review-row" key={id}>
      <span>
        {label}
        <span className="subtle"> · {sub}</span>
      </span>
      <input
        className="input num"
        inputMode="decimal"
        value={values[id] ?? ''}
        onChange={(e) => setValues((v) => ({ ...v, [id]: e.target.value }))}
      />
    </label>
  );

  return (
    <Dialog open={open} onClose={onClose} title="Monthly review">
      <form onSubmit={submit} className="stack" style={{ alignItems: 'stretch' }}>
        <p className="muted">
          Once a month, update what everything is worth today. That single habit is how wealth is measured.
        </p>
        {active.length > 0 && <h3>What you own ({currency})</h3>}
        {active.map((a) => row(a.id, a.name, ASSET_TYPES[a.type].label))}
        {ledger.liabilities.length > 0 && <h3>What you owe ({currency})</h3>}
        {ledger.liabilities.map((l) => row(l.id, l.name, LIABILITY_TYPES[l.type].label))}
        {error && (
          <span className="error-text" role="alert">
            {error}
          </span>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save review
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ---- Page ------------------------------------------------------------------

export function WealthPage() {
  const { ledger, dispatch, currency } = useLedger();
  const notify = useToast();
  const now = today();
  const [assetDialog, setAssetDialog] = useState<{ open: boolean; editing: Asset | null }>({ open: false, editing: null });
  const [debtDialog, setDebtDialog] = useState<{ open: boolean; editing: Liability | null }>({ open: false, editing: null });
  const [review, setReview] = useState(false);
  const [deleting, setDeleting] = useState<{ kind: 'asset' | 'debt'; id: string; name: string } | null>(null);

  const p = useMemo(() => wealthPicture(ledger, now), [ledger, now]);
  const steps = useMemo(() => roadmap(ledger, now), [ledger, now]);
  const change3 = useMemo(() => netWorthChange(ledger, 3, now), [ledger, now]);
  const assets = ledger.assets.filter((a) => !a.archived).sort((a, b) => b.value - a.value);
  const debts = [...ledger.liabilities].sort((a, b) => b.aprBps - a.aprBps);
  const latestReview = ledger.netWorthHistory.at(-1)?.month;
  const reviewDue = p.hasWealthData && latestReview !== now.slice(0, 7);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Wealth</h1>
          <p className="muted">What you own, what you owe, and the next step to grow it.</p>
        </div>
        <div className="toolbar">
          {p.hasWealthData && (
            <button type="button" className="btn" onClick={() => setReview(true)}>
              <Icon name="repeat" size={16} />
              Monthly review
            </button>
          )}
          <button type="button" className="btn" onClick={() => setDebtDialog({ open: true, editing: null })}>
            <Icon name="minus" size={16} />
            Add debt
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setAssetDialog({ open: true, editing: null })}>
            <Icon name="plus" size={16} />
            Add asset
          </button>
        </div>
      </div>

      {reviewDue && (
        <MessageBar>
          Your values were last reviewed in {latestReview ? new Date(`${latestReview}-01T00:00`).toLocaleDateString(undefined, { month: 'long' }) : 'a previous month'}.{' '}
          <button type="button" className="link-button" onClick={() => setReview(true)}>
            Do this month's review
          </button>{' '}
          — it takes two minutes.
        </MessageBar>
      )}

      <div className="grid grid-kpi">
        <Kpi
          label="Net worth"
          value={<Money value={p.netWorth} currency={currency} whole className={p.netWorth < 0 ? 'neg' : ''} />}
          foot={
            change3 === null ? (
              'Own minus owe'
            ) : (
              <>
                <span className={`delta ${change3 >= 0 ? 'pos' : 'neg'}`}>
                  <Icon name={change3 >= 0 ? 'arrowUp' : 'arrowDown'} size={14} />
                  <Money value={Math.abs(change3)} currency={currency} compact />
                </span>{' '}
                over 3 months
              </>
            )
          }
        />
        <Kpi
          label="You own"
          value={<Money value={p.assets} currency={currency} whole />}
          foot={
            <>
              <Money value={p.liquid} currency={currency} compact /> easy to reach · {p.cushionMonths.toFixed(1)} months of essentials
            </>
          }
        />
        <Kpi
          label="You owe"
          value={<Money value={p.liabilities} currency={currency} whole />}
          foot={
            p.monthlyInterest > 0 ? (
              <>
                Costs about <Money value={p.monthlyInterest} currency={currency} compact /> a month in interest
              </>
            ) : (
              'No interest cost recorded'
            )
          }
        />
        <Kpi
          label="Your money pays you"
          value={
            <>
              <Money value={p.monthlyPassive} currency={currency} whole />
              <span className="kpi-unit"> /month</span>
            </>
          }
          foot={
            p.monthlySpending > 0
              ? `Covers ${formatPct(p.monthlyPassive / p.monthlySpending)} of your spending`
              : 'Interest, dividends and rent'
          }
        />
      </div>

      <div className="grid grid-2">
        <Card title="Your roadmap" action={<span className="subtle">{steps.filter((s) => s.state === 'done').length} of {steps.length} done</span>}>
          <Roadmap steps={steps} />
        </Card>
        <div className="stack-col">
          <Card title="Net worth over time" action={<span className="subtle">{currency}</span>}>
            {ledger.netWorthHistory.length >= 2 ? (
              <NetWorthChart history={ledger.netWorthHistory.slice(-24)} currency={currency} height={220} />
            ) : (
              <p className="muted">
                A reading is saved each month you update your values. Come back after next month's review to see the
                trend.
              </p>
            )}
          </Card>
          <Card title="Where your money is">
            {p.assets > 0 ? (
              <SplitBar
                label="Asset mix"
                currency={currency}
                parts={[
                  { label: ASSET_CLASS_LABEL.cash, value: p.byClass.cash, slot: 1 },
                  { label: ASSET_CLASS_LABEL.income, value: p.byClass.income, slot: 2 },
                  { label: ASSET_CLASS_LABEL.growth, value: p.byClass.growth, slot: 3 },
                  { label: ASSET_CLASS_LABEL.real, value: p.byClass.real, slot: 4 },
                ]}
              />
            ) : (
              <p className="muted">Add what you own to see how it is spread.</p>
            )}
          </Card>
        </div>
      </div>

      <div className="grid grid-halves">
        <Card title="What you own" flush>
          {assets.length === 0 ? (
            <EmptyState title="Start with what you have">
              <p>Even KES 500 on M-Pesa counts. Everyone's net worth starts somewhere.</p>
              <button type="button" className="btn btn-primary" onClick={() => setAssetDialog({ open: true, editing: null })}>
                Add asset
              </button>
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th className="right">Worth</th>
                    <th className="right hide-sm">Return</th>
                    <th className="actions">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <div className="note-cell note-primary">{a.name}</div>
                        <div className="subtle">
                          {ASSET_TYPES[a.type].label} · updated {formatDate(a.updatedAt, 'short')}
                        </div>
                      </td>
                      <td className="right">
                        <Money value={a.value} currency={currency} />
                      </td>
                      <td className="right num hide-sm">{bpsToPct(a.expectedReturnBps)}</td>
                      <td className="actions">
                        <button type="button" className="btn btn-subtle btn-icon" aria-label={`Edit ${a.name}`} onClick={() => setAssetDialog({ open: true, editing: a })}>
                          <Icon name="edit" size={16} />
                        </button>
                        <button type="button" className="btn btn-subtle btn-icon" aria-label={`Delete ${a.name}`} onClick={() => setDeleting({ kind: 'asset', id: a.id, name: a.name })}>
                          <Icon name="trash" size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="What you owe" flush>
          {debts.length === 0 ? (
            <EmptyState title="No debts recorded">
              <p>If you owe anything — Fuliza, HELB, a bank or a friend — add it. Seeing it is the first step to clearing it.</p>
            </EmptyState>
          ) : (
            <>
              <p className="subtle card-note">Ordered by interest rate: pay extra on the top one first.</p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Debt</th>
                      <th className="right">Owed</th>
                      <th className="right hide-sm">Rate</th>
                      <th className="actions">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {debts.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <div className="note-cell note-primary">
                            {l.name}{' '}
                            {l.aprBps >= HIGH_COST_APR_BPS && l.balance > 0 && <span className="badge badge-critical">Expensive</span>}
                          </div>
                          <div className="subtle">
                            {LIABILITY_TYPES[l.type].label} ·{' '}
                            {formatMoney(Math.round((l.balance * l.aprBps) / 10_000 / 12), currency, { whole: true })}/mo interest
                          </div>
                        </td>
                        <td className="right">
                          <Money value={l.balance} currency={currency} />
                        </td>
                        <td className="right num hide-sm">{bpsToPct(l.aprBps)}</td>
                        <td className="actions">
                          <button type="button" className="btn btn-subtle btn-icon" aria-label={`Edit ${l.name}`} onClick={() => setDebtDialog({ open: true, editing: l })}>
                            <Icon name="edit" size={16} />
                          </button>
                          <button type="button" className="btn btn-subtle btn-icon" aria-label={`Delete ${l.name}`} onClick={() => setDeleting({ kind: 'debt', id: l.id, name: l.name })}>
                            <Icon name="trash" size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </div>

      <p className="subtle">
        Figures are your own records and assumptions, for planning only — not financial advice. Returns are never
        guaranteed. <Link to="/goals">Plan your growth →</Link>
      </p>

      {assetDialog.open && <AssetDialog open onClose={() => setAssetDialog({ open: false, editing: null })} editing={assetDialog.editing} />}
      {debtDialog.open && <LiabilityDialog open onClose={() => setDebtDialog({ open: false, editing: null })} editing={debtDialog.editing} />}
      {review && <ReviewDialog open onClose={() => setReview(false)} />}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ''}?`}
        body={
          deleting?.kind === 'asset'
            ? 'Transactions and goals linked to it are kept but no longer linked. Past net-worth readings stay.'
            : 'Past net-worth readings stay. Delete it when it is paid off — or set the balance to zero to keep a record.'
        }
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (!deleting) return;
          dispatch(deleting.kind === 'asset' ? { type: 'asset/delete', id: deleting.id } : { type: 'liability/delete', id: deleting.id });
          notify(`${deleting.name} deleted.`);
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
