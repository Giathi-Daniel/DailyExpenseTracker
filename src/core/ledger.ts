import { addDays, addMonths, diffDays, parts, today as todayFn, type ISODate } from './dates';
import {
  ADDED_CATEGORIES,
  SCHEMA_VERSION,
  Settings,
  type Asset,
  type Budget,
  type Category,
  type Goal,
  type Ledger,
  type Liability,
  type RecurringRule,
  type Transaction,
} from './schema';

export const DEFAULT_CATEGORIES: Category[] = [
  // Income sources
  { id: 'inc-salary', name: 'Salary', kind: 'income', group: 'income', archived: false },
  { id: 'inc-jobs', name: 'Side jobs & freelance', kind: 'income', group: 'income', archived: false },
  { id: 'inc-tips', name: 'Tips', kind: 'income', group: 'income', archived: false },
  { id: 'inc-business', name: 'Business', kind: 'income', group: 'income', archived: false },
  { id: 'inc-gifts', name: 'Gifts & support received', kind: 'income', group: 'income', archived: false },
  { id: 'inc-other', name: 'Other income', kind: 'income', group: 'income', archived: false },
  ...ADDED_CATEGORIES,
  // Needs
  { id: 'exp-rent', name: 'Rent & housing', kind: 'expense', group: 'needs', archived: false },
  { id: 'exp-food', name: 'Groceries', kind: 'expense', group: 'needs', archived: false },
  { id: 'exp-transport', name: 'Transport', kind: 'expense', group: 'needs', archived: false },
  { id: 'exp-utilities', name: 'Utilities', kind: 'expense', group: 'needs', archived: false },
  { id: 'exp-airtime', name: 'Airtime & data', kind: 'expense', group: 'needs', archived: false },
  { id: 'exp-health', name: 'Health', kind: 'expense', group: 'needs', archived: false },
  { id: 'exp-education', name: 'Education', kind: 'expense', group: 'needs', archived: false },
  { id: 'exp-family', name: 'Family support', kind: 'expense', group: 'needs', archived: false },
  { id: 'exp-debt', name: 'Loan repayments', kind: 'expense', group: 'needs', archived: false },
  { id: 'exp-fees', name: 'Fees & charges', kind: 'expense', group: 'needs', archived: false },
  // Wants
  { id: 'exp-dining', name: 'Eating out', kind: 'expense', group: 'wants', archived: false },
  { id: 'exp-shopping', name: 'Shopping', kind: 'expense', group: 'wants', archived: false },
  { id: 'exp-fun', name: 'Entertainment', kind: 'expense', group: 'wants', archived: false },
  { id: 'exp-subs', name: 'Subscriptions', kind: 'expense', group: 'wants', archived: false },
  { id: 'exp-care', name: 'Personal care', kind: 'expense', group: 'wants', archived: false },
  { id: 'exp-other', name: 'Other spending', kind: 'expense', group: 'wants', archived: false },
  // Money set aside: recorded as an outflow but counted as saved, not spent.
  { id: 'exp-savings', name: 'Savings & investments', kind: 'expense', group: 'savings', archived: false },
];

export function emptyLedger(): Ledger {
  return {
    version: SCHEMA_VERSION,
    transactions: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    budgets: [],
    recurring: [],
    assets: [],
    liabilities: [],
    goals: [],
    netWorthHistory: [],
    settings: Settings.parse({}),
  };
}

export function newId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

const nowStamp = () => new Date().toISOString();

export type TxDraft = Pick<Transaction, 'kind' | 'amount' | 'categoryId' | 'date' | 'note'> &
  Partial<Pick<Transaction, 'ref' | 'recurringId' | 'assetId'>>;

export function makeTransaction(draft: TxDraft): Transaction {
  const stamp = nowStamp();
  return { ...draft, id: newId(), createdAt: stamp, updatedAt: stamp };
}

/** Newest first, then by creation time so same-day entries keep their entry order. */
export function sortTransactions(txs: Transaction[]): Transaction[] {
  return [...txs].sort((a, b) =>
    a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date),
  );
}

