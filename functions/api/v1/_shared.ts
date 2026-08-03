/**
 * Helpers shared by the v1 Cloudflare Pages Functions.
 *
 * Kept here (rather than imported from `src/lib/`) deliberately small so the
 * function bundle stays tiny. The CORS preflight handler and headers below
 * are duplicated lightly across endpoints to avoid any shared-state surprises.
 */
import type {
  HistoryPayload,
  HouseCompositionPayload,
  ProjectionPayload,
} from '../../../src/lib/types';

/**
 * Minimal env shape we rely on. Pages Functions inject `ASSETS` so a
 * function can fetch any static file deployed alongside it — we use this
 * to read `public/data/projection.json` from the deployed bundle without
 * embedding it at build time (so a pipeline-only deploy could update the
 * API response without redeploying the worker).
 */
export interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
}

export type PagesContext = {
  request: Request;
  env: Env;
};

/** Five-minute cache, both at the edge and in the browser. */
export const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, s-maxage=300',
};

/** Allow any origin — the API is read-only public data. */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/** Read the latest projection.json from the deployed assets. */
export async function loadProjection(context: PagesContext): Promise<ProjectionPayload> {
  const url = new URL('/data/projection.json', context.request.url);
  const res = await context.env.ASSETS.fetch(new Request(url));
  if (!res.ok) {
    throw new Error(`Failed to load projection.json: ${res.status}`);
  }
  return (await res.json()) as ProjectionPayload;
}

/**
 * Read house_composition.json (today's chamber, incl. vacancies) if present.
 *
 * Returns null rather than throwing: this block is additive and optional, so a
 * missing or malformed file must degrade to omitting `current_composition` from
 * the response, never to a 503 on the whole projection endpoint.
 */
export async function loadHouseComposition(
  context: PagesContext,
): Promise<HouseCompositionPayload | null> {
  try {
    const url = new URL('/data/house_composition.json', context.request.url);
    const res = await context.env.ASSETS.fetch(new Request(url));
    if (!res.ok) return null;
    const data = (await res.json()) as HouseCompositionPayload;
    // The SPA fallback serves index.html with HTTP 200 for a missing asset, so
    // a shape check is the only reliable "is this really the file" test.
    if (!data?.national || typeof data.national.total_seats !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

/** Read the latest history.json (projection-over-time series) from the deployed assets. */
export async function loadHistory(context: PagesContext): Promise<HistoryPayload> {
  const url = new URL('/data/history.json', context.request.url);
  const res = await context.env.ASSETS.fetch(new Request(url));
  if (!res.ok) {
    throw new Error(`Failed to load history.json: ${res.status}`);
  }
  return (await res.json()) as HistoryPayload;
}

/** Standard CORS preflight response. */
export function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
