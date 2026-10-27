import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { demoLedger, PERSONAS, type Persona } from '../core/demo';
import { emptyLedger } from '../core/ledger';
import type { Transaction, TxKind } from '../core/schema';
import { DecryptionError } from '../storage/crypto';
import { Card, MessageBar } from './components/common';
import { Icon, type IconName } from './components/Icon';
import { TransactionDialog } from './components/TransactionDialog';
import { EditorContext } from './editor';
import { useStore } from './store';

// Pages load on demand so the lock screen and first paint stay small.
const OverviewPage = lazy(() => import('./pages/Overview').then((m) => ({ default: m.OverviewPage })));
const TransactionsPage = lazy(() => import('./pages/Transactions').then((m) => ({ default: m.TransactionsPage })));
const ReportsPage = lazy(() => import('./pages/Reports').then((m) => ({ default: m.ReportsPage })));
const InsightsPage = lazy(() => import('./pages/Insights').then((m) => ({ default: m.InsightsPage })));
const BudgetsPage = lazy(() => import('./pages/Budgets').then((m) => ({ default: m.BudgetsPage })));
const RecurringPage = lazy(() => import('./pages/Recurring').then((m) => ({ default: m.RecurringPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));
const WealthPage = lazy(() => import('./pages/Wealth').then((m) => ({ default: m.WealthPage })));
const GoalsPage = lazy(() => import('./pages/Goals').then((m) => ({ default: m.GoalsPage })));

const BASE_ICON = `${import.meta.env.BASE_URL}icon.svg`;

const NAV: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/', label: 'Overview', icon: 'home' },
  { to: '/wealth', label: 'Wealth', icon: 'trend' },
  { to: '/goals', label: 'Goals & growth', icon: 'flag' },
  { to: '/transactions', label: 'Transactions', icon: 'list' },
  { to: '/reports', label: 'Reports', icon: 'chart' },
  { to: '/insights', label: 'Insights', icon: 'bulb' },
  { to: '/budgets', label: 'Budgets', icon: 'target' },
  { to: '/recurring', label: 'Recurring', icon: 'repeat' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

function Shell() {
  const { encrypted, lock } = useStore();
  const [navOpen, setNavOpen] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; kind: TxKind; editing: Transaction | null }>({
    open: false,
    kind: 'expense',
    editing: null,
  });
  const location = useLocation();

  useEffect(() => setNavOpen(false), [location.pathname]);

  const add = useCallback((kind: TxKind) => setDialog({ open: true, kind, editing: null }), []);
  const edit = useCallback((tx: Transaction) => setDialog({ open: true, kind: tx.kind, editing: tx }), []);

  // Keyboard shortcuts: E = new expense, I = new income (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || dialog.open) return;
      if (t && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName))) return;
      if (e.key === 'e') {
        e.preventDefault();
        add('expense');
      } else if (e.key === 'i') {
        e.preventDefault();
        add('income');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [add, dialog.open]);

  return (
    <EditorContext.Provider value={{ add, edit }}>
      <div className="shell">
        <header className="topbar">
          <button
            type="button"
            className="btn btn-subtle btn-icon menu-button"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            aria-controls="primary-nav"
            onClick={() => setNavOpen((o) => !o)}
          >
            <Icon name="menu" />
          </button>
          <a className="brand" href="#/">
            <img src={BASE_ICON} alt="" />
            <span>Daily Expense Tracker</span>
          </a>
          <div className="spacer" />
          <div className="topbar-actions">
            <button type="button" className="btn" onClick={() => add('income')} title="Add income (I)">
              <Icon name="plus" size={16} />
              <span className="hide-sm">Income</span>
            </button>
            <button type="button" className="btn btn-primary" onClick={() => add('expense')} title="Add expense (E)">
              <Icon name="plus" size={16} />
              <span>Expense</span>
            </button>
            {encrypted && (
              <button type="button" className="btn btn-subtle btn-icon" onClick={lock} aria-label="Lock now" title="Lock now">
                <Icon name="lock" />
              </button>
            )}
          </div>
        </header>
        <nav className="nav" id="primary-nav" aria-label="Primary" data-open={navOpen}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
          <div className="nav-footer">
            <Icon name="shield" size={16} />
            <span>
              Private by design. Your data stays on this device{encrypted ? ' and is encrypted.' : '.'}
            </span>
          </div>
        </nav>
        <div className="scrim" data-open={navOpen} onClick={() => setNavOpen(false)} aria-hidden="true" />
        <main className="main" id="main">
          <Suspense fallback={<div className="page" aria-busy="true" />}>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/wealth" element={<WealthPage />} />
            <Route path="/goals" element={<GoalsPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/budgets" element={<BudgetsPage />} />
            <Route path="/recurring" element={<RecurringPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </main>
      </div>
      <TransactionDialog
        open={dialog.open}
        initialKind={dialog.kind}
        editing={dialog.editing}
        onClose={() => setDialog((d) => ({ ...d, open: false, editing: null }))}
      />
    </EditorContext.Provider>
  );
}

function LockScreen() {
  const { unlock } = useStore();
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState(0);
  const [waitUntil, setWaitUntil] = useState(0);
  const [, tick] = useState(0);

  useEffect(() => {
    if (waitUntil <= Date.now()) return;
    const t = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, [waitUntil]);

  const wait = Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || wait > 0 || !pass) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(pass);
    } catch (err) {
      const n = failures + 1;
      setFailures(n);
      // Escalating delay after repeated failures slows down guessing on a shared device.
      if (n >= 3) setWaitUntil(Date.now() + Math.min(60_000, 2 ** (n - 3) * 2000));
      setError(err instanceof DecryptionError ? 'That passphrase is not correct.' : 'Could not open your data.');
      setPass('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="card auth-card" onSubmit={submit}>
        <img src={BASE_ICON} alt="" width={40} height={40} />
        <div>
          <h1>Unlock your ledger</h1>
          <p className="muted">Your data is encrypted on this device. Enter your passphrase to continue.</p>
        </div>
        <label className="field">
          <span>Passphrase</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            aria-invalid={error ? true : undefined}
            autoFocus
          />
          {error && (
            <span className="error-text" role="alert">
              {error}
              {wait > 0 && ` Try again in ${wait}s.`}
            </span>
          )}
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy || wait > 0 || !pass}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
        <p className="subtle">
          Forgot it? The passphrase cannot be recovered — that is what keeps your data private. Restore from a backup or
          reset from the browser's site data.
        </p>
      </form>
    </div>
  );
}

const FEATURES: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: 'trend', title: 'Net worth, not just spending', body: 'Track what you own and owe, and watch it grow month by month.' },
  { icon: 'flag', title: 'A roadmap from wherever you start', body: 'From clearing a mobile loan to living off investments — one clear next step.' },
  { icon: 'chart', title: 'Growth planner and goals', body: 'See what steady investing becomes, and what waiting costs.' },
  { icon: 'bulb', title: 'Automatic insights', body: 'Tips from your own numbers, with the money each one is worth.' },
  { icon: 'wallet', title: 'Income and spending in one place', body: 'Salary, side jobs and tips in; daily spending out. Paste M-Pesa messages.' },
  { icon: 'shield', title: 'Private and encrypted', body: 'No account. Data never leaves your device. Optional AES-256 lock.' },
  { icon: 'offline', title: 'Works offline', body: 'Install it to your phone or desktop like an app.' },
];

