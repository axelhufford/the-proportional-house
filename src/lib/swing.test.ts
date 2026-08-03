import { describe, expect, it } from 'vitest';
import { recomputeWithSwing } from './swing';
import type { ProjectionPayload } from './types';

const FIXTURE: ProjectionPayload = {
  meta: {
    generated_at: '2026-07-04T00:00:00Z',
    data_source: 'test',
    method: 'sainte-lague',
    generic_ballot_margin: 5.0,
    baseline_2024_margin: -2.5,
    swing: 7.5,
    uncertainty: {
      epsilon_points: 2.2,
      basis: 'test',
      d_seats_low: 30,
      d_seats_high: 34,
      r_seats_low: 21,
      r_seats_high: 25,
    },
    majority: { tipping_margin: -0.6, majority_seats: 218 },
    closest_flips: [
      {
        fips: '06',
        code: 'CA',
        name: 'California',
        direction: 'D',
        margin_delta: 0.5,
        flips_at_margin: 5.5,
      },
    ],
  },
  national: {
    seats: 55,
    projected: { d_seats: 32, r_seats: 23 },
    actual: { d_seats: 30, r_seats: 25 },
  },
  states: [
    {
      fips: '06',
      code: 'CA',
      name: 'California',
      seats: 52,
      actual: { d_seats: 43, r_seats: 9 },
      baseline_2024: { d_share: 0.6, r_share: 0.4 },
      projected: { d_share: 0.6, r_share: 0.4, d_seats: 32, r_seats: 20 },
    },
    {
      fips: '56',
      code: 'WY',
      name: 'Wyoming',
      seats: 3,
      actual: { d_seats: 0, r_seats: 3 },
      baseline_2024: { d_share: 0.3, r_share: 0.7 },
      projected: { d_share: 0.3, r_share: 0.7, d_seats: 1, r_seats: 2 },
    },
  ],
};

describe('recomputeWithSwing', () => {
  it('strips the shipped swing-specific analytics (only valid at the shipped swing)', () => {
    const out = recomputeWithSwing(FIXTURE, 3.0);
    expect('uncertainty' in out.meta).toBe(false);
    expect('majority' in out.meta).toBe(false);
    expect('closest_flips' in out.meta).toBe(false);
    // The input payload is untouched.
    expect(FIXTURE.meta.uncertainty).toBeDefined();
    expect(FIXTURE.meta.majority).toBeDefined();
    expect(FIXTURE.meta.closest_flips).toBeDefined();
  });

  it('still updates swing and margin consistently', () => {
    const out = recomputeWithSwing(FIXTURE, 3.0);
    expect(out.meta.swing).toBe(3.0);
    expect(out.meta.generic_ballot_margin).toBeCloseTo(0.5, 6);
    const natD = out.states.reduce((s, st) => s + st.projected.d_seats, 0);
    expect(out.national.projected.d_seats).toBe(natD);
  });
});

// The two tests above only cover metadata handling. These cover the seat math
// itself, which drives every number the Sandbox shows.
describe('recomputeWithSwing seat math', () => {
  it('conserves each state’s seat total at any swing', () => {
    for (let s = -15; s <= 15; s += 0.5) {
      const out = recomputeWithSwing(FIXTURE, s);
      for (const st of out.states) {
        expect(st.projected.d_seats + st.projected.r_seats, `${st.code} at swing ${s}`).toBe(
          st.seats,
        );
        expect(Number.isInteger(st.projected.d_seats)).toBe(true);
        expect(st.projected.d_seats).toBeGreaterThanOrEqual(0);
      }
      expect(out.national.projected.d_seats + out.national.projected.r_seats).toBe(
        out.national.seats,
      );
    }
  });

  it('is monotonic: a bigger D swing never costs Democrats seats', () => {
    let prev = -Infinity;
    for (let s = -15; s <= 15; s += 0.25) {
      const d = recomputeWithSwing(FIXTURE, s).national.projected.d_seats;
      expect(d, `D seats dropped going to swing ${s}`).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });

  it('projects the untouched baseline shares at zero swing', () => {
    const out = recomputeWithSwing(FIXTURE, 0);
    for (const st of out.states) {
      const orig = FIXTURE.states.find((x) => x.fips === st.fips)!;
      expect(st.projected.d_share, `${st.code} d_share`).toBeCloseTo(
        orig.baseline_2024.d_share,
        9,
      );
      expect(st.projected.r_share, `${st.code} r_share`).toBeCloseTo(
        orig.baseline_2024.r_share,
        9,
      );
    }
  });

  it('is deterministic — the same swing always yields the same seats', () => {
    const a = recomputeWithSwing(FIXTURE, 4.25);
    const b = recomputeWithSwing(FIXTURE, 4.25);
    expect(a.states.map((s) => s.projected.d_seats)).toEqual(
      b.states.map((s) => s.projected.d_seats),
    );
  });

  it('drives every seat to one party at an extreme swing', () => {
    const allD = recomputeWithSwing(FIXTURE, 500);
    expect(allD.national.projected.r_seats).toBe(0);
    const allR = recomputeWithSwing(FIXTURE, -500);
    expect(allR.national.projected.d_seats).toBe(0);
  });

  it('leaves the input payload untouched', () => {
    const before = JSON.stringify(FIXTURE);
    recomputeWithSwing(FIXTURE, 9.0);
    expect(JSON.stringify(FIXTURE)).toBe(before);
  });
});
