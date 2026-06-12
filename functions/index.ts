/**
 * GET /
 *
 * Canonicalizes legacy `?view=` homepage URLs to their clean route paths
 * with a real 301, so crawlers see a server redirect instead of the SPA's
 * client-side history.replaceState upgrade (Search Console flagged those
 * as "Page with redirect"). Without a `view` param, falls through to the
 * static homepage via ASSETS.
 *
 * Mirrors parseViewMode/VIEW_PATH in `src/pages/Home.tsx` — keep in sync.
 */
import type { PagesContext } from './api/v1/_shared';

const VIEW_PATH: Record<string, string> = {
  current: '/',
  retrospective: '/retrospective',
  sandbox: '/sandbox',
};

/**
 * Redirect target (path + remaining query) for a legacy `?view=` URL, or
 * null when no redirect is needed. Unknown view values collapse to `/`,
 * mirroring parseViewMode's 'current' fallback; every other query param is
 * preserved.
 */
export function legacyViewRedirectTarget(url: URL): string | null {
  if (!url.searchParams.has('view')) return null;
  const view = url.searchParams.get('view') ?? '';
  const path = VIEW_PATH[view] ?? '/';
  const params = new URLSearchParams(url.searchParams);
  params.delete('view');
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const target = legacyViewRedirectTarget(url);
  if (target && (request.method === 'GET' || request.method === 'HEAD')) {
    return new Response(null, {
      status: 301,
      headers: {
        Location: new URL(target, url.origin).toString(),
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }
  // Forward the original request for `/` (never fetch `/index.html` — Pages
  // 308s that back to `/`); this preserves conditional-GET and HEAD handling.
  return env.ASSETS.fetch(request);
}
