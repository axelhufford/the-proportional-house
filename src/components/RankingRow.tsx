import { Link } from 'react-router-dom';
import { PARTY_D, PARTY_R } from '../lib/parties';
import { SeatStrip } from './SeatStrip';
import { StateSilhouette } from './StateSilhouette';
import type { StateSilhouette as StateSilhouetteData } from '../lib/stateSilhouettes';
import type { StateProjection } from '../lib/types';

/**
 * A single row inside one of the /rankings leaderboards. Renders the state
 * name + code, the actual D/R seat strip, an arrow, the projected D/R strip,
 * and a delta pill. Whole row is a Link to /state/{code} so users (and
 * Google) can drill into the per-state detail.
 *
 * Visual structure mirrors the SeatStrip component in StateDetail.tsx
 * but compacted into one row, with both before/after strips side by side.
 */
interface Props {
  rank: number;
  state: StateProjection;
  /**
   * Optional caption rendered below the row title. Used by the "Most
   * distorted today" board to surface the vote-share-vs-seat-share gap.
   */
  caption?: string;
  /**
   * Pre-computed geographic silhouette (path + viewBox) for this state, from
   * `buildStateSilhouettes`. Optional so the row still renders before the
   * topology loads; the shape simply fades in once it's available.
   */
  silhouette?: StateSilhouetteData;
}

export function RankingRow({ rank, state, caption, silhouette }: Props) {
  const dGain = state.projected.d_seats - state.actual.d_seats;
  const pillLabel = dGain === 0
    ? 'no change'
    : dGain > 0
      ? `+${dGain} D`
      : `+${Math.abs(dGain)} R`;
  const pillClass = dGain === 0
    ? 'bg-stone-100 text-stone-600'
    : dGain > 0
      ? 'bg-blue-50 text-blue-800 border border-blue-200'
      : 'bg-red-50 text-red-800 border border-red-200';
  // Tint the silhouette by the PR shift, matching the pill: blue when the
  // state gains D under PR, red when it gains R, neutral gray for no change.
  const silhouetteFill = dGain === 0 ? '#a8a29e' : dGain > 0 ? PARTY_D.color : PARTY_R.color;

  return (
    <Link
      to={`/state/${state.code.toLowerCase()}`}
      className="block rounded-lg border border-stone-200 bg-white px-4 py-3 hover:border-brand-navy/40 hover:shadow-sm transition-[border,box-shadow]"
    >
      <div className="flex items-center gap-4">
        <div className="text-stone-400 font-medium tabular-nums w-6 text-right flex-shrink-0">
          {rank}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-stone-900">{state.name}</span>
            <span className="text-xs uppercase tracking-wider text-stone-400">{state.code}</span>
            <span className="text-xs text-stone-500">· {state.seats} {state.seats === 1 ? 'seat' : 'seats'}</span>
          </div>
          {caption && <div className="text-xs text-stone-500 mt-0.5">{caption}</div>}
          {/* Mobile: strips stack vertically with a ↓ between them so the
           * row stays readable on 320–360 px screens. sm+: original
           * side-by-side comparison with an → between them. */}
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-1.5 sm:gap-3 max-w-md">
            <SeatStrip
              heading="Today"
              size="compact"
              parties={[
                { id: 'D', label: 'D', color: PARTY_D.color, seats: state.actual.d_seats },
                { id: 'R', label: 'R', color: PARTY_R.color, seats: state.actual.r_seats },
              ]}
            />
            <span className="text-stone-300 text-lg justify-self-start sm:justify-self-center" aria-hidden="true">
              <span className="sm:hidden">↓</span>
              <span className="hidden sm:inline">→</span>
            </span>
            <SeatStrip
              heading="Under PR"
              size="compact"
              parties={[
                { id: 'D', label: 'D', color: PARTY_D.color, seats: state.projected.d_seats },
                { id: 'R', label: 'R', color: PARTY_R.color, seats: state.projected.r_seats },
              ]}
            />
          </div>
        </div>
        {/* State shape chip, tinted by the PR shift. Fixed-size box is always
         * reserved (even before the topology loads) so the row doesn't reflow
         * when the silhouette appears. */}
        <div className="flex h-10 w-12 flex-shrink-0 items-center justify-center" aria-hidden="true">
          {silhouette && <StateSilhouette silhouette={silhouette} fill={silhouetteFill} className="h-full w-full" />}
        </div>
        <div className={`text-sm font-medium tabular-nums px-2.5 py-1 rounded-full flex-shrink-0 ${pillClass}`}>
          {pillLabel}
        </div>
      </div>
    </Link>
  );
}

