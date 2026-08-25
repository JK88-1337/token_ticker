import { useMemo, useState } from 'react';
import { totalTokens, workTokens } from '../core/limits.js';
import {
  COMBO_GAP_MS,
  comboLength,
  comboTier,
  dailyStreak,
  levelFor,
  tokenRatePerSecond,
} from '../core/momentum.js';
import type { UsageSnapshot } from '../core/snapshot.js';
import type { UsageBucket } from '../core/summary.js';
import { Breakdown, DailyBars, type BreakdownItem } from '../ui/charts.js';
import { compact, count, full, projectName, shortDay, todayKey, usd } from '../ui/format.js';
import { useAnimatedValue, useNow, useSampled } from '../ui/hooks.js';
import { Flap } from './Flap.js';
import { Tape } from './Tape.js';
import { dayQuotes, direction, modelQuotes, type Quote } from './quotes.js';
import './ticker.css';

/** How many active days the trend shows. */
const TREND_DAYS = 45;
/** Short enough that the rate jumps the moment a turn lands. */
const RATE_WINDOW_MS = 60_000;
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

type Tab = 'days' | 'models' | 'projects' | 'ceiling';

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
  const [tab, setTab] = useState<Tab>('models');

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

  const rate = tokenRatePerSecond(snapshot.recent, now, RATE_WINDOW_MS);
  const combo = comboLength(
    snapshot.recent.map((event) => event.at),
    now,
    COMBO_GAP_MS,
  );
  const tier = comboTier(combo);
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

  const tabs: { id: Tab; label: string; hint: string }[] = [
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

        <dl className="marquee-stats">
          <div>
            <dt>Rate</dt>
            <dd>
              {count(Math.round(rate))} <small>tok/s</small>
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
            <dt>Combo</dt>
            <dd>
              ×{count(combo)} {tier ? <small>{tier.name.toLowerCase()}</small> : null}
            </dd>
          </div>
          <div>
            <dt>Level</dt>
            <dd>
              {level.level}{' '}
              <small>
                {compact(level.into)} / {compact(level.span)}
              </small>
            </dd>
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
