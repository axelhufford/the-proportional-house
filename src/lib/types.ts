export interface ProjectionMeta {
  generated_at: string;
  /**
   * Age (hours) past which the site shows its "data may be stale" banner.
   * Published by the pipeline so the threshold lives in one place; optional
   * because an older cached payload predates the field.
   */
  stale_after_hours?: number;
  data_source: string;
  method: string;
  generic_ballot_margin: number;
  baseline_2024_margin: number;
  baseline_2024_r_margin?: number;
  swing: number;
  n_polls_in_average?: number;
  poll_window_days?: number;
  poll_half_life_days?: number;
  /**
   * Polling-error sensitivity band: the projection re-run at swing ± ε.
   * A sensitivity range, not a probability. Only valid at the shipped
   * swing — recomputeWithSwing strips it, and the UI renders it only on
   * the Current view. Absent until the pipeline's curated polling-error
   * table is verified (data-pipeline/baseline/polling_error.json).
   */
  uncertainty?: UncertaintyBand;
  /**
   * Majority tipping point + closest seats to flip. Like `uncertainty`,
   * only valid at the shipped swing (recomputeWithSwing strips them) and
   * absent until the pipeline emits them.
   */
  majority?: MajorityTipping;
  closest_flips?: ClosestFlip[];
  /**
   * The generic-ballot averages the site offers a toggle between. Always leads
   * with `standard`, whose fields mirror the top-level ones above — those stay
   * authoritative for the public API and any consumer that predates the
   * toggle. Optional because a cached payload may predate it; `lib/ballotVariant`
   * falls back to a synthesized standard variant when it's missing.
   */
  ballot_variants?: BallotVariant[];
  /**
   * Which variant this payload has been projected at, stamped client-side by
   * `applyVariant`. Never published by the pipeline, and absent on the default
   * variant (whose payload is returned untouched) — so anything reading it
   * treats absence as "the standard average". Lets downstream consumers like
   * the share card label the number without threading a prop through every
   * component between here and them.
   */
  active_ballot_variant?: BallotVariant;
}

/**
 * One generic-ballot average, plus everything derived from it that the browser
 * cannot re-derive on its own.
 *
 * The per-state seats at this variant's margin ARE re-derivable in the browser
 * (see `recomputeWithSwing`), so they aren't published per variant. The band,
 * tipping point and closest-flips list are not — each is only meaningful at the
 * swing it was computed for — so the pipeline ships them here.
 */
export interface BallotVariant {
  /** Stable key, also the `?avg=` URL value. `standard` is the default. */
  id: string;
  /** Full name, e.g. "Likely-voter polls only". */
  label: string;
  /** Compact form for the toggle itself, e.g. "LV only". */
  short_label: string;
  /** One-sentence description of what's in this average, shown next to the toggle. */
  note: string;
  /** D-margin in points (positive = D lead). */
  margin: number;
  /** margin − baseline_2024_margin. */
  swing: number;
  n_polls: number;
  /** Voter screens included, e.g. ["LV"]; null when unfiltered. */
  populations: string[] | null;
  projected: SeatSplit;
  uncertainty?: UncertaintyBand;
  majority?: MajorityTipping;
  closest_flips?: ClosestFlip[];
}

export interface UncertaintyBand {
  /** Historical ± polling-average miss, in margin points (e.g. 2.2). */
  epsilon_points: number;
  /** One-line citation for how epsilon was derived. */
  basis: string;
  /** D seats at swing − ε. */
  d_seats_low: number;
  /** D seats at swing + ε. */
  d_seats_high: number;
  r_seats_low: number;
  r_seats_high: number;
}

export interface MajorityTipping {
  /** Generic-ballot D-margin at which projected D seats first reach a majority. */
  tipping_margin: number;
  /** Seats needed for control (218 of 435). */
  majority_seats: number;
}

export interface ClosestFlip {
  fips: string;
  code: string;
  name: string;
  /** Which party gains the next seat as the national margin moves its way. */
  direction: 'D' | 'R';
  /** Points of national-margin movement toward `direction` needed to flip it. */
  margin_delta: number;
  /** Absolute generic-ballot D-margin at which the flip happens. */
  flips_at_margin: number;
}

export interface SeatSplit {
  d_seats: number;
  r_seats: number;
}

export interface VoteShare {
  d_share: number;
  r_share: number;
}

