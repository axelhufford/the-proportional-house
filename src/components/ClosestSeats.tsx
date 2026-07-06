import { fmtMargin } from '../lib/format';
import type { ClosestFlip } from '../lib/types';

interface Props {
  /** Pipeline-computed closest flips (meta.closest_flips), max 3/direction. */
  flips: ClosestFlip[];
  /** Today's generic-ballot D-margin, for the footnote. */
  currentMargin: number;
  /** Open a state's detail panel — Home's handleSelect. */
  onSelectState?: (fips: string) => void;
}

/**
 * Slim "closest seats to flip" readout between the national summary and the
 * map controls, Current view only. Shows how far the national margin would
 * have to move for the next seats to change parties — the concrete answer
 * to "why didn't the projection move this week?".
 */
export function ClosestSeats({ flips, currentMargin, onSelectState }: Props) {
  const columns: { direction: 'D' | 'R'; heading: string; color: string }[] = [
    { direction: 'D', heading: 'Toward Democrats', color: 'text-blue-700' },
    { direction: 'R', heading: 'Toward Republicans', color: 'text-red-700' },
  ];

  return (
    <section
      aria-label="Closest seats to flip"
      className="mt-4 bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-6"
    >
      <h2 className="font-serif text-xl sm:text-2xl text-brand-navy">Closest seats to flip</h2>
      <p className="text-xs text-stone-500">
        The seats nearest to changing parties as the national vote moves
      </p>
      <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {columns.map(({ direction, heading, color }) => {
              const rows = flips.filter((f) => f.direction === direction);
              return (
                <div key={direction}>
                  <div className={`text-xs font-medium ${color}`}>{heading}</div>
                  {rows.length === 0 ? (
                    <p className="mt-1 text-xs text-stone-400 italic">No seat within ±15 pts.</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {rows.map((f) => {
                        const label = (
                          <>
                            <span className="text-stone-700">{f.name}</span>
                            <span className={`ml-auto tabular-nums text-xs font-medium ${color}`}>
                              needs +{f.margin_delta.toFixed(1)} pts
                            </span>
                          </>
                        );
                        const title = `Flips at ${fmtMargin(f.flips_at_margin)} national margin`;
                        return (
                          <li key={`${f.code}-${f.direction}`}>
                            {onSelectState ? (
                              <button
                                type="button"
                                onClick={() => onSelectState(f.fips)}
                                title={title}
                                className="w-full flex items-baseline gap-2 text-left text-sm rounded px-1 -mx-1 hover:bg-stone-50 transition-colors"
                              >
                                {label}
                              </button>
                            ) : (
                              <div title={title} className="flex items-baseline gap-2 text-sm px-1 -mx-1">
                                {label}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
      <p className="mt-3 text-xs text-stone-500">
        How far the national margin (now {fmtMargin(currentMargin)}) would have to move for the
        next seat to change parties. Click a state for its full breakdown.
      </p>
    </section>
  );
}
