import { addDays, addMonths, diffDays, startOfMonth, today as todayFn, type ISODate } from './dates';
import { wealthTotals } from './ledger';
import { formatMoney, formatPct } from './money';
import { customPeriod, groupOf, indexCategories, summarize } from './reports';
import type { Asset, AssetType, Goal, Ledger, Liability, LiabilityType } from './schema';

/**
 * Wealth maths: net worth, debt cost, compound growth and a step-by-step roadmap.
 * All of it is educational arithmetic on the owner's own numbers and assumptions;
 * nothing here recommends a specific product.
 */

export type AssetClass = 'cash' | 'income' | 'growth' | 'real';

export const ASSET_TYPES: Record<
  AssetType,
  { label: string; cls: AssetClass; liquid: boolean; longTerm: boolean; defaultReturnBps: number; hint: string }
> = {
  cash: { label: 'Cash & mobile money', cls: 'cash', liquid: true, longTerm: false, defaultReturnBps: 0, hint: 'M-Pesa, wallet, current account' },
  savings: { label: 'Savings account', cls: 'cash', liquid: true, longTerm: false, defaultReturnBps: 300, hint: 'Bank savings, fixed deposit' },
  mmf: { label: 'Money market fund', cls: 'income', liquid: true, longTerm: false, defaultReturnBps: 800, hint: 'Low risk, withdraw in days' },
  sacco: { label: 'SACCO / chama', cls: 'income', liquid: false, longTerm: true, defaultReturnBps: 800, hint: 'Deposits and shares' },
  bonds: { label: 'Bonds & T-bills', cls: 'income', liquid: false, longTerm: true, defaultReturnBps: 900, hint: 'Government or corporate' },
  stocks: { label: 'Stocks & equity funds', cls: 'growth', liquid: false, longTerm: true, defaultReturnBps: 900, hint: 'Shares, ETFs, unit trusts' },
  retirement: { label: 'Pension / retirement', cls: 'growth', liquid: false, longTerm: true, defaultReturnBps: 800, hint: 'NSSF, personal pension' },
  property: { label: 'Property & land', cls: 'real', liquid: false, longTerm: true, defaultReturnBps: 500, hint: 'Value after any mortgage is a debt' },
  business: { label: 'Business', cls: 'real', liquid: false, longTerm: true, defaultReturnBps: 0, hint: 'Your share of what it is worth' },
  other: { label: 'Other', cls: 'growth', liquid: false, longTerm: true, defaultReturnBps: 0, hint: 'Anything else you own of value' },
};

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  cash: 'Cash',
  income: 'Interest-earning',
  growth: 'Growth',
  real: 'Property & business',
};

export const LIABILITY_TYPES: Record<LiabilityType, { label: string; defaultAprBps: number; hint: string }> = {
  mobile: { label: 'Mobile loan / overdraft', defaultAprBps: 6000, hint: 'Fuliza, M-Shwari, app loans' },
  credit: { label: 'Credit card', defaultAprBps: 3000, hint: '' },
  student: { label: 'Student loan', defaultAprBps: 400, hint: 'e.g. HELB' },
  personal: { label: 'Personal / bank loan', defaultAprBps: 1800, hint: 'Includes SACCO loans' },
  car: { label: 'Car loan', defaultAprBps: 1500, hint: '' },
  mortgage: { label: 'Mortgage', defaultAprBps: 1300, hint: '' },
  other: { label: 'Other debt', defaultAprBps: 1500, hint: 'Money owed to friends or family' },
};

/** Debt above this yearly rate costs more than investments can reliably earn. */
export const HIGH_COST_APR_BPS = 2000;

// ---- Growth maths ----------------------------------------------------------

/** Value after `months` of monthly compounding with a contribution at each month end. */
export function futureValue(principal: number, monthly: number, annualBps: number, months: number): number {
  const r = annualBps / 10_000 / 12;
  if (months <= 0) return principal;
  if (r === 0) return principal + monthly * months;
  const g = (1 + r) ** months;
  return principal * g + monthly * ((g - 1) / r);
}

