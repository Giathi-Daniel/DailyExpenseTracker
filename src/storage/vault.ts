import { z } from 'zod';
import { emptyLedger } from '../core/ledger';
import { parseLedger, type Ledger } from '../core/schema';
import { decryptJSON, deriveKey, encryptJSON, type VaultKey } from './crypto';

/**
 * Local persistence. Data lives in this browser's localStorage only, either as
 * validated plain JSON or as an AES-GCM encrypted envelope when the user sets a
 * passphrase. The same envelope format is used for backup files.
 */

export const STORAGE_KEY = 'det.vault.v1';
const APP_ID = 'daily-expense-tracker';

const KdfSchema = z.object({
  name: z.literal('PBKDF2'),
  hash: z.literal('SHA-256'),
  iterations: z.number().int(),
  salt: z.string().max(64),
});
const CipherSchema = z.object({ name: z.literal('AES-GCM'), iv: z.string().max(32), data: z.string() });

const Envelope = z.discriminatedUnion('format', [
  z.object({ app: z.literal(APP_ID), format: z.literal('plain'), ledger: z.unknown() }),
  z.object({ app: z.literal(APP_ID), format: z.literal('encrypted'), kdf: KdfSchema, cipher: CipherSchema }),
]);
type Envelope = z.infer<typeof Envelope>;

export type VaultStatus = 'empty' | 'plain' | 'locked' | 'corrupt';

export class NeedsPassphraseError extends Error {
  constructor() {
    super('This backup is encrypted. Enter its passphrase to import it.');
    this.name = 'NeedsPassphraseError';
  }
}

function readEnvelope(raw: string | null): Envelope | null {
  if (raw === null) return null;
  return Envelope.parse(JSON.parse(raw));
}

function storage(): Storage {
  return window.localStorage;
}

export function status(): VaultStatus {
  try {
    const env = readEnvelope(storage().getItem(STORAGE_KEY));
    if (!env) return 'empty';
    return env.format === 'encrypted' ? 'locked' : 'plain';
  } catch {
    return 'corrupt';
  }
}

export function loadPlain(): Ledger {
  const env = readEnvelope(storage().getItem(STORAGE_KEY));
  if (!env) return emptyLedger();
  if (env.format !== 'plain') throw new NeedsPassphraseError();
  return parseLedger(env.ledger);
}

export async function unlock(passphrase: string): Promise<{ ledger: Ledger; key: VaultKey }> {
  const env = readEnvelope(storage().getItem(STORAGE_KEY));
  if (!env || env.format !== 'encrypted') throw new Error('Vault is not encrypted.');
  const key = await deriveKey(passphrase, env.kdf);
  return { ledger: parseLedger(await decryptJSON(key, env.cipher)), key };
}

/** Re-open after another tab wrote, using the key already in memory. */
export async function reload(key: VaultKey | null): Promise<Ledger> {
  const env = readEnvelope(storage().getItem(STORAGE_KEY));
  if (!env) return emptyLedger();
  if (env.format === 'plain') return parseLedger(env.ledger);
  if (!key || key.kdf.salt !== env.kdf.salt) throw new NeedsPassphraseError();
  return parseLedger(await decryptJSON(key, env.cipher));
}

async function envelopeFor(ledger: Ledger, key: VaultKey | null): Promise<Envelope> {
  return key
    ? { app: APP_ID, format: 'encrypted', kdf: key.kdf, cipher: await encryptJSON(key, ledger) }
    : { app: APP_ID, format: 'plain', ledger };
}

export class StorageFullError extends Error {
  constructor() {
    super('Browser storage is full. Export a backup and archive old data to continue.');
    this.name = 'StorageFullError';
  }
}

export async function save(ledger: Ledger, key: VaultKey | null): Promise<void> {
  const serialized = JSON.stringify(await envelopeFor(ledger, key));
  try {
    storage().setItem(STORAGE_KEY, serialized);
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)) throw new StorageFullError();
    throw e;
  }
}

/** Keep unreadable data aside instead of overwriting it, then start fresh. */
export function quarantineCorrupt(): string {
  const raw = storage().getItem(STORAGE_KEY);
  const backupKey = `${STORAGE_KEY}.unreadable.${Date.now()}`;
  if (raw !== null) storage().setItem(backupKey, raw);
  storage().removeItem(STORAGE_KEY);
  return backupKey;
}

export function wipe(): void {
  const keys: string[] = [];
  for (let i = 0; i < storage().length; i += 1) {
    const k = storage().key(i);
    if (k?.startsWith('det.')) keys.push(k);
  }
  for (const k of keys) storage().removeItem(k);
}

export function usageBytes(): number {
  return (storage().getItem(STORAGE_KEY)?.length ?? 0) * 2;
}

// ---- Backups -------------------------------------------------------------

export async function exportBackup(ledger: Ledger, passphrase?: string): Promise<string> {
  const key = passphrase ? await deriveKey(passphrase) : null;
  return JSON.stringify(await envelopeFor(ledger, key), null, key ? 0 : 2);
}

/** Max backup size accepted (10 MB) so a hostile file cannot exhaust memory. */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export async function importBackup(text: string, passphrase?: string): Promise<Ledger> {
  if (text.length > MAX_BACKUP_BYTES) throw new Error('Backup file is too large.');
  let env: Envelope;
  try {
    env = Envelope.parse(JSON.parse(text));
  } catch {
    throw new Error('This is not a Daily Expense Tracker backup file.');
  }
  if (env.format === 'plain') return parseLedger(env.ledger);
  if (!passphrase) throw new NeedsPassphraseError();
  const key = await deriveKey(passphrase, env.kdf);
  return parseLedger(await decryptJSON(key, env.cipher));
}
