/**
 * Parliament-arc ("hemicycle") seat layout — a pure, deterministic geometry
 * helper for the hero visualization. Given a seat total, it returns dot
 * positions arranged in a semicircle of rows, ordered left→right along the
 * angular sweep so a party's seats fill a contiguous wedge when colored in
 * order. No dependencies; rendered as plain SVG by Hemicycle.tsx.
 *
 * Coordinate space: normalized to an outer radius of 100, with a small seat-
 * radius pad so dots never clip the viewBox. The component scales it to fit.
 */

export interface HemicycleSeat {
  x: number;
  y: number;
}

export interface HemicycleLayout {
  /** Seat centers, ordered left→right (leftmost = the start of the arc). */
  seats: HemicycleSeat[];
  /** Dot radius in the same coordinate space. */
  seatR: number;
  /** SVG viewBox width/height and the arc center. */
  width: number;
  height: number;
  cx: number;
  cy: number;
  outerRadius: number;
}

const OUTER_RADIUS = 100;

/**
 * Compute seat positions for a hemicycle of `total` seats.
 *
 * Rows scale with the seat count (≈ √(total/3), so 435 → ~12 rows). Seats per
 * row are proportional to the row's radius (outer rows are longer arcs and hold
 * more), distributed to sum to exactly `total` via largest-remainder rounding.
 */
export function computeHemicycleSeats(
  total: number,
  opts?: { innerRatio?: number; rows?: number },
): HemicycleLayout {
  const innerRatio = opts?.innerRatio ?? 0.42;
  const R = OUTER_RADIUS;

  if (total <= 0) {
    const seatR = 2;
    return {
      seats: [],
      seatR,
      cx: R + seatR,
      cy: R + seatR,
      outerRadius: R,
      width: 2 * (R + seatR),
      height: R + 2 * seatR,
    };
  }

  const rows = opts?.rows ?? Math.max(2, Math.min(18, Math.round(Math.sqrt(total / 3))));

  // Row radii evenly spaced from innerRatio·R (innermost) to R (outermost).
  const rowRadii: number[] = [];
  for (let i = 0; i < rows; i++) {
    const t = rows === 1 ? 1 : i / (rows - 1);
    rowRadii.push(R * (innerRatio + (1 - innerRatio) * t));
  }

  // Seats per row ∝ radius, summed to exactly `total` (largest-remainder).
  const weight = rowRadii.reduce((a, b) => a + b, 0);
  const raw = rowRadii.map((r) => (r / weight) * total);
  const counts = raw.map((c) => Math.floor(c));
  let remaining = total - counts.reduce((a, b) => a + b, 0);
  const byFrac = raw
    .map((c, i) => ({ i, frac: c - Math.floor(c) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remaining > 0; k++, remaining--) {
    counts[byFrac[k % byFrac.length].i]++;
  }

  const rowSpacing =
    rows > 1 ? (R * (1 - innerRatio)) / (rows - 1) : R * (1 - innerRatio);
  const seatR = Math.max(1.2, rowSpacing * 0.42);
  const cx = R + seatR;
  const cy = R + seatR;

  // Place each row's seats along its arc from θ≈π (left) to θ≈0 (right),
  // centered within the span so they don't sit exactly on the baseline.
  const placed: { x: number; y: number; theta: number }[] = [];
  for (let i = 0; i < rows; i++) {
    const k = counts[i];
    const r = rowRadii[i];
    for (let j = 0; j < k; j++) {
      const theta = k === 1 ? Math.PI / 2 : Math.PI * (1 - (j + 0.5) / k);
      placed.push({
        x: cx + r * Math.cos(theta),
        y: cy - r * Math.sin(theta),
        theta,
      });
    }
  }

  // Order left→right (largest θ = leftmost) so coloring fills a radial wedge.
  placed.sort((a, b) => b.theta - a.theta);

  return {
    seats: placed.map(({ x, y }) => ({ x, y })),
    seatR,
    cx,
    cy,
    outerRadius: R,
    width: 2 * (R + seatR),
    height: R + 2 * seatR,
  };
}
