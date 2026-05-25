/**
 * Color scales for the map. Two distinct hue pairs so the Delegation Balance
 * view and the Distortion view are visually distinguishable at a glance
 * (per the methodology + review notes).
 *
 * Balance: D blue ↔ R red, ColorBrewer-style RdBu, CB-friendly.
 * Distortion: D purple ↔ R orange, distinct from the balance palette.
 *
 * Input `margin` is in [-1, 1] (positive = D advantage in seat margin).
 */

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function divergingScale(margin: number, dColor: [number, number, number], rColor: [number, number, number]): string {
  const m = Math.max(-1, Math.min(1, margin));
  const neutral: [number, number, number] = [240, 240, 240];
  if (m === 0) return rgb(...neutral);
  const target = m > 0 ? dColor : rColor;
  const t = Math.min(1, Math.abs(m) * 1.4); // boost saturation for typical small margins
  return rgb(lerp(neutral[0], target[0], t), lerp(neutral[1], target[1], t), lerp(neutral[2], target[2], t));
}

const D_BLUE: [number, number, number] = [33, 102, 172];
const R_RED: [number, number, number] = [178, 24, 43];
const D_PURPLE: [number, number, number] = [94, 60, 153];
const R_ORANGE: [number, number, number] = [230, 97, 1];

export function balanceColor(seatMargin: number): string {
  return divergingScale(seatMargin, D_BLUE, R_RED);
}

export function distortionColor(seatMargin: number): string {
  return divergingScale(seatMargin, D_PURPLE, R_ORANGE);
}

/**
 * Compute the seat-margin signal in [-1, 1] for a state.
 * For "balance" view: (D - R) / seats of the *projected* delegation.
 * For "distortion" view: ((projected_D - actual_D) - (projected_R - actual_R)) / seats.
 *   i.e., the net D shift under PR, normalized.
 */
export function balanceMargin(d: number, r: number, seats: number): number {
  if (seats <= 0) return 0;
  return (d - r) / seats;
}

export function distortionMargin(
  projectedD: number,
  projectedR: number,
  actualD: number,
  actualR: number,
  seats: number,
): number {
  if (seats <= 0) return 0;
  const shift = (projectedD - actualD) - (projectedR - actualR);
  return shift / seats;
}

/**
 * Pick the fill color for a state under extended (N-party) sandbox mode.
 * Returns the color of whichever party holds the most seats. Ties (e.g.
 * 26 D / 26 R / 0 PROG in a 52-seat state) fall back to the neutral
 * balance scale to communicate "no plurality" rather than picking one
 * arbitrarily.
 */
export function pluralityColor(
  parties: Array<{ color: string; seats: number }>,
): string {
  if (parties.length === 0) return 'rgb(240, 240, 240)';
  let maxSeats = -1;
  let winnerIdx = -1;
  let tie = false;
  for (let i = 0; i < parties.length; i++) {
    const s = parties[i].seats;
    if (s > maxSeats) {
      maxSeats = s;
      winnerIdx = i;
      tie = false;
    } else if (s === maxSeats) {
      tie = true;
    }
  }
  if (tie || winnerIdx < 0) return 'rgb(240, 240, 240)';
  return parties[winnerIdx].color;
}

/**
 * Return the *minor* party (i.e. not D, not R) with the most seats in a
 * state, or null if no minor has any seats. Used by Map.tsx to decide
 * whether to overlay diagonal stripes on a state — when a major has
 * plurality but a minor still won at least one seat, the stripe signals
 * "third-party representation here."
 *
 * Ties between minors are broken by input order (the parties array is
 * canonical: [D, R, minors-in-add-order], so PROG outranks AF when both
 * tie). Pure function; the seat-comparison logic mirrors `pluralityColor`.
 */
export function topMinorWithSeats<T extends { party: { id: string }; seats: number }>(
  parties: T[],
  majorIds: ReadonlySet<string> = MAJOR_IDS,
): T | null {
  let best: T | null = null;
  for (const p of parties) {
    if (majorIds.has(p.party.id)) continue;
    if (p.seats <= 0) continue;
    if (best === null || p.seats > best.seats) {
      best = p;
    }
  }
  return best;
}

const MAJOR_IDS: ReadonlySet<string> = new Set(['D', 'R']);
