import { useEffect, useRef, useState } from 'react';
import {
  ROLL_MS,
  rollPhase,
  rollProgress,
  type RollPhase,
} from './roll.js';

export type { RollPhase };

/**
 * Eases a number toward its target instead of snapping to it.
 *
 * The value shown is always a point on the way to a real figure, never an
 * invented one — the animation only decides how fast the gap closes, and it
 * closes from below, so the count on screen is never ahead of what actually
 * happened.
 *
 * The travel is longer than the gap between arrivals (measured at about six
 * seconds on a working session), so while work is coming in the digits stay
 * in the climb and never sit idle. Once arrivals stop, a five-second
 * ease-out brakes the last of the gap so the count settles rather than
 * hitting the target at climb speed.
 */
export function useAnimatedValue(target: number): { value: number; phase: RollPhase } {
  const [display, setDisplay] = useState(target);
  const [phase, setPhase] = useState<RollPhase>('idle');
  const displayRef = useRef(target);
  displayRef.current = display;

  useEffect(() => {
    const from = displayRef.current;
    const distance = target - from;
    if (distance === 0) {
      setPhase('idle');
      return;
    }

    const startedAt = performance.now();
    let frame = 0;

    const step = (at: number) => {
      const elapsed = at - startedAt;
      setDisplay(from + distance * rollProgress(elapsed));
      const next = rollPhase(elapsed);
      setPhase(next);
      if (elapsed < ROLL_MS) frame = requestAnimationFrame(step);
    };

    setPhase('climb');
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return { value: display, phase };
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
