import { describe, expect, it } from 'vitest';
import {
  burnRatePerHour,
  comboLength,
  comboTier,
  dailyStreak,
  levelFor,
  longestCombo,
  comboTimeLeft,
  nextComboTier,
  rateSeries,
  tokenRatePerMinute,
} from '../src/core/momentum.js';

const SECOND = 1000;
const at = (secondsAgo: number, now: number) => new Date(now - secondsAgo * SECOND).toISOString();

describe('comboLength', () => {
  const now = Date.parse('2026-08-21T10:00:00Z');
  const gap = 120 * SECOND;

  it('counts turns that arrived one after another without a long pause', () => {
    // The 400s turn sits 310s before the 90s one — past the gap, so the run
    // starts after it.
    const combo = comboLength([at(400, now), at(90, now), at(40, now), at(5, now)], now, gap);

    expect(combo).toBe(3);
  });

  it('drops to nothing once the pause since the last turn exceeds the gap', () => {
    // The combo is live activity, not history — going quiet ends it.
    expect(comboLength([at(300, now), at(240, now)], now, gap)).toBe(0);
  });

  it('counts a lone recent turn as a combo of one', () => {
    expect(comboLength([at(5, now)], now, gap)).toBe(1);
  });

  it('is nothing when there are no turns at all', () => {
    expect(comboLength([], now, gap)).toBe(0);
  });

  it('reads the turns in whatever order they arrive', () => {
    const shuffled = [at(40, now), at(5, now), at(90, now)];

    expect(comboLength(shuffled, now, gap)).toBe(3);
  });
});

describe('burnRatePerHour', () => {
  const now = Date.parse('2026-08-21T10:00:00Z');
  const halfHour = 30 * 60 * SECOND;

  it('projects what the last window would cost if it kept up for an hour', () => {
    const rate = burnRatePerHour(
      [
        { at: at(600, now), usd: 2, tokens: 0, work: 0 },
        { at: at(60, now), usd: 4, tokens: 0, work: 0 },
      ],
      now,
      halfHour,
    );

    expect(rate).toBeCloseTo(12, 10);
  });

  it('ignores spend from before the window', () => {
    const rate = burnRatePerHour(
      [
        { at: at(4000, now), usd: 100, tokens: 0, work: 0 },
        { at: at(60, now), usd: 3, tokens: 0, work: 0 },
      ],
      now,
      halfHour,
    );

    expect(rate).toBeCloseTo(6, 10);
  });

  it('is zero when nothing has been spent lately', () => {
    expect(burnRatePerHour([], now, halfHour)).toBe(0);
    expect(burnRatePerHour([{ at: at(9000, now), usd: 50, tokens: 0, work: 0 }], now, halfHour)).toBe(0);
  });
});

describe('dailyStreak', () => {
  it('counts back over consecutive days of usage', () => {
    const streak = dailyStreak(['2026-08-14', '2026-08-19', '2026-08-20', '2026-08-21'], '2026-08-21');

    expect(streak).toBe(3);
  });

  it('survives a today that has not started yet', () => {
    // Yesterday's streak is not lost until the day actually ends.
    expect(dailyStreak(['2026-08-19', '2026-08-20'], '2026-08-21')).toBe(2);
  });

  it('is broken once a whole day was missed', () => {
    expect(dailyStreak(['2026-08-18', '2026-08-19'], '2026-08-21')).toBe(0);
  });

  it('is nothing without any usage', () => {
    expect(dailyStreak([], '2026-08-21')).toBe(0);
  });
});

describe('comboTier', () => {
  it('has no name for a run too short to brag about', () => {
    expect(comboTier(0)).toBeNull();
    expect(comboTier(1)).toBeNull();
  });

  it('names a run once it gets going', () => {
    expect(comboTier(3)).not.toBeNull();
  });

  it('climbs as the run gets longer', () => {
    const short = comboTier(3)!;
    const long = comboTier(40)!;

    expect(long.rank).toBeGreaterThan(short.rank);
    expect(long.name).not.toBe(short.name);
  });

  it('stays at the top tier rather than running out of names', () => {
    expect(comboTier(10_000)).toEqual(comboTier(50));
  });
});

