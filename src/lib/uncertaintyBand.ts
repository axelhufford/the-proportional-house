/**
 * Turns the shipped polling-error sensitivity band into the hero's range
 * sentence. Pure presentation math: the band itself is computed by the
 * pipeline (projection re-run at swing ± ε) and shipped in meta.uncertainty.
 *
 * Shifts are D-positive, the same convention as the hero's dGain: a shift
 * of +19 means "19 seats toward Democrats relative to today's House".
 */
import type { UncertaintyBand } from './types';

export interface SeatShiftBand {
  /** Shift at swing − ε (D seats minus today's actual D seats). */
  lowShift: number;
  /** Shift at swing + ε. */
  highShift: number;
  /** True when ε moves so few seats the band collapses to a point. */
  degenerate: boolean;
}

/** Convert the seat band into shift-vs-today terms (the hero's frame). */
export function seatShiftBand(band: UncertaintyBand, actualDSeats: number): SeatShiftBand {
  const lowShift = band.d_seats_low - actualDSeats;
  const highShift = band.d_seats_high - actualDSeats;
  return { lowShift, highShift, degenerate: lowShift === highShift };
}

function seats(n: number): string {
  return n === 1 ? 'seat' : 'seats';
}

/**
 * The clause completing "If the polls miss by the historical ±ε points, …".
 * Covers both-D, both-R, sign-crossing, zero-endpoint, and degenerate bands.
 */
export function describeSeatShiftBand(b: SeatShiftBand): string {
  const { lowShift: lo, highShift: hi } = b;

  if (b.degenerate) {
    if (lo === 0) return 'the projection barely moves — still no net shift';
    const party = lo > 0 ? 'Democrats' : 'Republicans';
    const n = Math.abs(lo);
    return `the projection barely moves — still about ${n} ${seats(n)} toward ${party}`;
  }

  if (lo > 0) {
    // Entire band toward D (lo < hi numerically ⇒ magnitudes ordered).
    return `the shift lands anywhere between ${lo} and ${hi} seats toward Democrats`;
  }
  if (hi < 0) {
    // Entire band toward R: magnitudes flip (hi is the smaller miss).
    return `the shift lands anywhere between ${Math.abs(hi)} and ${Math.abs(lo)} seats toward Republicans`;
  }
  if (lo === 0) {
    return `the shift lands anywhere from no net shift to ${hi} ${seats(hi)} toward Democrats`;
  }
  if (hi === 0) {
    return `the shift lands anywhere from ${Math.abs(lo)} ${seats(Math.abs(lo))} toward Republicans to no net shift`;
  }
  // Sign crossing: lo < 0 < hi.
  return `the shift lands anywhere from ${Math.abs(lo)} ${seats(Math.abs(lo))} toward Republicans to ${hi} toward Democrats`;
}
