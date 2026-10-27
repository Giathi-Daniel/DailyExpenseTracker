import { useRef, useState, type FormEvent } from 'react';
import { transactionsToCsv } from '../../core/csv';
import { today } from '../../core/dates';
import { demoLedger, PERSONAS, type Persona } from '../../core/demo';
import { mergeLedgers, sortTransactions } from '../../core/ledger';
import { CURRENCIES } from '../../core/money';
import type { CategoryGroup, Ledger, Theme } from '../../core/schema';
import { passphraseStrength } from '../../storage/crypto';
import { exportBackup, importBackup, MAX_BACKUP_BYTES, NeedsPassphraseError, usageBytes } from '../../storage/vault';
import { Card, ConfirmDialog, Dialog, downloadFile, MessageBar, Segmented } from '../components/common';
import { Icon } from '../components/Icon';
import { useStore } from '../store';
import { useToast } from '../toast';

function PassphraseFields({
  value,
  confirm,
  onValue,
  onConfirm,
}: {
  value: string;
  confirm: string;
  onValue: (v: string) => void;
  onConfirm: (v: string) => void;
}) {
  const strength = passphraseStrength(value);
  return (
    <>
      <label className="field">
        <span>New passphrase</span>
        <input className="input" type="password" autoComplete="new-password" value={value} onChange={(e) => onValue(e.target.value)} autoFocus />
        <div className="strength" data-score={strength.score} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <span className="subtle">{value ? strength.label : 'At least 8 characters. A few random words work well.'}</span>
      </label>
      <label className="field">
        <span>Confirm passphrase</span>
        <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => onConfirm(e.target.value)} />
      </label>
    </>
  );
}

function SecuritySection() {
  const { encrypted, setPassphrase, removePassphrase, lock, ledger, dispatch } = useStore();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pass.length < 8) return setError('Use at least 8 characters.');
    if (pass !== confirm) return setError('The passphrases do not match.');
    setBusy(true);
    try {
      await setPassphrase(pass);
      notify(encrypted ? 'Passphrase changed.' : 'Encryption turned on. Your data is now locked with your passphrase.');
      setOpen(false);
      setPass('');
      setConfirm('');
      setError(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-section">
      <div>
        <h2>Security</h2>
        <p className="muted">
          Encrypt your data on this device with AES-256. Anyone using this browser would need your passphrase to see it.
        </p>
      </div>
      <div className="stack">
        <MessageBar intent={encrypted ? 'good' : 'info'}>
          {encrypted ? 'Encryption is on.' : 'Encryption is off. Data is stored unencrypted in this browser.'}
        </MessageBar>
        <div className="toolbar">
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            <Icon name="lock" size={16} />
            {encrypted ? 'Change passphrase' : 'Turn on encryption'}
          </button>
          {encrypted && (
            <>
              <button type="button" className="btn" onClick={lock}>
                Lock now
              </button>
              <button type="button" className="btn btn-subtle" onClick={() => setConfirmRemove(true)}>
                Turn off encryption
              </button>
            </>
          )}
        </div>
        {encrypted && (
          <label className="field">
            <span>Lock automatically after</span>
            <select
              className="select"
              value={ledger.settings.autoLockMinutes}
              onChange={(e) => dispatch({ type: 'settings/update', patch: { autoLockMinutes: Number(e.target.value) } })}
            >
              {[1, 5, 10, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m} minute{m === 1 ? '' : 's'} of inactivity
                </option>
              ))}
              <option value={0}>Never</option>
            </select>
          </label>
        )}
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title={encrypted ? 'Change passphrase' : 'Turn on encryption'}>
        <form onSubmit={submit} className="stack" style={{ alignItems: 'stretch' }}>
          <MessageBar intent="warning">
            There is no way to recover a forgotten passphrase. Keep it somewhere safe, and keep a backup.
          </MessageBar>
          <PassphraseFields value={pass} confirm={confirm} onValue={setPass} onConfirm={setConfirm} />
          {error && (
            <span className="error-text" role="alert">
              {error}
            </span>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Encrypting…' : 'Save passphrase'}
            </button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirmRemove}
        title="Turn off encryption?"
        body="Your data will be stored unencrypted in this browser."
        confirmLabel="Turn off"
        danger
        onConfirm={() => {
          void removePassphrase().then(() => notify('Encryption turned off.'));
        }}
        onClose={() => setConfirmRemove(false)}
      />
    </div>
  );
}

