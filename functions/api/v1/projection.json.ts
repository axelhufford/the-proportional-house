/**
 * GET /api/v1/projection.json
 *
 * Returns the current PR projection in the stable, documented v1 shape.
 * See `src/lib/apiShape.ts` for the schema definition and the Methodology
 * page for human-readable documentation.
 *
 * Filename note: Cloudflare Pages Functions route by filename, so this
 * file must be `projection.json.ts` (not `projection.ts`) to serve at
 * `/api/v1/projection.json`. `/api/v1/projection` (no extension) is
 * redirected here via the `_redirects` file.
 */
import { toApiV1 } from '../../../src/lib/apiShape';
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
    const v1 = toApiV1(internal);
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
      JSON.stringify({ error: 'projection_unavailable', message: String(err) }),
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
