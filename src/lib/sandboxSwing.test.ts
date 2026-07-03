import { describe, expect, it } from 'vitest';
import { ALL_METHODS } from './methods';
import { PARTY_D, PARTY_R, PRESET_MINORS } from './parties';
import { buildSandboxPayload, DEFAULT_HOUSE_SIZE, type MinorPartySpec } from './sandboxSwing';
import type { ProjectionPayload } from './types';

// Two-state fixture: a large blue state (CA-like, 52 seats, 60/40 D) and a
// small red state (WY-like, 3 seats, 30/70 D). Enough to exercise the
// allocator without becoming a real-data test.
const FIXTURE: ProjectionPayload = {
  meta: {
    generated_at: '2026-05-22T00:00:00Z',
    data_source: 'test',
    method: 'sainte-lague',
    generic_ballot_margin: 5.0,
    baseline_2024_margin: -2.5,
    swing: 7.5,
  },
  national: {
    seats: 55,
    actual: { d_seats: 30, r_seats: 25 },
    projected: { d_seats: 32, r_seats: 23 },
  },
  states: [
    {
      fips: '06',
      code: 'CA',
      name: 'California',
      seats: 52,
      actual: { d_seats: 43, r_seats: 9 },
      baseline_2024: { d_share: 0.6, r_share: 0.4 },
      projected: { d_share: 0.6, r_share: 0.4, d_seats: 32, r_seats: 20 },
    },
    {
      fips: '56',
      code: 'WY',
      name: 'Wyoming',
      seats: 3,
      actual: { d_seats: 0, r_seats: 3 },
      baseline_2024: { d_share: 0.3, r_share: 0.7 },
      projected: { d_share: 0.3, r_share: 0.7, d_seats: 1, r_seats: 2 },
    },
  ],
};

describe('buildSandboxPayload — zero minors', () => {
  it('returns just D + R when minors is empty', () => {
    const out = buildSandboxPayload(FIXTURE, [], 0.05);
    expect(out.minors).toEqual([]);
    expect(out.states[0].parties.map((p) => p.party.id)).toEqual(['D', 'R']);
    // Shares should match the two-party input.
    expect(out.states[0].parties[0].vote_share).toBeCloseTo(0.6, 5);
    expect(out.states[0].parties[1].vote_share).toBeCloseTo(0.4, 5);
  });

  it('preserves the same seat splits as a two-party allocation', () => {
    const out = buildSandboxPayload(FIXTURE, [], 0);
    // CA: 52 seats at 60/40 → 31/21 under Sainte-Laguë.
    expect(out.states[0].parties[0].seats).toBe(31);
    expect(out.states[0].parties[1].seats).toBe(21);
    // WY: 3 seats at 30/70 → 1/2.
    expect(out.states[1].parties[0].seats).toBe(1);
    expect(out.states[1].parties[1].seats).toBe(2);
  });
});

describe('buildSandboxPayload — one minor above threshold', () => {
  const prog: MinorPartySpec = { party: PRESET_MINORS.PROG, national_share: 0.1 };

  it('adds the minor as a third party in canonical order [D, R, PROG]', () => {
    const out = buildSandboxPayload(FIXTURE, [prog], 0.05);
    expect(out.states[0].parties.map((p) => p.party.id)).toEqual(['D', 'R', 'PROG']);
  });

  it('subtracts the minor share from D and R per the draw ratio (85/15)', () => {
    const out = buildSandboxPayload(FIXTURE, [prog], 0); // no threshold so no renorm distortion
    // Pre-renormalize: D_raw = 0.6 - 0.10*0.85 = 0.515, R_raw = 0.4 - 0.10*0.15 = 0.385, PROG = 0.10.
    // Sum = 1.0 exactly so renormalize is a no-op.
    expect(out.states[0].parties[0].vote_share).toBeCloseTo(0.515, 5);
    expect(out.states[0].parties[1].vote_share).toBeCloseTo(0.385, 5);
    expect(out.states[0].parties[2].vote_share).toBeCloseTo(0.1, 5);
  });

  it('a 10% Progressive Left wins seats in a 52-seat state', () => {
    const out = buildSandboxPayload(FIXTURE, [prog], 0.05);
    const ca = out.states[0];
    expect(ca.parties[2].seats).toBeGreaterThan(0); // PROG wins something in CA
    expect(ca.parties.reduce((s, p) => s + p.seats, 0)).toBe(52);
  });
});

