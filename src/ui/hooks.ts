import { useEffect, useRef, useState } from 'react';

/**
 * Eases a number toward its target instead of snapping to it.
 *
 * The value shown is always a point on the way to a real figure, never an
 * invented one — the animation only decides how fast the gap closes, and it
 * closes from below, so the count on screen is never ahead of what actually
 * happened.
 *
 * The default travel time is close to the median gap between arrivals
 * (measured at about six seconds, a quarter of them under three), which keeps
 * the digits usually still moving when the next figure lands.
 */
export function useAnimatedValue(target: number, durationMs = 2400): number {
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
      const eased = 1 - Math.pow(1 - progress, 3);
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
