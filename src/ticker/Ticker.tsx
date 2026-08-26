import { useMemo, useState, type CSSProperties } from 'react';
import { totalTokens, workTokens } from '../core/limits.js';
import {
  COMBO_GAP_MS,
  COMBO_TIERS,
  comboLength,
  comboTier,
  comboTimeLeft,
  RATE_SAMPLE_MS,
  RATE_WINDOW_MS,
  rateSeries,
  nextComboTier,
  dailyStreak,
  levelFor,
  tokenRatePerMinute,
} from '../core/momentum.js';
import { candlesBy } from '../core/candles.js';
import type { UsageSnapshot } from '../core/snapshot.js';
import type { UsageBucket } from '../core/summary.js';
import { Breakdown, DailyBars, type BreakdownItem } from '../ui/charts.js';
import {
  compact,
  count,
  full,
  hourKey,
  minuteKey,
  projectName,
  shortDay,
  shortHour,
  shortMinute,
  todayKey,
  usd,
} from '../ui/format.js';
import { useAnimatedValue, useNow, useSampled } from '../ui/hooks.js';
import { Candles } from './Candles.js';
import { Flap } from './Flap.js';
import { Tape } from './Tape.js';
import { dayQuotes, direction, modelQuotes, type Quote } from './quotes.js';
import './ticker.css';

/** How many active days the trend shows. */
const TREND_DAYS = 45;
/**
 * How often the board is fed. Twelve folds a second reads as a board working
 * hard; sixty reads as a smear, and costs sixty renders to say the same thing.
 */
const FLAP_MS = 80;

/**
 * Categorical slots, in the fixed order the palette validates in.
 *
 * Assignment is by sorted model id, never by rank — a model that gets dearer
 * must not take another model's colour, and filtering must not repaint the
 * survivors.
 */
const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
];

type Tab = 'candles' | 'days' | 'models' | 'projects' | 'ceiling';

/** Which period the candles are cut into. */
type Grain = 'day' | 'hour' | 'minute';

const ARROW = { up: '▲', down: '▼', flat: '—', none: '·' } as const;

function toItems(
  buckets: UsageBucket[],
  colour: (key: string) => string,
  label = (key: string) => key,
): BreakdownItem[] {
  return buckets.map((bucket) => ({
    key: bucket.key,
    label: label(bucket.key),
    usd: bucket.totals.usd,
    turns: bucket.totals.turns,
    outputTokens: bucket.totals.tokens.output,
    colour: colour(bucket.key),
  }));
}

/** A quote's figure, in whatever it is counted in. */
function quoteValue(quote: Quote): string {
  return quote.unit === 'usd' ? usd(quote.value) : count(quote.value);
}

