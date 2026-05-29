import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Topology } from 'topojson-specification';
import { buildStateSilhouettes } from './stateSilhouettes';

// Exercise the real shipped topology so we catch a malformed/empty file or a
// projection regression that would blank out the silhouette chips.
const topology = JSON.parse(
  readFileSync('public/data/states-10m.json', 'utf-8'),
) as Topology;

describe('buildStateSilhouettes', () => {
  const silhouettes = buildStateSilhouettes(topology);

  it('produces a silhouette for at least all 50 states', () => {
    expect(silhouettes.size).toBeGreaterThanOrEqual(50);
  });

  it('keys are zero-padded two-digit fips and include New Hampshire (33)', () => {
    for (const fips of silhouettes.keys()) {
      expect(fips).toMatch(/^\d{2}$/);
    }
    expect(silhouettes.has('33')).toBe(true); // New Hampshire
    expect(silhouettes.has('06')).toBe(true); // California
  });

  it('every entry has a non-empty path and a finite, positive-size viewBox', () => {
    for (const [, sil] of silhouettes) {
      expect(sil.d.length).toBeGreaterThan(0);
      const nums = sil.viewBox.split(' ').map(Number);
      expect(nums).toHaveLength(4);
      expect(nums.every((n) => Number.isFinite(n))).toBe(true);
      expect(nums[2]).toBeGreaterThan(0); // width
      expect(nums[3]).toBeGreaterThan(0); // height
    }
  });
});
