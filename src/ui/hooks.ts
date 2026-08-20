import { useEffect, useRef, useState } from 'react';

/**
 * Eases a number toward its target instead of snapping to it.
 *
 * The value shown is always a point on the way to a real figure, never an
 * invented one — the animation only decides how fast the gap closes, and it
 * closes from below, so the count on screen is never ahead of what actually
 * happened.
 *
 * The travel is deliberately longer than the gap between arrivals (measured
 * at about six seconds on a working session), so the digits are still moving
 * when the next figure lands and the count is never sitting idle. The cost is
 * a small standing lag while work is heavy, which resolves the moment it
 * stops — and lagging is the safe direction.
 *
 * The curve is close to linear rather than an ease-out. An ease-out spends
 * most of its time barely moving at the end, which is exactly the stall this
 * is meant to avoid.
 */
export function useAnimatedValue(target: number, durationMs = 15_000): number {
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
      const progress = Math.min((at - startedAt) / durationMs, 1);
      // Near-linear: a gentle finish, no long tail.
      const eased = 1 - Math.pow(1 - progress, 1.6);
      setDisplay(from + distance * eased);
      if (progress < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return display;
}

/** A clock that re-renders on an interval, for figures that decay with time. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}

/** The previous value of something, for spotting the moment it changed. */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}
