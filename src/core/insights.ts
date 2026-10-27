import { addDays, daysInMonth, diffDays, isWeekend, parts, startOfMonth, today as todayFn, type ISODate } from './dates';
import { formatMoney, formatPct } from './money';
import {
  customPeriod,
  groupOf,
  indexCategories,
  periodFor,
  summarize,
  type CategoryIndex,
  type Summary,
} from './reports';
import type { Ledger, Transaction } from './schema';
import {
  ASSET_CLASS_LABEL,
  ASSET_TYPES,
  bpsToPct,
  futureValue,
  netWorthChange,
  realReturnBps,
  wealthPicture,
  type AssetClass,
  type WealthPicture,
} from './wealth';

/**
 * Rule-based savings coach. Every insight is derived from the user's own numbers,
 * explains why it fired, and where possible says how much money acting on it is worth.
 * Runs entirely on-device: no data leaves the browser.
 */

export type Severity = 'critical' | 'warning' | 'info' | 'positive';

export interface Insight {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Concrete next step. */
  action?: string;
  /** Estimated money per month this frees up, in minor units. */
  impact?: number;
  categoryId?: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2, positive: 3 };

interface Ctx {
  ledger: Ledger;
  cats: CategoryIndex;
  asOf: ISODate;
  currency: string;
  money: (n: number) => string;
  name: (categoryId: string) => string;
  month: Summary;
  /** Rolling last 30 days, so early-month analysis still has signal. */
  last30: Summary;
  /** Average of the three 30-day windows before last30. */
  baselineByCategory: Map<string, number>;
  baselineSpending: number;
  historyDays: number;
  wealth: WealthPicture;
}

function windowSummary(ledger: Ledger, endInclusive: ISODate, days: number, asOf: ISODate): Summary {
  return summarize(ledger, customPeriod(addDays(endInclusive, -(days - 1)), endInclusive), asOf);
}

function buildCtx(ledger: Ledger, asOf: ISODate): Ctx {
  const cats = indexCategories(ledger.categories);
  const currency = ledger.settings.currency;
  const earliest = ledger.transactions.reduce<ISODate>((min, t) => (t.date < min ? t.date : min), asOf);
  const historyDays = Math.max(0, diffDays(earliest, asOf));

  const baselineByCategory = new Map<string, number>();
  let baselineSpending = 0;
  const windows = Math.min(3, Math.floor(historyDays / 30) - 1);
  for (let w = 1; w <= windows; w += 1) {
    const s = windowSummary(ledger, addDays(asOf, -30 * w), 30, asOf);
    baselineSpending += s.spending / windows;
    for (const row of s.expenseByCategory) {
      baselineByCategory.set(row.categoryId, (baselineByCategory.get(row.categoryId) ?? 0) + row.total / windows);
    }
  }

  return {
    ledger,
    cats,
    asOf,
    currency,
    money: (n) => formatMoney(Math.round(n), currency, { whole: true }),
    name: (id) => cats.get(id)?.name ?? 'Uncategorised',
    month: summarize(ledger, periodFor('month', asOf), asOf),
    last30: windowSummary(ledger, asOf, 30, asOf),
    baselineByCategory,
    baselineSpending,
    historyDays,
    wealth: wealthPicture(ledger, asOf),
  };
}

type Rule = (ctx: Ctx) => Insight[];

/**
 * Uses a rolling 30-day window, not the calendar month: someone paid on the 28th
 * would otherwise look broke for most of every month.
 */
