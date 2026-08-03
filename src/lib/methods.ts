/**
 * Allocation method dispatchers for the Sandbox.
 *
 * The Sandbox lets users compare four reform models against today's
 * single-member-district baseline:
 *
 *   - PR       — pure statewide Sainte-Laguë (the original projection).
 *   - MMD-3    — split each state's seats into 3-seat districts; allocate
 *                per-district assuming uniform partisan share across the
 *                state. Less proportional than PR; closer to today's SMD.
 *   - MMD-5    — same, with 5-seat districts. Somewhat more proportional
 *                than MMD-3.
 *   - MMP-50   — half SMD (using today's actual delegation scaled to the
 *                SMD count), half list (allocated to top each party up to
 *                its proportional target). German / NZ-style.
 *
 * All methods consume a single `MethodAllocationInput` and return a seat
 * array indexed by party in input order. The math reuses `allocateN`
 * from `./allocation.ts` for Sainte-Laguë wherever it applies.
 */
import { allocateN, type AllocationMethod as DivisorMethod } from './allocation';

export type AllocationMethodKind =
  | 'PR'        // PR with Sainte-Laguë (most neutral; default)
  | 'PR-DH'     // PR with D'Hondt (slightly favors larger parties)
  | 'PR-HAM'    // PR with Hamilton / Largest Remainder
  | 'MMD-3'
  | 'MMD-5'
  | 'MMP-50';

/** Display labels — used by UI for buttons and table headings. */
export const METHOD_LABELS: Record<AllocationMethodKind, string> = {
  PR: 'Pure PR',
  'PR-DH': 'PR (D’Hondt)',
  'PR-HAM': 'PR (Hamilton)',
  'MMD-3': 'MMD-3',
  'MMD-5': 'MMD-5',
  'MMP-50': 'MMP-50',
};

export const METHOD_DESCRIPTIONS: Record<AllocationMethodKind, string> = {
  PR: 'Statewide PR using Sainte-Laguë: the most neutral divisor method; the default.',
  'PR-DH': 'Statewide PR using D’Hondt: divisors are 1, 2, 3, …; slightly favors larger parties. Used in Spain, Portugal, Belgium.',
  'PR-HAM': 'Statewide PR using Hamilton / Largest Remainder: quota-based; proportional but has known paradoxes (Alabama paradox, population paradox).',
  'MMD-3': '3-seat districts: each state is chopped into 3-seat districts, PR within each. Less proportional than statewide PR.',
  'MMD-5': '5-seat districts: chunked into 5-seat districts (closer to statewide PR than MMD-3).',
  'MMP-50': '50% single-member districts plus 50% proportional list. List seats top each party up to its proportional target. German-style.',
};

export const ALL_METHODS: AllocationMethodKind[] = [
  'PR',
  'PR-DH',
  'PR-HAM',
  'MMD-3',
  'MMD-5',
  'MMP-50',
];

export interface MethodAllocationInput {
  /** Total House seats in this state. */
  total_seats: number;
  /**
   * Vote share per party in [0, 1], summing to 1. Caller has already
   * applied threshold filtering + renormalization. Index order is
   * preserved in the result.
   */
  vote_shares: number[];
  /** Party ids parallel to vote_shares. Used by MMP to locate D / R. */
  party_ids: string[];
  /** Today's actual House delegation for this state — MMP uses these for SMD seats. */
  actual_d_seats: number;
  actual_r_seats: number;
}

/**
 * Statewide PR — thin wrapper over `allocateN`. Parameterized by divisor
 * formula so the same allocator can serve PR (Sainte-Laguë), PR-DH
 * (D'Hondt), and PR-HAM (Hamilton/Largest-Remainder).
 *
 * Sainte-Laguë is the default and the most neutral. D'Hondt slightly
 * favors larger parties. Hamilton is quota-based (not a divisor method
 * in the same sense, but the underlying allocateN handles it).
 */
export function allocatePR(
  input: MethodAllocationInput,
  formula: DivisorMethod = 'sainte-lague',
): number[] {
  return allocateN(
    { seats: input.total_seats, votes: input.vote_shares.map((s) => s * 1_000_000) },
    formula,
  );
}

/**
 * MMD: chop the state's seats into districts of `size`, allocate PR
 * within each, sum results across districts. Assumes uniform partisan
 * distribution — every district has the same vote shares as the state
 * total. This is the "abstract" v1 model; a future v2 could use real CD
 * partisan data for geographic heterogeneity.
 *
 *   - 1-seat states (AK, DE, ND, SD, VT, WY): bypass MMD entirely, give
 *     the seat to the plurality party. Equivalent to PR for N=1.
 *   - Remainder handling: floor(N / size) full-size districts + one
 *     smaller district of size (N mod size) when the remainder > 0.
 *     Example: 10 seats, size 3 → districts of [3, 3, 3, 1].
 *   - District size larger than state total: one district of total_seats.
 */
