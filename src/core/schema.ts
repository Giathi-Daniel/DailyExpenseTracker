import { z } from 'zod';

/**
 * Every piece of persisted data passes through these schemas on load and on import.
 * Nothing from localStorage or a backup file is trusted until it parses here.
 */

export const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const isoDate = z.string().regex(ISO_DATE, 'Expected YYYY-MM-DD');
const timestamp = z.string().max(40);
/** Amounts are integers in the currency's minor unit (cents). Max ≈ 90 trillion. */
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = (max: number) => z.string().max(max).transform((s) => s.trim());

export const TxKind = z.enum(['income', 'expense']);
export type TxKind = z.infer<typeof TxKind>;

export const CategoryGroup = z.enum(['income', 'needs', 'wants', 'savings']);
export type CategoryGroup = z.infer<typeof CategoryGroup>;

export const Category = z.object({
  id,
  name: text(40).pipe(z.string().min(1)),
  kind: TxKind,
  /** needs / wants / savings drive the 50/30/20 analysis; income categories use 'income'. */
  group: CategoryGroup,
  archived: z.boolean().default(false),
});
export type Category = z.infer<typeof Category>;

export const Transaction = z.object({
  id,
  kind: TxKind,
  amount: minor.refine((n) => n > 0, 'Amount must be greater than zero'),
  categoryId: id,
  date: isoDate,
  note: text(140).default(''),
  /** External reference such as an M-Pesa code; used to skip duplicate imports. */
  ref: text(32).optional(),
  recurringId: id.optional(),
  /** Investment this money went into; its value moves with the transaction. */
  assetId: id.optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Transaction = z.infer<typeof Transaction>;

export const Frequency = z.enum(['weekly', 'monthly']);
export type Frequency = z.infer<typeof Frequency>;

export const RecurringRule = z.object({
  id,
  kind: TxKind,
  amount: minor.refine((n) => n > 0),
  categoryId: id,
  note: text(140).default(''),
  frequency: Frequency,
  /** First occurrence; later ones follow the same weekday (weekly) or day of month (monthly). */
  startDate: isoDate,
  /** Last date already posted to the ledger, or null if none yet. */
  lastPosted: isoDate.nullable().default(null),
  active: z.boolean().default(true),
  /** Each posted entry also moves this investment's value. */
  assetId: id.optional(),
});
export type RecurringRule = z.infer<typeof RecurringRule>;

export const Budget = z.object({
  categoryId: id,
  monthlyLimit: minor.refine((n) => n > 0),
});
export type Budget = z.infer<typeof Budget>;

export const Theme = z.enum(['system', 'light', 'dark']);
export type Theme = z.infer<typeof Theme>;

export const Settings = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).default('KES'),
  theme: Theme.default('system'),
  /** Target share of income to keep, in whole percent. */
  savingsTargetPct: z.number().int().min(0).max(90).default(20),
  /** Minutes of inactivity before an encrypted vault locks. 0 disables. */
  autoLockMinutes: z.number().int().min(0).max(240).default(10),
  /** First day of the week for weekly views: 0 = Sunday, 1 = Monday. */
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).default(1),
  /** Assumed yearly inflation, in basis points (500 = 5%). Used for real returns. */
  inflationBps: z.number().int().min(0).max(5000).default(500),
  /** Assumed yearly return for projections, in basis points (1000 = 10%). */
  projectionReturnBps: z.number().int().min(0).max(5000).default(1000),
});
export type Settings = z.infer<typeof Settings>;

// ---- Wealth ----------------------------------------------------------------

/** Rates are stored as integer basis points (1250 = 12.50%) to avoid float drift. */
const bps = z.number().int().min(0).max(100_000);

export const AssetType = z.enum([
  'cash',
  'savings',
  'mmf',
  'sacco',
  'bonds',
  'stocks',
  'retirement',
  'property',
  'business',
  'other',
]);
export type AssetType = z.infer<typeof AssetType>;

