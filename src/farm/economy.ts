/**
 * The farm's economy, as pure arithmetic.
 *
 * Everything a player earns traces back to a real token count. Spins come
 * from tokens, crops ripen on tokens, and coins come from spins and harvests
 * — never from time passing, so nothing here can be farmed by leaving the
 * window open or by moving the system clock.
 *
 * Three rules make it impossible to play yourself into a corner, and every
 * one of them is enforced here rather than in the view:
 *
 *   1. The wheel never costs coins. It costs a spin, and spins are minted by
 *      tokens you have already spent. The worst slot on it still pays.
 *   2. One seed is free, forever. However broke you are, you can plant,
 *      harvest and earn again.
 *   3. Coins cannot go negative — a purchase you cannot afford does not
 *      happen at all.
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
 * thousand work tokens, so wheat is an afternoon and goldgrain is a heavy
 * week. Dearer seeds pay better per token, which is the only reason to save.
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

/** One wedge of the wheel. */
export interface Slot {
  coins: number;
  /** Relative likelihood. The weights are given out of a hundred. */
  weight: number;
}

/**
 * The wheel.
 *
 * Every slot pays. There is no slot that takes coins away and none that pays
 * nothing, because a wheel that can leave you worse off is a wheel that can
 * strand you — and the only way back would be another ten million tokens.
 * The spread is where the interest is: the common slot is a twentieth of the
 * rare one.
 */
export const WHEEL: readonly Slot[] = [
  { coins: 10, weight: 45 },
  { coins: 25, weight: 30 },
  { coins: 60, weight: 15 },
  { coins: 150, weight: 7 },
  { coins: 400, weight: 2.5 },
  { coins: 1_000, weight: 0.5 },
];

/** What a spin is worth on average — 46.5 coins, and the shop is priced on it. */
export function wheelExpectation(): number {
  const total = WHEEL.reduce((sum, slot) => sum + slot.weight, 0);
  return WHEEL.reduce((sum, slot) => sum + (slot.weight / total) * slot.coins, 0);
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

/**
 * Which slot spin number `index` lands in.
 *
 * A pure function of the save's own seed and the spin's number, so the result
 * is fixed the moment the save exists — long before the wheel is clicked.
 * Reloading mid-spin shows the same slot, and there is no reroll to scum for:
 * the only way to change an outcome is to throw away the save, and the coins
 * with it.
 */
export function spinOutcome(spinSeed: string, index: number): { slot: number; coins: number } {
  const total = WHEEL.reduce((sum, slot) => sum + slot.weight, 0);
  const roll = (hash(`${spinSeed}:${index}`) / 0x1_0000_0000) * total;

  let cumulative = 0;
  for (let i = 0; i < WHEEL.length; i++) {
    cumulative += WHEEL[i]!.weight;
    if (roll < cumulative) return { slot: i, coins: WHEEL[i]!.coins };
  }

  // Only reachable on floating-point drift at the very top of the range.
  return { slot: WHEEL.length - 1, coins: WHEEL[WHEEL.length - 1]!.coins };
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
 * How far a planting has come, 0–1.
 *
 * Measured in work tokens spent since it went in. A count that has somehow
 * gone backwards — a pruned transcript, a machine restored from a backup —
 * reads as no progress rather than as negative progress.
 */
export function growth(plantedAtWork: number, seed: Seed, lifetimeWork: number): number {
  if (seed.ripenWork <= 0) return 1;
  const done = (lifetimeWork - plantedAtWork) / seed.ripenWork;
  return Math.min(1, Math.max(0, done));
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
