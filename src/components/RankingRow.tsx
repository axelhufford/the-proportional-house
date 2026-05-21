import { Link } from 'react-router-dom';
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
}

export function RankingRow({ rank, state, caption }: Props) {
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
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3 max-w-md">
            <MiniSeatStrip heading="Today" d={state.actual.d_seats} r={state.actual.r_seats} />
            <span className="text-stone-300 text-lg" aria-hidden="true">→</span>
            <MiniSeatStrip heading="Under PR" d={state.projected.d_seats} r={state.projected.r_seats} />
          </div>
        </div>
        <div className={`text-sm font-medium tabular-nums px-2.5 py-1 rounded-full flex-shrink-0 ${pillClass}`}>
          {pillLabel}
        </div>
      </div>
    </Link>
  );
}

function MiniSeatStrip({ heading, d, r }: { heading: string; d: number; r: number }) {
  const total = d + r;
  const dPct = total > 0 ? (d / total) * 100 : 0;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-stone-400">{heading}</div>
      <div className="flex items-baseline gap-1.5 tabular-nums text-sm">
        <span className="text-blue-700 font-semibold">{d}</span>
        <span className="text-stone-300">·</span>
        <span className="text-red-700 font-semibold">{r}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-stone-100 overflow-hidden flex">
        <div className="bg-blue-700" style={{ width: `${dPct}%` }} aria-hidden />
        <div className="bg-red-700 flex-1" aria-hidden />
      </div>
    </div>
  );
}
