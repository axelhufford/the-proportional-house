import { describe, expect, it } from 'vitest';
import { calledDelegation, hasResults, isReporting, prDelegation, resultsToProjectionPayload } from './results';
import type { ProjectionPayload, ResultsPayload, ResultsState } from './types';

const BASE: ProjectionPayload = {
  meta: {
    generated_at: '2026-11-03T06:05:00+00:00',
    data_source: 'x',
    method: 'sainte-lague',
    generic_ballot_margin: 8.2,
    baseline_2024_margin: -2.511,
    swing: 10.7,
    uncertainty: {
      epsilon_points: 2.2, basis: 'b', d_seats_low: 1, d_seats_high: 2, r_seats_low: 3, r_seats_high: 4,
    },
    election: { cycle: 2026, election_date: '2026-11-03', freeze_at: '2026-11-03T10:00:00Z', phase: 'counting', baseline_cycle: 2024 },
  },
  national: { seats: 16, projected: { d_seats: 9, r_seats: 7 }, actual: { d_seats: 8, r_seats: 8 } },
  states: [
    {
      fips: '34', code: 'NJ', name: 'New Jersey', seats: 12,
      actual: { d_seats: 9, r_seats: 3 },
      baseline_2024: { d_share: 0.55, r_share: 0.45 },
      projected: { d_share: 0.6, r_share: 0.4, d_seats: 7, r_seats: 5 },
    },
  ],
};

function state(code: string, over: Partial<ResultsState> = {}): ResultsState {
  return {
    fips: code === 'NJ' ? '34' : '56', code, name: code === 'NJ' ? 'New Jersey' : 'Wyoming',
    seats: code === 'NJ' ? 12 : 1, status: 'pending',
    as_elected: { d_seats: 0, r_seats: 0, other_seats: 0, uncalled_seats: code === 'NJ' ? 12 : 1 },
    votes: { d: null, r: null, other: null }, two_party_share: null, under_pr: null,
    reporting_pct: null, reporting_source: null, source_url: null, as_of: null, note: null,
    baseline_distortion_warning: false, uncontested_district_count: null,
    ...over,
  };
}

function results(states: ResultsState[]): ResultsPayload {
  return {
    meta: {
      generated_at: 'g', cycle: 2026, election_date: '2026-11-03', source_file: 'f', method: 'sainte-lague',
      as_of: null, rehearsal: false, status_counts: { pending: 1, provisional: 1, certified: 0 },
      seats_called: 7, all_called: false, all_certified: false,
    },
    national: {
      seats: 13,
      as_elected: { d_seats: 5, r_seats: 2, other_seats: 0, uncalled_seats: 6 },
      under_pr: { d_seats: 7, r_seats: 5, pending_seats: 1 },
      votes: { d: 600, r: 400, other: null },
      two_party_d_margin_points: 20, all_votes_d_margin_points: null,
    },
    states,
  };
}

const NJ = state('NJ', {
  status: 'provisional',
  as_elected: { d_seats: 5, r_seats: 2, other_seats: 0, uncalled_seats: 5 },
  votes: { d: 600, r: 400, other: null },
  two_party_share: { d_share: 0.6, r_share: 0.4 },
  under_pr: { d_seats: 7, r_seats: 5 },
});

describe('results adapter', () => {
  it('only switches to results once a state has votes counted', () => {
    expect(hasResults(null)).toBe(false);
    expect(hasResults(results([state('NJ'), state('WY')]))).toBe(false);
    expect(hasResults(results([NJ, state('WY')]))).toBe(true);
  });

  it('maps called seats to actual and PR of counted votes to projected', () => {
    const p = resultsToProjectionPayload(results([NJ, state('WY')]), BASE);
    expect(p.states.map((s) => s.code)).toEqual(['NJ']); // WY has no base state here
    const nj = p.states[0];
    expect(nj.actual).toEqual({ d_seats: 5, r_seats: 2 });
    expect(nj.projected).toEqual({ d_share: 0.6, r_share: 0.4, d_seats: 7, r_seats: 5 });
    // The 2024 baseline is kept for comparison, not replaced by the count.
    expect(nj.baseline_2024).toEqual({ d_share: 0.55, r_share: 0.45 });
    expect(nj.result?.status).toBe('provisional');
  });

  it('keeps a pending state, carrying its final projection and flagged as not reporting', () => {
    const p = resultsToProjectionPayload(results([state('NJ')]), BASE);
    const nj = p.states[0];
    expect(isReporting(nj)).toBe(false);
    expect(nj.result?.status).toBe('pending');
    expect(nj.projected).toEqual(BASE.states[0].projected);
    expect(nj.actual).toEqual({ d_seats: 0, r_seats: 0 });
  });

  it('drops projection analytics that describe the frozen projection, keeps the election block', () => {
    const p = resultsToProjectionPayload(results([NJ]), BASE);
    expect(p.meta.uncertainty).toBeUndefined();
    expect(p.meta.election?.cycle).toBe(2026);
    expect(p.meta.data_source).toBe('2026 U.S. House results (provisional)');
  });

  it('never folds uncalled or unreported seats into a party on the dot map', () => {
    expect(calledDelegation(NJ)).toMatchObject({ d: 5, r: 2, other: 0, vacant: 5 });
    expect(prDelegation(state('WY'))).toMatchObject({ d: 0, r: 0, vacant: 1 });
    expect(prDelegation(NJ)).toMatchObject({ d: 7, r: 5, vacant: 0 });
  });
});
