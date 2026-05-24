import { describe, expect, it } from 'vitest';
import { PARTY_D, PARTY_R, PRESET_MINORS } from './parties';
import { buildSandboxPayload, type MinorPartySpec } from './sandboxSwing';
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
