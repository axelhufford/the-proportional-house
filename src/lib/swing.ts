import { allocate } from './allocation';
import type { ProjectionPayload, SeatSplit, VoteShare } from './types';

/**
 * Apply a state-specific swing (national swing × state elasticity) to the
 * state's 2024 baseline and run Sainte-Laguë. Mirrors the Python pipeline's
 * per-state logic in data-pipeline/update.py so client-side recomputes for
 * the Retrospective and Sandbox views match what the nightly pipeline emits.
 *
 * `swingPoints` is the national change in margin (D − R) in percentage
 * points; positive = toward D. Multiplied by the state's elasticity
 * coefficient (clamped [0.3, 2.0]; computed in fetch_clerk_house.py from
 * the 2020 → 2024 presidential margin shift). Then each party's share
 * shifts by stateSwing/2.
 *
 * Vermont-style baseline distortion (one party fielded no statewide
 * candidate in 2024) gets a 50/50 fallback for safety, though in v2 data
 * VT is now properly imputed via pres-by-CD and the flag never fires.
 */
function applyStateSwing(
  baseline: VoteShare,
  baselineDistortion: boolean,
  seats: number,
  swingPoints: number,
  elasticity: number,
): VoteShare & SeatSplit & { state_swing_applied: number; state_elasticity: number } {
  const baseD = baselineDistortion ? 0.5 : baseline.d_share;
  const baseR = baselineDistortion ? 0.5 : baseline.r_share;

  const stateSwing = swingPoints * elasticity;
  const delta = stateSwing / 2 / 100;
  let projD = baseD + delta;
  let projR = baseR - delta;

  // Clamp away from a true shutout so Sainte-Laguë's divisors stay defined.
  projD = Math.max(0.001, Math.min(0.999, projD));
  projR = Math.max(0.001, Math.min(0.999, projR));

  // Renormalize so the shares sum to 1 even after clamping.
  const sum = projD + projR;
  projD /= sum;
  projR /= sum;

  const { d_seats, r_seats } = allocate(
    { seats, d_votes: projD * 1_000_000, r_votes: projR * 1_000_000 },
    'sainte-lague',
  );

  return {
    d_share: projD,
    r_share: projR,
    d_seats,
    r_seats,
    state_swing_applied: stateSwing,
    state_elasticity: elasticity,
  };
}

/**
 * Return a fresh ProjectionPayload with every state's `projected` and the
 * national totals recomputed under a given swing. Leaves `actual` and
 * `baseline_2024` untouched.
 *
 * `meta.swing` and `meta.generic_ballot_margin` are also updated to reflect
 * the requested swing so any UI that reads them stays consistent.
 */
export function recomputeWithSwing(
  payload: ProjectionPayload,
  swingPoints: number,
): ProjectionPayload {
  const states = payload.states.map((s) => {
    const elasticity = s.state_elasticity ?? 1.0;
    const projected = applyStateSwing(
      s.baseline_2024,
      s.baseline_distortion_warning ?? false,
      s.seats,
      swingPoints,
      elasticity,
    );
    return {
      ...s,
      projected: {
        d_share: projected.d_share,
        r_share: projected.r_share,
        d_seats: projected.d_seats,
        r_seats: projected.r_seats,
      },
      state_swing_applied: projected.state_swing_applied,
      state_elasticity: projected.state_elasticity,
    };
  });

  let natD = 0;
  let natR = 0;
  for (const s of states) {
    natD += s.projected.d_seats;
    natR += s.projected.r_seats;
  }

  // The shipped uncertainty band is the pipeline's projection evaluated at
  // ITS swing ± ε. A recomputed payload carries a different swing, so the
  // band no longer describes it — strip it rather than let a stale band
  // leak into Sandbox/Retrospective renders.
  const { uncertainty: _droppedBand, ...restMeta } = payload.meta;
  void _droppedBand;
  return {
    ...payload,
    meta: {
      ...restMeta,
      swing: swingPoints,
      generic_ballot_margin: payload.meta.baseline_2024_margin + swingPoints,
    },
    national: {
      ...payload.national,
      projected: { d_seats: natD, r_seats: natR },
    },
    states,
  };
}
