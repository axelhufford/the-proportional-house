import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyVariant,
  ballotVariants,
  DEFAULT_VARIANT_ID,
  hasVariantChoice,
  resolveVariant,
} from './ballotVariant';
import type { BallotVariant, ProjectionPayload } from './types';

const STANDARD: BallotVariant = {
  id: 'standard',
  label: 'Standard average',
  short_label: 'All polls',
  note: 'Every poll.',
  margin: 5.0,
  swing: 7.5,
  n_polls: 24,
  populations: null,
  projected: { d_seats: 32, r_seats: 23 },
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
      fips: '06', code: 'CA', name: 'California',
      direction: 'D', margin_delta: 0.5, flips_at_margin: 5.5,
    },
  ],
};

const LV: BallotVariant = {
  id: 'lv',
  label: 'Likely-voter polls only',
  short_label: 'LV only',
  note: 'LV screens only.',
  margin: 9.0,
  swing: 11.5,
  n_polls: 7,
  populations: ['LV'],
  projected: { d_seats: 34, r_seats: 21 },
  uncertainty: {
    epsilon_points: 2.2,
    basis: 'test',
    d_seats_low: 32,
    d_seats_high: 36,
    r_seats_low: 19,
    r_seats_high: 23,
  },
  majority: { tipping_margin: -0.6, majority_seats: 218 },
  closest_flips: [
    {
      fips: '56', code: 'WY', name: 'Wyoming',
      direction: 'R', margin_delta: 1.2, flips_at_margin: 7.8,
    },
  ],
};

function fixture(variants?: BallotVariant[]): ProjectionPayload {
  return {
    meta: {
      generated_at: '2026-08-20T00:00:00Z',
      data_source: 'test',
      method: 'sainte-lague',
      generic_ballot_margin: 5.0,
      baseline_2024_margin: -2.5,
      swing: 7.5,
      n_polls_in_average: 24,
      uncertainty: STANDARD.uncertainty,
      majority: STANDARD.majority,
      closest_flips: STANDARD.closest_flips,
      ...(variants ? { ballot_variants: variants } : {}),
    },
    national: {
      seats: 55,
      projected: { d_seats: 32, r_seats: 23 },
      actual: { d_seats: 30, r_seats: 25 },
    },
    states: [
      {
        fips: '06', code: 'CA', name: 'California', seats: 52,
        actual: { d_seats: 43, r_seats: 9 },
        baseline_2024: { d_share: 0.6, r_share: 0.4 },
        projected: { d_share: 0.6, r_share: 0.4, d_seats: 32, r_seats: 20 },
      },
      {
        fips: '56', code: 'WY', name: 'Wyoming', seats: 3,
        actual: { d_seats: 0, r_seats: 3 },
        baseline_2024: { d_share: 0.3, r_share: 0.7 },
        projected: { d_share: 0.3, r_share: 0.7, d_seats: 1, r_seats: 2 },
      },
    ],
  };
}

describe('ballotVariants', () => {
  it('returns what the pipeline published', () => {
    expect(ballotVariants(fixture([STANDARD, LV])).map((v) => v.id)).toEqual(['standard', 'lv']);
  });

  it('synthesizes a standard variant for a payload that predates the toggle', () => {
    const variants = ballotVariants(fixture());
    expect(variants).toHaveLength(1);
    expect(variants[0].id).toBe(DEFAULT_VARIANT_ID);
    expect(variants[0].margin).toBe(5.0);
    expect(variants[0].n_polls).toBe(24);
    expect(variants[0].uncertainty).toEqual(STANDARD.uncertainty);
  });

  it('reports whether there is anything to toggle between', () => {
    expect(hasVariantChoice(fixture())).toBe(false);
    expect(hasVariantChoice(fixture([STANDARD, LV]))).toBe(true);
  });
});

describe('resolveVariant', () => {
  it('finds the requested variant', () => {
    expect(resolveVariant(fixture([STANDARD, LV]), 'lv').id).toBe('lv');
  });

  it('falls back to the default for an unknown, missing, or dropped id', () => {
    const payload = fixture([STANDARD, LV]);
    for (const id of ['nope', null, undefined]) {
      expect(resolveVariant(payload, id).id).toBe('standard');
    }
    // A stale ?avg=lv link after the LV variant fell below its poll floor.
    expect(resolveVariant(fixture([STANDARD]), 'lv').id).toBe('standard');
  });
});