function DataSection() {
  const { ledger, dispatch, wipeAll } = useStore();
  const notify = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [backupDialog, setBackupDialog] = useState(false);
  const [backupPass, setBackupPass] = useState('');
  const [backupConfirm, setBackupConfirm] = useState('');
  const [pending, setPending] = useState<{ text: string; needsPass: boolean } | null>(null);
  const [importPass, setImportPass] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Ledger | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [persona, setPersona] = useState<Persona>('professional');

  const exportPlain = async () => {
    downloadFile(`expense-tracker-backup-${today()}.json`, await exportBackup(ledger), 'application/json');
  };

  const exportEncrypted = async (e: FormEvent) => {
    e.preventDefault();
    if (backupPass.length < 8 || backupPass !== backupConfirm) return;
    downloadFile(`expense-tracker-backup-${today()}.encrypted.json`, await exportBackup(ledger, backupPass), 'application/json');
    setBackupDialog(false);
    setBackupPass('');
    setBackupConfirm('');
    notify('Encrypted backup downloaded.');
  };

  const readFile = async (file: File) => {
    if (file.size > MAX_BACKUP_BYTES) return notify('That file is too large to be a backup.');
    const text = await file.text();
    try {
      setIncoming(await importBackup(text));
    } catch (err) {
      if (err instanceof NeedsPassphraseError) setPending({ text, needsPass: true });
      else notify(err instanceof Error ? err.message : 'Could not read that file.');
    }
  };

  const decryptPending = async (e: FormEvent) => {
    e.preventDefault();
    if (!pending) return;
    try {
      setIncoming(await importBackup(pending.text, importPass));
      setPending(null);
      setImportPass('');
      setImportError(null);
    } catch {
      setImportError('Incorrect passphrase, or the file is damaged.');
    }
  };

  const applyImport = (mode: 'merge' | 'replace') => {
    if (!incoming) return;
    if (mode === 'replace') {
      dispatch({ type: 'ledger/replace', ledger: incoming });
      notify(`Backup restored: ${incoming.transactions.length} transactions.`);
    } else {
      const { ledger: merged, added } = mergeLedgers(ledger, incoming);
      dispatch({ type: 'ledger/replace', ledger: merged });
      notify(`Merged ${added} new transaction${added === 1 ? '' : 's'}.`);
    }
    setIncoming(null);
  };

  const kb = Math.ceil(usageBytes() / 1024);

  return (
    <div className="settings-section">
      <div>
        <h2>Your data</h2>
        <p className="muted">
          Everything is stored in this browser only. Back up regularly — clearing browser data or losing this device
          deletes it.
        </p>
      </div>
      <div className="stack">
        <div className="toolbar">
          <button type="button" className="btn" onClick={() => void exportPlain()}>
            <Icon name="download" size={16} />
            Download backup
          </button>
          <button type="button" className="btn" onClick={() => setBackupDialog(true)}>
            <Icon name="lock" size={16} />
            Encrypted backup
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={16} />
            Restore from backup
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              downloadFile(
                `all-transactions-${today()}.csv`,
                `﻿${transactionsToCsv(ledger, sortTransactions(ledger.transactions))}`,
                'text/csv;charset=utf-8',
              )
            }
          >
            Export all as CSV
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFile(f);
              e.target.value = '';
            }}
          />
        </div>
        <p className="subtle">
          {ledger.transactions.length} transactions · about {kb} KB of roughly 5,000 KB available
        </p>
        <div className="toolbar">
          <button type="button" className="btn btn-subtle" onClick={() => setConfirmDemo(true)}>
            Load sample data
          </button>
          <button type="button" className="btn btn-danger" onClick={() => setConfirmWipe(true)}>
            <Icon name="trash" size={16} />
            Delete all data
          </button>
        </div>
      </div>

      <Dialog open={backupDialog} onClose={() => setBackupDialog(false)} title="Encrypted backup">
        <form onSubmit={exportEncrypted} className="stack" style={{ alignItems: 'stretch' }}>
          <p className="muted">The file can only be restored with this passphrase. It can differ from your app passphrase.</p>
          <PassphraseFields value={backupPass} confirm={backupConfirm} onValue={setBackupPass} onConfirm={setBackupConfirm} />
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setBackupDialog(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={backupPass.length < 8 || backupPass !== backupConfirm}>
              Download
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={pending !== null} onClose={() => setPending(null)} title="Encrypted backup">
        <form onSubmit={decryptPending} className="stack" style={{ alignItems: 'stretch' }}>
          <label className="field">
            <span>Backup passphrase</span>
            <input className="input" type="password" value={importPass} onChange={(e) => setImportPass(e.target.value)} autoFocus />
            {importError && (
              <span className="error-text" role="alert">
                {importError}
              </span>
            )}
          </label>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!importPass}>
              Open backup
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={incoming !== null} onClose={() => setIncoming(null)} title="Restore backup">
        <p className="muted">
          This backup has {incoming?.transactions.length ?? 0} transactions. Merge adds anything new to what you have.
          Replace swaps your current data for the backup.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => setIncoming(null)}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={() => applyImport('replace')}>
            Replace
          </button>
          <button type="button" className="btn btn-primary" onClick={() => applyImport('merge')}>
            Merge
          </button>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmDemo}
        title="Load sample data?"
        body={
          <div className="stack" style={{ alignItems: 'stretch' }}>
            <p>
              This replaces your current data with six months of example activity. Download a backup first if you want
              to keep what you have.
            </p>
            <label className="field">
              <span>Sample</span>
              <select className="select" value={persona} onChange={(e) => setPersona(e.target.value as Persona)}>
                {(Object.keys(PERSONAS) as Persona[]).map((p) => (
                  <option key={p} value={p}>
                    {PERSONAS[p].label}
                  </option>
                ))}
              </select>
              <span className="subtle">{PERSONAS[persona].summary}</span>
            </label>
          </div>
        }
        confirmLabel="Load sample data"
        onConfirm={() => {
          const demo = demoLedger(undefined, persona);
          dispatch({ type: 'ledger/replace', ledger: { ...demo, settings: { ...demo.settings, theme: ledger.settings.theme } } });
          notify('Sample data loaded.');
        }}
        onClose={() => setConfirmDemo(false)}
      />
      <ConfirmDialog
        open={confirmWipe}
        title="Delete all data?"
        body="Every transaction, budget, schedule and setting on this device will be permanently deleted. This cannot be undone."
        confirmLabel="Delete everything"
        danger
        onConfirm={wipeAll}
        onClose={() => setConfirmWipe(false)}
      />
    </div>
  );
}

