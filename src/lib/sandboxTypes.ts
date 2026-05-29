/**
 * Parallel type system for Sandbox extended (N-party) mode.
 *
 * The canonical `ProjectionPayload` in `./types.ts` stays strictly
 * two-party so the existing Current / Retrospective views, public API v1,
 * pipeline, and share assets are untouched. When Sandbox has one or two
 * minor parties active, components consuming this parallel shape render
 * the N-party variant; otherwise they fall back to the existing two-party
 * path.
 *
 * These types are designed to be promoted to canonical in a future v2
 * if/when the pipeline emits real third-party data. Naming and shapes
 * are intentionally generic.
 */
import type { AllocationMethodKind } from './methods';
import type { ProjectionMeta } from './types';

/** Two-letter or short identifier. 'D'/'R' are canonical; minors get 'PROG', 'AF', 'CUSTOM-xxxx'. */
export type PartyId = string;

export interface Party {
  id: PartyId;
  label: string;
  /** Hex color string, used by Map plurality coloring and SeatStrip segments. */
  color: string;
  /**
   * Where this party's votes come from when added to the sandbox.
   * Sums to 1.0 across { D, R }. For D and R themselves: { D:1, R:0 } and
   * { D:0, R:1 }. A Progressive Left preset is e.g. { D:0.85, R:0.15 }.
   *
   * Minor parties draw only from the two majors in v1 — not from each
   * other. The math in `sandboxSwing.ts` applies each minor's subtraction
   * to the still-unmodified D/R baseline.
   */
  draw_from: { D: number; R: number };
}

export interface PartyShare {
  party: Party;
  /** [0, 1]; the party's share of the state's two-party vote total. */
  vote_share: number;
  /** Computed after running allocateN over all parties in the state. */
  seats: number;
}

export interface SandboxStateProjection {
  fips: string;
  code: string;
  name: string;
  total_seats: number;
  /**
   * Ordered: D, R, then minors in the order added to the sandbox.
   * Shares sum to 1.0 (after threshold filtering + renormalization).
   * Seats sum to total_seats.
   */
  parties: PartyShare[];
  /**
   * Today's actual D/R delegation, scaled to `total_seats` (the projected,
   * possibly-expanded House size). Equals the raw 435-seat actual when the
   * House isn't expanded. This is the correct, like-for-like baseline for
   * "shift under PR" comparisons — subtracting it from the projected seats
   * isolates the allocation distortion from chamber growth, and is exactly
   * zero-sum (d_seats + r_seats === total_seats).
   */
  actual_scaled: { d_seats: number; r_seats: number };
}

export interface SandboxPayload {
  meta: ProjectionMeta;
  /** [0, 0.10]; applied per-state before allocation. */
  threshold: number;
  /** Allocation method used to compute seats from shares. */
  method: AllocationMethodKind;
  /** Total House size — 435 by default; ≠ 435 means seats were reapportioned via Huntington-Hill. */
  house_size: number;
  /**
   * Active minor parties — 0, 1, or 2 entries. When empty, callers
   * shouldn't bother building a SandboxPayload; they can stay on the
   * existing two-party rendering path.
   */
  minors: Party[];
  national: {
    total_seats: number;
    /** Aggregated party totals; same order as state.parties. */
    parties: PartyShare[];
    /**
     * Today's actual national D/R delegation, scaled to `total_seats` (sum of
     * the per-state `actual_scaled`). The like-for-like baseline for the
     * national "Difference under PR" — d_seats + r_seats === total_seats.
     */
    actual_scaled: { d_seats: number; r_seats: number };
  };
  states: SandboxStateProjection[];
}
