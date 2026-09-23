import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry, Position } from 'geojson';
import type { Topology } from 'topojson-specification';

/**
 * Seat-dot map geometry — one dot per House seat, drawn inside its own state.
 * A pure, deterministic helper for DelegationDotMap.tsx (no React).
 *
 * Every dot sits on one hex grid shared by the whole map, so the result reads
 * as a single dot matrix rather than 50 unrelated clusters. Each state's dots
 * fill the grid points nearest its "pole" (the grid point deepest inside the
 * state), which keeps each cluster compact and clear of the borders.
 *
 * States too small to hold their seats at this size (in practice the six
 * smallest in the Northeast) get a callout: a small dot grid out in the
 * Atlantic, labeled with the state code and tied back by a leader line. Which
 * states need one is computed from capacity, not hardcoded; the test pins the
 * resulting set so a pitch retune can't silently move a state.
 *
 * Coordinate space: the main map's 975×610 geoAlbersUsa frame (see Map.tsx
 * and stateSilhouettes.ts), widened on the right to fit the callouts.
 */

const FRAME_WIDTH = 975;
const FRAME_HEIGHT = 610;

/** Center-to-center distance between neighboring dots, in frame units. */
export const DOT_PITCH = 9;
/** Dot radius — leaves a visible gap between neighbors. */
export const DOT_RADIUS = DOT_PITCH * 0.4;
/** Minimum distance from a dot's center to its state's border. */
const CLEARANCE = DOT_PITCH * 0.45;
const ROW_HEIGHT = (DOT_PITCH * Math.sqrt(3)) / 2;

/** Callout layout: gap from the coast, between stacked callouts, and label room. */
const CALLOUT_OFFSET_X = 14;
const CALLOUT_GAP_Y = 10;
const CALLOUT_LABEL_GAP = 5;
const CALLOUT_LABEL_WIDTH = 16;

type Pt = [number, number];