export const Asset = z.object({
  id,
  name: text(60).pipe(z.string().min(1)),
  type: AssetType,
  /** Current value as the owner last recorded it, in minor units. */
  value: minor,
  /** Owner's own assumption of yearly growth or yield. */
  expectedReturnBps: bps.default(0),
  updatedAt: isoDate,
  archived: z.boolean().default(false),
});
export type Asset = z.infer<typeof Asset>;

export const LiabilityType = z.enum(['mobile', 'credit', 'student', 'personal', 'car', 'mortgage', 'other']);
export type LiabilityType = z.infer<typeof LiabilityType>;

export const Liability = z.object({
  id,
  name: text(60).pipe(z.string().min(1)),
  type: LiabilityType,
  balance: minor,
  /** Yearly interest rate including fees. */
  aprBps: bps.default(0),
  minPayment: minor.default(0),
  updatedAt: isoDate,
});
export type Liability = z.infer<typeof Liability>;

export const Goal = z.object({
  id,
  name: text(60).pipe(z.string().min(1)),
  target: minor.refine((n) => n > 0),
  targetDate: isoDate.nullable().default(null),
  /** Progress comes from these assets' values plus any manual amount. */
  assetIds: z.array(id).max(50).default([]),
  manualSaved: minor.default(0),
  createdAt: isoDate,
});
export type Goal = z.infer<typeof Goal>;

/** One net-worth reading per calendar month, kept automatically. */
export const Snapshot = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  assets: minor,
  liabilities: minor,
});
export type Snapshot = z.infer<typeof Snapshot>;

export const SCHEMA_VERSION = 2 as const;

/** Categories introduced after v1; added to older ledgers on load. */
export const ADDED_CATEGORIES: Category[] = [
  { id: 'inc-investment', name: 'Interest & dividends', kind: 'income', group: 'income', archived: false },
  { id: 'inc-rental', name: 'Rental income', kind: 'income', group: 'income', archived: false },
];

export const Ledger = z.object({
  // v1 files are accepted and upgraded in parseLedger.
  version: z.union([z.literal(1), z.literal(SCHEMA_VERSION)]),
  transactions: z.array(Transaction).max(200_000),
  categories: z.array(Category).max(500),
  budgets: z.array(Budget).max(500),
  recurring: z.array(RecurringRule).max(500),
  assets: z.array(Asset).max(500).default([]),
  liabilities: z.array(Liability).max(500).default([]),
  goals: z.array(Goal).max(200).default([]),
  netWorthHistory: z.array(Snapshot).max(1200).default([]),
  settings: Settings,
});
export type Ledger = Omit<z.infer<typeof Ledger>, 'version'> & { version: typeof SCHEMA_VERSION };

export function parseLedger(input: unknown): Ledger {
  const parsed = Ledger.parse(input);
  const categories = [
    ...parsed.categories,
    ...ADDED_CATEGORIES.filter((c) => !parsed.categories.some((x) => x.id === c.id)),
  ];
  // Referential integrity: drop rows that point at things that do not exist.
  const knownCats = new Set(categories.map((c) => c.id));
  const knownAssets = new Set(parsed.assets.map((a) => a.id));
  return {
    ...parsed,
    version: SCHEMA_VERSION,
    categories,
    transactions: parsed.transactions
      .filter((t) => knownCats.has(t.categoryId))
      .map((t) => (t.assetId && !knownAssets.has(t.assetId) ? { ...t, assetId: undefined } : t)),
    budgets: parsed.budgets.filter((b) => knownCats.has(b.categoryId)),
    recurring: parsed.recurring
      .filter((r) => knownCats.has(r.categoryId))
      .map((r) => (r.assetId && !knownAssets.has(r.assetId) ? { ...r, assetId: undefined } : r)),
    goals: parsed.goals.map((g) => ({ ...g, assetIds: g.assetIds.filter((a) => knownAssets.has(a)) })),
    netWorthHistory: [...parsed.netWorthHistory].sort((a, b) => a.month.localeCompare(b.month)),
  };
}
