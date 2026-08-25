/**
 * The farm's save, and every move that can change it.
 *
 * Pure: each move takes a state and returns a state, and a move that is not
 * allowed returns the state it was given rather than throwing or half-
 * applying. The view can therefore offer a button and let this decide, and
 * the invariants that keep a player from getting stranded — coins never
 * negative, the wheel never charging coins, one seed always free — hold no
 * matter what the view does.
 */

import {
  FREE_SEED,
  PLOTS,
  growth,
  seedById,
  spinOutcome,
  spinsEarned,
  type Seed,
} from './economy.js';

/** One plot of the field. */
export interface Plot {
  /** What is in the ground, or null for bare earth. */
  seedId: string | null;
  /**
   * Lifetime work tokens at the moment it was sown.
   *
   * The clock a crop grows on is a token count, not a timestamp: it only
   * moves when work actually happens, and it cannot be wound forward by
   * changing the system clock.
   */
  plantedAtWork: number;
}

/** What the last spin came to, kept so a reload does not lose the reveal. */
export interface SpinResult {
  index: number;
  slot: number;
  coins: number;
}

export interface FarmState {
  version: 1;
  /**
   * Fixed at creation, and never changed.
   *
   * Every future spin is already determined by this and its own number, so
   * there is nothing to reroll: closing the window mid-spin, or reloading
   * before the wheel stops, lands on the same slot.
   */
  spinSeed: string;
  coins: number;
  /** Only ever goes up, and only ever by one. */
  spinsUsed: number;
  plots: Plot[];
  trinkets: string[];
  lastSpin: SpinResult | null;
}

const bare = (): Plot => ({ seedId: null, plantedAtWork: 0 });

/** A fresh farm. The seed is random; nothing else about a new save is. */
export function newFarm(random: () => number = Math.random): FarmState {
  return {
    version: 1,
    spinSeed: Math.floor(random() * 0xffff_ffff).toString(36) + Date.now().toString(36),
    coins: 0,
    spinsUsed: 0,
    plots: Array.from({ length: PLOTS }, bare),
    trinkets: [],
    lastSpin: null,
  };
}

/**
 * A loaded save, made safe to use.
 *
 * Anything unreadable becomes a new farm rather than an error: the save is a
 * toy on top of a measuring tool, and losing it must never stop the tool from
 * opening. Anything readable is clamped into range — a hand-edited coin count
 * of minus a million would otherwise make every purchase impossible.
 */
export function sanitise(loaded: unknown, random: () => number = Math.random): FarmState {
  const fresh = newFarm(random);
  if (typeof loaded !== 'object' || loaded === null) return fresh;

  const save = loaded as Partial<FarmState>;
  if (save.version !== 1 || typeof save.spinSeed !== 'string' || save.spinSeed === '') {
    return fresh;
  }

  const plots = Array.isArray(save.plots) ? save.plots.slice(0, PLOTS) : [];
  while (plots.length < PLOTS) plots.push(bare());

  return {
    version: 1,
    spinSeed: save.spinSeed,
    coins: Math.max(0, Math.floor(Number(save.coins) || 0)),
    spinsUsed: Math.max(0, Math.floor(Number(save.spinsUsed) || 0)),
    plots: plots.map((plot) => {
      const seedId = typeof plot?.seedId === 'string' && seedById(plot.seedId) ? plot.seedId : null;
      return {
        seedId,
        plantedAtWork: seedId ? Math.max(0, Number(plot?.plantedAtWork) || 0) : 0,
      };
    }),
    trinkets: Array.isArray(save.trinkets)
      ? save.trinkets.filter((id): id is string => typeof id === 'string')
      : [],
    lastSpin: save.lastSpin ?? null,
  };
}

/** Spins minted by the tokens, less the ones already taken. */
export function spinsAvailable(state: FarmState, lifetimeTokens: number): number {
  return Math.max(0, spinsEarned(lifetimeTokens) - state.spinsUsed);
}

/**
 * Sows a plot, paying for the seed.
 *
 * Refused, with the state unchanged, if the plot is taken, the seed is not
 * real, or the coins are not there. The free seed passes the last test by
 * costing nothing, which is what guarantees there is always a move.
 */
export function plant(
  state: FarmState,
  plotIndex: number,
  seedId: string,
  lifetimeWork: number,
): FarmState {
  const plot = state.plots[plotIndex];
  const seed = seedById(seedId);
  if (!plot || plot.seedId !== null || !seed || state.coins < seed.price) return state;

  const plots = [...state.plots];
  plots[plotIndex] = { seedId: seed.id, plantedAtWork: Math.max(0, lifetimeWork) };

  return { ...state, coins: state.coins - seed.price, plots };
}

/** What is in a plot, if anything. */
export function plotSeed(plot: Plot): Seed | undefined {
  return plot.seedId ? seedById(plot.seedId) : undefined;
}

/**
 * Takes a ripe crop off a plot and pays for it.
 *
 * Refused unless it is actually ripe — a crop cut early would be a way to
 * turn tokens into coins faster by planting and pulling, which is not a game,
 * it is a button.
 */
export function harvest(state: FarmState, plotIndex: number, lifetimeWork: number): FarmState {
  const plot = state.plots[plotIndex];
  if (!plot) return state;

  const seed = plotSeed(plot);
  if (!seed || growth(plot.plantedAtWork, seed, lifetimeWork) < 1) return state;

  const plots = [...state.plots];
  plots[plotIndex] = bare();

  return { ...state, coins: state.coins + seed.yield, plots };
}

/**
 * Turns the wheel.
 *
 * Costs one spin and no coins, and the slot it lands in was decided when the
 * save was created. Refused when there is no spin to take, which is the only
 * thing that ever stops it — there is no stake to lose and no way to end a
 * spin poorer than it began.
 */
export function spin(state: FarmState, lifetimeTokens: number): FarmState {
  if (spinsAvailable(state, lifetimeTokens) < 1) return state;

  const index = state.spinsUsed;
  const result = spinOutcome(state.spinSeed, index);

  return {
    ...state,
    coins: state.coins + result.coins,
    spinsUsed: index + 1,
    lastSpin: { index, slot: result.slot, coins: result.coins },
  };
}

/** Buys a trinket, once, if the coins are there. Cosmetic — nothing depends on one. */
export function buyTrinket(state: FarmState, id: string, price: number): FarmState {
  if (state.trinkets.includes(id) || state.coins < price) return state;
  return { ...state, coins: state.coins - price, trinkets: [...state.trinkets, id] };
}

/**
 * Whether there is any move left at all.
 *
 * The check that the no-corner rule is actually holding: with a bare plot and
 * a free seed there always is one, whatever the coins say. Exported so a test
 * can assert it and the view can say so.
 */
export function hasMove(state: FarmState, lifetimeTokens: number, lifetimeWork: number): boolean {
  if (spinsAvailable(state, lifetimeTokens) > 0) return true;
  if (state.plots.some((plot) => plot.seedId === null) && state.coins >= FREE_SEED.price) {
    return true;
  }
  return state.plots.some((plot) => {
    const seed = plotSeed(plot);
    return seed !== undefined && growth(plot.plantedAtWork, seed, lifetimeWork) >= 1;
  });
}
