/**
 * GET /api/v1/projection.csv
 *
 * CSV form of the v1 payload. Column order is documented in
 * `src/lib/apiShape.ts` (`toApiV1Csv`). One row per state, alphabetical
 * by postal code.
 */
import { toApiV1Csv } from '../../../src/lib/apiShape';
import {
  CACHE_HEADERS,
  CORS_HEADERS,
  handleOptions,
  loadProjection,
  type PagesContext,
} from './_shared';

export async function onRequestGet(context: PagesContext): Promise<Response> {
  try {
    const internal = await loadProjection(context);
    const csv = toApiV1Csv(internal);
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        ...CACHE_HEADERS,
        ...CORS_HEADERS,
      },
    });
  } catch (err) {
    return new Response(`# error: ${String(err)}\n`, {
      status: 503,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        ...CORS_HEADERS,
      },
    });
  }
}

export const onRequestHead = onRequestGet;
export const onRequestOptions = handleOptions;
