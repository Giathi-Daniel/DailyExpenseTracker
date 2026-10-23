import {
  addDays,
  addMonths,
  diffDays,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  formatDate,
  formatMonth,
  parts,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  today as todayFn,
  type ISODate,
} from './dates';
import type { Category, CategoryGroup, Ledger, Transaction } from './schema';

export type PeriodKind = 'month' | 'quarter' | 'year' | 'custom';

export interface Period {
  kind: PeriodKind;
  from: ISODate;
  to: ISODate;
}

export function periodFor(kind: Exclude<PeriodKind, 'custom'>, asOf: ISODate = todayFn()): Period {
  switch (kind) {
    case 'month':
      return { kind, from: startOfMonth(asOf), to: endOfMonth(asOf) };
    case 'quarter':
      return { kind, from: startOfQuarter(asOf), to: endOfQuarter(asOf) };
    case 'year':
      return { kind, from: startOfYear(asOf), to: endOfYear(asOf) };
  }
}

export function customPeriod(from: ISODate, to: ISODate): Period {
  return from <= to ? { kind: 'custom', from, to } : { kind: 'custom', from: to, to: from };
}

/** Move a period backwards or forwards by its own length (calendar-aware for month/quarter/year). */
export function shiftPeriod(p: Period, dir: number): Period {
  switch (p.kind) {
    case 'month':
      return periodFor('month', addMonths(p.from, dir));
    case 'quarter':
      return periodFor('quarter', addMonths(p.from, 3 * dir));
    case 'year':
      return periodFor('year', addMonths(p.from, 12 * dir));
    case 'custom': {
      const len = diffDays(p.from, p.to) + 1;
      return { kind: 'custom', from: addDays(p.from, len * dir), to: addDays(p.to, len * dir) };
    }
  }
}

export function periodLabel(p: Period): string {
  switch (p.kind) {
    case 'month':
      return formatMonth(p.from);
    case 'quarter':
      return `Q${Math.floor((parts(p.from).m - 1) / 3) + 1} ${parts(p.from).y}`;
    case 'year':
      return String(parts(p.from).y);
    case 'custom':
      return `${formatDate(p.from)} – ${formatDate(p.to)}`;
  }
}

export function periodDays(p: Period): number {
  return diffDays(p.from, p.to) + 1;
}

export function inPeriod(t: Transaction, p: Period): boolean {
  return t.date >= p.from && t.date <= p.to;
}

export type CategoryIndex = Map<string, Category>;

export function indexCategories(categories: Category[]): CategoryIndex {
  return new Map(categories.map((c) => [c.id, c]));
}

export function groupOf(t: Transaction, cats: CategoryIndex): CategoryGroup {
  if (t.kind === 'income') return 'income';
  return cats.get(t.categoryId)?.group ?? 'wants';
}

/** Spending = money consumed (needs + wants). Saved outflows are not spending. */
export function isSpending(t: Transaction, cats: CategoryIndex): boolean {
  const g = groupOf(t, cats);
  return g === 'needs' || g === 'wants';
}

export interface CategoryTotal {
  categoryId: string;
  total: number;
  count: number;
}

export interface Summary {
  period: Period;
  income: number;
  /** needs + wants */
  spending: number;
  /** Money moved into savings/investments. */
  saved: number;
  needs: number;
  wants: number;
  /** income − spending: everything not consumed, whether moved to savings or left in the account. */
  kept: number;
  /** kept / income, or NaN with no income. */
  savingsRate: number;
  /** Elapsed days used for averages (stops at today for current periods). */
  activeDays: number;
  avgDailySpending: number;
  expenseByCategory: CategoryTotal[];
  incomeBySource: CategoryTotal[];
  largestExpenses: Transaction[];
  txCount: number;
}

