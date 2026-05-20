import { useMemo } from 'react';
import { quotientTable } from '../lib/allocation';
import { PollingTrendChart } from './PollingTrendChart';
import type { StateProjection, ProjectionMeta } from '../lib/types';

interface Props {
  state: StateProjection;
  meta: ProjectionMeta;
  onClose: () => void;
}

export function StateDetail({ state, meta, onClose }: Props) {
  const dGain = state.projected.d_seats - state.actual.d_seats;
  const quotients = useMemo(() => {
    if (state.seats <= 1) return [];
    return quotientTable(
      {
        seats: state.seats,
        d_votes: state.projected.d_share * 1_000_000,
        r_votes: state.projected.r_share * 1_000_000,
      },
      'sainte-lague',
    );
  }, [state]);

  return (
    <aside
      className="fixed inset-y-0 right-0 w-full sm:w-[28rem] bg-white border-l border-stone-200 shadow-xl overflow-y-auto"
      role="dialog"
      aria-label={`${state.name} detail`}
    >
      <div className="p-5 border-b border-stone-200 flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-stone-500 font-medium">{state.code}</div>
          <h2 className="text-xl font-semibold text-stone-900">{state.name}</h2>
          <div className="text-sm text-stone-600">
            {state.seats} {state.seats === 1 ? 'seat' : 'seats'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-stone-400 hover:text-stone-700 text-xl leading-none px-2"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="p-5 space-y-5">
        {(state.imputed_district_count ?? 0) > 0 && (
          <div className="text-sm border border-blue-200 bg-blue-50 text-blue-900 rounded-md px-3 py-2">
            <strong>
              {state.imputed_district_count === 1
                ? '1 district imputed from presidential vote.'
                : `${state.imputed_district_count} districts imputed from presidential vote.`}
            </strong>{' '}
            {state.imputed_district_ids?.join(', ') ?? ''}{' '}
            had no major-party opponent in 2024; we replaced the district's House two-party total with its 2024 presidential two-party split so the baseline reflects partisan lean rather than no-contest. See methodology.
          </div>
        )}

        {state.baseline_distortion_warning && (state.imputed_district_count ?? 0) === 0 && (
          <div className="text-sm border border-amber-200 bg-amber-50 text-amber-900 rounded-md px-3 py-2">
            <strong>Baseline distortion warning.</strong>{' '}
            One major party fielded no candidate statewide in 2024, so the 2024 two-party share isn't meaningful for this state. The projection here assumes a neutral 50/50 baseline before applying the national swing.
          </div>
        )}

        <Comparison
          label="Delegation"
          left={{ heading: 'Actual today', d: state.actual.d_seats, r: state.actual.r_seats }}
          right={{ heading: 'Projected under PR', d: state.projected.d_seats, r: state.projected.r_seats }}
        />

        {dGain !== 0 && (
          <div className="text-sm">
            Under PR this state{' '}
            <span className={dGain > 0 ? 'text-blue-700 font-medium' : 'text-red-700 font-medium'}>
              {dGain > 0 ? `gains ${dGain} D seat${Math.abs(dGain) === 1 ? '' : 's'}`
                         : `gains ${Math.abs(dGain)} R seat${Math.abs(dGain) === 1 ? '' : 's'}`}
            </span>{' '}
            relative to today.
          </div>
        )}

        <Section title="Vote share">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <ShareBlock heading="2024 baseline" d={state.baseline_2024.d_share} r={state.baseline_2024.r_share} />
            <ShareBlock heading="Projected 2026" d={state.projected.d_share} r={state.projected.r_share} />
          </div>
          <div className="text-xs text-stone-500 mt-2">
            Uniform swing applied: {meta.swing >= 0 ? '+' : ''}{meta.swing.toFixed(1)} points toward {meta.swing >= 0 ? 'Democrats' : 'Republicans'}.
          </div>
        </Section>

        {state.seats > 1 && quotients.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-stone-700 font-medium">Show the math (Sainte-Laguë)</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead className="text-stone-500 text-left">
                  <tr>
                    <th className="py-1 pr-3">÷</th>
                    <th className="py-1 pr-3 text-blue-700">D</th>
                    <th className="py-1 pr-3 text-red-700">R</th>
                  </tr>
                </thead>
                <tbody>
                  {quotients.map((row) => (
                    <tr key={row.divisor} className="border-t border-stone-100">
                      <td className="py-1 pr-3 text-stone-500">{row.divisor}</td>
                      <td className={`py-1 pr-3 ${row.d_wins ? 'font-semibold text-blue-700' : 'text-stone-400'}`}>
                        {row.d_quotient.toFixed(0)}
                        {row.d_wins && ' ✓'}
                      </td>
                      <td className={`py-1 pr-3 ${row.r_wins ? 'font-semibold text-red-700' : 'text-stone-400'}`}>
                        {row.r_quotient.toFixed(0)}
                        {row.r_wins && ' ✓'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-xs text-stone-500 mt-2">
                Top {state.seats} quotients win seats. ✓ marks seat-winning quotients.
              </div>
            </div>
          </details>
        )}

        <Section title="National polling trend, last 180 days">
          <PollingTrendChart currentAverageMargin={meta.generic_ballot_margin} />
          <p className="text-xs text-stone-500 mt-2">
            Each dot is one poll; size scales with sample size. The navy line is the same 14-day weighted average we use in the projection. Source: Silver Bulletin's public generic-ballot database.
          </p>
        </Section>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-stone-500 font-medium mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Comparison({
  label,
  left,
  right,
}: {
  label: string;
  left: { heading: string; d: number; r: number };
  right: { heading: string; d: number; r: number };
}) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-stone-500 font-medium mb-2">{label}</h3>
      <div className="grid grid-cols-2 gap-3">
        <SeatStrip {...left} />
        <SeatStrip {...right} />
      </div>
    </div>
  );
}

function SeatStrip({ heading, d, r }: { heading: string; d: number; r: number }) {
  const total = d + r;
  const dPct = total > 0 ? (d / total) * 100 : 0;
  return (
    <div>
      <div className="text-xs text-stone-500">{heading}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-blue-700 font-semibold text-lg tabular-nums">{d}</span>
        <span className="text-stone-400 text-sm">·</span>
        <span className="text-red-700 font-semibold text-lg tabular-nums">{r}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-stone-100 overflow-hidden flex">
        <div className="bg-blue-700" style={{ width: `${dPct}%` }} aria-hidden />
        <div className="bg-red-700 flex-1" aria-hidden />
      </div>
    </div>
  );
}

function ShareBlock({ heading, d, r }: { heading: string; d: number; r: number }) {
  return (
    <div>
      <div className="text-xs text-stone-500">{heading}</div>
      <div className="mt-1 tabular-nums">
        <span className="text-blue-700 font-medium">{(d * 100).toFixed(1)}%</span>
        <span className="text-stone-400"> · </span>
        <span className="text-red-700 font-medium">{(r * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}
