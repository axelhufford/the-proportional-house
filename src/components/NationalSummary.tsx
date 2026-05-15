import type { ProjectionPayload } from '../lib/types';

interface Props {
  payload: ProjectionPayload;
}

export function NationalSummary({ payload }: Props) {
  const { national, meta } = payload;
  const dGain = national.projected.d_seats - national.actual.d_seats;
  const generic = meta.generic_ballot_margin;
  const genericLabel = generic >= 0 ? `D+${generic.toFixed(1)}` : `R+${Math.abs(generic).toFixed(1)}`;
  const baseline = meta.baseline_2024_margin;
  const baselineLabel = baseline >= 0 ? `D+${baseline.toFixed(1)}` : `R+${Math.abs(baseline).toFixed(1)}`;

  return (
    <section className="bg-white border-b border-stone-200">
      <div className="max-w-6xl mx-auto px-6 py-5">
        <p className="text-sm text-stone-600">
          What the U.S. House would look like if every state allocated its seats by proportional representation.
        </p>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-6">
          <SummaryStat
            label="Projected under PR"
            primary={<><span className="text-blue-700">D {national.projected.d_seats}</span><span className="text-stone-400"> · </span><span className="text-red-700">R {national.projected.r_seats}</span></>}
          />
          <SummaryStat
            label="Actual House today"
            primary={<><span className="text-blue-700">D {national.actual.d_seats}</span><span className="text-stone-400"> · </span><span className="text-red-700">R {national.actual.r_seats}</span></>}
          />
          <SummaryStat
            label="Difference under PR"
            primary={
              <span className={dGain >= 0 ? 'text-blue-700' : 'text-red-700'}>
                {dGain > 0 ? '+' : ''}{dGain} D / {dGain > 0 ? '-' : '+'}{Math.abs(dGain)} R
              </span>
            }
          />
        </div>

        <div className="mt-4 text-xs text-stone-500">
          Generic ballot today:{' '}
          <span className="font-medium text-stone-700">{genericLabel}</span>
          {' · '}2024 baseline:{' '}
          <span className="font-medium text-stone-700">{baselineLabel}</span>
          {' · '}Swing applied:{' '}
          <span className={meta.swing >= 0 ? 'font-medium text-blue-700' : 'font-medium text-red-700'}>
            {meta.swing >= 0 ? '+' : ''}{meta.swing.toFixed(1)} pts toward {meta.swing >= 0 ? 'D' : 'R'}
          </span>
          {' · '}Method:{' '}
          <span className="font-medium text-stone-700">Sainte-Laguë</span>
        </div>
      </div>
    </section>
  );
}

function SummaryStat({ label, primary }: { label: string; primary: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-stone-500 font-medium">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{primary}</div>
    </div>
  );
}
