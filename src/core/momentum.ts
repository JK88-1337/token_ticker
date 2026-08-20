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
  /** Every token class added together. */
  tokens: number;
}

const HOUR_MS = 60 * 60 * 1000;

/** Adds up one field of the turns inside a trailing window. */
function overWindow(
  events: readonly SpendEvent[],
  now: number,
  windowMs: number,
  pick: (event: SpendEvent) => number,
): number {
  const since = now - windowMs;
  let total = 0;
  for (const event of events) {
    const at = Date.parse(event.at);
    if (Number.isFinite(at) && at >= since && at <= now) total += pick(event);
  }
  return total;
}

/**
 * Tokens per second over the trailing window.
 *
 * The window slides whether or not anything new arrives, so this rises the
 * moment a turn lands and drifts back down on its own while you read it.
 */
export function tokenRatePerSecond(
  events: readonly SpendEvent[],
  now: number,
  windowMs: number,
): number {
  if (windowMs <= 0) return 0;
  return (overWindow(events, now, windowMs, (event) => event.tokens) * 1000) / windowMs;
}

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

  const spent = overWindow(events, now, windowMs, (event) => event.usd);
  return spent === 0 ? 0 : (spent * HOUR_MS) / windowMs;
}

/** A name for a run, once it is long enough to be worth naming. */
export interface ComboTier {
  rank: number;
  name: string;
}

const TIERS: readonly (ComboTier & { from: number })[] = [
  { from: 2, rank: 1, name: 'WARMING UP' },
  { from: 5, rank: 2, name: 'ROLLING' },
  { from: 10, rank: 3, name: 'ON FIRE' },
  { from: 25, rank: 4, name: 'RELENTLESS' },
  { from: 50, rank: 5, name: 'UNSTOPPABLE' },
];

/** What to call the current run, or nothing if it is too short to brag about. */
export function comboTier(combo: number): ComboTier | null {
  let found: ComboTier | null = null;
  for (const tier of TIERS) {
    if (combo >= tier.from) found = { rank: tier.rank, name: tier.name };
  }
  return found;
}

/** The first level costs this many tokens; each one after costs more. */
const LEVEL_BASE = 1_000_000;
const LEVEL_GROWTH = 1.6;

export interface Level {
  level: number;
  /** Tokens earned into the current level. */
  into: number;
  /** Tokens the current level spans end to end. */
  span: number;
}

/**
 * The level a lifetime token count has reached.
 *
 * Thresholds grow geometrically, so the hundreds of millions real use reaches
 * land in the low teens rather than running off the end of a table — early
 * levels come quickly and later ones stay worth chasing.
 */
export function levelFor(tokens: number): Level {
  const total = Math.max(0, tokens);

  let level = 1;
  let lower = 0;
  let upper = LEVEL_BASE;
  while (total >= upper) {
    level++;
    lower = upper;
    upper = LEVEL_BASE * Math.pow(LEVEL_GROWTH, level - 1);
  }

  return { level, into: total - lower, span: upper - lower };
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
