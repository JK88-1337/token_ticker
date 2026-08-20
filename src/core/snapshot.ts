import {
  peakWindowTokens,
  totalTokens,
  windowTokens,
  workTokens,
  type LimitEvent,
  type PeakWindow,
  type WindowTotals,
} from './limits.js';
import { COMBO_GAP_MS, longestCombo, type SpendEvent } from './momentum.js';
import { priceRecord, type PricingTable } from './pricing.js';
import type { UsageRecord } from './records.js';

import { bucketBy, bucketByDay, totalUsage, type UsageBucket, type UsageTotals } from './summary.js';

/** The rolling allowance window Claude Code calls a session. */
export const SESSION_WINDOW_MS = 5 * 60 * 60 * 1000;

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
  /** The allowance window in progress right now. */
  window: { ms: number; totals: WindowTotals };
  /** The busiest window of the same length in the whole history. */
  peak: PeakWindow;
  /** Every time the API refused a turn because an allowance ran out. */
  limitHits: LimitEvent[];
  /**
   * Work tokens in the window that ended at the most recent refusal — the
   * only ceiling the transcripts can actually evidence. Null until you have
   * been cut off at least once.
   */
  observedCeiling: number | null;
  /** The longest unbroken run of turns ever recorded — the combo to beat. */
  bestCombo: number;
}

export interface SnapshotOptions {
  limits?: readonly LimitEvent[];
  /** Overridable so the window is testable. */
  now?: number;
}

/** How many recent turns travel with a snapshot. */
const RECENT_LIMIT = 500;

const byCost = (a: UsageBucket, b: UsageBucket) => b.totals.usd - a.totals.usd;

/** Rolls deduplicated records into the shape the dashboard consumes. */
export function buildSnapshot(
  records: readonly UsageRecord[],
  table: PricingTable,
  timeZone: string,
  options: SnapshotOptions = {},
): UsageSnapshot {
  const now = options.now ?? Date.now();
  const limitHits = [...(options.limits ?? [])].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );

  return {
    generatedAt: new Date(now).toISOString(),
    timeZone,
    totals: totalUsage(records, table),
    byDay: bucketByDay(records, table, timeZone),
    byModel: bucketBy(records, table, (record) => record.model).sort(byCost),
    byProject: bucketBy(records, table, (record) => record.projectPath).sort(byCost),
    recent: recentEvents(records, table),
    window: { ms: SESSION_WINDOW_MS, totals: windowTokens(records, now, SESSION_WINDOW_MS) },
    peak: peakWindowTokens(records, SESSION_WINDOW_MS),
    limitHits,
    observedCeiling: ceilingFrom(records, limitHits),
    bestCombo: longestCombo(
      records.map((record) => record.timestamp),
      COMBO_GAP_MS,
    ),
  };
}

/**
 * What the window held at the moment it was refused.
 *
 * Cache reads are left out: they swamp every other class and are the cheapest
 * thing billed, so including them would make the reading swing with context
 * size rather than with effort.
 */
function ceilingFrom(
  records: readonly UsageRecord[],
  limitHits: readonly LimitEvent[],
): number | null {
  const latest = limitHits.at(-1);
  if (!latest) return null;

  const hitAt = Date.parse(latest.at);
  if (!Number.isFinite(hitAt)) return null;

  return workTokens(windowTokens(records, hitAt, SESSION_WINDOW_MS).tokens);
}

/** The newest turns, oldest first, reduced to time and cost. */
function recentEvents(records: readonly UsageRecord[], table: PricingTable): SpendEvent[] {
  return [...records]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-RECENT_LIMIT)
    .map((record) => ({
      at: record.timestamp,
      usd: priceRecord(record, table).usd,
      tokens: totalTokens(record.tokens),
      work: workTokens(record.tokens),
    }));
}