const savingsRate: Rule = ({ last30, ledger, money }) => {
  const target = ledger.settings.savingsTargetPct / 100;
  if (last30.income === 0) {
    if (last30.spending === 0) return [];
    return [
      {
        id: 'no-income',
        severity: 'info',
        title: 'No income recorded in the last 30 days',
        detail: `You have spent ${money(last30.spending)} in that time but logged no income, so your savings rate can't be measured.`,
        action: 'Add your salary, side jobs and tips — or set salary up as a recurring entry so it posts itself.',
      },
    ];
  }
  if (last30.kept < 0) {
    return [
      {
        id: 'overspending',
        severity: 'critical',
        title: 'You are spending more than you earn',
        detail: `In the last 30 days you spent ${money(-last30.kept)} more than your income of ${money(last30.income)}.`,
        action: 'Pause non-essential spending until income catches up, starting with your largest "wants" category.',
        impact: -last30.kept,
      },
    ];
  }
  if (last30.savingsRate < target) {
    const gap = target * last30.income - last30.kept;
    return [
      {
        id: 'below-target',
        severity: 'warning',
        title: `You are keeping ${formatPct(last30.savingsRate)} of income, below your ${formatPct(target)} goal`,
        detail: `${money(last30.kept)} of ${money(last30.income)} earned in the last 30 days was not spent.`,
        action: `Spending ${money(gap)} less a month would reach your goal.`,
        impact: gap,
      },
    ];
  }
  return [
    {
      id: 'on-target',
      severity: 'positive',
      title: `You are keeping ${formatPct(last30.savingsRate)} of your income`,
      detail: `That beats your ${formatPct(target)} goal — ${money(last30.kept)} kept in the last 30 days.`,
    },
  ];
};

const budgetPace: Rule = ({ ledger, month, asOf, money, name }) => {
  const out: Insight[] = [];
  const { y, m, d } = parts(asOf);
  const dim = daysInMonth(y, m);
  const daysLeft = dim - d;
  for (const b of ledger.budgets) {
    const spent = month.expenseByCategory.find((r) => r.categoryId === b.categoryId)?.total ?? 0;
    if (spent > b.monthlyLimit) {
      out.push({
        id: `budget-over-${b.categoryId}`,
        severity: 'critical',
        categoryId: b.categoryId,
        title: `${name(b.categoryId)} is over budget`,
        detail: `${money(spent)} spent against a ${money(b.monthlyLimit)} budget — ${money(spent - b.monthlyLimit)} over.`,
        action: `Hold ${name(b.categoryId).toLowerCase()} spending for the rest of the month, or raise the budget if it was unrealistic.`,
        impact: spent - b.monthlyLimit,
      });
      continue;
    }
    if (d < 5 || spent === 0) continue;
    const projected = (spent / d) * dim;
    if (projected > b.monthlyLimit * 1.05 && daysLeft > 0) {
      const allowance = (b.monthlyLimit - spent) / daysLeft;
      out.push({
        id: `budget-pace-${b.categoryId}`,
        severity: 'warning',
        categoryId: b.categoryId,
        title: `${name(b.categoryId)} is on pace to overspend`,
        detail: `At the current rate you will spend about ${money(projected)} against ${money(b.monthlyLimit)}.`,
        action: `Keep it under ${money(allowance)} a day for the remaining ${daysLeft} days.`,
        impact: projected - b.monthlyLimit,
      });
    }
  }
  return out;
};

const categoryTrends: Rule = ({ last30, baselineByCategory, baselineSpending, cats, money, name }) => {
  if (baselineByCategory.size === 0) return [];
  const out: Insight[] = [];
  const noise = Math.max(baselineSpending * 0.03, 1);
  const seen = new Set<string>();
  for (const row of last30.expenseByCategory) {
    seen.add(row.categoryId);
    const group = cats.get(row.categoryId)?.group;
    if (group === 'savings') continue;
    const base = baselineByCategory.get(row.categoryId) ?? 0;
    const delta = row.total - base;
    if (base > 0 && row.total > base * 1.3 && delta > noise) {
      out.push({
        id: `spike-${row.categoryId}`,
        severity: 'warning',
        categoryId: row.categoryId,
        title: `${name(row.categoryId)} is up ${formatPct(delta / base)}`,
        detail: `${money(row.total)} in the last 30 days versus a usual ${money(base)}.`,
        action:
          group === 'wants'
            ? `Getting back to your usual level frees up ${money(delta)} a month.`
            : `Check what changed — a one-off, or a new fixed cost worth renegotiating?`,
        impact: group === 'wants' ? delta : undefined,
      });
    } else if (base > noise && row.total < base * 0.75 && group === 'wants') {
      out.push({
        id: `drop-${row.categoryId}`,
        severity: 'positive',
        categoryId: row.categoryId,
        title: `${name(row.categoryId)} is down ${formatPct((base - row.total) / base)}`,
        detail: `You spent ${money(base - row.total)} less than usual in the last 30 days. Move that difference into savings so it doesn't drift elsewhere.`,
      });
    }
  }
  return out;
};

