import { describe, expect, it } from 'vitest';
import { computeHemicycleSeats } from './hemicycle';

describe('computeHemicycleSeats', () => {
  it('returns exactly `total` seats for a range of chamber sizes', () => {
    for (const total of [1, 50, 100, 435, 593]) {
      expect(computeHemicycleSeats(total).seats.length).toBe(total);
    }
  });

  it('handles the empty/zero case without throwing', () => {
    const layout = computeHemicycleSeats(0);
    expect(layout.seats).toEqual([]);
    expect(layout.width).toBeGreaterThan(0);
  });

  it('keeps every seat inside the viewBox with finite coordinates', () => {
    const layout = computeHemicycleSeats(435);
    for (const s of layout.seats) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(layout.width);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(layout.height);
    }
  });

  it('orders seats left→right so a party fills a contiguous wedge', () => {
    const layout = computeHemicycleSeats(435);
    const first = layout.seats[0];
    const last = layout.seats[layout.seats.length - 1];
    // First seat is on the left half, last is on the right half of the arc.
    expect(first.x).toBeLessThan(layout.cx);
    expect(last.x).toBeGreaterThan(layout.cx);
  });
});
