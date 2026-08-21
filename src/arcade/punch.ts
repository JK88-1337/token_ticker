import { useEffect, useRef, useState } from 'react';

/** Punchy roll used by the arcade skin — a hit, not a long chase. */
const PUNCH_MS = 1_800;

/**
 * Closes a gap in under two seconds with a strong ease-out, so the digits
 * jump and then land. Never overshoots: the shown value stays at or below
 * the real figure.
 */
export function punchProgress(elapsedMs: number, durationMs = PUNCH_MS): number {
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= durationMs) return 1;
  const t = elapsedMs / durationMs;
  return 1 - (1 - t) ** 4;
}

export function usePunchValue(target: number, durationMs = PUNCH_MS): number {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  displayRef.current = display;

  useEffect(() => {
    const from = displayRef.current;
    const distance = target - from;
    if (distance === 0) return;

    const startedAt = performance.now();
    let frame = 0;

    const step = (at: number) => {
      const progress = punchProgress(at - startedAt, durationMs);
      setDisplay(from + distance * progress);
      if (progress < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return display;
}
