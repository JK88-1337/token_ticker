import { describe, expect, it } from 'vitest';
import { defaultPricingTable as table } from '../src/core/pricing.js';

const entries = Object.entries(table.models);

describe('the shipped pricing table', () => {
  it('prices the models Claude Code currently runs', () => {
    // Not exhaustive — a floor, so a table edit cannot quietly drop a model
    // that real transcripts contain.
    for (const model of ['claude-opus-5', 'claude-opus-4-8', 'claude-fable-5', 'claude-sonnet-5']) {
      expect(table.models, model).toHaveProperty(model);
    }
  });

  it.each(entries)('quotes %s at a positive rate', (_model, rate) => {
    expect(rate.input).toBeGreaterThan(0);
    expect(rate.output).toBeGreaterThan(rate.input);
  });

  it.each(entries.filter(([, r]) => r.fast))('charges more for fast mode on %s', (_model, rate) => {
    expect(rate.fast!.input).toBeGreaterThanOrEqual(rate.input);
    expect(rate.fast!.output).toBeGreaterThanOrEqual(rate.output);
  });

  it.each(entries.filter(([, r]) => r.introductory))(
    'discounts %s during a window that ends at a real instant',
    (_model, rate) => {
      const intro = rate.introductory!;
      expect(Number.isNaN(Date.parse(intro.untilExclusive))).toBe(false);
      expect(intro.input).toBeLessThan(rate.input);
      expect(intro.output).toBeLessThan(rate.output);
    },
  );

  it('keeps cache reads cheaper than fresh input and cache writes dearer', () => {
    const { read, write5m, write1h } = table.cacheMultipliers;
    expect(read).toBeLessThan(1);
    expect(write5m).toBeGreaterThan(1);
    expect(write1h).toBeGreaterThan(write5m);
  });

  it('records where the rates came from', () => {
    expect(table.source).toBeTruthy();
    expect(Number.isNaN(Date.parse(table.checkedOn!))).toBe(false);
  });
});
