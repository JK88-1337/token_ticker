import { describe, expect, it } from 'vitest';
import { priceRecord, type PricingTable } from '../src/core/pricing.js';
import type { TokenCounts, UsageRecord } from '../src/core/records.js';

/**
 * A table with round numbers, so the arithmetic under test is obvious and the
 * assertions do not have to change every time a real price does.
 */
const table: PricingTable = {
  cacheMultipliers: { read: 0.1, write5m: 1.25, write1h: 2 },
  batchMultiplier: 0.5,
  models: {
    'test-model': { input: 10, output: 50, fast: { input: 20, output: 100 } },
    'no-fast-model': { input: 10, output: 50 },
    'intro-model': {
      input: 10,
      output: 50,
      introductory: { untilExclusive: '2026-09-01T00:00:00Z', input: 2, output: 10 },
    },
  },
};

const MILLION = 1_000_000;

function record(tokens: Partial<TokenCounts>, rest: Partial<UsageRecord> = {}): UsageRecord {
  return {
    requestId: 'req_1',
    timestamp: '2026-07-15T10:24:37.187Z',
    model: 'test-model',
    sessionId: 'session-1',
    projectPath: 'C:\\projects\\demo',
    gitBranch: 'main',
    isSidechain: false,
    speed: 'standard',
    serviceTier: 'standard',
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, ...tokens },
    ...rest,
  };
}

describe('priceRecord', () => {
  it('charges input and output at the model rate', () => {
    const cost = priceRecord(record({ input: MILLION, output: MILLION }), table);

    expect(cost.usd).toBeCloseTo(60, 10);
  });

  it('prices each cache tier as its own multiple of the input rate', () => {
    // read 0.1x, 5m write 1.25x, 1h write 2x — of $10/M input.
    const cost = priceRecord(
      record({ cacheRead: MILLION, cacheWrite5m: MILLION, cacheWrite1h: MILLION }),
      table,
    );

    expect(cost.usd).toBeCloseTo(1 + 12.5 + 20, 10);
  });

  it('halves the bill for turns served on the batch tier', () => {
    const cost = priceRecord(
      record({ input: MILLION, output: MILLION }, { serviceTier: 'batch' }),
      table,
    );

    expect(cost.usd).toBeCloseTo(30, 10);
  });

  it('charges the premium rate for fast mode', () => {
    const cost = priceRecord(
      record({ input: MILLION, output: MILLION }, { speed: 'fast' }),
      table,
    );

    expect(cost.usd).toBeCloseTo(120, 10);
  });

  it('falls back to the standard rate when a model has no fast pricing', () => {
    const cost = priceRecord(
      record({ input: MILLION, output: MILLION }, { model: 'no-fast-model', speed: 'fast' }),
      table,
    );

    expect(cost.usd).toBeCloseTo(60, 10);
  });

  it('reports an unknown model as unpriced instead of free', () => {
    // A model released after the table was written must not quietly shrink the
    // total — the tokens are real, only the rate is missing.
    const cost = priceRecord(
      record({ input: MILLION, output: MILLION }, { model: 'claude-from-the-future' }),
      table,
    );

    expect(cost.priced).toBe(false);
    expect(cost.usd).toBe(0);
  });

  it('bills a turn at the introductory rate that was in force when it ran', () => {
    const cost = priceRecord(
      record(
        { input: MILLION, output: MILLION },
        { model: 'intro-model', timestamp: '2026-08-20T12:00:00Z' },
      ),
      table,
    );

    expect(cost.usd).toBeCloseTo(12, 10);
  });

  it('bills a turn from after the introductory window at the standard rate', () => {
    const cost = priceRecord(
      record(
        { input: MILLION, output: MILLION },
        { model: 'intro-model', timestamp: '2026-09-01T00:00:00Z' },
      ),
      table,
    );

    expect(cost.usd).toBeCloseTo(60, 10);
  });

  it('marks a priced turn as priced', () => {
    expect(priceRecord(record({ input: MILLION }), table).priced).toBe(true);
  });
});