describe('buildSandboxPayload — threshold filtering', () => {
  it('a 3% minor with threshold=5% gets zero seats', () => {
    const small: MinorPartySpec = { party: PRESET_MINORS.PROG, national_share: 0.03 };
    const out = buildSandboxPayload(FIXTURE, [small], 0.05);
    // PROG is below threshold everywhere — zero seats in both states.
    expect(out.states[0].parties[2].seats).toBe(0);
    expect(out.states[1].parties[2].seats).toBe(0);
    // D and R should still sum to total_seats.
    expect(out.states[0].parties[0].seats + out.states[0].parties[1].seats).toBe(52);
  });

  it('threshold=0 lets a tiny party potentially win in a very large state', () => {
    const small: MinorPartySpec = { party: PRESET_MINORS.PROG, national_share: 0.02 };
    const out = buildSandboxPayload(FIXTURE, [small], 0);
    // With 2% in a 52-seat state, Sainte-Laguë may or may not award a
    // seat depending on the quotients — but at minimum, the PROG share
    // is preserved (not zeroed).
    expect(out.states[0].parties[2].vote_share).toBeGreaterThan(0);
  });
});

describe('buildSandboxPayload — two minors', () => {
  const prog: MinorPartySpec = { party: PRESET_MINORS.PROG, national_share: 0.08 };
  const af: MinorPartySpec = { party: PRESET_MINORS.AF, national_share: 0.1 };

  it('orders parties as [D, R, PROG, AF] matching input', () => {
    const out = buildSandboxPayload(FIXTURE, [prog, af], 0.05);
    expect(out.states[0].parties.map((p) => p.party.id)).toEqual(['D', 'R', 'PROG', 'AF']);
  });

  it('subtracts both minors from D/R independently', () => {
    const out = buildSandboxPayload(FIXTURE, [prog, af], 0);
    // D: 0.6 - 0.08*0.85 - 0.10*0.15 = 0.6 - 0.068 - 0.015 = 0.517
    // R: 0.4 - 0.08*0.15 - 0.10*0.85 = 0.4 - 0.012 - 0.085 = 0.303
    // PROG: 0.08, AF: 0.10. Sum = 1.0.
    expect(out.states[0].parties[0].vote_share).toBeCloseTo(0.517, 4);
    expect(out.states[0].parties[1].vote_share).toBeCloseTo(0.303, 4);
    expect(out.states[0].parties[2].vote_share).toBeCloseTo(0.08, 5);
    expect(out.states[0].parties[3].vote_share).toBeCloseTo(0.1, 5);
  });
});

