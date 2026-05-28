/**
 * Format a seat count's share of a total as a parenthetical percentage.
 *
 * Used wherever the UI shows raw seat integers ("D 234 · R 201") so the
 * reader can also see the share-of-chamber at a glance ("D 234 (54%) · R 201 (46%)").
 *
 * Integer-rounded by design. Decimals (54.3%) add noise without adding
 * insight at the granularity users actually compare at. Each party is
 * rounded independently — we don't force the parts to sum to 100%, since
 * doing so creates awkward jumps for equal seat counts.
 *
 * Returns "" when total <= 0 so the call-site can render without guarding:
 *
 *   `${seats} ${formatSeatPct(seats, total)}`
 *
 * That produces "234 " (trailing space) in the degenerate case, which is
 * fine for display — React collapses it. If a caller cares, gate on the
 * non-empty return value.
 */
export function formatSeatPct(seats: number, total: number): string {
  if (total <= 0) return '';
  return `(${Math.round((seats / total) * 100)}%)`;
}
