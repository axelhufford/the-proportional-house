import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Topology } from 'topojson-specification';
import {
  buildSeatDotGeometry,
  DOT_RADIUS,
  placeSeatDots,
  type StateDelegation,
} from './seatDots';
import type { HouseCompositionPayload, ProjectionPayload, RetrospectivesPayload } from './types';

// Exercise the real shipped topology and data, so a projection change, a new
// apportionment, or a pitch retune that pushes a state out of its borders
// fails here rather than on the page.
const readJson = <T,>(path: string) => JSON.parse(readFileSync(path, 'utf-8')) as T;
const topology = readJson<Topology>('public/data/states-10m.json');
const composition = readJson<HouseCompositionPayload>('public/data/house_composition.json');
const retros = readJson<RetrospectivesPayload>('public/data/retrospectives.json');
const projection = readJson<ProjectionPayload>('public/data/projection.json');

const geometry = buildSeatDotGeometry(topology);

const datasets: [string, StateDelegation[]][] = [
  [
    'live composition',
    composition.states.map((s) => ({
      fips: s.fips,
      code: s.code,
      name: s.name,
      d: s.d_seats,
      r: s.r_seats,
      other: s.other_seats,
      vacant: s.vacant,
    })),
  ],
  [
    'projected under PR',
    projection.states.map((s) => ({
      fips: s.fips,
      code: s.code,
      name: s.name,
      d: s.projected.d_seats,
      r: s.projected.r_seats,
      other: 0,
      vacant: 0,
    })),
  ],
  ...retros.meta.cycles.map((year): [string, StateDelegation[]] => [
    `${year} under PR`,
    retros.cycles[String(year)].states.map((s) => ({
      fips: s.fips,
      code: s.code,
      name: s.name,
      d: s.projected_pr.d_seats,
      r: s.projected_pr.r_seats,
      other: 0,
      vacant: 0,
    })),
  ]),
  ...retros.meta.cycles.map((year): [string, StateDelegation[]] => [
    `${year} as elected`,
    retros.cycles[String(year)].states.map((s) => ({
      fips: s.fips,
      code: s.code,
      name: s.name,
      d: s.actual.d_seats,
      r: s.actual.r_seats,
      other: 0,
      vacant: 0,
    })),
  ]),
];

const seatsOf = (d: StateDelegation) => d.d + d.r + d.other + d.vacant;

describe.each(datasets)('placeSeatDots — %s', (_label, delegations) => {
  const placement = placeSeatDots(geometry, delegations);

  it('draws exactly one dot per seat in every state', () => {
    for (const del of delegations) {
      const dots = placement.dots.filter((d) => d.fips === del.fips);
      expect(dots.filter((d) => d.kind === 'D')).toHaveLength(del.d);
      expect(dots.filter((d) => d.kind === 'R')).toHaveLength(del.r);
      expect(dots.filter((d) => d.kind === 'other')).toHaveLength(del.other);
      expect(dots.filter((d) => d.kind === 'vacant')).toHaveLength(del.vacant);
    }
    expect(placement.dots).toHaveLength(delegations.reduce((s, d) => s + seatsOf(d), 0));
  });

  it('calls out only the six small Northeast states', () => {
    expect(placement.callouts.map((c) => c.code).sort()).toEqual(
      ['CT', 'DE', 'MA', 'MD', 'NJ', 'RI'],
    );
  });

  it('never overlaps two dots', () => {
    const pts = placement.dots;
    let closest = Infinity;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        closest = Math.min(closest, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
      }
    }
    // Same-grid neighbors sit a full pitch apart; a state on a shifted grid is
    // held off its neighbors by border clearance. Either way, a visible gap.
    expect(closest).toBeGreaterThan(2 * DOT_RADIUS + 0.5);
  });

  it('keeps nearly every state on the shared grid', () => {
    const calledOut = new Set(placement.callouts.map((c) => c.fips));
    const offGrid = new Set<string>();
    for (const dot of placement.dots) {
      if (calledOut.has(dot.fips)) continue;
      const candidates = geometry.states.get(dot.fips)!.candidates;
      if (!candidates.some(([x, y]) => x === dot.x && y === dot.y)) offGrid.add(dot.fips);
    }
    // Only Hawaii's islands need a shifted grid to hold their two seats.
    expect([...offGrid]).toEqual(['15']);
  });

  it('puts Democrats left of Republicans within each state', () => {
    for (const del of delegations) {
      const dots = placement.dots.filter((d) => d.fips === del.fips);
      const dMaxX = Math.max(...dots.filter((d) => d.kind === 'D').map((d) => d.x));
      const rMinX = Math.min(...dots.filter((d) => d.kind === 'R').map((d) => d.x));
      expect(dMaxX).toBeLessThanOrEqual(rMinX);
    }
  });

  it('keeps callouts inside the viewBox and clear of each other', () => {
    const boxes = [...placement.callouts].sort((a, b) => a.y - b.y);
    for (let i = 0; i < boxes.length; i++) {
      const c = boxes[i];
      expect(c.x).toBeGreaterThan(0);
      expect(c.y).toBeGreaterThan(0);
      expect(c.labelX).toBeLessThan(placement.width);
      expect(c.y + c.height).toBeLessThan(placement.height);
      if (i > 0) expect(c.y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height);
    }
  });
});

describe('buildSeatDotGeometry', () => {
  it('only offers grid points inside the state (spot-checked against its path bounds)', () => {
    for (const geo of geometry.states.values()) {
      const [[x0, y0], [x1, y1]] = geo.bounds;
      for (const [x, y] of geo.candidates) {
        expect(x).toBeGreaterThanOrEqual(x0);
        expect(x).toBeLessThanOrEqual(x1);
        expect(y).toBeGreaterThanOrEqual(y0);
        expect(y).toBeLessThanOrEqual(y1);
      }
    }
  });

  it('is deterministic', () => {
    const again = placeSeatDots(buildSeatDotGeometry(topology), datasets[0][1]);
    expect(again).toEqual(placeSeatDots(geometry, datasets[0][1]));
  });
});
