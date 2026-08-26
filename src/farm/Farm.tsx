import { useEffect, useMemo, useRef, useState } from 'react';
import { totalTokens, workTokens } from '../core/limits.js';
import { COMBO_GAP_MS, comboLength, comboTier, tokenRatePerMinute } from '../core/momentum.js';
import type { UsageSnapshot } from '../core/snapshot.js';
import { compact, count, full, todayKey, usd } from '../ui/format.js';
import { useAnimatedValue, useNow, useSampled } from '../ui/hooks.js';
import { Flap } from '../ticker/Flap.js';
import {
  FREE_SEED,
  MIN_BET,
  POCKETS,
  SEEDS,
  SPIN_TOKENS,
  TRINKETS,
  WHEEL_ORDER,
  betLabel,
  betPayout,
  growth,
  pocketColor,
  spinsEarned,
  stageName,
  towardNextSpin,
  wheelSlot,
  type Bet,
  type Seed,
} from './economy.js';
import { asSprite, cropSprite, Pixel } from './sprites.js';
import {
  adopt,
  advance,
  buyTrinket,
  harvest,
  plant,
  plotSeed,
  spin,
  spinsAvailable,
} from './state.js';
import { exportSave, importSave, useFarm } from './storage.js';
import './farm.css';

/** How long the wheel turns before the ball settles. */
const SPIN_MS = 4_200;
/** Turns of the wheel, and of the ball the other way, before it drops. */
const WHEEL_TURNS = 4;
const BALL_TURNS = 7;
/** Matches the ticker, so the small board reads the same as the big one. */
const FLAP_MS = 80;
const RATE_WINDOW_MS = 60_000;
const SLICE = 360 / POCKETS;
const CHIPS = [MIN_BET, 20, 50, 100] as const;

function pocketPaint(n: number): string {
  const colour = pocketColor(n);
  if (colour === 'green') return 'var(--pocket-green)';
  if (colour === 'red') return 'var(--pocket-red)';
  return 'var(--pocket-black)';
}

/**
 * The rim, painted by seat rather than by number.
 *
 * Slot i on the wheel head holds WHEEL_ORDER[i], which is why the colours
 * alternate around the rim while the numbers jump about.
 */
const WHEEL_PAINT = WHEEL_ORDER.map((n, slot) => {
  const from = slot * SLICE;
  return `${pocketPaint(n)} ${from}deg ${from + SLICE}deg`;
}).join(', ');

/** The felt: three rows of twelve, each row a column bet, as on a real layout. */
const FELT_ROWS = [3, 2, 1].map((column) =>
  Array.from({ length: 12 }, (_, i) => i * 3 + column),
);

const ZERO: Bet = { kind: 'straight', value: 0 };

/** The even-money row along the bottom of the felt. */
const OUTSIDE: readonly Bet[] = [
  { kind: 'half', value: 'low' },
  { kind: 'parity', value: 'even' },
  { kind: 'color', value: 'red' },
  { kind: 'color', value: 'black' },
  { kind: 'parity', value: 'odd' },
  { kind: 'half', value: 'high' },
];

export type FarmSignal = 'generating' | 'live' | 'idle';

/**
 * The farm.
 *
 * A game played entirely with figures the ticker already measures: crops
 * ripen on work tokens, and the wheel is turned by spins minted ten million
 * tokens at a time. The board across the top is the real one, at a size that
 * keeps it the point of the window — the field underneath is the reward for
 * what it is counting, not a replacement for it.
 *
 * Wheat is free forever, so a lost bet cannot take the last move on the
 * board. The wheel itself is a table: red or black, even money, and zero
 * takes the even bets.
 */
