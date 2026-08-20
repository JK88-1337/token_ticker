import { describe, expect, it } from 'vitest';
import { bucketBy, bucketByDay, totalUsage } from '../src/core/summary.js';
import { testPricingTable as table, usageRecord } from './fixtures.js';

const MILLION = 1_000_000;

describe('totalUsage', () => {
  it('adds up turns, tokens and cost across records', () => {
    const totals = totalUsage(
      [usageRecord({ input: MILLION, output: 1000 }), usageRecord({ input: MILLION, output: 3000 })],
      table,
    );

    expect(totals.turns).toBe(2);
    expect(totals.tokens.input).toBe(2 * MILLION);
    expect(totals.tokens.output).toBe(4000);
    expect(totals.usd).toBeCloseTo(20.2, 10);
  });

  it('surfaces how many turns had no rate, so $0 is not mistaken for free', () => {
    const totals = totalUsage(
      [
        usageRecord({ input: MILLION }),
        usageRecord({ input: MILLION }, { model: 'claude-from-the-future' }),
      ],
      table,
    );

    expect(totals.turns).toBe(2);
    expect(totals.unpricedTurns).toBe(1);
    // The unpriced turn's tokens still count — only its cost is unknown.
    expect(totals.tokens.input).toBe(2 * MILLION);
    expect(totals.usd).toBeCloseTo(10, 10);
  });

  it('is zero for no records at all', () => {
    const totals = totalUsage([], table);

    expect(totals.turns).toBe(0);
    expect(totals.usd).toBe(0);
    expect(totals.tokens).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
    });
  });
});

describe('bucketByDay', () => {
  // Turns are timestamped in UTC, but "what did I spend today" is a question
  // about the local calendar, so the zone decides which day a turn lands in.
  const lateEvening = usageRecord({ input: MILLION }, { timestamp: '2026-08-20T23:30:00Z' });
  const midMorning = usageRecord({ input: MILLION }, { timestamp: '2026-08-20T10:00:00Z' });

  it('splits a turn into the next day when the local zone has already rolled over', () => {
    const buckets = bucketByDay([midMorning, lateEvening], table, 'Asia/Shanghai');

    expect(buckets.map((b) => b.key)).toEqual(['2026-08-20', '2026-08-21']);
    expect(buckets[0]?.totals.turns).toBe(1);
    expect(buckets[1]?.totals.turns).toBe(1);
  });

  it('keeps both turns on one day in a zone where they share a date', () => {
    const buckets = bucketByDay([midMorning, lateEvening], table, 'UTC');

    expect(buckets.map((b) => b.key)).toEqual(['2026-08-20']);
    expect(buckets[0]?.totals.turns).toBe(2);
    expect(buckets[0]?.totals.usd).toBeCloseTo(20, 10);
  });

  it('returns days in chronological order regardless of input order', () => {
    const buckets = bucketByDay(
      [
        usageRecord({}, { timestamp: '2026-08-22T12:00:00Z' }),
        usageRecord({}, { timestamp: '2026-08-19T12:00:00Z' }),
        usageRecord({}, { timestamp: '2026-08-21T12:00:00Z' }),
      ],
      table,
      'UTC',
    );

    expect(buckets.map((b) => b.key)).toEqual(['2026-08-19', '2026-08-21', '2026-08-22']);
  });
});

describe('bucketBy', () => {
  it('groups on any field the caller picks', () => {
    const buckets = bucketBy(
      [
        usageRecord({ output: 1000 }, { projectPath: 'alpha' }),
        usageRecord({ output: 2000 }, { projectPath: 'beta' }),
        usageRecord({ output: 4000 }, { projectPath: 'alpha' }),
      ],
      table,
      (record) => record.projectPath,
    );

    expect(buckets.map((b) => b.key)).toEqual(['alpha', 'beta']);
    expect(buckets[0]?.totals.tokens.output).toBe(5000);
    expect(buckets[0]?.totals.turns).toBe(2);
    expect(buckets[1]?.totals.tokens.output).toBe(2000);
  });
});