describe('levelFor', () => {
  it('starts everyone at level one with nothing behind them', () => {
    const level = levelFor(0);

    expect(level.level).toBe(1);
    expect(level.into).toBe(0);
  });

  it('promotes on reaching the next threshold', () => {
    const before = levelFor(999_999);
    const after = levelFor(1_000_000);

    expect(before.level).toBe(1);
    expect(after.level).toBe(2);
  });

  it('reports progress as a fraction of the current level, never past it', () => {
    const level = levelFor(1_300_000);

    expect(level.level).toBe(2);
    expect(level.into / level.span).toBeGreaterThan(0);
    expect(level.into / level.span).toBeLessThan(1);
  });

  it('keeps climbing at the scale real usage reaches', () => {
    // Hundreds of millions of tokens should land in the low teens, not off
    // the end of a table.
    const level = levelFor(345_000_000);

    expect(level.level).toBeGreaterThan(8);
    expect(level.level).toBeLessThan(20);
  });
});

describe('rateSeries', () => {
  const start = Date.parse('2026-08-21T10:00:00Z');
  const at = (secondsIn: number) => new Date(start + secondsIn * SECOND).toISOString();
  const turn = (secondsIn: number, tokens: number) => ({ at: at(secondsIn), tokens });

  it('samples the trailing rate as it stood at each turn, the turn included', () => {
    const series = rateSeries([turn(0, 1_000), turn(30, 2_000)], 60 * SECOND);

    expect(series).toEqual([
      { at: at(0), value: 1_000, weight: 1_000 },
      { at: at(30), value: 3_000, weight: 2_000 },
    ]);
  });

  it('falls back as earlier turns age out of the window', () => {
    const series = rateSeries([turn(0, 90_000), turn(120, 600)], 60 * SECOND);

    expect(series[1]!.value).toBe(600);
  });

  it('scales the window to a minute rather than reporting its raw total', () => {
    const series = rateSeries([turn(0, 500)], 30 * SECOND);

    expect(series[0]!.value).toBe(1_000);
  });

  it('reads in the order the turns happened, whatever order they arrive in', () => {
    const series = rateSeries([turn(30, 2_000), turn(0, 1_000)], 60 * SECOND);

    expect(series.map((tick) => tick.at)).toEqual([at(0), at(30)]);
  });

  it('drops a turn with an unreadable timestamp instead of sorting it to one end', () => {
    const series = rateSeries([{ at: 'not a time', tokens: 5_000 }, turn(0, 1_000)], 60 * SECOND);

    expect(series).toEqual([{ at: at(0), value: 1_000, weight: 1_000 }]);
  });

  it('samples on a clock as well as at the turns, so one turn is not one flat candle', () => {
    // Sampled only where turns land, these two turns are two points and a
    // candle cut from them has no high and no low worth the name.
    const series = rateSeries([turn(0, 1_000), turn(45, 1_000)], 60 * SECOND, 15 * SECOND);

    expect(series.map((tick) => tick.value)).toEqual([
      1_000, // the first turn lands
      1_000, // …and stands, on the clock, while it is still in the window
      1_000,
      2_000, // the second turn lands on top of it
      1_000, // the first ages out
      1_000,
      1_000,
    ]);
  });

  it('stops sampling once the window is empty, so a quiet stretch is a gap', () => {
    const series = rateSeries([turn(0, 1_000), turn(600, 1_000)], 60 * SECOND, 15 * SECOND);
    const gap = series.filter(
      (tick) => Date.parse(tick.at) > start + 60 * SECOND && Date.parse(tick.at) < start + 600 * SECOND,
    );

    expect(gap).toEqual([]);
    expect(series.every((tick) => tick.value > 0)).toBe(true);
  });

  it('gives a clock sample no weight of its own, so volume stays what was spent', () => {
    const series = rateSeries([turn(0, 1_000), turn(45, 3_000)], 60 * SECOND, 15 * SECOND);

    expect(series.reduce((sum, tick) => sum + tick.weight, 0)).toBe(4_000);
  });

  it('samples at the turns alone when no clock is asked for', () => {
    expect(rateSeries([turn(0, 1_000), turn(45, 1_000)], 60 * SECOND)).toHaveLength(2);
  });

  it('has nothing to plot when nothing has happened', () => {
    expect(rateSeries([], 60 * SECOND)).toEqual([]);
  });
});

