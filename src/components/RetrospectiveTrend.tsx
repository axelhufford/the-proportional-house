import type { RetroSeriesPoint } from '../lib/types';

const D_COLOR = '#2166ac';
const R_COLOR = '#b2182b';
const NEUTRAL = '#888780';

interface Props {
  series: RetroSeriesPoint[];
  selectedYear: number;
  onSelect: (year: number) => void;
}

/**
 * Cross-cycle trend: a small signed bar chart of PR seats − actual seats for
 * each retrospective cycle. Up/blue = the map cost Democrats seats (PR would
 * add them); down/red = it cost Republicans. Bars are clickable to select the
 * cycle; the selected one is emphasized. Hand-rolled SVG (no chart lib).
 */
export function RetrospectiveTrend({ series, selectedYear, onSelect }: Props) {
  if (series.length === 0) return null;

  const W = 560;
  const H = 210;
  const padX = 24;
  const zeroY = 104;
  const maxBar = 72;
  const maxAbs = Math.max(1, ...series.map((p) => Math.abs(p.d_gain)));
  const colW = (W - padX * 2) / series.length;
  const barW = Math.min(46, colW * 0.5);
  const h = (g: number) => (Math.abs(g) / maxAbs) * maxBar;

  return (
    <figure className="m-0">
      <figcaption className="text-xs text-stone-600 mb-1">
        Each bar: seats proportional representation would have added, vs. the actual result. Up (blue)
        = toward Democrats, down (red) = toward Republicans. Click a year to view its map.
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
        aria-label="Proportional-representation seat shift by election cycle">
        {/* zero baseline */}
        <line x1={padX} y1={zeroY} x2={W - padX} y2={zeroY} stroke="#d6d3d1" strokeWidth={1} />
        {series.map((p, i) => {
          const cx = padX + colW * (i + 0.5);
          const up = p.d_gain > 0;
          const color = p.d_gain === 0 ? NEUTRAL : up ? D_COLOR : R_COLOR;
          const barH = p.d_gain === 0 ? 0 : Math.max(4, h(p.d_gain));
          const barY = up ? zeroY - barH : zeroY;
          const selected = p.year === selectedYear;
          const label = p.d_gain > 0 ? `+${p.d_gain}` : `${p.d_gain}`;
          const labelY = up ? barY - 7 : zeroY + barH + 16;
          return (
            <g
              key={p.year}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={`${p.year}: proportional representation ${
                p.d_gain === 0 ? 'matched the actual result' :
                `would have shifted about ${Math.abs(p.d_gain)} seats toward ${up ? 'Democrats' : 'Republicans'}`
              }`}
              onClick={() => onSelect(p.year)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.year); }
              }}
              className="cursor-pointer focus:outline-none"
            >
              {/* full-column hit target */}
              <rect x={cx - colW / 2} y={8} width={colW} height={H - 16} fill="transparent" />
              {/* selected highlight */}
              {selected && (
                <rect x={cx - colW / 2 + 2} y={10} width={colW - 4} height={H - 34} rx={6}
                  fill="#1F2E4D" opacity={0.06} />
              )}
              <rect
                x={cx - barW / 2}
                y={barY}
                width={barW}
                height={barH}
                rx={2}
                fill={color}
                opacity={selected ? 1 : 0.8}
                stroke={selected ? '#1F2E4D' : 'none'}
                strokeWidth={selected ? 1.5 : 0}
              />
              <text x={cx} y={labelY} textAnchor="middle" fontSize={14}
                fontWeight={selected ? 700 : 600} fill={color}
                fontFamily="'Inter Variable', sans-serif">{label}</text>
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={13}
                fontWeight={selected ? 700 : 400}
                fill={selected ? '#1F2E4D' : '#5C5C5A'}
                fontFamily="'Inter Variable', sans-serif">{p.year}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
