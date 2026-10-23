import { addDays, addMonths, diffDays, parts, today as todayFn, type ISODate } from './dates';
import {
  SCHEMA_VERSION,
  Settings,
  type Budget,
  type Category,
  type Ledger,
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
    settings: Settings.parse({}),
  };
}

export function newId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

const nowStamp = () => new Date().toISOString();

export type TxDraft = Pick<Transaction, 'kind' | 'amount' | 'categoryId' | 'date' | 'note'> &
  Partial<Pick<Transaction, 'ref' | 'recurringId'>>;

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
  | { type: 'tx/add'; drafts: TxDraft[] }
  | { type: 'tx/update'; id: string; patch: Partial<TxDraft> }
  | { type: 'tx/delete'; ids: string[] }
  | { type: 'tx/restore'; txs: Transaction[] }
  | { type: 'category/add'; category: Omit<Category, 'id' | 'archived'> }
  | { type: 'category/update'; id: string; patch: Partial<Pick<Category, 'name' | 'group' | 'archived'>> }
  | { type: 'budget/set'; categoryId: string; monthlyLimit: number | null }
  | { type: 'recurring/upsert'; rule: Omit<RecurringRule, 'id' | 'lastPosted'> & { id?: string } }
  | { type: 'recurring/delete'; id: string }
  | { type: 'recurring/postDue'; asOf: ISODate }
  | { type: 'settings/update'; patch: Partial<Settings> }
  | { type: 'ledger/replace'; ledger: Ledger };

/** Pure state transition. Every UI mutation goes through here. */
export function reduce(state: Ledger, action: Action): Ledger {
  switch (action.type) {
    case 'tx/add':
      return { ...state, transactions: [...state.transactions, ...action.drafts.map(makeTransaction)] };
    case 'tx/update':
      return {
        ...state,
        transactions: state.transactions.map((t) =>
          t.id === action.id ? { ...t, ...action.patch, updatedAt: nowStamp() } : t,
        ),
      };
    case 'tx/delete': {
      const ids = new Set(action.ids);
      return { ...state, transactions: state.transactions.filter((t) => !ids.has(t.id)) };
    }
    case 'tx/restore': {
      const existing = new Set(state.transactions.map((t) => t.id));
      return { ...state, transactions: [...state.transactions, ...action.txs.filter((t) => !existing.has(t.id))] };
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
        }),
      );
    }
    posted += due.length;
    return { ...rule, lastPosted: due[due.length - 1] ?? rule.lastPosted };
  });
  return posted === 0 ? { ledger: state, posted } : { ledger: { ...state, transactions, recurring }, posted };
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
  return {
    added: newTxs.length,
    ledger: {
      ...current,
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
