import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/core/snapshot.js';
import { dayQuotes, direction, modelQuotes, modelSymbol } from '../src/ticker/quotes.js';
import { testPricingTable as table, usageRecord } from './fixtures.js';

const quote = (snapshot: ReturnType<typeof buildSnapshot>, symbol: string) =>
  dayQuotes(snapshot, '2026-08-20').quotes.find((entry) => entry.symbol === symbol)!;

/** Two days of records, so there is a yesterday to move against. */
function twoDays(yesterday: number, today: number) {
  return buildSnapshot(
    [
      usageRecord({ output: yesterday }, { timestamp: '2026-08-19T12:00:00Z' }),
      usageRecord({ output: today }, { timestamp: '2026-08-20T12:00:00Z' }),
    ],
    table,
    'UTC',
  );
}

describe('dayQuotes', () => {
  it('measures today against yesterday', () => {
    expect(quote(twoDays(1000, 1250), 'OUTPUT').change).toBeCloseTo(0.25, 10);
    expect(quote(twoDays(1000, 1250), 'OUTPUT').value).toBe(1250);
  });

  it('reports a fall as a fall', () => {
    expect(quote(twoDays(1000, 400), 'OUTPUT').change).toBeCloseTo(-0.6, 10);
  });

  it('leaves the change unset when there is no earlier day, rather than showing an infinite rise', () => {
    const snapshot = buildSnapshot(
      [usageRecord({ output: 500 }, { timestamp: '2026-08-20T12:00:00Z' })],
      table,
      'UTC',
    );

    expect(quote(snapshot, 'OUTPUT').change).toBeNull();
    expect(quote(snapshot, 'OUTPUT').value).toBe(500);
  });

  it('quotes against the last day that had usage, not the calendar day before', () => {
    const snapshot = buildSnapshot(
      [
        usageRecord({ output: 1000 }, { timestamp: '2026-08-15T12:00:00Z' }),
        usageRecord({ output: 1500 }, { timestamp: '2026-08-20T12:00:00Z' }),
      ],
      table,
      'UTC',
    );

    expect(dayQuotes(snapshot, '2026-08-20').against).toBe('2026-08-15');
    expect(quote(snapshot, 'OUTPUT').change).toBeCloseTo(0.5, 10);
  });

  it('reads a day with no usage as zero rather than dropping the line', () => {
    const snapshot = buildSnapshot(
      [usageRecord({ output: 500 }, { timestamp: '2026-08-19T12:00:00Z' })],
      table,
      'UTC',
    );

    expect(quote(snapshot, 'OUTPUT').value).toBe(0);
    expect(quote(snapshot, 'OUTPUT').change).toBeCloseTo(-1, 10);
  });

  it('adds both cache write lifetimes into one line', () => {
    const snapshot = buildSnapshot(
      [
        usageRecord(
          { cacheWrite5m: 300, cacheWrite1h: 700 },
          { timestamp: '2026-08-20T12:00:00Z' },
        ),
      ],
      table,
      'UTC',
    );

    expect(quote(snapshot, 'CACHE-W').value).toBe(1000);
  });

  it('keeps the board in a fixed order, so it never reshuffles while being read', () => {
    const order = dayQuotes(twoDays(1, 1), '2026-08-20').quotes.map((entry) => entry.symbol);

    expect(order).toEqual([
      'TOTAL',
      'CACHE-R',
      'CACHE-W',
      'INPUT',
      'OUTPUT',
      'THINK',
      'TURNS',
      'VALUE',
    ]);
  });
});

describe('direction', () => {
  it('names the way a quote moved', () => {
    expect(direction(0.2)).toBe('up');
    expect(direction(-0.2)).toBe('down');
    expect(direction(0)).toBe('flat');
    expect(direction(null)).toBe('none');
  });

  it('treats a move too small to matter as flat', () => {
    expect(direction(0.0001)).toBe('flat');
  });
});

describe('modelSymbol', () => {
  it('reads a model id as a ticker symbol', () => {
    expect(modelSymbol('claude-opus-4-8')).toBe('OPUS-4-8');
    expect(modelSymbol('claude-haiku-4-5-20251001')).toBe('HAIKU-4-5');
  });
});

describe('modelQuotes', () => {
  it('shares out lifetime spend, and never claims a move it cannot know', () => {
    const snapshot = buildSnapshot(
      [
        usageRecord({ output: 3_000_000 }, { model: 'test-model' }),
        usageRecord({ output: 1_000_000 }, { model: 'no-fast-model' }),
      ],
      table,
      'UTC',
    );

    const quotes = modelQuotes(snapshot);
    expect(quotes.map((entry) => entry.symbol)).toEqual(['TEST-MODEL', 'NO-FAST-MODEL']);
    expect(quotes[0]!.share).toBeCloseTo(0.75, 10);
    expect(quotes.every((entry) => entry.change === null)).toBe(true);
  });
});
