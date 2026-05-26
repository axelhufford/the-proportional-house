/**
 * Sandbox extended (N-party) swing math.
 *
 * Builds a parallel `SandboxPayload` from an existing two-party
 * `ProjectionPayload` by subtracting minor-party shares from D / R,
 * applying a per-state threshold, and re-allocating seats with the
 * generic N-party allocator.
 *
 * The two-party payload should already have its swing applied (i.e.
 * be the output of `recomputeWithSwing` for the sandbox's chosen
 * generic-ballot margin). This module is layered on top — it doesn't
 * compute the D/R swing itself.
 */
import { allocateByMethod, type AllocationMethodKind } from './methods';
import { PARTY_D, PARTY_R } from './parties';
import type { Party, PartyShare, SandboxPayload, SandboxStateProjection } from './sandboxTypes';
import type { ProjectionPayload, StateProjection } from './types';

export interface MinorPartySpec {
  party: Party;
  /** [0, 1] — national share applied uniformly to every state in v1. */
  national_share: number;
}

/**
 * Per-state algorithm:
 *   1. Start from the state's existing two-party projected shares.
 *   2. For each minor m with share S and draw weights (d_w, r_w):
 *        D_share -= S × d_w;  R_share -= S × r_w;  m.share = S.
 *   3. Clamp shares to [0, 1] and renormalize so they sum to 1.
 *   4. Threshold filter: any party with share < threshold → 0 share,
 *      then renormalize the rest. (D and R are also subject to the
 *      threshold; in extreme scenarios the losing major could be zeroed
 *      in a tiny state.)
 *   5. allocateN over shares × notional vote total → seats per party.
 *
 * Returns party shares in the canonical order: D, R, minors in input
 * order. Each `SandboxStateProjection.parties` keeps this ordering.
 */
function buildStateProjection(
  state: StateProjection,
  minors: MinorPartySpec[],
  threshold: number,
  method: AllocationMethodKind,
): SandboxStateProjection {
  // Step 1: start from existing projected D/R shares.
  let dShare = state.projected.d_share;
  let rShare = state.projected.r_share;

  // Step 2: subtract each minor's draw from D and R (in parallel —
  // minors don't draw from each other in v1).
  const minorShares: number[] = [];
  for (const m of minors) {
    dShare -= m.national_share * m.party.draw_from.D;
    rShare -= m.national_share * m.party.draw_from.R;
    minorShares.push(m.national_share);
  }

  // Step 3: clamp + renormalize. Extreme inputs (e.g. a 25% minor
  // hitting a 15%-D state) can push a major negative; clamp first,
  // then rescale so the total still equals 1.
  const rawShares = [dShare, rShare, ...minorShares].map((s) => Math.max(0, s));
  const rawTotal = rawShares.reduce((s, v) => s + v, 0);
  const normalized = rawTotal > 0 ? rawShares.map((s) => s / rawTotal) : rawShares.map(() => 0);

  // Step 4: threshold filter. Parties below the cutoff lose their share
  // entirely; the remainder is renormalized so the total stays at 1.
  const above = normalized.map((s) => (s >= threshold ? s : 0));
  const aboveTotal = above.reduce((s, v) => s + v, 0);
  const filtered = aboveTotal > 0 ? above.map((s) => s / aboveTotal) : above.map(() => 0);

  // Step 5: dispatch to the chosen allocation method. PR is the
  // historical default; MMD-3 / MMD-5 / MMP-50 add the comparison
  // points for the reform discussion.
  const allParties: Party[] = [PARTY_D, PARTY_R, ...minors.map((m) => m.party)];
  const seats = aboveTotal > 0
    ? allocateByMethod(
        {
          total_seats: state.seats,
          vote_shares: filtered,
          party_ids: allParties.map((p) => p.id),
          actual_d_seats: state.actual.d_seats,
          actual_r_seats: state.actual.r_seats,
        },
        method,
      )
    : filtered.map(() => 0);

  // Stitch back into the party-keyed shape.
  const parties: PartyShare[] = allParties.map((p, i) => ({
    party: p,
    vote_share: filtered[i],
    seats: seats[i] ?? 0,
  }));

  return {
    fips: state.fips,
    code: state.code,
    name: state.name,
    total_seats: state.seats,
    parties,
  };
}

/**
 * Build a SandboxPayload from a two-party ProjectionPayload.
 *
 * When `minors` is empty, callers should generally skip building this
 * and stay on the existing two-party rendering path. This function still
 * works in that case — it returns a SandboxPayload with [D, R] only —
 * but the rest of the app won't benefit.
 *
 * `method` defaults to 'PR' (pure statewide Sainte-Laguë, the original
 * behavior). Pass 'MMD-3', 'MMD-5', or 'MMP-50' to compare reform
 * models.
 */
export function buildSandboxPayload(
  twoPartyPayload: ProjectionPayload,
  minors: MinorPartySpec[],
  threshold: number,
  method: AllocationMethodKind = 'PR',
): SandboxPayload {
  const clampedThreshold = Math.max(0, Math.min(0.1, threshold));

  const states = twoPartyPayload.states.map((s) =>
    buildStateProjection(s, minors, clampedThreshold, method),
  );

  // National totals: sum seats per party across states. (Don't try to
  // re-allocate at the national level — the projection is fundamentally
  // a sum-of-state-allocations.)
  const partyCount = 2 + minors.length;
  const nationalSeats = new Array<number>(partyCount).fill(0);
  let nationalSeatTotal = 0;
  for (const st of states) {
    for (let i = 0; i < partyCount; i++) {
      nationalSeats[i] += st.parties[i].seats;
    }
    nationalSeatTotal += st.total_seats;
  }

  // National vote shares: weighted by state's total_seats (a proxy for
  // population), so a 6% Progressive Left in California weighs more than
  // 6% in Wyoming. The minors are uniform-national by construction; this
  // mostly affects the displayed D/R totals which vary by state.
  const totalSeatWeight = states.reduce((s, st) => s + st.total_seats, 0);
  const weightedShares = new Array<number>(partyCount).fill(0);
  for (const st of states) {
    for (let i = 0; i < partyCount; i++) {
      weightedShares[i] += st.parties[i].vote_share * st.total_seats;
    }
  }
  const nationalShares = totalSeatWeight > 0
    ? weightedShares.map((s) => s / totalSeatWeight)
    : weightedShares;

  const allParties: Party[] = [PARTY_D, PARTY_R, ...minors.map((m) => m.party)];
  const nationalParties: PartyShare[] = allParties.map((p, i) => ({
    party: p,
    vote_share: nationalShares[i],
    seats: nationalSeats[i],
  }));

  return {
    meta: twoPartyPayload.meta,
    threshold: clampedThreshold,
    method,
    minors: minors.map((m) => m.party),
    national: {
      total_seats: nationalSeatTotal,
      parties: nationalParties,
    },
    states,
  };
}
