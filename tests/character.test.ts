import { describe, expect, it } from 'vitest';
import {
  achievements,
  modelFamily,
  skillRank,
  skills,
  title,
  towardNextRank,
} from '../src/sheet/character.js';
import type { TokenCounts } from '../src/core/records.js';
import { SESSION_WINDOW_MS, type UsageSnapshot } from '../src/core/snapshot.js';
import type { UsageBucket, UsageTotals } from '../src/core/summary.js';

const tokens = (over: Partial<TokenCounts> = {}): TokenCounts => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  thinking: 0,
  ...over,
});

const totals = (over: Partial<TokenCounts> = {}, usd = 0): UsageTotals => ({
  turns: 1,
  tokens: tokens(over),
  usd,
  unpricedTurns: 0,
});

const day = (key: string, over: Partial<TokenCounts> = {}): UsageBucket => ({
  key,
  totals: totals(over),
});

/** A snapshot with everything at zero, so a test only states what it cares about. */
function snapshot(over: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    generatedAt: '2026-08-21T10:00:00.000Z',
    timeZone: 'UTC',
    totals: totals(),
    byDay: [],
    byModel: [],
    byProject: [],
    recent: [],
    window: { ms: SESSION_WINDOW_MS, totals: { turns: 0, tokens: tokens() } },
    peak: { totals: { turns: 0, tokens: tokens() }, endedAt: null },
    limitHits: [],
    observedCeiling: null,
    bestCombo: 0,
    ...over,
  };
}

describe('skillRank', () => {
  it('climbs a rung for every factor of ten', () => {
    expect(skillRank(100_000)).toBe(1);
    expect(skillRank(1_000_000)).toBe(2);
    expect(skillRank(10_000_000)).toBe(3);
    expect(skillRank(100_000_000)).toBe(4);
    expect(skillRank(1_000_000_000)).toBe(5);
  });

  it('floors at one and caps at five', () => {
    expect(skillRank(0)).toBe(1);
    expect(skillRank(-5)).toBe(1);
    expect(skillRank(12)).toBe(1);
    expect(skillRank(50_000_000_000)).toBe(5);
  });
});

describe('towardNextRank', () => {
  it('sits at the bottom of a rank on an exact power of ten', () => {
    expect(towardNextRank(100_000)).toBeCloseTo(0);
    expect(towardNextRank(1_000_000)).toBeCloseTo(0);
  });

  it('reads halfway up a rank at the geometric midpoint', () => {
    expect(towardNextRank(316_228)).toBeCloseTo(0.5, 3);
  });

  it('keeps moving above the top rank rather than pinning', () => {
    // Rank caps at five; progress through the decade does not, so the bar
    // still says something once a count is into the billions.
    expect(towardNextRank(2_690_000_000)).toBeGreaterThan(0.4);
    expect(towardNextRank(2_690_000_000)).toBeLessThan(0.5);
  });

  it('is zero for nothing measured', () => {
    expect(towardNextRank(0)).toBe(0);
    expect(towardNextRank(-1)).toBe(0);
  });
});

describe('skills', () => {
  const counts = tokens({
    cacheRead: 800_000,
    cacheWrite5m: 60_000,
    cacheWrite1h: 40_000,
    input: 40_000,
    output: 60_000,
    thinking: 30_000,
  });

  it('adds the two cache-write classes into one skill', () => {
    const write = skills(counts).find((skill) => skill.name === 'CONTEXT LAYING');

    expect(write?.tokens).toBe(100_000);
  });

  it('shares against the total for every class the total contains', () => {
    // 800k of a 1M total.
    const read = skills(counts).find((skill) => skill.name === 'CACHE MASTERY');

    expect(read?.denominator).toBe('total');
    expect(read?.share).toBeCloseTo(0.8);
  });

  it('measures thinking against output, never against the total', () => {
    // The API reports thinking as part of output. Sharing a denominator with
    // the total would count the same tokens twice, so the row says what it is
    // a share of.
    const thinking = skills(counts).find((skill) => skill.name === 'DEEP THINKING');

    expect(thinking?.denominator).toBe('output');
    expect(thinking?.share).toBeCloseTo(0.5);
  });

  it('reports zero shares rather than dividing by nothing', () => {
    for (const skill of skills(tokens())) {
      expect(skill.share).toBe(0);
      expect(skill.rank).toBe(1);
    }
  });
});

