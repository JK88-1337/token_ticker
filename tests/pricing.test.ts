import { describe, expect, it } from 'vitest';
import { priceRecord } from '../src/core/pricing.js';
import { testPricingTable as table, usageRecord as record } from './fixtures.js';

const MILLION = 1_000_000;

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
