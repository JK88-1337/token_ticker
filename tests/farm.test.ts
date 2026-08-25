import { describe, expect, it } from 'vitest';
import {
  FREE_SEED,
  PLOTS,
  SEEDS,
  SPIN_TOKENS,
  WHEEL,
  growth,
  seedById,
  spinOutcome,
  spinsEarned,
  wheelExpectation,
} from '../src/farm/economy.js';
import {
  buyTrinket,
  harvest,
  hasMove,
  newFarm,
  plant,
  sanitise,
  spin,
  spinsAvailable,
  type FarmState,
} from '../src/farm/state.js';

/** A save with a fixed seed, so an outcome under test is the same every run. */
const farm = (over: Partial<FarmState> = {}): FarmState => ({
  ...newFarm(() => 0.42),
  spinSeed: 'fixed-seed',
  ...over,
});

const tomato = seedById('tomato')!;

describe('the wheel', () => {
  it('has no slot that takes coins away, and none that pays nothing', () => {
    expect(WHEEL.every((slot) => slot.coins > 0)).toBe(true);
  });

  it('averages out to the figure the shop is priced against', () => {
    expect(wheelExpectation()).toBeCloseTo(46.5, 6);
  });

  it('lands the same spin in the same slot however often it is asked', () => {
    const once = spinOutcome('fixed-seed', 7);
    const again = spinOutcome('fixed-seed', 7);

    expect(again).toEqual(once);
  });

  it('gives different saves different runs of outcomes', () => {
    const mine = Array.from({ length: 40 }, (_, i) => spinOutcome('one', i).slot);
    const yours = Array.from({ length: 40 }, (_, i) => spinOutcome('two', i).slot);

    expect(mine).not.toEqual(yours);
  });

  it('lands in the slots about as often as their weights say', () => {
    const runs = 20_000;
    const seen = new Array(WHEEL.length).fill(0);
    for (let i = 0; i < runs; i++) seen[spinOutcome('sample', i).slot]++;

    const total = WHEEL.reduce((sum, slot) => sum + slot.weight, 0);
    WHEEL.forEach((slot, index) => {
      expect(seen[index] / runs).toBeCloseTo(slot.weight / total, 1);
    });
  });
});

describe('spins', () => {
  it('mints one for every ten million tokens', () => {
    expect(spinsEarned(0)).toBe(0);
    expect(spinsEarned(SPIN_TOKENS - 1)).toBe(0);
    expect(spinsEarned(SPIN_TOKENS)).toBe(1);
    expect(spinsEarned(45 * SPIN_TOKENS + 7)).toBe(45);
  });

  it('never mints a negative number of them', () => {
    expect(spinsEarned(-5_000_000)).toBe(0);
  });

  it('counts what is left after the ones already taken', () => {
    expect(spinsAvailable(farm({ spinsUsed: 3 }), 5 * SPIN_TOKENS)).toBe(2);
  });

  it('does not go negative when a save has outlived its own transcripts', () => {
    expect(spinsAvailable(farm({ spinsUsed: 9 }), SPIN_TOKENS)).toBe(0);
  });

  it('pays out and takes exactly one spin', () => {
    const before = farm({ coins: 100 });
    const after = spin(before, 3 * SPIN_TOKENS);

    expect(after.spinsUsed).toBe(1);
    expect(after.coins).toBeGreaterThan(before.coins);
    expect(after.lastSpin?.coins).toBe(after.coins - before.coins);
  });

  it('is refused when there is no spin to take, and changes nothing', () => {
    const before = farm({ coins: 100 });

    expect(spin(before, SPIN_TOKENS - 1)).toBe(before);
  });

  it('never leaves a player poorer than they started', () => {
    let state = farm({ coins: 0 });
    for (let i = 0; i < 200; i++) {
      const before = state.coins;
      state = spin(state, 500 * SPIN_TOKENS);
      expect(state.coins).toBeGreaterThanOrEqual(before);
    }
  });

  it('lands on the same slot after a reload, so there is no reroll to scum for', () => {
    const before = farm();
    const played = spin(before, 9 * SPIN_TOKENS);
    const reloaded = spin(sanitise(JSON.parse(JSON.stringify(before))), 9 * SPIN_TOKENS);

    expect(reloaded.lastSpin?.slot).toBe(played.lastSpin?.slot);
    expect(reloaded.coins).toBe(played.coins);
  });
});

describe('growing', () => {
  it('is measured in the work tokens spent since it went in', () => {
    expect(growth(1_000_000, tomato, 1_000_000)).toBe(0);
    expect(growth(1_000_000, tomato, 1_600_000)).toBeCloseTo(0.5, 10);
    expect(growth(1_000_000, tomato, 2_200_000)).toBe(1);
  });

  it('stops at ripe rather than running past it', () => {
    expect(growth(0, tomato, 99_000_000)).toBe(1);
  });

  it('reads a count that has gone backwards as no progress, not negative progress', () => {
    expect(growth(5_000_000, tomato, 1_000_000)).toBe(0);
  });
});

