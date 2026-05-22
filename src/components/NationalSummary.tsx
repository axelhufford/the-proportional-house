import { useCallback } from 'react';
import type { ProjectionPayload, ViewMode } from '../lib/types';
import { downloadNationalCard, buildNationalTweetIntent } from '../lib/shareNational';

interface Props {
  payload: ProjectionPayload;
  viewMode?: ViewMode;
}

export function NationalSummary({ payload, viewMode = 'current' }: Props) {
  const { national, meta } = payload;

  const handleDownload = useCallback(() => {
    downloadNationalCard({ national, meta, viewMode });
  }, [national, meta, viewMode]);

  const handleShareTwitter = useCallback(() => {
    const url = buildNationalTweetIntent({ national, meta, viewMode });
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [national, meta, viewMode]);
  const dGain = national.projected.d_seats - national.actual.d_seats;
  const generic = meta.generic_ballot_margin;
  const genericLabel = generic >= 0 ? `D+${generic.toFixed(1)}` : `R+${Math.abs(generic).toFixed(1)}`;
  const baseline = meta.baseline_2024_margin;
  const baselineLabel = baseline >= 0 ? `D+${baseline.toFixed(1)}` : `R+${Math.abs(baseline).toFixed(1)}`;
  const projectedLabel = viewMode === 'retrospective'
    ? 'Projected under PR (2024)'
    : viewMode === 'sandbox'
      ? 'Projected under PR (sandbox)'
      : 'Projected under PR';

  return (
    <section aria-label="National summary">
      <div className="max-w-6xl mx-auto px-6 pt-5 pb-2">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <SummaryStat
            label={projectedLabel}
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
          {viewMode === 'retrospective' ? (
            <>
              <span className="font-medium text-stone-700">No swing applied</span>
              {' '}— pure PR allocation of 2024's actual votes
              {' · '}2024 baseline:{' '}
              <span className="font-medium text-stone-700">{baselineLabel}</span>
              {' · '}Method:{' '}
              <span className="font-medium text-stone-700">Sainte-Laguë</span>
            </>
          ) : viewMode === 'sandbox' ? (
            <>
              Hypothetical generic ballot:{' '}
              <span className="font-medium text-stone-700">{genericLabel}</span>
              {' · '}2024 baseline:{' '}
              <span className="font-medium text-stone-700">{baselineLabel}</span>
              {' · '}Swing applied:{' '}
              <span className={meta.swing >= 0 ? 'font-medium text-blue-700' : 'font-medium text-red-700'}>
                {meta.swing >= 0 ? '+' : ''}{meta.swing.toFixed(1)} pts toward {meta.swing >= 0 ? 'D' : 'R'}
              </span>
              {' · '}Method:{' '}
              <span className="font-medium text-stone-700">Sainte-Laguë</span>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>

        <div className="mt-3 flex justify-end gap-1">
          <button
            type="button"
            onClick={handleShareTwitter}
            className="text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-full h-9 w-9 flex items-center justify-center"
            aria-label="Share on X (Twitter)"
            title="Share on X (Twitter)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-full h-9 w-9 flex items-center justify-center"
            aria-label="Save as image"
            title="Save as image"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
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
