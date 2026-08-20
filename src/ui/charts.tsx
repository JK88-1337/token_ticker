import { useState } from 'react';
import type { UsageBucket } from '../core/summary.js';
import { compact, count, shortDay, usd } from './format.js';

interface Hover {
  x: number;
  y: number;
  title: string;
  rows: string[];
}

function Tooltip({ hover }: { hover: Hover }) {
  return (
    <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
      <div className="tip-title">{hover.title}</div>
      {hover.rows.map((row) => (
        <div className="tip-row" key={row}>
          {row}
        </div>
      ))}
    </div>
  );
}

/**
 * Spend per day, oldest at the left.
 *
 * One series, so there is no legend — the panel title names it. Bars are HTML
 * rather than SVG so the chart reflows with the panel without measuring it,
 * and so the labels never scale with the plot.
 */
export function DailyBars({ buckets }: { buckets: UsageBucket[] }) {
  const [hover, setHover] = useState<Hover | null>(null);

  if (buckets.length === 0) return <p className="state">No usage recorded yet.</p>;

  const peak = Math.max(...buckets.map((bucket) => bucket.totals.usd));
  const dearest = buckets.reduce((a, b) => (b.totals.usd > a.totals.usd ? b : a));

  return (
    <div className="chart">
      <div className="bars-frame">
        <div className="bars-axis">
          <span>{usd(peak)}</span>
          <span>$0</span>
        </div>
        <div className="bars">
          {buckets.map((bucket) => (
            <div
              className="bar-col"
              key={bucket.key}
              onMouseEnter={(event) => {
                const cell = event.currentTarget.getBoundingClientRect();
                const frame = event.currentTarget.closest('.chart')!.getBoundingClientRect();
                setHover({
                  x: cell.left - frame.left + cell.width / 2,
                  // Bars reaching the top would push the tooltip out of the pane.
                  y: Math.max(cell.top - frame.top - 8, 2),
                  title: shortDay(bucket.key),
                  rows: [
                    `${usd(bucket.totals.usd)} · ${count(bucket.totals.turns)} turns`,
                    `${compact(bucket.totals.tokens.output)} output tokens`,
                  ],
                });
              }}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className="bar-fill"
                style={{ height: `${Math.max((bucket.totals.usd / peak) * 100, 1.5)}%` }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="bars-labels">
        {buckets.map((bucket) => (
          <span key={bucket.key} className={bucket.key === dearest.key ? 'peak' : undefined}>
            {bucket.key === buckets[0]?.key ||
            bucket.key === buckets[buckets.length - 1]?.key ||
            bucket.key === dearest.key
              ? shortDay(bucket.key)
              : ''}
          </span>
        ))}
      </div>
      {hover ? <Tooltip hover={hover} /> : null}
    </div>
  );
}

export interface GrowthPoint {
  /** Epoch milliseconds. */
  t: number;
  /** Cumulative tokens at that moment. */
  v: number;
}

/**
 * Today's running total, drawn as it grows.
 *
 * The domain is midnight to now, so the line always reaches the right edge and
 * stretches as the day goes on. It only ever climbs — that is the whole appeal
 * — and the head of the line marks where the count stands this second.
 *
 * The stroke keeps its width under the non-uniform scale, which is what lets
 * the plot fill whatever space the card has without measuring it.
 */
export function GrowthLine({
  points,
  from,
  to,
  pulseKey,
}: {
  points: readonly GrowthPoint[];
  from: number;
  to: number;
  pulseKey: number;
}) {
  if (points.length === 0 || to <= from) return <div className="growth empty" />;

  const peak = points[points.length - 1]!.v || 1;
  const x = (t: number) => ((t - from) / (to - from)) * 100;
  const y = (v: number) => 100 - (v / peak) * 100;

  // Held flat from the last turn to now: nothing has been spent since.
  const plotted = [...points, { t: to, v: points[points.length - 1]!.v }];
  const line = plotted.map((point) => `${x(point.t).toFixed(3)},${y(point.v).toFixed(3)}`).join(' L');
  const head = plotted[plotted.length - 1]!;

  return (
    <div className="growth">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <path className="growth-area" d={`M${line} L100,100 L0,100 Z`} />
        <path className="growth-line" d={`M${line}`} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="growth-head" style={{ left: `${x(head.t)}%`, top: `${y(head.v)}%` }}>
        {/* Remounted on every arrival so the ring restarts rather than
            continuing a ripple already in flight. */}
        <span className="growth-ping" key={pulseKey} />
      </span>
    </div>
  );
}

export interface BreakdownItem {
  key: string;
  label: string;
  usd: number;
  turns: number;
  outputTokens: number;
  colour: string;
}

/**
 * Ranked share of spend.
 *
 * Every row is directly labelled with its name and amount, so identity never
 * rests on colour — which is also what licenses the palette slots that sit
 * below 3:1 against the light surface.
 */
export function Breakdown({ items }: { items: BreakdownItem[] }) {
  if (items.length === 0) return <p className="state">Nothing to show yet.</p>;

  const peak = Math.max(...items.map((item) => item.usd));

  return (
    <div className="rows">
      {items.map((item) => (
        <div className="row" key={item.key} title={`${count(item.turns)} turns`}>
          <div className="row-head">
            <span className="swatch" style={{ background: item.colour }} />
            <span className="name">{item.label}</span>
            <span className="amount">{usd(item.usd)}</span>
          </div>
          <div className="track">
            <div
              className="fill"
              style={{
                width: `${peak > 0 ? Math.max((item.usd / peak) * 100, 1) : 0}%`,
                background: item.colour,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Recent turns as they arrived, newest at the right.
 *
 * The combo counts a run; this shows its shape — how hard each turn hit and
 * how evenly they landed. Bars are placed by time, not by index, so a pause
 * reads as a gap rather than being squeezed out.
 */
export function Beats({
  events,
  from,
  to,
}: {
  events: readonly { at: string; work: number }[];
  from: number;
  to: number;
}) {
  const mine = events
    .map((event) => ({ t: Date.parse(event.at), work: event.work }))
    .filter((beat) => beat.t >= from && beat.t <= to);

  if (mine.length === 0 || to <= from) return <div className="beats empty" />;

  const peak = Math.max(...mine.map((beat) => beat.work), 1);

  return (
    <div className="beats">
      {mine.map((beat) => (
        <span
          key={beat.t}
          className="beat"
          style={{
            left: `${((beat.t - from) / (to - from)) * 100}%`,
            height: `${Math.max((beat.work / peak) * 100, 6)}%`,
          }}
        />
      ))}
    </div>
  );
}

export interface FlowRow {
  label: string;
  value: number;
  colour: string;
}

/**
 * Where the tokens went, split into what was sent and what came back.
 *
 * Each side is scaled against its own largest row: cache reads run three
 * orders of magnitude above everything else, so one shared scale would leave
 * every other row invisible.
 */
export function TokenFlow({ inbound, outbound }: { inbound: FlowRow[]; outbound: FlowRow[] }) {
  const group = (rows: FlowRow[], title: string) => {
    const peak = Math.max(...rows.map((row) => row.value), 1);
    return (
      <div className="flow-group">
        <div className="flow-title">{title}</div>
        {rows.map((row) => (
          <div className="flow-row" key={row.label}>
            <span className="flow-label">{row.label}</span>
            <span className="flow-value">{compact(row.value)}</span>
            <span className="flow-track">
              <span
                className="flow-fill"
                style={{ width: `${(row.value / peak) * 100}%`, background: row.colour }}
              />
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flow">
      {group(inbound, 'sent')}
      {group(outbound, 'returned')}
    </div>
  );
}

/**
 * A ring split by share.
 *
 * The radius is chosen so the circumference is exactly 100, which makes every
 * dash length a percentage and keeps the arithmetic obvious.
 */
export function Donut({ slices, centre }: { slices: FlowRow[]; centre?: string }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) return <div className="donut empty" />;

  let offset = 0;

  return (
    <div className="donut">
      <svg viewBox="0 0 42 42" aria-hidden>
        {slices.map((slice) => {
          const share = (slice.value / total) * 100;
          const dash = (
            <circle
              key={slice.label}
              className="donut-arc"
              cx="21"
              cy="21"
              r="15.9155"
              stroke={slice.colour}
              strokeDasharray={`${share} ${100 - share}`}
              strokeDashoffset={-offset}
            />
          );
          offset += share;
          return dash;
        })}
      </svg>
      {centre ? <span className="donut-centre">{centre}</span> : null}
    </div>
  );
}
