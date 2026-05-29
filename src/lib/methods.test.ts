import { describe, expect, it } from 'vitest';
import {
  allocateByMethod,
  allocateMMD,
  allocateMMP,
  allocatePR,
  resolveEffectiveMethod,
  type MethodAllocationInput,
} from './methods';

// Convenience builder — most tests only care about a subset of the fields.
function inp(overrides: Partial<MethodAllocationInput>): MethodAllocationInput {
  return {
    total_seats: 12,
    vote_shares: [0.6, 0.4],
    party_ids: ['D', 'R'],
    actual_d_seats: 8,
    actual_r_seats: 4,
    ...overrides,
  };
}

describe('allocatePR', () => {
  it('matches statewide Sainte-Laguë for a 60/40 split', () => {
    // 12-seat state at 60/40 → Sainte-Laguë returns 7-5 (D's quotients
    // dominate the top of the table).
    expect(allocatePR(inp({}))).toEqual([7, 5]);
  });

  it('reduces to zero when total_seats is zero', () => {
    expect(allocatePR(inp({ total_seats: 0 }))).toEqual([0, 0]);
  });

  it('handles N=3 parties', () => {
    const result = allocatePR(
      inp({ vote_shares: [0.5, 0.3, 0.2], party_ids: ['D', 'R', 'PROG'], total_seats: 10 }),
    );
    expect(result).toEqual([5, 3, 2]);
  });
});

describe('allocateMMD', () => {
  it('60/40 D in 12 seats, MMD-3 → four 2-1 districts = 8-4', () => {
    // Each 3-seat district at 60/40 allocates 2D-1R under Sainte-Laguë.
    // Four districts × (2, 1) = 8-4 total. More D-favoring than PR's 7-5.
    expect(allocateMMD(inp({ total_seats: 12 }), 3)).toEqual([8, 4]);
  });

  it('60/40 D in 10 seats, MMD-3 → 3+3+3+1 districts', () => {
    // Three full 3-seat districts (2-1 each = 6-3) + one 1-seat district
    // (1-0 for the plurality D) = 7-3 total.
    expect(allocateMMD(inp({ total_seats: 10 }), 3)).toEqual([7, 3]);
  });

  it('1-seat state under MMD bypasses chunking', () => {
    // The single seat goes to the plurality party. 60% D → 1-0.
    expect(allocateMMD(inp({ total_seats: 1 }), 3)).toEqual([1, 0]);
  });

  it('2-seat state under MMD-3 → one district of 2 seats', () => {
    // Can't make a 3-seat district from 2 seats; allocate as a single
    // 2-seat district. 60/40 → 1-1 under Sainte-Laguë (each party gets one).
    expect(allocateMMD(inp({ total_seats: 2 }), 3)).toEqual([1, 1]);
  });

  it('MMD-5 vs MMD-3 on a 50-seat state — MMD-5 is more proportional', () => {
    // 50 seats at 60/40. MMD-3: 16 districts of 3 + 1 district of 2 →
    // each 3-seat district = 2-1 (16 × 2-1 = 32-16), the 2-seat = 1-1.
    // Total: 33-17. MMD-5: 10 districts of 5, each at 60/40 → 3-2 under
    // Sainte-Laguë (10 × 3-2 = 30-20). So MMD-3 = 33-17, MMD-5 = 30-20.
    // MMD-5 is closer to the 30-20 pure-PR result.
    expect(allocateMMD(inp({ total_seats: 50 }), 3)).toEqual([33, 17]);
    expect(allocateMMD(inp({ total_seats: 50 }), 5)).toEqual([30, 20]);
  });

  it('handles 3 parties with MMD-3', () => {
    // 9-seat state at 50/30/20 → three 3-seat districts.
    // Each 3-seat district at 50/30/20: Sainte-Laguë quotients are
    // (50, 30, 20, 16.67, 10, 6.67) → top 3 = 50, 30, 20 → 1-1-1.
    // Three districts × (1, 1, 1) = 3-3-3.
    const result = allocateMMD(
      inp({
        total_seats: 9,
        vote_shares: [0.5, 0.3, 0.2],
        party_ids: ['D', 'R', 'PROG'],
      }),
      3,
    );
    expect(result).toEqual([3, 3, 3]);
  });
});