const smallPurchases: Rule = ({ ledger, last30, cats, asOf, money }) => {
  const reference = last30.income > 0 ? last30.income : last30.spending;
  if (reference === 0) return [];
  const threshold = reference * 0.01;
  const from = addDays(asOf, -29);
  const small = ledger.transactions.filter(
    (t) => t.date >= from && t.date <= asOf && groupOf(t, cats) === 'wants' && t.amount <= threshold,
  );
  const total = small.reduce((s, t) => s + t.amount, 0);
  if (small.length < 10 || total < last30.spending * 0.03) return [];
  return [
    {
      id: 'small-purchases',
      severity: 'warning',
      title: `${small.length} small purchases added up to ${money(total)}`,
      detail: `Individually under ${money(threshold)}, together they are ${formatPct(total / Math.max(last30.spending, 1))} of your spending in the last 30 days.`,
      action: `Halving them frees about ${money(total / 2)} a month. Invested at ${bpsToPct(ledger.settings.projectionReturnBps)} a year instead, that becomes roughly ${money(futureValue(0, total / 2, ledger.settings.projectionReturnBps, 120))} in 10 years. Try a fixed weekly allowance for snacks, rides and treats.`,
      impact: total / 2,
    },
  ];
};

const fiftyThirtyTwenty: Rule = ({ last30, money }) => {
  if (last30.income === 0) return [];
  const out: Insight[] = [];
  const wantsShare = last30.wants / last30.income;
  const needsShare = last30.needs / last30.income;
  if (wantsShare > 0.3) {
    out.push({
      id: 'wants-share',
      severity: 'warning',
      title: `Wants take ${formatPct(wantsShare)} of your income`,
      detail: 'A common guideline is at most 30% on wants, 50% on needs and at least 20% saved.',
      action: `Trimming wants to 30% frees ${money(last30.wants - last30.income * 0.3)} a month.`,
      impact: last30.wants - last30.income * 0.3,
    });
  }
  if (needsShare > 0.6) {
    out.push({
      id: 'needs-share',
      severity: 'info',
      title: `Essentials take ${formatPct(needsShare)} of your income`,
      detail: 'Fixed costs this high leave little room to save, however careful your daily spending is.',
      action: 'The biggest levers are usually rent, transport and loan terms — review one of them this quarter.',
    });
  }
  return out;
};

function avgMonthlyIn(ledger: Ledger, asOf: ISODate, categoryId: string, days = 90): number {
  const from = addDays(asOf, -(days - 1));
  const total = ledger.transactions
    .filter((t) => t.categoryId === categoryId && t.date >= from && t.date <= asOf)
    .reduce((s, t) => s + t.amount, 0);
  return (total / days) * 30;
}

const subscriptions: Rule = ({ ledger, asOf, money, historyDays }) => {
  const monthly = avgMonthlyIn(ledger, asOf, 'exp-subs', Math.min(90, Math.max(30, historyDays)));
  if (monthly <= 0) return [];
  return [
    {
      id: 'subscriptions',
      severity: 'info',
      categoryId: 'exp-subs',
      title: `Subscriptions cost about ${money(monthly)} a month`,
      detail: `That is ${money(monthly * 12)} a year on autopilot.`,
      action: 'List every subscription and cancel any you have not used in the past 30 days.',
    },
  ];
};

