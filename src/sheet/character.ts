/**
 * A snapshot read as a character sheet.
 *
 * The skins under `src/sheet/` play the same numbers as a role-playing
 * progression: a title, skill ranks, and achievements. Nothing here invents a
 * figure — every value is a share or a threshold over what the snapshot
 * already carries, and every derivation is a pure function so it can be
 * tested against fixtures like the rest of the codebase.
 */

import { totalTokens } from '../core/limits.js';
import { dailyStreak } from '../core/momentum.js';
import type { TokenCounts } from '../core/records.js';
import type { UsageSnapshot } from '../core/snapshot.js';
import type { UsageBucket } from '../core/summary.js';

/** One row of the skill table. */
export interface Skill {
  name: string;
  tokens: number;
  /**
   * How much of {@link denominator} this class accounts for, 0–1.
   *
   * Thinking is measured against output rather than the total, because the
   * API reports it as part of output — sharing a denominator with output
   * would count the same tokens twice.
   */
  share: number;
  denominator: 'total' | 'output';
  /** 1–5, from {@link skillRank}. */
  rank: number;
  /**
   * How far through the current rank, 0–1.
   *
   * The share is the honest measure but a poor bar: cache reads run to
   * ninety-odd percent of every total, which leaves the other four classes
   * drawing nothing. Progress through the rank moves on every class, and
   * moves at a rate that means something — a full bar is a tenfold gain away
   * from the next rung.
   */
  towardRank: number;
}

/**
 * A rank for a token count, on a scale that survives real numbers.
 *
 * Counts run from thousands to hundreds of millions, so the ladder is
 * logarithmic: every rank is ten times the last. A hundred thousand earns the
 * first, a billion the fifth.
 */
export function skillRank(tokens: number): number {
  if (tokens <= 0) return 1;
  return Math.min(5, Math.max(1, Math.floor(Math.log10(tokens)) - 4));
}

/**
 * How far a count has climbed inside its own rank, 0–1.
 *
 * The fractional part of the base-ten logarithm: a hundred thousand sits at
 * the bottom of rank one, three hundred thousand halfway up it.
 */
export function towardNextRank(tokens: number): number {
  if (tokens <= 0) return 0;
  const exponent = Math.log10(tokens);
  return exponent - Math.floor(exponent);
}

/** The five token classes, ranked. Dearest measure first. */
export function skills(counts: TokenCounts): Skill[] {
  const total = totalTokens(counts);
  const write = counts.cacheWrite5m + counts.cacheWrite1h;
  const share = (value: number, of: number) => (of > 0 ? value / of : 0);

  const row = (
    name: string,
    tokens: number,
    denominator: 'total' | 'output',
  ): Skill => ({
    name,
    tokens,
    share: share(tokens, denominator === 'total' ? total : counts.output),
    denominator,
    rank: skillRank(tokens),
    towardRank: towardNextRank(tokens),
  });

  return [
    row('CACHE MASTERY', counts.cacheRead, 'total'),
    row('CONTEXT LAYING', write, 'total'),
    row('OUTPUT', counts.output, 'total'),
    row('PROMPTING', counts.input, 'total'),
    // Against output, never against the total — see Skill.share.
    row('DEEP THINKING', counts.thinking, 'output'),
  ];
}

/** Which achievement art to draw. Named, not emoji — the skins use SVG. */
export type AchievementIcon = 'shield' | 'flame' | 'bolt' | 'layers' | 'target' | 'spark';

export interface Achievement {
  id: string;
  name: string;
  icon: AchievementIcon;
  earned: boolean;
  /** Where the real figure stands, and what it has to reach. */
  progress: number;
  goal: number;
  /** The figure in words, so a locked badge still says something true. */
  note: string;
}

/** Tokens in the busiest single day on record. */
function bestDay(byDay: readonly UsageBucket[]): number {
  return byDay.reduce((best, bucket) => Math.max(best, totalTokens(bucket.totals.tokens)), 0);
}

/**
 * The six milestones, each measured against a real field.
 *
 * A locked badge shows its own progress rather than hiding it: the point of
 * the long-term skin is that everything on it is reachable and you can see
 * how far off it is.
 */
