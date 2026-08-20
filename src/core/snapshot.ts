import type { PricingTable } from './pricing.js';
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
}

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
  };
}
