import { describe, expect, it } from 'vitest';
import { CLIMB_MS, ROLL_MS, SETTLE_MS, rollPhase, rollProgress } from '../src/ui/roll.js';

describe('rollProgress', () => {
  it('is empty before the roll starts and complete when it ends', () => {
    expect(rollProgress(0)).toBe(0);
    expect(rollProgress(-1)).toBe(0);
    expect(rollProgress(ROLL_MS)).toBe(1);
    expect(rollProgress(ROLL_MS + 1_000)).toBe(1);
  });

  it('covers nine tenths of the gap in the fifteen-second climb', () => {
    // 3 * 15s / (3 * 15s + 5s) = 0.9, so the cubic brake starts at climb speed.
    expect(rollProgress(CLIMB_MS)).toBeCloseTo(0.9, 10);
    expect(rollProgress(CLIMB_MS / 2)).toBeCloseTo(0.45, 10);
  });

  it('closes the last tenth over five seconds of cubic ease-out', () => {
    const midSettle = CLIMB_MS + SETTLE_MS / 2;
    // Cubic ease-out at u=0.5 is 1 - 0.5^3 = 0.875 of the remaining tenth.
    expect(rollProgress(midSettle)).toBeCloseTo(0.9 + 0.1 * 0.875, 10);
  });

  it('hands off from climb to settle at the same speed', () => {
    const dt = 16;
    const climbSpeed = (rollProgress(CLIMB_MS) - rollProgress(CLIMB_MS - dt)) / dt;
    const settleSpeed = (rollProgress(CLIMB_MS + dt) - rollProgress(CLIMB_MS)) / dt;

    expect(settleSpeed).toBeCloseTo(climbSpeed, 5);
  });

  it('only ever moves forward', () => {
    let previous = 0;
    for (let elapsed = 0; elapsed <= ROLL_MS; elapsed += 250) {
      const next = rollProgress(elapsed);
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
  });
});

describe('rollPhase', () => {
  it('climbs for fifteen seconds, then settles, then idles', () => {
    expect(rollPhase(-1)).toBe('idle');
    expect(rollPhase(0)).toBe('climb');
    expect(rollPhase(CLIMB_MS - 1)).toBe('climb');
    expect(rollPhase(CLIMB_MS)).toBe('settle');
    expect(rollPhase(ROLL_MS - 1)).toBe('settle');
    expect(rollPhase(ROLL_MS)).toBe('idle');
  });
});
