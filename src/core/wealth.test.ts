import { describe, expect, it } from 'vitest';
import { demoLedger, type Persona } from './demo';
import { generateInsights } from './insights';
import { emptyLedger, reduce } from './ledger';
import { parseLedger, type Ledger } from './schema';
import {
  futureValue,
  goalProgress,
  monthlyNeeded,
  monthsToTarget,
  projection,
  realReturnBps,
  roadmap,
  wealthPicture,
} from './wealth';

const AS_OF = '2026-10-23';

function withAsset(ledger: Ledger = emptyLedger(), value = 100_000): { ledger: Ledger; id: string } {
  const next = reduce(ledger, {
    type: 'asset/upsert',
    asset: { name: 'MMF', type: 'mmf', value, expectedReturnBps: 900 },
    asOf: AS_OF,
  });
  return { ledger: next, id: next.assets.at(-1)!.id };
}

describe('growth maths', () => {
  it('compounds monthly contributions', () => {
    expect(futureValue(0, 1000, 0, 12)).toBe(12_000);
    expect(futureValue(100_000, 0, 1200, 12)).toBeCloseTo(112_682.5, 0);
    // 1,000 a month for 10 years at 10% ≈ 204,845
    expect(Math.round(futureValue(0, 1000, 1000, 120))).toBe(204_845);
  });

  it('builds a yearly projection separating contributions from growth', () => {
    const p = projection(10_000, 1000, 1000, 3);
    expect(p).toHaveLength(4);
    expect(p[3]).toMatchObject({ year: 3, contributed: 46_000 });
    expect(p[3]!.value).toBeGreaterThan(p[3]!.contributed);
  });

  it('solves for time and monthly amount', () => {
    expect(monthsToTarget(0, 1000, 0, 12_000)).toBe(12);
    expect(monthsToTarget(50, 0, 0, 100)).toBeNull();
    expect(monthsToTarget(200, 0, 0, 100)).toBe(0);
    expect(monthlyNeeded(0, 12_000, 12)).toBe(1000);
    expect(monthlyNeeded(0, 12_000, 12, 1200)).toBeLessThan(1000);
    expect(monthlyNeeded(20_000, 12_000, 12)).toBe(0);
  });

  it('subtracts inflation from returns', () => {
    expect(realReturnBps(1000, 500)).toBe(476);
    expect(realReturnBps(300, 500)).toBeLessThan(0);
  });
});

describe('ledger keeps investments in sync with transactions', () => {
  const contribution = (assetId: string) =>
    ({ kind: 'expense', categoryId: 'exp-savings', date: AS_OF, amount: 25_000, note: 'Top up', assetId }) as const;

  it('adds, edits, deletes and restores contributions', () => {
    let { ledger, id } = withAsset();
    ledger = reduce(ledger, { type: 'tx/add', drafts: [contribution(id)], asOf: AS_OF });
    expect(ledger.assets[0]!.value).toBe(125_000);

    const tx = ledger.transactions[0]!;
    ledger = reduce(ledger, { type: 'tx/update', id: tx.id, patch: { amount: 40_000 }, asOf: AS_OF });
    expect(ledger.assets[0]!.value).toBe(140_000);

    ledger = reduce(ledger, { type: 'tx/delete', ids: [tx.id], asOf: AS_OF });
    expect(ledger.assets[0]!.value).toBe(100_000);

    ledger = reduce(ledger, { type: 'tx/restore', txs: [{ ...tx, amount: 40_000 }], asOf: AS_OF });
    expect(ledger.assets[0]!.value).toBe(140_000);
  });

  it('treats income linked to an asset as a withdrawal, never below zero', () => {
    let { ledger, id } = withAsset(undefined, 10_000);
    ledger = reduce(ledger, {
      type: 'tx/add',
      drafts: [{ kind: 'income', categoryId: 'inc-other', date: AS_OF, amount: 25_000, note: 'Withdrawal', assetId: id }],
      asOf: AS_OF,
    });
    expect(ledger.assets[0]!.value).toBe(0);
  });

  it('clears links when an asset is deleted', () => {
    let { ledger, id } = withAsset();
    ledger = reduce(ledger, { type: 'tx/add', drafts: [contribution(id)], asOf: AS_OF });
    ledger = reduce(ledger, {
      type: 'goal/upsert',
      goal: { name: 'Fund', target: 1_000_000, targetDate: null, assetIds: [id], manualSaved: 0 },
      asOf: AS_OF,
    });
    ledger = reduce(ledger, { type: 'asset/delete', id, asOf: AS_OF });
    expect(ledger.transactions[0]!.assetId).toBeUndefined();
    expect(ledger.goals[0]!.assetIds).toEqual([]);
  });

  it('records one net-worth reading per month', () => {
    let { ledger } = withAsset();
    ledger = reduce(ledger, {
      type: 'liability/upsert',
      liability: { name: 'Loan', type: 'personal', balance: 30_000, aprBps: 1800, minPayment: 0 },
      asOf: AS_OF,
    });
    expect(ledger.netWorthHistory).toEqual([{ month: '2026-10', assets: 100_000, liabilities: 30_000 }]);
    ledger = reduce(ledger, {
      type: 'wealth/review',
      assets: [{ id: ledger.assets[0]!.id, value: 150_000 }],
      liabilities: [],
      asOf: '2026-11-02',
    });
    expect(ledger.netWorthHistory.map((s) => s.month)).toEqual(['2026-10', '2026-11']);
    expect(ledger.netWorthHistory[1]!.assets).toBe(150_000);
  });
});

