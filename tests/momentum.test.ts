import { describe, expect, it } from 'vitest';
import { burnRatePerHour, comboLength, dailyStreak } from '../src/core/momentum.js';

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
        { at: at(600, now), usd: 2 },
        { at: at(60, now), usd: 4 },
      ],
      now,
      halfHour,
    );

    expect(rate).toBeCloseTo(12, 10);
  });

  it('ignores spend from before the window', () => {
    const rate = burnRatePerHour(
      [
        { at: at(4000, now), usd: 100 },
        { at: at(60, now), usd: 3 },
      ],
      now,
      halfHour,
    );

    expect(rate).toBeCloseTo(6, 10);
  });

  it('is zero when nothing has been spent lately', () => {
    expect(burnRatePerHour([], now, halfHour)).toBe(0);
    expect(burnRatePerHour([{ at: at(9000, now), usd: 50 }], now, halfHour)).toBe(0);
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
