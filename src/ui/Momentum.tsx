import { useEffect, useState } from 'react';
import { burnRatePerHour, comboLength, dailyStreak } from '../core/momentum.js';
import type { UsageSnapshot } from '../core/snapshot.js';
import { count, todayKey, usd } from './format.js';
import { useAnimatedValue, useNow, usePrevious } from './hooks.js';
import { Odometer } from './Odometer.js';

/** A pause longer than this ends a run of turns. */
const COMBO_GAP_MS = 120_000;
/** The trailing window the burn rate is measured over. */
const BURN_WINDOW_MS = 10 * 60_000;

interface Floater {
  id: number;
  text: string;
}

/**
 * The live half of the dashboard.
 *
 * Everything here is derived from real turns: the counter rolls toward the
 * real total, the combo is a real run of back-to-back turns, and the burn rate
 * is real spend over a sliding window — which is why it may fall while you
 * watch it without anything having been faked.
 */
export function Momentum({ snapshot }: { snapshot: UsageSnapshot }) {
  const now = useNow(1000);
  const spend = useAnimatedValue(snapshot.totals.usd);
  const previousTotal = usePrevious(snapshot.totals.usd);
  const [floaters, setFloaters] = useState<Floater[]>([]);

  const combo = comboLength(
    snapshot.recent.map((event) => event.at),
    now,
    COMBO_GAP_MS,
  );
  const burn = burnRatePerHour(snapshot.recent, now, BURN_WINDOW_MS);
  const streak = dailyStreak(
    snapshot.byDay.map((bucket) => bucket.key),
    todayKey(snapshot.timeZone),
  );

  const lastAt = snapshot.recent.at(-1)?.at;
  const sinceLast = lastAt ? now - Date.parse(lastAt) : Number.POSITIVE_INFINITY;
  const comboLeft = Math.max(0, 1 - sinceLast / COMBO_GAP_MS);

  // A rise in the real total is the only thing that pops a floater.
  useEffect(() => {
    if (previousTotal === undefined) return;
    const gained = snapshot.totals.usd - previousTotal;
    if (gained <= 0) return;

    const floater = { id: Date.now(), text: `+${usd(gained)}` };
    setFloaters((current) => [...current, floater]);
    const timer = setTimeout(
      () => setFloaters((current) => current.filter((f) => f.id !== floater.id)),
      1400,
    );
    return () => clearTimeout(timer);
  }, [snapshot.totals.usd, previousTotal]);

  return (
    <section className="momentum">
      <div className="hero">
        <div className="hero-label">Burned all time</div>
        <div className="hero-figure">
          <Odometer value={usd(spend)} />
          <div className="floaters">
            {floaters.map((floater) => (
              <span className="floater" key={floater.id}>
                {floater.text}
              </span>
            ))}
          </div>
        </div>
        <div className="hero-note">{count(snapshot.totals.turns)} turns</div>
      </div>

      <div className="gauges">
        <div className={combo > 1 ? 'gauge combo live' : 'gauge combo'}>
          <div className="gauge-label">Combo</div>
          <div className="gauge-value" key={combo}>
            {combo > 0 ? `×${combo}` : '—'}
          </div>
          <div className="decay">
            <div className="decay-fill" style={{ width: `${comboLeft * 100}%` }} />
          </div>
          <div className="gauge-note">
            {combo > 0 ? 'turns back to back' : 'idle — start a turn'}
          </div>
        </div>

        <div className="gauge">
          <div className="gauge-label">Burn rate</div>
          <div className="gauge-value">
            <Odometer value={usd(burn)} />
            <span className="per">/hr</span>
          </div>
          <div className="gauge-note">last 10 minutes, sliding</div>
        </div>

        <div className="gauge">
          <div className="gauge-label">Streak</div>
          <div className="gauge-value">{streak > 0 ? `${streak}d` : '—'}</div>
          <div className="gauge-note">{streak > 0 ? 'days in a row' : 'no run yet'}</div>
        </div>
      </div>
    </section>
  );
}
