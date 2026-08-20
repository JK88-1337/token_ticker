import shippedTable from './pricing-table.json' with { type: 'json' };
import type { UsageRecord } from './records.js';

/** USD per million tokens. */
export interface ModelRate {
  input: number;
  output: number;
  /** Premium rate for fast mode, on the models that offer it. */
  fast?: ModelRate;
  /**
   * A launch discount and the instant it stops applying. Turns are priced by
   * the rate that was in force when they ran, so history stays correct after
   * the window closes.
   */
  introductory?: IntroductoryRate;
}

export interface IntroductoryRate {
  /** ISO 8601 instant; the discount applies strictly before this. */
  untilExclusive: string;
  input: number;
  output: number;
}

/**
 * Cache tokens are priced as multiples of a model's input rate rather than
 * quoted separately, so one set of multipliers covers every model.
 */
export interface CacheMultipliers {
  read: number;
  write5m: number;
  write1h: number;
}

export interface PricingTable {
  /** Where the rates came from, so a stale total can be traced. */
  source?: string;
  checkedOn?: string;
  note?: string;
  cacheMultipliers: CacheMultipliers;
  batchMultiplier: number;
  models: Record<string, ModelRate>;
}

/**
 * The rates shipped with the app. Editing
 * [pricing-table.json](./pricing-table.json) is enough to correct a price or
 * add a model — no code change needed.
 */
export const defaultPricingTable: PricingTable = shippedTable;

export interface RecordCost {
  usd: number;
  /**
   * False when the table holds no rate for this model. `usd` is then 0, and
   * the caller must surface the turn as unpriced rather than let it silently
   * pull the total down.
   */
  priced: boolean;
}

const PER_MILLION = 1_000_000;

/** The launch discount, if one was still running when the turn was made. */
function introductoryRateFor(rate: ModelRate, timestamp: string): ModelRate | null {
  const intro = rate.introductory;
  if (!intro) return null;

  const ranAt = Date.parse(timestamp);
  const endsAt = Date.parse(intro.untilExclusive);
  // An unparseable timestamp must not silently earn a discount.
  if (Number.isNaN(ranAt) || Number.isNaN(endsAt) || ranAt >= endsAt) return null;

  return { input: intro.input, output: intro.output };
}

/** What one API call cost, at pay-as-you-go rates. */
export function priceRecord(record: UsageRecord, table: PricingTable): RecordCost {
  const base = table.models[record.model];
  if (!base) return { usd: 0, priced: false };

  // Fast mode is the same model at a premium rate; models without one are
  // simply never served fast, so the standard rate still applies. Fast mode is
  // excluded from launch discounts, so the two never combine.
  const rate =
    record.speed === 'fast' ? (base.fast ?? base) : (introductoryRateFor(base, record.timestamp) ?? base);
  const { tokens } = record;

  const cache = table.cacheMultipliers;
  const usd =
    (tokens.input * rate.input +
      tokens.output * rate.output +
      tokens.cacheRead * rate.input * cache.read +
      tokens.cacheWrite5m * rate.input * cache.write5m +
      tokens.cacheWrite1h * rate.input * cache.write1h) /
    PER_MILLION;

  // The batch tier trades latency for a flat discount on everything.
  const discount = record.serviceTier === 'batch' ? table.batchMultiplier : 1;

  return { usd: usd * discount, priced: true };
}
