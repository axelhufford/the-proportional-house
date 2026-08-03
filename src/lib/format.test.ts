import { describe, expect, it } from 'vitest';
import { fmtMargin, formatSeatPct } from './format';

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

describe('fmtMargin', () => {
  it('reads a tie inside the ±0.05 band', () => {
    expect(fmtMargin(0)).toBe('Tie');
    expect(fmtMargin(0.04)).toBe('Tie');
    expect(fmtMargin(-0.04)).toBe('Tie');
  });

  it('does not call the band boundary a tie', () => {
    // 0.05 renders "D+0.1", never "D+0.0" — the band matches display rounding.
    expect(fmtMargin(0.05)).toBe('D+0.1');
    expect(fmtMargin(-0.05)).toBe('R+0.1');
  });

  it('formats both signs with one decimal', () => {
    expect(fmtMargin(6.94)).toBe('D+6.9');
    expect(fmtMargin(-2.5)).toBe('R+2.5');
  });

  it('renders non-finite input as an em dash rather than NaN', () => {
    expect(fmtMargin(null)).toBe('—');
    expect(fmtMargin(undefined)).toBe('—');
    expect(fmtMargin(NaN)).toBe('—');
    expect(fmtMargin(Infinity)).toBe('—');
  });

  it('honors a custom precision, widening the tie band to match', () => {
    // The Methodology page renders some figures at 0 and 2 decimals. The band
    // must track the displayed precision, or the label claims a lead it isn't
    // showing a number for.
    expect(fmtMargin(6.04, 0)).toBe('D+6');
    expect(fmtMargin(0.4, 0)).toBe('Tie');
    expect(fmtMargin(0.6, 0)).toBe('D+1');
    expect(fmtMargin(-2.551, 2)).toBe('R+2.55');
    expect(fmtMargin(0.004, 2)).toBe('Tie');
    expect(fmtMargin(0.006, 2)).toBe('D+0.01');
  });

  it('never renders a signed zero', () => {
    // The bug this replaced: five call sites inlined the ternary without a Tie
    // branch, so a dead-even slider showed "Tie" in one place and "D+0.0" in
    // two others on the same screen.
    for (const digits of [0, 1, 2]) {
      for (const m of [0, -0, 1e-9, -1e-9]) {
        expect(fmtMargin(m, digits)).toBe('Tie');
      }
    }
  });
});
