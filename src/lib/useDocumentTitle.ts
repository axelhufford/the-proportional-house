import { useEffect } from 'react';

/**
 * Set the document title, optional <meta name="description">, and optional
 * <link rel="canonical"> for the lifetime of the calling component, restoring
 * the previous values on unmount.
 *
 * We do this manually rather than pull in `react-helmet-async` because the SPA
 * only has a handful of routes — a small hook beats a dependency.
 *
 * Each route component calls this once near the top so the browser tab,
 * <meta name="description">, and canonical URL all reflect the actual page.
 * That matters for SEO (Google indexes per-route titles + canonical URLs to
 * dedupe near-duplicate URLs) and for shareability (browser-tab labels show
 * up in screenshots and history).
 *
 * `canonicalPath` is appended to the production origin so the canonical tag
 * always advertises the public URL even when the user is browsing the
 * pages.dev alias or a local dev server. Pass the path with a leading slash
 * (e.g. "/", "/methodology"). When omitted, the canonical tag is left alone.
 */
const PRODUCTION_ORIGIN = 'https://proportionalhouse.org';

export function useDocumentTitle(
  title: string,
  description?: string,
  canonicalPath?: string,
): void {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;

    const descEl = description
      ? document.querySelector<HTMLMetaElement>('meta[name="description"]')
      : null;
    const prevDesc = descEl?.content ?? null;
    if (descEl && description) descEl.content = description;

    // Canonical: prefer an existing <link rel="canonical"> tag and rewrite
    // its href; otherwise create one in <head> and remove it on cleanup so
    // we don't leak per-route state into other pages.
    let canonicalEl: HTMLLinkElement | null = null;
    let prevCanonical: string | null = null;
    let createdCanonical = false;
    if (canonicalPath) {
      canonicalEl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!canonicalEl) {
        canonicalEl = document.createElement('link');
        canonicalEl.rel = 'canonical';
        document.head.appendChild(canonicalEl);
        createdCanonical = true;
      } else {
        prevCanonical = canonicalEl.href;
      }
      canonicalEl.href = `${PRODUCTION_ORIGIN}${canonicalPath}`;
    }

    return () => {
      document.title = prevTitle;
      if (descEl && prevDesc !== null) descEl.content = prevDesc;
      if (canonicalEl) {
        if (createdCanonical) {
          canonicalEl.parentNode?.removeChild(canonicalEl);
        } else if (prevCanonical !== null) {
          canonicalEl.href = prevCanonical;
        }
      }
    };
  }, [title, description, canonicalPath]);
}
