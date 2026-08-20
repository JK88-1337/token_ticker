/**
 * The live-activity measures the dashboard plays back as a game.
 *
 * These read the same records everything else does — nothing here invents
 * numbers. A combo is a real run of turns without a pause; a burn rate is
 * real spend over a real window. The game is in the presentation, not the
 * arithmetic.
 */

/**
 * How many turns have arrived back-to-back, counting back from the newest.
 *
 * A pause longer than `gapMs` — including the pause between the newest turn
 * and now — breaks the run. So the combo decays on its own the moment you
 * stop working, which is what makes it worth watching.
 */
export function comboLength(timestamps: readonly string[], now: number, gapMs: number): number {
  const times = timestamps
    .map((stamp) => Date.parse(stamp))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => b - a);

  const newest = times[0];
  if (newest === undefined || now - newest > gapMs) return 0;

  let combo = 1;
  for (let i = 1; i < times.length; i++) {
    if (times[i - 1]! - times[i]! > gapMs) break;
    combo++;
  }

  return combo;
}

/** One billable turn, reduced to what the live view needs. */
export interface SpendEvent {
  at: string;
  usd: number;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * What the last `windowMs` would come to if it kept up for an hour.
 *
 * A rate, not a total, so it is honest to let it move between turns: the
 * window slides even when nothing new arrives, and the figure falls on its
 * own as recent spend ages out.
 */
export function burnRatePerHour(
  events: readonly SpendEvent[],
  now: number,
  windowMs: number,
): number {
  if (windowMs <= 0) return 0;

  const since = now - windowMs;
  let spent = 0;
  for (const event of events) {
    const at = Date.parse(event.at);
    if (Number.isFinite(at) && at >= since && at <= now) spent += event.usd;
  }

  return spent === 0 ? 0 : (spent * HOUR_MS) / windowMs;
}

/** The day before `key`, both as `YYYY-MM-DD`. */
function previousDay(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return key;
  const at = new Date(Date.UTC(year, month - 1, day) - 86_400_000);
  return at.toISOString().slice(0, 10);
}

/**
 * How many days in a row have seen usage.
 *
 * Counted back from today when today already has usage, and from yesterday
 * when it does not — a streak is not lost until the day it would break in has
 * actually ended.
 */
export function dailyStreak(dayKeys: readonly string[], todayKey: string): number {
  const days = new Set(dayKeys);

  let cursor = days.has(todayKey) ? todayKey : previousDay(todayKey);
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = previousDay(cursor);
  }

  return streak;
}