export interface Ring {
  pts: Pt[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface StateDotGeometry {
  fips: string;
  /** SVG path `d` for the state's outline, in frame space. */
  path: string;
  /** Projected bounds [[x0, y0], [x1, y1]]. */
  bounds: [Pt, Pt];
  centroid: Pt;
  /** Shared-grid points that fit inside the state with clearance, nearest-to-pole first. */
  candidates: Pt[];
  /** Outline vertices, for picking a callout's leader-line anchor. */
  vertices: Pt[];
  /** Projected outline rings, for re-gridding a state that doesn't fit. */
  rings: Ring[];
}

export interface SeatDotGeometry {
  /** Every drawable feature (incl. DC), keyed by zero-padded fips. */
  states: Map<string, StateDotGeometry>;
}

/** Who holds a state's seats. d + r + other + vacant = the state's seats. */
export interface StateDelegation {
  fips: string;
  code: string;
  name: string;
  d: number;
  r: number;
  /** Members caucusing with neither party. */
  other: number;
  vacant: number;
}

export type SeatKind = 'D' | 'other' | 'vacant' | 'R';

export interface SeatDot {
  fips: string;
  x: number;
  y: number;
  kind: SeatKind;
}

export interface SeatCallout {
  fips: string;
  code: string;
  /** Bounding box of the callout's dot grid (dot edges included). */
  x: number;
  y: number;
  width: number;
  height: number;
  labelX: number;
  labelY: number;
  /** Leader line: from just inside the state to the callout's left edge. */
  leader: [Pt, Pt];
}

export interface SeatDotPlacement {
  dots: SeatDot[];
  callouts: SeatCallout[];
  /** viewBox size — the base frame, widened to fit the callouts. */
  width: number;
  height: number;
}

/** Left-to-right seat order within a cluster: Democrats, neutral, Republicans. */
const KIND_ORDER: SeatKind[] = ['D', 'other', 'vacant', 'R'];

function toRing(coords: Position[], project: (p: Position) => Pt | null): Ring | null {
  const pts: Pt[] = [];
  for (const c of coords) {
    const p = project(c);
    if (p) pts.push(p);
  }
  if (pts.length < 3) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { pts, x0, y0, x1, y1 };
}

/** Even-odd ray cast over every ring (outer rings and holes alike). */
function isInside(x: number, y: number, rings: Ring[]): boolean {
  let inside = false;
  for (const r of rings) {
    if (y < r.y0 || y > r.y1 || x > r.x1) continue;
    const pts = r.pts;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function segmentDistance(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + t * dx - px, a[1] + t * dy - py);
}

/**
 * Distance from a point to the nearest border. Bails out as soon as it drops
 * below `floor`, since the caller only needs the exact value above it.
 */
function borderDistance(x: number, y: number, rings: Ring[], floor: number): number {
  let min = Infinity;
  for (const r of rings) {
    // Skip rings whose bounding box is already farther than the best so far.
    const bx = Math.max(r.x0 - x, 0, x - r.x1);
    const by = Math.max(r.y0 - y, 0, y - r.y1);
    if (Math.hypot(bx, by) >= min) continue;
    const pts = r.pts;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const d = segmentDistance(x, y, pts[j], pts[i]);
      if (d < min) {
        min = d;
        if (min < floor) return min;
      }
    }
  }
  return min;
}

/**
 * Grid points inside `rings` with at least CLEARANCE to the border, ordered
 * nearest-first to the deepest one (the cluster's anchor). `ox`/`oy` shift the
 * grid by a fraction of a pitch/row; 0, 0 is the grid the whole map shares.
 */
function gridCandidates(rings: Ring[], [[x0, y0], [x1, y1]]: [Pt, Pt], ox: number, oy: number): Pt[] {
  const scored: { x: number; y: number; depth: number }[] = [];
  for (let row = Math.floor(y0 / ROW_HEIGHT) - 1; row * ROW_HEIGHT <= y1; row++) {
    const y = (row + 0.5 + oy) * ROW_HEIGHT;
    const shift = (row % 2 === 0 ? 0.5 : 1) + ox;
    for (let col = Math.floor(x0 / DOT_PITCH) - 1; col * DOT_PITCH <= x1; col++) {
      const x = (col + shift) * DOT_PITCH;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (!isInside(x, y, rings)) continue;
      const depth = borderDistance(x, y, rings, CLEARANCE);
      if (depth >= CLEARANCE) scored.push({ x, y, depth });
    }
  }
  if (scored.length === 0) return [];

  // The deepest grid point anchors the cluster; ties go to the first found
  // (top-left), which keeps the choice deterministic.
  let pole = scored[0];
  for (const s of scored) if (s.depth > pole.depth) pole = s;
  return scored
    .map((s) => ({ s, d2: (s.x - pole.x) ** 2 + (s.y - pole.y) ** 2 }))
    .sort((a, b) => a.d2 - b.d2 || a.s.y - b.s.y || a.s.x - b.s.x)
    .map(({ s }) => [s.x, s.y]);
}

/** Sub-pitch grid shifts tried, in order, for a state the shared grid can't fit. */
const GRID_SHIFTS: Pt[] = [
  [0.5, 0],
  [0, 0.5],
  [0.5, 0.5],
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
];

/**
 * The first `n` dot positions for a state: from the shared grid when it fits,
 * else from the first shifted grid that does (an island state like Hawaii,
 * which has no neighbors to misalign with), else null — the state needs a
 * callout. Dots on a shifted grid still keep CLEARANCE from the border, so
 * they stay at least 2 × CLEARANCE from any neighboring state's dots.
 */
function fitInState(geo: StateDotGeometry, n: number): Pt[] | null {
  if (geo.candidates.length >= n) return geo.candidates.slice(0, n);
  for (const [ox, oy] of GRID_SHIFTS) {
    const shifted = gridCandidates(geo.rings, geo.bounds, ox, oy);
    if (shifted.length >= n) return shifted.slice(0, n);
  }
  return null;
}

/**
 * Project every state and find the grid points each can hold. Depends only on
 * the topology, so callers compute it once and reuse it across data changes.
 */
export function buildSeatDotGeometry(topology: Topology): SeatDotGeometry {
  const geojson = feature(topology, topology.objects.states) as unknown as FeatureCollection<Geometry>;
  const projection = geoAlbersUsa().fitSize([FRAME_WIDTH, FRAME_HEIGHT], geojson);
  const pathGen = geoPath(projection);
  const project = (p: Position): Pt | null => projection([p[0], p[1]]) as Pt | null;

  const states = new Map<string, StateDotGeometry>();
  for (const f of geojson.features) {
    const fips = String(f.id ?? '').padStart(2, '0');
    const path = pathGen(f);
    if (!path) continue;

    const g = f.geometry;
    const polygons =
      g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const rings: Ring[] = [];
    for (const poly of polygons) {
      for (const coords of poly) {
        const ring = toRing(coords, project);
        if (ring) rings.push(ring);
      }
    }

    const bounds = pathGen.bounds(f) as [Pt, Pt];
    states.set(fips, {
      fips,
      path,
      bounds,
      centroid: pathGen.centroid(f) as Pt,
      candidates: gridCandidates(rings, bounds, 0, 0),
      vertices: rings.flatMap((r) => r.pts),
      rings,
    });
  }
  return { states };
}

/** Seat kinds for a delegation, in left-to-right cluster order. */
function seatKinds(del: StateDelegation): SeatKind[] {
  const counts: Record<SeatKind, number> = { D: del.d, other: del.other, vacant: del.vacant, R: del.r };
  const out: SeatKind[] = [];
  for (const kind of KIND_ORDER) {
    for (let i = 0; i < Math.max(0, counts[kind]); i++) out.push(kind);
  }
  return out;
}

/** Color a set of positions left→right (then top→bottom) in seat order. */
function assignKinds(fips: string, points: Pt[], kinds: SeatKind[]): SeatDot[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return sorted.map(([x, y], i) => ({ fips, x, y, kind: kinds[i] }));
}

/**
 * Lay out one dot per seat. States whose seats fit inside their borders get an
 * in-state cluster; the rest get a stacked callout to the right of the coast.
 */
export function placeSeatDots(
  geometry: SeatDotGeometry,
  delegations: StateDelegation[],
): SeatDotPlacement {
  const dots: SeatDot[] = [];
  const overflow: { del: StateDelegation; geo: StateDotGeometry; kinds: SeatKind[] }[] = [];

  for (const del of delegations) {
    const geo = geometry.states.get(del.fips);
    if (!geo) continue;
    const kinds = seatKinds(del);
    if (kinds.length === 0) continue;
    const points = fitInState(geo, kinds.length);
    if (points) {
      dots.push(...assignKinds(del.fips, points, kinds));
    } else {
      overflow.push({ del, geo, kinds });
    }
  }

  // Callout column: just right of the easternmost callout state. Any in-map
  // state reaching into that column (Maine) sets the floor the stack starts
  // below, so a callout never sits on top of another state.
  const callouts: SeatCallout[] = [];
  let width = FRAME_WIDTH;
  if (overflow.length > 0) {
    const overflowFips = new Set(overflow.map((o) => o.del.fips));
    const columnX = Math.max(...overflow.map((o) => o.geo.bounds[1][0])) + CALLOUT_OFFSET_X;
    let floorY = 0;
    for (const geo of geometry.states.values()) {
      if (overflowFips.has(geo.fips)) continue;
      if (geo.bounds[1][0] > columnX && geo.bounds[0][1] < FRAME_HEIGHT / 2) {
        floorY = Math.max(floorY, geo.bounds[1][1] + CALLOUT_GAP_Y);
      }
    }

    overflow.sort((a, b) => a.geo.centroid[1] - b.geo.centroid[1] || a.del.fips.localeCompare(b.del.fips));
    let nextTop = floorY;
    for (const { del, geo, kinds } of overflow) {
      const cols = Math.ceil(Math.sqrt(kinds.length));
      const rows = Math.ceil(kinds.length / cols);
      const boxW = cols * DOT_PITCH;
      const boxH = rows * DOT_PITCH;
      // Center on the state's latitude, unless that would overlap the one above.
      const top = Math.max(geo.centroid[1] - boxH / 2, nextTop);
      nextTop = top + boxH + CALLOUT_GAP_Y;

      const points: Pt[] = [];
      for (let i = 0; i < kinds.length; i++) {
        points.push([
          columnX + ((i % cols) + 0.5) * DOT_PITCH,
          top + (Math.floor(i / cols) + 0.5) * DOT_PITCH,
        ]);
      }
      dots.push(...assignKinds(del.fips, points, kinds));

      // Anchor the leader at the state's outline vertex nearest the callout,
      // nudged a little toward the centroid so it lands inside the state.
      const target: Pt = [columnX, top + boxH / 2];
      let near = geo.centroid;
      let best = Infinity;
      for (const v of geo.vertices) {
        const d = (v[0] - target[0]) ** 2 + (v[1] - target[1]) ** 2;
        if (d < best) {
          best = d;
          near = v;
        }
      }
      const toC = Math.hypot(geo.centroid[0] - near[0], geo.centroid[1] - near[1]);
      const nudge = toC > 0 ? Math.min(3, toC) / toC : 0;
      const start: Pt = [
        near[0] + (geo.centroid[0] - near[0]) * nudge,
        near[1] + (geo.centroid[1] - near[1]) * nudge,
      ];

      callouts.push({
        fips: del.fips,
        code: del.code,
        x: columnX,
        y: top,
        width: boxW,
        height: boxH,
        labelX: columnX + boxW + CALLOUT_LABEL_GAP,
        labelY: top + boxH / 2,
        leader: [start, [columnX - DOT_PITCH * 0.3, top + boxH / 2]],
      });
      width = Math.max(width, columnX + boxW + CALLOUT_LABEL_GAP + CALLOUT_LABEL_WIDTH);
    }
  }

  return { dots, callouts, width: Math.ceil(width), height: FRAME_HEIGHT };
}
