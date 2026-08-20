import { describe, expect, it } from 'vitest';
import {
  burnRatePerHour,
  comboLength,
  comboTier,
  dailyStreak,
  levelFor,
  tokenRatePerSecond,
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
        { at: at(600, now), usd: 2, tokens: 0 },
        { at: at(60, now), usd: 4, tokens: 0 },
      ],
      now,
      halfHour,
    );

    expect(rate).toBeCloseTo(12, 10);
  });

  it('ignores spend from before the window', () => {
    const rate = burnRatePerHour(
      [
        { at: at(4000, now), usd: 100, tokens: 0 },
        { at: at(60, now), usd: 3, tokens: 0 },
      ],
      now,
      halfHour,
    );

    expect(rate).toBeCloseTo(6, 10);
  });

  it('is zero when nothing has been spent lately', () => {
    expect(burnRatePerHour([], now, halfHour)).toBe(0);
    expect(burnRatePerHour([{ at: at(9000, now), usd: 50, tokens: 0 }], now, halfHour)).toBe(0);
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

describe('tokenRatePerSecond', () => {
  const now = Date.parse('2026-08-21T10:00:00Z');
  const at = (secondsAgo: number) => new Date(now - secondsAgo * SECOND).toISOString();

  it('averages the tokens of the window over its length', () => {
    const rate = tokenRatePerSecond(
      [
        { at: at(90), usd: 0, tokens: 3000 },
        { at: at(10), usd: 0, tokens: 3000 },
      ],
      now,
      120 * SECOND,
    );

    expect(rate).toBeCloseTo(50, 10);
  });

  it('ignores turns from before the window', () => {
    const rate = tokenRatePerSecond(
      [
        { at: at(9000), usd: 0, tokens: 999_999 },
        { at: at(10), usd: 0, tokens: 600 },
      ],
      now,
      60 * SECOND,
    );

    expect(rate).toBeCloseTo(10, 10);
  });

  it('falls to nothing when the window empties', () => {
    expect(tokenRatePerSecond([], now, 60 * SECOND)).toBe(0);
  });
});
