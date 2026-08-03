export type Party = 'D' | 'R';

export type AllocationMethod = 'sainte-lague' | 'dhondt' | 'hamilton';

export interface AllocationInput {
  seats: number;
  d_votes: number;
  r_votes: number;
}

export interface AllocationResult {
  d_seats: number;
  r_seats: number;
}

/**
 * Generic N-party allocation input. Used by the sandbox extended mode
 * where the parties list can grow beyond D/R. See `src/lib/sandboxSwing.ts`
 * for the caller.
 */
export interface AllocationInputN {
  seats: number;
  /** Vote totals per party. Order is preserved in the seats[] result. */
  votes: number[];
}

/**
 * Reject inputs that would produce meaningless seat counts.
 *
 * Without this, a NaN vote total silently poisons the sort comparator and a
 * negative one can produce a *negative* seat count (Math.floor(-2.5) === -3),
 * which would render in the UI as "−3 seats" rather than failing loudly.
 * Mirrors `_validate` in data-pipeline/allocation.py.
 */
function assertValidInput(input: AllocationInputN): void {
  if (!Number.isFinite(input.seats)) {
    throw new RangeError(`allocation: seats must be finite (got ${input.seats})`);
  }
  for (let i = 0; i < input.votes.length; i++) {
    const v = input.votes[i];
    if (!Number.isFinite(v) || v < 0) {
      throw new RangeError(
        `allocation: vote totals must be finite and non-negative (party index ${i} got ${v})`,
      );
    }
  }
}

/**
 * Generic divisor-method allocator. Computes a quotient per party per
 * round, ranks all quotients, and assigns the top `seats` to their
 * originating parties. Returns seats indexed by party in input order.
 *
 * Tie-breaking (deterministic): higher quotient wins; ties broken by
 * larger original vote total; final ties broken by lower party index.
 * For two-party callers (D=index 0, R=index 1) this preserves the
 * historical "D wins ties" behavior that the existing fixture encodes.
 *
 * Quotients are compared *exactly*, not within an epsilon. An epsilon
 * comparison here would be non-transitive (a≈b, b≈c, a<c), which is
 * undefined behavior for Array.prototype.sort, and it would disagree with
 * data-pipeline/allocation.py — which compares exactly — whenever two
 * quotients land within 1e-9 of each other. Genuine mathematical ties
 * produce bit-identical doubles, so exact comparison handles them.
 */
function divisorMethodN(
  input: AllocationInputN,
  divisorFor: (i: number) => number,
): number[] {
  const { seats, votes } = input;
  const n = votes.length;
  if (seats <= 0 || n === 0) return votes.map(() => 0);
  // If every party has zero votes, every quotient is zero — the sort
  // would still hand out seats by tie-break (lower index wins). That's
  // a meaningless allocation; return all zeros instead. Matches the
  // existing Hamilton behavior and the spirit of "no seats earned."
  const totalVotes = votes.reduce((s, v) => s + v, 0);
  if (totalVotes <= 0) return votes.map(() => 0);

  type Quotient = { partyIdx: number; value: number; votes: number };
  const quotients: Quotient[] = [];
  for (let r = 0; r < seats; r++) {
    const div = divisorFor(r);
    for (let p = 0; p < n; p++) {
      quotients.push({ partyIdx: p, value: votes[p] / div, votes: votes[p] });
    }
  }

  quotients.sort((a, b) => {
    if (a.value !== b.value) return b.value - a.value;
    if (a.votes !== b.votes) return b.votes - a.votes;
    return a.partyIdx - b.partyIdx; // lower index wins final tie
  });

  const result = votes.map(() => 0);
  for (let i = 0; i < seats; i++) {
    result[quotients[i].partyIdx]++;
  }
  return result;
}

function sainteLagueN(input: AllocationInputN): number[] {
  return divisorMethodN(input, (i) => 2 * i + 1);
}

function dHondtN(input: AllocationInputN): number[] {
  return divisorMethodN(input, (i) => i + 1);
}

/**
 * Largest-remainder (Hamilton) method, N-party form.
 *
 * Each party gets `floor(quota)` seats (quota = share × seats); leftover
 * seats go to parties with the largest fractional remainder. Ties on the
 * remainder go to the party with more raw votes; final ties to the lower
 * party index (matches the divisor methods' tie rule).
 */
