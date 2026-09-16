import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/**
 * Client-side 404, for a bad path reached by in-app navigation. Matches any
 * path not handled by a real route via the catch-all "*" route in App.tsx.
 *
 * A direct hit on an unknown URL no longer reaches this component at all: it
 * gets public/404.html with a real HTTP 404. The old arrangement — an SPA
 * fallback serving index.html at HTTP 200 for every unknown path — was a soft
 * 404 across the whole URL space. The note that used to live here said a
 * static 404.html would break deep links because Pages serves it before the
 * _redirects rule; what actually happens is that a matching static asset wins
 * over both, and every valid route is now prerendered to one (see
 * prerenderRouteMeta in vite.config.ts and public/_redirects).
 *
 * So this still earns its place — click a dead in-app link and React Router
 * renders it without a network round trip — but it is no longer what a
 * crawler or a cold visitor sees.
 */
export function NotFound() {
  useDocumentTitle(
    'Page not found · The Proportional House',
    'The page you requested doesn’t exist. Try the map, the rankings, or the methodology.',
  );

  return (
    // Layout already renders <main> around the route outlet; a nested <main>
    // would be invalid HTML and break landmark navigation.
    <div className="max-w-3xl mx-auto px-6 py-16 text-center">
      <p className="text-xs uppercase tracking-wider text-stone-500 font-medium">404</p>
      <h1 className="mt-2 font-serif text-3xl sm:text-4xl font-medium text-brand-navy tracking-tight">
        That page doesn’t exist
      </h1>
      <p className="mt-4 text-stone-700 leading-relaxed">
        The link you followed may be broken, or the page may have been removed.
        Try one of these instead:
      </p>
      <nav className="mt-6 flex flex-wrap justify-center gap-3 text-sm" aria-label="404 recovery links">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-full bg-brand-navy text-white px-4 py-2 hover:bg-brand-navy-mid transition-colors"
        >
          Back to the map
        </Link>
        <Link
          to="/rankings"
          className="inline-flex items-center gap-1.5 rounded-full bg-white border border-stone-200 text-stone-700 px-4 py-2 hover:border-brand-navy/40 hover:text-brand-navy transition-colors"
        >
          Rankings
        </Link>
        <Link
          to="/methodology"
          className="inline-flex items-center gap-1.5 rounded-full bg-white border border-stone-200 text-stone-700 px-4 py-2 hover:border-brand-navy/40 hover:text-brand-navy transition-colors"
        >
          Methodology
        </Link>
      </nav>
    </div>
  );
}