export function allocateMMD(input: MethodAllocationInput, size: number): number[] {
  const { total_seats, vote_shares } = input;
  // A size below 1 would make `full` Infinity (size 0) or negative (size < 0),
  // hanging the tab or silently dropping every seat. The UI bounds magnitude
  // to 2–10, but this is an exported function.
  if (!Number.isFinite(size) || size < 1) {
    throw new RangeError(`allocateMMD: district size must be >= 1 (got ${size})`);
  }
  if (total_seats <= 0) return vote_shares.map(() => 0);

  // Compute district sizes.
  const districts: number[] = [];
  if (total_seats <= size) {
    districts.push(total_seats);
  } else {
    const full = Math.floor(total_seats / size);
    const remainder = total_seats - full * size;
    for (let i = 0; i < full; i++) districts.push(size);
    if (remainder > 0) districts.push(remainder);
  }

  // Allocate PR within each district, sum across districts.
  const totals = vote_shares.map(() => 0);
  for (const d of districts) {
    const partial = allocateN(
      { seats: d, votes: vote_shares.map((s) => s * 1_000_000) },
      'sainte-lague',
    );
    for (let i = 0; i < totals.length; i++) totals[i] += partial[i];
  }
  return totals;
}

/**
 * MMP: combine SMD and proportional-list seats.
 *
 * Algorithm:
 *   1. SMD count = round(total_seats × smdFraction). List count = total - SMD.
 *   2. SMD seats for D and R come from today's actual delegation scaled
 *      down to the SMD count: smd_d = round(actual_d / actual_total ×
 *      smd_count) (likewise R). Minors get zero SMD seats — they don't
 *      exist in today's actual House. Any rounding leftover from the
 *      SMD count goes to whichever major has the larger fractional
 *      remainder (stable tie-break to D).
 *   3. Compute target proportional seats per party: target_i = round(
 *      total_seats × vote_share_i) (with Sainte-Laguë actually, to
 *      preserve party-totals consistency).
 *   4. List allocation: each party gets max(0, target_i - smd_i) list
 *      seats. If list demand exceeds the available list count
 *      (overhang case), parties at their target get nothing more and
 *      the remaining demand is met proportionally. If list demand is
 *      below capacity (rare with the round-down behavior), the
 *      remaining list seats are allocated to the largest unmet target.
 *   5. Final per-party seats = smd_i + list_i. Total ≈ total_seats
 *      (may slightly exceed in overhang cases, which is realistic — MMP
 *      "Ausgleichsmandate" — but we cap at total_seats for cleanliness).
 */
export function allocateMMP(input: MethodAllocationInput, smdFraction: number): number[] {
  const { total_seats, vote_shares, party_ids, actual_d_seats, actual_r_seats } = input;
  const n = vote_shares.length;
  if (total_seats <= 0) return vote_shares.map(() => 0);

  const actualTotal = actual_d_seats + actual_r_seats;
  // The SMD tier is seeded from today's actual delegation. With no actual
  // delegation (0-0) there is no basis for a single-member split, so the whole
  // chamber comes from the list tier. Leaving smdCount > 0 here would strand
  // those seats: the SMD block below is skipped, and the list tier only ever
  // hands out listCount — so sum(seats) would come up short of total_seats.
  const smdCount = actualTotal > 0 ? Math.round(total_seats * smdFraction) : 0;
  const listCount = total_seats - smdCount;

  // Step 1: SMD allocation. D and R only, scaled from today's actual.
  const smd = vote_shares.map(() => 0);
  if (smdCount > 0) {
    const dIdx = party_ids.indexOf('D');
    const rIdx = party_ids.indexOf('R');
    const dExact = (actual_d_seats / actualTotal) * smdCount;
    const rExact = (actual_r_seats / actualTotal) * smdCount;
    let dSmd = Math.floor(dExact);
    let rSmd = Math.floor(rExact);
    let leftover = smdCount - dSmd - rSmd;
    // Distribute leftover by larger fractional remainder; ties → D.
    while (leftover > 0) {
      const dFrac = dExact - dSmd;
      const rFrac = rExact - rSmd;
      if (dFrac >= rFrac) dSmd++;
      else rSmd++;
      leftover--;
    }
    if (dIdx >= 0) smd[dIdx] = dSmd;
    if (rIdx >= 0) smd[rIdx] = rSmd;
  }

  // Step 2: proportional targets via Sainte-Laguë over the full N total.
  const target = allocateN(
    { seats: total_seats, votes: vote_shares.map((s) => s * 1_000_000) },
    'sainte-lague',
  );

  // Step 3: list demand per party.
  const list = vote_shares.map(() => 0);
  const demand = target.map((t, i) => Math.max(0, t - smd[i]));
  const totalDemand = demand.reduce((a, b) => a + b, 0);

  if (totalDemand <= listCount) {
    // No overhang: every party gets exactly its demand. Spare seats (if
    // any) go to parties with the largest unmet remainder of the next
    // proportional round — rare, so just keep them with the highest
    // vote share via Sainte-Laguë over remaining seats.
    for (let i = 0; i < n; i++) list[i] = demand[i];
    let spare = listCount - totalDemand;
    if (spare > 0) {
      const spareAllocation = allocateN(
        { seats: spare, votes: vote_shares.map((s) => s * 1_000_000) },
        'sainte-lague',
      );
      for (let i = 0; i < n; i++) list[i] += spareAllocation[i];
    }
  } else {
    // Overhang: total demand exceeds list count. Allocate list seats
    // proportionally to demand using Sainte-Laguë so the seat-cap is
    // hit while staying proportional to who needs catch-up. Parties
    // whose SMD already exceeded their target (demand=0) get nothing.
    const listAlloc = allocateN(
      { seats: listCount, votes: demand },
      'sainte-lague',
    );
    for (let i = 0; i < n; i++) list[i] = listAlloc[i];
  }

  return smd.map((s, i) => s + list[i]);
}

