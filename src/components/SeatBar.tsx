import { formatSeatPct } from '../lib/format';

export interface SeatBarParty {
  id: string;
  color: string;
  seats: number;
  label?: string;
}

/**
 * Thin proportional seat bar (one colored segment per party, width ∝ seats).
 * The bar half of SeatStrip, extracted so the national scoreboard cards can
 * show the D–R split visually under their numbers. Decorative (aria-hidden);
 * the numbers above carry the accessible content. Width transition is
 * reduced-motion-safe.
 */
export function SeatBar({
  parties,
  className = 'h-2',
}: {
  parties: SeatBarParty[];
  className?: string;
}) {
  const total = parties.reduce((s, p) => s + p.seats, 0);
  return (
    <div
      className={`${className} rounded-full bg-stone-100 overflow-hidden flex`}
      aria-hidden="true"
    >
      {parties.map((p) => {
        const pct = total > 0 ? (p.seats / total) * 100 : 0;
        return (
          <div
            key={p.id}
            className="transition-[width] duration-[250ms] ease-out motion-reduce:transition-none"
            style={{ width: `${pct}%`, backgroundColor: p.color }}
            title={`${p.label ?? p.id}: ${p.seats}${total > 0 ? ` (${formatSeatPct(p.seats, total)})` : ''}`}
          />
        );
      })}
    </div>
  );
}
