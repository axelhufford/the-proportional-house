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
  baseline_distortion_warning?: boolean;
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