export function achievements(snapshot: UsageSnapshot, todayKey: string): Achievement[] {
  const counts = snapshot.totals.tokens;
  const total = totalTokens(counts);
  const cacheShare = total > 0 ? counts.cacheRead / total : 0;
  const streak = dailyStreak(
    snapshot.byDay.map((bucket) => bucket.key),
    todayKey,
  );
  const peakDay = bestDay(snapshot.byDay);
  const cutOffs = snapshot.limitHits.length;

  const compactish = (value: number) =>
    value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value.toLocaleString('en-US');

  return [
    {
      id: 'survivor',
      name: 'SURVIVOR',
      icon: 'shield',
      earned: cutOffs >= 1,
      progress: cutOffs,
      goal: 1,
      note: cutOffs >= 1 ? `cut off ${cutOffs}×` : 'never cut off',
    },
    {
      id: 'seven-days',
      name: 'SEVEN DAYS',
      icon: 'flame',
      earned: streak >= 7,
      progress: streak,
      goal: 7,
      note: `${streak}d streak`,
    },
    {
      id: 'million-day',
      name: 'MILLION DAY',
      icon: 'bolt',
      earned: peakDay >= 1_000_000,
      progress: peakDay,
      goal: 1_000_000,
      note: `best ${compactish(peakDay)}`,
    },
    {
      id: 'cache-artisan',
      name: 'CACHE ARTISAN',
      icon: 'layers',
      earned: cacheShare >= 0.8,
      progress: Math.round(cacheShare * 100),
      goal: 80,
      note: `reads ${Math.round(cacheShare * 100)}%`,
    },
    {
      id: 'forty-chain',
      name: 'FORTY CHAIN',
      icon: 'target',
      earned: snapshot.bestCombo >= 40,
      progress: snapshot.bestCombo,
      goal: 40,
      note: `best ×${snapshot.bestCombo}`,
    },
    {
      id: 'hundred-million-thoughts',
      name: 'DEEP WELL',
      icon: 'spark',
      earned: counts.thinking >= 100_000_000,
      progress: counts.thinking,
      goal: 100_000_000,
      note: `${compactish(counts.thinking)} thought`,
    },
  ];
}

/**
 * `claude-opus-5[1m]` → `opus 5`, which is what a person calls it.
 *
 * Model ids carry a build date and a context suffix that mean nothing on a
 * character sheet. Anything unrecognised is passed through untouched rather
 * than guessed at — `<synthetic>` should read as itself.
 */
export function modelFamily(model: string): string {
  const found = /opus|sonnet|haiku|fable/i.exec(model);
  if (!found) return model;

  const family = found[0].toLowerCase();
  // One or two short parts only: a model id ends in an eight-digit build
  // date, and `sonnet 4.5.20250929` is not what anyone calls it.
  const generation = /^-(\d{1,2}(?:-\d{1,2})?)/.exec(model.slice(found.index + found[0].length));
  const parts = generation?.[1];
  return parts ? `${family} ${parts.replace(/-/g, '.')}` : family;
}

/** How wide the work spreads, as one word. */
function breadthOf(projects: number): string {
  if (projects >= 12) return 'SYSTEMS';
  if (projects >= 5) return 'PORTFOLIO';
  if (projects >= 2) return 'MULTI';
  return 'SOLO';
}

/** What the dominant model implies about the craft, as one word. */
function craftOf(model: string | null): string {
  if (!model) return 'OPERATOR';
  if (/opus/i.test(model)) return 'ARCHITECT';
  if (/sonnet/i.test(model)) return 'ENGINEER';
  if (/haiku/i.test(model)) return 'COURIER';
  return 'OPERATOR';
}

export interface Title {
  /** Two words: breadth, then craft. */
  name: string;
  /** The counts the name came from, so the screen can show its own working. */
  derivation: string;
}

/**
 * A title from project breadth and the model most of the tokens went through.
 *
 * Deliberately a lookup on two real counts rather than a flourish — the
 * screen prints the derivation next to it so the name never looks arbitrary.
 */
export function title(snapshot: UsageSnapshot): Title {
  const projects = snapshot.byProject.length;

  let dominant: UsageBucket | null = null;
  let dominantTokens = 0;
  for (const bucket of snapshot.byModel) {
    const tokens = totalTokens(bucket.totals.tokens);
    if (tokens > dominantTokens) {
      dominant = bucket;
      dominantTokens = tokens;
    }
  }

  const total = totalTokens(snapshot.totals.tokens);
  const share = total > 0 ? Math.round((dominantTokens / total) * 100) : 0;
  const model = dominant ? modelFamily(dominant.key) : null;

  return {
    name: `${breadthOf(projects)} ${craftOf(dominant?.key ?? null)}`,
    derivation: model
      ? `${projects} project${projects === 1 ? '' : 's'} · ${share}% ${model}`
      : `${projects} project${projects === 1 ? '' : 's'}`,
  };
}
