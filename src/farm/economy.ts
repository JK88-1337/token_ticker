/**
 * The farm's economy, as pure arithmetic.
 *
 * Everything a player earns traces back to a real token count. Crops ripen
 * on tokens, spins are minted by tokens, and coins come from harvests — never
 * from time passing, so nothing here can be farmed by leaving the window
 * open or by moving the system clock.
 *
 * The field shares that work rather than handing all of it to every plot:
 * see {@link shareOut}. Sowing a second plot halves the speed of the first,
 * so a full field is a spread of the same effort, not eight times the effort.
 *
 * The wheel is a table, not a mint. It is a European single-zero wheel and
 * settles like one: a spin costs a stake on anything the felt takes, pays
 * what a real table pays, and can take those coins away. Two rules still
 * make it impossible to get stranded, and both are enforced here rather
 * than in the view:
 *
 *   1. One seed is free, forever. However broke you are, you can plant,
 *      harvest and earn again.
 *   2. Coins cannot go negative — a purchase or a bet you cannot afford
 *      does not happen at all.
 */

/** Tokens that mint one spin of the wheel. */
export const SPIN_TOKENS = 10_000_000;

/** How many plots the field has. */
export const PLOTS = 8;

export interface Seed {
  id: string;
  name: string;
  /** Coins to buy one. The first seed is free and must stay that way. */
  price: number;
  /**
   * Work tokens that must be spent before it is ripe.
   *
   * Work tokens rather than every token: cache reads run to ninety-odd
   * percent of a total and would ripen a field in minutes of idle context
   * reuse. Work is the measure of effort the allowance gauge already uses.
   */
  ripenWork: number;
  /** Coins paid at harvest. Always more than the price, or why plant it. */
  yield: number;
  /** The crop when ripe. Earlier stages are shared — see {@link stageArt}. */
  art: string;
}

/**
 * The seed catalogue, cheapest first.
 *
 * The scale is set from real use: a working day runs to a few hundred
 * thousand work tokens, so one plot of wheat is an afternoon and one of
 * goldgrain is a heavy week — and a field of eight takes eight times as long
 * to bring in, for eight times the crop. Dearer seeds pay better per token,
 * which is the only reason to save.
 */
export const SEEDS: readonly Seed[] = [
  { id: 'wheat', name: 'Wheat', price: 0, ripenWork: 100_000, yield: 20, art: '🌾' },
  { id: 'corn', name: 'Corn', price: 30, ripenWork: 400_000, yield: 120, art: '🌽' },
  { id: 'tomato', name: 'Tomato', price: 100, ripenWork: 1_200_000, yield: 400, art: '🍅' },
  { id: 'pumpkin', name: 'Pumpkin', price: 300, ripenWork: 3_000_000, yield: 1_100, art: '🎃' },
  { id: 'goldgrain', name: 'Goldgrain', price: 800, ripenWork: 8_000_000, yield: 3_200, art: '✨' },
];

export function seedById(id: string): Seed | undefined {
  return SEEDS.find((seed) => seed.id === id);
}

/** The free seed, which every rule about not getting stuck depends on. */
export const FREE_SEED = SEEDS[0]!;

/** Something to spend coins on that is not a seed. Cosmetic, always. */
export interface Trinket {
  id: string;
  name: string;
  price: number;
  art: string;
  note: string;
}

export const TRINKETS: readonly Trinket[] = [
  { id: 'scarecrow', name: 'Scarecrow', price: 250, art: '🪧', note: 'Stands in the field' },
  { id: 'fence', name: 'Fence', price: 600, art: '🪵', note: 'Rings the plots' },
  { id: 'pond', name: 'Pond', price: 1_500, art: '🦆', note: 'Ducks included' },
  { id: 'windmill', name: 'Windmill', price: 4_000, art: '🌬️', note: 'Turns with the rate' },
];

/** Colour of a pocket on the wheel. */
export type PocketColor = 'red' | 'black' | 'green';

/** Colour a player may bet on. Green is the house — it cannot be backed. */
export type BetColor = 'red' | 'black';

