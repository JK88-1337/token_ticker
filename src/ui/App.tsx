import { useEffect, useMemo, useState } from 'react';
import { workTokens } from '../core/limits.js';
import type { UsageSnapshot } from '../core/snapshot.js';
import type { UsageBucket } from '../core/summary.js';
import { Breakdown, DailyBars, type BreakdownItem } from './charts.js';
import { compact, count, projectName, shortDay, todayKey, usd } from './format.js';
import { Scoreboard } from './Scoreboard.js';

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

function toItems(
  buckets: UsageBucket[],
  colour: (key: string) => string,
  label = (key: string) => key,
): BreakdownItem[] {
  return buckets.map((bucket) => ({
    key: bucket.key,
    label: label(bucket.key),
    usd: bucket.totals.usd,
    turns: bucket.totals.turns,
    outputTokens: bucket.totals.tokens.output,
    colour: colour(bucket.key),
  }));
}

/** A collapsed section — the detail is there when wanted, not before. */
function Drawer({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <details className="drawer">
      <summary>
        <span className="drawer-title">{title}</span>
        <span className="drawer-hint">{hint}</span>
      </summary>
      <div className="drawer-body">{children}</div>
    </details>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let cancelled = false;

    // Pushed from a filesystem watcher, not polled: a turn reaches the screen
    // about as fast as Claude Code can write it.
    const source = new EventSource(`/api/usage/stream?tz=${encodeURIComponent(timeZone)}`);

    source.onmessage = (event) => {
      if (cancelled) return;
      setSnapshot(JSON.parse(event.data) as UsageSnapshot);
      setError(null);
    };

    // EventSource reconnects on its own, so this only matters before the first
    // snapshot ever arrives.
    source.onerror = () => {
      if (!cancelled) setError('waiting for the usage feed');
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, []);

  const modelColour = useMemo(() => {
    const order = [...(snapshot?.byModel ?? [])].map((bucket) => bucket.key).sort();
    return (key: string) => SERIES[order.indexOf(key) % SERIES.length]!;
  }, [snapshot]);

  if (!snapshot) {
    return (
      <div className="app">
        <p className="state">{error ?? 'Reading transcripts…'}</p>
      </div>
    );
  }

  const { totals, byDay, byModel, byProject, timeZone, limitHits } = snapshot;
  const today = byDay.find((bucket) => bucket.key === todayKey(timeZone));

  return (
    <div className="app">
      <header className="masthead">
        <h1>token_ticker</h1>
        <span className="tag">unofficial · {timeZone}</span>
      </header>

      <Scoreboard snapshot={snapshot} />

      {totals.unpricedTurns > 0 ? (
        <p className="footnote warn">
          {count(totals.unpricedTurns)} turns ran on a model with no rate in the pricing table, so
          the equivalent value is a floor rather than a total.
        </p>
      ) : null}

      <Drawer
        title="Spend per day"
        hint={`today ${usd(today?.totals.usd ?? 0)} · ${byDay.length} active days`}
      >
        <p className="caption">
          Last {TREND_DAYS} days with activity, oldest first. Days with no usage are not shown.
        </p>
        <DailyBars buckets={byDay.slice(-TREND_DAYS)} />
      </Drawer>

      <Drawer title="By model" hint={`${byModel.length} models`}>
        <Breakdown items={toItems(byModel, modelColour)} />
      </Drawer>

      <Drawer title="By project" hint={`${byProject.length} projects`}>
        <Breakdown items={toItems(byProject, () => 'var(--series-1)', projectName)} />
      </Drawer>

      <Drawer
        title="Ceiling evidence"
        hint={limitHits.length > 0 ? `${limitHits.length} refusals on record` : 'never cut off'}
      >
        <p className="caption">
          The allowance itself is not in the transcripts and is not cached on disk, so nothing here
          is a quota lookup. What is recorded is the moment a turn was refused — and what the
          window held when it happened.
        </p>
        {limitHits.length > 0 ? (
          <ul className="events">
            {limitHits.map((hit) => (
              <li key={hit.at}>
                <span className="event-when">{shortDay(hit.at.slice(0, 10))}</span>
                <span className="event-text">{hit.notice}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="state">
            No refusal on record. The session gauge compares against your busiest window instead —{' '}
            {compact(workTokens(snapshot.peak.totals.tokens))} tokens.
          </p>
        )}
      </Drawer>

      <p className="footnote">
        Read from your local transcripts; nothing leaves this machine. Token counts exclude cache
        reads where an allowance is concerned — they swamp every other class and are the cheapest
        thing billed. Rates come from the shipped pricing table; verify them against Anthropic's
        pricing page before trusting a total.
      </p>
    </div>
  );
}
