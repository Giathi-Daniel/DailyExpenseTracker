import { addDays, addMonths, isWeekend, parts, startOfMonth, today as todayFn, type ISODate } from './dates';
import { emptyLedger, makeTransaction, newId, postDueRecurring, withSnapshot, type TxDraft } from './ledger';
import type { Asset, Budget, Goal, Ledger, Liability, RecurringRule } from './schema';

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

export type Persona = 'graduate' | 'professional' | 'investor';

export const PERSONAS: Record<Persona, { label: string; summary: string }> = {
  graduate: {
    label: 'Fresh graduate',
    summary: 'First job at KES 35k plus weekend tips, a Fuliza balance, a student loan and almost no savings.',
  },
  professional: {
    label: 'Salaried professional',
    summary: 'KES 95k salary, a SACCO, a pension and a money market fund, paying off a car loan.',
  },
  investor: {
    label: 'Established investor',
    summary: 'Business owner with property, shares and bonds, living partly off rent and dividends.',
  },
};

interface Config {
  seed: number;
  /** Multiplier for everyday spending amounts. */
  scale: number;
  tips: boolean;
  jobs: { p: number; lo: number; hi: number } | null;
  family: number;
  subs: number[];
  recurring: Array<Omit<RecurringRule, 'id' | 'lastPosted' | 'active' | 'startDate'> & { day: number; asset?: string }>;
  assets: Array<Omit<Asset, 'id' | 'updatedAt' | 'archived'> & { key: string }>;
  liabilities: Array<Omit<Liability, 'id' | 'updatedAt'>>;
  goals: Array<Omit<Goal, 'id' | 'createdAt' | 'assetIds'> & { assets: string[] }>;
  budgets: Budget[];
  /** Monthly passive income entries: [categoryId, day, amount in minor units, note]. */
  passive: Array<[string, number, number, string]>;
  /** Net worth growth per month used to back-fill history. */
  historyGrowth: number;
}