const fees: Rule = ({ last30, money }) => {
  const total = last30.expenseByCategory.find((r) => r.categoryId === 'exp-fees')?.total ?? 0;
  if (total <= 0 || total < last30.spending * 0.005) return [];
  return [
    {
      id: 'fees',
      severity: 'info',
      categoryId: 'exp-fees',
      title: `${money(total)} went to transaction fees in 30 days`,
      detail: 'Mobile money and bank charges are small per transfer but steady.',
      action: 'Batch transfers, pay merchants via till or paybill where it is free to you, and avoid repeated small withdrawals.',
      impact: total / 2,
    },
  ];
};

const weekendSpending: Rule = ({ ledger, cats, asOf, money }) => {
  let weekendTotal = 0;
  let weekdayTotal = 0;
  let weekendDays = 0;
  let weekdayDays = 0;
  for (let i = 0; i < 56; i += 1) {
    if (isWeekend(addDays(asOf, -i))) weekendDays += 1;
    else weekdayDays += 1;
  }
  const from = addDays(asOf, -55);
  for (const t of ledger.transactions) {
    if (t.date < from || t.date > asOf || groupOf(t, cats) !== 'wants') continue;
    if (isWeekend(t.date)) weekendTotal += t.amount;
    else weekdayTotal += t.amount;
  }
  const weekendAvg = weekendTotal / weekendDays;
  const weekdayAvg = weekdayTotal / weekdayDays;
  if (weekdayAvg <= 0 || weekendTotal === 0 || weekendAvg < weekdayAvg * 1.5) return [];
  const extraPerMonth = (weekendAvg - weekdayAvg) * 8.6;
  return [
    {
      id: 'weekends',
      severity: 'info',
      title: `Weekends cost ${(weekendAvg / weekdayAvg).toFixed(1)}× a weekday`,
      detail: `You average ${money(weekendAvg)} a day on wants at weekends versus ${money(weekdayAvg)} on weekdays.`,
      action: `Set a weekend budget before Friday. Closing half the gap saves about ${money(extraPerMonth / 2)} a month.`,
      impact: extraPerMonth / 2,
    },
  ];
};

const incomeMix: Rule = ({ ledger, asOf, money, name, historyDays }) => {
  if (historyDays < 45) return [];
  const s = windowSummary(ledger, asOf, 90, asOf);
  if (s.income === 0) return [];
  const out: Insight[] = [];
  const top = s.incomeBySource[0];
  if (top && top.total / s.income > 0.9 && s.incomeBySource.length >= 1) {
    out.push({
      id: 'income-concentration',
      severity: 'info',
      title: `${formatPct(top.total / s.income)} of your income comes from ${name(top.categoryId).toLowerCase()}`,
      detail: 'A single income source makes any disruption hit hard.',
      action: 'Build a small second stream — freelance work, a weekend gig or a skill you can sell — and log it here.',
    });
  }
  const variable = s.incomeBySource
    .filter((r) => r.categoryId === 'inc-tips' || r.categoryId === 'inc-jobs')
    .reduce((sum, r) => sum + r.total, 0);
  if (variable > 0) {
    out.push({
      id: 'variable-income',
      severity: 'info',
      title: `${money(variable / 3)} a month comes from tips and side jobs`,
      detail: 'Irregular income tends to disappear into everyday spending because it never feels budgeted.',
      action: 'Move tips and side-job money straight to savings the day you receive it, and live on your fixed income.',
      impact: variable / 3,
    });
  }
  return out;
};

