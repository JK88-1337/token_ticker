import { useEffect, useMemo, useRef, useState } from 'react';
import { totalTokens, workTokens } from '../core/limits.js';
import { COMBO_GAP_MS, comboLength, tokenRatePerSecond } from '../core/momentum.js';
import type { UsageSnapshot } from '../core/snapshot.js';
import { compact, count, full, todayKey, usd } from '../ui/format.js';
import { useAnimatedValue, useNow, useSampled } from '../ui/hooks.js';
import { Flap } from '../ticker/Flap.js';
import {
  FREE_SEED,
  SEEDS,
  SPIN_TOKENS,
  TRINKETS,
  WHEEL,
  growth,
  spinsEarned,
  stageArt,
  stageName,
  towardNextSpin,
  type Seed,
} from './economy.js';
import { buyTrinket, harvest, plant, plotSeed, spin, spinsAvailable } from './state.js';
import { useFarm } from './storage.js';
import './farm.css';

/** How long the wheel turns before it settles. */
const SPIN_MS = 3_200;
/** Matches the ticker, so the small board reads the same as the big one. */
const FLAP_MS = 80;
const RATE_WINDOW_MS = 60_000;

/** Wedge angles, in the order the wheel is drawn. */
function wedges(): { from: number; angle: number; coins: number }[] {
  const total = WHEEL.reduce((sum, slot) => sum + slot.weight, 0);
  let from = 0;
  return WHEEL.map((slot) => {
    const angle = (slot.weight / total) * 360;
    const wedge = { from, angle, coins: slot.coins };
    from += angle;
    return wedge;
  });
}

const WEDGES = wedges();

const WHEEL_PAINT = [
  'var(--series-1)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-2)',
  'var(--series-7)',
  'var(--series-5)',
];

/**
 * The farm.
 *
 * A game played entirely with figures the ticker already measures: crops
 * ripen on work tokens, and the wheel is turned by spins minted ten million
 * tokens at a time. The board across the top is the real one, at a size that
 * keeps it the point of the window — the field underneath is the reward for
 * what it is counting, not a replacement for it.
 *
 * Nothing here can strand a player. The wheel costs no coins and every slot
 * on it pays; wheat is free forever; and `state.ts` refuses any move that
 * would take coins below zero. See the rules at the top of `economy.ts`.
 */