const CONFIGS: Record<Persona, Config> = {
  graduate: {
    seed: 22,
    scale: 0.55,
    tips: true,
    jobs: { p: 0.03, lo: 1500, hi: 4000 },
    family: 200_000,
    subs: [],
    recurring: [
      { kind: 'income', amount: 3_500_000, categoryId: 'inc-salary', note: 'Salary', frequency: 'monthly', day: 27 },
      { kind: 'expense', amount: 800_000, categoryId: 'exp-rent', note: 'Rent (bedsitter)', frequency: 'monthly', day: 0 },
      { kind: 'expense', amount: 250_000, categoryId: 'exp-debt', note: 'Fuliza repayment', frequency: 'monthly', day: 28 },
    ],
    assets: [{ key: 'mpesa', name: 'M-Pesa balance', type: 'cash', value: 320_000, expectedReturnBps: 0 }],
    liabilities: [
      { name: 'Fuliza', type: 'mobile', balance: 450_000, aprBps: 9000, minPayment: 250_000 },
      { name: 'HELB student loan', type: 'student', balance: 18_000_000, aprBps: 400, minPayment: 0 },
    ],
    goals: [{ name: 'Starter emergency fund', target: 3_000_000, targetDate: null, manualSaved: 0, assets: ['mpesa'] }],
    budgets: [
      { categoryId: 'exp-dining', monthlyLimit: 200_000 },
      { categoryId: 'exp-other', monthlyLimit: 150_000 },
    ],
    passive: [],
    historyGrowth: -0.02,
  },
  professional: {
    seed: 2026,
    scale: 1,
    tips: true,
    jobs: { p: 0.04, lo: 4000, hi: 15000 },
    family: 500_000,
    subs: [110_000, 39_000],
    recurring: [
      { kind: 'income', amount: 9_500_000, categoryId: 'inc-salary', note: 'Monthly salary', frequency: 'monthly', day: 27 },
      { kind: 'expense', amount: 2_200_000, categoryId: 'exp-rent', note: 'Rent', frequency: 'monthly', day: 0 },
      { kind: 'expense', amount: 1_000_000, categoryId: 'exp-savings', note: 'Money market fund', frequency: 'monthly', day: 28, asset: 'mmf' },
      { kind: 'expense', amount: 1_200_000, categoryId: 'exp-debt', note: 'Car loan', frequency: 'monthly', day: 5 },
    ],
    assets: [
      { key: 'mpesa', name: 'M-Pesa', type: 'cash', value: 1_200_000, expectedReturnBps: 0 },
      { key: 'bank', name: 'Bank savings', type: 'savings', value: 4_500_000, expectedReturnBps: 300 },
      { key: 'mmf', name: 'Money market fund', type: 'mmf', value: 9_000_000, expectedReturnBps: 900 },
      { key: 'sacco', name: 'SACCO deposits', type: 'sacco', value: 22_000_000, expectedReturnBps: 1000 },
      { key: 'stocks', name: 'NSE shares', type: 'stocks', value: 8_500_000, expectedReturnBps: 900 },
      { key: 'pension', name: 'Pension', type: 'retirement', value: 31_000_000, expectedReturnBps: 800 },
    ],
    liabilities: [{ name: 'Car loan', type: 'car', balance: 45_000_000, aprBps: 1400, minPayment: 1_200_000 }],
    goals: [
      { name: 'Emergency fund (6 months)', target: 36_000_000, targetDate: null, manualSaved: 0, assets: ['bank', 'mmf'] },
      { name: 'Land deposit', target: 150_000_000, targetDate: '2028-12-31', manualSaved: 0, assets: ['sacco'] },
    ],
    budgets: [
      { categoryId: 'exp-food', monthlyLimit: 1_200_000 },
      { categoryId: 'exp-dining', monthlyLimit: 600_000 },
      { categoryId: 'exp-transport', monthlyLimit: 600_000 },
      { categoryId: 'exp-shopping', monthlyLimit: 500_000 },
    ],
    passive: [['inc-investment', 1, 68_000, 'Money market interest']],
    historyGrowth: 0.025,
  },
  investor: {
    seed: 7,
    scale: 3.5,
    tips: false,
    jobs: null,
    family: 4_000_000,
    subs: [250_000, 110_000, 39_000],
    recurring: [
      { kind: 'income', amount: 30_000_000, categoryId: 'inc-business', note: 'Business drawings', frequency: 'monthly', day: 24 },
      { kind: 'income', amount: 12_000_000, categoryId: 'inc-rental', note: 'Apartment rent', frequency: 'monthly', day: 4 },
      { kind: 'expense', amount: 8_500_000, categoryId: 'exp-debt', note: 'Mortgage', frequency: 'monthly', day: 5 },
      { kind: 'expense', amount: 6_000_000, categoryId: 'exp-education', note: 'School fees', frequency: 'monthly', day: 9 },
      { kind: 'expense', amount: 15_000_000, categoryId: 'exp-savings', note: 'Monthly share purchase', frequency: 'monthly', day: 25, asset: 'stocks' },
    ],
    assets: [
      { key: 'cash', name: 'Current account', type: 'cash', value: 40_000_000, expectedReturnBps: 0 },
      { key: 'mmf', name: 'Money market fund', type: 'mmf', value: 220_000_000, expectedReturnBps: 900 },
      { key: 'bonds', name: 'Infrastructure bonds', type: 'bonds', value: 400_000_000, expectedReturnBps: 1300 },
      { key: 'stocks', name: 'Share portfolio', type: 'stocks', value: 560_000_000, expectedReturnBps: 1000 },
      { key: 'property', name: 'Rental apartments', type: 'property', value: 1_800_000_000, expectedReturnBps: 500 },
      { key: 'business', name: 'Logistics company (60%)', type: 'business', value: 900_000_000, expectedReturnBps: 800 },
    ],
    liabilities: [{ name: 'Mortgage', type: 'mortgage', balance: 550_000_000, aprBps: 1300, minPayment: 8_500_000 }],
    goals: [{ name: 'Children’s university fund', target: 800_000_000, targetDate: '2034-08-31', manualSaved: 0, assets: ['bonds'] }],
    budgets: [
      { categoryId: 'exp-dining', monthlyLimit: 3_000_000 },
      { categoryId: 'exp-shopping', monthlyLimit: 2_500_000 },
    ],
    passive: [
      ['inc-investment', 1, 1_650_000, 'Money market interest'],
      ['inc-investment', 15, 4_300_000, 'Bond coupon'],
    ],
    historyGrowth: 0.012,
  },
};

