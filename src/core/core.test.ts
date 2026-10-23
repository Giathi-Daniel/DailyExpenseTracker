import { describe, expect, it } from 'vitest';
import { csvCell, transactionsToCsv } from './csv';
import { addMonths, endOfQuarter, startOfWeek } from './dates';
import { demoLedger } from './demo';
import { generateInsights, healthScore } from './insights';
import { emptyLedger, mergeLedgers, nextOccurrence, postDueRecurring, reduce } from './ledger';
import { formatMoney, parseAmount, toInputValue } from './money';
import { parseMpesa } from './mpesa';
import { balanceAsOf, customPeriod, periodFor, shiftPeriod, summarize, timeSeries } from './reports';
import { Ledger, parseLedger, type RecurringRule } from './schema';

const withTx = (...rows: Array<[kind: 'income' | 'expense', cat: string, date: string, amount: number]>) =>
  reduce(emptyLedger(), {
    type: 'tx/add',
    drafts: rows.map(([kind, categoryId, date, amount]) => ({ kind, categoryId, date, amount, note: '' })),
  });

describe('money', () => {
  it('parses user input into integer minor units without float error', () => {
    expect(parseAmount('1,250.50', 'KES')).toBe(125050);
    expect(parseAmount('0.1', 'USD')).toBe(10);
    expect(parseAmount('Ksh 300', 'KES')).toBe(30000);
    expect(parseAmount('500', 'JPY')).toBe(500);
  });
  it('rejects invalid amounts', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '0', '1e5', '12.5.1']) expect(parseAmount(bad, 'KES')).toBeNull();
    expect(parseAmount('1.5', 'JPY')).toBeNull();
  });
  it('round-trips to input strings', () => {
    expect(toInputValue(125050, 'KES')).toBe('1250.50');
    expect(toInputValue(5, 'USD')).toBe('0.05');
    expect(toInputValue(-30000, 'KES')).toBe('-300.00');
  });
  it('formats currency', () => {
    expect(formatMoney(125050, 'USD')).toMatch(/1,250\.50/);
  });
});

