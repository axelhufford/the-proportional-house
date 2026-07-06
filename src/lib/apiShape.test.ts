import { describe, expect, it } from 'vitest';
import { API_VERSION, toApiV1, toApiV1Csv, toApiV1History } from './apiShape';
import type { HistoryPayload, ProjectionPayload } from './types';

const FIXTURE: ProjectionPayload = {
  meta: {
    generated_at: '2026-05-22T22:21:35.242825+00:00',
    data_source: 'House Clerk + Silver Bulletin',
    method: 'sainte-lague',
    generic_ballot_margin: 6.83,
    baseline_2024_margin: -2.511,
    baseline_2024_r_margin: 2.511,
    swing: 9.34,
    n_polls_in_average: 30,
    poll_window_days: 30,
    poll_half_life_days: 14,
  },
  national: {
    seats: 435,
    projected: { d_seats: 234, r_seats: 201 },
    actual: { d_seats: 215, r_seats: 220 },
  },
  states: [
    {
      fips: '06',
      code: 'CA',
      name: 'California',
      seats: 52,
      actual: { d_seats: 43, r_seats: 9 },
      baseline_2024: { d_share: 0.591, r_share: 0.409 },
      projected: { d_share: 0.62, r_share: 0.38, d_seats: 32, r_seats: 20 },
    },
    {
      fips: '01',
      code: 'AL',
      name: 'Alabama',
      seats: 7,
      actual: { d_seats: 2, r_seats: 5 },
      baseline_2024: { d_share: 0.2557, r_share: 0.7443 },
      projected: { d_share: 0.2883, r_share: 0.7117, d_seats: 2, r_seats: 5 },
    },
  ],
};

describe('toApiV1', () => {
  it('stamps the api_version constant', () => {
    expect(toApiV1(FIXTURE).api_version).toBe(API_VERSION);
  });

  it('hoists pipeline polling fields into a curated `polling` object', () => {
    const out = toApiV1(FIXTURE);
    expect(out.polling).toEqual({
      window_days: 30,
      half_life_days: 14,
      n_polls: 30,
      generic_ballot_margin: 6.83,
      baseline_2024_margin: -2.511,
      swing: 9.34,
    });
  });

  it('renames snake_case seat fields to party-keyed objects', () => {
    const out = toApiV1(FIXTURE);
    // toEqual is exact — this also guards that projected_range is OMITTED
    // (not null) when the internal payload carries no uncertainty band.
    expect(out.national).toEqual({
      total_seats: 435,
      actual: { D: 215, R: 220 },
      projected: { D: 234, R: 201 },
    });
  });

  it('passes the optional uncertainty band through as national.projected_range', () => {
    const withBand: ProjectionPayload = {
      ...FIXTURE,
      meta: {
        ...FIXTURE.meta,
        uncertainty: {
          epsilon_points: 2.2,
          basis: 'RMS miss of final RCP generic-ballot averages, 2016-2024',
          d_seats_low: 226,
          d_seats_high: 240,
          r_seats_low: 195,
          r_seats_high: 209,
        },
      },
    };
    const out = toApiV1(withBand);
    expect(out.national.projected_range).toEqual({
      epsilon_points: 2.2,
      basis: 'RMS miss of final RCP generic-ballot averages, 2016-2024',
      D: { low: 226, high: 240 },
      R: { low: 195, high: 209 },
    });
    // The rest of the national block is unchanged by the band.
    expect(out.national.projected).toEqual({ D: 234, R: 201 });
  });

  it('passes the optional majority tipping + closest flips through, omitted when absent', () => {
    const withAnalytics: ProjectionPayload = {
      ...FIXTURE,
      meta: {
        ...FIXTURE.meta,
        majority: { tipping_margin: -0.6, majority_seats: 218 },
        closest_flips: [
          {
            fips: '36',
            code: 'NY',
            name: 'New York',
            direction: 'D',
            margin_delta: 0.2,
            flips_at_margin: 7.0,
          },
        ],
      },
    };
    const out = toApiV1(withAnalytics);
    expect(out.national.majority_tipping).toEqual({ tipping_margin: -0.6, majority_seats: 218 });
    expect(out.closest_flips).toEqual([
      {
        code: 'NY',
        name: 'New York',
        fips: '36',
        direction: 'D',
        margin_delta: 0.2,
        flips_at_margin: 7.0,
      },
    ]);
    // Omitted (not null) without the data — the base FIXTURE path.
    const bare = toApiV1(FIXTURE);
    expect(bare.national).not.toHaveProperty('majority_tipping');
    expect(bare).not.toHaveProperty('closest_flips');
  });

  it('sorts states alphabetically by postal code', () => {
    const out = toApiV1(FIXTURE);
    expect(out.states.map((s) => s.code)).toEqual(['AL', 'CA']);
  });

  it('computes per-state swing as projected D − actual D', () => {
    const out = toApiV1(FIXTURE);
    const ca = out.states.find((s) => s.code === 'CA')!;
    // CA: projected 32 D − actual 43 D = −11 D (state shifts toward R under PR)
    expect(ca.swing).toBe(-11);
    const al = out.states.find((s) => s.code === 'AL')!;
    // AL: projected 2 D − actual 2 D = 0
    expect(al.swing).toBe(0);
  });

  it('defaults missing polling fields rather than emitting undefined', () => {
    const minimal: ProjectionPayload = {
      ...FIXTURE,
      meta: {
        ...FIXTURE.meta,
        n_polls_in_average: undefined,
        poll_window_days: undefined,
        poll_half_life_days: undefined,
      },
    };
    const out = toApiV1(minimal);
    expect(out.polling.n_polls).toBe(0);
    expect(out.polling.window_days).toBe(30);
    expect(out.polling.half_life_days).toBe(14);
  });
});