export interface StateProjection {
  fips: string;
  code: string;
  name: string;
  seats: number;
  actual: SeatSplit;
  baseline_2024: VoteShare;
  projected: VoteShare & SeatSplit;
  state_elasticity?: number;
  state_swing_applied?: number;
  baseline_distortion_warning?: boolean;
  imputed_district_count?: number;
  imputed_district_ids?: string[];
}

export interface NationalTotals {
  seats: number;
  projected: SeatSplit;
  actual: SeatSplit;
}

export interface ProjectionPayload {
  meta: ProjectionMeta;
  national: NationalTotals;
  states: StateProjection[];
}

export type ViewMode = 'current' | 'retrospective' | 'sandbox';
export type ColorMode = 'balance' | 'distortion';

// --- Multi-cycle retrospectives (public/data/retrospectives.json) ---
// PR-vs-actual for each of the most recent completed House cycles. Each cycle's
// per-state record is adapted into a ProjectionPayload (see lib/retrospective.ts)
// so the existing map / scoreboard / state-detail render it unchanged.
export interface RetroCycleState {
  fips: string;
  code: string;
  name: string;
  seats: number;
  actual: SeatSplit;
  projected_pr: SeatSplit;
  two_party_share: VoteShare;
  baseline_distortion_warning?: boolean;
  uncontested_district_count?: number;
}
export interface RetroCycleNational {
  seats: number;
  projected_pr: SeatSplit;
  actual: SeatSplit;
  /** National two-party House popular-vote margin (D − R, points); null if absent. */
  popular_vote_d_margin: number | null;
}
export interface RetroCyclePayload {
  national: RetroCycleNational;
  states: RetroCycleState[];
}
export interface RetroSeriesPoint {
  year: number;
  seats: number;
  actual: SeatSplit;
  projected_pr: SeatSplit;
  /** PR D seats − actual D seats (positive = PR favors Democrats). */
  d_gain: number;
}
export interface RetrospectivesPayload {
  meta: { generated_at: string; cycles: number[]; method: string; sources: Record<string, string> };
  cycles: Record<string, RetroCyclePayload>;
  series: RetroSeriesPoint[];
}

// One day's snapshot of the live Current projection, accumulated by the daily
// pipeline into public/data/history.json so the site can chart how the
// projection has moved over time.
export interface HistoryPoint {
  /** UTC calendar date, YYYY-MM-DD. */
  date: string;
  projected_d: number;
  projected_r: number;
  actual_d: number;
  actual_r: number;
  /** Generic-ballot margin that day (positive = D advantage). */
  generic_ballot_margin: number;
  /** Swing vs. the 2024 baseline that day. */
  swing: number;
  /**
   * True for hindcast points reconstructed from the poll archive (the current
   * model run as-of that date) rather than live daily snapshots. Absent/false
   * on forward-collected points. See Methodology → Assumptions and limitations.
   */
  reconstructed?: boolean;
  /**
   * National seats under the alternative allocation methods at this date,
   * precomputed by the pipeline from the same swing (Pure-PR stays the
   * top-level projected_d/projected_r). Keyed by method id ('MMD-3', 'MMD-5',
   * 'MMP-50'). Absent on legacy points until the next pipeline run rebuilds.
   */
  methods?: Record<string, { d: number; r: number }>;
}
export interface HistoryPayload {
  meta: { generated_at: string };
  points: HistoryPoint[];
}

// --- Proportional Electoral College (1976-2024) ---------------------------
// public/data/electoral_college.json, built offline by build_electoral_college.py.
export type ECParty = 'D' | 'R' | 'O';

export interface ECCandidate {
  name: string;
  party: ECParty;
  votes: number;
  /** Electors under the canonical (Sainte-Laguë) proportional allocation. */
  electors: number;
}

export interface ECStateResult {
  code: string;
  name: string;
  ev: number;
  actual_winner_party: ECParty;
  /** Maine/Nebraska district split for the actual result, else null. */
  actual_split: Record<string, number> | null;
  candidates: ECCandidate[];
}

export interface ECCycle {
  year: number;
  total_ev: number;
  majority: number;
  actual: { by_party: Record<ECParty, number>; winner_party: ECParty };
  proportional: {
    by_party: Record<ECParty, number>;
    by_candidate: { name: string; party: ECParty; electors: number }[];
    leader: { name: string; party: ECParty; electors: number };
    no_majority: boolean;
    majority_gap: number;
  };
  states: ECStateResult[];
}

