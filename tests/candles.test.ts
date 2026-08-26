import { describe, expect, it } from 'vitest';
import { candleWay, candlesBy, typicalClose, type Candle, type Tick } from '../src/core/candles.js';
import { buildSnapshot } from '../src/core/snapshot.js';
import { testPricingTable as table, usageRecord } from './fixtures.js';

const at = (hour: number, minute = 0) =>
  `2026-08-20T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`;

const day = (tick: Tick) => tick.at.slice(0, 10);

describe('candlesBy', () => {
  it('opens on the first turn of the period and closes on the last', () => {
    const [candle] = candlesBy(
      [
        { at: at(9), value: 100 },
        { at: at(12), value: 900 },
        { at: at(17), value: 400 },
      ],
      day,
    );

    expect(candle!.open).toBe(100);
    expect(candle!.close).toBe(400);
  });

  it('takes the high and the low from real turns, not from the body', () => {
    const [candle] = candlesBy(
      [
        { at: at(9), value: 500 },
        { at: at(10), value: 20 },
        { at: at(11), value: 4_000 },
        { at: at(12), value: 600 },
      ],
      day,
    );

    expect(candle!.high).toBe(4_000);
    expect(candle!.low).toBe(20);
    expect(candle!.open).toBe(500);
    expect(candle!.close).toBe(600);
  });

  it('orders by time before grouping, so open is the earliest turn and not the first read', () => {
    const [candle] = candlesBy(
      [
        { at: at(17), value: 400 },
        { at: at(9), value: 100 },
        { at: at(12), value: 900 },
      ],
      day,
    );

    expect(candle!.open).toBe(100);
    expect(candle!.close).toBe(400);
  });

  it('gives a period with one turn in it a candle with no body and no wicks', () => {
    const [candle] = candlesBy([{ at: at(9), value: 750 }], day);

    expect(candle).toMatchObject({ open: 750, high: 750, low: 750, close: 750, turns: 1 });
    expect(candleWay(candle!)).toBe('flat');
  });

  it('adds the period up as volume', () => {
    const [candle] = candlesBy(
      [
        { at: at(9), value: 100 },
        { at: at(10), value: 250 },
      ],
      day,
    );

    expect(candle!.volume).toBe(350);
    expect(candle!.turns).toBe(2);
  });

  it('returns periods oldest first', () => {
    const keys = candlesBy(
      [
        { at: '2026-08-22T10:00:00Z', value: 1 },
        { at: '2026-08-19T10:00:00Z', value: 1 },
        { at: '2026-08-21T10:00:00Z', value: 1 },
      ],
      day,
    ).map((candle) => candle.key);

    expect(keys).toEqual(['2026-08-19', '2026-08-21', '2026-08-22']);
  });

  it('drops a turn with an unreadable timestamp rather than letting it become an open', () => {
    const candles = candlesBy(
      [
        { at: 'not a date', value: 99_999 },
        { at: at(9), value: 100 },
      ],
      day,
    );

    expect(candles).toHaveLength(1);
    expect(candles[0]!.open).toBe(100);
    expect(candles[0]!.turns).toBe(1);
  });

  it('has nothing to say about a period with no turns in it', () => {
    expect(candlesBy([], day)).toEqual([]);
  });
});

describe('volume', () => {
  it('adds up what the period actually weighed, not what its prices came to', () => {
    const [candle] = candlesBy(
      [
        { at: at(9), value: 1_200, weight: 400 },
        { at: at(10), value: 3_600, weight: 2_400 },
      ],
      day,
    );

    expect(candle!.volume).toBe(2_800);
    expect(candle!.open).toBe(1_200);
    expect(candle!.close).toBe(3_600);
  });

  it('falls back to the price when a tick carries no weight of its own', () => {
    const [candle] = candlesBy([{ at: at(9), value: 500 }], day);

    expect(candle!.volume).toBe(500);
  });
});

describe('candleWay', () => {
  it('names a period that closed above where it opened', () => {
    const rising = candlesBy(
      [
        { at: at(9), value: 100 },
        { at: at(10), value: 300 },
      ],
      day,
    )[0]!;

    expect(candleWay(rising)).toBe('up');
  });

  it('names one that closed below', () => {
    const falling = candlesBy(
      [
        { at: at(9), value: 300 },
        { at: at(10), value: 100 },
      ],
      day,
    )[0]!;

    expect(candleWay(falling)).toBe('down');
  });
});

describe('the snapshot', () => {
  it('carries a candle for every day it carries a bucket', () => {
    const snapshot = buildSnapshot(
      [
        usageRecord({ output: 100 }, { timestamp: '2026-08-19T09:00:00Z' }),
        usageRecord({ output: 900 }, { timestamp: '2026-08-19T15:00:00Z' }),
        usageRecord({ output: 400 }, { timestamp: '2026-08-20T09:00:00Z' }),
      ],
      table,
      'UTC',
    );

    expect(snapshot.byDayCandle.map((candle) => candle.key)).toEqual(
      snapshot.byDay.map((bucket) => bucket.key),
    );
  });

  it('prices the candle as the pace the work was going at, not as the day total', () => {
    const snapshot = buildSnapshot(
      [
        // Two turns half a minute apart, so the second is measured with the
        // first still inside the trailing window — the pace has doubled over.
        usageRecord({ output: 100 }, { timestamp: '2026-08-19T09:00:00Z' }),
        usageRecord({ output: 900 }, { timestamp: '2026-08-19T09:00:30Z' }),
        // Hours later the window is empty again, so the pace is back to what
        // this turn alone is worth.
        usageRecord({ output: 400 }, { timestamp: '2026-08-19T15:00:00Z' }),
      ],
      table,
      'UTC',
    );

    const candle = snapshot.byDayCandle[0]!;
    expect(candle.open).toBe(100);
    expect(candle.high).toBe(1_000);
    expect(candle.close).toBe(400);
    // Volume stays what the day actually spent, whatever the pace did.
    expect(candle.volume).toBe(1_400);
  });

  it('buckets candles in the same zone the days are bucketed in', () => {
    // 23:30 UTC is already the next day in Sydney, so the candle has to move
    // with the bucket rather than staying on the UTC date.
    const snapshot = buildSnapshot(
      [usageRecord({ output: 100 }, { timestamp: '2026-08-19T23:30:00Z' })],
      table,
      'Australia/Sydney',
    );

    expect(snapshot.byDayCandle[0]!.key).toBe('2026-08-20');
    expect(snapshot.byDayCandle[0]!.key).toBe(snapshot.byDay[0]!.key);
  });
});

describe('the typical close', () => {
  const candle = (close: number): Candle => ({
    key: String(close),
    open: close,
    high: close,
    low: close,
    close,
    turns: 1,
    volume: close,
  });

  it('is the middle close, so one runaway period cannot drag the line', () => {
    expect(typicalClose([candle(10), candle(20), candle(9_000_000)])).toBe(20);
  });

  it('splits the difference when there is no middle one', () => {
    expect(typicalClose([candle(10), candle(30)])).toBe(20);
  });

  it('is nothing to draw when there are no candles', () => {
    expect(typicalClose([])).toBeNull();
  });
});
