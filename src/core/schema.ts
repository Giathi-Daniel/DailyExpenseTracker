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
});
export type Settings = z.infer<typeof Settings>;

export const SCHEMA_VERSION = 1 as const;

export const Ledger = z.object({
  version: z.literal(SCHEMA_VERSION),
  transactions: z.array(Transaction).max(200_000),
  categories: z.array(Category).max(500),
  budgets: z.array(Budget).max(500),
  recurring: z.array(RecurringRule).max(500),
  settings: Settings,
});
export type Ledger = z.infer<typeof Ledger>;

export function parseLedger(input: unknown): Ledger {
  const ledger = Ledger.parse(input);
  // Referential integrity: drop rows that point at categories that do not exist.
  const known = new Set(ledger.categories.map((c) => c.id));
  return {
    ...ledger,
    transactions: ledger.transactions.filter((t) => known.has(t.categoryId)),
    budgets: ledger.budgets.filter((b) => known.has(b.categoryId)),
    recurring: ledger.recurring.filter((r) => known.has(r.categoryId)),
  };
}
