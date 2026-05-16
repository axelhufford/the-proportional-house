import { allocate } from './allocation';
import type { ProjectionPayload, SeatSplit, VoteShare } from './types';

/**
 * Apply a uniform national swing to a state's 2024 baseline and run
 * Sainte-Laguë. Mirrors the Python pipeline's per-state logic in
 * data-pipeline/update.py so client-side recomputes for the Retrospective
 * and Sandbox views match what the nightly pipeline would emit.
 *
 * `swingPoints` is the change in margin (D - R) in percentage points;
 * positive = toward D. Each party's share shifts by swing/2.
 *
 * Vermont-style baseline distortion (one party fielded no statewide
 * candidate in 2024) gets a 50/50 fallback so the projection doesn't
 * start from a 100/0 share that the swing alone can't recover.
 */
function applyStateSwing(
  baseline: VoteShare,
  baselineDistortion: boolean,
  seats: number,
  swingPoints: number,
): VoteShare & SeatSplit {
  const baseD = baselineDistortion ? 0.5 : baseline.d_share;
  const baseR = baselineDistortion ? 0.5 : baseline.r_share;

  const delta = swingPoints / 2 / 100;
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

  return { d_share: projD, r_share: projR, d_seats, r_seats };
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
  const states = payload.states.map((s) => ({
    ...s,
    projected: applyStateSwing(s.baseline_2024, s.baseline_distortion_warning ?? false, s.seats, swingPoints),
  }));

  let natD = 0;
  let natR = 0;
  for (const s of states) {
    natD += s.projected.d_seats;
    natR += s.projected.r_seats;
  }

  return {
    ...payload,
    meta: {
      ...payload.meta,
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
