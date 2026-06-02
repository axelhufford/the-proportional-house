import { StateDetailBottomSheet } from './StateDetailBottomSheet';
import { StateDetailSidePanel } from './StateDetailSidePanel';
import { useIsMobile } from '../lib/useIsMobile';
import type { AllocationMethodKind } from '../lib/methods';
import type { SandboxStateProjection } from '../lib/sandboxTypes';
import type { StateProjection, ProjectionMeta, StateRetroPoint } from '../lib/types';

interface Props {
  state: StateProjection;
  meta: ProjectionMeta;
  allStates: StateProjection[];
  onClose: () => void;
  /** Sandbox extended-mode N-party slice for this state. Optional. */
  sandboxState?: SandboxStateProjection | null;
  /** Active allocation method — affects the panel's labels and the math-demo visibility. */
  method?: AllocationMethodKind;
  /** Display label override for the active method (e.g. "MMD-4" when a slider is dialed off-preset). */
  methodLabel?: string;
  /** Active sandbox House size — drives the settings-line badge. */
  houseSize?: number;
  /** Active sandbox per-state threshold — drives the settings-line badge when minors are active. */
  threshold?: number;
  /** Per-cycle PR-vs-actual history for this state (2016–2024). */
  retroHistory?: StateRetroPoint[];
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
  // Key on shell kind *and* the selected state's fips. The shell-kind part
  // unmounts cleanly when the user crosses the breakpoint (e.g. rotating a
  // tablet) instead of re-anchoring a partially-animated sheet. The fips part
  // ensures that selecting a *different* state always mounts a fresh shell
  // that animates in from its closed phase — otherwise a single long-lived
  // instance can carry a stale 'exiting' phase into the new selection and
  // render off-screen, so the panel appears not to open.
  return isMobile ? (
    <StateDetailBottomSheet key={`sheet-${props.state.fips}`} {...props} />
  ) : (
    <StateDetailSidePanel key={`panel-${props.state.fips}`} {...props} />
  );
}