export type Action =
  | { type: 'tx/add'; drafts: TxDraft[]; asOf?: ISODate }
  | { type: 'tx/update'; id: string; patch: Partial<TxDraft>; asOf?: ISODate }
  | { type: 'tx/delete'; ids: string[]; asOf?: ISODate }
  | { type: 'tx/restore'; txs: Transaction[]; asOf?: ISODate }
  | { type: 'category/add'; category: Omit<Category, 'id' | 'archived'> }
  | { type: 'category/update'; id: string; patch: Partial<Pick<Category, 'name' | 'group' | 'archived'>> }
  | { type: 'budget/set'; categoryId: string; monthlyLimit: number | null }
  | { type: 'recurring/upsert'; rule: Omit<RecurringRule, 'id' | 'lastPosted'> & { id?: string } }
  | { type: 'recurring/delete'; id: string }
  | { type: 'recurring/postDue'; asOf: ISODate }
  | { type: 'settings/update'; patch: Partial<Settings> }
  | { type: 'asset/upsert'; asset: AssetDraft; asOf?: ISODate }
  | { type: 'asset/delete'; id: string; asOf?: ISODate }
  | { type: 'liability/upsert'; liability: LiabilityDraft; asOf?: ISODate }
  | { type: 'liability/delete'; id: string; asOf?: ISODate }
  | {
      type: 'wealth/review';
      assets: Array<{ id: string; value: number }>;
      liabilities: Array<{ id: string; balance: number }>;
      asOf?: ISODate;
    }
  | { type: 'wealth/snapshot'; asOf?: ISODate }
  | { type: 'goal/upsert'; goal: GoalDraft; asOf?: ISODate }
  | { type: 'goal/delete'; id: string }
  | { type: 'ledger/replace'; ledger: Ledger };

export type AssetDraft = Pick<Asset, 'name' | 'type' | 'value' | 'expectedReturnBps'> & { id?: string };
export type LiabilityDraft = Pick<Liability, 'name' | 'type' | 'balance' | 'aprBps' | 'minPayment'> & { id?: string };
export type GoalDraft = Pick<Goal, 'name' | 'target' | 'targetDate' | 'assetIds' | 'manualSaved'> & { id?: string };

// ---- Wealth helpers --------------------------------------------------------

/**
 * How a transaction moves its linked investment: money paid into it (an expense
 * in the savings group) adds to the value; money taken out (income) reduces it.
 */
function assetDelta(t: Pick<Transaction, 'assetId' | 'kind' | 'amount'>): number {
  if (!t.assetId) return 0;
  return t.kind === 'expense' ? t.amount : -t.amount;
}

function moveAssets(assets: Asset[], deltas: Map<string, number>, asOf: ISODate): Asset[] {
  if (deltas.size === 0) return assets;
  return assets.map((a) => {
    const d = deltas.get(a.id);
    return d ? { ...a, value: Math.max(0, a.value + d), updatedAt: asOf } : a;
  });
}

function addDelta(map: Map<string, number>, t: Pick<Transaction, 'assetId' | 'kind' | 'amount'>, sign = 1) {
  const d = assetDelta(t) * sign;
  if (d && t.assetId) map.set(t.assetId, (map.get(t.assetId) ?? 0) + d);
}

export function wealthTotals(state: Pick<Ledger, 'assets' | 'liabilities'>): { assets: number; liabilities: number } {
  return {
    assets: state.assets.filter((a) => !a.archived).reduce((s, a) => s + a.value, 0),
    liabilities: state.liabilities.reduce((s, l) => s + l.balance, 0),
  };
}

/** Record (or overwrite) this month's net-worth reading. */
export function withSnapshot(state: Ledger, asOf: ISODate = todayFn()): Ledger {
  if (state.assets.length === 0 && state.liabilities.length === 0 && state.netWorthHistory.length === 0) return state;
  const month = asOf.slice(0, 7);
  const reading = { month, ...wealthTotals(state) };
  const rest = state.netWorthHistory.filter((s) => s.month !== month);
  return { ...state, netWorthHistory: [...rest, reading].sort((a, b) => a.month.localeCompare(b.month)) };
}

/** Pure state transition. Every UI mutation goes through here. */
export function reduce(state: Ledger, action: Action): Ledger {
  const next = reduceInner(state, action);
  // Keep the monthly net-worth history current whenever balances move.
  if (
    next !== state &&
    (next.assets !== state.assets || next.liabilities !== state.liabilities || action.type === 'wealth/snapshot')
  ) {
    return withSnapshot(next, 'asOf' in action && action.asOf ? action.asOf : todayFn());
  }
  return next;
}

