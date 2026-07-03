/**
 * "Since last week" movement of the Current projection, computed from the
 * history.json series the site already ships. Powers the hero delta chip.
 *
 * Anchored on the LAST point's date rather than the wall clock: if the
 * pipeline stalls, the chip keeps describing the last published week (the
 * global stale-data banner owns staleness). Only forward (non-reconstructed)
 * points participate — a hindcast was never published, so "since last week"
 * must not compare against one.
 */
import type { HistoryPoint } from './types';

export const DELTA_TARGET_DAYS = 7;
export const DELTA_MIN_DAYS = 5;
export const DELTA_MAX_DAYS = 10;

export interface WeeklyDelta {
  /** projected_d change, last − baseline. Positive = toward D. */
  seatDelta: number;
  /** Baseline generic-ballot margin (raw; format with fmtMargin). */
  marginFrom: number;
  /** Last point's generic-ballot margin (raw). */
  marginTo: number;
  /** Baseline date, YYYY-MM-DD (UTC). */
  fromDate: string;
  /** Last point's date, YYYY-MM-DD (UTC). */
  toDate: string;
  /** Actual span in days, within [DELTA_MIN_DAYS, DELTA_MAX_DAYS]. */
  days: number;
}

const MS_PER_DAY = 86_400_000;

function utcMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/**
 * Compare the latest forward point against the forward point closest to a
 * week earlier (within [5, 10] days; ties prefer the longer span so the
 * chip never understates the window). Returns null when no honest
 * comparison exists: short history, reconstructed-only data, or no forward
 * baseline in the window.
 */
export function computeWeeklyDelta(points: HistoryPoint[]): WeeklyDelta | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  if (last.reconstructed) return null;

  const lastMs = utcMs(last.date);
  if (Number.isNaN(lastMs)) return null;

  let baseline: HistoryPoint | null = null;
  let baselineDays = 0;
  for (let i = points.length - 2; i >= 0; i--) {
    const p = points[i];
    if (p.reconstructed) continue;
    const ms = utcMs(p.date);
    if (Number.isNaN(ms)) continue;
    const days = Math.round((lastMs - ms) / MS_PER_DAY);
    if (days < DELTA_MIN_DAYS || days > DELTA_MAX_DAYS) continue;
    const better =
      baseline === null ||
      Math.abs(days - DELTA_TARGET_DAYS) < Math.abs(baselineDays - DELTA_TARGET_DAYS) ||
      (Math.abs(days - DELTA_TARGET_DAYS) === Math.abs(baselineDays - DELTA_TARGET_DAYS) &&
        days > baselineDays);
    if (better) {
      baseline = p;
      baselineDays = days;
    }
  }
  if (!baseline) return null;

  return {
    seatDelta: last.projected_d - baseline.projected_d,
    marginFrom: baseline.generic_ballot_margin,
    marginTo: last.generic_ballot_margin,
    fromDate: baseline.date,
    toDate: last.date,
    days: baselineDays,
  };
}
