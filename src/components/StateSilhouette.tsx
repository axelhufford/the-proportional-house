import type { StateSilhouette as StateSilhouetteData } from '../lib/stateSilhouettes';

interface Props {
  /** Pre-computed path + cropped viewBox from `buildStateSilhouettes`. */
  silhouette: StateSilhouetteData;
  /** Fill color for the shape (e.g. a party color or a neutral gray). */
  fill: string;
  className?: string;
}

/**
 * A small, decorative silhouette of a single U.S. state's outline. Purely
 * visual — the surrounding context (state name text, the row's link) already
 * carries the meaning — so it's `aria-hidden`. The path is drawn in the
 * shared 975×610 projection space and the `viewBox` zooms onto just this
 * state, so it scales cleanly to any box via the parent's sizing classes.
 */
export function StateSilhouette({ silhouette, fill, className }: Props) {
  return (
    <svg
      viewBox={silhouette.viewBox}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <path d={silhouette.d} fill={fill} />
    </svg>
  );
}
