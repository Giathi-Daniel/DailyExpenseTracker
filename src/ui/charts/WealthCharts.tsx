import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMonth } from '../../core/dates';
import { formatMoney, formatPct, toMajor } from '../../core/money';
import type { Snapshot } from '../../core/schema';
import type { ProjectionPoint } from '../../core/wealth';
import { Legend, useAxis, useThemeColors } from './Charts';

/** Axis ticks: compact numbers with a sign and no currency code, so negatives never clip. */
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const axisNumber = (v: number) => compact.format(v);

interface TipRow {
  label: string;
  value: number;
  color?: string;
}

function Tip({ active, title, rows, currency }: { active?: boolean; title: string; rows: TipRow[]; currency: string }) {
  if (!active) return null;
  return (
    <div className="chart-tooltip">
      <div>
        <strong>{title}</strong>
      </div>
      {rows.map((r) => (
        <div className="row" key={r.label}>
          <span>
            {r.color && <i className="swatch" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="num">{formatMoney(r.value, currency)}</span>
        </div>
      ))}
    </div>
  );
}

/** Net worth by month. One series, so no legend: the card title names it. */
export function NetWorthChart({ history, currency, height = 260 }: { history: Snapshot[]; currency: string; height?: number }) {
  const { c, axisProps } = useAxis(currency);
  const rows = useMemo(
    () =>
      history.map((s) => ({
        ...s,
        label: formatMonth(`${s.month}-01`, 'short'),
        net: s.assets - s.liabilities,
        netM: toMajor(s.assets - s.liabilities, currency),
      })),
    [history, currency],
  );
  const anyNegative = rows.some((r) => r.net < 0);
  return (
    <div style={{ height }} role="img" aria-label="Net worth by month.">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c['--grid']} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} axisLine={false} width={52} tickFormatter={axisNumber} domain={['auto', 'auto']} />
          {anyNegative && <ReferenceLine y={0} stroke={c['--axis']} />}
          <Tooltip
            cursor={{ stroke: c['--axis'] }}
            content={({ active, payload }) => {
              const r = payload?.[0]?.payload as (typeof rows)[number] | undefined;
              return r ? (
                <Tip
                  active={active}
                  currency={currency}
                  title={formatMonth(`${r.month}-01`)}
                  rows={[
                    { label: 'Net worth', value: r.net, color: c['--series-1'] },
                    { label: 'Assets', value: r.assets },
                    { label: 'Debts', value: r.liabilities },
                  ]}
                />
              ) : null;
            }}
          />
          <Line
            dataKey="netM"
            stroke={c['--series-1']}
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 0, fill: c['--series-1'] }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: c['--surface-hover'] }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Projected value vs. money put in: the gap between the lines is compound growth. */
export function GrowthChart({ points, currency, height = 280 }: { points: ProjectionPoint[]; currency: string; height?: number }) {
  const { c, axisProps } = useAxis(currency);
  const rows = useMemo(
    () =>
      points.map((p) => ({
        ...p,
        label: p.year === 0 ? 'Now' : `Yr ${p.year}`,
        valueM: toMajor(p.value, currency),
        contributedM: toMajor(p.contributed, currency),
      })),
    [points, currency],
  );
  const series = [
    { label: 'Projected value', color: c['--series-1'] },
    { label: 'Money you put in', color: c['--series-2'] },
  ];
  return (
    <figure className="stack" style={{ margin: 0, gap: 8, alignItems: 'stretch' }}>
      <Legend items={series} />
      <div style={{ height }} role="img" aria-label="Projected value compared with the money you put in, by year.">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={c['--grid']} />
            <XAxis dataKey="label" {...axisProps} minTickGap={16} />
            <YAxis {...axisProps} axisLine={false} width={52} tickFormatter={axisNumber} />
            <Tooltip
              cursor={{ stroke: c['--axis'] }}
              content={({ active, payload }) => {
                const r = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                return r ? (
                  <Tip
                    active={active}
                    currency={currency}
                    title={r.year === 0 ? 'Today' : `After ${r.year} year${r.year === 1 ? '' : 's'}`}
                    rows={[
                      { label: 'Projected value', value: r.value, color: series[0]!.color },
                      { label: 'Money you put in', value: r.contributed, color: series[1]!.color },
                      { label: 'Growth', value: r.value - r.contributed },
                    ]}
                  />
                ) : null;
              }}
            />
            <Line dataKey="valueM" stroke={series[0]!.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            <Line
              dataKey="contributedM"
              stroke={series[1]!.color}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** A 100% bar with a labelled legend underneath (identity never by colour alone). */
export function SplitBar({
  parts,
  currency,
  label,
}: {
  parts: Array<{ label: string; value: number; slot: 1 | 2 | 3 | 4 }>;
  currency: string;
  label: string;
}) {
  const c = useThemeColors();
  const total = Math.max(1, parts.reduce((s, p) => s + p.value, 0));
  const color = (slot: number) => c[`--series-${slot}` as '--series-1'];
  return (
    <div className="stack" style={{ alignItems: 'stretch' }}>
      <div
        role="img"
        aria-label={`${label}: ${parts.map((p) => `${p.label} ${formatPct(p.value / total)}`).join(', ')}`}
        style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', gap: 2 }}
      >
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div key={p.label} title={`${p.label}: ${formatMoney(p.value, currency)}`} style={{ flex: p.value / total, background: color(p.slot) }} />
          ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, width: '100%' }}>
        {parts.map((p) => (
          <div key={p.label}>
            <div className="legend">
              <span>
                <i className="swatch" style={{ background: color(p.slot) }} />
                {p.label}
              </span>
            </div>
            <div className="num" style={{ fontWeight: 600, marginTop: 2 }}>
              {formatPct(p.value / total)}
            </div>
            <div className="subtle num">{formatMoney(p.value, currency, { compact: true })}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
