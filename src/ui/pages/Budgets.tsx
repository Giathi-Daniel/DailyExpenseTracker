import { useMemo, useState } from 'react';
import { addDays, daysInMonth, formatMonth, parts, today } from '../../core/dates';
import { parseAmount, toInputValue } from '../../core/money';
import { customPeriod, periodFor, summarize } from '../../core/reports';
import type { Category } from '../../core/schema';
import { Card, Money, Progress } from '../components/common';
import { useLedger } from '../store';
import { useToast } from '../toast';

function BudgetInput({
  category,
  limit,
  suggestion,
  onSave,
  currency,
}: {
  category: Category;
  limit: number | undefined;
  suggestion: number;
  onSave: (value: number | null) => void;
  currency: string;
}) {
  const [value, setValue] = useState(limit ? toInputValue(limit, currency) : '');
  const [invalid, setInvalid] = useState(false);
  const commit = (raw: string) => {
    if (raw.trim() === '') {
      setInvalid(false);
      if (limit) onSave(null);
      return;
    }
    const minor = parseAmount(raw, currency);
    setInvalid(minor === null);
    if (minor !== null && minor !== limit) onSave(minor);
  };
  return (
    <label className="field">
      <span className="sr-only">Monthly budget for {category.name}</span>
      <input
        className="input num"
        inputMode="decimal"
        placeholder={suggestion > 0 ? `Suggested ${toInputValue(suggestion, currency).replace(/\.\d+$/, '')}` : 'No budget'}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
      />
    </label>
  );
}

export function BudgetsPage() {
  const { ledger, dispatch, currency } = useLedger();
  const notify = useToast();
  const now = today();
  const { y, m, d } = parts(now);
  const dim = daysInMonth(y, m);

  const data = useMemo(() => {
    const month = summarize(ledger, periodFor('month', now), now);
    // Suggest budgets from the average of the previous 90 days, rounded to a tidy number.
    const history = summarize(ledger, customPeriod(addDays(now, -90 - d + 1), addDays(now, -d)), now);
    const suggest = new Map(
      history.expenseByCategory.map((r) => {
        const monthly = (r.total / 90) * 30;
        const step = monthly > 1_000_000 ? 100_000 : 10_000;
        return [r.categoryId, Math.ceil(monthly / step) * step];
      }),
    );
    return { month, suggest };
  }, [ledger, now, d]);

  const categories = ledger.categories.filter((c) => c.kind === 'expense' && c.group !== 'savings' && !c.archived);
  const limits = new Map(ledger.budgets.map((b) => [b.categoryId, b.monthlyLimit]));
  const budgeted = ledger.budgets.reduce((s, b) => s + b.monthlyLimit, 0);
  const spentInBudgeted = ledger.budgets.reduce(
    (s, b) => s + (data.month.expenseByCategory.find((r) => r.categoryId === b.categoryId)?.total ?? 0),
    0,
  );

  const applySuggestions = () => {
    let n = 0;
    for (const c of categories) {
      const s = data.suggest.get(c.id);
      if (s && !limits.has(c.id)) {
        dispatch({ type: 'budget/set', categoryId: c.id, monthlyLimit: s });
        n += 1;
      }
    }
    notify(n ? `Added ${n} budget${n === 1 ? '' : 's'} from your recent spending.` : 'No new suggestions — record more history first.');
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Budgets</h1>
          <p className="muted">
            Monthly limits for {formatMonth(now)}. {dim - d} days left.
          </p>
        </div>
        <button type="button" className="btn" onClick={applySuggestions}>
          Suggest from my spending
        </button>
      </div>

      <div className="grid grid-kpi">
        <div className="card kpi">
          <span className="kpi-label">Budgeted this month</span>
          <span className="kpi-value">
            <Money value={budgeted} currency={currency} />
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Spent in budgeted categories</span>
          <span className="kpi-value">
            <Money value={spentInBudgeted} currency={currency} />
          </span>
          <Progress
            value={spentInBudgeted}
            max={Math.max(budgeted, 1)}
            state={spentInBudgeted > budgeted ? 'critical' : spentInBudgeted > (budgeted * d) / dim ? 'warning' : 'good'}
          />
        </div>
        <div className="card kpi">
          <span className="kpi-label">Safe to spend per day</span>
          <span className="kpi-value">
            <Money value={Math.max(0, Math.floor((budgeted - spentInBudgeted) / Math.max(1, dim - d + 1)))} currency={currency} />
          </span>
          <span className="kpi-foot">Across budgeted categories, for the rest of the month</span>
        </div>
      </div>

      <Card title="Categories">
        <div>
          {categories.map((c) => {
            const spent = data.month.expenseByCategory.find((r) => r.categoryId === c.id)?.total ?? 0;
            const limit = limits.get(c.id);
            const projected = d > 0 ? Math.round((spent / d) * dim) : spent;
            const state = !limit ? undefined : spent > limit ? 'critical' : projected > limit ? 'warning' : 'good';
            return (
              <div className="budget-row" key={c.id}>
                <div>
                  <div>{c.name}</div>
                  <div className="subtle">{c.group === 'needs' ? 'Need' : 'Want'}</div>
                </div>
                <div>
                  <div className="score-part-head">
                    <span className="num">
                      <Money value={spent} currency={currency} />
                      {limit && (
                        <span className="muted">
                          {' '}
                          of <Money value={limit} currency={currency} />
                        </span>
                      )}
                    </span>
                    {limit && (
                      <span className={`subtle ${state === 'critical' ? 'neg' : ''}`}>
                        {spent > limit ? (
                          <>
                            <Money value={spent - limit} currency={currency} /> over
                          </>
                        ) : (
                          <>
                            <Money value={limit - spent} currency={currency} /> left
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  {limit ? <Progress value={spent} max={limit} state={state} /> : <div className="subtle">No budget set</div>}
                </div>
                <BudgetInput
                  key={`${c.id}-${limit ?? 0}`}
                  category={c}
                  limit={limit}
                  suggestion={data.suggest.get(c.id) ?? 0}
                  currency={currency}
                  onSave={(v) => {
                    dispatch({ type: 'budget/set', categoryId: c.id, monthlyLimit: v });
                    notify(v ? `${c.name} budget saved.` : `${c.name} budget removed.`);
                  }}
                />
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