function totalsBy(txs: Transaction[]): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>();
  for (const t of txs) {
    const row = map.get(t.categoryId) ?? { categoryId: t.categoryId, total: 0, count: 0 };
    row.total += t.amount;
    row.count += 1;
    map.set(t.categoryId, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function summarize(ledger: Ledger, period: Period, asOf: ISODate = todayFn()): Summary {
  const cats = indexCategories(ledger.categories);
  const txs = ledger.transactions.filter((t) => inPeriod(t, period));
  let income = 0;
  let needs = 0;
  let wants = 0;
  let saved = 0;
  const expenses: Transaction[] = [];
  const incomes: Transaction[] = [];
  for (const t of txs) {
    const g = groupOf(t, cats);
    if (g === 'income') {
      income += t.amount;
      incomes.push(t);
    } else {
      expenses.push(t);
      if (g === 'needs') needs += t.amount;
      else if (g === 'wants') wants += t.amount;
      else saved += t.amount;
    }
  }
  const spending = needs + wants;
  const end = period.to < asOf ? period.to : asOf;
  const activeDays = Math.max(1, end < period.from ? periodDays(period) : diffDays(period.from, end) + 1);
  return {
    period,
    income,
    spending,
    saved,
    needs,
    wants,
    kept: income - spending,
    savingsRate: income > 0 ? (income - spending) / income : Number.NaN,
    activeDays,
    avgDailySpending: Math.round(spending / activeDays),
    expenseByCategory: totalsBy(expenses),
    incomeBySource: totalsBy(incomes),
    largestExpenses: expenses
      .filter((t) => isSpending(t, cats))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10),
    txCount: txs.length,
  };
}

export type Granularity = 'day' | 'week' | 'month';

export function granularityFor(p: Period): Granularity {
  const days = periodDays(p);
  if (days <= 35) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

export interface Bucket {
  key: ISODate;
  label: string;
  from: ISODate;
  to: ISODate;
  income: number;
  spending: number;
  saved: number;
  net: number;
}

function bucketStart(date: ISODate, g: Granularity, weekStartsOn: 0 | 1): ISODate {
  if (g === 'day') return date;
  if (g === 'week') return startOfWeek(date, weekStartsOn);
  return startOfMonth(date);
}

function nextBucket(date: ISODate, g: Granularity): ISODate {
  if (g === 'day') return addDays(date, 1);
  if (g === 'week') return addDays(date, 7);
  return addMonths(date, 1, 1);
}

function bucketLabel(start: ISODate, g: Granularity): string {
  if (g === 'month') return formatMonth(start, 'short');
  return formatDate(start, 'short');
}

/** Time series for charts: every bucket in the period is present, even empty ones. */
export function timeSeries(ledger: Ledger, period: Period, g: Granularity = granularityFor(period)): Bucket[] {
  const cats = indexCategories(ledger.categories);
  const weekStartsOn = ledger.settings.weekStartsOn;
  const buckets = new Map<ISODate, Bucket>();
  for (let s = bucketStart(period.from, g, weekStartsOn); s <= period.to; s = nextBucket(s, g)) {
    const end = addDays(nextBucket(s, g), -1);
    buckets.set(s, {
      key: s,
      label: bucketLabel(s, g),
      from: s < period.from ? period.from : s,
      to: end > period.to ? period.to : end,
      income: 0,
      spending: 0,
      saved: 0,
      net: 0,
    });
  }
  for (const t of ledger.transactions) {
    if (!inPeriod(t, period)) continue;
    const b = buckets.get(bucketStart(t.date, g, weekStartsOn));
    if (!b) continue;
    const grp = groupOf(t, cats);
    if (grp === 'income') b.income += t.amount;
    else if (grp === 'savings') b.saved += t.amount;
    else b.spending += t.amount;
  }
  for (const b of buckets.values()) b.net = b.income - b.spending - b.saved;
  return [...buckets.values()];
}

/** Last n calendar months ending with the month containing asOf. */
export function monthlyHistory(ledger: Ledger, n: number, asOf: ISODate = todayFn()): Summary[] {
  const out: Summary[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    out.push(summarize(ledger, periodFor('month', addMonths(startOfMonth(asOf), -i, 1)), asOf));
  }
  return out;
}

/** Cash on hand from everything recorded up to and including a date. */
export function balanceAsOf(ledger: Ledger, date: ISODate = todayFn()): number {
  let balance = 0;
  for (const t of ledger.transactions) {
    if (t.date > date) continue;
    balance += t.kind === 'income' ? t.amount : -t.amount;
  }
  return balance;
}

export function totalSaved(ledger: Ledger, date: ISODate = todayFn()): number {
  const cats = indexCategories(ledger.categories);
  return ledger.transactions
    .filter((t) => t.date <= date && groupOf(t, cats) === 'savings')
    .reduce((s, t) => s + t.amount, 0);
}

/** Relative change, or null when there is no baseline to compare with. */
export function change(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}