/**
 * A bet on the table.
 *
 * One shape per family of wager rather than a flat list of names, so the
 * thing a player picked and the thing that decides the payout are the same
 * value — the view never has to translate, and a saved bet replays exactly.
 */
export type Bet =
  | { kind: 'color'; value: BetColor }
  | { kind: 'parity'; value: 'odd' | 'even' }
  | { kind: 'half'; value: 'low' | 'high' }
  | { kind: 'dozen'; value: 1 | 2 | 3 }
  | { kind: 'column'; value: 1 | 2 | 3 }
  | { kind: 'straight'; value: number };

/**
 * Whether `pocket` is one the bet was covering.
 *
 * Zero is covered by nothing but a straight bet on zero itself: every
 * outside wager loses to it, which is where the house's edge lives.
 */
export function betCovers(bet: Bet, pocket: number): boolean {
  if (bet.kind === 'straight') return pocket === bet.value;
  if (pocket === 0) return false;
  switch (bet.kind) {
    case 'color':
      return pocketColor(pocket) === bet.value;
    case 'parity':
      return (pocket % 2 === 1) === (bet.value === 'odd');
    case 'half':
      return bet.value === 'low' ? pocket <= 18 : pocket >= 19;
    case 'dozen':
      return Math.ceil(pocket / 12) === bet.value;
    case 'column':
      return ((pocket - 1) % 3) + 1 === bet.value;
  }
}

/**
 * Whether an unknown value is a bet this table takes.
 *
 * Guards both ends of the save file and the view: a hand-edited bet on a
 * thirty-seventh number, or on a fourth dozen, is not a wager, and settling
 * one would be inventing a payout nobody offered.
 */
export function isBet(value: unknown): value is Bet {
  if (typeof value !== 'object' || value === null) return false;
  const bet = value as { kind?: unknown; value?: unknown };
  switch (bet.kind) {
    case 'color':
      return bet.value === 'red' || bet.value === 'black';
    case 'parity':
      return bet.value === 'odd' || bet.value === 'even';
    case 'half':
      return bet.value === 'low' || bet.value === 'high';
    case 'dozen':
    case 'column':
      return bet.value === 1 || bet.value === 2 || bet.value === 3;
    case 'straight':
      return (
        typeof bet.value === 'number' &&
        Number.isInteger(bet.value) &&
        bet.value >= 0 &&
        bet.value < POCKETS
      );
    default:
      return false;
  }
}

/** What the table calls this bet, for the button and for the reveal. */
export function betLabel(bet: Bet): string {
  switch (bet.kind) {
    case 'color':
      return bet.value === 'red' ? 'Red' : 'Black';
    case 'parity':
      return bet.value === 'odd' ? 'Odd' : 'Even';
    case 'half':
      return bet.value === 'low' ? '1–18' : '19–36';
    case 'dozen':
      return `${['1st', '2nd', '3rd'][bet.value - 1]} 12`;
    case 'column':
      return `Column ${bet.value}`;
    case 'straight':
      return `Straight ${bet.value}`;
  }
}

/** Coins won per coin staked, by family. The rest of the table's arithmetic. */
export function betPayout(bet: Bet): number {
  if (bet.kind === 'straight') return 35;
  return bet.kind === 'dozen' || bet.kind === 'column' ? 2 : 1;
}

/**
 * The numbers around a European wheel head, clockwise from zero.
 *
 * Deliberately not counting order. A real wheel scatters the numbers so that
 * neighbours differ in colour, high sits beside low, and no sector of the rim
 * is worth more than another — which is exactly what makes a wheel read as a
 * wheel rather than as a pie chart. The view seats the pockets by this.
 */
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20,
  14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const SLOT_OF = new Map(WHEEL_ORDER.map((n, slot) => [n, slot]));

/** Where pocket `n` sits on the rim, counting clockwise from zero at the top. */
export function wheelSlot(n: number): number {
  return SLOT_OF.get(n) ?? 0;
}

