/** Near-linear climb before the digits start to brake. */
export const CLIMB_MS = 15_000;
/** Cubic ease-out after the climb — the count settles instead of slamming in. */
export const SETTLE_MS = 5_000;

export const ROLL_MS = CLIMB_MS + SETTLE_MS;

export type RollPhase = 'idle' | 'climb' | 'settle';

/**
 * How much of a gap has closed after `elapsedMs`.
 *
 * Fifteen seconds of constant speed cover most of the distance; five seconds
 * of cubic ease-out close the rest. The split is chosen so the speed at the
 * handoff matches — the digits slow down, they do not drop a gear.
 *
 * `climbShare / climbMs = 3 * (1 - climbShare) / settleMs`
 */
export function rollProgress(
  elapsedMs: number,
  climbMs = CLIMB_MS,
  settleMs = SETTLE_MS,
): number {
  const total = climbMs + settleMs;
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= total) return 1;

  const climbShare = (3 * climbMs) / (3 * climbMs + settleMs);

  if (elapsedMs <= climbMs) return (elapsedMs / climbMs) * climbShare;

  const u = (elapsedMs - climbMs) / settleMs;
  return climbShare + (1 - climbShare) * (1 - (1 - u) ** 3);
}

export function rollPhase(
  elapsedMs: number,
  climbMs = CLIMB_MS,
  settleMs = SETTLE_MS,
): RollPhase {
  if (elapsedMs < 0) return 'idle';
  if (elapsedMs >= climbMs + settleMs) return 'idle';
  return elapsedMs < climbMs ? 'climb' : 'settle';
}
