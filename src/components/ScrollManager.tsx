import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Global scroll behavior for the SPA. Drop once near the router so every
 * route change is handled.
 *
 * Two jobs:
 *   1. **Scroll to top on route change.** React Router preserves scroll
 *      position by default, so navigating from a long /rankings to /about
 *      would land the user mid-page. Almost never what you want.
 *   2. **Scroll to a hash anchor when present.** E.g. /methodology links
 *      to /rankings#most-distorted-today; without this the user lands at
 *      the top of /rankings, not at the section. We honor the existing
 *      `scroll-mt-*` utility on the target element so anchor scrolling
 *      respects the fixed header offset.
 *
 * Search-param-only changes (e.g. ?state=NH toggling) deliberately do NOT
 * scroll — toggling a panel shouldn't jolt the page.
 */
export function ScrollManager() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const start =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const now = () =>
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    // The hash target may not be in the DOM yet: React Router v7 renders the new
    // route in a transition, so the route component can commit after the
    // location (and ScrollManager) update. Poll briefly until it appears, then
    // honor its scroll-mt-* offset. Time-based so it's robust to slow commits.
    const run = () => {
      if (cancelled) return;
      if (hash) {
        const el = document.getElementById(hash.slice(1));
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'start' });
          return;
        }
        if (now() - start < 1500) {
          timer = window.setTimeout(run, 50);
          return;
        }
        // Target never showed up (e.g. stale anchor) — fall through.
      }
      window.scrollTo({ top: 0, behavior: 'auto' });
    };
    run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pathname, hash]);

  return null;
}