describe('dates', () => {
  it('clamps month arithmetic to the end of short months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });
  it('finds period boundaries', () => {
    expect(endOfQuarter('2026-08-09')).toBe('2026-09-30');
    expect(startOfWeek('2026-10-23', 1)).toBe('2026-10-19');
    expect(startOfWeek('2026-10-23', 0)).toBe('2026-10-18');
  });
});

describe('reports', () => {
  const ledger = withTx(
    ['income', 'inc-salary', '2026-10-01', 10_000_00],
    ['income', 'inc-tips', '2026-10-04', 500_00],
    ['expense', 'exp-rent', '2026-10-02', 3_000_00],
    ['expense', 'exp-dining', '2026-10-05', 1_500_00],
    ['expense', 'exp-savings', '2026-10-06', 2_000_00],
    ['expense', 'exp-food', '2026-09-30', 999_00],
  );

  it('summarises a month, treating savings transfers as kept money', () => {
    const s = summarize(ledger, periodFor('month', '2026-10-15'), '2026-10-31');
    expect(s.income).toBe(10_500_00);
    expect(s.needs).toBe(3_000_00);
    expect(s.wants).toBe(1_500_00);
    expect(s.saved).toBe(2_000_00);
    expect(s.spending).toBe(4_500_00);
    expect(s.kept).toBe(6_000_00);
    expect(s.savingsRate).toBeCloseTo(6000 / 10500);
    expect(s.incomeBySource[0]?.categoryId).toBe('inc-salary');
  });

  it('produces a complete daily series with empty days included', () => {
    const series = timeSeries(ledger, periodFor('month', '2026-10-01'));
    expect(series).toHaveLength(31);
    expect(series[1]?.spending).toBe(3_000_00);
    expect(series[5]?.saved).toBe(2_000_00);
  });

  it('shifts periods by calendar units', () => {
    expect(shiftPeriod(periodFor('quarter', '2026-02-01'), -1)).toMatchObject({ from: '2025-10-01', to: '2025-12-31' });
    expect(shiftPeriod(customPeriod('2026-10-01', '2026-10-10'), 1)).toMatchObject({ from: '2026-10-11', to: '2026-10-20' });
  });

  it('computes running balance', () => {
    expect(balanceAsOf(ledger, '2026-10-31')).toBe(10_500_00 - 3_000_00 - 1_500_00 - 2_000_00 - 999_00);
  });
});

describe('recurring entries', () => {
  const rule = (over: Partial<RecurringRule> = {}): RecurringRule => ({
    id: 'r1',
    kind: 'income',
    amount: 5000,
    categoryId: 'inc-salary',
    note: 'Salary',
    frequency: 'monthly',
    startDate: '2026-07-31',
    lastPosted: null,
    active: true,
    ...over,
  });

  it('posts missed occurrences once, keeping month-end anchors', () => {
    const ledger = { ...emptyLedger(), recurring: [rule()] };
    const first = postDueRecurring(ledger, '2026-10-23');
    expect(first.posted).toBe(3);
    expect(first.ledger.transactions.map((t) => t.date)).toEqual(['2026-07-31', '2026-08-31', '2026-09-30']);
    expect(postDueRecurring(first.ledger, '2026-10-23').posted).toBe(0);
    expect(nextOccurrence(first.ledger.recurring[0]!, '2026-10-23')).toBe('2026-10-31');
  });

  it('skips paused rules and supports weekly schedules', () => {
    expect(postDueRecurring({ ...emptyLedger(), recurring: [rule({ active: false })] }, '2026-10-23').posted).toBe(0);
    const weekly = postDueRecurring(
      { ...emptyLedger(), recurring: [rule({ frequency: 'weekly', startDate: '2026-10-02' })] },
      '2026-10-23',
    );
    expect(weekly.posted).toBe(4);
  });
});

describe('schema validation', () => {
  it('rejects tampered data', () => {
    const bad = { ...emptyLedger(), transactions: [{ id: '<script>', amount: -1 }] };
    expect(() => parseLedger(bad)).toThrow();
    expect(() => parseLedger({ ...emptyLedger(), version: 99 })).toThrow();
  });
  it('drops rows that reference unknown categories', () => {
    const ledger = withTx(['expense', 'exp-food', '2026-10-01', 100]);
    const tampered = { ...ledger, transactions: [{ ...ledger.transactions[0]!, categoryId: 'ghost' }] };
    expect(parseLedger(tampered).transactions).toHaveLength(0);
  });
  it('accepts the demo data set', () => {
    expect(() => Ledger.parse(demoLedger('2026-10-23'))).not.toThrow();
  });
});

describe('merge', () => {
  it('does not duplicate transactions or references', () => {
    const a = withTx(['expense', 'exp-food', '2026-10-01', 100]);
    const merged = mergeLedgers(a, a);
    expect(merged.added).toBe(0);
    expect(merged.ledger.transactions).toHaveLength(1);
  });
});

describe('csv export', () => {
  it('neutralises formula injection and quotes delimiters', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+254700')).toBe("'+254700");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(-12.5)).toBe('-12.5');
  });
  it('writes signed amounts', () => {
    const ledger = withTx(['expense', 'exp-food', '2026-10-01', 12345]);
    expect(transactionsToCsv(ledger, ledger.transactions).split('\r\n')[1]).toContain(',-123.45,KES,');
  });
});