const emergencyFund: Rule = ({ money, historyDays, wealth }) => {
  if (historyDays < 25 && !wealth.hasWealthData) return [];
  const monthlyNeeds = wealth.monthlyEssentials;
  if (monthlyNeeds <= 0) return [];
  const months = wealth.cushionMonths;
  const source = wealth.hasWealthData ? 'Cash, savings and money market funds' : 'Your savings';
  if (months >= 3) {
    return [
      {
        id: 'emergency-ok',
        severity: 'positive',
        title: `${source} cover ${months.toFixed(1)} months of essentials`,
        detail: 'You have a solid emergency cushion. Money beyond six months is better put to work in long-term investments.',
      },
    ];
  }
  const target = monthlyNeeds * 3;
  const saved = months * monthlyNeeds;
  return [
    {
      id: 'emergency-fund',
      severity: 'info',
      title: months < 0.5 ? 'You have no emergency cushion yet' : `${source} cover ${months.toFixed(1)} months of essentials`,
      detail: `Essentials cost you about ${money(monthlyNeeds)} a month. Three months of cover is ${money(target)}.`,
      action: `Setting aside ${money((target - saved) / 12)} a month gets you there in a year.`,
    },
  ];
};

// ---- Wealth rules ------------------------------------------------------------

const highCostDebt: Rule = ({ wealth, money }) => {
  const worst = wealth.highCostDebts[0];
  if (!worst) return [];
  const count = wealth.highCostDebts.length;
  const monthly = wealth.highCostDebts.reduce((s, l) => s + (l.balance * l.aprBps) / 10_000 / 12, 0);
  return [
    {
      id: 'high-cost-debt',
      severity: 'critical',
      title: `Expensive debt costs you about ${money(monthly)} a month`,
      detail: `${count === 1 ? worst.name : `${count} debts`} at ${bpsToPct(worst.aprBps)}${count > 1 ? ' or less' : ''} a year. No investment reliably beats that rate, so paying it off is the best return available to you.`,
      action: `Clear ${worst.name} first (highest rate)${count > 1 ? ', then the next' : ''}. Pause new investing beyond your starter cushion until it is gone.`,
      impact: monthly,
    },
  ];
};

const idleCash: Rule = ({ ledger, wealth, money }) => {
  if (!wealth.hasWealthData || wealth.monthlyEssentials <= 0) return [];
  const lowYield = ledger.assets
    .filter((a) => !a.archived && ASSET_TYPES[a.type].cls === 'cash' && a.expectedReturnBps < ledger.settings.inflationBps)
    .reduce((s, a) => s + a.value, 0);
  const surplus = wealth.liquid - wealth.monthlyEssentials * 6;
  const idle = Math.min(lowYield, surplus);
  if (idle <= wealth.monthlyEssentials) return [];
  const lossPerYear = (idle * ledger.settings.inflationBps) / 10_000;
  return [
    {
      id: 'idle-cash',
      severity: 'warning',
      title: `${money(idle)} is sitting idle beyond your emergency fund`,
      detail: `With inflation at about ${bpsToPct(ledger.settings.inflationBps)}, cash earning little or nothing loses roughly ${money(lossPerYear)} of buying power a year.`,
      action: 'Keep six months of essentials easy to reach and move the rest into interest-earning or long-term investments that suit your timeline.',
      impact: lossPerYear / 12,
    },
  ];
};

const concentration: Rule = ({ wealth, money }) => {
  const invested = wealth.byClass.income + wealth.byClass.growth + wealth.byClass.real;
  if (invested <= 0 || invested < wealth.monthlySpending * 6) return [];
  const top = (Object.entries(wealth.byClass) as Array<[AssetClass, number]>)
    .filter(([c]) => c !== 'cash')
    .sort((a, b) => b[1] - a[1])[0];
  if (!top) return [];
  const [cls, value] = top;
  const share = value / invested;
  if (share < 0.75) return [];
  return [
    {
      id: 'concentration',
      severity: 'info',
      title: `${formatPct(share)} of your investments are ${ASSET_CLASS_LABEL[cls].toLowerCase()} assets`,
      detail: `${money(value)} of ${money(invested)} sits in one kind of asset. A single bad year there would hit your whole net worth.`,
      action: 'Spread new money across different asset types — interest-earning, growth and real assets — so no single one decides your future.',
    },
  ];
};

