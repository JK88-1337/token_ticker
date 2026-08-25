import { useEffect, useState } from 'react';
import { COMBO_GAP_MS } from '../core/momentum.js';
import type { UsageSnapshot } from '../core/snapshot.js';
import { Farm } from '../farm/Farm.js';
import { Ticker } from '../ticker/Ticker.js';
import { subscribeToUsage } from './feed.js';
import { count } from './format.js';

/**
 * Which skin is on.
 *
 * The ticker is the default and always will be: the farm is a game played
 * with the same numbers, and a measuring tool that opens on a game is no
 * longer a measuring tool.
 */
type Skin = 'ticker' | 'farm';

const SKIN_KEY = 'token-ticker.skin';

function storedSkin(): Skin {
  try {
    return window.localStorage.getItem(SKIN_KEY) === 'farm' ? 'farm' : 'ticker';
  } catch {
    return 'ticker';
  }
}

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
  const [skin, setSkin] = useState<Skin>(storedSkin);

  useEffect(() => {
    try {
      window.localStorage.setItem(SKIN_KEY, skin);
    } catch {
      // A preference that cannot be written still holds for this session.
    }
  }, [skin]);

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

        <nav className="skins" aria-label="View">
          {(['ticker', 'farm'] as const).map((id) => (
            <button
              key={id}
              className={skin === id ? 'skin on' : 'skin'}
              aria-pressed={skin === id}
              onClick={() => setSkin(id)}
            >
              {id}
            </button>
          ))}
        </nav>

        {snapshot.totals.unpricedTurns > 0 ? (
          <span className="hud-warn">{count(snapshot.totals.unpricedTurns)} turns unpriced</span>
        ) : null}
        <span className="hud-zone">unofficial · {snapshot.timeZone}</span>
      </header>

      {skin === 'farm' ? <Farm snapshot={snapshot} /> : <Ticker snapshot={snapshot} />}
    </div>
  );
}
