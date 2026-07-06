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
  it('strips the shipped uncertainty band (only valid at the shipped swing)', () => {
    const out = recomputeWithSwing(FIXTURE, 3.0);
    expect(out.meta.uncertainty).toBeUndefined();
    expect('uncertainty' in out.meta).toBe(false);
    // The input payload is untouched.
    expect(FIXTURE.meta.uncertainty).toBeDefined();
  });

  it('still updates swing and margin consistently', () => {
    const out = recomputeWithSwing(FIXTURE, 3.0);
    expect(out.meta.swing).toBe(3.0);
    expect(out.meta.generic_ballot_margin).toBeCloseTo(0.5, 6);
    const natD = out.states.reduce((s, st) => s + st.projected.d_seats, 0);
    expect(out.national.projected.d_seats).toBe(natD);
  });
});
