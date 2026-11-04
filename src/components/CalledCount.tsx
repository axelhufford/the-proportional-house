import type { ResultSeats } from '../lib/types';

/**
 * Seats called so far, by party, with the uncalled remainder:
 * "D 231 · R 144 · 60 not yet called". Uncalled races are their own count,
 * never folded into either party.
 */
export function CalledCount({
  seats,
  uncalledLabel = 'not yet called',
  uncalledClassName = 'text-stone-500',
}: {
  seats: ResultSeats;
  uncalledLabel?: string;
  /** e.g. a smaller size when the party counts are set large. */
  uncalledClassName?: string;
}) {
  const sep = <span className="text-stone-400"> · </span>;
  return (
    <span className="tabular-nums">
      <span className="text-blue-700">D {seats.d_seats}</span>
      {sep}
      <span className="text-red-700">R {seats.r_seats}</span>
      {seats.other_seats > 0 && (
        <>
          {sep}
          <span className="text-stone-600">{seats.other_seats} other</span>
        </>
      )}
      {seats.uncalled_seats > 0 && (
        <>
          {sep}
          <span className={uncalledClassName}>
            {seats.uncalled_seats} {uncalledLabel}
          </span>
        </>
      )}
    </span>
  );
}
