/**
 * Everything the two character-sheet skins draw, computed once.
 *
 * `gauge` and `blocks` are the same information architecture in two art
 * directions, so all the arithmetic and all the live state lives here and the
 * components stay purely presentational. Swapping the skin swaps a
 * stylesheet and a layout, never a number.
 */

import { useEffect, useRef, useState } from 'react';
import { totalTokens, workTokens } from '../core/limits.js';
import {
  COMBO_GAP_MS,
  COMBO_TIERS,
  comboLength,
  comboTier,
  dailyStreak,
  levelFor,
  tokenRatePerSecond,
  type ComboTier,
  type Level,
} from '../core/momentum.js';
import type { UsageSnapshot } from '../core/snapshot.js';
// The punchy roll was written for the arcade but is not specific to it: a
// fourth-power ease-out that closes a gap in under two seconds and never
// overshoots. Both skins want exactly that, so it is imported rather than
// copied.
import { usePunchValue } from '../arcade/punch.js';
import { subscribeToUsage } from '../ui/feed.js';
import { todayKey } from '../ui/format.js';
import { useNow, usePrevious } from '../ui/hooks.js';
import { achievements, skills, title, type Achievement, type Skill, type Title } from './character.js';

/** The window the burn rate is measured over. */
const RATE_WINDOW_MS = 60_000;

/** How long a `+N` sits on screen before it is dropped. */
const FLOATER_MS = 1_400;

/** A gain, on its way up the screen. */
export interface Floater {
  id: number;
  tokens: number;
  /** Sideways drift in pixels, so simultaneous gains do not stack. */
  drift: number;
  /** A gain this big is worth shouting about. */
  huge: boolean;
}

export interface Character {
  snapshot: UsageSnapshot;

  /** Today's tokens, and the value to print while it climbs. */
  today: number;
  todayShown: number;
  todayUsd: number;
  todayTurns: number;

  lifetime: number;
  lifetimeShown: number;
  lifetimeUsd: number;
  level: Level;
  /** How far into the current level, 0–1. */
  towardLevel: number;

  /** Tokens per second over the trailing minute. */
  rate: number;
  combo: number;
  comboTier: ComboTier | null;
  /** How many more turns to the next rung, or null at the top. */
  toNextTier: number | null;
  streak: number;

  /** Work tokens in the allowance window, and the value to print. */
  mana: number;
  manaShown: number;
  /** The ceiling the window is measured against, null until one is evidenced. */
  ceiling: number | null;
  /** Whether that ceiling was observed at a refusal or fallen back to the peak. */
  ceilingIsObserved: boolean;
  /** Window against ceiling, 0–1. */
  manaShare: number;

  titleOf: Title;
  skillRows: Skill[];
  badges: Achievement[];
  earned: number;

  /** True while turns are still arriving. */
  live: boolean;
  floaters: Floater[];
}

/** A gain at least this large gets the loud treatment. */
const HUGE_GAIN = 1_000_000;

/**
 * Subscribes to usage and reads it as a character.
 *
 * Returns null until the first snapshot lands; the error, if any, is returned
 * alongside so a skin can say what it is waiting for.
 */
export function useSnapshot(): { snapshot: UsageSnapshot | null; error: string | null } {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let cancelled = false;

    const unsubscribe = subscribeToUsage(timeZone, {
      snapshot: (next) => {
        if (cancelled) return;
        setSnapshot(next);
        setError(null);
      },
      activity: () => undefined,
      error: (message) => {
        if (!cancelled) setError(message);
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { snapshot, error };
}

/** Reads one snapshot as a live character sheet. */
export function useCharacter(snapshot: UsageSnapshot): Character {
  const now = useNow(250);
  const key = todayKey(snapshot.timeZone);

  const today = snapshot.byDay.find((bucket) => bucket.key === key);
  const todayTokens = today ? totalTokens(today.totals.tokens) : 0;
  const todayShown = usePunchValue(todayTokens);

  const lifetime = totalTokens(snapshot.totals.tokens);
  const lifetimeShown = usePunchValue(lifetime);
  const level = levelFor(lifetime);

  const mana = workTokens(snapshot.window.totals.tokens);
  const manaShown = usePunchValue(mana);
  const peak = workTokens(snapshot.peak.totals.tokens);
  const observed = snapshot.observedCeiling;
  const ceiling = observed ?? (peak > 0 ? peak : null);

  const rate = tokenRatePerSecond(snapshot.recent, now, RATE_WINDOW_MS);
  const combo = comboLength(
    snapshot.recent.map((event) => event.at),
    now,
    COMBO_GAP_MS,
  );
  const tier = comboTier(combo);
  const nextTier = COMBO_TIERS.find((rung) => combo < rung.from);

  const lastAt = snapshot.recent.at(-1)?.at;
  const sinceLast = lastAt ? now - Date.parse(lastAt) : Number.POSITIVE_INFINITY;

  const floaters = useFloaters(todayTokens);
  const badges = achievements(snapshot, key);

  return {
    snapshot,

    today: todayTokens,
    todayShown,
    todayUsd: today?.totals.usd ?? 0,
    todayTurns: today?.totals.turns ?? 0,

    lifetime,
    lifetimeShown,
    lifetimeUsd: snapshot.totals.usd,
    level,
    towardLevel: level.span > 0 ? level.into / level.span : 0,

    rate,
    combo,
    comboTier: tier,
    toNextTier: nextTier ? nextTier.from - combo : null,
    streak: dailyStreak(
      snapshot.byDay.map((bucket) => bucket.key),
      key,
    ),

    mana,
    manaShown,
    ceiling,
    ceilingIsObserved: observed !== null,
    manaShare: ceiling && ceiling > 0 ? Math.min(mana / ceiling, 1) : 0,

    titleOf: title(snapshot),
    skillRows: skills(snapshot.totals.tokens),
    badges,
    earned: badges.filter((badge) => badge.earned).length,

    live: sinceLast < COMBO_GAP_MS,
    floaters,
  };
}

/**
 * A `+N` for every rise in the count.
 *
 * Only rises produce one: the total can move sideways when a snapshot is
 * rebuilt, and a `+0` or a negative would be a lie about what happened.
 */
function useFloaters(tokens: number): Floater[] {
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const previous = usePrevious(tokens);
  const nextId = useRef(0);

  useEffect(() => {
    if (previous === undefined) return;
    const gained = tokens - previous;
    if (gained <= 0) return;

    const floater: Floater = {
      id: nextId.current++,
      tokens: Math.round(gained),
      drift: (Math.random() * 96 - 48) | 0,
      huge: gained >= HUGE_GAIN,
    };

    setFloaters((current) => [...current.slice(-7), floater]);
    const timer = window.setTimeout(
      () => setFloaters((current) => current.filter((entry) => entry.id !== floater.id)),
      FLOATER_MS,
    );
    return () => window.clearTimeout(timer);
  }, [tokens, previous]);

  return floaters;
}

/**
 * Re-triggers a CSS animation on a node whenever `count` changes.
 *
 * A class cannot simply be re-added — the browser will not restart an
 * animation that is already applied — so the class comes off, layout is
 * flushed, and it goes back on.
 */
export function useKick(count: number) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || count === 0) return;
    node.classList.remove('kick');
    void node.offsetWidth;
    node.classList.add('kick');
  }, [count]);

  return ref;
}
