/**
 * Usage as open, high, low and close.
 *
 * A candle needs a price that both moves within a period and carries across
 * into the next one. A cumulative token count fails the first test — bucketing
 * a running total opens every candle at zero and closes it at the day's
 * figure, a bar chart in a costume. The size of a single turn fails the
 * second: one turn has no relationship to the turn before it, so a body that
 * closes above its open says nothing a reader can carry forward, and the
 * candles never join up into a line worth reading.
 *
 * The price the ticker actually plots is therefore a **trailing rate** — see
 * {@link rateSeries} — which does both: the rate at the close of one period is
 * the rate at the open of the next, rising as the work speeds up and falling
 * back on its own when it stops. This module only shapes whatever series it is
 * handed.
 *
 * Every one of the four figures is a value that was really observed at a turn
 * that really happened; none is an average, an interpolation, or a figure
 * carried over from a period with no turns in it. Volume stays an amount
 * rather than a price: see {@link Tick.weight}.
 */

/** One observation: a moment, and what the price stood at then. */
export interface Tick {
  at: string;
  value: number;
  /**
   * What the moment actually weighed, in tokens, when that differs from the
   * price. A rate is a price, not an amount — adding rates up would give a
   * volume bar no meaning — so a rate tick carries the tokens of its own turn
   * here and the volume is built from these instead.
   */
  weight?: number;
}

export interface Candle {
  key: string;
  /** The first turn of the period. */
  open: number;
  /** The largest single turn in it. */
  high: number;
  /** The smallest. */
  low: number;
  /** The last turn of the period. */
  close: number;
  turns: number;
  /** Everything the period added up to — the volume under the candle. */
  volume: number;
}

/**
 * Groups ticks into candles, oldest period first.
 *
 * Ticks are sorted by time before grouping, because open and close mean
 * nothing if the order is the order the files happened to be read in.
 * Anything with an unparseable timestamp is dropped rather than sorted to one
 * end, where it would silently become somebody's open.
 */
export function candlesBy(ticks: readonly Tick[], keyOf: (tick: Tick) => string): Candle[] {
  const ordered = ticks
    .map((tick) => ({ tick, at: Date.parse(tick.at) }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort((a, b) => a.at - b.at);

  const grouped = new Map<string, Candle>();

  for (const { tick } of ordered) {
    const key = keyOf(tick);
    const candle = grouped.get(key);

    if (!candle) {
      grouped.set(key, {
        key,
        open: tick.value,
        high: tick.value,
        low: tick.value,
        close: tick.value,
        turns: 1,
        volume: tick.weight ?? tick.value,
      });
      continue;
    }

    candle.high = Math.max(candle.high, tick.value);
    candle.low = Math.min(candle.low, tick.value);
    candle.close = tick.value;
    candle.turns++;
    candle.volume += tick.weight ?? tick.value;
  }

  return [...grouped.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * The middle closing value of a run of candles, or null if there are none.
 *
 * The line a reader needs to answer "is this fast for me?", which the candles
 * alone cannot say. A median rather than a mean: one runaway period is exactly
 * the thing a normal is supposed to survive.
 */
export function typicalClose(candles: readonly Candle[]): number | null {
  if (candles.length === 0) return null;

  const closes = candles.map((candle) => candle.close).sort((a, b) => a - b);
  const middle = Math.floor(closes.length / 2);

  return closes.length % 2 === 1 ? closes[middle]! : (closes[middle - 1]! + closes[middle]!) / 2;
}

/** Whether a period closed above where it opened. Flat is neither. *//** Whether a period closed above where it opened. Flat is neither. */
export function candleWay(candle: Candle): 'up' | 'down' | 'flat' {
  if (candle.close > candle.open) return 'up';
  if (candle.close < candle.open) return 'down';
  return 'flat';
}
