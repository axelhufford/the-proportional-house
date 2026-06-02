import type { StateRetroPoint } from '../lib/types';

/**
 * Compact per-cycle history for one state: how proportional allocation would
 * have changed its delegation in each completed cycle (2016–2024), from
 * retrospectives.json. Hand-rolled (no recharts) — a row of year columns, each
 * with the signed seat shift and a proportional bar, blue toward D / red toward
 * R. Light, like SeatStrip / RetrospectiveTrend.
 */
export function StateRetroHistory({ points }: { points: StateRetroPoint[] }) {
  if (points.length === 0) return null;
  const maxAbs = Math.max(1, ...points.map((p) => Math.abs(p.d_gain)));

  return (
    <div>
      <div className="flex items-end gap-2">
        {points.map((p) => {
          const toward = p.d_gain > 0 ? 'D' : p.d_gain < 0 ? 'R' : null;
          const color = p.d_gain > 0 ? '#2166ac' : p.d_gain < 0 ? '#b2182b' : '#a8a29e';
          const label = toward ? `+${Math.abs(p.d_gain)} ${toward}` : '—';
          const barH = Math.round((Math.abs(p.d_gain) / maxAbs) * 28);
          return (
            <div
              key={p.year}
              className="flex-1 flex flex-col items-center gap-1"
              title={`${p.year}: actual D ${p.actual_d}/R ${p.actual_r} · under PR D ${p.pr_d}/R ${p.pr_r}`}
            >
              <span
                className="text-xs font-semibold tabular-nums leading-none"
                style={{ color: toward ? color : undefined }}
              >
                {label}
              </span>
              <div className="flex h-7 w-full items-end justify-center">
                <div
                  className="w-3 rounded-t-sm"
                  style={{ height: `${Math.max(barH, p.d_gain === 0 ? 2 : 4)}px`, backgroundColor: color }}
                  aria-hidden="true"
                />
              </div>
              <span className="text-[11px] text-stone-400 tabular-nums leading-none">{p.year}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-stone-500">
        Seats proportional allocation would have added each cycle, vs. the actual result (+D toward
        Democrats, +R toward Republicans).
      </p>
    </div>
  );
}
