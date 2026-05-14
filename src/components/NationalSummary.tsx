import type { ProjectionPayload } from '../lib/types';

interface Props {
  payload: ProjectionPayload;
}

export function NationalSummary({ payload }: Props) {
  const { national, meta } = payload;
  const dGain = national.projected.d_seats - national.actual.d_seats;
  const generic = meta.generic_ballot_margin;
  const genericLabel = generic >= 0 ? `D+${generic.toFixed(1)}` : `R+${Math.abs(generic).toFixed(1)}`;

  return (
    <header className="bg-white border-b border-stone-200">
      <div className="max-w-6xl mx-auto px-6 py-5">
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
          The Proportional House
        </h1>
        <p className="text-sm text-stone-600 mt-1">
          What the U.S. House would look like if every state allocated its seats by proportional representation.
        </p>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-6">
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
          Generic ballot used: <span className="font-medium text-stone-700">{genericLabel}</span>
          {' · '}Method: <span className="font-medium text-stone-700">Sainte-Laguë</span>
          {' · '}Data: <span className="font-medium text-stone-700">{meta.data_source}</span>
        </div>
      </div>
    </header>
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
