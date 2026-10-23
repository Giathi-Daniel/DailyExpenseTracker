/**
 * Passphrase-based encryption with the browser's native Web Crypto API.
 *
 * - Key derivation: PBKDF2-HMAC-SHA256, 600,000 iterations (OWASP 2023+ guidance),
 *   random 16-byte salt per vault.
 * - Cipher: AES-256-GCM with a fresh random 12-byte IV for every write. GCM is
 *   authenticated, so tampered or wrong-passphrase data fails to decrypt instead
 *   of returning garbage.
 * - Derived keys are non-extractable CryptoKey objects; the passphrase itself is
 *   never stored.
 */

export const KDF_ITERATIONS = 600_000;
const KDF_NAME = 'PBKDF2';
const UNICODE_FORM = 'NFKC';

export interface KdfParams {
  name: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  salt: string;
}

export interface CipherBlob {
  name: 'AES-GCM';
  iv: string;
  data: string;
}

export interface VaultKey {
  key: CryptoKey;
  kdf: KdfParams;
}

export class DecryptionError extends Error {
  constructor() {
    super('Incorrect passphrase, or the data has been altered.');
    this.name = 'DecryptionError';
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export async function deriveKey(passphrase: string, kdf?: Partial<KdfParams>): Promise<VaultKey> {
  const params: KdfParams = {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: kdf?.iterations ?? KDF_ITERATIONS,
    salt: kdf?.salt ?? toBase64(crypto.getRandomValues(new Uint8Array(16))),
  };
  if (params.iterations < 100_000 || params.iterations > 10_000_000) {
    throw new Error('Unsupported key-derivation settings.');
  }
  // NFKC so the same phrase typed on different keyboards derives the same key.
  const secretBytes = enc.encode(passphrase.normalize(UNICODE_FORM));
  const material = await crypto.subtle.importKey('raw', secretBytes, { name: KDF_NAME }, false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: params.iterations, salt: fromBase64(params.salt) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { key, kdf: params };
}

export async function encryptJSON(vaultKey: VaultKey, value: unknown): Promise<CipherBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vaultKey.key, enc.encode(JSON.stringify(value)));
  return { name: 'AES-GCM', iv: toBase64(iv), data: toBase64(new Uint8Array(ct)) };
}

export async function decryptJSON(vaultKey: VaultKey, blob: CipherBlob): Promise<unknown> {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(blob.iv) }, vaultKey.key, fromBase64(blob.data));
    return JSON.parse(dec.decode(pt));
  } catch {
    throw new DecryptionError();
  }
}

/** Rough strength estimate for UI feedback (not a security boundary). */
export function passphraseStrength(p: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (p.length < 8) return { score: 0, label: 'Too short' };
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/\d/.test(p)) pool += 10;
  if (/[^A-Za-z0-9]/.test(p)) pool += 33;
  const bits = p.length * Math.log2(Math.max(pool, 1));
  if (bits < 40) return { score: 1, label: 'Weak' };
  if (bits < 60) return { score: 2, label: 'Fair' };
  if (bits < 80) return { score: 3, label: 'Strong' };
  return { score: 4, label: 'Very strong' };
}