export interface ProjectionPoint {
  year: number;
  /** Everything the owner put in, including the starting amount. */
  contributed: number;
  value: number;
}

export function projection(principal: number, monthly: number, annualBps: number, years: number): ProjectionPoint[] {
  const out: ProjectionPoint[] = [];
  for (let y = 0; y <= years; y += 1) {
    out.push({
      year: y,
      contributed: Math.round(principal + monthly * 12 * y),
      value: Math.round(futureValue(principal, monthly, annualBps, y * 12)),
    });
  }
  return out;
}

/** Months until `target` is reached, or null if it never is within 100 years. */
export function monthsToTarget(principal: number, monthly: number, annualBps: number, target: number): number | null {
  if (principal >= target) return 0;
  if (monthly <= 0 && annualBps <= 0) return null;
  const r = annualBps / 10_000 / 12;
  let value = principal;
  for (let m = 1; m <= 1200; m += 1) {
    value = value * (1 + r) + monthly;
    if (value >= target) return m;
  }
  return null;
}

/** Monthly amount needed to grow `current` into `target` within `months`. */
export function monthlyNeeded(current: number, target: number, months: number, annualBps = 0): number {
  if (current >= target) return 0;
  if (months <= 0) return target - current;
  const r = annualBps / 10_000 / 12;
  const g = (1 + r) ** months;
  const remaining = target - current * g;
  if (remaining <= 0) return 0;
  return Math.ceil(r === 0 ? remaining / months : (remaining * r) / (g - 1));
}

/** Return after inflation, in basis points: (1 + nominal) / (1 + inflation) − 1. */
export function realReturnBps(nominalBps: number, inflationBps: number): number {
  return Math.round(((1 + nominalBps / 10_000) / (1 + inflationBps / 10_000) - 1) * 10_000);
}

