import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { emptyLedger, postDueRecurring, reduce, withSnapshot, type Action } from '../core/ledger';
import { today } from '../core/dates';
import type { Ledger } from '../core/schema';
import { deriveKey, type VaultKey } from '../storage/crypto';
import * as vault from '../storage/vault';
import { useToast } from './toast';

export type Phase = 'locked' | 'welcome' | 'ready' | 'corrupt';

interface Store {
  phase: Phase;
  ledger: Ledger;
  encrypted: boolean;
  /** Applies an action to the latest state and returns the new ledger. */
  dispatch: (action: Action) => Ledger;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => void;
  setPassphrase: (passphrase: string) => Promise<void>;
  removePassphrase: () => Promise<void>;
  start: (ledger: Ledger) => void;
  resetCorrupt: () => void;
  wipeAll: () => void;
}

const StoreContext = createContext<Store | null>(null);

function initialPhase(): Phase {
  switch (vault.status()) {
    case 'empty':
      return 'welcome';
    case 'locked':
      return 'locked';
    case 'corrupt':
      return 'corrupt';
    case 'plain':
      return 'ready';
  }
}

function initialLedger(phase: Phase): Ledger {
  if (phase !== 'ready') return emptyLedger();
  try {
    return vault.loadPlain();
  } catch {
    return emptyLedger();
  }
}

/** Activity that resets the auto-lock timer. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export function StoreProvider({ children }: { children: ReactNode }) {
  const notify = useToast();
  const [phase, setPhase] = useState<Phase>(() => {
    const p = initialPhase();
    // Plain stores that fail schema validation are treated as corrupt rather than overwritten.
    if (p === 'ready') {
      try {
        vault.loadPlain();
      } catch {
        return 'corrupt';
      }
    }
    return p;
  });
  const [ledger, setLedger] = useState<Ledger>(() => initialLedger(phase));
  const keyRef = useRef<VaultKey | null>(null);
  const [encrypted, setEncrypted] = useState(phase === 'locked');
  const ledgerRef = useRef(ledger);
  const writeChain = useRef<Promise<void>>(Promise.resolve());

  const persist = useCallback(
    (next: Ledger) => {
      const key = keyRef.current;
      writeChain.current = writeChain.current
        .then(() => vault.save(next, key))
        .catch((e: unknown) => notify(e instanceof Error ? e.message : 'Could not save your data.'));
    },
    [notify],
  );

  const commit = useCallback(
    (next: Ledger) => {
      ledgerRef.current = next;
      setLedger(next);
      persist(next);
    },
    [persist],
  );

  /** Post salary, rent and other scheduled entries that fell due while the app was closed. */
  const catchUp = useCallback(
    (loaded: Ledger) => {
      const { ledger: posted0, posted } = postDueRecurring(loaded);
      // Start each month's net-worth reading as soon as the app is opened in that month.
      const month = today().slice(0, 7);
      const needsReading =
        (posted0.assets.length > 0 || posted0.liabilities.length > 0) &&
        !posted0.netWorthHistory.some((h) => h.month === month);
      const next = needsReading ? withSnapshot(posted0) : posted0;
      if (needsReading && posted === 0) {
        commit(next);
      } else if (posted > 0) {
        commit(next);
        notify(`${posted} scheduled ${posted === 1 ? 'entry was' : 'entries were'} added automatically.`);
      } else {
        ledgerRef.current = next;
        setLedger(next);
      }
    },
    [commit, notify],
  );

  useEffect(() => {
    if (phase === 'ready') catchUp(ledgerRef.current);
    // Run once on mount for plain vaults; encrypted vaults catch up on unlock.
  }, []);

  const dispatch = useCallback(
    (action: Action) => {
      const next = reduce(ledgerRef.current, action);
      if (next !== ledgerRef.current) commit(next);
      return next;
    },
    [commit],
  );

  const unlock = useCallback(
    async (passphrase: string) => {
      const { ledger: opened, key } = await vault.unlock(passphrase);
      keyRef.current = key;
      setEncrypted(true);
      setPhase('ready');
      catchUp(opened);
    },
    [catchUp],
  );

  const lock = useCallback(() => {
    if (!keyRef.current) return;
    keyRef.current = null;
    ledgerRef.current = emptyLedger();
    setLedger(ledgerRef.current);
    setPhase('locked');
  }, []);

  const setPassphrase = useCallback(
    async (passphrase: string) => {
      keyRef.current = await deriveKey(passphrase);
      setEncrypted(true);
      persist(ledgerRef.current);
      await writeChain.current;
    },
    [persist],
  );

  const removePassphrase = useCallback(async () => {
    keyRef.current = null;
    setEncrypted(false);
    persist(ledgerRef.current);
    await writeChain.current;
  }, [persist]);

  const start = useCallback(
    (initial: Ledger) => {
      setPhase('ready');
      commit(initial);
    },
    [commit],
  );

  const resetCorrupt = useCallback(() => {
    const kept = vault.quarantineCorrupt();
    notify(`Unreadable data was kept aside under "${kept}" and a fresh ledger started.`);
    setPhase('welcome');
  }, [notify]);

  const wipeAll = useCallback(() => {
    vault.wipe();
    keyRef.current = null;
    setEncrypted(false);
    ledgerRef.current = emptyLedger();
    setLedger(ledgerRef.current);
    setPhase('welcome');
  }, []);

  // Keep multiple open tabs consistent: reload when another tab writes.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== vault.STORAGE_KEY || phase !== 'ready') return;
      if (e.newValue === null) {
        wipeAll();
        return;
      }
      vault
        .reload(keyRef.current)
        .then((next) => {
          ledgerRef.current = next;
          setLedger(next);
          setEncrypted(vault.status() === 'locked');
        })
        .catch(() => lock());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [phase, lock, wipeAll]);

  // Auto-lock encrypted vaults after inactivity.
  const minutes = ledger.settings.autoLockMinutes;
  useEffect(() => {
    if (!encrypted || phase !== 'ready' || minutes === 0) return;
    let timer = window.setTimeout(lock, minutes * 60_000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, minutes * 60_000);
    };
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, reset, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, reset);
    };
  }, [encrypted, phase, minutes, lock]);

  // Apply theme.
  const theme = ledger.settings.theme;
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  const value = useMemo<Store>(
    () => ({
      phase,
      ledger,
      encrypted,
      dispatch,
      unlock,
      lock,
      setPassphrase,
      removePassphrase,
      start,
      resetCorrupt,
      wipeAll,
    }),
    [phase, ledger, encrypted, dispatch, unlock, lock, setPassphrase, removePassphrase, start, resetCorrupt, wipeAll],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

export function useLedger() {
  const { ledger, dispatch } = useStore();
  return { ledger, dispatch, currency: ledger.settings.currency };
}
