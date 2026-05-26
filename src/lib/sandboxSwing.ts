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
import { huntingtonHill } from './apportionment';
import { allocateByMethod, type AllocationMethodKind } from './methods';
import { PARTY_D, PARTY_R } from './parties';
import type { Party, PartyShare, SandboxPayload, SandboxStateProjection } from './sandboxTypes';
import { STATE_POPULATIONS_2020 } from './statePopulations';
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
  /** Effective per-state seat count — equals state.seats at default 435, or
    * a reapportioned count when the user has expanded the House. */
  effectiveSeats: number,
  /** Effective actual D/R for MMP — scaled if effectiveSeats !== state.seats. */
  effectiveActualD: number,
  effectiveActualR: number,
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
          total_seats: effectiveSeats,
          vote_shares: filtered,
          party_ids: allParties.map((p) => p.id),
          actual_d_seats: effectiveActualD,
          actual_r_seats: effectiveActualR,
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
    total_seats: effectiveSeats,
    parties,
  };
}

/**
 * Scale today's actual D/R delegation up or down to fit a new total.
 * Used when House expansion changes a state's seat count — we don't know
 * who'd win the *new* SMDs, so scale proportionally and call out as an
 * assumption in the methodology page. Returns {d, r} that sum to
 * `newTotal`, with the larger fractional remainder winning the leftover.
 */
function scaleActualDelegation(
  actualD: number,
  actualR: number,
  oldTotal: number,
  newTotal: number,
): { d: number; r: number } {
  if (oldTotal <= 0 || newTotal <= 0) return { d: 0, r: 0 };
  if (oldTotal === newTotal) return { d: actualD, r: actualR };
  const exactD = (actualD / oldTotal) * newTotal;
  const exactR = (actualR / oldTotal) * newTotal;
  let d = Math.floor(exactD);
  let r = Math.floor(exactR);
  let leftover = newTotal - d - r;
  while (leftover > 0) {
    const dFrac = exactD - d;
    const rFrac = exactR - r;
    if (dFrac >= rFrac) d++;
    else r++;
    leftover--;
  }
  return { d, r };
}

/** Default US House size. Sandbox House-expansion reform proposals
  * deviate from this; everything else uses 435. */
export const DEFAULT_HOUSE_SIZE = 435;

/**
 * Build a SandboxPayload from a two-party ProjectionPayload.
 *
 * When `minors` is empty, callers should generally skip building this
 * and stay on the existing two-party rendering path. This function still
 * works in that case — it returns a SandboxPayload with [D, R] only —
 * but the rest of the app won't benefit.
 *
 * `method` defaults to 'PR' (pure statewide Sainte-Laguë, the original
 * behavior). Pass 'MMD-3', 'MMD-5', 'MMP-50', 'PR-DH', or 'PR-HAM' to
 * compare reform models.
 *
 * `houseSize` defaults to DEFAULT_HOUSE_SIZE (435). When set to a
 * different value, per-state seats are re-apportioned via Huntington-Hill
 * (the same method the real US House uses), and MMP's "actual today"
 * SMD baseline is scaled proportionally to the new state seat count.
 */
export function buildSandboxPayload(
  twoPartyPayload: ProjectionPayload,
  minors: MinorPartySpec[],
  threshold: number,
  method: AllocationMethodKind = 'PR',
  houseSize: number = DEFAULT_HOUSE_SIZE,
): SandboxPayload {
  const clampedThreshold = Math.max(0, Math.min(0.1, threshold));

  // When House size deviates from 435, reapportion seats via the same
  // Huntington-Hill method the real US uses. Pre-compute once; per-state
  // logic just reads from this map.
  const reapportioned: Record<string, number> | null =
    houseSize !== DEFAULT_HOUSE_SIZE
      ? huntingtonHill({
          state_populations: STATE_POPULATIONS_2020,
          total_seats: houseSize,
        })
      : null;

  const states = twoPartyPayload.states.map((s) => {
    const effectiveSeats = reapportioned?.[s.code] ?? s.seats;
    // MMP uses the actual SMD delegation as its starting point. When
    // we've expanded a state's seat count, scale the actual delegation
    // proportionally so MMP's SMD baseline still makes sense. Documented
    // as a v1 assumption.
    const { d: effectiveActualD, r: effectiveActualR } = scaleActualDelegation(
      s.actual.d_seats,
      s.actual.r_seats,
      s.seats,
      effectiveSeats,
    );
    return buildStateProjection(
      s,
      minors,
      clampedThreshold,
      method,
      effectiveSeats,
      effectiveActualD,
      effectiveActualR,
    );
  });

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
    house_size: houseSize,
    minors: minors.map((m) => m.party),
    national: {
      total_seats: nationalSeatTotal,
      parties: nationalParties,
    },
    states,
  };
}
