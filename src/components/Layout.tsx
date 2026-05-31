import { Link, Outlet } from 'react-router-dom';
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
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-brand-navy focus:text-white focus:px-3 focus:py-2 focus:rounded focus:no-underline"
      >
        Skip to main content
      </a>
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
              <span>The Proportional House: open source. Methodology and source data on the Methodology page.</span>
            )}
          </div>
          <nav className="flex flex-wrap gap-x-3 gap-y-1 justify-center sm:justify-start border-t border-stone-200/60 pt-2" aria-label="Footer">
            <Link to="/" className="hover:text-brand-navy">Map</Link>
            <span aria-hidden="true" className="text-stone-300">·</span>
            <Link to="/rankings" className="hover:text-brand-navy">Rankings</Link>
            <span aria-hidden="true" className="text-stone-300">·</span>
            <Link to="/methodology" className="hover:text-brand-navy">Methodology</Link>
            <span aria-hidden="true" className="text-stone-300">·</span>
            <Link to="/about" className="hover:text-brand-navy">About</Link>
          </nav>
          <div className="flex flex-wrap items-center justify-center sm:justify-between gap-x-3 gap-y-1 text-stone-500">
            <span>
              Open source ·{' '}
              <a
                href="https://github.com/axelhufford/the-proportional-house"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-brand-navy"
              >
                View source on GitHub
              </a>
              {' · '}
              <a
                href="https://github.com/axelhufford/the-proportional-house/blob/main/LICENSE"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-brand-navy"
              >
                MIT License
              </a>
            </span>
            <span>
              A website by Axel Hufford ·{' '}
              <a
                href="https://axelhufford.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-brand-navy"
              >
                axelhufford.com
              </a>
            </span>
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
