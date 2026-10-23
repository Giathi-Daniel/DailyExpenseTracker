import { beforeEach, describe, expect, it } from 'vitest';
import { demoLedger } from '../core/demo';
import { emptyLedger } from '../core/ledger';
import { DecryptionError, deriveKey, passphraseStrength } from './crypto';
import * as vault from './vault';

const ledger = demoLedger('2026-10-23');

describe('vault', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty and round-trips plain data', async () => {
    expect(vault.status()).toBe('empty');
    expect(vault.loadPlain()).toEqual(emptyLedger());
    await vault.save(ledger, null);
    expect(vault.status()).toBe('plain');
    expect(vault.loadPlain().transactions).toHaveLength(ledger.transactions.length);
  });

  it('encrypts at rest: no readable amounts or notes in storage', async () => {
    const key = await deriveKey('correct horse battery staple');
    await vault.save(ledger, key);
    const raw = localStorage.getItem(vault.STORAGE_KEY)!;
    expect(vault.status()).toBe('locked');
    expect(raw).not.toContain('Salary');
    expect(raw).not.toContain('Naivas');
    const { ledger: opened } = await vault.unlock('correct horse battery staple');
    expect(opened.transactions).toHaveLength(ledger.transactions.length);
  });

  it('rejects a wrong passphrase and tampered ciphertext', async () => {
    const key = await deriveKey('correct horse battery staple');
    await vault.save(ledger, key);
    await expect(vault.unlock('wrong passphrase!!')).rejects.toBeInstanceOf(DecryptionError);
    const env = JSON.parse(localStorage.getItem(vault.STORAGE_KEY)!);
    const bytes = atob(env.cipher.data);
    env.cipher.data = btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1));
    localStorage.setItem(vault.STORAGE_KEY, JSON.stringify(env));
    await expect(vault.unlock('correct horse battery staple')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('refuses weakened key-derivation parameters from storage', async () => {
    const key = await deriveKey('correct horse battery staple');
    await vault.save(ledger, key);
    const env = JSON.parse(localStorage.getItem(vault.STORAGE_KEY)!);
    env.kdf.iterations = 1;
    localStorage.setItem(vault.STORAGE_KEY, JSON.stringify(env));
    await expect(vault.unlock('correct horse battery staple')).rejects.toThrow(/Unsupported/);
  });

  it('detects corrupt storage and quarantines it instead of overwriting', () => {
    localStorage.setItem(vault.STORAGE_KEY, '{"app":"evil"}');
    expect(vault.status()).toBe('corrupt');
    const kept = vault.quarantineCorrupt();
    expect(localStorage.getItem(kept)).toBe('{"app":"evil"}');
    expect(vault.status()).toBe('empty');
  });

  it('exports and imports encrypted backups', async () => {
    const file = await vault.exportBackup(ledger, 'backup passphrase 1');
    await expect(vault.importBackup(file)).rejects.toBeInstanceOf(vault.NeedsPassphraseError);
    const restored = await vault.importBackup(file, 'backup passphrase 1');
    expect(restored.transactions).toHaveLength(ledger.transactions.length);
    await expect(vault.importBackup('{"not":"ours"}')).rejects.toThrow(/not a Daily Expense Tracker backup/);
  });

  it('wipes only its own keys', async () => {
    localStorage.setItem('other-app', 'x');
    await vault.save(ledger, null);
    vault.wipe();
    expect(vault.status()).toBe('empty');
    expect(localStorage.getItem('other-app')).toBe('x');
  });
});

describe('passphrase strength', () => {
  it('grades passphrases', () => {
    expect(passphraseStrength('short').score).toBe(0);
    expect(passphraseStrength('password').score).toBe(1);
    expect(passphraseStrength('Correct-Horse-Battery-Staple-9').score).toBe(4);
  });
});
