import { describe, expect, it } from 'vitest';
import { allocate, allocateN, quotientTable, type AllocationMethod } from './allocation';
import fixture from '../../tests/fixtures/allocation_cases.json';

const METHODS: AllocationMethod[] = ['sainte-lague', 'dhondt', 'hamilton'];

interface NCase {
  name: string;
  input: { seats: number; votes: number[] };
  expected: Record<AllocationMethod, number[]>;
}

describe('allocateN parity with two-party allocate()', () => {
  // Every method, on every two-party fixture-style case, should yield
  // identical results between the two APIs.
  const cases: Array<{ name: string; seats: number; d: number; r: number }> = [
    { name: 'lean D 60/40, 5 seats',  seats: 5,  d: 600, r: 400 },
    { name: 'lean R 30/70, 9 seats',  seats: 9,  d: 300, r: 700 },
    { name: 'tight 51/49, 8 seats',   seats: 8,  d: 510, r: 490 },
    { name: 'tie 50/50, 4 seats',     seats: 4,  d: 500, r: 500 },
    { name: 'shutout 100/0, 3 seats', seats: 3,  d: 1000, r: 0 },
    { name: 'big state 55/45, 52 seats', seats: 52, d: 55_000_000, r: 45_000_000 },
  ];

  for (const c of cases) {
    for (const method of METHODS) {
      it(`${c.name} — ${method}`, () => {
        const legacy = allocate({ seats: c.seats, d_votes: c.d, r_votes: c.r }, method);
        const generic = allocateN({ seats: c.seats, votes: [c.d, c.r] }, method);
        expect(generic).toEqual([legacy.d_seats, legacy.r_seats]);
      });
    }
  }
});

describe('allocateN with 3+ parties', () => {
  it('Sainte-Laguë: 3-party 50/30/20 in 10 seats → 5/3/2', () => {
    expect(allocateN({ seats: 10, votes: [50, 30, 20] }, 'sainte-lague')).toEqual([5, 3, 2]);
  });

  it("D'Hondt: 3-party 50/30/20 in 10 seats → 5/3/2", () => {
    expect(allocateN({ seats: 10, votes: [50, 30, 20] }, 'dhondt')).toEqual([5, 3, 2]);
  });

  it('Hamilton: 4-party with messy fractions, leftovers settle deterministically', () => {
    // Quotas: 4.0, 2.5, 2.0, 1.5 for 10 seats. Floors: 4, 2, 2, 1 = 9.
    // One leftover seat → highest fractional remainder = party 1 (0.5)
    // or party 3 (0.5), tie broken by raw votes (250 > 150) → party 1.
    expect(allocateN({ seats: 10, votes: [400, 250, 200, 150] }, 'hamilton')).toEqual([4, 3, 2, 1]);
  });

  it('Tiny party with zero votes always gets zero seats', () => {
    const result = allocateN({ seats: 8, votes: [500, 400, 100, 0] }, 'sainte-lague');
    expect(result[3]).toBe(0);
    expect(result.reduce((s, v) => s + v, 0)).toBe(8);
  });

  it('Total seats always equal seats requested', () => {
    const result = allocateN({ seats: 7, votes: [180, 220, 60] }, 'sainte-lague');
    expect(result.reduce((s, v) => s + v, 0)).toBe(7);
  });

  it('Tie on first quotient broken by lower party index (D before R before minor)', () => {
    // Three parties with equal votes, 2 seats. Top two quotients are
    // identical → assignment goes to indices 0 and 1.
    const result = allocateN({ seats: 2, votes: [100, 100, 100] }, 'sainte-lague');
    expect(result).toEqual([1, 1, 0]);
  });

  it('Empty parties array returns empty', () => {
    expect(allocateN({ seats: 5, votes: [] }, 'sainte-lague')).toEqual([]);
  });

  it('All zero votes returns all zero seats', () => {
    expect(allocateN({ seats: 5, votes: [0, 0, 0] }, 'sainte-lague')).toEqual([0, 0, 0]);
  });
});

