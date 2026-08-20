import { useEffect, useMemo, useState } from 'react';
import type { UsageSnapshot } from '../core/snapshot.js';
import type { UsageBucket } from '../core/summary.js';
import { Breakdown, DailyBars, type BreakdownItem } from './charts.js';
import { compact, count, dayKeyBefore, projectName, todayKey, usd } from './format.js';

/** How many active days the trend shows. */
const TREND_DAYS = 30;

/**
 * Categorical slots, in the fixed order the palette validates in.
 *
 * Assignment is by sorted model id, never by rank — a model that gets dearer
 * must not take another model's colour, and filtering must not repaint the
 * survivors.
 */
const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
];

function toItems(buckets: UsageBucket[], color: (key: string) => string, label = (k: string) => k): BreakdownItem[] {
  return buckets.map((bucket) => ({
    key: bucket.key,
    label: label(bucket.key),
    usd: bucket.totals.usd,
    turns: bucket.totals.turns,
    outputTokens: bucket.totals.tokens.output,
    color: color(bucket.key),
  }));
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note ? <div className="note">{note}</div> : null}
    </div>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(`/api/usage?tz=${encodeURIComponent(timeZone)}`);
        if (!response.ok) throw new Error(`the usage API answered ${response.status}`);
        const data = (await response.json()) as UsageSnapshot;
        if (!cancelled) {
          setSnapshot(data);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    }

    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const modelColour = useMemo(() => {
    const order = [...(snapshot?.byModel ?? [])].map((b) => b.key).sort();
    return (key: string) => SERIES[order.indexOf(key) % SERIES.length]!;
  }, [snapshot]);

  if (error) {
    return (
      <div className="app">
        <p className="state">Could not read usage — {error}.</p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="app">
        <p className="state">Reading transcripts…</p>
      </div>
    );
  }

  const { totals, byDay, byModel, byProject, timeZone } = snapshot;
  const today = byDay.find((bucket) => bucket.key === todayKey(timeZone));
  const weekCutoff = dayKeyBefore(timeZone, 6);
  const weekUsd = byDay
    .filter((bucket) => bucket.key >= weekCutoff)
    .reduce((sum, bucket) => sum + bucket.totals.usd, 0);

  const cacheRead = totals.tokens.cacheRead;
  const cacheWrite = totals.tokens.cacheWrite5m + totals.tokens.cacheWrite1h;

  return (
    <div className="app">
      <header className="masthead">
        <h1>token_ticker</h1>
        <span className="tag">unofficial · {timeZone}</span>
      </header>
      <p className="subhead">
        Equivalent pay-as-you-go value of your Claude Code usage. On a subscription this is what
        the compute would have cost, not what you were billed.
      </p>

      <div className="tiles">
        <Tile label="All time" value={usd(totals.usd)} note={`${count(totals.turns)} turns`} />
        <Tile label="Today" value={usd(today?.totals.usd ?? 0)} note={`${count(today?.totals.turns ?? 0)} turns`} />
        <Tile label="Last 7 days" value={usd(weekUsd)} />
        <Tile
          label="Cache traffic"
          value={compact(cacheRead)}
          note={`read · ${compact(cacheWrite)} written`}
        />
      </div>

      {totals.unpricedTurns > 0 ? (
        <p className="footnote warn">
          {count(totals.unpricedTurns)} turns ran on a model with no rate in the pricing table, so
          the totals above are a floor rather than a total.
        </p>
      ) : null}

      <section className="panel">
        <h2>Spend per day</h2>
        <p className="caption">
          Last {TREND_DAYS} days with activity, oldest first. Days with no usage are not shown.
        </p>
        <DailyBars buckets={byDay.slice(-TREND_DAYS)} />
      </section>

      <div className="columns">
        <section className="panel">
          <h2>By model</h2>
          <p className="caption">Share of spend.</p>
          <Breakdown items={toItems(byModel, modelColour)} />
        </section>

        <section className="panel">
          <h2>By project</h2>
          <p className="caption">Share of spend.</p>
          <Breakdown items={toItems(byProject, () => 'var(--series-1)', projectName)} />
        </section>
      </div>

      <p className="footnote">
        Read from your local transcripts; nothing leaves this machine. Rates come from the shipped
        pricing table — verify them against Anthropic's pricing page before trusting a total.
      </p>
    </div>
  );
}
