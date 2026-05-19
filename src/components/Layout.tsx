import { Outlet } from 'react-router-dom';
import { Masthead } from './Masthead';
import type { ProjectionMeta } from '../lib/types';

interface LayoutProps {
  meta?: ProjectionMeta;
}

const STALE_AFTER_HOURS = 48;

export function Layout({ meta }: LayoutProps) {
  const isStale = meta ? isStaleData(meta.generated_at, STALE_AFTER_HOURS) : false;

  return (
    <div className="min-h-screen flex flex-col">
      {isStale && meta && (
        <div className="bg-blue-50 border-b border-blue-200 text-blue-900 text-sm">
          <div className="max-w-6xl mx-auto px-6 py-2 flex items-center justify-between gap-4">
            <span>
              <strong>Data may be stale.</strong>{' '}
              Last updated {new Date(meta.generated_at).toLocaleString()}{' '}
              (over {STALE_AFTER_HOURS} hours ago). The pipeline normally runs nightly.
            </span>
          </div>
        </div>
      )}

      <Masthead />

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="py-4 text-xs text-stone-600">
        <div className="max-w-6xl mx-auto px-6 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            {meta ? (
              <>
                <span>
                  Updated {new Date(meta.generated_at).toLocaleString()}
                  {' · '}Source: {meta.data_source}
                </span>
                {meta.n_polls_in_average !== undefined && (
                  <span>{meta.n_polls_in_average} polls in average (last {meta.poll_window_days ?? 30}d)</span>
                )}
              </>
            ) : (
              <span>The Proportional House — open source. Methodology and source data on the Methodology page.</span>
            )}
          </div>
          <div className="text-center sm:text-right text-stone-500 border-t border-stone-200/60 pt-2">
            A website by Axel Hufford ·{' '}
            <a
              href="https://axelhufford.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-brand-navy"
            >
              axelhufford.com
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function isStaleData(generatedAt: string, staleHours: number): boolean {
  const generated = Date.parse(generatedAt);
  if (Number.isNaN(generated)) return false;
  const ageHours = (Date.now() - generated) / (1000 * 60 * 60);
  return ageHours > staleHours;
}
