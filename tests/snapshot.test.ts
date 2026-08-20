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

  it('reports what the current session window holds', () => {
    const now = Date.parse('2026-08-21T12:00:00Z');
    const snapshot = buildSnapshot(
      [
        usageRecord({ output: 500 }, { timestamp: '2026-08-21T11:30:00Z' }), // inside 5h
        usageRecord({ output: 900 }, { timestamp: '2026-08-21T02:00:00Z' }), // long past
      ],
      table,
      'UTC',
      { now },
    );

    expect(snapshot.window.totals.tokens.output).toBe(500);
    expect(snapshot.window.totals.turns).toBe(1);
  });

  it('measures the ceiling from the window that actually ended in a refusal', () => {
    // The quota is not in the transcripts. What is, is the moment you were cut
    // off — so the ceiling is observed rather than declared.
    const hitAt = '2026-08-21T09:00:00Z';
    const snapshot = buildSnapshot(
      [
        usageRecord({ output: 700 }, { timestamp: '2026-08-21T06:00:00Z' }),
        usageRecord({ output: 300 }, { timestamp: '2026-08-21T08:59:00Z' }),
        usageRecord({ output: 999 }, { timestamp: '2026-08-21T10:00:00Z' }), // after the cut
      ],
      table,
      'UTC',
      { now: Date.parse('2026-08-21T12:00:00Z'), limits: [{ at: hitAt, scope: 'session', notice: 'x' }] },
    );

    expect(snapshot.observedCeiling).toBe(1000);
    expect(snapshot.limitHits).toHaveLength(1);
  });

  it('has no ceiling to report before a limit has ever been hit', () => {
    const snapshot = buildSnapshot([usageRecord({ output: 5 })], table, 'UTC');

    expect(snapshot.observedCeiling).toBeNull();
    expect(snapshot.limitHits).toEqual([]);
  });

  it('records the zone the days were bucketed in', () => {
    const snapshot = buildSnapshot([], table, 'Asia/Shanghai');

    expect(snapshot.timeZone).toBe('Asia/Shanghai');
    expect(snapshot.totals.turns).toBe(0);
    expect(snapshot.byDay).toEqual([]);
  });
});
