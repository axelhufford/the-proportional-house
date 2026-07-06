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
import type { HistoryPayload, ProjectionPayload } from './types';

export const API_VERSION = 'v1';

/** Methods carried in the v1 history series, in stable display order. */
export const API_HISTORY_METHODS = ['PR', 'MMD-3', 'MMD-5', 'MMP-50'] as const;

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

/**
 * Polling-error sensitivity band: the projection re-run at swing ± ε.
 * A sensitivity range, not a probability. Additive/optional — absent
 * when the pipeline hasn't shipped a band, so v1 consumers that predate
 * it are unaffected.
 */
export interface ApiV1ProjectedRange {
  /** Historical ± polling-average miss, in margin points. */
  epsilon_points: number;
  /** One-line citation for how epsilon was derived. */
  basis: string;
  D: { low: number; high: number };
  R: { low: number; high: number };
}

/** Generic-ballot D-margin at which projected House control flips. */
export interface ApiV1MajorityTipping {
  tipping_margin: number;
  majority_seats: number;
}

/** A seat close to flipping as the national margin moves. */
export interface ApiV1ClosestFlip {
  code: string;
  name: string;
  fips: string;
  direction: 'D' | 'R';
  /** Points of national-margin movement toward `direction` needed. */
  margin_delta: number;
  /** Absolute D-margin at which it flips. */
  flips_at_margin: number;
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
    /** Optional sensitivity band; key omitted when the data lacks one. */
    projected_range?: ApiV1ProjectedRange;
    /** Optional majority tipping point; key omitted when absent. */
    majority_tipping?: ApiV1MajorityTipping;
  };
  /** Optional closest-seats-to-flip list; key omitted when absent. */
  closest_flips?: ApiV1ClosestFlip[];
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
      // Conditional spread so the key is OMITTED (not null) when absent —
      // the shape existing v1 consumers already see.
      ...(meta.uncertainty
        ? {
            projected_range: {
              epsilon_points: meta.uncertainty.epsilon_points,
              basis: meta.uncertainty.basis,
              D: { low: meta.uncertainty.d_seats_low, high: meta.uncertainty.d_seats_high },
              R: { low: meta.uncertainty.r_seats_low, high: meta.uncertainty.r_seats_high },
            },
          }
        : {}),
      ...(meta.majority
        ? {
            majority_tipping: {
              tipping_margin: meta.majority.tipping_margin,
              majority_seats: meta.majority.majority_seats,
            },
          }
        : {}),
    },
    ...(meta.closest_flips && meta.closest_flips.length > 0
      ? {
          closest_flips: meta.closest_flips.map((c) => ({
            code: c.code,
            name: c.name,
            fips: c.fips,
            direction: c.direction,
            margin_delta: c.margin_delta,
            flips_at_margin: c.flips_at_margin,
          })),
        }
      : {}),
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

// --- v1 history (projection-over-time) -------------------------------------
// Served at /api/v1/history.json. Additive to the v1 surface — does NOT touch
// the projection shape above, so existing consumers are unaffected.

export interface ApiV1HistoryPoint {
  /** UTC calendar date, YYYY-MM-DD. */
  date: string;
  /** True for hindcast points reconstructed from the poll archive. */
  reconstructed: boolean;
  /** Generic-ballot margin that day (positive = D). */
  generic_ballot_margin: number;
  /** Swing vs. the 2024 baseline that day. */
  swing: number;
  /**
   * Projected national delegation that day, keyed by allocation method
   * (`PR`, `MMD-3`, `MMD-5`, `MMP-50`). `PR` is always present; the
   * alternative methods are present once the pipeline has computed them.
   */
  seats: Record<string, { D: number; R: number }>;
}

export interface ApiV1HistoryPayload {
  api_version: typeof API_VERSION;
  /** ISO 8601 timestamp of when the history was last rebuilt. */
  generated_at: string;
  /** Total House seats (the series holds the chamber size fixed). */
  total_seats: number;
  /** Methods carried in `points[].seats`, in display order. */
  methods: string[];
  points: ApiV1HistoryPoint[];
}

/**
 * Transform the internal `HistoryPayload` into the public v1 history shape.
 * Pure function. Pure-PR comes from each point's top-level projected_d/_r;
 * the alternative methods come from the optional `methods` block.
 */
export function toApiV1History(payload: HistoryPayload): ApiV1HistoryPayload {
  return {
    api_version: API_VERSION,
    generated_at: payload.meta.generated_at,
    total_seats: 435,
    methods: [...API_HISTORY_METHODS],
    points: payload.points.map((p) => {
      const seats: Record<string, { D: number; R: number }> = {
        PR: { D: p.projected_d, R: p.projected_r },
      };
      if (p.methods) {
        for (const m of API_HISTORY_METHODS) {
          if (m === 'PR') continue;
          const v = p.methods[m];
          if (v) seats[m] = { D: v.d, R: v.r };
        }
      }
      return {
        date: p.date,
        reconstructed: p.reconstructed === true,
        generic_ballot_margin: p.generic_ballot_margin,
        swing: p.swing,
        seats,
      };
    }),
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
