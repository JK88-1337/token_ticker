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
                  y: cell.top - frame.top - 8,
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