export interface ECSeriesPoint {
  year: number;
  no_majority: boolean;
  pr_d: number;
  pr_r: number;
  pr_other: number;
  actual_d: number;
  actual_r: number;
  leader_party: ECParty;
  leader_electors: number;
}

export interface ElectoralCollegePayload {
  meta: {
    generated_at: string;
    canonical_method: string;
    majority: number;
    cycles: number[];
    sources: Record<string, string>;
    note: string;
  };
  cycles: Record<string, ECCycle>;
  series: ECSeriesPoint[];
}

// --- Senate malapportionment ----------------------------------------------
// public/data/senate.json, built offline from the 2020 Census by build_senate.py.
export interface SenateState {
  fips: string;
  code: string;
  name: string;
  population: number;
  senators: number;
  people_per_senator: number;
  /** National avg people-per-senator ÷ this state's; >1 = overrepresented. */
  representation_index: number;
}

export interface SenatePayload {
  meta: {
    generated_at: string;
    source: string;
    source_url?: string;
    census_year: number;
    total_population: number;
    total_senators: number;
    national_people_per_senator: number;
    most_overrepresented: string;
    most_underrepresented: string;
    ratio_extremes: number;
  };
  states: SenateState[];
  /** Smallest states whose senators add up to a 51-seat majority. */
  majority: {
    states_needed: number;
    senators: number;
    population: number;
    population_share: number;
    state_codes: string[];
  };
}

// --- Federal circuits -------------------------------------------------------
// public/data/circuits.json, built offline by build_circuits.py.
export interface Circuit {
  id: string;
  label: string;
  states: string[];
  population: number;
  active_judges: number;
  senior_judges: number;
}

export interface CircuitsGroup {
  circuits: Circuit[];
  by_state: Record<string, string>; // state code → circuit id
  disparity: {
    max: { label: string; population: number };
    min: { label: string; population: number };
    ratio: number;
  };
}

export interface CircuitsPayload {
  meta: {
    generated_at: string;
    judgeships_source: string;
    composition_source: string;
    population_source: string;
    senior_judges_source: string;
    senior_judges_as_of: string;
    total_population: number;
    total_active_judges: number;
    total_senior_judges: number;
    note: string;
  };
  current: CircuitsGroup;
  rebalanced: CircuitsGroup;
}

/**
 * Live chamber composition — public/data/house_composition.json.
 *
 * This is who holds the House *today*, vacancies included. It is deliberately
 * NOT the projection baseline: `StateProjection.actual` stays the November 2024
 * election result, so the headline seat-gap can't move because a member
 * resigned. Party attribution follows each member's caucus.
 *
 * Everything that reads this must treat it as optional — the Clerk feed can be
 * unavailable, and an older cached deploy won't have the file at all.
 */
export interface HouseCompositionState {
  code: string;
  fips: string;
  name: string;
  /** Apportioned seats — equals d + r + other + vacant. */
  seats: number;
  d_seats: number;
  r_seats: number;
  other_seats: number;
  vacant: number;
}

export interface HouseVacancy {
  code: string;
  name: string;
  /** Ordinal district label from the Clerk, e.g. "14th" or "At Large". */
  district: string;
  /** The Clerk's stated cause, e.g. "Vacancy due to the resignation of …". */
  reason: string;
}

export interface HouseCompositionPayload {
  meta: {
    generated_at: string;
    congress: number | null;
    /** Clerk publish date for the member list, e.g. "July 6, 2026". */
    publish_date: string;
    source: string;
    source_url: string;
    note: string;
  };
  national: {
    d_seats: number;
    r_seats: number;
    other_seats: number;
    vacant: number;
    total_seats: number;
  };
  states: HouseCompositionState[];
  vacancies: HouseVacancy[];
}

// One completed cycle's PR-vs-actual outcome for a single state, derived from
// retrospectives.json for the per-state "Under PR, 2016–2024" mini-history.
export interface StateRetroPoint {
  year: number;
  actual_d: number;
  actual_r: number;
  pr_d: number;
  pr_r: number;
  /** PR D seats − actual D seats (positive = PR favors Democrats). */
  d_gain: number;
}