function CategoriesSection() {
  const { ledger, dispatch } = useStore();
  const notify = useToast();
  const [name, setName] = useState('');
  const [group, setGroup] = useState<CategoryGroup>('wants');

  const add = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (ledger.categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      notify('A category with that name already exists.');
      return;
    }
    dispatch({ type: 'category/add', category: { name: trimmed.slice(0, 40), kind: group === 'income' ? 'income' : 'expense', group } });
    setName('');
    notify(`Category "${trimmed}" added.`);
  };

  const custom = ledger.categories.filter((c) => !c.id.startsWith('inc-') && !c.id.startsWith('exp-'));

  return (
    <div className="settings-section">
      <div>
        <h2>Categories</h2>
        <p className="muted">Add your own. Needs and wants drive the 50/30/20 analysis; savings are counted as kept money.</p>
      </div>
      <div className="stack" style={{ alignItems: 'stretch' }}>
        <form className="toolbar" onSubmit={add}>
          <label className="grow">
            <span className="sr-only">Category name</span>
            <input className="input" placeholder="e.g. Chama contribution" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span className="sr-only">Type</span>
            <select className="select" value={group} onChange={(e) => setGroup(e.target.value as CategoryGroup)}>
              <option value="needs">Expense · need</option>
              <option value="wants">Expense · want</option>
              <option value="savings">Savings</option>
              <option value="income">Income source</option>
            </select>
          </label>
          <button type="submit" className="btn" disabled={!name.trim()}>
            Add
          </button>
        </form>
        {custom.length > 0 && (
          <div className="list">
            {custom.map((c) => (
              <div className="list-row" key={c.id}>
                <div className="grow">
                  <div className="title">{c.name}</div>
                  <div className="subtle">{c.group === 'income' ? 'Income source' : c.group}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-subtle btn-sm"
                  onClick={() => dispatch({ type: 'category/update', id: c.id, patch: { archived: !c.archived } })}
                >
                  {c.archived ? 'Restore' : 'Hide'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { ledger, dispatch } = useStore();
  const s = ledger.settings;
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">Preferences, security and backups.</p>
        </div>
      </div>
      <Card>
        <div className="settings-section">
          <div>
            <h2>Preferences</h2>
            <p className="muted">Currency, appearance and your savings goal.</p>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Currency</span>
              <select className="select" value={s.currency} onChange={(e) => dispatch({ type: 'settings/update', patch: { currency: e.target.value } })}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Savings goal</span>
              <select
                className="select"
                value={s.savingsTargetPct}
                onChange={(e) => dispatch({ type: 'settings/update', patch: { savingsTargetPct: Number(e.target.value) } })}
              >
                {[5, 10, 15, 20, 25, 30, 40, 50].map((p) => (
                  <option key={p} value={p}>
                    Keep {p}% of income
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Expected yearly return for projections</span>
              <select
                className="select"
                value={s.projectionReturnBps}
                onChange={(e) => dispatch({ type: 'settings/update', patch: { projectionReturnBps: Number(e.target.value) } })}
              >
                {[400, 600, 800, 1000, 1200, 1500].map((b) => (
                  <option key={b} value={b}>
                    {b / 100}% a year
                  </option>
                ))}
              </select>
              <span className="subtle">An assumption, not a promise. Lower is more cautious.</span>
            </label>
            <label className="field">
              <span>Inflation</span>
              <select
                className="select"
                value={s.inflationBps}
                onChange={(e) => dispatch({ type: 'settings/update', patch: { inflationBps: Number(e.target.value) } })}
              >
                {[200, 300, 400, 500, 600, 800, 1000].map((b) => (
                  <option key={b} value={b}>
                    {b / 100}% a year
                  </option>
                ))}
              </select>
              <span className="subtle">Used to show what returns are worth in today's money.</span>
            </label>
            <label className="field">
              <span>Week starts on</span>
              <select
                className="select"
                value={s.weekStartsOn}
                onChange={(e) => dispatch({ type: 'settings/update', patch: { weekStartsOn: Number(e.target.value) as 0 | 1 } })}
              >
                <option value={1}>Monday</option>
                <option value={0}>Sunday</option>
              </select>
            </label>
            <div className="field">
              <span>Theme</span>
              <Segmented<Theme>
                label="Theme"
                value={s.theme}
                onChange={(theme) => dispatch({ type: 'settings/update', patch: { theme } })}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
              />
            </div>
          </div>
        </div>
        <SecuritySection />
        <DataSection />
        <CategoriesSection />
        <div className="settings-section">
          <div>
            <h2>Privacy</h2>
          </div>
          <div className="stack">
            <p className="muted">
              No account, no tracking, no analytics, no third-party requests. The app is a static page; your data is
              stored in this browser and never sent anywhere. A strict Content-Security-Policy blocks any external
              script or connection.
            </p>
            <p className="subtle">Keyboard: press E to add an expense, I to add income.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
