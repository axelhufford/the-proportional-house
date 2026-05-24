/**
 * Public API v1 shape.
 *
 * The internal `ProjectionPayload` shape is convenient for the in-app
 * rendering code but it leaks pipeline details (snake_case fields, optional
 * fields that exist only because the pipeline doesn't always populate them,
 * `d_share`/`r_share` instead of party-keyed objects) that we don't want
 * downstream API consumers to depend on.
 *
 * This module transforms the internal payload into a stable, documented
 * shape that the public API at `/api/v1/projection.json` and the CSV/JSON
 * download buttons both serve. If we ever need to break the shape we'll
 * publish a `/api/v2/` and keep this one running unchanged.
 */
import type { ProjectionPayload } from './types';

export const API_VERSION = 'v1';

export interface ApiV1Seats {
  D: number;
  R: number;
}

export interface ApiV1VoteShare {
  D: number;
  R: number;
}

export interface ApiV1Polling {
  /** Days of polls included in the rolling average. */
  window_days: number;
  /** Half-life (in days) of the recency weighting. */
  half_life_days: number;
  /** Number of polls in the average. */
  n_polls: number;
  /** Current generic-ballot margin in points; positive = D. */
  generic_ballot_margin: number;
  /** 2024 House two-party margin in points; positive = D. */
  baseline_2024_margin: number;
  /** Swing applied: generic_ballot_margin − baseline_2024_margin. */
  swing: number;
}

export interface ApiV1State {
  /** Two-letter postal code, e.g. "CA". */
  code: string;
  /** Full state name, e.g. "California". */
  name: string;
  /** Two-digit FIPS code, e.g. "06". */
  fips: string;
  /** Total House seats this state holds. */
  total_seats: number;
  /** Current House delegation by party. */
  actual: ApiV1Seats;
  /** Projected House delegation under PR. */
  projected: ApiV1Seats;
  /** projected.D − actual.D (positive = state shifts toward D under PR). */
  swing: number;
  /** State two-party House vote share in 2024. */
  vote_share_2024: ApiV1VoteShare;
  /** State two-party vote share used in the projection (baseline + swing). */
  vote_share_projected: ApiV1VoteShare;
}

export interface ApiV1Payload {
  api_version: typeof API_VERSION;
  /** ISO 8601 timestamp of when the pipeline last refreshed. */
  generated_at: string;
  /** Seat allocation method. Currently always "sainte-lague". */
  method: string;
  /** Polling parameters used to derive the projection. */
  polling: ApiV1Polling;
  /** Pipeline data source description. */
  data_source: string;
  national: {
    total_seats: number;
    actual: ApiV1Seats;
    projected: ApiV1Seats;
  };
  /** State-by-state breakdown, sorted alphabetically by postal code. */
  states: ApiV1State[];
}

/**
 * Transform the internal `ProjectionPayload` into the public v1 shape.
 * Pure function — no I/O, no side effects, safe to call in both the
 * Cloudflare Function and the browser.
 */
export function toApiV1(payload: ProjectionPayload): ApiV1Payload {
  const { meta, national, states } = payload;

  return {
    api_version: API_VERSION,
    generated_at: meta.generated_at,
    method: meta.method,
    data_source: meta.data_source,
    polling: {
      window_days: meta.poll_window_days ?? 30,
      half_life_days: meta.poll_half_life_days ?? 14,
      n_polls: meta.n_polls_in_average ?? 0,
      generic_ballot_margin: meta.generic_ballot_margin,
      baseline_2024_margin: meta.baseline_2024_margin,
      swing: meta.swing,
    },
    national: {
      total_seats: national.seats,
      actual: { D: national.actual.d_seats, R: national.actual.r_seats },
      projected: { D: national.projected.d_seats, R: national.projected.r_seats },
    },
    states: states
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((s) => ({
        code: s.code,
        name: s.name,
        fips: s.fips,
        total_seats: s.seats,
        actual: { D: s.actual.d_seats, R: s.actual.r_seats },
        projected: { D: s.projected.d_seats, R: s.projected.r_seats },
        swing: s.projected.d_seats - s.actual.d_seats,
        vote_share_2024: { D: s.baseline_2024.d_share, R: s.baseline_2024.r_share },
        vote_share_projected: { D: s.projected.d_share, R: s.projected.r_share },
      })),
  };
}

/**
 * Flatten the v1 payload to CSV. One row per state. Column order is
 * documented and stable — downstream consumers can rely on it.
 */
export function toApiV1Csv(payload: ProjectionPayload): string {
  const v1 = toApiV1(payload);
  const headers = [
    'code',
    'name',
    'fips',
    'total_seats',
    'actual_D',
    'actual_R',
    'projected_D',
    'projected_R',
    'swing',
    'vote_share_2024_D',
    'vote_share_2024_R',
    'vote_share_projected_D',
    'vote_share_projected_R',
  ];
  const rows = v1.states.map((s) =>
    [
      s.code,
      csvEscape(s.name),
      s.fips,
      s.total_seats,
      s.actual.D,
      s.actual.R,
      s.projected.D,
      s.projected.R,
      s.swing,
      s.vote_share_2024.D.toFixed(6),
      s.vote_share_2024.R.toFixed(6),
      s.vote_share_projected.D.toFixed(6),
      s.vote_share_projected.R.toFixed(6),
    ].join(','),
  );
  // Trailing newline matches conventional CSV output (most tools expect it).
  return [headers.join(','), ...rows].join('\n') + '\n';
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