function hamiltonN(input: AllocationInputN): number[] {
  const { seats, votes } = input;
  const n = votes.length;
  if (seats <= 0 || n === 0) return votes.map(() => 0);
  const total = votes.reduce((s, v) => s + v, 0);
  if (total <= 0) return votes.map(() => 0);

  const quotas = votes.map((v) => (v / total) * seats);
  const floors = quotas.map((q) => Math.floor(q));
  const remainders = quotas.map((q, i) => ({ idx: i, frac: q - floors[i], votes: votes[i] }));
  let assigned = floors.reduce((s, v) => s + v, 0);
  let remaining = seats - assigned;

  remainders.sort((a, b) => {
    if (a.frac !== b.frac) return b.frac - a.frac;
    if (a.votes !== b.votes) return b.votes - a.votes;
    return a.idx - b.idx;
  });

  const result = floors.slice();
  let cursor = 0;
  while (remaining > 0) {
    result[remainders[cursor % n].idx]++;
    cursor++;
    remaining--;
  }
  return result;
}

/**
 * Generic N-party allocator. Returns seats per party in the order the
 * caller provided in `input.votes`. Sandbox extended mode uses this
 * directly; the two-party `allocate` wraps it below.
 */
export function allocateN(
  input: AllocationInputN,
  method: AllocationMethod = 'sainte-lague',
): number[] {
  assertValidInput(input);
  switch (method) {
    case 'sainte-lague':
      return sainteLagueN(input);
    case 'dhondt':
      return dHondtN(input);
    case 'hamilton':
      return hamiltonN(input);
  }
}

/**
 * Two-party allocator — preserved as the canonical API for the rest of
 * the app. Internally delegates to `allocateN` with party order [D, R].
 */
export function allocate(
  input: AllocationInput,
  method: AllocationMethod = 'sainte-lague',
): AllocationResult {
  const [d, r] = allocateN(
    { seats: input.seats, votes: [input.d_votes, input.r_votes] },
    method,
  );
  return { d_seats: d, r_seats: r };
}

/**
 * Returns the full quotient table for a divisor method, useful for the
 * "show the math" panel in the state detail UI. Two-party only — the
 * methodology demo is a deliberately simple D-vs-R illustration of
 * Sainte-Laguë; extending it to N parties would muddy the explainer.
 */
export interface QuotientRow {
  divisor: number;
  d_quotient: number;
  r_quotient: number;
  d_wins: boolean;
  r_wins: boolean;
}

export function quotientTable(
  input: AllocationInput,
  method: Extract<AllocationMethod, 'sainte-lague' | 'dhondt'> = 'sainte-lague',
): QuotientRow[] {
  const { seats, d_votes, r_votes } = input;
  assertValidInput({ seats, votes: [d_votes, r_votes] });
  const divisorFor = method === 'sainte-lague' ? (i: number) => 2 * i + 1 : (i: number) => i + 1;

  type Q = { party: Party; value: number; votes: number; divisor: number };
  const all: Q[] = [];
  const rows: QuotientRow[] = [];
  for (let i = 0; i < seats; i++) {
    const div = divisorFor(i);
    const d_q = d_votes / div;
    const r_q = r_votes / div;
    rows.push({ divisor: div, d_quotient: d_q, r_quotient: r_q, d_wins: false, r_wins: false });
    all.push({ party: 'D', value: d_q, votes: d_votes, divisor: div });
    all.push({ party: 'R', value: r_q, votes: r_votes, divisor: div });
  }
  // All-zero votes → no seats earned. Without this, every quotient is 0, the
  // tie-break hands all `seats` rows to D, and the table would contradict
  // `allocate`, which returns 0/0 for the same input. Reachable from the
  // Methodology page's interactive demo, whose vote inputs allow 0.
  if (d_votes + r_votes <= 0) return rows;
  all.sort((a, b) => {
    if (a.value !== b.value) return b.value - a.value;
    if (a.votes !== b.votes) return b.votes - a.votes;
    return a.party === b.party ? 0 : a.party === 'D' ? -1 : 1;
  });
  const winners = all.slice(0, seats);
  for (const w of winners) {
    const row = rows.find((row) => row.divisor === w.divisor)!;
    if (w.party === 'D') row.d_wins = true;
    else row.r_wins = true;
  }
  return rows;
}