const realReturns: Rule = ({ ledger, wealth }) => {
  // Only meaningful once there is real money at stake, not a small M-Pesa balance.
  if (wealth.assets <= 0 || wealth.assets < wealth.monthlySpending * 3) return [];
  const real = realReturnBps(wealth.weightedReturnBps, ledger.settings.inflationBps);
  if (real > 100) return [];
  return [
    {
      id: 'real-returns',
      severity: 'info',
      title:
        real < 0
          ? 'After inflation, your money is shrinking'
          : `After inflation your assets grow only about ${bpsToPct(real)} a year`,
      detail: `Your assumed average return is ${bpsToPct(wealth.weightedReturnBps)} against about ${bpsToPct(ledger.settings.inflationBps)} inflation.`,
      action: 'Wealth needs assets that out-grow inflation over time. Review where your long-term money sits, and keep your return assumptions up to date.',
    },
  ];
};

const passiveIncome: Rule = ({ wealth, money }) => {
  if (wealth.monthlyPassive <= 0 || wealth.monthlySpending <= 0) return [];
  const share = wealth.monthlyPassive / wealth.monthlySpending;
  return [
    {
      id: 'passive-income',
      severity: 'positive',
      title: `Your assets pay you ${money(wealth.monthlyPassive)} a month`,
      detail: `Interest, dividends and rent cover ${formatPct(share)} of your spending — money earned without working for it.`,
      action: share < 1 ? 'Reinvest it rather than spending it, and this share grows on its own.' : undefined,
    },
  ];
};

const netWorthTrend: Rule = ({ ledger, asOf, money }) => {
  const change = netWorthChange(ledger, 3, asOf);
  if (change === null || change === 0) return [];
  return [
    change > 0
      ? {
          id: 'net-worth-up',
          severity: 'positive',
          title: `Net worth up ${money(change)} recently`,
          detail: 'That is the number that measures wealth. Keep the monthly review going.',
        }
      : {
          id: 'net-worth-down',
          severity: 'warning',
          title: `Net worth down ${money(-change)} recently`,
          detail: 'Spending, new debt or falling asset values have outpaced what you added.',
          action: 'Check the Wealth page for which assets fell or which debts grew.',
        },
  ];
};

const payYourselfFirst: Rule = ({ last30, ledger, money }) => {
  if (last30.income === 0 || last30.saved > 0) return [];
  if (ledger.recurring.some((r) => r.active && r.categoryId === 'exp-savings')) return [];
  const suggested = (last30.income * ledger.settings.savingsTargetPct) / 100;
  return [
    {
      id: 'pay-yourself-first',
      severity: 'info',
      title: 'Pay yourself first',
      detail: 'Nothing has been moved to savings in the last 30 days. Saving what is left at month-end rarely works because little is left.',
      action: `Add a recurring "Savings & investments" entry of ${money(suggested)} on payday, and move the money the same day.`,
    },
  ];
};

const debtLoad: Rule = ({ last30, money }) => {
  if (last30.income === 0) return [];
  const debt = last30.expenseByCategory.find((r) => r.categoryId === 'exp-debt')?.total ?? 0;
  const share = debt / last30.income;
  if (share <= 0.3) return [];
  return [
    {
      id: 'debt-load',
      severity: 'warning',
      categoryId: 'exp-debt',
      title: `Loan repayments take ${formatPct(share)} of your income`,
      detail: `${money(debt)} in the last 30 days. Above about 30%, debt starts crowding out everything else.`,
      action: 'Avoid new borrowing, especially mobile loans, and pay off the highest-interest loan first.',
    },
  ];
};

const noSpendDays: Rule = ({ ledger, cats, asOf }) => {
  const start = startOfMonth(asOf);
  const spendDays = new Set(
    ledger.transactions
      .filter((t) => t.date >= start && t.date <= asOf && groupOf(t, cats) === 'wants')
      .map((t) => t.date),
  );
  const elapsed = parts(asOf).d;
  const free = elapsed - spendDays.size;
  if (elapsed < 7 || free < 5 || ledger.transactions.length === 0) return [];
  return [
    {
      id: 'no-spend-days',
      severity: 'positive',
      title: `${free} no-spend days this month`,
      detail: `You bought nothing non-essential on ${free} of the ${elapsed} days so far. Every one of those is money kept.`,
    },
  ];
};