/**
 * Optional overrides that let the Sandbox dial a non-preset district
 * magnitude (MMD) or single-member share (MMP) without inventing a new
 * `AllocationMethodKind` for every value. When omitted, each method uses
 * its canonical preset (MMD-3 → 3, MMD-5 → 5, MMP-50 → 0.5).
 */
export interface MethodParams {
  /** District magnitude for MMD methods. */
  mmdMagnitude?: number;
  /** Single-member-district fraction (0..1) for MMP. */
  mmpSmdShare?: number;
}

/** Single entry point: dispatch by method id, with optional param overrides. */
export function allocateByMethod(
  input: MethodAllocationInput,
  method: AllocationMethodKind,
  params?: MethodParams,
): number[] {
  switch (method) {
    case 'PR':
      return allocatePR(input, 'sainte-lague');
    case 'PR-DH':
      return allocatePR(input, 'dhondt');
    case 'PR-HAM':
      return allocatePR(input, 'hamilton');
    case 'MMD-3':
      return allocateMMD(input, params?.mmdMagnitude ?? 3);
    case 'MMD-5':
      return allocateMMD(input, params?.mmdMagnitude ?? 5);
    case 'MMP-50':
      return allocateMMP(input, params?.mmpSmdShare ?? 0.5);
  }
}

/** Allocation "family" — a method ignoring its specific magnitude/share. */
export type MethodFamily = 'PR' | 'PR-DH' | 'PR-HAM' | 'MMD' | 'MMP';

/**
 * The effective allocation in play, resolved from the picked preset plus
 * any slider override. `canonicalKey` is the matching preset method when
 * the (family, param) pair is one of the named presets (MMD-3/MMD-5/MMP-50
 * or a PR variant), or `null` when the user has dialed an off-grid value
 * (e.g. MMD-4, MMP-30). The Sandbox UI and comparison table use this to
 * decide what to highlight and whether to show a custom "current" row.
 */
export interface EffectiveMethod {
  family: MethodFamily;
  /** District magnitude when family === 'MMD'. */
  size?: number;
  /** Single-member share (0..1) when family === 'MMP'. */
  smdShare?: number;
  /** Display label, e.g. "MMD-4", "MMP-30", or the canonical METHOD_LABELS value. */
  label: string;
  /** Matching preset method, or null when off-grid. */
  canonicalKey: AllocationMethodKind | null;
}

/**
 * Resolve the picked method + optional magnitude/SMD-share overrides into
 * a single descriptor the UI can derive everything from. Pass `null`/
 * `undefined` overrides to get the preset's canonical value.
 */
export function resolveEffectiveMethod(
  method: AllocationMethodKind,
  mmdMagnitude?: number | null,
  mmpSmdShare?: number | null,
): EffectiveMethod {
  switch (method) {
    case 'PR':
    case 'PR-DH':
    case 'PR-HAM':
      return { family: method, label: METHOD_LABELS[method], canonicalKey: method };
    case 'MMD-3':
    case 'MMD-5': {
      const size = mmdMagnitude ?? (method === 'MMD-5' ? 5 : 3);
      const canonicalKey: AllocationMethodKind | null =
        size === 3 ? 'MMD-3' : size === 5 ? 'MMD-5' : null;
      return { family: 'MMD', size, label: `MMD-${size}`, canonicalKey };
    }
    case 'MMP-50': {
      const smdShare = mmpSmdShare ?? 0.5;
      const pct = Math.round(smdShare * 100);
      const canonicalKey: AllocationMethodKind | null = pct === 50 ? 'MMP-50' : null;
      return { family: 'MMP', smdShare, label: `MMP-${pct}`, canonicalKey };
    }
  }
}
