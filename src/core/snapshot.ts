import type { SpendEvent } from './momentum.js';
import { priceRecord, type PricingTable } from './pricing.js';
import type { UsageRecord } from './records.js';
import { bucketBy, bucketByDay, totalUsage, type UsageBucket, type UsageTotals } from './summary.js';

/**
 * Everything the dashboard draws, in one serialisable object.
 *
 * This is the contract between whatever reads the filesystem and whatever
 * renders — a dev server over HTTP today, Electron IPC later. Aggregation
 * happens before it crosses that boundary so the payload stays small no matter
 * how much history there is.
 */
export interface UsageSnapshot {
  /** When this was computed, so a stale view can say so. */
  generatedAt: string;
  /** The zone `byDay` was bucketed in. */
  timeZone: string;
  totals: UsageTotals;
  /** Oldest day first, so a trend reads left to right. */
  byDay: UsageBucket[];
  /** Dearest first. */
  byModel: UsageBucket[];
  /** Dearest first. */
  byProject: UsageBucket[];
  /**
   * The most recent turns, oldest first — what the live view replays as a
   * combo and a burn rate. Capped, because this is the one part of the
   * snapshot that would otherwise grow with history.
   */
  recent: SpendEvent[];
}

/** How many recent turns travel with a snapshot. */
const RECENT_LIMIT = 500;

const byCost = (a: UsageBucket, b: UsageBucket) => b.totals.usd - a.totals.usd;

/** Rolls deduplicated records into the shape the dashboard consumes. */
export function buildSnapshot(
  records: readonly UsageRecord[],
  table: PricingTable,
  timeZone: string,
): UsageSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    timeZone,
    totals: totalUsage(records, table),
    byDay: bucketByDay(records, table, timeZone),
    byModel: bucketBy(records, table, (record) => record.model).sort(byCost),
    byProject: bucketBy(records, table, (record) => record.projectPath).sort(byCost),
    recent: recentEvents(records, table),
  };
}

/** The newest turns, oldest first, reduced to time and cost. */
function recentEvents(records: readonly UsageRecord[], table: PricingTable): SpendEvent[] {
  return [...records]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-RECENT_LIMIT)
    .map((record) => ({ at: record.timestamp, usd: priceRecord(record, table).usd }));
}
