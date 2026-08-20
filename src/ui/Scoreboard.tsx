import { useEffect, useState } from 'react';
import { totalTokens, workTokens } from '../core/limits.js';
import {
  comboLength,
  comboTier,
  dailyStreak,
  levelFor,
  tokenRatePerSecond,
} from '../core/momentum.js';
import type { UsageSnapshot } from '../core/snapshot.js';
import { GrowthLine, type GrowthPoint } from './charts.js';
import { compact, count, full, todayKey } from './format.js';
import { useAnimatedValue, useNow, usePrevious } from './hooks.js';
import { Odometer } from './Odometer.js';

/** A pause longer than this ends a run of turns. */
const COMBO_GAP_MS = 120_000;
/** Short enough that the rate jumps the moment a turn lands. */
const RATE_WINDOW_MS = 60_000;

interface Floater {
  id: number;
  text: string;
}

/** Where the session gauge sits, and what to call it. */
function pressure(used: number, ceiling: number | null) {
  if (!ceiling || ceiling <= 0) {
    return { fraction: 0, level: 'unknown' as const, label: 'no ceiling yet' };
  }
  const fraction = Math.min(used / ceiling, 1);
  if (fraction >= 0.85) return { fraction, level: 'critical' as const, label: 'at the edge' };
  if (fraction >= 0.6) return { fraction, level: 'warning' as const, label: 'closing in' };
  return { fraction, level: 'clear' as const, label: 'room to run' };
}

/**
 * The scoreboard.
 *
 * Today leads, because a day is the run you are actually in — it starts at
 * zero every morning and there is a record to beat. Lifetime and level sit
 * underneath as the long game.
 *
 * Every figure is measured. The odometer eases toward a real count, the rate
 * is real tokens over a sliding window, the combo is a real run of turns, and
 * the ceiling is the level this machine was actually refused at.
 */