export function formatYears(months: number | null): string {
  if (months === null) return 'not within 100 years at this pace';
  if (months === 0) return 'already reached';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} month${m === 1 ? '' : 's'}`;
  return m === 0 ? `${y} year${y === 1 ? '' : 's'}` : `${y} yr ${m} mo`;
}

export const bpsToPct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

// ---- Picture of today ------------------------------------------------------

export interface WealthPicture {
  assets: number;
  liabilities: number;
  netWorth: number;
  /** Cash, savings and money market: reachable within days. */
  liquid: number;
  /** Long-term investments, property and business. */
  longTerm: number;
  byClass: Record<AssetClass, number>;
  /** Monthly averages over the last 90 days (or less history). */
  monthlyIncome: number;
  monthlySpending: number;
  monthlyEssentials: number;
  monthlyInvesting: number;
  monthlyPassive: number;
  /** Interest the debts cost per month at their stated rates. */
  monthlyInterest: number;
  highCostDebts: Liability[];
  /** Weighted assumed yearly return across assets, in basis points. */
  weightedReturnBps: number;
  /** Rule-of-thumb target: 25 × yearly spending (the "4% rule"). */
  freedomNumber: number;
  /** Months of essentials the liquid money covers. */
  cushionMonths: number;
  hasWealthData: boolean;
}

export function wealthPicture(ledger: Ledger, asOf: ISODate = todayFn()): WealthPicture {
  const active = ledger.assets.filter((a) => !a.archived);
  const { assets, liabilities } = wealthTotals(ledger);
  const byClass: Record<AssetClass, number> = { cash: 0, income: 0, growth: 0, real: 0 };
  let liquid = 0;
  let longTerm = 0;
  let weighted = 0;
  for (const a of active) {
    const meta = ASSET_TYPES[a.type];
    byClass[meta.cls] += a.value;
    if (meta.liquid) liquid += a.value;
    if (meta.longTerm) longTerm += a.value;
    weighted += a.value * a.expectedReturnBps;
  }

  // Average over whole calendar months so monthly items (salary, rent, investing)
  // are counted once per month however the window falls. Up to three months.
  const earliest = ledger.transactions.reduce<ISODate>((m, t) => (t.date < m ? t.date : m), asOf);
  const thisMonth = startOfMonth(asOf);
  let full = 0;
  while (full < 3 && addMonths(thisMonth, -(full + 1), 1) >= startOfMonth(earliest)) full += 1;
  const fromFull = addMonths(thisMonth, -full, 1);
  const window =
    full > 0
      ? summarize(ledger, customPeriod(fromFull, addDays(thisMonth, -1)), asOf)
      : summarize(ledger, customPeriod(addDays(asOf, -29), asOf), asOf);
  const months = full > 0 ? full : 1;
  const perMonth = (n: number) => Math.round(n / months);
  const passive = window.incomeBySource
    .filter((r) => r.categoryId === 'inc-investment' || r.categoryId === 'inc-rental')
    .reduce((s, r) => s + r.total, 0);

  const monthlySpending = perMonth(window.spending);
  const monthlyEssentials = perMonth(window.needs) || monthlySpending;
  const highCostDebts = ledger.liabilities
    .filter((l) => l.balance > 0 && l.aprBps >= HIGH_COST_APR_BPS)
    .sort((a, b) => b.aprBps - a.aprBps);

  // Without asset records, fall back to money logged under savings.
  const cats = indexCategories(ledger.categories);
  const savedViaTx = ledger.transactions
    .filter((t) => t.date <= asOf && groupOf(t, cats) === 'savings')
    .reduce((s, t) => s + t.amount, 0);
  const cushionBase = active.length > 0 ? liquid : savedViaTx;

  return {
    assets,
    liabilities,
    netWorth: assets - liabilities,
    liquid,
    longTerm,
    byClass,
    monthlyIncome: perMonth(window.income),
    monthlySpending,
    monthlyEssentials,
    monthlyInvesting: perMonth(window.saved),
    monthlyPassive: perMonth(passive),
    monthlyInterest: Math.round(ledger.liabilities.reduce((s, l) => s + (l.balance * l.aprBps) / 10_000 / 12, 0)),
    highCostDebts,
    weightedReturnBps: assets > 0 ? Math.round(weighted / assets) : 0,
    freedomNumber: monthlySpending * 12 * 25,
    cushionMonths: monthlyEssentials > 0 ? cushionBase / monthlyEssentials : 0,
    hasWealthData: active.length > 0 || ledger.liabilities.length > 0,
  };
}

/** Net worth change over the last n months of recorded history, or null without enough history. */
export function netWorthChange(ledger: Ledger, months: number, asOf: ISODate = todayFn()): number | null {
  const h = ledger.netWorthHistory;
  if (h.length < 2) return null;
  const target = addMonths(startOfMonth(asOf), -months, 1).slice(0, 7);
  const base = [...h].reverse().find((s) => s.month <= target) ?? h[0];
  const latest = h[h.length - 1];
  if (!base || !latest || base === latest) return null;
  return latest.assets - latest.liabilities - (base.assets - base.liabilities);
}

// ---- Goals -----------------------------------------------------------------

export interface GoalProgress {
  saved: number;
  ratio: number;
  remaining: number;
  monthsLeft: number | null;
  /** Monthly amount to finish on time, assuming no growth (conservative). */
  monthlyNeeded: number | null;
}

export function goalProgress(goal: Goal, assets: Asset[], asOf: ISODate = todayFn()): GoalProgress {
  const linked = assets.filter((a) => goal.assetIds.includes(a.id) && !a.archived).reduce((s, a) => s + a.value, 0);
  const saved = linked + goal.manualSaved;
  const remaining = Math.max(0, goal.target - saved);
  let monthsLeft: number | null = null;
  let needed: number | null = null;
  if (goal.targetDate) {
    monthsLeft = Math.max(0, Math.ceil(diffDays(asOf, goal.targetDate) / 30.44));
    needed = monthlyNeeded(saved, goal.target, Math.max(1, monthsLeft));
  }
  return { saved, ratio: Math.min(1, saved / goal.target), remaining, monthsLeft, monthlyNeeded: needed };
}

// ---- Roadmap ---------------------------------------------------------------

export type StepState = 'done' | 'current' | 'upcoming';

export interface RoadmapStep {
  id: string;
  title: string;
  /** Why this step matters, in one sentence. */
  why: string;
  state: StepState;
  /** 0–1 when measurable. */
  progress: number | null;
  /** What to do next, with the owner's own numbers. */
  action: string;
}

interface StepDef {
  id: string;
  title: string;
  why: string;
  done: boolean;
  progress: number | null;
  action: string;
}

/**
 * A ladder that works from any starting point: a graduate with nothing lands on
 * the first steps, someone already wealthy lands near the end and gets advice
 * about growing passive income instead of cutting snacks.
 */
export function roadmap(ledger: Ledger, asOf: ISODate = todayFn()): RoadmapStep[] {
  const p = wealthPicture(ledger, asOf);
  const cur = ledger.settings.currency;
  const money = (n: number) => formatMoney(Math.max(0, Math.round(n)), cur, { whole: true });
  const ret = ledger.settings.projectionReturnBps;
  const essentials = p.monthlyEssentials || Math.round(p.monthlyIncome * 0.5);
  const spending = p.monthlySpending || essentials;

  const hasIncome = ledger.transactions.some((t) => t.kind === 'income');

  // Investing habit: money set aside in each of the last two calendar months, or an automatic rule.
  const cats = indexCategories(ledger.categories);
  const monthsWithSaving = new Set(
    ledger.transactions.filter((t) => groupOf(t, cats) === 'savings' && t.date <= asOf).map((t) => t.date.slice(0, 7)),
  );
  const lastTwo = [1, 2].map((i) => addMonths(startOfMonth(asOf), -i, 1).slice(0, 7));
  const automatic = ledger.recurring.some(
    (r) => r.active && cats.get(r.categoryId)?.group === 'savings',
  );
  const habit = automatic || lastTwo.every((m) => monthsWithSaving.has(m));
  const starterTarget = essentials;
  const fullTarget = essentials * 3;
  const longTermTarget = spending * 12;
  const passiveTarget = spending * 0.25;
  const suggestedMonthly = Math.max(p.monthlyInvesting, Math.round(p.monthlyIncome * 0.1));

  const worst = p.highCostDebts[0];
  const defs: StepDef[] = [
    {
      id: 'numbers',
      title: 'Know your numbers',
      why: 'You cannot grow what you cannot see. Net worth is the score that matters, not your bank balance.',
      done: hasIncome && p.hasWealthData,
      progress: (Number(hasIncome) + Number(p.hasWealthData)) / 2,
      action: !hasIncome
        ? 'Record what came in this month — salary, side jobs, tips.'
        : 'List what you own and what you owe on the Wealth page, even if it is just your M-Pesa balance.',
    },
    {
      id: 'debt',
      title: 'Clear expensive debt',
      why: `Debt above ${bpsToPct(HIGH_COST_APR_BPS)} a year costs more than investing can reliably earn. Paying it off is a guaranteed return.`,
      done: p.highCostDebts.length === 0,
      progress: null,
      action: worst
        ? `Pay off ${worst.name} first: it costs about ${money((worst.balance * worst.aprBps) / 10_000 / 12)} a month at ${bpsToPct(worst.aprBps)}. Pay minimums on everything else and put every extra shilling here. Avoid new mobile loans.`
        : 'No expensive debt. Keep it that way: avoid mobile loans and overdrafts for spending.',
    },
    {
      id: 'starter',
      title: 'Starter cushion: one month of essentials',
      why: 'A small buffer stops the next emergency from becoming a loan.',
      done: starterTarget > 0 && p.liquid >= starterTarget,
      progress: starterTarget > 0 ? Math.min(1, p.liquid / starterTarget) : null,
      action:
        starterTarget > 0
          ? `Set aside ${money(starterTarget - p.liquid)} more in a savings account or money market fund — ${money(monthlyNeeded(p.liquid, starterTarget, 6))} a month gets you there in 6 months.`
          : 'Record a month of spending so your essentials can be measured.',
    },
    {
      id: 'habit',
      title: 'Invest every month, automatically',
      why: 'Wealth is built by the habit, not the amount. Small sums invested early beat large sums invested late.',
      done: habit,
      progress: automatic ? 1 : lastTwo.filter((m) => monthsWithSaving.has(m)).length / 2,
      action: `Pay yourself first: move ${money(suggestedMonthly || 1000)} on payday into an investment and set it as a recurring entry. ${
        suggestedMonthly > 0
          ? `At ${bpsToPct(ret)} a year that grows to about ${money(futureValue(0, suggestedMonthly, ret, 120))} in 10 years.`
          : ''
      }`.trim(),
    },
    {
      id: 'cushion',
      title: 'Full emergency fund: three months',
      why: 'Three to six months of essentials lets you survive a job loss without selling investments or borrowing.',
      done: fullTarget > 0 && p.liquid >= fullTarget,
      progress: fullTarget > 0 ? Math.min(1, p.liquid / fullTarget) : null,
      action:
        fullTarget > 0
          ? `You have ${p.cushionMonths.toFixed(1)} months covered. ${money(monthlyNeeded(p.liquid, fullTarget, 12))} a month reaches three months (${money(fullTarget)}) within a year.`
          : 'Record your spending so the target can be measured.',
    },
    {
      id: 'longterm',
      title: 'Build long-term investments',
      why: 'Money beyond your emergency fund should work for you in assets that grow faster than inflation.',
      done: longTermTarget > 0 && p.longTerm >= longTermTarget,
      progress: longTermTarget > 0 ? Math.min(1, p.longTerm / longTermTarget) : null,
      action:
        longTermTarget > 0
          ? `First milestone: one year of spending (${money(longTermTarget)}) in long-term assets. At ${money(suggestedMonthly)} a month and ${bpsToPct(ret)} a year you get there in ${formatYears(monthsToTarget(p.longTerm, suggestedMonthly, ret, longTermTarget))}. Spread it across more than one type of asset.`
          : 'Record your spending so the milestone can be measured.',
    },
    {
      id: 'passive',
      title: 'Make your money pay you',
      why: 'The wealthy measure how much of their life their assets pay for, not how little they spend.',
      done: passiveTarget > 0 && p.monthlyPassive >= passiveTarget,
      progress: passiveTarget > 0 ? Math.min(1, p.monthlyPassive / passiveTarget) : null,
      action: `Interest, dividends and rent cover ${formatPct(spending > 0 ? p.monthlyPassive / spending : 0)} of your spending. Reinvest them instead of spending them, and record them under "Interest & dividends" so this is tracked. Target: a quarter of your spending (${money(passiveTarget)} a month).`,
    },
    {
      id: 'freedom',
      title: 'Financial independence',
      why: 'When investments reach about 25 times your yearly spending, work becomes optional (the 4% rule of thumb).',
      done: p.freedomNumber > 0 && p.longTerm + p.byClass.income >= p.freedomNumber,
      progress: p.freedomNumber > 0 ? Math.min(1, (p.longTerm + p.byClass.income) / p.freedomNumber) : null,
      action:
        p.freedomNumber > 0
          ? `Your number is ${money(p.freedomNumber)}. At ${money(suggestedMonthly)} a month and ${bpsToPct(ret)} a year you reach it in ${formatYears(monthsToTarget(p.longTerm + p.byClass.income, suggestedMonthly, ret, p.freedomNumber))}. Raising what you invest moves this date more than anything else.`
          : 'Record your spending to see your number.',
    },
  ];

  let currentFound = false;
  return defs.map((d) => {
    let state: StepState = 'upcoming';
    if (d.done) state = 'done';
    else if (!currentFound) {
      state = 'current';
      currentFound = true;
    }
    return { id: d.id, title: d.title, why: d.why, state, progress: d.progress, action: d.action };
  });
}

export function currentStep(steps: RoadmapStep[]): RoadmapStep | undefined {
  return steps.find((s) => s.state === 'current');
}