/** `+12.4%`, or a dash where there is no yesterday to measure against. */
function quoteMove(quote: Quote): string {
  if (quote.change === null) return '—';
  const percent = quote.change * 100;
  const sign = percent > 0 ? '+' : '';
  return `${sign}${Math.abs(percent) >= 100 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

/** Where the session gauge sits, and what to call it. */
function pressure(used: number, ceiling: number | null) {
  if (!ceiling || ceiling <= 0) {
    return { fraction: 0, level: 'unknown' as const, label: 'no ceiling yet' };
  }
  const fraction = Math.min(used / ceiling, 1);
  if (fraction >= 0.85) return { fraction, level: 'critical' as const, label: 'at the edge' };
  if (fraction >= 0.6) return { fraction, level: 'warning' as const, label: 'closing in' };
  return { fraction, level: 'clear' as const, label: 'room to run' };
}

/**
 * The ticker.
 *
 * A board rather than a dashboard: today's count on split-flaps, every line
 * of the day quoted against yesterday, the allowance window beside it, and a
 * crawl along the bottom. Everything on it is measured — the flaps only ever
 * close on a real figure, and a quote with no yesterday to compare against
 * shows a dash rather than an invented move.
 */
export function Ticker({ snapshot }: { snapshot: UsageSnapshot }) {
  const now = useNow(1000);
  const [tab, setTab] = useState<Tab>('candles');
  const [grain, setGrain] = useState<Grain>('minute');

  const key = todayKey(snapshot.timeZone);
  const today = snapshot.byDay.find((bucket) => bucket.key === key);
  const todayTokens = today ? totalTokens(today.totals.tokens) : 0;

  const eased = useAnimatedValue(todayTokens);
  const shown = useSampled(eased, FLAP_MS);

  const board = useMemo(() => dayQuotes(snapshot, key), [snapshot, key]);
  const models = useMemo(() => modelQuotes(snapshot), [snapshot]);
  const quotes = board.quotes;
  const total = quotes[0]!;
  const against = board.against ? `against ${shortDay(board.against)}` : 'no day before this one';

  const rate = tokenRatePerMinute(snapshot.recent, now, RATE_WINDOW_MS);
  const turnTimes = useMemo(() => snapshot.recent.map((event) => event.at), [snapshot]);
  const combo = comboLength(turnTimes, now, COMBO_GAP_MS);
  const tier = comboTier(combo);
  const nextTier = nextComboTier(combo);
  // How long the run has left before a pause breaks it, as a share of the gap.
  const held = comboTimeLeft(turnTimes, now, COMBO_GAP_MS);
  const holding = held / COMBO_GAP_MS;
  const streak = dailyStreak(
    snapshot.byDay.map((bucket) => bucket.key),
    key,
  );

  const lifetime = totalTokens(snapshot.totals.tokens);
  const level = levelFor(lifetime);

  const used = workTokens(snapshot.window.totals.tokens);
  const ceiling = snapshot.observedCeiling ?? workTokens(snapshot.peak.totals.tokens);
  const gauge = pressure(used, ceiling);

  const modelColour = useMemo(() => {
    const order = [...snapshot.byModel].map((bucket) => bucket.key).sort();
    return (id: string) => SERIES[order.indexOf(id) % SERIES.length]!;
  }, [snapshot]);

  const { byDay, byModel, byProject, limitHits, totals, window: session } = snapshot;

  /**
   * The pace at each of the recent turns, which the hour and minute candles
   * are both cut from. It comes off `recent` rather than the whole history
   * because `recent` is the only per-turn detail that travels with a snapshot
   * — which is also why those views reach back only as far as they do, and
   * say so.
   */
  const pace = useMemo(
    () => rateSeries(snapshot.recent, RATE_WINDOW_MS, RATE_SAMPLE_MS),
    [snapshot],
  );

  const byMinuteCandle = useMemo(
    () => candlesBy(pace, (tick) => minuteKey(tick.at, snapshot.timeZone)),
    [pace, snapshot.timeZone],
  );

  const byHourCandle = useMemo(
    () => candlesBy(pace, (tick) => hourKey(tick.at, snapshot.timeZone)),
    [pace, snapshot.timeZone],
  );

  const tabs: { id: Tab; label: string; hint: string }[] = [
    { id: 'candles', label: 'Candles', hint: `${snapshot.byDayCandle.length}` },
    { id: 'days', label: 'Days', hint: `${byDay.length}` },
    { id: 'models', label: 'Models', hint: `${byModel.length}` },
    { id: 'projects', label: 'Projects', hint: `${byProject.length}` },
    { id: 'ceiling', label: 'Ceiling', hint: `${limitHits.length}` },
  ];

  /**
   * The five classes as they stand in the window.
   *
   * Thinking is measured against the reply rather than the total, because the
   * API reports it as part of output — a shared denominator would count the
   * same tokens twice.
   */
  const classes = [
    { name: 'Cache read', value: session.totals.tokens.cacheRead, of: 'total' as const },
    {
      name: 'Cache write',
      value: session.totals.tokens.cacheWrite5m + session.totals.tokens.cacheWrite1h,
      of: 'total' as const,
    },
    { name: 'Fresh input', value: session.totals.tokens.input, of: 'total' as const },
    { name: 'Reply', value: session.totals.tokens.output, of: 'total' as const },
    { name: 'Thinking', value: session.totals.tokens.thinking, of: 'output' as const },
  ];

  const crawl = [
    ...quotes.map((quote) => (
      <>
        <b>{quote.symbol}</b> {quoteValue(quote)}{' '}
        <i className={`move ${direction(quote.change)}`}>
          {ARROW[direction(quote.change)]} {quoteMove(quote)}
        </i>
      </>
    )),
    ...models.map((quote) => (
      <>
        <b>{quote.symbol}</b> {usd(quote.value)}{' '}
        <i className="move none">{(quote.share * 100).toFixed(0)}% of spend</i>
      </>
    )),
    <>
      <b>LIFETIME</b> {count(lifetime)}
    </>,
    <>
      <b>LEVEL</b> {level.level}{' '}
      <i className="move none">{compact(level.span - level.into)} to the next</i>
    </>,
    <>
      <b>BEST COMBO</b> ×{count(snapshot.bestCombo)}
    </>,
    <>
      <b>STREAK</b> {streak}d
    </>,
    <>
      <b>CUT OFF</b> {count(limitHits.length)}×
    </>,
  ];

  return (
    <div className="ticker">
      <section className="marquee">
        <div className="marquee-main">
          <p className="marquee-label">Tokens today</p>
          <Flap value={full(shown)} className="marquee-flap" />
          <p className={`marquee-move move ${direction(total.change)}`}>
            {ARROW[direction(total.change)]} {quoteMove(total)}
            <span className="marquee-versus">{against}</span>
          </p>
        </div>

        <div className="momentum">
          <div
            className={`combo${combo > 1 ? ' live' : ''}${tier ? ` rank-${tier.rank}` : ''}`}
          >
            <p className="marquee-label">Combo</p>

            {/*
              The gap, drawn as the clock it is: the ring is what is left of
              the two minutes before a pause breaks the run, and it drains
              whether or not anything else on the board moves.
            */}
            <div
              className="combo-dial"
              style={{ '--held': holding } as CSSProperties}
              role="img"
              aria-label={`combo of ${combo}, ${Math.ceil(held / 1000)} seconds left`}
            >
              <div className="combo-face">
                <span className="combo-value">×{count(combo)}</span>
                <span className="combo-left">{held > 0 ? `${Math.ceil(held / 1000)}s` : 'cold'}</span>
              </div>
            </div>

            <p className="combo-tier">{tier ? tier.name : 'no run yet'}</p>

            {/* The ladder, so the next rung is a thing you can see coming. */}
            <ol className="combo-rungs">
              {COMBO_TIERS.map((rung) => (
                <li
                  key={rung.rank}
                  className={tier && tier.rank >= rung.rank ? 'lit' : ''}
                  title={`${rung.name} at ${rung.from}`}
                />
              ))}
            </ol>

            <p className="combo-foot">
              {nextTier ? (
                <>
                  <b>{count(nextTier.toGo)}</b> more to {nextTier.name}
                </>
              ) : (
                <>best ×{count(snapshot.bestCombo)}</>
              )}
            </p>
          </div>

          <div className="level">
            <p className="marquee-label">Level</p>
            <p className="level-value">{level.level}</p>
            <div className="level-bar" aria-hidden>
              <span style={{ width: `${(level.into / level.span) * 100}%` }} />
            </div>
            <p className="level-foot">
              <b>{compact(level.span - level.into)}</b> to {level.level + 1}
            </p>
          </div>
        </div>

        <dl className="marquee-stats">
          <div>
            <dt>Rate</dt>
            <dd>
              {count(Math.round(rate))} <small>tok/min</small>
            </dd>
          </div>
          <div>
            <dt>Value today</dt>
            <dd>{usd(today?.totals.usd ?? 0)}</dd>
          </div>
          <div>
            <dt>Turns</dt>
            <dd>{count(today?.totals.turns ?? 0)}</dd>
          </div>
          <div>
            <dt>Streak</dt>
            <dd>{streak}d</dd>
          </div>
        </dl>
      </section>

      <section className="ticker-board">
        <div className="panel quotes">
          <header className="panel-head">
            <h2>Today {against}</h2>
          </header>

          <table className="quote-table">
            <tbody>
              {quotes.map((quote) => {
                const way = direction(quote.change);
                return (
                  <tr key={quote.symbol} className={quote.symbol === 'TOTAL' ? 'lead' : undefined}>
                    <th scope="row">{quote.symbol}</th>
                    <td className="quote-value">{quoteValue(quote)}</td>
                    <td className={`quote-move move ${way}`}>
                      <span className="quote-arrow">{ARROW[way]}</span> {quoteMove(quote)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="panel window">
          <header className="panel-head">
            <h2>Session window · 5h</h2>
            <span className={`tag ${gauge.level}`}>{gauge.label}</span>
          </header>

          <p className="window-figure">
            {count(used)}
            <span className="window-of">
              {ceiling > 0 ? `of ${count(ceiling)} work tokens` : 'no ceiling on record'}
            </span>
          </p>

          <div className="window-track">
            <div
              className={`window-fill ${gauge.level}`}
              style={{ width: `${gauge.fraction * 100}%` }}
            />
          </div>

          <p className="caption">
            {snapshot.observedCeiling
              ? 'Ceiling measured from the window you were cut off in.'
              : 'No refusal on record — measured against your own busiest window.'}
          </p>

          <ul className="classes">
            {classes.map((row) => {
              const denominator =
                row.of === 'output' ? session.totals.tokens.output : totalTokens(session.totals.tokens);
              const share = denominator > 0 ? row.value / denominator : 0;
              return (
                <li key={row.name}>
                  <span className="class-name">{row.name}</span>
                  <span className="class-track">
                    <span className="class-fill" style={{ width: `${share * 100}%` }} />
                  </span>
                  <span className="class-value">{compact(row.value)}</span>
                  <span className="class-share">
                    {(share * 100).toFixed(share < 0.01 ? 2 : 0)}%
                    {row.of === 'output' ? ' of reply' : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="panel detail">
          <nav className="tabs" role="tablist">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                role="tab"
                aria-selected={tab === entry.id}
                className={tab === entry.id ? 'tab on' : 'tab'}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
                <span className="tab-hint">{entry.hint}</span>
              </button>
            ))}
          </nav>

          <div className="detail-body">
            {tab === 'candles' ? (
              <div className="candles-pane">
                <nav className="grain" role="tablist">
                  {(['day', 'hour', 'minute'] as const).map((id) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={grain === id}
                      className={grain === id ? 'grain-tab on' : 'grain-tab'}
                      onClick={() => setGrain(id)}
                    >
                      {id === 'day' ? 'Daily' : id === 'hour' ? 'Hourly' : '1 min'}
                    </button>
                  ))}
                  <span className="grain-note">
                    {grain === 'day'
                      ? 'every day on record'
                      : `the last ${count(snapshot.recent.length)} turns${
                          grain === 'minute' ? ' · only minutes with turns in them' : ''
                        }`}
                  </span>
                </nav>

                {grain === 'day' ? (
                  <Candles candles={snapshot.byDayCandle} label={shortDay} />
                ) : grain === 'hour' ? (
                  <Candles candles={byHourCandle} label={shortHour} />
                ) : (
                  <Candles candles={byMinuteCandle} label={shortMinute} />
                )}
              </div>
            ) : null}

            {tab === 'days' ? <DailyBars buckets={byDay.slice(-TREND_DAYS)} /> : null}
            {tab === 'models' ? <Breakdown items={toItems(byModel, modelColour)} /> : null}
            {tab === 'projects' ? (
              <Breakdown items={toItems(byProject, () => 'var(--series-1)', projectName)} />
            ) : null}
            {tab === 'ceiling' ? (
              <div className="ceiling-pane">
                <p className="caption">
                  The allowance is not in the transcripts and is not cached on disk, so nothing here
                  is a quota lookup. What is recorded is the moment a turn was refused — and what
                  the window held when it happened.
                </p>
                {limitHits.length > 0 ? (
                  <ul className="events">
                    {limitHits.map((hit) => (
                      <li key={hit.at}>
                        <span className="event-when">{shortDay(hit.at.slice(0, 10))}</span>
                        <span className="event-text">{hit.notice}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="state">
                    No refusal on record. The session gauge compares against your busiest window
                    instead — {compact(workTokens(snapshot.peak.totals.tokens))} tokens, on{' '}
                    {snapshot.peak.endedAt ? shortDay(snapshot.peak.endedAt.slice(0, 10)) : '—'}.
                  </p>
                )}
                <p className="caption">
                  Read from local transcripts; nothing leaves this machine. Equivalent value{' '}
                  {usd(totals.usd)} at the shipped rates — verify them before trusting a total.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <Tape items={crawl} />
    </div>
  );
}
