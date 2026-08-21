import { describe, expect, it } from 'vitest';
import { punchProgress } from '../src/arcade/punch.js';

describe('punchProgress', () => {
  it('starts at zero and finishes at one', () => {
    expect(punchProgress(0)).toBe(0);
    expect(punchProgress(1_800)).toBe(1);
    expect(punchProgress(2_000)).toBe(1);
  });

  it('front-loads the jump and slows into the target', () => {
    expect(punchProgress(450)).toBeGreaterThan(0.65);
    expect(punchProgress(900)).toBeGreaterThan(0.9);
    expect(punchProgress(1_350)).toBeGreaterThan(punchProgress(900));
  });
});
