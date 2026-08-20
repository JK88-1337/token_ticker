import { priceRecord, type PricingTable } from './pricing.js';
import type { TokenCounts, UsageRecord } from './records.js';

/** What a set of turns came to, in tokens and money. */
export interface UsageTotals {
  turns: number;
  tokens: TokenCounts;
  usd: number;
  /**
   * Turns whose model has no rate in the table. Their tokens are included
   * above but their cost is not, so `usd` is a floor whenever this is
   * non-zero — the UI has to say so rather than present it as the total.
   */
  unpricedTurns: number;
}

function emptyTokens(): TokenCounts {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
}

/** Rolls a set of records into one figure per token class, plus cost. */
export function totalUsage(
  records: Iterable<UsageRecord>,
  table: PricingTable,
): UsageTotals {
  const tokens = emptyTokens();
  let turns = 0;
  let usd = 0;
  let unpricedTurns = 0;

  for (const record of records) {
    turns++;
    const cost = priceRecord(record, table);
    if (cost.priced) usd += cost.usd;
    else unpricedTurns++;
    tokens.input += record.tokens.input;
    tokens.output += record.tokens.output;
    tokens.cacheRead += record.tokens.cacheRead;
    tokens.cacheWrite5m += record.tokens.cacheWrite5m;
    tokens.cacheWrite1h += record.tokens.cacheWrite1h;
  }

  return { turns, tokens, usd, unpricedTurns };
}

/** A slice of usage, labelled by whatever it was grouped on. */
export interface UsageBucket {
  key: string;
  totals: UsageTotals;
}

/** Groups records by an arbitrary key, ordered by that key. */
export function bucketBy(
  records: Iterable<UsageRecord>,
  table: PricingTable,
  keyOf: (record: UsageRecord) => string,
): UsageBucket[] {
  const grouped = new Map<string, UsageRecord[]>();

  for (const record of records) {
    const key = keyOf(record);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(record);
    else grouped.set(key, [record]);
  }

  return [...grouped]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, group]) => ({ key, totals: totalUsage(group, table) }));
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The calendar day a turn belongs to, as `YYYY-MM-DD`.
 *
 * Transcripts timestamp turns in UTC, but "what did I spend today" is a
 * question about the local calendar — a turn at 23:30 UTC already belongs to
 * tomorrow in Shanghai. The zone therefore has to be an argument rather than
 * an assumption, so the same records can be re-sliced without reparsing.
 */
export function dayKey(timestamp: string, timeZone: string): string {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    // en-CA renders as YYYY-MM-DD, which sorts lexicographically.
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dayFormatters.set(timeZone, formatter);
  }

  return formatter.format(new Date(timestamp));
}

/** Groups records into local calendar days, oldest first. */
export function bucketByDay(
  records: Iterable<UsageRecord>,
  table: PricingTable,
  timeZone: string,
): UsageBucket[] {
  return bucketBy(records, table, (record) => dayKey(record.timestamp, timeZone));
}