describe('achievements', () => {
  it('locks the survivor badge until a refusal is on record', () => {
    const before = achievements(snapshot(), '2026-08-21');
    const after = achievements(
      snapshot({
        limitHits: [{ at: '2026-08-20T09:00:00.000Z', scope: 'session', notice: 'limit reached' }],
      }),
      '2026-08-21',
    );

    expect(before.find((badge) => badge.id === 'survivor')?.earned).toBe(false);
    expect(after.find((badge) => badge.id === 'survivor')?.earned).toBe(true);
  });

  it('earns the million-day badge from the busiest day, not from today', () => {
    const badges = achievements(
      snapshot({
        byDay: [day('2026-08-14', { output: 1_500_000 }), day('2026-08-21', { output: 10 })],
      }),
      '2026-08-21',
    );

    expect(badges.find((badge) => badge.id === 'million-day')?.earned).toBe(true);
  });

  it('reads the cache share off the lifetime total', () => {
    const badges = achievements(
      snapshot({ totals: totals({ cacheRead: 900_000, output: 100_000 }) }),
      '2026-08-21',
    );
    const artisan = badges.find((badge) => badge.id === 'cache-artisan');

    expect(artisan?.earned).toBe(true);
    expect(artisan?.progress).toBe(90);
  });

  it('keeps a locked badge honest about how far off it is', () => {
    const badges = achievements(snapshot({ bestCombo: 12 }), '2026-08-21');
    const chain = badges.find((badge) => badge.id === 'forty-chain');

    expect(chain?.earned).toBe(false);
    expect(chain?.progress).toBe(12);
    expect(chain?.goal).toBe(40);
  });
});

describe('modelFamily', () => {
  it('reduces a model id to what a person calls it', () => {
    expect(modelFamily('claude-opus-5[1m]')).toBe('opus 5');
    expect(modelFamily('claude-sonnet-4-5-20250929')).toBe('sonnet 4.5');
    expect(modelFamily('claude-haiku-4-5-20251001')).toBe('haiku 4.5');
  });

  it('passes anything unrecognised through untouched', () => {
    // Claude Code writes this for turns it generated itself.
    expect(modelFamily('<synthetic>')).toBe('<synthetic>');
  });
});

describe('title', () => {
  it('names breadth from projects and craft from the dominant model', () => {
    const named = title(
      snapshot({
        totals: totals({ output: 1_000 }),
        byProject: Array.from({ length: 14 }, (_unused, index) => day(`p${index}`)),
        byModel: [day('claude-opus-5[1m]', { output: 900 }), day('claude-haiku-4-5', { output: 100 })],
      }),
    );

    expect(named.name).toBe('SYSTEMS ARCHITECT');
    expect(named.derivation).toBe('14 projects · 90% opus 5');
  });

  it('picks the dominant model by tokens, not by the order it arrives in', () => {
    // byModel arrives sorted by cost, which is not the same ordering: a small
    // number of expensive turns can outrank the model most of the work ran on.
    const named = title(
      snapshot({
        totals: totals({ output: 1_000 }),
        byProject: [day('only')],
        byModel: [day('claude-opus-5', { output: 200 }), day('claude-sonnet-4-5', { output: 800 })],
      }),
    );

    expect(named.name).toBe('SOLO ENGINEER');
    expect(named.derivation).toBe('1 project · 80% sonnet 4.5');
  });

  it('says nothing about a model when there is no usage at all', () => {
    expect(title(snapshot()).name).toBe('SOLO OPERATOR');
    expect(title(snapshot()).derivation).toBe('0 projects');
  });
});
