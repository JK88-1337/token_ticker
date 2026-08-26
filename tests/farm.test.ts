import { describe, expect, it } from 'vitest';
import {
  FREE_SEED,
  PLOTS,
  POCKETS,
  SEEDS,
  SPIN_TOKENS,
  MIN_BET,
  WHEEL_ORDER,
  betLabel,
  growth,
  pocketColor,
  seedById,
  settleBet,
  shareOut,
  spinOutcome,
  spinsEarned,
  wheelSlot,
  type Bet,
} from '../src/farm/economy.js';
import {
  adopt,
  advance,
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

/** The plainest bet on the table, for the tests that are not about the bet. */
const onRed: Bet = { kind: 'color', value: 'red' };

/** Index of the first spin that lands on this colour, for the fixture seed. */
function firstPocket(colour: 'red' | 'black' | 'green'): number {
  for (let i = 0; i < 400; i++) {
    if (spinOutcome('fixed-seed', i).color === colour) return i;
  }
  throw new Error(`no ${colour} pocket in the first 400 spins`);
}

describe('the wheel', () => {
  it('colours its pockets the way a European wheel does', () => {
    const colours = Array.from({ length: POCKETS }, (_, n) => pocketColor(n));
    const reds = colours.map((colour, n) => ({ colour, n })).filter((p) => p.colour === 'red');

    expect(POCKETS).toBe(37);
    expect(colours[0]).toBe('green');
    expect(colours.filter((colour) => colour === 'green')).toHaveLength(1);
    expect(colours.filter((colour) => colour === 'black')).toHaveLength(18);
    expect(reds.map((p) => p.n)).toEqual([
      1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
    ]);
  });

  it('seats the numbers the way a real wheel head runs, not in counting order', () => {
    const round = Array.from({ length: POCKETS }, (_, slot) => WHEEL_ORDER[slot]!);

    expect(round).toEqual([
      0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1,
      20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
    ]);
    expect(new Set(round).size).toBe(POCKETS);
    round.forEach((n, slot) => expect(wheelSlot(n)).toBe(slot));
  });

  it('never seats two pockets of the same colour side by side', () => {
    for (let slot = 0; slot < POCKETS; slot++) {
      const here = WHEEL_ORDER[slot]!;
      const next = WHEEL_ORDER[(slot + 1) % POCKETS]!;
      if (here === 0 || next === 0) continue;

      expect(pocketColor(here)).not.toBe(pocketColor(next));
    }
  });

  it('pays even money on colour, parity and half — and zero takes every one of them', () => {
    expect(settleBet({ kind: 'color', value: 'red' }, 3, 10)).toBe(10);
    expect(settleBet({ kind: 'color', value: 'black' }, 3, 10)).toBe(-10);
    expect(settleBet({ kind: 'color', value: 'black' }, 2, 50)).toBe(50);

    expect(settleBet({ kind: 'parity', value: 'odd' }, 3, 10)).toBe(10);
    expect(settleBet({ kind: 'parity', value: 'odd' }, 4, 10)).toBe(-10);
    expect(settleBet({ kind: 'parity', value: 'even' }, 4, 20)).toBe(20);

    expect(settleBet({ kind: 'half', value: 'low' }, 18, 10)).toBe(10);
    expect(settleBet({ kind: 'half', value: 'low' }, 19, 10)).toBe(-10);
    expect(settleBet({ kind: 'half', value: 'high' }, 19, 10)).toBe(10);
    expect(settleBet({ kind: 'half', value: 'high' }, 18, 10)).toBe(-10);

    const evens: Bet[] = [
      { kind: 'color', value: 'red' },
      { kind: 'color', value: 'black' },
      { kind: 'parity', value: 'odd' },
      { kind: 'parity', value: 'even' },
      { kind: 'half', value: 'low' },
      { kind: 'half', value: 'high' },
    ];
    evens.forEach((bet) => expect(settleBet(bet, 0, 10)).toBe(-10));
  });

  it('pays two to one on a dozen and on a column', () => {
    expect(settleBet({ kind: 'dozen', value: 1 }, 12, 10)).toBe(20);
    expect(settleBet({ kind: 'dozen', value: 1 }, 13, 10)).toBe(-10);
    expect(settleBet({ kind: 'dozen', value: 2 }, 13, 10)).toBe(20);
    expect(settleBet({ kind: 'dozen', value: 3 }, 36, 10)).toBe(20);

    expect(settleBet({ kind: 'column', value: 1 }, 34, 10)).toBe(20);
    expect(settleBet({ kind: 'column', value: 1 }, 35, 10)).toBe(-10);
    expect(settleBet({ kind: 'column', value: 2 }, 35, 10)).toBe(20);
    expect(settleBet({ kind: 'column', value: 3 }, 3, 10)).toBe(20);

    expect(settleBet({ kind: 'dozen', value: 1 }, 0, 10)).toBe(-10);
    expect(settleBet({ kind: 'column', value: 1 }, 0, 10)).toBe(-10);
  });

  it('pays thirty-five to one on a single number, and zero is a number like any other', () => {
    expect(settleBet({ kind: 'straight', value: 17 }, 17, 10)).toBe(350);
    expect(settleBet({ kind: 'straight', value: 17 }, 18, 10)).toBe(-10);
    expect(settleBet({ kind: 'straight', value: 0 }, 0, 10)).toBe(350);
    expect(settleBet({ kind: 'straight', value: 17 }, 0, 10)).toBe(-10);
  });

  it('names every bet the way the table calls it', () => {
    expect(betLabel({ kind: 'color', value: 'red' })).toBe('Red');
    expect(betLabel({ kind: 'parity', value: 'even' })).toBe('Even');
    expect(betLabel({ kind: 'half', value: 'low' })).toBe('1–18');
    expect(betLabel({ kind: 'half', value: 'high' })).toBe('19–36');
    expect(betLabel({ kind: 'dozen', value: 2 })).toBe('2nd 12');
    expect(betLabel({ kind: 'column', value: 3 })).toBe('Column 3');
    expect(betLabel({ kind: 'straight', value: 0 })).toBe('Straight 0');
    expect(betLabel({ kind: 'straight', value: 17 })).toBe('Straight 17');
  });

  it('lands the same spin in the same pocket however often it is asked', () => {
    const once = spinOutcome('fixed-seed', 7);
    const again = spinOutcome('fixed-seed', 7);

    expect(again).toEqual(once);
    expect(once.pocket).toBeGreaterThanOrEqual(0);
    expect(once.pocket).toBeLessThan(51);
    expect(once.color).toBe(pocketColor(once.pocket));
  });

  it('gives different saves different runs of outcomes', () => {
    const mine = Array.from({ length: 40 }, (_, i) => spinOutcome('one', i).pocket);
    const yours = Array.from({ length: 40 }, (_, i) => spinOutcome('two', i).pocket);

    expect(mine).not.toEqual(yours);
  });

  it('lands in the pockets about as often as a fair wheel would', () => {
    const runs = 20_000;
    const seen = new Array(POCKETS).fill(0);
    for (let i = 0; i < runs; i++) seen[spinOutcome('sample', i).pocket]++;

    const share = 1 / POCKETS;
    seen.forEach((count) => {
      expect(count / runs).toBeCloseTo(share, 2);
    });
  });

  it('gives the house the same thin edge whatever is bet: one pocket in thirty-seven', () => {
    const stake = 37;
    const table: Bet[] = [
      { kind: 'color', value: 'red' },
      { kind: 'color', value: 'black' },
      { kind: 'parity', value: 'odd' },
      { kind: 'parity', value: 'even' },
      { kind: 'half', value: 'low' },
      { kind: 'half', value: 'high' },
      { kind: 'dozen', value: 1 },
      { kind: 'dozen', value: 2 },
      { kind: 'dozen', value: 3 },
      { kind: 'column', value: 1 },
      { kind: 'column', value: 2 },
      { kind: 'column', value: 3 },
      { kind: 'straight', value: 0 },
      { kind: 'straight', value: 17 },
    ];

    table.forEach((bet) => {
      let net = 0;
      for (let n = 0; n < POCKETS; n++) net += settleBet(bet, n, stake);

      expect(net).toBe(-stake);
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

  it('pays even money when the bet matches the pocket that was already decided', () => {
    const spinsUsed = firstPocket('red');
    const before = farm({ coins: 100, spinsUsed });
    const after = spin(before, 500 * SPIN_TOKENS, 10, onRed);

    expect(after.spinsUsed).toBe(spinsUsed + 1);
    expect(after.coins).toBe(110);
    expect(after.lastSpin).toMatchObject({
      pocket: spinOutcome(before.spinSeed, spinsUsed).pocket,
      color: 'red',
      bet: onRed,
      stake: 10,
      delta: 10,
    });
  });

  it('pays a straight bet on the number that was already decided at thirty-five to one', () => {
    const before = farm({ coins: 100 });
    const landing = spinOutcome(before.spinSeed, 0).pocket;
    const after = spin(before, SPIN_TOKENS, 10, { kind: 'straight', value: landing });

    expect(after.coins).toBe(450);
    expect(after.lastSpin).toMatchObject({ bet: { kind: 'straight', value: landing }, delta: 350 });
  });

  it('is refused when the bet is not one the table takes, and changes nothing', () => {
    const before = farm({ coins: 100 });

    expect(spin(before, SPIN_TOKENS, MIN_BET, { kind: 'colour' } as unknown as Bet)).toBe(before);
    expect(spin(before, SPIN_TOKENS, MIN_BET, { kind: 'dozen', value: 4 } as unknown as Bet)).toBe(
      before,
    );
    expect(
      spin(before, SPIN_TOKENS, MIN_BET, { kind: 'straight', value: 37 } as unknown as Bet),
    ).toBe(before);
  });

  it('takes the stake when the bet misses, including the green zero', () => {
    const miss = firstPocket('black');
    const missed = spin(farm({ coins: 100, spinsUsed: miss }), 500 * SPIN_TOKENS, 10, onRed);
    expect(missed.coins).toBe(90);
    expect(missed.lastSpin?.delta).toBe(-10);

    const zero = firstPocket('green');
    const onZero = spin(farm({ coins: 100, spinsUsed: zero }), 500 * SPIN_TOKENS, 10, onRed);
    expect(onZero.coins).toBe(90);
    expect(onZero.lastSpin?.color).toBe('green');
  });

  it('is refused below the minimum stake, and changes nothing', () => {
    const before = farm({ coins: 100 });

    expect(spin(before, SPIN_TOKENS, MIN_BET - 1, onRed)).toBe(before);
  });

  it('is refused when there is no spin to take, and changes nothing', () => {
    const before = farm({ coins: 100 });

    expect(spin(before, SPIN_TOKENS - 1, MIN_BET, onRed)).toBe(before);
  });

  it('is refused when the coins cannot cover the stake, and changes nothing', () => {
    const before = farm({ coins: MIN_BET - 1 });

    expect(spin(before, SPIN_TOKENS, MIN_BET, onRed)).toBe(before);
  });

  it('lands on the same pocket after a reload, so there is no reroll to scum for', () => {
    const before = farm({ coins: 100 });
    const played = spin(before, 9 * SPIN_TOKENS, MIN_BET, onRed);
    const reloaded = spin(
      sanitise(JSON.parse(JSON.stringify(before))),
      9 * SPIN_TOKENS,
      MIN_BET,
      onRed,
    );

    expect(reloaded.lastSpin?.pocket).toBe(played.lastSpin?.pocket);
    expect(reloaded.coins).toBe(played.coins);
  });
});

describe('sharing the work out', () => {
  it('splits a pool evenly between the plots that are in the ground', () => {
    expect(shareOut(800, 8)).toEqual({ each: 100, left: 0 });
    expect(shareOut(800, 3)).toEqual({ each: 266, left: 2 });
    expect(shareOut(7, 8)).toEqual({ each: 0, left: 7 });
  });

  it('hands the whole pool back when there is nothing sown to take it', () => {
    expect(shareOut(500, 0)).toEqual({ each: 0, left: 500 });
  });
});

describe('the field taking its share', () => {
  it('credits every sown plot an equal share of the work since the last look', () => {
    let state = plant(farm({ coins: 500 }), 0, 'wheat', 1_000_000);
    state = plant(state, 1, 'wheat', 1_000_000);

    const moved = advance(state, 1_000_800);

    expect(moved.plots[0]!.grownWork).toBe(400);
    expect(moved.plots[1]!.grownWork).toBe(400);
    expect(moved.plots[2]!.grownWork).toBe(0);
  });

  it('slows a plot down as the field fills, instead of paying the same work twice', () => {
    const alone = advance(plant(farm({ coins: 500 }), 0, 'wheat', 0), 80_000);

    let full = farm({ coins: 500 });
    for (let i = 0; i < PLOTS; i++) full = plant(full, i, 'wheat', 0);
    const shared = advance(full, 80_000);

    expect(alone.plots[0]!.grownWork).toBe(80_000);
    expect(shared.plots[0]!.grownWork).toBe(10_000);
  });
});

describe('what the field does not credit', () => {
  it('banks nothing for the work done while the plots were bare', () => {
    const idle = advance(farm({ coins: 500 }), 5_000_000);
    const sown = plant(idle, 0, 'wheat', 5_000_000);

    expect(advance(sown, 5_000_100).plots[0]!.grownWork).toBe(100);
  });

  it('gives a plot nothing for the work that happened before it was sown', () => {
    let state = plant(farm({ coins: 500 }), 0, 'wheat', 0);
    state = advance(state, 40_000);
    state = plant(state, 1, 'wheat', 40_000);
    const moved = advance(state, 60_000);

    expect(moved.plots[0]!.grownWork).toBe(50_000);
    expect(moved.plots[1]!.grownWork).toBe(10_000);
  });

  it('credits nothing when the count has gone backwards, and re-marks where it is', () => {
    const state = advance(plant(farm({ coins: 500 }), 0, 'wheat', 100_000), 140_000);
    const pruned = advance(state, 20_000);

    expect(pruned.plots[0]!.grownWork).toBe(40_000);
    expect(advance(pruned, 20_500).plots[0]!.grownWork).toBe(40_500);
  });

  it('keeps growing on refreshes too small to divide, rather than rounding them away', () => {
    let state = farm({ coins: 500 });
    for (let i = 0; i < PLOTS; i++) state = plant(state, i, 'wheat', 0);

    // Three tokens across eight plots rounds to nothing every single time.
    for (let tick = 1; tick <= 800; tick++) state = advance(state, tick * 3);

    expect(state.plots[0]!.grownWork).toBe(300);
  });
});

describe('growing', () => {
  it('is measured in the work tokens the plot has been credited', () => {
    expect(growth(0, tomato)).toBe(0);
    expect(growth(600_000, tomato)).toBeCloseTo(0.5, 10);
    expect(growth(1_200_000, tomato)).toBe(1);
  });

  it('stops at ripe rather than running past it', () => {
    expect(growth(99_000_000, tomato)).toBe(1);
  });

  it('reads a nonsense credit as no progress, not negative progress', () => {
    expect(growth(-5_000_000, tomato)).toBe(0);
  });
});

describe('planting', () => {
  it('pays for the seed out of the coins', () => {
    const after = plant(farm({ coins: 500 }), 0, 'tomato', 2_000_000);

    expect(after.coins).toBe(400);
    expect(after.plots[0]).toEqual({ seedId: 'tomato', grownWork: 0 });
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

  it('remembers a crop the first time it is taken off the field', () => {
    const sown = plant(farm({ coins: 500 }), 0, 'tomato', 0);
    const after = harvest(sown, 0, tomato.ripenWork);

    expect(after.harvested).toEqual(['tomato']);
  });

  it('does not stamp the same crop twice', () => {
    const first = harvest(plant(farm({ coins: 500 }), 0, 'tomato', 0), 0, tomato.ripenWork);
    const second = harvest(plant(first, 0, 'tomato', 0), 0, tomato.ripenWork);

    expect(second.harvested).toEqual(['tomato']);
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

  it('leaves a move when spins are waiting but there are no coins to stake', () => {
    expect(hasMove(farm({ coins: 0 }), SPIN_TOKENS, 0)).toBe(true);
  });

  it('leaves a move when the field is full and everything is still growing', () => {
    // Broke, no spins, every plot sown a moment ago: the ripe crops are the
    // way out, and one of them is — once the field has done eight plots'
    // worth of work, because eight plots share it.
    let state = farm({ coins: 0 });
    for (let i = 0; i < PLOTS; i++) state = plant(state, i, FREE_SEED.id, 0);

    expect(hasMove(state, 0, 0)).toBe(false);
    expect(hasMove(state, 0, FREE_SEED.ripenWork)).toBe(false);
    expect(hasMove(state, 0, PLOTS * FREE_SEED.ripenWork)).toBe(true);
  });

  it('cannot be driven to negative coins by any run of moves', () => {
    let state = farm({ coins: 0 });

    for (let step = 0; step < 300; step++) {
      const bets: Bet[] = [
        onRed,
        { kind: 'straight', value: step % POCKETS },
        { kind: 'dozen', value: ((step % 3) + 1) as 1 | 2 | 3 },
        { kind: 'half', value: 'high' },
      ];
      state = spin(state, step * SPIN_TOKENS, MIN_BET, bets[step % bets.length]!);
      state = plant(state, step % PLOTS, SEEDS[step % SEEDS.length]!.id, step * 10_000);
      state = harvest(state, step % PLOTS, step * 10_000);
      state = buyTrinket(state, `trinket-${step % 4}`, 4_000);
      expect(state.coins).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('loading a save', () => {
  it('drops a last spin saved under the old paying wheel', () => {
    const loaded = sanitise({
      ...farm(),
      lastSpin: { index: 0, slot: 2, coins: 60 },
    });

    expect(loaded.lastSpin).toBeNull();
  });

  it('drops a last spin saved under the fifty-one pocket wheel, coins and all', () => {
    const wideWheel = sanitise({
      ...farm({ coins: 80 }),
      lastSpin: { index: 3, pocket: 44, color: 'black', bet: 'black', stake: 10, delta: 10 },
    });
    const oldBet = sanitise({
      ...farm({ coins: 80 }),
      lastSpin: { index: 3, pocket: 5, color: 'red', bet: 'red', stake: 10, delta: 10 },
    });

    expect(wideWheel.lastSpin).toBeNull();
    expect(oldBet.lastSpin).toBeNull();
    // The reveal is scenery. The coins it paid are the save, and they stay.
    expect(oldBet.coins).toBe(80);
  });

  it('keeps a last spin the table would still take', () => {
    const kept = sanitise({
      ...farm({ coins: 80 }),
      lastSpin: { index: 3, pocket: 5, color: 'red', bet: onRed, stake: 10, delta: 10 },
    });

    expect(kept.lastSpin).toMatchObject({ pocket: 5, bet: onRed, delta: 10 });
  });

  it('takes a save from before the field shared its work, crops back to bare earth', () => {
    const legacy = {
      version: 1,
      spinSeed: 'old-save',
      coins: 640,
      spinsUsed: 2,
      plots: [
        { seedId: 'pumpkin', plantedAtWork: 3_000_000 },
        { seedId: null, plantedAtWork: 0 },
      ],
      trinkets: ['scarecrow'],
      harvested: ['wheat', 'corn'],
      lastSpin: null,
    };

    const loaded = sanitise(legacy);

    expect(loaded.version).toBe(2);
    expect(loaded.coins).toBe(640);
    expect(loaded.spinsUsed).toBe(2);
    expect(loaded.trinkets).toEqual(['scarecrow']);
    expect(loaded.harvested).toEqual(['wheat', 'corn']);
    expect(loaded.plots).toHaveLength(PLOTS);
    expect(loaded.plots.every((plot) => plot.seedId === null)).toBe(true);
    // Nothing in the ground, so the first share-out cannot ripen a field.
    expect(advance(loaded, 90_000_000).plots.every((plot) => plot.grownWork === 0)).toBe(true);
  });

  it('keeps a shared field exactly where it was left', () => {
    let saved = plant(farm({ coins: 500 }), 0, 'wheat', 0);
    saved = advance(saved, 30_000);
    const loaded = sanitise(JSON.parse(JSON.stringify(saved)));

    expect(loaded.plots[0]).toEqual({ seedId: 'wheat', grownWork: 30_000 });
    expect(advance(loaded, 30_400).plots[0]!.grownWork).toBe(30_400);
  });

  it('grows a save brought from another machine from here, not from a windfall', () => {
    // Sown on a machine that had barely any tokens on it…
    let elsewhere = plant(farm({ coins: 500 }), 0, 'pumpkin', 4_000);
    elsewhere = advance(elsewhere, 5_000);

    // …and opened on one that has spent ninety million.
    const here = adopt(elsewhere, 90_000_000);

    expect(here.plots[0]!.grownWork).toBe(1_000);
    expect(advance(here, 90_002_000).plots[0]!.grownWork).toBe(3_000);
  });

  it('starts the album empty when an old save has no harvested list', () => {
    const legacy = { ...farm({ coins: 40 }), harvested: undefined };

    expect(sanitise(legacy).harvested).toEqual([]);
    expect(sanitise(legacy).coins).toBe(40);
  });

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
    const played = spin(plant(farm({ coins: 900 }), 2, 'corn', 40_000), 4 * SPIN_TOKENS, MIN_BET, onRed);
    const loaded = sanitise(JSON.parse(JSON.stringify(played)));

    expect(loaded).toEqual(played);
  });
});
