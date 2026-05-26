import { describe, expect, it } from 'vitest';
import {
  cubeRootSize,
  huntingtonHill,
  wyomingRuleSize,
} from './apportionment';
import {
  STATE_POPULATIONS_2020,
  TOTAL_APPORTIONMENT_POPULATION_2020,
  WYOMING_POPULATION_2020,
} from './statePopulations';

describe('huntingtonHill', () => {
  it('total seats sum exactly to the input total', () => {
    const result = huntingtonHill({
      state_populations: STATE_POPULATIONS_2020,
      total_seats: 435,
    });
    const sum = Object.values(result).reduce((a, b) => a + b, 0);
    expect(sum).toBe(435);
  });

  it('every state with population > 0 gets at least 1 seat', () => {
    const result = huntingtonHill({
      state_populations: STATE_POPULATIONS_2020,
      total_seats: 435,
    });
    for (const code of Object.keys(STATE_POPULATIONS_2020)) {
      expect(result[code]).toBeGreaterThanOrEqual(1);
    }
  });

  it('reproduces the actual US 2020 apportionment for 435 seats', () => {
    // Source of truth: U.S. Census Bureau 2020 Apportionment Results.
    // If this test breaks because the 2020 census populations change,
    // also update STATE_POPULATIONS_2020.
    const expected: Record<string, number> = {
      AL: 7, AK: 1, AZ: 9, AR: 4, CA: 52,
      CO: 8, CT: 5, DE: 1, FL: 28, GA: 14,
      HI: 2, ID: 2, IL: 17, IN: 9, IA: 4,
      KS: 4, KY: 6, LA: 6, ME: 2, MD: 8,
      MA: 9, MI: 13, MN: 8, MS: 4, MO: 8,
      MT: 2, NE: 3, NV: 4, NH: 2, NJ: 12,
      NM: 3, NY: 26, NC: 14, ND: 1, OH: 15,
      OK: 5, OR: 6, PA: 17, RI: 2, SC: 7,
      SD: 1, TN: 9, TX: 38, UT: 4, VT: 1,
      VA: 11, WA: 10, WV: 2, WI: 8, WY: 1,
    };
    const result = huntingtonHill({
      state_populations: STATE_POPULATIONS_2020,
      total_seats: 435,
    });
    expect(result).toEqual(expected);
  });

  it('expanded House: larger states gain seats proportionally', () => {
    // At 435 California has 52 seats and Wyoming has 1.
    // At 573 (Wyoming Rule) California should have considerably more
    // (its population × scale factor ≈ 52 × 573/435 ≈ 68.5), Wyoming
    // still gets only 1 (its population won the marginal 1-seat round
    // exactly once and there's not enough to win again before 600+).
    const result = huntingtonHill({
      state_populations: STATE_POPULATIONS_2020,
      total_seats: 573,
    });
    expect(result.CA).toBeGreaterThan(60);
    expect(result.WY).toBe(1);
    const sum = Object.values(result).reduce((a, b) => a + b, 0);
    expect(sum).toBe(573);
  });

  it('toy 3-state example matches a hand-computed Huntington-Hill outcome', () => {
    // Three states, populations 6M / 3M / 2M, 10 seats.
    // Initial: 1 each (3 assigned, 7 remaining).
    // Priorities for next 7 rounds (A = pop / sqrt(n×(n+1))):
    //   Round 4 (each at 1): A_A=6/√2=4.24M, B=3/√2=2.12M, C=2/√2=1.41M → A=2
    //   Round 5: A=6/√6=2.45M, B=2.12M, C=1.41M → A=3
    //   Round 6: A=6/√12=1.73M, B=2.12M, C=1.41M → B=2
    //   Round 7: A=6/√12=1.73M, B=3/√6=1.22M, C=1.41M → A=4
    //   Round 8: A=6/√20=1.34M, B=1.22M, C=1.41M → C=2
    //   Round 9: A=1.34M, B=1.22M, C=2/√6=0.82M → A=5
    //   Round 10: A=6/√30=1.10M, B=1.22M, C=0.82M → B=3
    // Final: A=5, B=3, C=2. Total=10. ✓
    const result = huntingtonHill({
      state_populations: { A: 6_000_000, B: 3_000_000, C: 2_000_000 },
      total_seats: 10,
    });
    expect(result).toEqual({ A: 5, B: 3, C: 2 });
  });

  it('skips states with population 0', () => {
    const result = huntingtonHill({
      state_populations: { A: 5_000_000, B: 0, C: 3_000_000 },
      total_seats: 10,
    });
    expect(result.B).toBeUndefined();
    expect(Object.values(result).reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('returns minimums when total_seats ≤ combined minimums', () => {
    // 3 states all populated but only 2 seats requested — caller error,
    // but bail gracefully.
    const result = huntingtonHill({
      state_populations: { A: 100, B: 100, C: 100 },
      total_seats: 2,
    });
    // Each gets at least the minimum (1); total over-allocates.
    expect(result.A).toBe(1);
    expect(result.B).toBe(1);
    expect(result.C).toBe(1);
  });
});

describe('wyomingRuleSize', () => {
  it('computes ~573 for the 2020 census populations', () => {
    // 331,108,434 / 577,719 = 573.0 → round to 573.
    expect(
      wyomingRuleSize(TOTAL_APPORTIONMENT_POPULATION_2020, WYOMING_POPULATION_2020),
    ).toBe(573);
  });

  it('returns 0 if smallest state population is non-positive (defensive)', () => {
    expect(wyomingRuleSize(1_000_000, 0)).toBe(0);
    expect(wyomingRuleSize(1_000_000, -1)).toBe(0);
  });
});

describe('cubeRootSize', () => {
  it('computes ~692 for the 2020 census total population', () => {
    // ∛331,108,434 ≈ 691.69 → round to 692.
    expect(cubeRootSize(TOTAL_APPORTIONMENT_POPULATION_2020)).toBe(692);
  });

  it('returns 0 for non-positive populations', () => {
    expect(cubeRootSize(0)).toBe(0);
    expect(cubeRootSize(-1)).toBe(0);
  });
});
