import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/core/snapshot.js';
import { testPricingTable as table, usageRecord } from './fixtures.js';

const MILLION = 1_000_000;

describe('buildSnapshot', () => {
  it('reports the totals across everything it was given', () => {
    const snapshot = buildSnapshot(
      [usageRecord({ input: MILLION }), usageRecord({ input: MILLION })],
      table,
      'UTC',
    );

    expect(snapshot.totals.turns).toBe(2);
    expect(snapshot.totals.usd).toBeCloseTo(20, 10);
  });

  it('orders days oldest first, so a trend reads left to right', () => {
    const snapshot = buildSnapshot(
      [
        usageRecord({}, { timestamp: '2026-08-22T12:00:00Z' }),
        usageRecord({}, { timestamp: '2026-08-19T12:00:00Z' }),
      ],
      table,
      'UTC',
    );

    expect(snapshot.byDay.map((b) => b.key)).toEqual(['2026-08-19', '2026-08-22']);
  });

  it('orders models and projects by spend, so the expensive ones lead', () => {
    const snapshot = buildSnapshot(
      [
        usageRecord({ input: MILLION }, { model: 'no-fast-model', projectPath: 'cheap' }),
        usageRecord({ output: MILLION }, { model: 'test-model', projectPath: 'dear' }),
      ],
      table,
      'UTC',
    );

    expect(snapshot.byModel.map((b) => b.key)).toEqual(['test-model', 'no-fast-model']);
    expect(snapshot.byProject.map((b) => b.key)).toEqual(['dear', 'cheap']);
  });

  it('carries the recent turns the live view plays back, oldest first', () => {
    const snapshot = buildSnapshot(
      [
        usageRecord({ output: 10 }, { timestamp: '2026-08-21T09:00:00Z' }),
        usageRecord({ output: 10 }, { timestamp: '2026-08-21T08:00:00Z' }),
      ],
      table,
      'UTC',
    );

    expect(snapshot.recent.map((event) => event.at)).toEqual([
      '2026-08-21T08:00:00Z',
      '2026-08-21T09:00:00Z',
    ]);
    expect(snapshot.recent[0]?.usd).toBeGreaterThan(0);
  });

  it('caps the recent turns so the payload stays bounded', () => {
    const many = Array.from({ length: 900 }, (_, i) =>
      usageRecord({ output: 1 }, { timestamp: new Date(Date.UTC(2026, 7, 21, 0, i)).toISOString() }),
    );

    const snapshot = buildSnapshot(many, table, 'UTC');

    expect(snapshot.recent).toHaveLength(500);
    // The cap keeps the newest, never the oldest.
    expect(snapshot.recent.at(-1)?.at).toBe(many.at(-1)?.timestamp);
  });

  it('records the zone the days were bucketed in', () => {
    const snapshot = buildSnapshot([], table, 'Asia/Shanghai');

    expect(snapshot.timeZone).toBe('Asia/Shanghai');
    expect(snapshot.totals.turns).toBe(0);
    expect(snapshot.byDay).toEqual([]);
  });
});
