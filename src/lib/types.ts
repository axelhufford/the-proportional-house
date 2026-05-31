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
