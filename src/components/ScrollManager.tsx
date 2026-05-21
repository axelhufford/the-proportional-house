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
    // Defer to next frame so the new route has rendered and any
    // hash-target element exists in the DOM.
    requestAnimationFrame(() => {
      if (hash) {
        const id = hash.slice(1);
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'start' });
          return;
        }
        // Hash target not found — fall through to scroll-to-top.
      }
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
  }, [pathname, hash]);

  return null;
}