describe('a combo running out', () => {
  const now = Date.parse('2026-08-21T10:00:00Z');
  const at = (secondsAgo: number) => new Date(now - secondsAgo * SECOND).toISOString();

  it('counts down from the last turn to the gap that would break the run', () => {
    expect(comboTimeLeft([at(200), at(30)], now, 120 * SECOND)).toBe(90 * SECOND);
  });

  it('is nothing once the run is already broken', () => {
    expect(comboTimeLeft([at(600), at(300)], now, 120 * SECOND)).toBe(0);
    expect(comboTimeLeft([], now, 120 * SECOND)).toBe(0);
  });

  it('names the rung a run is climbing towards, and what it takes to get there', () => {
    expect(nextComboTier(1)).toMatchObject({ name: 'WARMING UP', from: 2, toGo: 1 });
    expect(nextComboTier(6)).toMatchObject({ name: 'ON FIRE', from: 10, toGo: 4 });
    expect(nextComboTier(50)).toBeNull();
  });
});

describe('tokenRatePerMinute', () => {
  const now = Date.parse('2026-08-21T10:00:00Z');
  const at = (secondsAgo: number) => new Date(now - secondsAgo * SECOND).toISOString();

  it('averages the tokens of the window over its length', () => {
    const rate = tokenRatePerMinute(
      [
        { at: at(90), usd: 0, tokens: 3000, work: 3000 },
        { at: at(10), usd: 0, tokens: 3000, work: 3000 },
      ],
      now,
      120 * SECOND,
    );

    expect(rate).toBeCloseTo(3_000, 10);
  });

  it('ignores turns from before the window', () => {
    const rate = tokenRatePerMinute(
      [
        { at: at(9000), usd: 0, tokens: 999_999, work: 999_999 },
        { at: at(10), usd: 0, tokens: 600, work: 600 },
      ],
      now,
      60 * SECOND,
    );

    expect(rate).toBeCloseTo(600, 10);
  });

  it('falls to nothing when the window empties', () => {
    expect(tokenRatePerMinute([], now, 60 * SECOND)).toBe(0);
  });
});

describe('longestCombo', () => {
  const base = Date.parse('2026-08-21T00:00:00Z');
  const stamp = (seconds: number) => new Date(base + seconds * SECOND).toISOString();
  const gap = 120 * SECOND;

  it('finds the longest unbroken run in the whole history', () => {
    const best = longestCombo(
      [
        // A run of two.
        stamp(0),
        stamp(60),
        // Long pause, then a run of four.
        stamp(5000),
        stamp(5060),
        stamp(5120),
        stamp(5180),
        // Another pause, then a run of three.
        stamp(9000),
        stamp(9060),
        stamp(9120),
      ],
      gap,
    );

    expect(best).toBe(4);
  });

  it('counts a lone turn as a run of one', () => {
    expect(longestCombo([stamp(0)], gap)).toBe(1);
  });

  it('is nothing without any turns', () => {
    expect(longestCombo([], gap)).toBe(0);
  });

  it('does not depend on the order it was handed', () => {
    const shuffled = [stamp(120), stamp(0), stamp(60)];

    expect(longestCombo(shuffled, gap)).toBe(3);
  });
});
