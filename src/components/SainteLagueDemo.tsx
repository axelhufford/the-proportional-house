import { useMemo, useState } from 'react';
import { allocate, quotientTable } from '../lib/allocation';

const PRESETS = [
  { label: 'Texas 2024 (38 seats, R-leaning)', d: 4310913, r: 6234918, seats: 38 },
  { label: 'New York 2024 (26 seats, D-leaning)', d: 4330117, r: 3039739, seats: 26 },
  { label: 'Toy 60/40 (5 seats)', d: 600, r: 400, seats: 5 },
  { label: 'Tied (10 seats)', d: 500, r: 500, seats: 10 },
];

export function SainteLagueDemo() {
  const [seats, setSeats] = useState(5);
  const [d, setD] = useState(600);
  const [r, setR] = useState(400);

  const allocation = useMemo(
    () => allocate({ seats, d_votes: d, r_votes: r }, 'sainte-lague'),
    [seats, d, r],
  );
  const rows = useMemo(
    () => (seats > 0 ? quotientTable({ seats, d_votes: d, r_votes: r }, 'sainte-lague') : []),
    [seats, d, r],
  );

  const total = d + r;
  const dShare = total > 0 ? (d / total) * 100 : 0;
  const rShare = total > 0 ? (r / total) * 100 : 0;

  return (
    <div className="border border-stone-200 rounded-lg bg-white p-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <DemoInput label="D votes" value={d} onChange={setD} min={0} />
        <DemoInput label="R votes" value={r} onChange={setR} min={0} />
        <DemoInput label="Seats" value={seats} onChange={setSeats} min={0} max={60} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-stone-500 uppercase tracking-wider">Presets:</span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => { setD(p.d); setR(p.r); setSeats(p.seats); }}
            className="px-2 py-1 rounded border border-stone-300 hover:bg-stone-100 text-stone-700"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
        <Stat label="Two-party share" value={`${dShare.toFixed(1)}% / ${rShare.toFixed(1)}%`} />
        <Stat
          label="Allocation"
          value={
            <span>
              <span className="text-blue-700 font-semibold">D {allocation.d_seats}</span>
              <span className="text-stone-400"> · </span>
              <span className="text-red-700 font-semibold">R {allocation.r_seats}</span>
            </span>
          }
        />
        <Stat
          label="Margin vs proportional"
          value={
            <span className="tabular-nums">
              {marginNote(dShare, rShare, allocation.d_seats, allocation.r_seats, seats)}
            </span>
          }
        />
      </div>

      {rows.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-stone-500 text-left">
              <tr>
                <th className="py-1 pr-3">÷</th>
                <th className="py-1 pr-3 text-blue-700">D quotient</th>
                <th className="py-1 pr-3 text-red-700">R quotient</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.divisor} className="border-t border-stone-100">
                  <td className="py-1 pr-3 text-stone-500">{row.divisor}</td>
                  <td className={`py-1 pr-3 ${row.d_wins ? 'font-semibold text-blue-700' : 'text-stone-400'}`}>
                    {row.d_quotient.toFixed(2)}
                    {row.d_wins && ' ✓'}
                  </td>
                  <td className={`py-1 pr-3 ${row.r_wins ? 'font-semibold text-red-700' : 'text-stone-400'}`}>
                    {row.r_quotient.toFixed(2)}
                    {row.r_wins && ' ✓'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-stone-500">
            Each party’s votes are divided by 1, 3, 5, …, (2N−1). The top {seats} quotients across both parties win seats (marked ✓). Ties go to the party with the larger vote total; perfect ties go to D alphabetically.
          </p>
        </div>
      )}
    </div>
  );
}

function DemoInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-stone-500 font-medium">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        min={min}
        max={max}
        className="mt-1 block w-full rounded border border-stone-300 px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-stone-400"
      />
    </label>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-stone-500 font-medium">{label}</div>
      <div className="mt-1 text-base">{value}</div>
    </div>
  );
}

function marginNote(dPct: number, _rPct: number, dSeats: number, _rSeats: number, seats: number) {
  if (seats === 0) return '—';
  const expectedD = (dPct / 100) * seats;
  const drift = dSeats - expectedD;
  if (Math.abs(drift) < 0.01) return 'exactly proportional';
  return `${drift > 0 ? '+' : ''}${drift.toFixed(2)} D seats vs. strict proportionality`;
}
