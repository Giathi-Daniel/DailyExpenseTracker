import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDate } from '../../core/dates';
import { formatMoney, formatPct, fractionDigits, toMajor } from '../../core/money';
import type { Bucket } from '../../core/reports';
import { Progress } from '../components/common';

const TOKENS = ['--series-1', '--series-2', '--series-3', '--series-4', '--grid', '--axis', '--text-2', '--text-3', '--surface-hover'] as const;
type Token = (typeof TOKENS)[number];

/**
 * SVG presentation attributes can't use CSS variables, so read the resolved
 * token values and re-read them whenever the theme changes.
 */
export function useThemeColors(): Record<Token, string> {
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(TOKENS.map((t) => [t, cs.getPropertyValue(t).trim() || '#888'])) as Record<Token, string>;
  };
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const update = () => setColors(read());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', update);
      obs.disconnect();
    };
  }, []);
  return colors;
}

interface SeriesDef {
  key: 'income' | 'spending' | 'saved' | 'net';
  label: string;
  color: string;
}

function ChartTooltip({
  active,
  payload,
  series,
  currency,
  title,
}: {
  active?: boolean;
  payload?: Array<{ payload: Bucket & { cumulative?: number } }>;
  series: SeriesDef[];
  currency: string;
  title: (b: Bucket) => string;
}) {
  const b = payload?.[0]?.payload;
  if (!active || !b) return null;
  return (
    <div className="chart-tooltip">
      <div>
        <strong>{title(b)}</strong>
      </div>
      {series.map((s) => (
        <div className="row" key={s.key}>
          <span>
            <i className="swatch" style={{ background: s.color }} />
            {s.label}
          </span>
          <span className="num">{formatMoney(s.key === 'net' ? (b.cumulative ?? b.net) : b[s.key], currency)}</span>
        </div>
      ))}
    </div>
  );
}