export function Farm({ snapshot, signal }: { snapshot: UsageSnapshot; signal: FarmSignal }) {
  const now = useNow(1000);
  const [farm, apply] = useFarm();
  const [chosen, setChosen] = useState<Seed>(FREE_SEED);
  const [bet, setBet] = useState<Bet>({ kind: 'color', value: 'red' });
  const [stake, setStake] = useState(MIN_BET);
  const [turning, setTurning] = useState(false);
  const [heldCoins, setHeldCoins] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [wheelAngle, setWheelAngle] = useState(0);
  const [ballAngle, setBallAngle] = useState(0);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);

  const lifetime = totalTokens(snapshot.totals.tokens);
  const lifetimeWork = workTokens(snapshot.totals.tokens);

  const key = todayKey(snapshot.timeZone);
  const today = snapshot.byDay.find((bucket) => bucket.key === key);
  const todayTokens = today ? totalTokens(today.totals.tokens) : 0;
  const shown = useSampled(useAnimatedValue(todayTokens), FLAP_MS);
  const rate = tokenRatePerMinute(snapshot.recent, now, RATE_WINDOW_MS);
  const combo = comboLength(
    snapshot.recent.map((event) => event.at),
    now,
    COMBO_GAP_MS,
  );
  const tier = comboTier(combo);

  const available = spinsAvailable(farm, lifetime);
  const nextSpinIn = towardNextSpin(lifetime);
  const coins = heldCoins ?? farm.coins;
  const canStake = coins >= MIN_BET;
  const stakeClamped = Math.min(stake, coins);
  const canSpin = available >= 1 && farm.coins >= MIN_BET && Math.min(stake, farm.coins) >= MIN_BET;

  const owned = useMemo(() => new Set(farm.trinkets), [farm.trinkets]);

  const copySave = () => {
    setNote(null);
    navigator.clipboard.writeText(exportSave(farm)).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2_000);
      },
      () => setNote('No clipboard here — select the text above and copy it yourself.'),
    );
  };

  const loadDraft = () => {
    const loaded = importSave(draft);
    if (!loaded) {
      setNote('That is not a save. Nothing has changed.');
      return;
    }

    // The mark travels with the save and means nothing here, so the farm is
    // adopted onto this machine's count rather than paid the difference.
    apply(() => adopt(loaded, lifetimeWork));
    setDraft('');
    setPasting(false);
    setNote('Loaded.');
  };

  /** Whether `option` is the bet currently on the table. */
  const on = (option: Bet) => option.kind === bet.kind && option.value === bet.value;

  useEffect(() => () => clearTimeout(settle.current), []);

  // The field takes its share of the work as the count moves. Sharing has to
  // happen as it is earned rather than at harvest, because what a plot is owed
  // depends on how full the field was at the time.
  useEffect(() => {
    apply((state) => advance(state, lifetimeWork));
  }, [apply, lifetimeWork]);

  const sown = farm.plots.filter((plot) => plot.seedId !== null).length;

  // While the wheel is turning the coin count holds at what it was: the
  // result is already in the save — closing the window mid-spin keeps it —
  // but showing it before the wheel stops gives the result away.
  const turn = () => {
    if (turning || available < 1 || !canStake || stakeClamped < MIN_BET) return;

    setHeldCoins(farm.coins);
    setTurning(true);
    apply((state) => {
      const after = spin(state, lifetime, stakeClamped, bet);
      const landed = after.lastSpin;
      if (landed) {
        // The wheel turns one way and the ball the other, as on a real bowl.
        // The ball has to finish over the seat the pocket ends up in, so its
        // angle is chosen against where the wheel will have stopped — the
        // ball is the marker, which is why there is no pointer.
        const wheelStop = wheelAngle + 360 * WHEEL_TURNS;
        const seat = wheelStop + wheelSlot(landed.pocket) * SLICE + SLICE / 2;
        const spun = ballAngle - 360 * BALL_TURNS;
        setWheelAngle(wheelStop);
        setBallAngle(spun - (((spun - seat) % 360) + 360) % 360);
      }
      return after;
    });

    settle.current = setTimeout(() => {
      setTurning(false);
      setHeldCoins(null);
    }, SPIN_MS);
  };

  const reveal = !turning && farm.lastSpin ? farm.lastSpin : null;
  const millRunning = rate > 6;

  return (
    <div className={`farm weather-${signal}${tier && tier.rank >= 3 ? ' hot' : ''}`}>
      <section className="farm-strip">
        <div className="farm-count">
          <p className="marquee-label">Tokens today</p>
          <Flap value={full(shown)} className="farm-flap" />
        </div>

        <dl className="marquee-stats farm-stats">
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
            <dt>Combo</dt>
            <dd>×{count(combo)}</dd>
          </div>
          <div>
            <dt>Coins</dt>
            <dd className="coins">
              <Pixel sprite="coin" size={16} /> {count(coins)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="farm-body">
        <div className="panel field">
          <header className="panel-head">
            <h2>The field</h2>
            <span className="field-hint">
              {chosen.price > 0 && farm.coins < chosen.price
                ? `${count(chosen.price - farm.coins)} more coins for ${chosen.name.toLowerCase()}`
                : `Sowing ${chosen.name.toLowerCase()} · click a plot`}
            </span>
          </header>

          <div className="scene">
            {owned.has('fence') ? <div className="prop fence" aria-hidden /> : null}
            {owned.has('scarecrow') ? (
              <span className="prop scarecrow" title="Scarecrow" aria-hidden>
                <Pixel sprite="scarecrow" size={32} />
              </span>
            ) : null}
            {owned.has('pond') ? (
              <span className="prop pond" title="Pond" aria-hidden>
                <Pixel sprite="pond" size={32} />
              </span>
            ) : null}
            {owned.has('windmill') ? (
              <span
                className="prop windmill"
                title="Windmill"
                aria-hidden
                style={{
                  animationDuration: millRunning ? `${Math.max(0.5, 240 / rate)}s` : undefined,
                  animationPlayState: millRunning ? 'running' : 'paused',
                }}
              >
                <Pixel sprite="windmill" size={32} />
              </span>
            ) : null}

            <ul className="plots">
              {farm.plots.map((plot, index) => {
                const seed = plotSeed(plot);
                const progress = seed ? growth(plot.grownWork, seed) : 0;
                const ripe = progress >= 1;
                // What this plot still needs, counted in the field's tokens
                // rather than its own: with the field this full, its share is
                // one part in `sown`.
                const remaining = seed
                  ? Math.max(0, seed.ripenWork - plot.grownWork) * Math.max(1, sown)
                  : 0;

                return (
                  <li key={index}>
                    <button
                      className={`plot${seed ? ' sown' : ''}${ripe ? ' ripe' : ''}${signal !== 'idle' && seed ? ' working' : ''}`}
                      onClick={() =>
                        apply((state) =>
                          ripe
                            ? harvest(state, index, lifetimeWork)
                            : seed
                              ? state
                              : plant(state, index, chosen.id, lifetimeWork),
                        )
                      }
                      disabled={!seed && chosen.price > farm.coins}
                    >
                      <span className="plot-art">
                        {seed ? (
                          <Pixel sprite={cropSprite(seed.id, progress)} size={32} />
                        ) : (
                          <Pixel sprite="plus" size={16} />
                        )}
                      </span>

                      {seed ? (
                        <>
                          <span className="plot-name">
                            {ripe ? `${seed.name} · ripe` : `${seed.name} · ${stageName(progress)}`}
                          </span>
                          <span className="plot-track">
                            <span className="plot-fill" style={{ width: `${progress * 100}%` }} />
                          </span>
                          <span className="plot-note">
                            {ripe ? (
                              <>
                                harvest for {seed.yield} <Pixel sprite="coin" size={8} />
                              </>
                            ) : (
                              `${compact(remaining)} work to go`
                            )}
                          </span>
                        </>
                      ) : (
                        <span className="plot-name bare">bare earth</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <ol className="almanac">
            {SEEDS.map((seed) => {
              const got = farm.harvested.includes(seed.id);
              return (
                <li key={seed.id} className={got ? 'got' : ''} title={got ? seed.name : `not yet · ${seed.name}`}>
                  <Pixel sprite={cropSprite(seed.id, 1)} size={24} />
                </li>
              );
            })}
          </ol>

          {/*
            The one recovery this app cannot do for you. The save lives in
            this machine's app data and survives closing the window, but not a
            cleared browser or a new laptop — so it is offered as text.
          */}
          <details className="keeping">
            <summary>The save</summary>

            <p className="caption">
              Written to this machine every time the farm changes. Copy it somewhere safe and it
              survives a new one too.
            </p>

            <textarea className="save-text" readOnly value={exportSave(farm)} spellCheck={false} />

            <div className="save-row">
              <button onClick={copySave}>{copied ? 'Copied' : 'Copy'}</button>
              <button onClick={() => setPasting((open) => !open)}>
                {pasting ? 'Cancel' : 'Paste one in'}
              </button>
            </div>

            {pasting ? (
              <div className="save-row">
                <textarea
                  className="save-text"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Paste a copied save here"
                  spellCheck={false}
                />
                <button onClick={loadDraft} disabled={draft.trim() === ''}>
                  Load it
                </button>
              </div>
            ) : null}

            {note ? <p className="save-note">{note}</p> : null}
          </details>
        </div>

        <div className="panel wheel-panel">
          <header className="panel-head">
            <h2>The wheel</h2>
            <span className="field-hint">{count(available)} to turn</span>
          </header>

          <div className="panel-body">
            <div className={`wheel-wrap${turning ? ' turning' : ''}`}>
              <div className="bowl">
                <div
                  className="wheel"
                  style={{
                    background: `conic-gradient(${WHEEL_PAINT})`,
                    transform: `rotate(${wheelAngle}deg)`,
                    transitionDuration: `${SPIN_MS}ms`,
                  }}
                >
                  {WHEEL_ORDER.map((n, slot) => (
                    <span
                      key={n}
                      className="pocket-number"
                      style={{ transform: `rotate(${slot * SLICE + SLICE / 2}deg)` }}
                    >
                      {n}
                    </span>
                  ))}
                  <span className="frets" aria-hidden />
                </div>

                <div
                  className="ball-arm"
                  style={{
                    transform: `rotate(${ballAngle}deg)`,
                    transitionDuration: `${SPIN_MS}ms`,
                  }}
                  aria-hidden
                >
                  <span className="ball" />
                </div>

                <div className={`wheel-hub${reveal ? ` ${reveal.color}` : ''}`}>
                  {turning ? '·' : reveal ? reveal.pocket : available > 0 ? 'bet' : 'earn'}
                </div>
              </div>
            </div>

            <p className={`reveal${reveal ? (reveal.delta > 0 ? ' won' : ' lost') : ''}`}>
              {turning
                ? 'No more bets'
                : reveal
                  ? `${betLabel(reveal.bet)} · ${reveal.delta > 0 ? '+' : ''}${count(reveal.delta)}`
                  : `${betLabel(bet)} · pays ${betPayout(bet)} to 1`}
            </p>

            <div className="felt">
              <div className="felt-grid">
                <button
                  className={`cell green${on(ZERO) ? ' on' : ''}`}
                  style={{ gridArea: '1 / 1 / 4 / 2' }}
                  onClick={() => setBet(ZERO)}
                  disabled={turning}
                >
                  0
                </button>

                {FELT_ROWS.map((row, r) =>
                  row.map((n, c) => {
                    const straight: Bet = { kind: 'straight', value: n };
                    return (
                      <button
                        key={n}
                        className={`cell ${pocketColor(n)}${on(straight) ? ' on' : ''}`}
                        style={{ gridArea: `${r + 1} / ${c + 2}` }}
                        onClick={() => setBet(straight)}
                        disabled={turning}
                      >
                        {n}
                      </button>
                    );
                  }),
                )}

                {FELT_ROWS.map((row, r) => {
                  const column: Bet = { kind: 'column', value: (3 - r) as 1 | 2 | 3 };
                  return (
                    <button
                      key={`column-${r}`}
                      className={`cell outside${on(column) ? ' on' : ''}`}
                      style={{ gridArea: `${r + 1} / 14` }}
                      onClick={() => setBet(column)}
                      disabled={turning}
                      title={betLabel(column)}
                    >
                      2:1
                    </button>
                  );
                })}
              </div>

              <div className="felt-row">
                {([1, 2, 3] as const).map((value) => {
                  const dozen: Bet = { kind: 'dozen', value };
                  return (
                    <button
                      key={value}
                      className={`cell outside${on(dozen) ? ' on' : ''}`}
                      onClick={() => setBet(dozen)}
                      disabled={turning}
                    >
                      {betLabel(dozen)}
                    </button>
                  );
                })}
              </div>

              <div className="felt-row">
                {OUTSIDE.map((outside) => (
                  <button
                    key={`${outside.kind}-${outside.value}`}
                    className={`cell outside${
                      outside.kind === 'color' ? ` ${outside.value}` : ''
                    }${on(outside) ? ' on' : ''}`}
                    onClick={() => setBet(outside)}
                    disabled={turning}
                  >
                    {betLabel(outside)}
                  </button>
                ))}
              </div>
            </div>

            <div className="chips">
              {CHIPS.map((chip) => (
                <button
                  key={chip}
                  className={`chip${stake === chip ? ' on' : ''}`}
                  onClick={() => setStake(chip)}
                  disabled={turning || chip > coins}
                >
                  {chip}
                </button>
              ))}
              <button
                className={`chip${stake === coins && coins > 0 ? ' on' : ''}`}
                onClick={() => setStake(farm.coins)}
                disabled={turning || !canStake}
              >
                all in
              </button>
            </div>

            <button className="spin" onClick={turn} disabled={turning || !canSpin}>
              {available > 0 ? `Spin ${betLabel(bet)} · ${count(stakeClamped)}` : 'No spins'}
            </button>

            <p className="caption">
              A single-zero wheel: zero takes every outside bet. One spin per{' '}
              {compact(SPIN_TOKENS)} tokens — {compact(nextSpinIn)} to the next.{' '}
              {count(spinsEarned(lifetime))} minted so far.
            </p>
          </div>
        </div>

        <div className="panel shop">
          <header className="panel-head">
            <h2>The shop</h2>
            <span className="field-hint">
              <Pixel sprite="coin" size={16} /> {count(coins)}
            </span>
          </header>

          <div className="panel-body">
            <ul className="seeds">
              {SEEDS.map((seed) => {
                const afford = farm.coins >= seed.price;
                return (
                  <li key={seed.id}>
                    <button
                      className={`seed${chosen.id === seed.id ? ' on' : ''}`}
                      onClick={() => setChosen(seed)}
                      disabled={!afford}
                    >
                      <span className="seed-art">
                        <Pixel sprite={cropSprite(seed.id, 1)} size={24} />
                      </span>
                      <span className="seed-name">{seed.name}</span>
                      <span className="seed-price">
                        {seed.price === 0 ? (
                          'free'
                        ) : (
                          <>
                            {seed.price} <Pixel sprite="coin" size={8} />
                          </>
                        )}
                      </span>
                      <span className="seed-note">
                        {compact(seed.ripenWork)} work → {seed.yield} <Pixel sprite="coin" size={8} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <ul className="trinkets">
              {TRINKETS.map((trinket) => {
                const has = farm.trinkets.includes(trinket.id);
                return (
                  <li key={trinket.id}>
                    <button
                      className={`trinket${has ? ' owned' : ''}`}
                      onClick={() => apply((state) => buyTrinket(state, trinket.id, trinket.price))}
                      disabled={has || farm.coins < trinket.price}
                    >
                      <span className="seed-art">
                        <Pixel sprite={asSprite(trinket.id)} size={24} />
                      </span>
                      <span className="seed-name">{trinket.name}</span>
                      <span className="seed-price">
                        {has ? (
                          'owned'
                        ) : (
                          <>
                            {trinket.price} <Pixel sprite="coin" size={8} />
                          </>
                        )}
                      </span>
                      <span className="seed-note">{trinket.note}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <p className="caption">Wheat stays free. Trinkets stand in the field — they change nothing the ticker reports.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
