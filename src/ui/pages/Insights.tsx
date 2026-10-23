import { useMemo } from 'react';
import { today } from '../../core/dates';
import { generateInsights, healthScore, historyMonths, type Insight } from '../../core/insights';
import { formatMoney } from '../../core/money';
import { Card, MessageBar, Progress } from '../components/common';
import { Icon } from '../components/Icon';
import { useLedger } from '../store';

const SEVERITY_LABEL: Record<Insight['severity'], string> = {
  critical: 'Needs attention',
  warning: 'Warning',
  info: 'Tip',
  positive: 'Going well',
};

export function InsightRow({ insight, currency, compact }: { insight: Insight; currency: string; compact?: boolean }) {
  const icon = insight.severity;
  return (
    <article className="insight" data-severity={insight.severity}>
      <span className="insight-icon">
        <Icon name={icon} label={SEVERITY_LABEL[insight.severity]} />
      </span>
      <div>
        <h3>{insight.title}</h3>
        {!compact && <p>{insight.detail}</p>}
        {insight.action && <p className="action">{insight.action}</p>}
      </div>
      {!compact && insight.impact ? (
        <div className="impact">
          <strong className="num">{formatMoney(insight.impact, currency, { whole: true })}</strong>
          <span className="subtle">a month</span>
        </div>
      ) : (
        <span />
      )}
    </article>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  return (
    <svg className="score-ring" viewBox="0 0 96 96" role="img" aria-label={`Financial health score ${score} out of 100`}>
      <circle className="track" cx="48" cy="48" r={r} />
      <circle
        className="value"
        cx="48"
        cy="48"
        r={r}
        strokeDasharray={`${(score / 100) * c} ${c}`}
        transform="rotate(-90 48 48)"
      />
      <text x="48" y="57" textAnchor="middle">
        {score}
      </text>
    </svg>
  );
}

export function InsightsPage() {
  const { ledger, currency } = useLedger();
  const now = today();
  const insights = useMemo(() => generateInsights(ledger, now), [ledger, now]);
  const health = useMemo(() => healthScore(ledger, now), [ledger, now]);
  const potential = insights.reduce((s, i) => s + (i.impact ?? 0), 0);
  const months = historyMonths(ledger.transactions, now);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Insights</h1>
          <p className="muted">Tips generated from your own spending habits. Calculated on this device.</p>
        </div>
      </div>

      {months > 0 && months < 2 && (
        <MessageBar>
          You have {months === 1 ? 'one month' : 'less than a month'} of history. Trend-based tips appear once there are
          about two months to compare.
        </MessageBar>
      )}

      <div className="grid grid-halves">
        <Card title="Financial health">
          {health ? (
            <div className="score">
              <ScoreRing score={health.score} />
              <div className="score-parts">
                {health.parts.map((p) => (
                  <div key={p.label}>
                    <div className="score-part-head">
                      <span>{p.label}</span>
                      <span className="subtle">{p.note}</span>
                    </div>
                    <Progress
                      value={p.score}
                      max={p.max}
                      state={p.score / p.max >= 0.75 ? 'good' : p.score / p.max >= 0.4 ? 'warning' : 'critical'}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="muted">Record income for the last 30 days to calculate your score.</p>
          )}
        </Card>
        <Card title="Potential monthly savings">
          <div className="kpi">
            <span className="kpi-value num">{formatMoney(potential, currency, { whole: true })}</span>
            <span className="muted">
              Estimated money freed each month by acting on the tips below. Figures overlap, so treat the total as an
              upper bound.
            </span>
          </div>
        </Card>
      </div>

      <Card title={`${insights.length} insight${insights.length === 1 ? '' : 's'}`}>
        <div className="list">
          {insights.map((i) => (
            <InsightRow key={i.id} insight={i} currency={currency} />
          ))}
        </div>
      </Card>
    </div>
  );
}
