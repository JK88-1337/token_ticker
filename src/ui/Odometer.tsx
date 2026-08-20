const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * A number whose digits roll into place.
 *
 * Each digit column holds 0–9 and slides to the one it should show, so a
 * changing figure reads as motion rather than as a redraw. Non-digits — the
 * dollar sign, separators — stay put, which keeps the number legible while
 * the digits are still moving.
 */
export function Odometer({ value, className }: { value: string; className?: string }) {
  return (
    <span className={className ? `odo ${className}` : 'odo'} aria-label={value}>
      {[...value].map((char, index) => {
        const digit = DIGITS.indexOf(char);
        const key = `${index}-${char === ' ' ? 'sp' : char}`;

        if (digit === -1) {
          return (
            <span className="odo-fixed" key={key} aria-hidden>
              {char}
            </span>
          );
        }

        return (
          <span className="odo-slot" key={index} aria-hidden>
            <span className="odo-reel" style={{ transform: `translateY(${digit * -10}%)` }}>
              {DIGITS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
