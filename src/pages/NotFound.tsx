import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/**
 * Client-side 404. Matches any path not handled by a real route via the
 * catch-all "*" route in App.tsx.
 *
 * Caveat: because Cloudflare Pages is configured with an SPA fallback
 * (`_redirects: /* /index.html 200`), the actual HTTP status from the
 * server is still 200 for these unknown paths — the SPA always loads,
 * then this component renders client-side. We deliberately don't ship
 * a static public/404.html because CF Pages serves that *before* the
 * _redirects rule, breaking every SPA deep link (including /rankings,
 * /about, /methodology). The 200 status on misses is a known SPA
 * tradeoff; a real fix would require pre-rendering all valid routes.
 */
export function NotFound() {
  useDocumentTitle(
    'Page not found · The Proportional House',
    'The page you requested doesn\'t exist. Try the map, the rankings, or the methodology.',
  );

  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-center">
      <p className="text-xs uppercase tracking-wider text-stone-500 font-medium">404</p>
      <h1 className="mt-2 font-serif text-3xl sm:text-4xl font-medium text-brand-navy tracking-tight">
        That page doesn't exist
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
    </main>
  );
}
