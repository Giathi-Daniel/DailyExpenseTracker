import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY } from '../storage/vault';
import { App } from './App';
import { StoreProvider } from './store';
import { ToastProvider } from './toast';

function renderApp() {
  return render(
    <ToastProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </ToastProvider>,
  );
}

describe('app', () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = '';
  });

  it('starts fresh, records an expense and persists it', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Start tracking' }));
    expect(await screen.findByRole('heading', { name: 'Your ledger is empty' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Expense$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add expense' });
    const amount = within(dialog).getByLabelText(/Amount/);
    await user.type(amount, '0');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/greater than zero/);

    await user.clear(amount);
    await user.type(amount, '1,250.50');
    await user.type(within(dialog).getByLabelText(/Note/), 'Lunch');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Lunch')).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.format).toBe('plain');
    expect(stored.ledger.transactions[0]).toMatchObject({ amount: 125050, note: 'Lunch', kind: 'expense' });
  });

  it('shows the lock screen for an encrypted vault', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        app: 'daily-expense-tracker',
        format: 'encrypted',
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: 'AAAAAAAAAAAAAAAAAAAAAA==' },
        cipher: { name: 'AES-GCM', iv: 'AAAAAAAAAAAAAAAA', data: 'AAAA' },
      }),
    );
    renderApp();
    expect(screen.getByRole('heading', { name: 'Unlock your ledger' })).toBeInTheDocument();
  });

  it('refuses to overwrite unreadable data', () => {
    localStorage.setItem(STORAGE_KEY, '{"app":"daily-expense-tracker","format":"plain","ledger":{"version":1}}');
    renderApp();
    expect(screen.getByRole('heading', { name: /could not be read/ })).toBeInTheDocument();
  });
});