function reduceInner(state: Ledger, action: Action): Ledger {
  const asOf = 'asOf' in action && action.asOf ? action.asOf : todayFn();
  switch (action.type) {
    case 'tx/add': {
      const added = action.drafts.map(makeTransaction);
      const deltas = new Map<string, number>();
      for (const t of added) addDelta(deltas, t);
      return {
        ...state,
        transactions: [...state.transactions, ...added],
        assets: moveAssets(state.assets, deltas, asOf),
      };
    }
    case 'tx/update': {
      const before = state.transactions.find((t) => t.id === action.id);
      if (!before) return state;
      const after = { ...before, ...action.patch, updatedAt: nowStamp() };
      const deltas = new Map<string, number>();
      addDelta(deltas, before, -1);
      addDelta(deltas, after);
      return {
        ...state,
        transactions: state.transactions.map((t) => (t.id === action.id ? after : t)),
        assets: moveAssets(state.assets, deltas, asOf),
      };
    }
    case 'tx/delete': {
      const ids = new Set(action.ids);
      const deltas = new Map<string, number>();
      for (const t of state.transactions) if (ids.has(t.id)) addDelta(deltas, t, -1);
      return {
        ...state,
        transactions: state.transactions.filter((t) => !ids.has(t.id)),
        assets: moveAssets(state.assets, deltas, asOf),
      };
    }
    case 'tx/restore': {
      const existing = new Set(state.transactions.map((t) => t.id));
      const restored = action.txs.filter((t) => !existing.has(t.id));
      const deltas = new Map<string, number>();
      for (const t of restored) addDelta(deltas, t);
      return {
        ...state,
        transactions: [...state.transactions, ...restored],
        assets: moveAssets(state.assets, deltas, asOf),
      };
    }
    case 'category/add':
      return {
        ...state,
        categories: [...state.categories, { ...action.category, id: newId(), archived: false }],
      };
    case 'category/update':
      return {
        ...state,
        categories: state.categories.map((c) => (c.id === action.id ? { ...c, ...action.patch } : c)),
      };
    case 'budget/set': {
      const others = state.budgets.filter((b) => b.categoryId !== action.categoryId);
      const budgets: Budget[] =
        action.monthlyLimit && action.monthlyLimit > 0
          ? [...others, { categoryId: action.categoryId, monthlyLimit: action.monthlyLimit }]
          : others;
      return { ...state, budgets };
    }
    case 'recurring/upsert': {
      const { id, ...fields } = action.rule;
      const existing = id ? state.recurring.find((r) => r.id === id) : undefined;
      if (existing) {
        const scheduleChanged =
          existing.startDate !== fields.startDate || existing.frequency !== fields.frequency;
        return {
          ...state,
          recurring: state.recurring.map((r) =>
            r.id === id ? { ...r, ...fields, lastPosted: scheduleChanged ? null : r.lastPosted } : r,
          ),
        };
      }
      return { ...state, recurring: [...state.recurring, { ...fields, id: newId(), lastPosted: null }] };
    }
    case 'recurring/postDue':
      return postDueRecurring(state, action.asOf).ledger;
    case 'recurring/delete':
      return { ...state, recurring: state.recurring.filter((r) => r.id !== action.id) };
    case 'settings/update':
      return { ...state, settings: Settings.parse({ ...state.settings, ...action.patch }) };
    case 'asset/upsert': {
      const { id, ...fields } = action.asset;
      if (id && state.assets.some((a) => a.id === id)) {
        return { ...state, assets: state.assets.map((a) => (a.id === id ? { ...a, ...fields, updatedAt: asOf } : a)) };
      }
      return { ...state, assets: [...state.assets, { ...fields, id: newId(), updatedAt: asOf, archived: false }] };
    }
    case 'asset/delete':
      return {
        ...state,
        assets: state.assets.filter((a) => a.id !== action.id),
        // History stays; links are cleared so nothing points at a missing asset.
        transactions: state.transactions.map((t) => (t.assetId === action.id ? { ...t, assetId: undefined } : t)),
        recurring: state.recurring.map((r) => (r.assetId === action.id ? { ...r, assetId: undefined } : r)),
        goals: state.goals.map((g) => ({ ...g, assetIds: g.assetIds.filter((a) => a !== action.id) })),
      };
    case 'liability/upsert': {
      const { id, ...fields } = action.liability;
      if (id && state.liabilities.some((l) => l.id === id)) {
        return {
          ...state,
          liabilities: state.liabilities.map((l) => (l.id === id ? { ...l, ...fields, updatedAt: asOf } : l)),
        };
      }
      return { ...state, liabilities: [...state.liabilities, { ...fields, id: newId(), updatedAt: asOf }] };
    }
    case 'liability/delete':
      return { ...state, liabilities: state.liabilities.filter((l) => l.id !== action.id) };
    case 'wealth/review': {
      const values = new Map(action.assets.map((a) => [a.id, a.value]));
      const balances = new Map(action.liabilities.map((l) => [l.id, l.balance]));
      return {
        ...state,
        assets: state.assets.map((a) => {
          const v = values.get(a.id);
          return v === undefined ? a : { ...a, value: v, updatedAt: asOf };
        }),
        liabilities: state.liabilities.map((l) => {
          const b = balances.get(l.id);
          return b === undefined ? l : { ...l, balance: b, updatedAt: asOf };
        }),
      };
    }
    case 'wealth/snapshot':
      return { ...state };
    case 'goal/upsert': {
      const { id, ...fields } = action.goal;
      if (id && state.goals.some((g) => g.id === id)) {
        return { ...state, goals: state.goals.map((g) => (g.id === id ? { ...g, ...fields } : g)) };
      }
      return { ...state, goals: [...state.goals, { ...fields, id: newId(), createdAt: asOf }] };
    }
    case 'goal/delete':
      return { ...state, goals: state.goals.filter((g) => g.id !== action.id) };
    case 'ledger/replace':
      return action.ledger;
  }
}

