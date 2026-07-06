import { describe, expect, it } from 'vitest';
import type { UncertaintyBand } from './types';
import { describeSeatShiftBand, seatShiftBand } from './uncertaintyBand';

function band(dLow: number, dHigh: number): UncertaintyBand {
  return {
    epsilon_points: 2.2,
    basis: 'test',
    d_seats_low: dLow,
    d_seats_high: dHigh,
    r_seats_low: 435 - dHigh,
    r_seats_high: 435 - dLow,
  };
}

describe('seatShiftBand', () => {
  it('converts the seat band to shift-vs-today terms', () => {
    const b = seatShiftBand(band(223, 245), 215);
    expect(b).toEqual({ lowShift: 8, highShift: 30, degenerate: false });
  });

  it('flags a collapsed band as degenerate', () => {
    expect(seatShiftBand(band(234, 234), 215).degenerate).toBe(true);
  });
});

describe('describeSeatShiftBand', () => {
  it('both endpoints toward Democrats', () => {
    expect(describeSeatShiftBand(seatShiftBand(band(223, 245), 215))).toBe(
      'the shift lands anywhere between 8 and 30 seats toward Democrats',
    );
  });

  it('both endpoints toward Republicans, ordered small magnitude first', () => {
    // shifts: low −17, high −4 → "between 4 and 17 toward Republicans"
    expect(describeSeatShiftBand(seatShiftBand(band(198, 211), 215))).toBe(
      'the shift lands anywhere between 4 and 17 seats toward Republicans',
    );
  });

  it('sign crossing reads R-to-D', () => {
    // shifts: low −2, high +14
    expect(describeSeatShiftBand(seatShiftBand(band(213, 229), 215))).toBe(
      'the shift lands anywhere from 2 seats toward Republicans to 14 toward Democrats',
    );
  });

  it('singular seat on a one-seat crossing endpoint', () => {
    // shifts: low −1, high +14
    expect(describeSeatShiftBand(seatShiftBand(band(214, 229), 215))).toBe(
      'the shift lands anywhere from 1 seat toward Republicans to 14 toward Democrats',
    );
  });

  it('zero endpoints read as "no net shift"', () => {
    expect(describeSeatShiftBand(seatShiftBand(band(215, 229), 215))).toBe(
      'the shift lands anywhere from no net shift to 14 seats toward Democrats',
    );
    expect(describeSeatShiftBand(seatShiftBand(band(211, 215), 215))).toBe(
      'the shift lands anywhere from 4 seats toward Republicans to no net shift',
    );
  });

  it('degenerate band reads as "barely moves"', () => {
    expect(describeSeatShiftBand(seatShiftBand(band(234, 234), 215))).toBe(
      'the projection barely moves — still about 19 seats toward Democrats',
    );
    expect(describeSeatShiftBand(seatShiftBand(band(214, 214), 215))).toBe(
      'the projection barely moves — still about 1 seat toward Republicans',
    );
    expect(describeSeatShiftBand(seatShiftBand(band(215, 215), 215))).toBe(
      'the projection barely moves — still no net shift',
    );
  });
});