describe('toApiV1Csv', () => {
  it('emits a header row plus one row per state, alphabetical by code', () => {
    const csv = toApiV1Csv(FIXTURE);
    const lines = csv.trimEnd().split('\n');
    expect(lines).toHaveLength(3); // header + 2 states
    expect(lines[0]).toBe(
      'code,name,fips,total_seats,actual_D,actual_R,projected_D,projected_R,swing,vote_share_2024_D,vote_share_2024_R,vote_share_projected_D,vote_share_projected_R',
    );
    expect(lines[1].startsWith('AL,Alabama,01,7,2,5,2,5,0,')).toBe(true);
    expect(lines[2].startsWith('CA,California,06,52,43,9,32,20,-11,')).toBe(true);
  });

  it('quotes names that contain commas', () => {
    const withComma: ProjectionPayload = {
      ...FIXTURE,
      states: [
        {
          ...FIXTURE.states[0],
          name: 'Foo, Inc.',
        },
      ],
    };
    const csv = toApiV1Csv(withComma);
    expect(csv).toContain('"Foo, Inc."');
  });

  it('terminates with a trailing newline', () => {
    const csv = toApiV1Csv(FIXTURE);
    expect(csv.endsWith('\n')).toBe(true);
  });
});

const HISTORY_FIXTURE: HistoryPayload = {
  meta: { generated_at: '2026-06-18T00:00:00+00:00' },
  points: [
    {
      date: '2025-02-03',
      projected_d: 219,
      projected_r: 216,
      actual_d: 215,
      actual_r: 220,
      generic_ballot_margin: -0.05,
      swing: 2.46,
      reconstructed: true,
      methods: {
        'MMD-3': { d: 212, r: 223 },
        'MMD-5': { d: 216, r: 219 },
        'MMP-50': { d: 218, r: 217 },
      },
    },
    {
      // Legacy point with no `methods` block — only Pure PR should be emitted.
      date: '2026-06-02',
      projected_d: 234,
      projected_r: 201,
      actual_d: 215,
      actual_r: 220,
      generic_ballot_margin: 6.94,
      swing: 9.45,
      reconstructed: false,
    },
  ],
};

describe('toApiV1History', () => {
  it('stamps the api_version and advertises the method list', () => {
    const out = toApiV1History(HISTORY_FIXTURE);
    expect(out.api_version).toBe(API_VERSION);
    expect(out.methods).toEqual(['PR', 'MMD-3', 'MMD-5', 'MMP-50']);
    expect(out.total_seats).toBe(435);
    expect(out.generated_at).toBe('2026-06-18T00:00:00+00:00');
  });

  it('keys per-method seats as party objects, PR from the top-level fields', () => {
    const out = toApiV1History(HISTORY_FIXTURE);
    expect(out.points[0].seats).toEqual({
      PR: { D: 219, R: 216 },
      'MMD-3': { D: 212, R: 223 },
      'MMD-5': { D: 216, R: 219 },
      'MMP-50': { D: 218, R: 217 },
    });
    expect(out.points[0].reconstructed).toBe(true);
  });

  it('emits only PR for legacy points that lack a methods block', () => {
    const out = toApiV1History(HISTORY_FIXTURE);
    expect(out.points[1].seats).toEqual({ PR: { D: 234, R: 201 } });
    expect(out.points[1].reconstructed).toBe(false);
  });
});
