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

/**
 * Generic-ballot margin label: 'D+6.9' / 'R+2.5' / 'Tie' at dead even.
 *
 * Positive = D lead (the pipeline's sign convention throughout). The Tie band
 * tracks the displayed precision — anything that would render as "D+0.0" or
 * "R+0.0" reads as a tie instead, so the label never claims a lead it isn't
 * showing a number for. At `digits: 0` that band widens to |m| < 0.5.
 *
 * This is the single formatter for margins across the app. Several call sites
 * used to inline `m >= 0 ? \`D+${m.toFixed(1)}\` : …`, which has no Tie branch —
 * so with the sandbox slider at exactly 0.0 the page showed "Tie" in the slider
 * readout and "D+0.0" in the hero and settings line simultaneously.
 *
 * Non-finite input renders as an em dash rather than "NaN".
 */
export function fmtMargin(m: number | null | undefined, digits = 1): string {
  if (m == null || !Number.isFinite(m)) return '—';
  if (Math.abs(m) < 0.5 * 10 ** -digits) return 'Tie';
  return m >= 0 ? `D+${m.toFixed(digits)}` : `R+${Math.abs(m).toFixed(digits)}`;
}
