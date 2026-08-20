import { useEffect, useMemo, useState } from 'react';
import { workTokens } from '../core/limits.js';
import { COMBO_GAP_MS } from '../core/momentum.js';
import type { UsageSnapshot } from '../core/snapshot.js';
import type { UsageBucket } from '../core/summary.js';
import { Breakdown, DailyBars, type BreakdownItem } from './charts.js';
import { compact, count, projectName, shortDay, usd } from './format.js';
import { Scoreboard } from './Scoreboard.js';

/** How many active days the trend shows. */
const TREND_DAYS = 45;

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

type Tab = 'days' | 'models' | 'projects' | 'ceiling';

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

export function App() {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('models');
  // When the transcript was last written without anything billable landing —
  // a turn mid-generation. Evidence of work, not a token count.
  const [activityAt, setActivityAt] = useState(0);

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

    source.addEventListener('activity', () => {
      if (!cancelled) setActivityAt(Date.now());
    });

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
      <div className="hud">
        <p className="state">{error ?? 'Reading transcripts…'}</p>
      </div>
    );
  }

  const { totals, byDay, byModel, byProject, timeZone, limitHits } = snapshot;

  // Three states, each earned. Generating means the transcript is being
  // written right now with nothing billable in it yet — the gap between a
  // request going out and its usage block landing. Live means a turn actually
  // landed inside the same two minutes the combo uses, so the two can never
  // disagree.
  const lastAt = snapshot.recent.at(-1)?.at;
  const sinceUsage = lastAt ? Date.now() - Date.parse(lastAt) : Number.POSITIVE_INFINITY;
  const sinceActivity = activityAt ? Date.now() - activityAt : Number.POSITIVE_INFINITY;
  const generating = sinceActivity < 12_000 && sinceActivity < sinceUsage;
  const live = sinceUsage < COMBO_GAP_MS;
  const signal = generating ? 'generating' : live ? 'live' : 'idle';

  const tabs: { id: Tab; label: string; hint: string }[] = [
    { id: 'days', label: 'Days', hint: `${byDay.length}` },
    { id: 'models', label: 'Models', hint: `${byModel.length}` },
    { id: 'projects', label: 'Projects', hint: `${byProject.length}` },
    { id: 'ceiling', label: 'Ceiling', hint: `${limitHits.length}` },
  ];

  return (
    <div className="hud">
      <header className="hud-bar">
        <span className="wordmark">
          <span className="wordmark-a">token</span>
          <span className="wordmark-b">_ticker</span>
        </span>

        <span className={`signal ${signal}`}>
          <span className="signal-dot" />
          {signal}
        </span>

        <span className="hud-bar-spacer" />

        {totals.unpricedTurns > 0 ? (
          <span className="hud-warn">{count(totals.unpricedTurns)} turns unpriced</span>
        ) : null}
        <span className="hud-zone">unofficial · {timeZone}</span>
      </header>

      <Scoreboard snapshot={snapshot} />

      <section className="detail">
        <nav className="tabs" role="tablist">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={tab === entry.id}
              className={tab === entry.id ? 'tab on' : 'tab'}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
              <span className="tab-hint">{entry.hint}</span>
            </button>
          ))}
        </nav>

        <div className="detail-body">
          {tab === 'days' ? <DailyBars buckets={byDay.slice(-TREND_DAYS)} /> : null}

          {tab === 'models' ? <Breakdown items={toItems(byModel, modelColour)} /> : null}

          {tab === 'projects' ? (
            <Breakdown items={toItems(byProject, () => 'var(--series-1)', projectName)} />
          ) : null}

          {tab === 'ceiling' ? (
            <div className="ceiling-pane">
              <p className="caption">
                The allowance is not in the transcripts and is not cached on disk, so nothing here
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
                  No refusal on record. The session gauge compares against your busiest window
                  instead — {compact(workTokens(snapshot.peak.totals.tokens))} tokens, on{' '}
                  {snapshot.peak.endedAt ? shortDay(snapshot.peak.endedAt.slice(0, 10)) : '—'}.
                </p>
              )}
              <p className="caption">
                Read from local transcripts; nothing leaves this machine. Equivalent value{' '}
                {usd(totals.usd)} at the shipped rates — verify them before trusting a total.
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
