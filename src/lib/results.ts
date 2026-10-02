/**
 * Election results on the client (public/data/results_<cycle>.json, built by
 * data-pipeline/build_results.py).
 *
 * `resultsToProjectionPayload` adapts results into the ProjectionPayload shape
 * the map, dot map and state panel already render — the same move
 * `cycleToProjectionPayload` makes for past cycles:
 *   actual    → seats CALLED so far (uncalled seats ride along in `result`)
 *   projected → Sainte-Laguë of the two-party vote counted so far
 * A state with no votes counted keeps its frozen final projection in
 * `projected`, flagged by `result.status === 'pending'`: the map draws it gray
 * and the panel labels it as the projection. Nothing that sums or compares
 * results may read a pending state's `projected` — use `isReporting`.
 */
import type { ProjectionPayload, ResultsPayload, ResultsState, StateProjection } from './types';

/** A state with votes counted. Pending states carry the projection, not results. */
export function isReporting(s: StateProjection): boolean {
  return !!s.result && s.result.status !== 'pending';
}

/** True once any state has votes counted — the point the headline switches to results. */
export function hasResults(results: ResultsPayload | null | undefined): results is ResultsPayload {
  return !!results && results.states.some((s) => s.under_pr !== null);
}

/** "Provisional" until every state certifies. */
export function resultsStatusLabel(results: ResultsPayload): 'Provisional' | 'Certified' {
  return results.meta.all_certified ? 'Certified' : 'Provisional';
}

export function resultsToProjectionPayload(
  results: ResultsPayload,
  base: ProjectionPayload,
): ProjectionPayload {
  const baseByCode = new Map(base.states.map((s) => [s.code, s]));
  const states: StateProjection[] = [];
  for (const s of results.states) {
    const b = baseByCode.get(s.code);
    if (!s.under_pr || !s.two_party_share) {
      if (!b) continue;
      states.push({
        fips: s.fips,
        code: s.code,
        name: s.name,
        seats: s.seats,
        actual: { d_seats: s.as_elected.d_seats, r_seats: s.as_elected.r_seats },
        baseline_2024: b.baseline_2024,
        projected: b.projected,
        baseline_distortion_warning: b.baseline_distortion_warning,
        result: s,
      });
      continue;
    }
    states.push({
      fips: s.fips,
      code: s.code,
      name: s.name,
      seats: s.seats,
      actual: { d_seats: s.as_elected.d_seats, r_seats: s.as_elected.r_seats },
      // The 2024 baseline stays what it was; the counted 2026 share is `projected`.
      baseline_2024: b?.baseline_2024 ?? s.two_party_share,
      projected: {
        d_share: s.two_party_share.d_share,
        r_share: s.two_party_share.r_share,
        d_seats: s.under_pr.d_seats,
        r_seats: s.under_pr.r_seats,
      },
      baseline_distortion_warning: s.baseline_distortion_warning,
      result: s,
    });
  }

  // Projection analytics describe the frozen projection, not the results.
  const {
    uncertainty: _u,
    majority: _m,
    closest_flips: _c,
    ballot_variants: _b,
    active_ballot_variant: _a,
    ...meta
  } = base.meta;
  void _u; void _m; void _c; void _b; void _a;
  const nat = results.national;
  return {
    meta: {
      ...meta,
      data_source: `${results.meta.cycle} U.S. House results (${resultsStatusLabel(results).toLowerCase()})`,
      swing: 0,
    },
    national: {
      seats: nat.seats,
      projected: { d_seats: nat.under_pr.d_seats, r_seats: nat.under_pr.r_seats },
      actual: { d_seats: nat.as_elected.d_seats, r_seats: nat.as_elected.r_seats },
    },
    states,
  };
}

/** Called seats + "not yet called" for one state, as a dot-map delegation. */
export function calledDelegation(s: ResultsState) {
  return {
    fips: s.fips,
    code: s.code,
    name: s.name,
    d: s.as_elected.d_seats,
    r: s.as_elected.r_seats,
    other: s.as_elected.other_seats,
    vacant: s.as_elected.uncalled_seats,
  };
}

/** PR of the counted vote, or every seat "not yet counted" while pending. */
export function prDelegation(s: ResultsState) {
  return {
    fips: s.fips,
    code: s.code,
    name: s.name,
    d: s.under_pr?.d_seats ?? 0,
    r: s.under_pr?.r_seats ?? 0,
    other: 0,
    vacant: s.under_pr ? 0 : s.seats,
  };
}

/** "Nov 4, 11:30 PM ET" — results timestamps are read in Eastern time. */
export function fmtAsOf(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return (
    new Date(ms).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    }) + ' ET'
  );
}
