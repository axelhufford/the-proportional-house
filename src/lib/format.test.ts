import { describe, expect, it } from 'vitest';
import { formatSeatPct } from './format';

describe('formatSeatPct', () => {
  it('returns empty string when total is zero', () => {
    expect(formatSeatPct(0, 0)).toBe('');
  });

  it('returns empty string when total is negative (defensive)', () => {
    expect(formatSeatPct(5, -3)).toBe('');
  });

  it('formats a normal share with integer rounding', () => {
    // 234 / 435 = 53.79% → 54%
    expect(formatSeatPct(234, 435)).toBe('(54%)');
  });

  it('handles the 100% case (single-seat delegation)', () => {
    expect(formatSeatPct(1, 1)).toBe('(100%)');
  });

  it('handles the 0% case (party with zero seats)', () => {
    expect(formatSeatPct(0, 435)).toBe('(0%)');
  });

  it('rounds half-up (banker-agnostic) per Math.round semantics', () => {
    // 1 / 3 = 33.33...% → 33%
    expect(formatSeatPct(1, 3)).toBe('(33%)');
    // 2 / 3 = 66.66...% → 67%
    expect(formatSeatPct(2, 3)).toBe('(67%)');
  });

  it('does not force parts to sum to 100% (each party rounded independently)', () => {
    // 1 + 1 + 1 of 3: each shows 33%, sum = 99%. Intentional.
    expect(formatSeatPct(1, 3)).toBe('(33%)');
    expect(formatSeatPct(1, 3)).toBe('(33%)');
    expect(formatSeatPct(1, 3)).toBe('(33%)');
  });
});
