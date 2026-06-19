export interface ProjectionMeta {
  generated_at: string;
  data_source: string;
  method: string;
  generic_ballot_margin: number;
  baseline_2024_margin: number;
  baseline_2024_r_margin?: number;
  swing: number;
  n_polls_in_average?: number;
  poll_window_days?: number;
  poll_half_life_days?: number;
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
