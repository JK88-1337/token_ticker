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
  /** Tokens excluding cache reads — the measure the allowance gauge uses. */
  work: number;
}

const MINUTE_MS = 60_000;

/**
 * The window every pace on the board is measured over.
 *
 * Shared so the rate beside the flap and the candles under it are the same
 * measurement at different resolutions, rather than two figures that disagree.
 */
export const RATE_WINDOW_MS = MINUTE_MS;

/**
 * How often the pace is sampled for the candles.
 *
 * Twelve readings to the minute, which is what gives a one-minute candle a
 * body and a wick instead of a single dash. Finer than this buys nothing: the
 * rate is a step function that only moves when a turn lands or ages out, so
 * samples between two such moments are copies of each other.
 */
export const RATE_SAMPLE_MS = 5_000;
const HOUR_MS = 60 * MINUTE_MS;

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
 * Tokens per minute over the trailing window.
 *
 * A minute rather than a second because a turn is a lumpy thing: turns arrive
 * seconds apart and carry thousands of tokens each, so a per-second figure
 * spends most of its life reading zero and the rest spiking. Per minute the
 * same window reads as a pace someone can hold in their head.
 *
 * The window slides whether or not anything new arrives, so this rises the
 * moment a turn lands and drifts back down on its own while you read it.
 */
export function tokenRatePerMinute(
  events: readonly SpendEvent[],
  now: number,
  windowMs: number,
): number {
  if (windowMs <= 0) return 0;
  return (overWindow(events, now, windowMs, (event) => event.tokens) * MINUTE_MS) / windowMs;
}

/**
 * The trailing rate over time, oldest first.
 *
 * A cumulative count only ever rises and a single turn's size jumps about with
 * no memory, so neither can be read as a price. A trailing rate can: it
 * carries over from one period into the next — the rate at the end of a minute
 * is the rate at the start of the one after — and it falls on its own as turns
 * age out of the window. Rising means the work is speeding up, falling means
 * it is easing off, and it comes back to the pace being worked at rather than
 * drifting off the top of the chart.
 *
 * `stepMs` is the sampling rate, and it is what makes a short period readable.
 * Sampled at the turns alone, a minute holding one turn yields one point, and
 * a candle cut from one point has its open, high, low and close all equal — a
 * chart of dashes. On a clock the same minute yields a sample every step, and
 * the high and low are the real peak and trough the pace passed through: the
 * rate steps up as each turn lands and steps down as each one ages out of the
 * window, and those moves happen between turns, not at them.
 *
 * Sampling stops whenever the window empties, and resumes at the next turn.
 * Idle hours therefore produce no samples at all rather than a floor of
 * zeroes: a gap stays a gap, and every value plotted is one the rate really
 * stood at. Omit `stepMs` to sample at the turns alone.
 */
export function rateSeries(
  events: readonly { at: string; tokens: number }[],
  windowMs: number,
  stepMs = 0,
): { at: string; value: number; weight: number }[] {
  if (windowMs <= 0) return [];

  const ordered = events
    .map((event) => ({ at: Date.parse(event.at), tokens: event.tokens }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort((a, b) => a.at - b.at);

  // Every moment worth a sample, and what — if anything — was spent at it.
  const moments = new Map<number, number>();
  for (const entry of ordered) {
    moments.set(entry.at, (moments.get(entry.at) ?? 0) + entry.tokens);
    if (stepMs <= 0) continue;

    // The clock runs from this turn until the window would have emptied; a
    // later turn extends it again, which is what keeps a busy stretch dense
    // and leaves a quiet one alone.
    const firstTick = Math.floor(entry.at / stepMs) * stepMs + stepMs;
    for (let tick = firstTick; tick < entry.at + windowMs; tick += stepMs) {
      if (!moments.has(tick)) moments.set(tick, 0);
    }
  }

  let first = 0;
  let last = 0;
  let inWindow = 0;

  return [...moments.keys()]
    .sort((a, b) => a - b)
    .map((at) => {
      while (last < ordered.length && ordered[last]!.at <= at) {
        inWindow += ordered[last]!.tokens;
        last++;
      }
      while (first < last && at - ordered[first]!.at >= windowMs) {
        inWindow -= ordered[first]!.tokens;
        first++;
      }

      return {
        at: new Date(at).toISOString(),
        value: (inWindow * MINUTE_MS) / windowMs,
        // Only a turn weighs anything: a clock sample is a reading, not a
        // spend, so a period's volume stays what it actually cost.
        weight: moments.get(at)!,
      };
    });
}

/**
 * What the last `windowMs` would come to if it kept up for an hour./**
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

/** A pause longer than this ends a run of turns. */
export const COMBO_GAP_MS = 120_000;

/** A name for a run, once it is long enough to be worth naming. */
export interface ComboTier {
  rank: number;
  name: string;
}

/** The ladder, lowest first. Exported so a view can show what is next. */
export const COMBO_TIERS: readonly (ComboTier & { from: number })[] = [
  { from: 2, rank: 1, name: 'WARMING UP' },
  { from: 5, rank: 2, name: 'ROLLING' },
  { from: 10, rank: 3, name: 'ON FIRE' },
  { from: 25, rank: 4, name: 'RELENTLESS' },
  { from: 50, rank: 5, name: 'UNSTOPPABLE' },
];

/** What to call the current run, or nothing if it is too short to brag about. */
export function comboTier(combo: number): ComboTier | null {
  let found: ComboTier | null = null;
  for (const tier of COMBO_TIERS) {
    if (combo >= tier.from) found = { rank: tier.rank, name: tier.name };
  }
  return found;
}

/**
 * How long the live run has before a pause would break it.
 *
 * The thing a combo actually is: not a score, but a clock that has to be
 * beaten. Nothing left means there is no run to lose — either none has
 * started or the gap has already passed.
 */
export function comboTimeLeft(timestamps: readonly string[], now: number, gapMs: number): number {
  const last = timestamps
    .map((stamp) => Date.parse(stamp))
    .filter((at) => Number.isFinite(at) && at <= now)
    .reduce((latest, at) => Math.max(latest, at), -Infinity);

  if (!Number.isFinite(last)) return 0;
  return Math.max(0, gapMs - (now - last));
}

/** The rung above the current run, and the turns still to climb to it. */
export function nextComboTier(combo: number): (ComboTier & { from: number; toGo: number }) | null {
  const next = COMBO_TIERS.find((tier) => combo < tier.from);
  return next ? { ...next, toGo: next.from - combo } : null;
}

/**
 * The longest unbroken run anywhere in the history./**
 * The longest unbroken run anywhere in the history.
 *
 * The record a live combo is measured against. Unlike {@link comboLength} this
 * ignores how long ago it happened — it is a personal best, not a live state.
 */
export function longestCombo(timestamps: readonly string[], gapMs: number): number {
  const times = timestamps
    .map((stamp) => Date.parse(stamp))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);

  let best = 0;
  let run = 0;
  let previous: number | undefined;

  for (const time of times) {
    run = previous !== undefined && time - previous <= gapMs ? run + 1 : 1;
    if (run > best) best = run;
    previous = time;
  }

  return best;
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
