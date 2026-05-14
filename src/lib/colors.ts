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
