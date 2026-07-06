/**
 * The hero's "stakes" sentence: where House control itself would flip.
 *
 * The tipping margin is computed by the pipeline (bisection over the same
 * pure projection model) and shipped in meta.majority. Wording is
 * direction-neutral — "control flips at D+0.8" is correct whichever side of
 * today's margin the crossing sits on.
 */
import { fmtMargin } from './format';

/** Generic-ballot D-margin where projected D seats reach 218 (meta.majority). */
export function majorityTippingSentence(tippingMargin: number): string {
  const label = fmtMargin(tippingMargin);
  const at = label === 'Tie' ? 'at an even national vote' : `at ${label} on the generic ballot`;
  return `Control of the House itself would flip ${at}.`;
}
