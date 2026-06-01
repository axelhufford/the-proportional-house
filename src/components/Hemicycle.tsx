import { useMemo } from 'react';
import { computeHemicycleSeats } from '../lib/hemicycle';

export interface HemicycleParty {
  id: string;
  color: string;
  seats: number;
  label?: string;
}

interface Props {
  parties: HemicycleParty[];
  /** Accessible description of the chamber composition (the SVG is role=img). */
  ariaLabel: string;
  className?: string;
}

/**
 * Parliament-arc seat diagram — the hero's signature visual. Renders one dot
 * per seat in a semicircle (geometry from src/lib/hemicycle.ts), filled by
 * party in order so each party occupies a contiguous wedge. A subtle dashed
 * tick marks the chamber's midpoint (≈ the majority line). Dot fills transition
 * on change so switching views animates; reduced-motion collapses it globally.
 */
export function Hemicycle({ parties, ariaLabel, className }: Props) {
  const total = parties.reduce((s, p) => s + Math.max(0, p.seats), 0);
  const layout = useMemo(() => computeHemicycleSeats(total), [total]);

  // Expand parties into a flat per-seat color list, in party order.
  const colors = useMemo(() => {
    const arr: string[] = [];
    for (const p of parties) {
      for (let i = 0; i < Math.max(0, p.seats); i++) arr.push(p.color);
    }
    return arr;
  }, [parties]);

  const { seats, seatR, width, height, cx, cy, outerRadius } = layout;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Midpoint tick (≈ the majority line). */}
      <line
        x1={cx}
        y1={cy - outerRadius - seatR * 0.4}
        x2={cx}
        y2={cy - outerRadius * 0.34}
        stroke="#9ca3af"
        strokeWidth={0.8}
        strokeDasharray="2 2"
      />
      {seats.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={seatR * 0.82}
          fill={colors[i] ?? '#d6d3d1'}
          className="transition-[fill] duration-300 ease-out motion-reduce:transition-none"
        />
      ))}
    </svg>
  );
}

export default Hemicycle;
