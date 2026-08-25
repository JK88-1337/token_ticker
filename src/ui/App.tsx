import { useEffect, useState } from 'react';
import { COMBO_GAP_MS } from '../core/momentum.js';
import type { UsageSnapshot } from '../core/snapshot.js';
import { Ticker } from '../ticker/Ticker.js';
import { subscribeToUsage } from './feed.js';
import { count } from './format.js';

/**
 * The shell.
 *
 * It owns the feed and the one piece of state every skin needs — whether work
 * is happening right now — and hands the snapshot to whichever skin is on.
 * Nothing here draws a figure.
 */
export function App() {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When the transcript was last written without anything billable landing —
  // a turn mid-generation. Evidence of work, not a token count.
  const [activityAt, setActivityAt] = useState(0);

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let cancelled = false;

    // Pushed rather than polled, over whichever transport this build has: IPC
    // when packaged, SSE in development. Both carry the same snapshot.
    const unsubscribe = subscribeToUsage(timeZone, {
      snapshot: (next) => {
        if (cancelled) return;
        setSnapshot(next);
        setError(null);
      },
      activity: () => {
        if (!cancelled) setActivityAt(Date.now());
      },
      error: (message) => {
        if (!cancelled) setError(message);
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (!snapshot) {
    return (
      <div className="hud">
        <p className="state">{error ?? 'Reading transcripts…'}</p>
      </div>
    );
  }

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

        {snapshot.totals.unpricedTurns > 0 ? (
          <span className="hud-warn">{count(snapshot.totals.unpricedTurns)} turns unpriced</span>
        ) : null}
        <span className="hud-zone">unofficial · {snapshot.timeZone}</span>
      </header>

      <Ticker snapshot={snapshot} />
    </div>
  );
}
