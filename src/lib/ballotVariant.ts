/**
 * Generic-ballot average variants: selecting one, and projecting the site at it.
 *
 * The pipeline publishes an average computed over every poll in the window
 * ("standard") and one restricted to likely-voter polls ("lv"). Both come from
 * Silver Bulletin's public poll database and differ only in which polls they
 * include — the LV variant is our own filter, not a reproduction of Silver
 * Bulletin's likely-voter adjustment, which needs the LV/RV releases of the
 * same survey that the public CSV deduplicates away. The Methodology page
 * spells this out; nothing here should be labeled as his number.
 */
import { recomputeWithSwing } from './swing';
import type { BallotVariant, ProjectionPayload } from './types';

/** The variant shown when the user hasn't chosen one. */
export const DEFAULT_VARIANT_ID = 'standard';

/**
 * Every variant the payload offers, newest data first in pipeline order.
 *
 * Falls back to a single standard variant synthesized from the top-level meta
 * when `ballot_variants` is absent — a cached payload from before the toggle
 * shipped still renders, it just has nothing to toggle between.
 */
export function ballotVariants(payload: ProjectionPayload): BallotVariant[] {
  const published = payload.meta.ballot_variants;
  if (published && published.length > 0) return published;

  const { meta, national } = payload;
  return [
    {
      id: DEFAULT_VARIANT_ID,
      label: 'Standard average',
      short_label: 'All polls',
      note: 'Every generic-ballot poll in the window.',
      margin: meta.generic_ballot_margin,
      swing: meta.swing,
      n_polls: meta.n_polls_in_average ?? 0,
      populations: null,
      projected: national.projected,
      ...(meta.uncertainty ? { uncertainty: meta.uncertainty } : {}),
      ...(meta.majority ? { majority: meta.majority } : {}),
      ...(meta.closest_flips ? { closest_flips: meta.closest_flips } : {}),
    },
  ];
}

/** The requested variant, or the default one when the id isn't offered. */
export function resolveVariant(
  payload: ProjectionPayload,
  id: string | null | undefined,
): BallotVariant {
  const variants = ballotVariants(payload);
  return variants.find((v) => v.id === id) ?? variants[0];
}

/** Whether a toggle is worth rendering at all (a lone variant has no choices). */
export function hasVariantChoice(payload: ProjectionPayload): boolean {
  return ballotVariants(payload).length > 1;
}

/**
 * The projection as it stands under `variant`.
 *
 * The default variant IS the shipped payload, so it's returned untouched — no
 * recompute, no chance of drift between the toggle's default and the API.
 *
 * For any other variant the per-state seats are re-derived in the browser by
 * `recomputeWithSwing`, which reproduces the pipeline exactly (projection.json
 * publishes 6-decimal shares specifically so it can — see SHARE_PRECISION in
 * data-pipeline/update.py).
 *
 * But `recomputeWithSwing` deliberately DROPS `uncertainty`, `majority` and
 * `closest_flips`, since none of them survive a change of swing, and it spreads
 * the rest of meta through unchanged — which would leave `n_polls_in_average`
 * reporting the standard variant's poll count. So this is where the variant's
 * own pipeline-computed analytics get put back and the poll count corrected.
 * Doing it anywhere else is how the Current view silently loses its
 * uncertainty band the moment someone flips the toggle.
 */
export function applyVariant(
  payload: ProjectionPayload,
  variant: BallotVariant,
): ProjectionPayload {
  if (variant.id === ballotVariants(payload)[0].id) return payload;

  // Derive the swing from the published margin rather than reading
  // `variant.swing`, which the pipeline rounds to 2 decimals for display. The
  // pipeline projects at the UNROUNDED difference, and 0.005 points of margin
  // is enough to reorder two adjacent Sainte-Laguë quotients in a large
  // delegation — the same knife-edge that forced 6-decimal published shares.
  // Subtracting the published baseline here reproduces the pipeline's
  // arithmetic exactly, so seat counts match to the seat.
  const recomputed = recomputeWithSwing(payload, variant.margin - payload.meta.baseline_2024_margin);
  return {
    ...recomputed,
    meta: {
      ...recomputed.meta,
      // recomputeWithSwing derives the margin from the swing; use the
      // variant's published figure so rounding can't drift them apart.
      generic_ballot_margin: variant.margin,
      n_polls_in_average: variant.n_polls,
      // Stamp the identity so consumers downstream of the payload (the share
      // card, the embed) can label which average produced these numbers
      // without a prop threaded through every component in between.
      active_ballot_variant: variant,
      ...(variant.uncertainty ? { uncertainty: variant.uncertainty } : {}),
      ...(variant.majority ? { majority: variant.majority } : {}),
      ...(variant.closest_flips ? { closest_flips: variant.closest_flips } : {}),
    },
  };
}
