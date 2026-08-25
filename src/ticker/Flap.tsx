import { useEffect, useState } from 'react';

/**
 * A split-flap board, the kind that hangs in a railway station.
 *
 * Each character sits in its own cell and changes by folding: the leaf
 * carrying the old character falls away while the leaf carrying the new one
 * drops into its place. Separators are cells too, so the board keeps a fixed
 * pitch and the number does not shuffle sideways as it grows.
 *
 * The board only ever shows the string it is handed. It has no opinion about
 * what that number is or how it got there — the easing that decides what to
 * show lives in `useAnimatedValue`, and only ever closes on a real figure
 * from below.
 */
export function Flap({ value, className }: { value: string; className?: string }) {
  return (
    <span className={className ? `flap ${className}` : 'flap'} aria-label={value} role="img">
      {[...value].map((char, index) => (
        <Cell char={char} key={index} />
      ))}
    </span>
  );
}

/** What a cell is showing, and what it is on its way to. */
interface Turn {
  from: string;
  to: string;
  /** Bumped on every change, so the leaves remount and the fold restarts. */
  seq: number;
}

function Cell({ char }: { char: string }) {
  const [turn, setTurn] = useState<Turn>({ from: char, to: char, seq: 0 });

  useEffect(() => {
    setTurn((previous) =>
      previous.to === char ? previous : { from: previous.to, to: char, seq: previous.seq + 1 },
    );
  }, [char]);

  // A separator never folds — it would be motion carrying no information, and
  // it is the still points that keep a moving number readable.
  if (!/\d/.test(char)) {
    return (
      <span className="flap-fixed" aria-hidden>
        {char}
      </span>
    );
  }

  return (
    <span className="flap-cell" aria-hidden>
      <span className="flap-half flap-top">{turn.to}</span>
      <span className="flap-half flap-bottom">{turn.from}</span>
      {/* The falling leaf carries the old character down; the landing leaf
          brings the new one up and stays put, covering the old half. */}
      <span className="flap-leaf flap-leaf-top" key={`t${turn.seq}`}>
        <span className="flap-half flap-top">{turn.from}</span>
      </span>
      <span className="flap-leaf flap-leaf-bottom" key={`b${turn.seq}`}>
        <span className="flap-half flap-bottom">{turn.to}</span>
      </span>
    </span>
  );
}
