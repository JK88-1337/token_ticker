/**
 * The farm's save, and every move that can change it.
 *
 * Pure: each move takes a state and returns a state, and a move that is not
 * allowed returns the state it was given rather than throwing or half-
 * applying. The view can therefore offer a button and let this decide, and
 * the invariants that keep a player from getting stranded — coins never
 * negative, one seed always free — hold no matter what the view does. The
 * wheel can take a stake; it cannot take the last move on the board.
 */

import {
  FREE_SEED,
  MIN_BET,
  PLOTS,
  POCKETS,
  growth,
  isBet,
  shareOut,
  seedById,
  settleBet,
  spinOutcome,
  spinsEarned,
  type Bet,
  type PocketColor,
  type Seed,
} from './economy.js';

/** One plot of the field. */
export interface Plot {
  /** What is in the ground, or null for bare earth. */
  seedId: string | null;
  /**
   * Work tokens this plot has been credited since it was sown.
   *
   * Credited, not elapsed: the field shares each new batch of work between
   * the plots that are in the ground, so this rises more slowly the fuller
   * the field is. It is a token count rather than a timestamp — it only
   * moves when work actually happens, and no system clock can wind it on.
   */
  grownWork: number;
}

/** What the last spin came to, kept so a reload does not lose the reveal. */
export interface SpinResult {
  index: number;
  pocket: number;
  color: PocketColor;
  bet: Bet;
  stake: number;
  delta: number;
}

export interface FarmState {
  version: 2;
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
  /** Seed ids taken off the field at least once. A sticker book, not a bonus. */
  harvested: string[];
  /**
   * Lifetime work tokens at the last share-out.
   *
   * What the field has already been paid for. Work done while the field was
   * bare moves this on without being credited anywhere: an empty field banks
   * nothing, so leaving the plots idle is a cost, not a saving.
   */
  workMark: number;
  /** Work tokens that would not divide between the plots, waiting for the next deal. */
  workCarry: number;
  lastSpin: SpinResult | null;
}

const bare = (): Plot => ({ seedId: null, grownWork: 0 });