const RULES: Rule[] = [
  highCostDebt,
  savingsRate,
  budgetPace,
  categoryTrends,
  smallPurchases,
  fiftyThirtyTwenty,
  debtLoad,
  payYourselfFirst,
  emergencyFund,
  incomeMix,
  subscriptions,
  fees,
  weekendSpending,
  noSpendDays,
  idleCash,
  concentration,
  realReturns,
  passiveIncome,
  netWorthTrend,
];

export function generateInsights(ledger: Ledger, asOf: ISODate = todayFn()): Insight[] {
  if (ledger.transactions.length === 0) {
    return [
      {
        id: 'getting-started',
        severity: 'info',
        title: 'Record a few days of activity to unlock insights',
        detail: 'Add your income and each expense as it happens. Tips get sharper after about a month of history.',
        action: 'Start with this month’s income, then log today’s spending.',
      },
    ];
  }
  const ctx = buildCtx(ledger, asOf);
  return RULES.flatMap((rule) => rule(ctx))
    .map((i) => (i.impact !== undefined ? { ...i, impact: Math.max(0, Math.round(i.impact)) } : i))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.impact ?? 0) - (a.impact ?? 0),
    );
}

export interface HealthPart {
  label: string;
  score: number;
  max: number;
  note: string;
}

export interface Health {
  score: number;
  parts: HealthPart[];
}

/** A 0–100 summary of financial habits over the last 30 days. Null until there is income to measure. */
export function healthScore(ledger: Ledger, asOf: ISODate = todayFn()): Health | null {
  const ctx = buildCtx(ledger, asOf);
  const s = ctx.last30;
  if (s.income === 0) return null;
  const target = Math.max(ledger.settings.savingsTargetPct / 100, 0.01);
  const rate = Math.max(0, s.savingsRate);

  const savingsPts = Math.min(1, rate / target) * 40;

  let budgetPts = 10;
  let budgetNote = 'Set budgets to score this';
  if (ledger.budgets.length > 0) {
    const onTrack = ledger.budgets.filter(
      (b) => (ctx.month.expenseByCategory.find((r) => r.categoryId === b.categoryId)?.total ?? 0) <= b.monthlyLimit,
    ).length;
    budgetPts = (onTrack / ledger.budgets.length) * 20;
    budgetNote = `${onTrack} of ${ledger.budgets.length} budgets on track`;
  }

  const months = wealthPicture(ledger, asOf).cushionMonths;
  const cushionPts = Math.min(1, months / 6) * 20;

  const wantsShare = s.wants / s.income;
  const wantsPts = Math.max(0, Math.min(1, (0.6 - wantsShare) / 0.3)) * 20;

  const parts: HealthPart[] = [
    { label: 'Savings rate', score: savingsPts, max: 40, note: `${formatPct(rate)} vs ${formatPct(target)} goal` },
    { label: 'Budgets', score: budgetPts, max: 20, note: budgetNote },
    { label: 'Emergency cushion', score: cushionPts, max: 20, note: `${months.toFixed(1)} of 6 months` },
    { label: 'Wants vs income', score: wantsPts, max: 20, note: `${formatPct(wantsShare)} on wants` },
  ];
  return { score: Math.round(parts.reduce((sum, p) => sum + p.score, 0)), parts };
}

/** Months of history covered, for UI copy. */
export function historyMonths(transactions: Transaction[], asOf: ISODate = todayFn()): number {
  if (transactions.length === 0) return 0;
  const earliest = transactions.reduce((m, t) => (t.date < m ? t.date : m), asOf);
  const a = parts(earliest);
  const b = parts(asOf);
  return (b.y - a.y) * 12 + (b.m - a.m) + 1;
}

