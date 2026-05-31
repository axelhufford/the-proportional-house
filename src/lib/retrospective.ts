import type { ProjectionPayload, RetroCyclePayload } from './types';

/**
 * Adapt one retrospective cycle into the `ProjectionPayload` shape the rest of
 * the app (Map, NationalSummary, StateDetail, HomeHero) already consumes — so a
 * historical cycle "just works" with no per-component branching.
 *
 * Mapping: `projected_pr` → `projected` seats; the cycle's reported two-party
 * share → both `baseline_2024` and the projected shares; `swing = 0` (a
 * retrospective applies no polling swing). `generic_ballot_margin` /
 * `baseline_2024_margin` carry the cycle's national popular-vote margin so the
 * settings line can show it.
 */
export function cycleToProjectionPayload(cycle: RetroCyclePayload, year: number): ProjectionPayload {
  const margin = cycle.national.popular_vote_d_margin ?? 0;
  return {
    meta: {
      generated_at: '',
      data_source: `${year} U.S. House results`,
      method: 'sainte-lague',
      generic_ballot_margin: margin,
      baseline_2024_margin: margin,
      swing: 0,
    },
    national: {
      seats: cycle.national.seats,
      projected: cycle.national.projected_pr,
      actual: cycle.national.actual,
    },
    states: cycle.states.map((s) => ({
      fips: s.fips,
      code: s.code,
      name: s.name,
      seats: s.seats,
      actual: s.actual,
      baseline_2024: s.two_party_share,
      projected: {
        d_share: s.two_party_share.d_share,
        r_share: s.two_party_share.r_share,
        d_seats: s.projected_pr.d_seats,
        r_seats: s.projected_pr.r_seats,
      },
      baseline_distortion_warning: s.baseline_distortion_warning,
    })),
  };
}