describe('input validation', () => {
  // A NaN silently poisons the sort comparator; a negative vote total makes
  // Hamilton emit a *negative* seat count (Math.floor(-2.5) === -3), which the
  // UI would happily render as "−3 seats".
  for (const method of METHODS) {
    it(`${method}: NaN votes throw`, () => {
      expect(() => allocateN({ seats: 5, votes: [NaN, 300] }, method)).toThrow(RangeError);
    });

    it(`${method}: negative votes throw`, () => {
      expect(() => allocateN({ seats: 5, votes: [-100, 300] }, method)).toThrow(RangeError);
    });
  }

  it('Infinity votes throw', () => {
    expect(() => allocateN({ seats: 5, votes: [Infinity, 300] }, 'sainte-lague')).toThrow(
      RangeError,
    );
  });

  it('two-party allocate() validates too', () => {
    expect(() => allocate({ seats: 5, d_votes: -1, r_votes: 300 })).toThrow(RangeError);
  });
});

describe('quotientTable', () => {
  it('marks the winning quotients for a 60/40 split over 3 seats', () => {
    const rows = quotientTable({ seats: 3, d_votes: 600, r_votes: 400 }, 'sainte-lague');
    expect(rows.map((r) => r.divisor)).toEqual([1, 3, 5]);
    // Quotients: D 600/200/120, R 400/133.3/80. Top 3 → D600, R400, D200.
    expect(rows.map((r) => [r.d_wins, r.r_wins])).toEqual([
      [true, true],
      [true, false],
      [false, false],
    ]);
  });

  it('agrees with allocate() on the winner counts', () => {
    for (const method of ['sainte-lague', 'dhondt'] as const) {
      for (const [d, r, seats] of [
        [600, 400, 5],
        [510, 490, 8],
        [950, 50, 10],
        [500, 500, 4],
        [800, 0, 4],
      ] as const) {
        const rows = quotientTable({ seats, d_votes: d, r_votes: r }, method);
        const expected = allocate({ seats, d_votes: d, r_votes: r }, method);
        expect(rows.filter((x) => x.d_wins).length).toBe(expected.d_seats);
        expect(rows.filter((x) => x.r_wins).length).toBe(expected.r_seats);
      }
    }
  });

  it('awards nothing when both parties have zero votes', () => {
    // Every quotient is 0, so an unguarded sort hands all `seats` rows to D —
    // contradicting allocate(), which returns 0-0. Reachable from the
    // Methodology page's demo, whose vote inputs allow 0.
    const rows = quotientTable({ seats: 5, d_votes: 0, r_votes: 0 }, 'sainte-lague');
    expect(rows).toHaveLength(5);
    expect(rows.some((r) => r.d_wins || r.r_wins)).toBe(false);
    const allocated = allocate({ seats: 5, d_votes: 0, r_votes: 0 }, 'sainte-lague');
    expect(allocated).toEqual({ d_seats: 0, r_seats: 0 });
  });

  it('returns no rows for a zero-seat state', () => {
    expect(quotientTable({ seats: 0, d_votes: 600, r_votes: 400 })).toEqual([]);
  });

  it('rejects invalid vote totals', () => {
    expect(() => quotientTable({ seats: 3, d_votes: NaN, r_votes: 400 })).toThrow(RangeError);
  });
});

describe('allocateN parity with shared fixture (cases_n)', () => {
  // The same JSON drives data-pipeline/allocation.py's parity test, so the
  // Python (Electoral College build) and TS (interactive method toggle)
  // allocators provably agree on every multiparty case.
  const nCases = (fixture as unknown as { cases_n: NCase[] }).cases_n;
  for (const c of nCases) {
    for (const method of METHODS) {
      it(`${c.name} — ${method}`, () => {
        expect(allocateN({ seats: c.input.seats, votes: c.input.votes }, method)).toEqual(
          c.expected[method],
        );
      });
    }
  }
});
