/**
 * Generic N-party seat strip.
 *
 * Renders:
 *   - Optional small heading line (e.g. "Today", "Projected under PR").
 *   - Numbers row, colored by party (e.g. "D 32 · R 21" or
 *     "D 28 · R 19 · PROG 3 · AF 2" in extended sandbox).
 *   - A horizontal bar with one colored segment per party, width
 *     proportional to that party's seat count.
 *
 * Used by:
 *   - `StateDetailContent` (default size)
 *   - `RankingRow` (compact size)
 *   - Sandbox-extended renderings (any size, with 3 or 4 parties)
 *
 * The width transition is the same one the rest of the sprint uses for
 * mode-switch / sandbox-slider animation; `motion-reduce:` collapses it
 * when the user has reduced-motion preferences set.
 */
export interface SeatStripParty {
  /** Stable identifier for React keys and aria labels. */
  id: string;
  /** Hex color for the bar segment and the numeric label. */
  color: string;
  /** Number of seats this party holds. */
  seats: number;
  /** Short label rendered alongside the number ("D 32"). If omitted, the id is used. */
  label?: string;
}

interface Props {
  heading?: string;
  parties: SeatStripParty[];
  size?: 'default' | 'compact';
}

export function SeatStrip({ heading, parties, size = 'default' }: Props) {
  const total = parties.reduce((s, p) => s + p.seats, 0);
  const numberClass =
    size === 'compact'
      ? 'font-semibold text-sm tabular-nums'
      : 'font-semibold text-lg tabular-nums';
  const barClass =
    size === 'compact'
      ? 'mt-1 h-1.5 rounded-full bg-stone-100 overflow-hidden flex'
      : 'mt-1 h-2 rounded-full bg-stone-100 overflow-hidden flex';
  const headingClass =
    size === 'compact'
      ? 'text-[10px] uppercase tracking-wider text-stone-400'
      : 'text-xs text-stone-500';
  const dotClass = size === 'compact' ? 'text-stone-300 text-xs' : 'text-stone-400 text-sm';
  const gap = size === 'compact' ? 'gap-1.5' : 'gap-2';

  // Numbers row: skip parties with 0 seats so the line doesn't get noisy
  // when a threshold zeroes a minor (sandbox extended).
  const visibleNumbers = parties.filter((p) => p.seats > 0);

  return (
    <div>
      {heading && <div className={headingClass}>{heading}</div>}
      <div className={`mt-1 flex items-baseline ${gap} flex-wrap`}>
        {visibleNumbers.length === 0 ? (
          <span className="text-stone-400 text-sm">—</span>
        ) : (
          visibleNumbers.map((p, i) => (
            <span key={p.id} className="inline-flex items-baseline gap-1.5">
              {i > 0 && <span className={dotClass} aria-hidden>·</span>}
              <span className={numberClass} style={{ color: p.color }}>
                {(p.label ?? p.id)} {p.seats}
              </span>
            </span>
          ))
        )}
      </div>
      <div className={barClass}>
        {parties.map((p) => {
          const pct = total > 0 ? (p.seats / total) * 100 : 0;
          return (
            <div
              key={p.id}
              className="transition-[width] duration-[250ms] ease-out motion-reduce:transition-none"
              style={{ width: `${pct}%`, backgroundColor: p.color }}
              aria-hidden
              title={`${p.label ?? p.id}: ${p.seats} ${p.seats === 1 ? 'seat' : 'seats'}`}
            />
          );
        })}
      </div>
    </div>
  );
}