export function Scoreboard({ snapshot }: { snapshot: UsageSnapshot }) {
  const now = useNow(1000);
  const [floaters, setFloaters] = useState<Floater[]>([]);

  const today = snapshot.byDay.find((bucket) => bucket.key === todayKey(snapshot.timeZone));
  const todayTokens = today ? totalTokens(today.totals.tokens) : 0;
  const shown = useAnimatedValue(todayTokens);
  const previous = usePrevious(todayTokens);

  // The record to beat is the best day that is not today.
  const bestBefore = snapshot.byDay
    .filter((bucket) => bucket.key !== today?.key)
    .reduce((best, bucket) => Math.max(best, totalTokens(bucket.totals.tokens)), 0);
  const isRecord = todayTokens > bestBefore && bestBefore > 0;
  const towardRecord = bestBefore > 0 ? Math.min(todayTokens / bestBefore, 1) : 0;

  // The growth line is walked back from today's real total rather than summed
  // forward: `recent` is capped, so on a heavy day its early turns are gone.
  // Anchoring the end means the head of the line is always the true count, and
  // only the tail of history can be short.
  const key = todayKey(snapshot.timeZone);
  const dayStart = new Date(`${key}T00:00:00`).getTime();
  const growth = (() => {
    const mine = snapshot.recent.filter((event) => Date.parse(event.at) >= dayStart);
    const points: GrowthPoint[] = [];
    let running = todayTokens;
    for (let i = mine.length - 1; i >= 0; i--) {
      points.unshift({ t: Date.parse(mine[i]!.at), v: running });
      running -= mine[i]!.tokens;
    }
    if (points.length > 0) points.unshift({ t: dayStart, v: Math.max(running, 0) });
    return points;
  })();

  const lifetime = totalTokens(snapshot.totals.tokens);
  const level = levelFor(lifetime);
  const rate = tokenRatePerSecond(snapshot.recent, now, RATE_WINDOW_MS);
  const combo = comboLength(snapshot.recent.map((event) => event.at), now, COMBO_GAP_MS);
  const tier = comboTier(combo);
  const streak = dailyStreak(
    snapshot.byDay.map((bucket) => bucket.key),
    todayKey(snapshot.timeZone),
  );

  const lastAt = snapshot.recent.at(-1)?.at;
  const sinceLast = lastAt ? now - Date.parse(lastAt) : Number.POSITIVE_INFINITY;
  const comboLeft = Math.max(0, 1 - sinceLast / COMBO_GAP_MS);

  const windowUsed = workTokens(snapshot.window.totals.tokens);
  const peak = workTokens(snapshot.peak.totals.tokens);
  const ceiling = snapshot.observedCeiling ?? (peak > 0 ? peak : null);
  const gauge = pressure(windowUsed, ceiling);

  useEffect(() => {
    if (previous === undefined) return;
    const gained = todayTokens - previous;
    if (gained <= 0) return;

    const floater = { id: Date.now(), text: `+${full(Math.round(gained))}` };
    setFloaters((current) => [...current, floater]);
    const timer = setTimeout(
      () => setFloaters((current) => current.filter((f) => f.id !== floater.id)),
      1500,
    );
    return () => clearTimeout(timer);
  }, [todayTokens, previous]);

  return (
    <section className={combo > 1 ? 'board live' : 'board'}>
      <div className="score">
        <div className="score-top">
          <span className="score-label">Tokens today</span>
          {isRecord ? <span className="record-chip">NEW RECORD</span> : null}
          <span className="level-chip">LV {level.level}</span>
        </div>

        <div className="score-figure">
          <Odometer value={full(Math.round(shown))} />
          <div className="floaters">
            {floaters.map((floater) => (
              <span className="floater" key={floater.id}>
                {floater.text}
              </span>
            ))}
          </div>
        </div>

        <div className="rate-line">
          <span className="rate">
            <Odometer value={full(Math.round(rate))} />
            <span className="per">tok/s</span>
          </span>
          <span className="rate-note">{count(today?.totals.turns ?? 0)} turns today</span>
        </div>

        <GrowthLine points={growth} from={dayStart} to={now} />

        <div className="record">
          <div
            className={isRecord ? 'record-fill beaten' : 'record-fill'}
            style={{ width: `${towardRecord * 100}%` }}
          />
        </div>
        <div className="score-note">
          {bestBefore > 0
            ? isRecord
              ? `past your best day of ${compact(bestBefore)}`
              : `${compact(bestBefore - todayTokens)} to beat your best day of ${compact(bestBefore)}`
            : 'first day on record'}
        </div>
      </div>

      <div className="combo-card">
        <div className="score-label">Combo</div>
        <div className="combo-figure" key={combo}>
          {combo > 0 ? `×${combo}` : '—'}
        </div>
        <div className="combo-tier">{tier ? tier.name : combo > 0 ? 'first blood' : 'idle'}</div>
        <div className="decay">
          <div className="decay-fill" style={{ width: `${comboLeft * 100}%` }} />
        </div>
      </div>

      <div className={`limit-card ${gauge.level}`}>
        <div className="score-top">
          <span className="score-label">Session window · 5h</span>
          <span className="limit-state">{gauge.label}</span>
        </div>
        <div className="limit-figure">
          <Odometer value={full(windowUsed)} />
          <span className="limit-of">{ceiling ? `of ${full(ceiling)}` : ''}</span>
        </div>
        <div className="meter">
          <div className="meter-fill" style={{ width: `${gauge.fraction * 100}%` }} />
        </div>
        <div className="score-note">
          {snapshot.observedCeiling
            ? 'ceiling measured from the window you were cut off in'
            : peak > 0
              ? 'no refusal on record — against your busiest window'
              : 'nothing to compare against yet'}
        </div>
      </div>

      <div className="mini-row">
        <div className="mini">
          <span className="mini-label">Lifetime</span>
          <span className="mini-value">{full(lifetime)}</span>
        </div>
        <div className="mini level-mini">
          <span className="mini-label">Level {level.level}</span>
          <span className="mini-value">{compact(level.span - level.into)}</span>
          <div className="xp">
            <div className="xp-fill" style={{ width: `${(level.into / level.span) * 100}%` }} />
          </div>
        </div>
        <div className="mini">
          <span className="mini-label">Streak</span>
          <span className="mini-value">{streak > 0 ? `${streak}d` : '—'}</span>
        </div>
        <div className="mini">
          <span className="mini-label">Window turns</span>
          <span className="mini-value">{count(snapshot.window.totals.turns)}</span>
        </div>
        <div className="mini">
          <span className="mini-label">Cut off</span>
          <span className="mini-value">{count(snapshot.limitHits.length)}</span>
        </div>
      </div>
    </section>
  );
}