export function Farm({ snapshot }: { snapshot: UsageSnapshot }) {
  const now = useNow(1000);
  const [farm, apply] = useFarm();
  const [chosen, setChosen] = useState<Seed>(FREE_SEED);

  const lifetime = totalTokens(snapshot.totals.tokens);
  const lifetimeWork = workTokens(snapshot.totals.tokens);

  const key = todayKey(snapshot.timeZone);
  const today = snapshot.byDay.find((bucket) => bucket.key === key);
  const todayTokens = today ? totalTokens(today.totals.tokens) : 0;
  const shown = useSampled(useAnimatedValue(todayTokens), FLAP_MS);
  const rate = tokenRatePerSecond(snapshot.recent, now, RATE_WINDOW_MS);
  const combo = comboLength(
    snapshot.recent.map((event) => event.at),
    now,
    COMBO_GAP_MS,
  );

  const available = spinsAvailable(farm, lifetime);
  const nextSpinIn = towardNextSpin(lifetime);

  // While the wheel is turning the coin count holds at what it was: the
  // payout is already in the save — closing the window mid-spin keeps it —
  // but showing it before the wheel stops gives the result away.
  const [turning, setTurning] = useState(false);
  const [heldCoins, setHeldCoins] = useState<number | null>(null);
  const [angle, setAngle] = useState(0);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(settle.current), []);

  const turn = () => {
    if (turning || available < 1) return;

    setHeldCoins(farm.coins);
    setTurning(true);
    apply((state) => {
      const after = spin(state, lifetime);
      const landed = after.lastSpin;
      if (landed) {
        const wedge = WEDGES[landed.slot]!;
        // Five whole turns, then round to the middle of the wedge the save
        // already decided on — the animation reveals the result, never picks
        // it.
        const middle = wedge.from + wedge.angle / 2;
        setAngle((current) => current + 360 * 5 + ((360 - (current % 360) - middle) % 360));
      }
      return after;
    });

    settle.current = setTimeout(() => {
      setTurning(false);
      setHeldCoins(null);
    }, SPIN_MS);
  };

  const coins = heldCoins ?? farm.coins;
  const reveal = !turning && farm.lastSpin ? farm.lastSpin : null;

  const paint = useMemo(
    () =>
      WEDGES.map(
        (wedge, index) =>
          `${WHEEL_PAINT[index % WHEEL_PAINT.length]} ${wedge.from}deg ${wedge.from + wedge.angle}deg`,
      ).join(', '),
    [],
  );

  return (
    <div className="farm">
      <section className="farm-strip">
        <div className="farm-count">
          <p className="marquee-label">Tokens today</p>
          <Flap value={full(shown)} className="farm-flap" />
        </div>

        <dl className="marquee-stats farm-stats">
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
            <dt>Combo</dt>
            <dd>×{count(combo)}</dd>
          </div>
          <div>
            <dt>Coins</dt>
            <dd className="coins">🪙 {count(coins)}</dd>
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

          <ul className="plots">
            {farm.plots.map((plot, index) => {
              const seed = plotSeed(plot);
              const progress = seed ? growth(plot.plantedAtWork, seed, lifetimeWork) : 0;
              const ripe = progress >= 1;
              const remaining = seed
                ? Math.max(0, plot.plantedAtWork + seed.ripenWork - lifetimeWork)
                : 0;

              return (
                <li key={index}>
                  <button
                    className={`plot${seed ? ' sown' : ''}${ripe ? ' ripe' : ''}`}
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
                    <span className="plot-art">{seed ? stageArt(seed, progress) : '+'}</span>

                    {seed ? (
                      <>
                        <span className="plot-name">
                          {ripe ? `${seed.name} · ripe` : `${seed.name} · ${stageName(progress)}`}
                        </span>
                        <span className="plot-track">
                          <span className="plot-fill" style={{ width: `${progress * 100}%` }} />
                        </span>
                        <span className="plot-note">
                          {ripe ? `harvest for ${seed.yield} 🪙` : `${compact(remaining)} work to go`}
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

          {farm.trinkets.length > 0 ? (
            <ul className="ornaments">
              {TRINKETS.filter((trinket) => farm.trinkets.includes(trinket.id)).map((trinket) => (
                <li key={trinket.id} title={trinket.name}>
                  <span aria-hidden>{trinket.art}</span> {trinket.name}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="panel wheel-panel">
          <header className="panel-head">
            <h2>The wheel</h2>
            <span className="field-hint">{count(available)} to turn</span>
          </header>

          <div className="panel-body">
          <div className="wheel-wrap">
            <span className="wheel-pointer" aria-hidden />
            <div
              className="wheel"
              style={{
                background: `conic-gradient(${paint})`,
                transform: `rotate(${angle}deg)`,
                transitionDuration: `${SPIN_MS}ms`,
              }}
              aria-hidden
            />
            <div className="wheel-hub">
              {turning ? '…' : reveal ? `+${reveal.coins}` : available > 0 ? 'ready' : 'earn'}
            </div>
          </div>

          <button className="spin" onClick={turn} disabled={turning || available < 1}>
            {available > 0 ? `Spin (${available})` : 'No spins'}
          </button>

          <p className="caption">
            One spin per {compact(SPIN_TOKENS)} tokens — {compact(nextSpinIn)} to the next.{' '}
            {count(spinsEarned(lifetime))} minted so far. The wheel costs no coins and every wedge
            pays, so a turn can only leave you better off.
          </p>

          <ul className="odds">
            {WHEEL.map((slot, index) => (
              <li key={slot.coins}>
                <span className="odds-swatch" style={{ background: WHEEL_PAINT[index]! }} />
                <span className="odds-coins">{slot.coins} 🪙</span>
                <span className="odds-weight">{slot.weight}%</span>
              </li>
            ))}
          </ul>
          </div>
        </div>

        <div className="panel shop">
          <header className="panel-head">
            <h2>The shop</h2>
            <span className="field-hint">🪙 {count(coins)}</span>
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
                    <span className="seed-art">{seed.art}</span>
                    <span className="seed-name">{seed.name}</span>
                    <span className="seed-price">{seed.price === 0 ? 'free' : `${seed.price} 🪙`}</span>
                    <span className="seed-note">
                      {compact(seed.ripenWork)} work → {seed.yield} 🪙
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <ul className="trinkets">
            {TRINKETS.map((trinket) => {
              const owned = farm.trinkets.includes(trinket.id);
              return (
                <li key={trinket.id}>
                  <button
                    className={`trinket${owned ? ' owned' : ''}`}
                    onClick={() => apply((state) => buyTrinket(state, trinket.id, trinket.price))}
                    disabled={owned || farm.coins < trinket.price}
                  >
                    <span className="seed-art">{trinket.art}</span>
                    <span className="seed-name">{trinket.name}</span>
                    <span className="seed-price">{owned ? 'owned' : `${trinket.price} 🪙`}</span>
                    <span className="seed-note">{trinket.note}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="caption">
            Wheat stays free whatever the coin count says, so there is always something to plant
            and something to harvest. Trinkets are ornaments — nothing in here changes a figure the
            ticker reports.
          </p>
          </div>
        </div>
      </section>
    </div>
  );
}
