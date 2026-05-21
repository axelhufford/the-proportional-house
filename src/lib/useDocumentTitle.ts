import { useEffect } from 'react';

/**
 * Set the document title (and optionally the meta description) for the
 * lifetime of the calling component, restoring the previous values on unmount.
 *
 * We do this manually rather than pull in `react-helmet-async` because the SPA
 * only has a handful of routes — a 20-line hook beats a dependency.
 *
 * Each route component calls this once near the top so the browser tab and
 * <meta name="description"> reflect the page the user is actually on. That
 * matters for SEO (Google indexes per-route titles) and for shareability
 * (browser tab labels show up in screenshots and history).
 */
export function useDocumentTitle(title: string, description?: string): void {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;

    const descEl = description
      ? document.querySelector<HTMLMetaElement>('meta[name="description"]')
      : null;
    const prevDesc = descEl?.content ?? null;
    if (descEl && description) descEl.content = description;

    return () => {
      document.title = prevTitle;
      if (descEl && prevDesc !== null) descEl.content = prevDesc;
    };
  }, [title, description]);
}
