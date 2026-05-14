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

const EPSILON = 1e-9;

function divisorMethod(
  input: AllocationInput,
  divisorFor: (i: number) => number,
): AllocationResult {
  const { seats, d_votes, r_votes } = input;
  if (seats <= 0) return { d_seats: 0, r_seats: 0 };

  type Quotient = { party: Party; value: number; votes: number };
  const quotients: Quotient[] = [];
  for (let i = 0; i < seats; i++) {
    const div = divisorFor(i);
    quotients.push({ party: 'D', value: d_votes / div, votes: d_votes });
    quotients.push({ party: 'R', value: r_votes / div, votes: r_votes });
  }

  // Sort descending. Ties broken by larger original vote total, then by 'D' < 'R'
  // (deterministic and matches the plan's spirit: 50/50 in a 2-seat state → 1-1).
  quotients.sort((a, b) => {
    if (Math.abs(a.value - b.value) > EPSILON) return b.value - a.value;
    if (a.votes !== b.votes) return b.votes - a.votes;
    return a.party === b.party ? 0 : a.party === 'D' ? -1 : 1;
  });

  let d = 0;
  let r = 0;
  for (let i = 0; i < seats; i++) {
    if (quotients[i].party === 'D') d++;
    else r++;
  }
  return { d_seats: d, r_seats: r };
}

function sainteLague(input: AllocationInput): AllocationResult {
  return divisorMethod(input, (i) => 2 * i + 1);
}

function dHondt(input: AllocationInput): AllocationResult {
  return divisorMethod(input, (i) => i + 1);
}

function hamilton(input: AllocationInput): AllocationResult {
  const { seats, d_votes, r_votes } = input;
  if (seats <= 0) return { d_seats: 0, r_seats: 0 };
  const total = d_votes + r_votes;
  if (total <= 0) return { d_seats: 0, r_seats: 0 };

  const dQuota = (d_votes / total) * seats;
  const rQuota = (r_votes / total) * seats;
  let d = Math.floor(dQuota);
  let r = Math.floor(rQuota);
  let remaining = seats - d - r;

  // Assign leftover seats by largest fractional remainder.
  const dRem = dQuota - d;
  const rRem = rQuota - r;
  while (remaining > 0) {
    if (dRem > rRem + EPSILON) d++;
    else if (rRem > dRem + EPSILON) r++;
    else if (d_votes >= r_votes) d++;
    else r++;
    remaining--;
  }
  return { d_seats: d, r_seats: r };
}

export function allocate(
  input: AllocationInput,
  method: AllocationMethod = 'sainte-lague',
): AllocationResult {
  switch (method) {
    case 'sainte-lague':
      return sainteLague(input);
    case 'dhondt':
      return dHondt(input);
    case 'hamilton':
      return hamilton(input);
  }
}

/**
 * Returns the full quotient table for a divisor method, useful for the
 * "show the math" panel in the state detail UI.
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
  all.sort((a, b) => {
    if (Math.abs(a.value - b.value) > EPSILON) return b.value - a.value;
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