describe('allocateMMP', () => {
  it('12-seat state at 60/40 D, actual 8-4 → MMP-50 = 7-5', () => {
    // SMD count = 6. SMD breakdown from actual 8D-4R ratio: 4D-2R.
    // Target proportional (Sainte-Laguë over 12) = 7-5.
    // List demand: D needs (7-4)=3, R needs (5-2)=3, total demand 6
    // ≤ list capacity 6 → no overhang. Each party gets its demand.
    // Final: 4+3 D, 2+3 R = 7-5.
    expect(allocateMMP(inp({}), 0.5)).toEqual([7, 5]);
  });

  it('overhang: extreme D gerrymander in a now-R-leaning state', () => {
    // 12 seats, vote share 30/70 (state has swung R), actual still 10-2 D
    // (heavy D gerrymander). MMP-50:
    //   SMD count = 6. SMD breakdown from 10/2: 5D-1R.
    //   Target proportional (Sainte-Laguë over 12 at 30/70): 4-8.
    //   List demand: D = max(0, 4-5) = 0 (overhang), R = max(0, 8-1) = 7.
    //   Total demand 7 > list capacity 6 → overhang case.
    //   List allocation: 6 list seats distributed proportionally to
    //   demand (0, 7) under Sainte-Laguë → 0 D, 6 R.
    //   Final: 5+0 D, 1+6 R = 5-7. D over-represented (5 vs target 4),
    //   total stays at 12.
    const result = allocateMMP(
      inp({
        vote_shares: [0.3, 0.7],
        actual_d_seats: 10,
        actual_r_seats: 2,
      }),
      0.5,
    );
    expect(result).toEqual([5, 7]);
  });

  it('minors get zero SMD seats; their seats come from the list', () => {
    // 50-seat state at 50/30/20 D/R/PROG, actual 30D-20R (no PROG today).
    // MMP-50: SMD count = 25. SMD from actual 30/20: D = round(30/50×25)
    // = 15, R = round(20/50×25) = 10. PROG = 0 (not in actual).
    // Target (Sainte-Laguë over 50 at 50/30/20): 25-15-10.
    // List demand: D = max(0, 25-15) = 10, R = max(0, 15-10) = 5,
    // PROG = max(0, 10-0) = 10. Total = 25, list capacity = 25. Exact fit.
    // Final: 15+10 D, 10+5 R, 0+10 PROG = 25-15-10.
    const result = allocateMMP(
      inp({
        total_seats: 50,
        vote_shares: [0.5, 0.3, 0.2],
        party_ids: ['D', 'R', 'PROG'],
        actual_d_seats: 30,
        actual_r_seats: 20,
      }),
      0.5,
    );
    expect(result).toEqual([25, 15, 10]);
  });

  it('1-seat state under MMP — SMD count rounds to 1, list count 0', () => {
    // Tiny states have effectively no list compensation. The 1 SMD seat
    // goes to the plurality of actual_d / actual_r.
    expect(allocateMMP(inp({
      total_seats: 1,
      vote_shares: [0.6, 0.4],
      actual_d_seats: 0,
      actual_r_seats: 1,
    }), 0.5)).toEqual([0, 1]);
  });
});

describe('allocateByMethod dispatcher', () => {
  it('dispatches PR / MMD-3 / MMD-5 / MMP-50 to the right backend', () => {
    const i = inp({});
    expect(allocateByMethod(i, 'PR')).toEqual(allocatePR(i));
    expect(allocateByMethod(i, 'MMD-3')).toEqual(allocateMMD(i, 3));
    expect(allocateByMethod(i, 'MMD-5')).toEqual(allocateMMD(i, 5));
    expect(allocateByMethod(i, 'MMP-50')).toEqual(allocateMMP(i, 0.5));
  });

  it('honors an mmdMagnitude override (MMD-4 differs from the MMD-3 preset)', () => {
    // 50 seats at 60/40: MMD-4 = twelve 4-seat districts + one 2-seat.
    // 4-seat at 60/40 → 2-2 (×12 = 24-24), 2-seat → 1-1. Total 25-25.
    const i = inp({ total_seats: 50 });
    expect(allocateByMethod(i, 'MMD-3', { mmdMagnitude: 4 })).toEqual(allocateMMD(i, 4));
    expect(allocateByMethod(i, 'MMD-3', { mmdMagnitude: 4 })).not.toEqual(allocateByMethod(i, 'MMD-3'));
  });

  it('falls back to the preset magnitude when no override is given', () => {
    const i = inp({ total_seats: 50 });
    expect(allocateByMethod(i, 'MMD-3', {})).toEqual(allocateMMD(i, 3));
    expect(allocateByMethod(i, 'MMD-5', { mmpSmdShare: 0.3 })).toEqual(allocateMMD(i, 5));
  });

  it('honors an mmpSmdShare override (MMP-30 differs from the MMP-50 preset)', () => {
    // The override is plumbed for any input:
    const i = inp({ total_seats: 12 });
    expect(allocateByMethod(i, 'MMP-50', { mmpSmdShare: 0.3 })).toEqual(allocateMMP(i, 0.3));
    // And the share actually changes the result in a gerrymandered/overhang
    // state (30/70 vote, actual 10-2 D): MMP-30 → 4-8, MMP-50 → 5-7.
    const j = inp({ vote_shares: [0.3, 0.7], actual_d_seats: 10, actual_r_seats: 2 });
    expect(allocateByMethod(j, 'MMP-50', { mmpSmdShare: 0.3 })).not.toEqual(allocateByMethod(j, 'MMP-50'));
  });
});

describe('resolveEffectiveMethod', () => {
  it('PR variants are their own canonical key', () => {
    expect(resolveEffectiveMethod('PR')).toMatchObject({ family: 'PR', label: 'Pure PR', canonicalKey: 'PR' });
    expect(resolveEffectiveMethod('PR-DH')).toMatchObject({ family: 'PR-DH', canonicalKey: 'PR-DH' });
  });

  it('MMD presets resolve to their canonical key; off-grid is null', () => {
    expect(resolveEffectiveMethod('MMD-3')).toMatchObject({ family: 'MMD', size: 3, label: 'MMD-3', canonicalKey: 'MMD-3' });
    expect(resolveEffectiveMethod('MMD-5')).toMatchObject({ size: 5, label: 'MMD-5', canonicalKey: 'MMD-5' });
    // override to 5 from an MMD-3 base still recognizes the canonical key
    expect(resolveEffectiveMethod('MMD-3', 5)).toMatchObject({ size: 5, canonicalKey: 'MMD-5' });
    // off-grid
    expect(resolveEffectiveMethod('MMD-3', 4)).toMatchObject({ family: 'MMD', size: 4, label: 'MMD-4', canonicalKey: null });
  });

  it('MMP presets resolve to canonical; off-grid is null with a percent label', () => {
    expect(resolveEffectiveMethod('MMP-50')).toMatchObject({ family: 'MMP', smdShare: 0.5, label: 'MMP-50', canonicalKey: 'MMP-50' });
    expect(resolveEffectiveMethod('MMP-50', null, 0.3)).toMatchObject({ smdShare: 0.3, label: 'MMP-30', canonicalKey: null });
  });
});
