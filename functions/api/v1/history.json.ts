/**
 * GET /api/v1/history.json
 *
 * Returns the projection-over-time series in a stable, documented v1 shape:
 * for each date, the national delegation under each allocation method
 * (PR, MMD-3, MMD-5, MMP-50). See `src/lib/apiShape.ts` (toApiV1History) for
 * the schema and the Methodology page for human-readable documentation.
 *
 * Additive to the v1 API surface — the projection.json shape is untouched.
 *
 * Filename note: Cloudflare Pages Functions route by filename, so this file
 * must be `history.json.ts` to serve at `/api/v1/history.json`.
 */
import { toApiV1History } from '../../../src/lib/apiShape';
import {
  CACHE_HEADERS,
  CORS_HEADERS,
  handleOptions,
  loadHistory,
  type PagesContext,
} from './_shared';

export async function onRequestGet(context: PagesContext): Promise<Response> {
  try {
    const internal = await loadHistory(context);
    const v1 = toApiV1History(internal);
    return new Response(JSON.stringify(v1), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...CACHE_HEADERS,
        ...CORS_HEADERS,
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'history_unavailable', message: String(err) }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          ...CORS_HEADERS,
        },
      },
    );
  }
}

export const onRequestHead = onRequestGet;
export const onRequestOptions = handleOptions;
