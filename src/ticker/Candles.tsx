import { useState } from 'react';
import { candleWay, typicalClose, type Candle } from '../core/candles.js';
import { compact, count } from '../ui/format.js';

/**
 * Open, high, low and close on the pace the work is going at.
 *
 * The price is a trailing rate in tokens a minute, sampled at each turn, which
 * is what makes the chart readable as a chart: a rate carries over from one
 * period into the next, so a green candle means the pace picked up over that
 * period and a red one means it eased off. It cannot run away upwards either —
 * stop working and it falls back on its own.
 *
 * Two things are drawn that the candles cannot say by themselves. The dashed
 * line is the typical close across everything on screen, so "fast" and "slow"
 * are read against a normal rather than guessed at. The tag on the right is
 * where the pace stands now.
 *
 * The scale is logarithmic, and has to be. Pace ranges over three decades, and
 * on a linear axis the one furious minute of the week presses every other
 * candle flat against the floor. Gridlines sit at whole powers of ten and are
 * labelled, so the compression is visible rather than quiet.
 *
 * Bodies and wicks are HTML boxes placed as percentages, in the same way the
 * daily bars are, so the plot reflows with its panel without measuring it.
 */

/** Where a value sits in the plot, as a percentage from the top. */
function scale(low: number, high: number) {
  const bottom = Math.floor(Math.log10(Math.max(low, 1)));
  const top = Math.ceil(Math.log10(Math.max(high, 10)));
  const span = Math.max(top - bottom, 1);

  return {
    bottom,
    top,
    span,
    /** 0 at the top of the plot, 100 at the bottom. */
    y: (value: number) => {
      const at = Math.log10(Math.max(value, 1));
      return (1 - (at - bottom) / span) * 100;
    },
  };
}

interface Hover {
  x: number;
  y: number;
  candle: Candle;
}

export function Candles({
  candles,
  label,
  unit = 'tokens a minute',
}: {
  candles: Candle[];
  /** How to render a period key on the axis. */
  label: (key: string) => string;
  unit?: string;
}) {
  const [hover, setHover] = useState<Hover | null>(null);

  if (candles.length === 0) {
    return <p className="state">Nothing to plot yet — no turns on record for this period.</p>;
  }

  const low = Math.min(...candles.map((candle) => candle.low));
  const high = Math.max(...candles.map((candle) => candle.high));
  const { bottom, top, y } = scale(low, high);
  const decades = Array.from({ length: top - bottom + 1 }, (_, i) => bottom + i);

  const peakVolume = Math.max(...candles.map((candle) => candle.volume), 1);

  // The normal to read the rest against, and where the pace stands now.
  const typical = typicalClose(candles);
  const latest = candles.at(-1)!;
  const nowWay = typical === null || latest.close === typical ? 'flat' : latest.close > typical ? 'up' : 'down';

  return (
    <div className="candles">
      <div className="candles-frame">
        <div className="candles-axis" aria-hidden>
          {decades.map((decade) => (
            <span key={decade} style={{ top: `${y(10 ** decade)}%` }}>
              {compact(10 ** decade)}
            </span>
          ))}
        </div>

        <div className="candles-plot">
          {decades.map((decade) => (
            <span
              className="candles-rule"
              key={decade}
              style={{ top: `${y(10 ** decade)}%` }}
              aria-hidden
            />
          ))}

          {typical === null ? null : (
            <span className="candles-normal" style={{ top: `${y(typical)}%` }} aria-hidden>
              <i>typical {compact(typical)}</i>
            </span>
          )}

          <span className={`candles-now ${nowWay}`} style={{ top: `${y(latest.close)}%` }}>
            {compact(latest.close)}
          </span>

          {candles.map((candle) => {
            const way = candleWay(candle);
            const bodyTop = y(Math.max(candle.open, candle.close));
            const bodyBottom = y(Math.min(candle.open, candle.close));

            return (
              <div
                className="candle"
                key={candle.key}
                onMouseEnter={(event) =>
                  setHover({
                    x: event.currentTarget.offsetLeft + event.currentTarget.offsetWidth / 2,
                    y: event.currentTarget.offsetTop,
                    candle,
                  })
                }
                onMouseLeave={() => setHover(null)}
              >
                <span
                  className={`candle-wick ${way}`}
                  style={{ top: `${y(candle.high)}%`, height: `${y(candle.low) - y(candle.high)}%` }}
                />
                <span
                  className={`candle-body ${way}`}
                  style={{ top: `${bodyTop}%`, height: `${bodyBottom - bodyTop}%` }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Volume is the period's whole take, so it is a count and belongs on a
          linear scale — unlike the candles above it. */}
      <div className="candles-volume">
        {candles.map((candle) => (
          <div className="volume-col" key={candle.key}>
            <span
              className={`volume-bar ${candleWay(candle)}`}
              style={{ height: `${(candle.volume / peakVolume) * 100}%` }}
            />
          </div>
        ))}
      </div>

      <div className="candles-labels" aria-hidden>
        {candles.map((candle, index) => (
          <span key={candle.key}>
            {index % Math.ceil(candles.length / 8) === 0 ? label(candle.key) : ''}
          </span>
        ))}
      </div>

      <p className="candles-caption caption">
        {unit}, log scale · <b className="up">green</b> is a period that ended faster than it
        started, <b className="down">red</b> one that ended slower · the wick is the fastest and
        slowest it got · dashed line is your typical pace · the strip underneath is what the period
        actually spent
      </p>

      {hover ? (
        <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
          <div className="tip-title">{label(hover.candle.key)}</div>
          <div className="tip-row">started at {count(Math.round(hover.candle.open))}/min</div>
          <div className="tip-row">peaked at {count(Math.round(hover.candle.high))}/min</div>
          <div className="tip-row">slowest {count(Math.round(hover.candle.low))}/min</div>
          <div className="tip-row">ended at {count(Math.round(hover.candle.close))}/min</div>
          <div className="tip-row">
            {count(hover.candle.turns)} turns · {compact(hover.candle.volume)} tokens spent
          </div>
        </div>
      ) : null}
    </div>
  );
}