describe('M-Pesa import', () => {
  const sms = `
TJN1ABC2DE Confirmed. Ksh1,250.00 paid to NAIVAS WESTLANDS. on 5/10/26 at 1:05 PM.New M-PESA balance is Ksh3,450.00. Transaction cost, Ksh0.00.
TJN1ABC2DF Confirmed. Ksh2,000.00 sent to JOHN DOE 0712345678 on 6/10/26 at 7:42 PM. New M-PESA balance is Ksh1,450.00. Transaction cost, Ksh33.00. Amount you can transact within the day is 496,000.00.
TJN1ABC2DG Confirmed.You have received Ksh5,500.50 from JANE WANJIRU 0722000000 on 7/10/26 at 4:10 PM New M-PESA balance is Ksh6,950.50.
TJN1ABC2DH Confirmed. Ksh1,800.00 sent to KPLC PREPAID for account 37123456789 on 8/10/26 at 8:00 AM New M-PESA balance is Ksh5,150.50. Transaction cost, Ksh0.00.
TJN1ABC2DJ Confirmed.on 9/10/26 at 6:30 PMWithdraw Ksh3,000.00 from 123456 - SHOP AGENT New M-PESA balance is Ksh2,150.50. Transaction cost, Ksh29.00.
TJN1ABC2DK confirmed.You bought Ksh100.00 of airtime on 10/10/26 at 9:15 AM.New M-PESA balance is Ksh2,050.50.
TJN1ABC2DE Confirmed. Ksh1,250.00 paid to NAIVAS WESTLANDS. on 5/10/26 at 1:05 PM.
TJN1ABC2DZ Confirmed. Something we do not understand.`;

  it('reads each message type', () => {
    const { entries, skipped } = parseMpesa(sms);
    expect(skipped).toBe(1);
    expect(entries.map((e) => [e.ref, e.kind, e.amount, e.date, e.categoryId])).toEqual([
      ['TJN1ABC2DE', 'expense', 125000, '2026-10-05', 'exp-food'],
      ['TJN1ABC2DF', 'expense', 200000, '2026-10-06', 'exp-other'],
      ['TJN1ABC2DG', 'income', 550050, '2026-10-07', 'inc-other'],
      ['TJN1ABC2DH', 'expense', 180000, '2026-10-08', 'exp-utilities'],
      ['TJN1ABC2DJ', 'expense', 300000, '2026-10-09', 'exp-other'],
      ['TJN1ABC2DK', 'expense', 10000, '2026-10-10', 'exp-airtime'],
    ]);
  });
  it('captures fees and strips phone numbers from notes', () => {
    const { entries } = parseMpesa(sms);
    const sent = entries.find((e) => e.ref === 'TJN1ABC2DF');
    expect(sent?.fee).toBe(3300);
    expect(sent?.note).toBe('To JOHN DOE');
    expect(entries.find((e) => e.kind === 'income')?.note).toBe('From JANE WANJIRU');
  });
});

describe('insights', () => {
  it('guides new users', () => {
    expect(generateInsights(emptyLedger())[0]?.id).toBe('getting-started');
  });

  it('flags overspending as critical and puts it first', () => {
    const ledger = withTx(['income', 'inc-salary', '2026-10-01', 1_000_00], ['expense', 'exp-rent', '2026-10-02', 2_000_00]);
    const insights = generateInsights(ledger, '2026-10-20');
    expect(insights[0]).toMatchObject({ id: 'overspending', severity: 'critical', impact: 1_000_00 });
  });

  it('warns when a budget is on pace to be exceeded', () => {
    let ledger = withTx(['income', 'inc-salary', '2026-10-01', 100_000_00], ['expense', 'exp-dining', '2026-10-05', 4_000_00]);
    ledger = reduce(ledger, { type: 'budget/set', categoryId: 'exp-dining', monthlyLimit: 6_000_00 });
    const pace = generateInsights(ledger, '2026-10-10').find((i) => i.id === 'budget-pace-exp-dining');
    expect(pace?.severity).toBe('warning');
    expect(pace?.action).toMatch(/a day for the remaining 21 days/);
  });

  it('produces a rich, ordered set from realistic history', () => {
    const insights = generateInsights(demoLedger('2026-10-23'), '2026-10-23');
    const ids = insights.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['small-purchases', 'subscriptions', 'variable-income']));
    const order = { critical: 0, warning: 1, info: 2, positive: 3 } as const;
    for (let i = 1; i < insights.length; i += 1) {
      expect(order[insights[i]!.severity]).toBeGreaterThanOrEqual(order[insights[i - 1]!.severity]);
    }
  });

  it('scores financial health from 0 to 100', () => {
    const health = healthScore(demoLedger('2026-10-23'), '2026-10-23');
    expect(health).not.toBeNull();
    expect(health!.score).toBeGreaterThanOrEqual(0);
    expect(health!.score).toBeLessThanOrEqual(100);
    expect(healthScore(emptyLedger())).toBeNull();
  });
});
