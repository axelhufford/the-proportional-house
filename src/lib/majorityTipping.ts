/**
 * The hero's "stakes" sentence: where House control itself would flip.
 *
 * The tipping margin is computed by the pipeline (bisection over the same
 * pure projection model) and shipped in meta.majority. Wording is
 * direction-neutral — "control flips at D+0.8" is correct whichever side of
 * today's margin the crossing sits on.
 */
import { fmtMargin } from './format';

export function majorityTippingSentence(args: {
  /** Generic-ballot D-margin where projected D seats reach 218. */
  tippingMargin: number;
  /** Today's generic-ballot D-margin. */
  currentMargin: number;
  /** Polling-error ε when a band is shipped; ties the sentence to it. */
  epsilonPoints?: number;
}): string {
  const { tippingMargin, currentMargin, epsilonPoints } = args;
  const label = fmtMargin(tippingMargin);
  const at = label === 'Tie' ? 'at an even national vote' : `at ${label} on the generic ballot`;

  if (epsilonPoints !== undefined) {
    const inside = Math.abs(tippingMargin - currentMargin) <= epsilonPoints + 1e-9;
    return `Control of the House itself would flip ${at} — ${
      inside ? 'inside' : 'outside'
    } that range.`;
  }
  const distance = Math.abs(tippingMargin - currentMargin);
  return `Control of the House itself would flip ${at} — ${distance.toFixed(1)} points from today's average.`;
}