describe('planting', () => {
  it('pays for the seed out of the coins', () => {
    const after = plant(farm({ coins: 500 }), 0, 'tomato', 2_000_000);

    expect(after.coins).toBe(400);
    expect(after.plots[0]).toEqual({ seedId: 'tomato', plantedAtWork: 2_000_000 });
  });

  it('is refused when the coins are not there, and changes nothing', () => {
    const before = farm({ coins: 99 });

    expect(plant(before, 0, 'tomato', 0)).toBe(before);
  });

  it('is refused on a plot that is already taken', () => {
    const sown = plant(farm({ coins: 500 }), 0, 'tomato', 0);

    expect(plant(sown, 0, 'corn', 0)).toBe(sown);
  });

  it('always allows the free seed, however broke the player is', () => {
    const broke = farm({ coins: 0 });
    const after = plant(broke, 0, FREE_SEED.id, 0);

    expect(after.plots[0]?.seedId).toBe(FREE_SEED.id);
    expect(after.coins).toBe(0);
  });
});

describe('harvesting', () => {
  it('pays the yield and clears the plot', () => {
    const sown = plant(farm({ coins: 500 }), 0, 'tomato', 0);
    const after = harvest(sown, 0, tomato.ripenWork);

    expect(after.coins).toBe(400 + tomato.yield);
    expect(after.plots[0]?.seedId).toBeNull();
  });

  it('is refused before it is ripe, so a crop cannot be cut early for coins', () => {
    const sown = plant(farm({ coins: 500 }), 0, 'tomato', 0);

    expect(harvest(sown, 0, tomato.ripenWork - 1)).toBe(sown);
  });

  it('is refused on bare earth', () => {
    const before = farm({ coins: 10 });

    expect(harvest(before, 3, 9_999_999)).toBe(before);
  });
});

describe('the shop', () => {
  it('refuses a trinket that cannot be afforded', () => {
    const before = farm({ coins: 10 });

    expect(buyTrinket(before, 'pond', 1_500)).toBe(before);
  });

  it('will not sell the same trinket twice', () => {
    const owned = buyTrinket(farm({ coins: 5_000 }), 'pond', 1_500);

    expect(buyTrinket(owned, 'pond', 1_500)).toBe(owned);
  });

  it('prices every seed below what it pays back', () => {
    expect(SEEDS.every((seed) => seed.yield > seed.price)).toBe(true);
  });

  it('keeps one seed free, which is what stops a player getting stuck', () => {
    expect(FREE_SEED.price).toBe(0);
  });
});

describe('never getting stranded', () => {
  it('leaves a move on the board with no coins, no spins and a bare field', () => {
    expect(hasMove(farm({ coins: 0 }), 0, 0)).toBe(true);
  });

  it('leaves a move when the field is full and everything is still growing', () => {
    // Broke, no spins, every plot sown a moment ago: the ripe crops are the
    // way out, and one of them is.
    let state = farm({ coins: 0 });
    for (let i = 0; i < PLOTS; i++) state = plant(state, i, FREE_SEED.id, 0);

    expect(hasMove(state, 0, 0)).toBe(false);
    expect(hasMove(state, 0, FREE_SEED.ripenWork)).toBe(true);
  });

  it('cannot be driven to negative coins by any run of moves', () => {
    let state = farm({ coins: 0 });

    for (let step = 0; step < 300; step++) {
      state = spin(state, step * SPIN_TOKENS);
      state = plant(state, step % PLOTS, SEEDS[step % SEEDS.length]!.id, step * 10_000);
      state = harvest(state, step % PLOTS, step * 10_000);
      state = buyTrinket(state, `trinket-${step % 4}`, 4_000);
      expect(state.coins).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('loading a save', () => {
  it('starts fresh rather than failing when the file is nonsense', () => {
    expect(sanitise('not a farm').coins).toBe(0);
    expect(sanitise(null).plots).toHaveLength(PLOTS);
    expect(sanitise({ version: 99 }).plots).toHaveLength(PLOTS);
  });

  it('clamps a hand-edited coin count back into range', () => {
    const edited = { ...farm(), coins: -1_000_000 };

    expect(sanitise(edited).coins).toBe(0);
  });

  it('drops a planting whose seed no longer exists', () => {
    const edited = { ...farm(), plots: [{ seedId: 'moonfruit', plantedAtWork: 5 }] };
    const loaded = sanitise(edited);

    expect(loaded.plots[0]?.seedId).toBeNull();
    expect(loaded.plots).toHaveLength(PLOTS);
  });

  it('keeps what a real save holds', () => {
    const played = spin(plant(farm({ coins: 900 }), 2, 'corn', 40_000), 4 * SPIN_TOKENS);
    const loaded = sanitise(JSON.parse(JSON.stringify(played)));

    expect(loaded).toEqual(played);
  });
});
