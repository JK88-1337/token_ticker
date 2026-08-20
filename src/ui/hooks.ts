import { useEffect, useRef, useState } from 'react';

/**
 * Eases a number toward its target instead of snapping to it.
 *
 * The value shown is always a point on the way to a real figure, never an
 * invented one — the animation only decides how fast the gap closes. That is
 * what turns an arriving batch of turns into a visible roll.
 */
export function useAnimatedValue(target: number, durationMs = 700): number {
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