/** All occurrence dates of a rule in (after, until], capped to avoid runaway loops. */
export function occurrences(rule: RecurringRule, until: ISODate, max = 400): ISODate[] {
  const out: ISODate[] = [];
  const anchorDay = parts(rule.startDate).d;
  let date = rule.startDate;
  let i = 0;
  while (date <= until && out.length < max) {
    if (!rule.lastPosted || date > rule.lastPosted) out.push(date);
    i += 1;
    date = rule.frequency === 'weekly' ? addDays(rule.startDate, 7 * i) : addMonths(rule.startDate, i, anchorDay);
  }
  return out;
}

/**
 * Post any recurring entries that have come due since the app was last opened
 * (salary on the 28th, rent on the 1st…). Idempotent: running twice posts nothing new.
 */
export function postDueRecurring(state: Ledger, asOf: ISODate = todayFn()): { ledger: Ledger; posted: number } {
  let posted = 0;
  const deltas = new Map<string, number>();
  const transactions = [...state.transactions];
  const recurring = state.recurring.map((rule) => {
    if (!rule.active) return rule;
    const due = occurrences(rule, asOf);
    if (due.length === 0) return rule;
    for (const date of due) {
      transactions.push(
        makeTransaction({
          kind: rule.kind,
          amount: rule.amount,
          categoryId: rule.categoryId,
          note: rule.note,
          date,
          recurringId: rule.id,
          ...(rule.assetId ? { assetId: rule.assetId } : {}),
        }),
      );
      addDelta(deltas, { assetId: rule.assetId, kind: rule.kind, amount: rule.amount });
    }
    posted += due.length;
    return { ...rule, lastPosted: due[due.length - 1] ?? rule.lastPosted };
  });
  if (posted === 0) return { ledger: state, posted };
  const assets = moveAssets(state.assets, deltas, asOf);
  const ledger = { ...state, transactions, recurring, assets };
  return { ledger: assets !== state.assets ? withSnapshot(ledger, asOf) : ledger, posted };
}

/** The next date this rule will post (the first occurrence not yet posted). */
export function nextOccurrence(rule: RecurringRule, asOf: ISODate = todayFn()): ISODate | null {
  const base = rule.startDate > asOf ? rule.startDate : asOf;
  const horizon = rule.frequency === 'weekly' ? addDays(base, 7) : addMonths(base, 1, 31);
  return occurrences(rule, horizon)[0] ?? null;
}

/** Merge an imported ledger into the current one without duplicating rows. */
export function mergeLedgers(current: Ledger, incoming: Ledger): { ledger: Ledger; added: number } {
  const catIds = new Set(current.categories.map((c) => c.id));
  const txIds = new Set(current.transactions.map((t) => t.id));
  const refs = new Set(current.transactions.flatMap((t) => (t.ref ? [t.ref] : [])));
  const newTxs = incoming.transactions.filter((t) => !txIds.has(t.id) && !(t.ref && refs.has(t.ref)));
  const ruleIds = new Set(current.recurring.map((r) => r.id));
  const has = <T extends { id: string }>(list: T[]) => {
    const ids = new Set(list.map((x) => x.id));
    return (x: T) => !ids.has(x.id);
  };
  return {
    added: newTxs.length,
    ledger: {
      ...current,
      assets: [...current.assets, ...incoming.assets.filter(has(current.assets))],
      liabilities: [...current.liabilities, ...incoming.liabilities.filter(has(current.liabilities))],
      goals: [...current.goals, ...incoming.goals.filter(has(current.goals))],
      netWorthHistory: [
        ...current.netWorthHistory,
        ...incoming.netWorthHistory.filter((s) => !current.netWorthHistory.some((c) => c.month === s.month)),
      ].sort((a, b) => a.month.localeCompare(b.month)),
      categories: [...current.categories, ...incoming.categories.filter((c) => !catIds.has(c.id))],
      transactions: [...current.transactions, ...newTxs],
      recurring: [...current.recurring, ...incoming.recurring.filter((r) => !ruleIds.has(r.id))],
      budgets: [
        ...current.budgets,
        ...incoming.budgets.filter((b) => !current.budgets.some((c) => c.categoryId === b.categoryId)),
      ],
    },
  };
}

export function daysBetweenInclusive(from: ISODate, to: ISODate): number {
  return diffDays(from, to) + 1;
}