describe('schema migration', () => {
  it('upgrades version 1 data without losing anything', () => {
    const { assets: _a, liabilities: _l, goals: _g, netWorthHistory: _h, ...v1body } = emptyLedger();
    const v1 = {
      ...v1body,
      version: 1,
      categories: v1body.categories.filter((c) => !['inc-investment', 'inc-rental'].includes(c.id)),
      settings: { currency: 'KES', theme: 'system', savingsTargetPct: 20, autoLockMinutes: 10, weekStartsOn: 1 },
    };
    const upgraded = parseLedger(v1);
    expect(upgraded.version).toBe(2);
    expect(upgraded.assets).toEqual([]);
    expect(upgraded.categories.some((c) => c.id === 'inc-investment')).toBe(true);
    expect(upgraded.settings.projectionReturnBps).toBe(1000);
  });

  it('drops links to assets that do not exist', () => {
    const { ledger, id } = withAsset();
    const tampered = { ...ledger, goals: [{ id: 'g1', name: 'X', target: 10, targetDate: null, assetIds: [id, 'ghost'], manualSaved: 0, createdAt: AS_OF }] };
    expect(parseLedger(tampered).goals[0]!.assetIds).toEqual([id]);
  });
});

describe('goals', () => {
  it('measures progress from linked assets and works out the monthly amount', () => {
    const { ledger, id } = withAsset(undefined, 300_000);
    const p = goalProgress(
      { id: 'g', name: 'Deposit', target: 1_500_000, targetDate: '2027-10-23', assetIds: [id], manualSaved: 0, createdAt: AS_OF },
      ledger.assets,
      AS_OF,
    );
    expect(p.saved).toBe(300_000);
    expect(p.ratio).toBeCloseTo(0.2);
    expect(p.monthsLeft).toBe(12);
    expect(p.monthlyNeeded).toBe(100_000);
  });
});

describe('roadmap meets people where they are', () => {
  const step = (persona: Persona) => roadmap(demoLedger(AS_OF, persona), AS_OF).find((s) => s.state === 'current');

  it('puts a graduate with a Fuliza balance on clearing expensive debt', () => {
    const s = step('graduate');
    expect(s?.id).toBe('debt');
    expect(s?.action).toMatch(/Fuliza/);
  });

  it('puts a salaried professional on building long-term investments', () => {
    expect(step('professional')?.id).toBe('longterm');
  });

  it('puts an established investor on the road to financial independence', () => {
    expect(step('investor')?.id).toBe('freedom');
  });

  it('starts an empty ledger at the beginning', () => {
    const steps = roadmap(emptyLedger(), AS_OF);
    expect(steps[0]).toMatchObject({ id: 'numbers', state: 'current' });
    expect(steps.filter((s) => s.state === 'current')).toHaveLength(1);
  });
});

describe('wealth insights', () => {
  it('flags expensive debt as critical for the graduate', () => {
    const critical = generateInsights(demoLedger(AS_OF, 'graduate'), AS_OF).filter((i) => i.severity === 'critical');
    expect(critical.map((i) => i.id)).toContain('high-cost-debt');
  });

  it('celebrates passive income for the investor', () => {
    const ledger = demoLedger(AS_OF, 'investor');
    const ids = generateInsights(ledger, AS_OF).map((i) => i.id);
    expect(ids).toContain('passive-income');
    expect(wealthPicture(ledger, AS_OF).monthlyPassive).toBeGreaterThan(0);
  });

  it('tells the snack spender what the habit would grow into', () => {
    const small = generateInsights(demoLedger(AS_OF, 'professional'), AS_OF).find((i) => i.id === 'small-purchases');
    expect(small?.action).toMatch(/in 10 years/);
  });
});