/**
 * The eighteen numbers a real wheel paints red.
 *
 * Not a parity rule: the set is picked so that the colours still alternate
 * around the wheel head and each half balances high against low. Copied from
 * the standard layout rather than derived, because there is nothing to
 * derive — it is a convention, and getting it wrong is the first thing
 * anyone who has seen a table notices.
 */
const RED_NUMBERS: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

/** Colour of pocket `n`: 0 is green, eighteen are red, eighteen are black. */
export function pocketColor(n: number): PocketColor {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

/**
 * Net coins from a bet on a pocket: winnings if it was covered, else the
 * stake gone. The green zero is covered by nothing, which is the whole of
 * the house's edge and the only reason the table makes money.
 */
export function settleBet(bet: Bet, pocket: number, stake: number): number {
  return betCovers(bet, pocket) ? stake * betPayout(bet) : -stake;
}

/** FNV-1a, for a stable number out of a string on every machine. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}

/** A single-zero European wheel: zero and 1–36. */
export const POCKETS = 37;

/** Smallest stake the wheel will take. Wheat yields 20, so a loss still leaves another bet. */
export const MIN_BET = 10;

/**
 * Which pocket spin number `index` lands in.
 *
 * A pure function of the save's own seed and the spin's number, so the result
 * is fixed the moment the save exists — long before the wheel is clicked.
 * Reloading mid-spin shows the same pocket, and there is no reroll to scum for:
 * the only way to change an outcome is to throw away the save, and the coins
 * with it.
 */
export function spinOutcome(spinSeed: string, index: number): { pocket: number; color: PocketColor } {
  const pocket = hash(`${spinSeed}:${index}`) % POCKETS;
  return { pocket, color: pocketColor(pocket) };
}

/** How many spins a lifetime token count has minted, ever. */
export function spinsEarned(lifetimeTokens: number): number {
  return Math.floor(Math.max(0, lifetimeTokens) / SPIN_TOKENS);
}

/** Tokens still to go before the next spin is minted. */
export function towardNextSpin(lifetimeTokens: number): number {
  return SPIN_TOKENS - (Math.max(0, lifetimeTokens) % SPIN_TOKENS);
}

/**
 * How a pool of work tokens is dealt out across the field.
 *
 * The field shares the work rather than each plot getting all of it: eight
 * plots sown means each one grows at an eighth the speed, so filling the
 * field spreads the same effort thinner instead of multiplying it. Only the
 * plots actually in the ground count — bare earth takes no share.
 *
 * Dealt in whole tokens, with what will not divide handed back as `left` for
 * the next deal. Rounding each share to the nearest token instead would stall
 * the field outright: a refresh that adds three tokens across eight plots
 * rounds to nothing every time, and nothing would ever ripen.
 */
export function shareOut(pool: number, plots: number): { each: number; left: number } {
  if (plots <= 0) return { each: 0, left: pool };
  const each = Math.floor(pool / plots);
  return { each, left: pool - each * plots };
}

/**
 * How far a planting has come, 0–1.
 *
 * Measured in the work tokens the plot has been credited — its share of the
 * field's work, not the whole of it. Anything nonsensical reads as no
 * progress rather than as negative progress.
 */
export function growth(grownWork: number, seed: Seed): number {
  if (seed.ripenWork <= 0) return 1;
  return Math.min(1, Math.max(0, grownWork / seed.ripenWork));
}

/**
 * What to draw for a planting at this much growth.
 *
 * Four stages, each visibly different from the one before — a plot that
 * looks the same at a tenth grown as it does at a half is a plot nobody
 * looks at twice.
 */
export function stageArt(seed: Seed, progress: number): string {
  if (progress >= 1) return seed.art;
  if (progress >= 0.6) return '🌿';
  if (progress >= 0.25) return '🌱';
  return '🌰';
}

/** What to call that stage. */
export function stageName(progress: number): string {
  if (progress >= 1) return 'ripe';
  if (progress >= 0.6) return 'filling';
  if (progress >= 0.25) return 'sprouted';
  return 'sown';
}
