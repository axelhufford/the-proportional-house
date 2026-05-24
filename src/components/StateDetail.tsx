import { StateDetailBottomSheet } from './StateDetailBottomSheet';
import { StateDetailSidePanel } from './StateDetailSidePanel';
import { useIsMobile } from '../lib/useIsMobile';
import type { SandboxStateProjection } from '../lib/sandboxTypes';
import type { StateProjection, ProjectionMeta } from '../lib/types';

interface Props {
  state: StateProjection;
  meta: ProjectionMeta;
  allStates: StateProjection[];
  onClose: () => void;
  /** Sandbox extended-mode N-party slice for this state. Optional. */
  sandboxState?: SandboxStateProjection | null;
}

/**
 * Thin chooser: picks the right shell for the viewport.
 *
 *   - md+ (≥ 768px): right-side panel that slides in from the right.
 *   - < md: bottom sheet that slides up from below, with backdrop + body-
 *     scroll lock.
 *
 * Both shells render the same `StateDetailContent`. The split exists so the
 * /embed/state/:code route can render `StateDetailContent` directly without
 * any shell chrome — see `src/pages/EmbedState.tsx`.
 */
export function StateDetail(props: Props) {
  const isMobile = useIsMobile();
  // Keying on mobile-ness ensures the shell unmounts cleanly when the user
  // crosses the breakpoint (e.g. rotating a tablet) instead of trying to
  // re-anchor a partially-animated sheet.
  return isMobile ? (
    <StateDetailBottomSheet key="sheet" {...props} />
  ) : (
    <StateDetailSidePanel key="panel" {...props} />
  );
}
