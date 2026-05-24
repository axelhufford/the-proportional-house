import { describe, expect, it } from 'vitest';
import { API_VERSION, toApiV1, toApiV1Csv } from './apiShape';
import type { ProjectionPayload } from './types';

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
    expect(out.national).toEqual({
      total_seats: 435,
      actual: { D: 215, R: 220 },
      projected: { D: 234, R: 201 },
    });
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