/** Six months of realistic activity for one of three personas, in KES. */
export function demoLedger(asOf: ISODate = todayFn(), persona: Persona = 'professional'): Ledger {
  const cfg = CONFIGS[persona];
  const rand = mulberry32(cfg.seed);
  const between = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) * cfg.scale) * 100;
  const drafts: TxDraft[] = [];
  const add = (kind: TxDraft['kind'], categoryId: string, date: ISODate, amount: number, note = '') =>
    drafts.push({ kind, categoryId, date, amount, note });

  const start = addMonths(startOfMonth(asOf), -5, 1);
  for (let date = start; date <= asOf; date = addDays(date, 1)) {
    const { d } = parts(date);
    const weekend = isWeekend(date);
    const recent = date >= addDays(asOf, -30);

    if (!weekend) add('expense', 'exp-transport', date, between(120, 260), persona === 'investor' ? 'Fuel' : 'Matatu fare');
    if (rand() < 0.3) add('expense', 'exp-food', date, between(600, 3200), rand() < 0.5 ? 'Naivas' : 'Quickmart');
    if (rand() < (weekend ? 0.55 : 0.18)) add('expense', 'exp-dining', date, between(350, recent ? 2000 : 1300), 'Lunch out');
    // Daily snack habit drives the "small purchases" insight.
    if (!weekend && rand() < 0.75) add('expense', 'exp-other', date, between(100, 300), 'Snack');
    if (rand() < 0.08) add('expense', 'exp-shopping', date, between(900, 6000), 'Clothing');
    if (weekend && rand() < 0.35) add('expense', 'exp-fun', date, between(500, 2500), 'Weekend outing');
    if (rand() < 0.12) add('expense', 'exp-fees', date, between(13, 55), 'M-Pesa charges');
    if (d % 7 === 3) add('expense', 'exp-airtime', date, between(250, 500), 'Data bundles');
    if (cfg.tips && weekend && rand() < 0.5) add('income', 'inc-tips', date, between(300, 1500), 'Weekend tips');
    if (cfg.jobs && rand() < cfg.jobs.p) add('income', 'inc-jobs', date, between(cfg.jobs.lo, cfg.jobs.hi), 'Freelance job');

    if (d === 5) add('expense', 'exp-utilities', date, between(1800, 2600), 'KPLC tokens');
    cfg.subs.forEach((amount, i) => {
      if (d === 8 + i * 4) add('expense', 'exp-subs', date, amount, ['Netflix', 'Spotify', 'DStv'][i] ?? 'Subscription');
    });
    if (d === 15) add('expense', 'exp-family', date, cfg.family, 'Support for parents');
    if (d === 20 && rand() < 0.4) add('expense', 'exp-health', date, between(800, 4000), 'Pharmacy');
    for (const [categoryId, day, amount, note] of cfg.passive) if (d === day) add('income', categoryId, date, amount, note);
  }

  const keyToId = new Map(cfg.assets.map((a) => [a.key, newId()]));
  const assets: Asset[] = cfg.assets.map(({ key, ...a }) => ({
    ...a,
    id: keyToId.get(key)!,
    updatedAt: asOf,
    archived: false,
  }));
  const recurring: RecurringRule[] = cfg.recurring.map(({ day, asset, ...r }) => ({
    ...r,
    id: newId(),
    startDate: addDays(start, day),
    lastPosted: null,
    active: true,
    ...(asset ? { assetId: keyToId.get(asset) } : {}),
  }));

  const base = emptyLedger();
  const seeded: Ledger = {
    ...base,
    transactions: drafts.map(makeTransaction),
    recurring,
    assets,
    liabilities: cfg.liabilities.map((l) => ({ ...l, id: newId(), updatedAt: asOf })),
    goals: cfg.goals.map(({ assets: keys, ...g }) => ({
      ...g,
      id: newId(),
      createdAt: start,
      assetIds: keys.flatMap((k) => (keyToId.has(k) ? [keyToId.get(k)!] : [])),
    })),
    budgets: cfg.budgets,
    settings: { ...base.settings, currency: 'KES' },
  };

  const posted = postDueRecurring(seeded, asOf).ledger;
  // Back-fill five months of net-worth readings so the trend chart has a story.
  const now = withSnapshot(posted, asOf).netWorthHistory.at(-1)!;
  const history = [5, 4, 3, 2, 1].map((i) => ({
    month: addMonths(startOfMonth(asOf), -i, 1).slice(0, 7),
    assets: Math.round(now.assets * (1 - cfg.historyGrowth * i)),
    liabilities: Math.round(now.liabilities * (1 + 0.012 * i)),
  }));
  return { ...posted, netWorthHistory: [...history, now] };
}