/** A fresh farm. The seed is random; nothing else about a new save is. */
export function newFarm(random: () => number = Math.random): FarmState {
  return {
    version: 2,
    spinSeed: Math.floor(random() * 0xffff_ffff).toString(36) + Date.now().toString(36),
    coins: 0,
    spinsUsed: 0,
    plots: Array.from({ length: PLOTS }, bare),
    trinkets: [],
    harvested: [],
    workMark: 0,
    workCarry: 0,
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

  const save = loaded as Omit<Partial<FarmState>, 'version'> & { version?: number };
  if (
    (save.version !== 1 && save.version !== 2) ||
    typeof save.spinSeed !== 'string' ||
    save.spinSeed === ''
  ) {
    return fresh;
  }

  // A save from before the field shared its work has no record of what any
  // plot has been credited, and no mark to measure the next share from.
  // Crediting it from a lifetime count would ripen the whole field at once,
  // so its crops come back as bare earth. The coins, the album and the
  // trinkets they paid for are the save, and those keep.
  const plots =
    save.version === 2 && Array.isArray(save.plots) ? save.plots.slice(0, PLOTS) : [];
  while (plots.length < PLOTS) plots.push(bare());

  return {
    version: 2,
    spinSeed: save.spinSeed,
    coins: Math.max(0, Math.floor(Number(save.coins) || 0)),
    spinsUsed: Math.max(0, Math.floor(Number(save.spinsUsed) || 0)),
    plots: plots.map((plot) => {
      const seedId = typeof plot?.seedId === 'string' && seedById(plot.seedId) ? plot.seedId : null;
      return {
        seedId,
        grownWork: seedId ? Math.max(0, Math.floor(Number(plot?.grownWork) || 0)) : 0,
      };
    }),
    trinkets: Array.isArray(save.trinkets)
      ? save.trinkets.filter((id): id is string => typeof id === 'string')
      : [],
    harvested: Array.isArray(save.harvested)
      ? save.harvested.filter((id): id is string => typeof id === 'string' && seedById(id) !== undefined)
      : [],
    workMark: save.version === 2 ? Math.max(0, Math.floor(Number(save.workMark) || 0)) : 0,
    workCarry: save.version === 2 ? Math.max(0, Math.floor(Number(save.workCarry) || 0)) : 0,
    lastSpin: readLastSpin(save.lastSpin),
  };
}

function readLastSpin(loaded: unknown): SpinResult | null {
  if (typeof loaded !== 'object' || loaded === null) return null;
  const spin = loaded as Partial<SpinResult>;
  const pocket = Math.floor(Number(spin.pocket));
  const stake = Math.floor(Number(spin.stake));
  const delta = Math.floor(Number(spin.delta));
  const bet: unknown = spin.bet;
  const color = spin.color;
  if (
    !Number.isFinite(pocket) ||
    pocket < 0 ||
    pocket >= POCKETS ||
    !isBet(bet) ||
    (color !== 'red' && color !== 'black' && color !== 'green') ||
    !Number.isFinite(stake) ||
    stake < MIN_BET ||
    !Number.isFinite(delta)
  ) {
    return null;
  }
  return {
    index: Math.max(0, Math.floor(Number(spin.index) || 0)),
    pocket,
    color,
    bet,
    stake,
    delta,
  };
}

/** Spins minted by the tokens, less the ones already taken. */
export function spinsAvailable(state: FarmState, lifetimeTokens: number): number {
  return Math.max(0, spinsEarned(lifetimeTokens) - state.spinsUsed);
}

/**
 * Shares the work done since the last look out across the field.
 *
 * The single place growth comes from. Every plot in the ground takes an
 * equal share of the new work, so a full field grows eight times more
 * slowly per plot than a lone one — the same effort spread, never multiplied.
 * What will not divide is carried to the next deal rather than dropped, or a
 * field refreshed every second would never grow at all.
 *
 * A count that has gone backwards — a pruned transcript, a machine restored
 * from a backup — credits nothing and simply re-marks where the field is up
 * to.
 */
export function advance(state: FarmState, lifetimeWork: number): FarmState {
  const seen = Math.max(0, Math.floor(lifetimeWork));
  if (seen === state.workMark) return state;

  const gained = Math.max(0, seen - state.workMark);
  const sown = state.plots.filter((plot) => plot.seedId !== null).length;
  if (sown === 0) return { ...state, workMark: seen, workCarry: 0 };

  const { each, left } = shareOut(state.workCarry + gained, sown);

  return {
    ...state,
    workMark: seen,
    workCarry: left,
    plots: state.plots.map((plot) =>
      plot.seedId === null ? plot : { ...plot, grownWork: plot.grownWork + each },
    ),
  };
}

/**
 * Takes on a save that grew somewhere else.
 *
 * A farm carries the token count it was last settled against, and that count
 * means nothing on another machine: one with more tokens behind it would pay
 * the whole difference into the field at once and ripen everything, and one
 * with fewer would leave the field stuck. So the mark is moved to where this
 * machine actually is, and the crops carry on from the growth they had.
 */
export function adopt(state: FarmState, lifetimeWork: number): FarmState {
  return { ...state, workMark: Math.max(0, Math.floor(lifetimeWork)), workCarry: 0 };
}

/**
 * Sows a plot, paying for the seed./**
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
  const settled = advance(state, lifetimeWork);
  const plot = settled.plots[plotIndex];
  const seed = seedById(seedId);
  if (!plot || plot.seedId !== null || !seed || settled.coins < seed.price) return state;

  const plots = [...settled.plots];
  plots[plotIndex] = { seedId: seed.id, grownWork: 0 };

  return { ...settled, coins: settled.coins - seed.price, plots };
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
  const settled = advance(state, lifetimeWork);
  const plot = settled.plots[plotIndex];
  if (!plot) return state;

  const seed = plotSeed(plot);
  if (!seed || growth(plot.grownWork, seed) < 1) return state;

  const plots = [...settled.plots];
  plots[plotIndex] = bare();

  const harvested = settled.harvested.includes(seed.id)
    ? settled.harvested
    : [...settled.harvested, seed.id];

  return { ...settled, coins: settled.coins + seed.yield, plots, harvested };
}

/**
 * Turns the wheel.
 *
 * Costs one spin and a stake on anything the table takes — a colour, a
 * parity, a half, a dozen, a column, or a single number at thirty-five to
 * one. The pocket was decided when the save was created. Refused when there
 * is no spin, the stake is not there, or the bet is not a wager: a turn can
 * leave you poorer, but it cannot take coins below zero.
 */
export function spin(
  state: FarmState,
  lifetimeTokens: number,
  stake: number,
  bet: Bet,
): FarmState {
  if (spinsAvailable(state, lifetimeTokens) < 1) return state;
  if (!isBet(bet)) return state;

  const amount = Math.floor(stake);
  if (amount < MIN_BET || amount > state.coins) return state;

  const index = state.spinsUsed;
  const landed = spinOutcome(state.spinSeed, index);
  const delta = settleBet(bet, landed.pocket, amount);

  return {
    ...state,
    coins: state.coins + delta,
    spinsUsed: index + 1,
    lastSpin: {
      index,
      pocket: landed.pocket,
      color: landed.color,
      bet,
      stake: amount,
      delta,
    },
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
  const settled = advance(state, lifetimeWork);
  return settled.plots.some((plot) => {
    const seed = plotSeed(plot);
    return seed !== undefined && growth(plot.grownWork, seed) >= 1;
  });
}
