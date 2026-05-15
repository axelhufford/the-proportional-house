import { Link, NavLink, Outlet } from 'react-router-dom';
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
        <div className="bg-amber-100 border-b border-amber-200 text-amber-900 text-sm">
          <div className="max-w-6xl mx-auto px-6 py-2 flex items-center justify-between gap-4">
            <span>
              <strong>Data may be stale.</strong>{' '}
              Last updated {new Date(meta.generated_at).toLocaleString()}{' '}
              (over {STALE_AFTER_HOURS} hours ago). The pipeline normally runs nightly.
            </span>
          </div>
        </div>
      )}

      <header className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <Link to="/" className="text-base font-semibold text-stone-900 hover:text-stone-700">
            The Proportional House
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <TopNavLink to="/">Map</TopNavLink>
            <TopNavLink to="/methodology">Methodology</TopNavLink>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-stone-200 py-3 text-xs text-stone-500">
        <div className="max-w-6xl mx-auto px-6 flex flex-wrap items-baseline justify-between gap-2">
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
      </footer>
    </div>
  );
}

function TopNavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        [
          'px-3 py-1 rounded',
          isActive ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100',
        ].join(' ')
      }
    >
      {children}
    </NavLink>
  );
}

function isStaleData(generatedAt: string, staleHours: number): boolean {
  const generated = Date.parse(generatedAt);
  if (Number.isNaN(generated)) return false;
  const ageHours = (Date.now() - generated) / (1000 * 60 * 60);
  return ageHours > staleHours;
}