describe('applyVariant', () => {
  it('is the identity for the default variant', () => {
    const payload = fixture([STANDARD, LV]);
    expect(applyVariant(payload, STANDARD)).toBe(payload);
  });

  it('moves the projection toward D at a more D-friendly margin', () => {
    const out = applyVariant(fixture([STANDARD, LV]), LV);
    expect(out.meta.generic_ballot_margin).toBe(9.0);
    expect(out.meta.swing).toBeCloseTo(11.5, 6);
    expect(out.national.projected.d_seats).toBeGreaterThanOrEqual(32);
  });

  it('restores the analytics recomputeWithSwing strips', () => {
    const out = applyVariant(fixture([STANDARD, LV]), LV);
    expect(out.meta.uncertainty).toEqual(LV.uncertainty);
    expect(out.meta.majority).toEqual(LV.majority);
    expect(out.meta.closest_flips).toEqual(LV.closest_flips);
  });

  it('never leaves the standard variant analytics on a non-default variant', () => {
    const out = applyVariant(fixture([STANDARD, LV]), LV);
    expect(out.meta.uncertainty).not.toEqual(STANDARD.uncertainty);
    expect(out.meta.closest_flips).not.toEqual(STANDARD.closest_flips);
  });

  it('corrects the poll count, which recomputeWithSwing would carry over', () => {
    const out = applyVariant(fixture([STANDARD, LV]), LV);
    expect(out.meta.n_polls_in_average).toBe(7);
  });

  it('omits analytics the variant does not carry, rather than inheriting them', () => {
    const bare: BallotVariant = {
      ...LV, uncertainty: undefined, majority: undefined, closest_flips: undefined,
    };
    const out = applyVariant(fixture([STANDARD, bare]), bare);
    expect(out.meta.uncertainty).toBeUndefined();
    expect(out.meta.majority).toBeUndefined();
    expect(out.meta.closest_flips).toBeUndefined();
  });

  it('leaves actual and baseline figures alone', () => {
    const payload = fixture([STANDARD, LV]);
    const out = applyVariant(payload, LV);
    expect(out.national.actual).toEqual(payload.national.actual);
    out.states.forEach((s, i) => {
      expect(s.baseline_2024).toEqual(payload.states[i].baseline_2024);
      expect(s.actual).toEqual(payload.states[i].actual);
    });
  });
});

describe('parity with the pipeline (real projection.json)', () => {
  const payload: ProjectionPayload = JSON.parse(
    readFileSync(resolve(__dirname, '../../public/data/projection.json'), 'utf-8'),
  );

  it('publishes at least the standard variant', () => {
    expect(ballotVariants(payload)[0].id).toBe('standard');
  });

  // The whole design rests on this: the browser re-derives each variant's seats
  // instead of the pipeline shipping a second states array. If the two ever
  // disagree by a seat, the toggle is lying about one of them.
  it('reproduces every published variant seat-for-seat', () => {
    for (const variant of ballotVariants(payload)) {
      const out = applyVariant(payload, variant);
      expect(out.national.projected, `variant ${variant.id}`).toEqual(variant.projected);
      const summed = out.states.reduce(
        (acc, s) => ({
          d_seats: acc.d_seats + s.projected.d_seats,
          r_seats: acc.r_seats + s.projected.r_seats,
        }),
        { d_seats: 0, r_seats: 0 },
      );
      expect(summed, `variant ${variant.id} states`).toEqual(variant.projected);
    }
  });

  it('keeps every variant inside its own uncertainty band', () => {
    for (const variant of ballotVariants(payload)) {
      if (!variant.uncertainty) continue;
      expect(variant.projected.d_seats).toBeGreaterThanOrEqual(variant.uncertainty.d_seats_low);
      expect(variant.projected.d_seats).toBeLessThanOrEqual(variant.uncertainty.d_seats_high);
    }
  });
});