describe('buildSandboxPayload — clamp + renormalize on extreme inputs', () => {
  it('a minor larger than the major-party share clamps to non-negative', () => {
    // Wyoming D = 0.3; a Progressive Left at 50% would drive D to 0.3 - 0.5*0.85 = -0.125.
    // The clamp should pin D to 0; the renormalize should keep everything in [0,1].
    const huge: MinorPartySpec = { party: PRESET_MINORS.PROG, national_share: 0.5 };
    const out = buildSandboxPayload(FIXTURE, [huge], 0);
    const wy = out.states[1];
    expect(wy.parties[0].vote_share).toBeGreaterThanOrEqual(0);
    expect(wy.parties[1].vote_share).toBeGreaterThanOrEqual(0);
    expect(wy.parties[2].vote_share).toBeGreaterThanOrEqual(0);
    const sum = wy.parties.reduce((s, p) => s + p.vote_share, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe('buildSandboxPayload — national totals', () => {
  it('aggregates seats per party across states', () => {
    const out = buildSandboxPayload(FIXTURE, [], 0);
    // CA: 31D + 21R = 52. WY: 1D + 2R = 3. National: 32D + 23R = 55.
    expect(out.national.parties[0].seats).toBe(32);
    expect(out.national.parties[1].seats).toBe(23);
    expect(out.national.total_seats).toBe(55);
  });

  it('preserves D and R in the canonical first two slots', () => {
    const out = buildSandboxPayload(FIXTURE, [], 0);
    expect(out.national.parties[0].party).toBe(PARTY_D);
    expect(out.national.parties[1].party).toBe(PARTY_R);
  });
});

describe('buildSandboxPayload — actual_scaled baseline (House-size-correct difference)', () => {
  it('equals the raw actual at House 435 (no expansion → no regression)', () => {
    const out = buildSandboxPayload(FIXTURE, [], 0); // default house = 435
    expect(out.states[0].actual_scaled).toEqual({ d_seats: 43, r_seats: 9 }); // CA
    expect(out.states[1].actual_scaled).toEqual({ d_seats: 0, r_seats: 3 }); // WY
    expect(out.national.actual_scaled).toEqual({ d_seats: 43, r_seats: 12 });
  });

  it('is zero-sum: scaled D + R equals total_seats, per state and nationally', () => {
    const out = buildSandboxPayload(FIXTURE, [], 0, 'PR', 600);
    for (const st of out.states) {
      expect(st.actual_scaled.d_seats + st.actual_scaled.r_seats).toBe(st.total_seats);
    }
    expect(out.national.actual_scaled.d_seats + out.national.actual_scaled.r_seats).toBe(
      out.national.total_seats,
    );
  });

  it('makes the national difference zero-sum at an expanded House (+N D == −N R)', () => {
    // This is the property that fixes the "+92 D / −92 R" bug: with the baseline
    // scaled to the projected chamber, the D shift exactly mirrors the R shift,
    // instead of attributing pure chamber growth to one party.
    const out = buildSandboxPayload(FIXTURE, [], 0, 'PR', 600);
    const dDiff = out.national.parties[0].seats - out.national.actual_scaled.d_seats;
    const rDiff = out.national.parties[1].seats - out.national.actual_scaled.r_seats;
    expect(dDiff).toBe(-rDiff);
  });

  it('grows the baseline with the House (it is not pinned to 435)', () => {
    const small = buildSandboxPayload(FIXTURE, [], 0, 'PR', 435);
    const big = buildSandboxPayload(FIXTURE, [], 0, 'PR', 600);
    const smallTotal = small.national.actual_scaled.d_seats + small.national.actual_scaled.r_seats;
    const bigTotal = big.national.actual_scaled.d_seats + big.national.actual_scaled.r_seats;
    expect(bigTotal).toBeGreaterThan(smallTotal);
  });
});

describe('current-view method comparison (canonical inputs)', () => {
  // These pin the guarantees the home page's "other allocation methods"
  // disclosure relies on: no minors, threshold 0, default House size.

  it("the PR row equals the pipeline's national.projected (hero headline)", () => {
    const out = buildSandboxPayload(FIXTURE, [], 0, 'PR', DEFAULT_HOUSE_SIZE);
    const [d, r] = out.national.parties;
    expect(d.party.id).toBe('D');
    expect(r.party.id).toBe('R');
    expect(d.seats).toBe(FIXTURE.national.projected.d_seats);
    expect(r.seats).toBe(FIXTURE.national.projected.r_seats);
  });

  it('every method yields a two-party result summing to the full House', () => {
    for (const method of ALL_METHODS) {
      const out = buildSandboxPayload(FIXTURE, [], 0, method, DEFAULT_HOUSE_SIZE);
      expect(out.national.parties.map((p) => p.party.id), method).toEqual(['D', 'R']);
      const total = out.national.parties.reduce((sum, p) => sum + p.seats, 0);
      expect(total, method).toBe(FIXTURE.national.seats);
    }
  });
});
