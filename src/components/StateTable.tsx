import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PARTY_D, PARTY_R } from '../lib/parties';
import type { StateProjection } from '../lib/types';

/**
 * Sortable, filterable table of every state's delegation — the full dataset
 * behind the curated /rankings leaderboards. Pure client-side: derives shift
 * and the vote-vs-seat distortion gap from projection.json fields, sorts on any
 * column, and filters by name/code. Each row links to the per-state page.
 */

type SortKey = 'name' | 'seats' | 'shift' | 'gap';
type SortDir = 'asc' | 'desc';

interface Row {
  s: StateProjection;
  shift: number; // projected D − actual D (signed; + = toward D)
  gap: number; // actual D seat-share − 2024 D vote-share (signed; + = seats favor D)
}

function shiftText(shift: number): { text: string; color: string } {
  if (shift === 0) return { text: '—', color: 'text-stone-400' };
  return shift > 0
    ? { text: `+${shift} D`, color: 'text-blue-700' }
    : { text: `+${Math.abs(shift)} R`, color: 'text-red-700' };
}

export function StateTable({ states }: { states: StateProjection[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const [query, setQuery] = useState('');

  const rows = useMemo<Row[]>(
    () =>
      states.map((s) => ({
        s,
        shift: s.projected.d_seats - s.actual.d_seats,
        // Guard the division: a `seats: 0` state would make `gap` NaN, which
        // renders as "NaN pt → R" and — worse — makes the sort comparator
        // return NaN, leaving the whole 50-row table in an arbitrary order.
        gap: s.seats > 0 ? s.actual.d_seats / s.seats - s.baseline_2024.d_share : 0,
      })),
    [states],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? rows.filter((r) => r.s.name.toLowerCase().includes(q) || r.s.code.toLowerCase().includes(q))
      : rows;
    const sorted = [...base].sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case 'name':
          cmp = a.s.name.localeCompare(b.s.name);
          break;
        case 'seats':
          cmp = a.s.seats - b.s.seats;
          break;
        case 'shift':
          cmp = a.shift - b.shift;
          break;
        case 'gap':
          cmp = Math.abs(a.gap) - Math.abs(b.gap);
          break;
      }
      // Stable tiebreak by name so equal values don't jump around.
      if (cmp === 0) cmp = a.s.name.localeCompare(b.s.name);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [rows, query, sort]);

  const toggle = (key: SortKey) =>
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
        : // Sensible default direction per column: text A→Z, numbers high→low.
          { key, dir: key === 'name' ? 'asc' : 'desc' },
    );

  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sort.key !== key ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending';

  const SortHeader = ({
    label,
    col,
    className = '',
  }: {
    label: string;
    col: SortKey;
    className?: string;
  }) => (
    <th scope="col" aria-sort={ariaSort(col)} className={`px-3 py-2 ${className}`}>
      <button
        type="button"
        onClick={() => toggle(col)}
        className="inline-flex items-center gap-1 font-medium text-stone-600 hover:text-brand-navy transition-colors"
      >
        {label}
        <span aria-hidden="true" className="text-stone-400 text-[10px]">
          {sort.key === col ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );

  return (
    <div>
      <label className="block">
        <span className="sr-only">Filter states by name</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter states…"
          className="w-full sm:w-64 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-brand-navy focus:outline-none"
        />
      </label>

      <div className="mt-3 overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-sm tabular-nums">
          <thead className="text-left text-xs uppercase tracking-wider border-b border-stone-200">
            <tr>
              <SortHeader label="State" col="name" />
              <SortHeader label="Seats" col="seats" className="text-right" />
              <th scope="col" className="px-3 py-2 font-medium text-stone-600">Now</th>
              <th scope="col" className="px-3 py-2 font-medium text-stone-600">Under PR</th>
              <SortHeader label="Shift" col="shift" />
              <SortHeader label="Distortion gap" col="gap" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-stone-500 italic">
                  No states match “{query}”.
                </td>
              </tr>
            ) : (
              filtered.map(({ s, shift, gap }) => {
                const sh = shiftText(shift);
                const gapPts = Math.round(Math.abs(gap) * 100);
                const gapParty = gap > 0 ? 'D' : 'R';
                return (
                  <tr key={s.fips} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <Link
                        to={`/state/${s.code.toLowerCase()}`}
                        className="font-medium text-stone-900 hover:text-brand-navy hover:underline"
                      >
                        {s.name}
                      </Link>
                      <span className="ml-1.5 text-xs uppercase tracking-wider text-stone-400">{s.code}</span>
                    </th>
                    <td className="px-3 py-2 text-right text-stone-700">{s.seats}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span style={{ color: PARTY_D.color }}>D {s.actual.d_seats}</span>
                      <span className="text-stone-300"> · </span>
                      <span style={{ color: PARTY_R.color }}>R {s.actual.r_seats}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span style={{ color: PARTY_D.color }}>D {s.projected.d_seats}</span>
                      <span className="text-stone-300"> · </span>
                      <span style={{ color: PARTY_R.color }}>R {s.projected.r_seats}</span>
                    </td>
                    <td className={`px-3 py-2 font-medium ${sh.color}`}>{sh.text}</td>
                    <td className="px-3 py-2 text-stone-700">
                      {gapPts === 0 ? '—' : `${gapPts} pt → ${gapParty}`}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-stone-500">
        Shift = seats Democrats gain (+D) or lose (+R) under proportional allocation. Distortion gap =
        how far the current delegation’s seat share diverges from the 2024 statewide vote share.
      </p>
    </div>
  );
}
