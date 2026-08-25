/**
 * The snapshot read as a board of quotes.
 *
 * A ticker needs a figure and a move, and a move needs something to have
 * moved from. The only prior period the snapshot actually carries is a day
 * bucket, so a day is the only thing a quote here is ever compared against —
 * a model is bucketed over all time and never per day, so it has no move to
 * report and never gets an arrow. Nothing is annualised or smoothed.
 */

import { totalTokens } from '../core/limits.js';
import type { TokenCounts } from '../core/records.js';
import type { UsageSnapshot } from '../core/snapshot.js';
import type { UsageBucket } from '../core/summary.js';

/** What a quote's figure is counted in, so a view can format it. */
export type QuoteUnit = 'tokens' | 'usd' | 'turns';

export interface Quote {
  symbol: string;
  value: number;
  unit: QuoteUnit;
  /**
   * Fractional change against the comparison day — 0.124 is up 12.4%.
   *
   * Null when there is nothing honest to compare against: no earlier day on
   * record, or an earlier day that was zero on this line, which would make
   * the change infinite.
   */
  change: number | null;
}

/** Which way a quote moved, for the arrow and the colour. */
export function direction(change: number | null): 'up' | 'down' | 'flat' | 'none' {
  if (change === null) return 'none';
  if (change > 0.0005) return 'up';
  if (change < -0.0005) return 'down';
  return 'flat';
}

/** `claude-opus-4-8` reads as `OPUS-4-8`; a dated id drops its date. */
export function modelSymbol(model: string): string {
  return model
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .toUpperCase();
}

/**
 * The most recent day with usage on it before `key`.
 *
 * Not the calendar day before. A day off leaves no bucket at all, and
 * comparing against a day that never happened would mark every line as
 * unmeasurable — a board of dashes on the first morning back. The last day
 * you actually worked is a real period with real figures, so that is what
 * today is quoted against, and the view says which day it was.
 *
 * `byDay` is ordered oldest first, so the last key below today is it.
 */
function lastActiveDayBefore(byDay: readonly UsageBucket[], key: string): UsageBucket | undefined {
  let found: UsageBucket | undefined;
  for (const bucket of byDay) {
    if (bucket.key >= key) break;
    found = bucket;
  }
  return found;
}

const change = (today: number, yesterday: number): number | null =>
  yesterday > 0 ? (today - yesterday) / yesterday : null;

/** Cache writes are billed at two lifetimes but read as one line. */
const cacheWrite = (counts: TokenCounts): number => counts.cacheWrite5m + counts.cacheWrite1h;

const EMPTY: TokenCounts = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  thinking: 0,
};

/** A board of quotes, and the day they are all measured against. */
export interface Board {
  /** The day key today is compared with, or null when today is the first. */
  against: string | null;
  quotes: Quote[];
}

/**
 * Today against the last day you worked, line by line.
 *
 * The order is fixed rather than sorted by size: a board that reshuffles
 * itself as the day goes on cannot be read at a glance, and cache reads would
 * hold the top of it forever anyway.
 */
export function dayQuotes(snapshot: UsageSnapshot, todayKey: string): Board {
  const today = snapshot.byDay.find((bucket) => bucket.key === todayKey);
  const before = lastActiveDayBefore(snapshot.byDay, todayKey);

  const now = today?.totals.tokens ?? EMPTY;
  const then = before?.totals.tokens ?? EMPTY;

  const row = (symbol: string, pick: (counts: TokenCounts) => number): Quote => ({
    symbol,
    value: pick(now),
    unit: 'tokens',
    change: change(pick(now), pick(then)),
  });

  const quotes: Quote[] = [
    row('TOTAL', totalTokens),
    row('CACHE-R', (counts) => counts.cacheRead),
    row('CACHE-W', cacheWrite),
    row('INPUT', (counts) => counts.input),
    row('OUTPUT', (counts) => counts.output),
    row('THINK', (counts) => counts.thinking),
    {
      symbol: 'TURNS',
      value: today?.totals.turns ?? 0,
      unit: 'turns',
      change: change(today?.totals.turns ?? 0, before?.totals.turns ?? 0),
    },
    {
      symbol: 'VALUE',
      value: today?.totals.usd ?? 0,
      unit: 'usd',
      change: change(today?.totals.usd ?? 0, before?.totals.usd ?? 0),
    },
  ];

  return { against: before?.key ?? null, quotes };
}

/**
 * The models, as lifetime holdings.
 *
 * No arrow: the snapshot buckets models over all time and days separately,
 * never both at once, so a model's day-on-day move is not something this can
 * know. Share of lifetime spend is what it can honestly say.
 */
export function modelQuotes(snapshot: UsageSnapshot): (Quote & { share: number })[] {
  const total = snapshot.totals.usd;

  return snapshot.byModel.map((bucket) => ({
    symbol: modelSymbol(bucket.key),
    value: bucket.totals.usd,
    unit: 'usd' as const,
    change: null,
    share: total > 0 ? bucket.totals.usd / total : 0,
  }));
}
