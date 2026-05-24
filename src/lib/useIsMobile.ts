import { useEffect, useState } from 'react';

/**
 * Tailwind's `md` breakpoint is 768px. We treat anything below that as
 * "mobile" for the purpose of picking the StateDetail shell (bottom-sheet
 * vs right-side panel). The query is exclusive — at exactly 768px we want
 * the desktop layout.
 */
const MOBILE_QUERY = '(max-width: 767px)';

/**
 * Reactive media-query hook. Returns true while the viewport is narrower
 * than the `md` breakpoint, and updates if the user resizes / rotates.
 *
 * SSR-safe: returns false on the server (we don't run in a server context
 * today, but this future-proofs against hydration mismatch).
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(MOBILE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(MOBILE_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    // addEventListener is the modern API; older Safari needs addListener.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    // Legacy Safari (< 14) fallback.
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, []);

  return isMobile;
}