function bucketTitle(b: Bucket): string {
  return b.from === b.to ? formatDate(b.from, 'long') : `${formatDate(b.from)} – ${formatDate(b.to)}`;
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="legend" aria-hidden="true">
      {items.map((i) => (
        <span key={i.label}>
          <i className="swatch" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function useAxis(currency: string) {
  const c = useThemeColors();
  return {
    c,
    axisProps: {
      stroke: c['--axis'],
      tick: { fill: c['--text-3'], fontSize: 11 },
      tickLine: false,
    },
    yFormatter: (v: number) => formatMoney(Math.round(v * 10 ** fractionDigits(currency)), currency, { compact: true }),
  };
}

/** Income vs spending vs saved per bucket. Grouped bars on one axis. */
export function CashflowChart({ data, currency, height = 280 }: { data: Bucket[]; currency: string; height?: number }) {
  const { c, axisProps, yFormatter } = useAxis(currency);
  const series: SeriesDef[] = [
    { key: 'income', label: 'Income', color: c['--series-1'] },
    { key: 'spending', label: 'Spending', color: c['--series-2'] },
    { key: 'saved', label: 'Saved', color: c['--series-3'] },
  ];
  const rows = useMemo(
    () => data.map((b) => ({ ...b, incomeM: toMajor(b.income, currency), spendingM: toMajor(b.spending, currency), savedM: toMajor(b.saved, currency) })),
    [data, currency],
  );
  return (
    <figure className="stack" style={{ margin: 0, gap: 8, alignItems: 'stretch' }}>
      <Legend items={series} />
      <div style={{ height }} role="img" aria-label="Income, spending and savings over time. A table view is available below.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} barGap={2} barCategoryGap="22%" margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={c['--grid']} />
            <XAxis dataKey="label" {...axisProps} minTickGap={12} />
            <YAxis
              {...axisProps}
              axisLine={false}
              width={56}
              tickFormatter={yFormatter}
            />
            <Tooltip
              cursor={{ fill: c['--surface-hover'] }}
              content={<ChartTooltip series={series.slice(0, 3)} currency={currency} title={bucketTitle} />}
            />
            <Bar dataKey="incomeM" fill={series[0]!.color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            <Bar dataKey="spendingM" fill={series[1]!.color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            <Bar dataKey="savedM" fill={series[2]!.color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** Daily spending bars with the period average as a reference line. */
export function SpendingChart({
  data,
  currency,
  average,
  height = 240,
}: {
  data: Bucket[];
  currency: string;
  average: number;
  height?: number | string;
}) {
  const { c, axisProps, yFormatter } = useAxis(currency);
  const series: SeriesDef[] = [{ key: 'spending', label: 'Spending', color: c['--series-2'] }];
  const rows = useMemo(() => data.map((b) => ({ ...b, spendingM: toMajor(b.spending, currency) })), [data, currency]);
  return (
    <div style={{ height }} role="img" aria-label={`Spending per day. Average ${formatMoney(average, currency)} a day.`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} barCategoryGap="18%" margin={{ top: 16, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c['--grid']} />
          <XAxis dataKey="label" {...axisProps} minTickGap={16} />
          <YAxis
            {...axisProps}
            axisLine={false}
            width={56}
            tickFormatter={yFormatter}
          />
          <Tooltip cursor={{ fill: c['--surface-hover'] }} content={<ChartTooltip series={series} currency={currency} title={bucketTitle} />} />
          {average > 0 && (
            <ReferenceLine
              y={toMajor(average, currency)}
              stroke={c['--text-3']}
              strokeDasharray="4 4"
              label={{ value: `Avg ${formatMoney(average, currency, { compact: true })}`, position: 'insideTopRight', fill: c['--text-2'], fontSize: 11 }}
            />
          )}
          <Bar dataKey="spendingM" fill={series[0]!.color} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Account balance at the end of each bucket, stopping at today. */
export function BalanceChart({
  data,
  currency,
  opening,
  asOf,
  height = 240,
}: {
  data: Bucket[];
  currency: string;
  /** Balance at the start of the first bucket. */
  opening: number;
  asOf: string;
  height?: number;
}) {
  const { c, axisProps, yFormatter } = useAxis(currency);
  const rows = useMemo(() => {
    let run = opening;
    return data
      .filter((b) => b.from <= asOf)
      .map((b) => {
        run += b.net;
        return { ...b, cumulative: run, cumulativeM: toMajor(run, currency) };
      });
  }, [data, currency, opening, asOf]);
  const series: SeriesDef[] = [{ key: 'net', label: 'Balance', color: c['--series-1'] }];
  return (
    <div style={{ height }} role="img" aria-label="Account balance across the period.">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c['--grid']} />
          <XAxis dataKey="label" {...axisProps} minTickGap={16} />
          <YAxis {...axisProps} axisLine={false} width={56} tickFormatter={yFormatter} />
          <ReferenceLine y={0} stroke={c['--axis']} />
          <Tooltip cursor={{ stroke: c['--axis'] }} content={<ChartTooltip series={series} currency={currency} title={bucketTitle} />} />
          <Line
            dataKey="cumulativeM"
            stroke={series[0]!.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: c['--surface-hover'] }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ranked horizontal bars in HTML: crisp labels, keyboard-readable, no legend needed. */
export function Breakdown({
  rows,
  currency,
  total,
  limit = 8,
}: {
  rows: Array<{ id: string; label: string; value: number; note?: string }>;
  currency: string;
  total: number;
  limit?: number;
}) {
  const shown = rows.slice(0, limit);
  const rest = rows.slice(limit).reduce((s, r) => s + r.value, 0);
  const all = rest > 0 ? [...shown, { id: 'other', label: `${rows.length - limit} more`, value: rest }] : shown;
  const max = Math.max(1, ...all.map((r) => r.value));
  return (
    <div className="breakdown">
      {all.map((r) => (
        <div className="breakdown-row" key={r.id}>
          <span>
            {r.label}
            {'note' in r && r.note && <span className="subtle"> · {r.note}</span>}
          </span>
          <span className="num">
            {formatMoney(r.value, currency)} <span className="subtle">{formatPct(r.value / Math.max(total, 1))}</span>
          </span>
          <Progress value={r.value} max={max} />
        </div>
      ))}
    </div>
  );
}

/** Where income went: needs / wants / saved / left over, as one 100% bar. */
export function AllocationBar({
  income,
  needs,
  wants,
  saved,
  currency,
}: {
  income: number;
  needs: number;
  wants: number;
  saved: number;
  currency: string;
}) {
  const c = useThemeColors();
  const base = Math.max(income, needs + wants + saved, 1);
  const left = Math.max(0, income - needs - wants - saved);
  const parts = [
    { label: 'Needs', value: needs, color: c['--series-1'], guide: '50%' },
    { label: 'Wants', value: wants, color: c['--series-2'], guide: '30%' },
    { label: 'Saved', value: saved, color: c['--series-3'], guide: '20%' },
    { label: 'Unallocated', value: left, color: c['--surface-hover'], guide: '' },
  ];
  return (
    <div className="stack" style={{ alignItems: 'stretch' }}>
      <div
        role="img"
        aria-label={parts.map((p) => `${p.label} ${formatPct(p.value / base)}`).join(', ')}
        style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', gap: 2 }}
      >
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div key={p.label} title={`${p.label}: ${formatMoney(p.value, currency)}`} style={{ flex: p.value / base, background: p.color }} />
          ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, width: '100%' }}>
        {parts.map((p) => (
          <div key={p.label}>
            <div className="legend">
              <span>
                <i className="swatch" style={{ background: p.color }} />
                {p.label}
              </span>
            </div>
            <div className="num" style={{ fontWeight: 600, marginTop: 2 }}>
              {formatPct(p.value / base)}
            </div>
            <div className="subtle num">
              {formatMoney(p.value, currency, { compact: true })}
              {p.guide && ` · guide ${p.guide}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
