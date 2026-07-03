import { describe, expect, it } from 'vitest';
import type { HistoryPoint } from './types';
import { computeWeeklyDelta } from './weeklyDelta';

/** Forward history point with only the fields the delta reads varying. */
function pt(date: string, projectedD: number, margin: number, reconstructed = false): HistoryPoint {
  return {
    date,
    projected_d: projectedD,
    projected_r: 435 - projectedD,
    actual_d: 215,
    actual_r: 220,
    generic_ballot_margin: margin,
    swing: 0,
    reconstructed,
  };
}

/** N consecutive daily forward points ending 2026-06-19, linear D ramp. */
function dailyRun(days: number, endD: number, endMargin: number): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.parse('2026-06-19T00:00:00Z') - i * 86_400_000);
    out.push(pt(d.toISOString().slice(0, 10), endD - i, endMargin - i * 0.1));
  }
  return out;
}

describe('computeWeeklyDelta', () => {
  it('returns null on empty or single-point history', () => {
    expect(computeWeeklyDelta([])).toBeNull();
    expect(computeWeeklyDelta([pt('2026-06-19', 234, 6.9)])).toBeNull();
  });

  it('picks the exact 7-day baseline from a full daily run', () => {
    const points = dailyRun(8, 234, 6.9);
    const delta = computeWeeklyDelta(points);
    expect(delta).not.toBeNull();
    expect(delta!.days).toBe(7);
    expect(delta!.fromDate).toBe('2026-06-12');
    expect(delta!.toDate).toBe('2026-06-19');
    expect(delta!.seatDelta).toBe(7);
    expect(delta!.marginFrom).toBeCloseTo(6.2, 6);
    expect(delta!.marginTo).toBeCloseTo(6.9, 6);
  });

  it('with gaps, picks the candidate closest to 7 days (6 beats 9)', () => {
    const points = [
      pt('2026-06-10', 230, 6.0), // 9 days back
      pt('2026-06-13', 232, 6.4), // 6 days back
      pt('2026-06-19', 234, 6.9),
    ];
    const delta = computeWeeklyDelta(points)!;
    expect(delta.days).toBe(6);
    expect(delta.fromDate).toBe('2026-06-13');
  });

  it('breaks a distance tie toward the longer span (8 beats 6)', () => {
    const points = [
      pt('2026-06-11', 231, 6.2), // 8 days back
      pt('2026-06-13', 232, 6.4), // 6 days back
      pt('2026-06-19', 234, 6.9),
    ];
    const delta = computeWeeklyDelta(points)!;
    expect(delta.days).toBe(8);
    expect(delta.fromDate).toBe('2026-06-11');
  });

  it('accepts the window edges (5 and 10 days) but nothing outside', () => {
    expect(computeWeeklyDelta([pt('2026-06-14', 232, 6.4), pt('2026-06-19', 234, 6.9)])!.days).toBe(5);
    expect(computeWeeklyDelta([pt('2026-06-09', 230, 6.0), pt('2026-06-19', 234, 6.9)])!.days).toBe(10);
    expect(
      computeWeeklyDelta([
        pt('2026-06-08', 229, 5.9), // 11 days back
        pt('2026-06-15', 233, 6.5), // 4 days back
        pt('2026-06-19', 234, 6.9),
      ]),
    ).toBeNull();
  });

  it('returns null when the last point is reconstructed', () => {
    const points = [pt('2026-06-12', 232, 6.4), pt('2026-06-19', 234, 6.9, true)];
    expect(computeWeeklyDelta(points)).toBeNull();
  });

  it('returns null on an all-reconstructed history', () => {
    const points = dailyRun(10, 234, 6.9).map((p) => ({ ...p, reconstructed: true }));
    expect(computeWeeklyDelta(points)).toBeNull();
  });

  it('returns null when every in-window point is reconstructed (young forward history)', () => {
    const points = [
      pt('2026-06-11', 231, 6.2, true),
      pt('2026-06-12', 232, 6.4, true),
      pt('2026-06-17', 233, 6.6), // 2 days back — outside window
      pt('2026-06-18', 233, 6.7),
      pt('2026-06-19', 234, 6.9),
    ];
    expect(computeWeeklyDelta(points)).toBeNull();
  });

  it('skips a reconstructed point inside the window in favor of a forward one', () => {
    const points = [
      pt('2026-06-10', 230, 6.0), // forward, 9 days back
      pt('2026-06-12', 232, 6.4, true), // reconstructed at exactly 7 days
      pt('2026-06-19', 234, 6.9),
    ];
    const delta = computeWeeklyDelta(points)!;
    expect(delta.days).toBe(9);
    expect(delta.fromDate).toBe('2026-06-10');
  });

  it('returns a zero delta rather than null when nothing moved', () => {
    const points = [pt('2026-06-12', 234, 6.9), pt('2026-06-19', 234, 6.9)];
    const delta = computeWeeklyDelta(points)!;
    expect(delta.seatDelta).toBe(0);
  });

  it('reports R-ward movement as a negative seatDelta', () => {
    const points = [pt('2026-06-12', 236, 7.4), pt('2026-06-19', 234, 6.9)];
    expect(computeWeeklyDelta(points)!.seatDelta).toBe(-2);
  });
});
