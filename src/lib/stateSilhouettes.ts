import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';

/**
 * Per-state geographic silhouettes for small "shape chips" (e.g. the
 * /rankings rows). We reuse the *exact* projection the main choropleth uses
 * (geoAlbersUsa fit to a 975×610 frame — see src/components/Map.tsx) so:
 *
 *   - Alaska and Hawaii land in their familiar inset positions/scales.
 *   - The shapes match what users see on the big map (no second projection
 *     to reconcile).
 *
 * Each state's `d` is the path string in the shared 975×610 space; the
 * cropped `viewBox` zooms a tiny SVG onto just that state's bounds (with a
 * little padding), so one path renders as a standalone silhouette.
 */

const WIDTH = 975;
const HEIGHT = 610;
const PAD_FRACTION = 0.08; // breathing room around each shape, as a fraction of its larger side

export interface StateSilhouette {
  /** SVG path `d` in the shared 975×610 projection space. */
  d: string;
  /** `viewBox` cropped (with padding) to this state's projected bounds. */
  viewBox: string;
}

/**
 * Build a `fips → { d, viewBox }` map from the US states TopoJSON. The fips
 * keys are zero-padded two-digit strings (e.g. "06", "33"), matching the
 * `fips` field on `StateProjection` and the map's lookup.
 */
export function buildStateSilhouettes(topology: Topology): Map<string, StateSilhouette> {
  const geojson = feature(
    topology,
    topology.objects.states,
  ) as unknown as FeatureCollection<Geometry>;

  const pathGen = geoPath(geoAlbersUsa().fitSize([WIDTH, HEIGHT], geojson));

  const out = new Map<string, StateSilhouette>();
  for (const f of geojson.features) {
    const fips = String(f.id ?? '').padStart(2, '0');
    const d = pathGen(f);
    if (!d) continue;

    const [[x0, y0], [x1, y1]] = pathGen.bounds(f);
    const w = x1 - x0;
    const h = y1 - y0;
    if (!(w > 0) || !(h > 0)) continue;

    const pad = Math.max(w, h) * PAD_FRACTION;
    const viewBox = `${x0 - pad} ${y0 - pad} ${w + pad * 2} ${h + pad * 2}`;
    out.set(fips, { d, viewBox });
  }
  return out;
}