function Welcome() {
  const { start } = useStore();
  return (
    <div className="center-screen">
      <div className="card welcome-card">
        <div className="brand">
          <img src={BASE_ICON} alt="" />
          <span>Daily Expense Tracker</span>
        </div>
        <div>
          <h1>Stop just tracking money. Start building wealth.</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            Whether you just graduated with nothing or already own property and shares, see your net worth, your next
            step and what your money can become. Private, free, no sign-up.
          </p>
        </div>
        <div className="feature-list">
          {FEATURES.map((f) => (
            <div key={f.title}>
              <Icon name={f.icon} />
              <div>
                <h3>{f.title}</h3>
                <p className="muted">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="toolbar">
          <button type="button" className="btn btn-primary" onClick={() => start(emptyLedger())}>
            Start tracking
          </button>
        </div>
        <div className="persona-picker">
          <h2>Or explore a sample</h2>
          <div className="persona-list">
            {(Object.keys(PERSONAS) as Persona[]).map((p) => (
              <button key={p} type="button" className="persona" onClick={() => start(demoLedger(undefined, p))}>
                <strong>{PERSONAS[p].label}</strong>
                <span className="muted">{PERSONAS[p].summary}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CorruptScreen() {
  const { resetCorrupt } = useStore();
  return (
    <div className="center-screen">
      <Card className="auth-card">
        <h1>Your saved data could not be read</h1>
        <MessageBar intent="warning">
          It may have been edited outside the app or damaged. Nothing has been deleted.
        </MessageBar>
        <p className="muted">
          Continuing keeps the unreadable copy aside in this browser's storage and starts a fresh ledger. You can then
          restore a backup from Settings.
        </p>
        <button type="button" className="btn btn-primary" onClick={resetCorrupt}>
          Keep a copy and start fresh
        </button>
      </Card>
    </div>
  );
}

export function App() {
  const { phase } = useStore();
  if (phase === 'locked') return <LockScreen />;
  if (phase === 'welcome') return <Welcome />;
  if (phase === 'corrupt') return <CorruptScreen />;
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
