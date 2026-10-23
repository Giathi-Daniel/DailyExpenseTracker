import { addDays, addMonths, isWeekend, parts, startOfMonth, today as todayFn, type ISODate } from './dates';
import { emptyLedger, makeTransaction, newId, postDueRecurring, type TxDraft } from './ledger';
import type { Ledger, RecurringRule } from './schema';

/** Small deterministic PRNG so the demo looks the same on every load. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Six months of realistic activity for a salaried Nairobi professional, in KES. */
export function demoLedger(asOf: ISODate = todayFn()): Ledger {
  const rand = mulberry32(2026);
  const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo)) * 100;
  const drafts: TxDraft[] = [];
  const add = (kind: TxDraft['kind'], categoryId: string, date: ISODate, amount: number, note = '') =>
    drafts.push({ kind, categoryId, date, amount, note });

  const start = addMonths(startOfMonth(asOf), -5, 1);
  for (let date = start; date <= asOf; date = addDays(date, 1)) {
    const { d } = parts(date);
    const weekend = isWeekend(date);
    const recent = date >= addDays(asOf, -30);

    if (!weekend) add('expense', 'exp-transport', date, between(120, 260), 'Matatu fare');
    if (rand() < 0.3) add('expense', 'exp-food', date, between(600, 3200), rand() < 0.5 ? 'Naivas' : 'Quickmart');
    if (rand() < (weekend ? 0.55 : 0.18)) add('expense', 'exp-dining', date, between(350, recent ? 2000 : 1300), 'Lunch out');
    // Daily coffee/snack habit drives the "small purchases" insight.
    if (!weekend && rand() < 0.75) add('expense', 'exp-other', date, between(100, 300), 'Snack');
    if (rand() < 0.08) add('expense', 'exp-shopping', date, between(900, 6000), 'Clothing');
    if (weekend && rand() < 0.35) add('expense', 'exp-fun', date, between(500, 2500), 'Weekend outing');
    if (rand() < 0.12) add('expense', 'exp-fees', date, between(13, 55), 'M-Pesa charges');
    if (d % 7 === 3) add('expense', 'exp-airtime', date, between(250, 500), 'Data bundles');
    if (weekend && rand() < 0.5) add('income', 'inc-tips', date, between(300, 1500), 'Weekend tips');
    if (rand() < 0.04) add('income', 'inc-jobs', date, between(4000, 15000), 'Freelance design job');

    if (d === 5) add('expense', 'exp-utilities', date, between(1800, 2600), 'KPLC tokens');
    if (d === 8) add('expense', 'exp-subs', date, 110000, 'Netflix');
    if (d === 12) add('expense', 'exp-subs', date, 39000, 'Spotify');
    if (d === 15) add('expense', 'exp-family', date, 500000, 'Support for parents');
    if (d === 20 && rand() < 0.4) add('expense', 'exp-health', date, between(800, 4000), 'Pharmacy');
  }

  const recurring: RecurringRule[] = [
    {
      id: newId(),
      kind: 'income',
      amount: 9_500_000,
      categoryId: 'inc-salary',
      note: 'Monthly salary',
      frequency: 'monthly',
      startDate: addDays(start, 27),
      lastPosted: null,
      active: true,
    },
    {
      id: newId(),
      kind: 'expense',
      amount: 2_200_000,
      categoryId: 'exp-rent',
      note: 'Rent',
      frequency: 'monthly',
      startDate: start,
      lastPosted: null,
      active: true,
    },
    {
      id: newId(),
      kind: 'expense',
      amount: 1_000_000,
      categoryId: 'exp-savings',
      note: 'Money market fund',
      frequency: 'monthly',
      startDate: addDays(start, 28),
      lastPosted: null,
      active: true,
    },
  ];

  const base = emptyLedger();
  const ledger: Ledger = {
    ...base,
    transactions: drafts.map(makeTransaction),
    recurring,
    budgets: [
      { categoryId: 'exp-food', monthlyLimit: 1_200_000 },
      { categoryId: 'exp-dining', monthlyLimit: 600_000 },
      { categoryId: 'exp-transport', monthlyLimit: 600_000 },
      { categoryId: 'exp-shopping', monthlyLimit: 500_000 },
    ],
    settings: { ...base.settings, currency: 'KES' },
  };
  return postDueRecurring(ledger, asOf).ledger;
}
