import { useEffect, useState } from 'react';
import { totalTokens, workTokens } from '../core/limits.js';
import { burnRatePerHour, comboLength, comboTier, dailyStreak, levelFor } from '../core/momentum.js';
import type { UsageSnapshot } from '../core/snapshot.js';
import { compact, count, todayKey, usd } from './format.js';
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

/** Where the session gauge sits, and what to call it. */
function pressure(used: number, ceiling: number | null) {
  if (!ceiling || ceiling <= 0) return { fraction: 0, level: 'unknown' as const, label: 'no ceiling measured yet' };
  const fraction = Math.min(used / ceiling, 1);
  if (fraction >= 0.85) return { fraction, level: 'critical' as const, label: 'at the edge' };
  if (fraction >= 0.6) return { fraction, level: 'warning' as const, label: 'closing in' };
  return { fraction, level: 'clear' as const, label: 'room to run' };
}

/**
 * The scoreboard — tokens first, because tokens are the thing being spent.
 *
 * Every figure here is measured. The odometer eases toward a real total, the
 * combo is a real run of turns, the burn rate is real spend over a sliding
 * window, and the ceiling is the level at which this machine was actually
 * refused — never a quota looked up or guessed.
 */
export function Scoreboard({ snapshot }: { snapshot: UsageSnapshot }) {
  const now = useNow(1000);
  const [floaters, setFloaters] = useState<Floater[]>([]);

  const lifetime = totalTokens(snapshot.totals.tokens);
  const shown = useAnimatedValue(lifetime);
  const previous = usePrevious(lifetime);

  const level = levelFor(lifetime);
  const combo = comboLength(snapshot.recent.map((event) => event.at), now, COMBO_GAP_MS);
  const tier = comboTier(combo);
  const burn = burnRatePerHour(snapshot.recent, now, BURN_WINDOW_MS);
  const streak = dailyStreak(snapshot.byDay.map((bucket) => bucket.key), todayKey(snapshot.timeZone));

  const lastAt = snapshot.recent.at(-1)?.at;
  const sinceLast = lastAt ? now - Date.parse(lastAt) : Number.POSITIVE_INFINITY;
  const comboLeft = Math.max(0, 1 - sinceLast / COMBO_GAP_MS);

  const windowUsed = workTokens(snapshot.window.totals.tokens);
  const ceiling = snapshot.observedCeiling;
  const peak = workTokens(snapshot.peak.totals.tokens);
  const gauge = pressure(windowUsed, ceiling ?? (peak > 0 ? peak : null));

  useEffect(() => {
    if (previous === undefined) return;
    const gained = lifetime - previous;
    if (gained <= 0) return;

    const floater = { id: Date.now(), text: `+${compact(gained)}` };
    setFloaters((current) => [...current, floater]);
    const timer = setTimeout(
      () => setFloaters((current) => current.filter((f) => f.id !== floater.id)),
      1400,
    );
    return () => clearTimeout(timer);
  }, [lifetime, previous]);

  return (
    <section className={combo > 1 ? 'board live' : 'board'}>
      <div className="score">
        <div className="score-top">
          <span className="score-label">Tokens burned</span>
          <span className="level-chip">LV {level.level}</span>
        </div>

        <div className="score-figure">
          <Odometer value={compact(shown)} />
          <div className="floaters">
            {floaters.map((floater) => (
              <span className="floater" key={floater.id}>
                {floater.text}
              </span>
            ))}
          </div>
        </div>

        <div className="xp">
          <div className="xp-fill" style={{ width: `${(level.into / level.span) * 100}%` }} />
        </div>
        <div className="score-note">
          {compact(level.span - level.into)} to level {level.level + 1} ·{' '}
          {count(snapshot.totals.turns)} turns · {usd(snapshot.totals.usd)} equivalent
        </div>
      </div>

      <div className={combo > 1 ? 'combo-card live' : 'combo-card'}>
        <div className="score-label">Combo</div>
        <div className="combo-figure" key={combo}>
          {combo > 0 ? `×${combo}` : '—'}
        </div>
        <div className="decay">
          <div className="decay-fill" style={{ width: `${comboLeft * 100}%` }} />
        </div>
        <div className="combo-tier">{tier ? tier.name : combo > 0 ? 'first blood' : 'idle'}</div>
      </div>

      <div className={`limit-card ${gauge.level}`}>
        <div className="score-top">
          <span className="score-label">Session window · 5h</span>
          <span className="limit-state">{gauge.label}</span>
        </div>
        <div className="limit-figure">
          <Odometer value={compact(windowUsed)} />
          <span className="limit-of">
            {ceiling ?? peak ? `of ${compact(ceiling ?? peak)}` : ''}
          </span>
        </div>
        <div className="meter">
          <div className="meter-fill" style={{ width: `${gauge.fraction * 100}%` }} />
        </div>
        <div className="score-note">
          {ceiling
            ? 'ceiling measured from the window you were actually cut off in'
            : peak > 0
              ? 'no refusal on record — compared against your busiest window'
              : 'nothing to compare against yet'}
        </div>
      </div>

      <div className="mini-row">
        <div className="mini">
          <div className="mini-label">Burn rate</div>
          <div className="mini-value">
            <Odometer value={usd(burn)} />
            <span className="per">/hr</span>
          </div>
        </div>
        <div className="mini">
          <div className="mini-label">Streak</div>
          <div className="mini-value">{streak > 0 ? `${streak}d` : '—'}</div>
        </div>
        <div className="mini">
          <div className="mini-label">Window turns</div>
          <div className="mini-value">{count(snapshot.window.totals.turns)}</div>
        </div>
        <div className="mini">
          <div className="mini-label">Times cut off</div>
          <div className="mini-value">{count(snapshot.limitHits.length)}</div>
        </div>
      </div>
    </section>
  );
}
