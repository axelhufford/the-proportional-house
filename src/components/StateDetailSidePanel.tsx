import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDismissable } from '../lib/useDismissable';
import { StateDetailContent } from './StateDetailContent';
import type { AllocationMethodKind } from '../lib/methods';
import type { SandboxStateProjection } from '../lib/sandboxTypes';
import type { StateProjection, ProjectionMeta, StateRetroPoint, ViewMode } from '../lib/types';

interface Props {
  state: StateProjection;
  meta: ProjectionMeta;
  allStates: StateProjection[];
  onClose: () => void;
  sandboxState?: SandboxStateProjection | null;
  method?: AllocationMethodKind;
  methodLabel?: string;
  houseSize?: number;
  threshold?: number;
  retroHistory?: StateRetroPoint[];
  viewMode?: ViewMode;
  retroYear?: number;
}

type Phase = 'entering' | 'open' | 'exiting';

/**
 * Desktop shell for the StateDetail. Right-anchored fixed panel that slides
 * in from the right edge on mount and back out on close. The exit animation
 * is handled inside the shell — when the user clicks close (or hits
 * Escape), we set phase='exiting' and only call the parent `onClose` after
 * the transform transition completes, so the panel doesn't pop out.
 */
export function StateDetailSidePanel({ state, meta, allStates, onClose, sandboxState, method, methodLabel, houseSize, threshold, retroHistory, viewMode, retroYear }: Props) {
  const [phase, setPhase] = useState<Phase>('entering');
  const panelRef = useRef<HTMLElement>(null);

  // Flip from 'entering' to 'open' on the next frame so the transition has
  // an initial (off-screen) keyframe to interpolate from.
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setPhase('open'));
    return () => cancelAnimationFrame(id);
  }, []);

  const startClose = useCallback(() => {
    setPhase((p) => (p === 'exiting' ? p : 'exiting'));
  }, []);

  // Escape closes when focus is inside the panel. Deliberately NOT modal: the
  // map stays visible and clickable beside this panel — picking another state
  // without closing is a normal flow — so there's no scroll lock and no focus
  // trap, and the wrapper below doesn't set aria-modal. Trapping Tab inside a
  // surface the mouse can freely leave would be worse than not trapping.
  useDismissable({ ref: panelRef, onDismiss: startClose, modal: false });

  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLElement>) => {
      // transitionend fires once per animated property — gate on transform so
      // we don't double-fire on browsers that animate multiple properties.
      if (e.propertyName !== 'transform') return;
      if (phase === 'exiting') onClose();
    },
    [phase, onClose],
  );

  // Fallback so onClose always fires once we start exiting. The exit normally
  // completes via onTransitionEnd above, but a transitionend isn't guaranteed:
  // prefers-reduced-motion disables the transition (motion-reduce:transition-none),
  // and a re-render can interrupt/cancel it. Without this, onClose would never
  // run, selectedFips would never clear, and the panel would stay mounted but
  // stuck off-screen — silently swallowing the next state click. If the
  // transition does fire, the unmount clears this timer via the cleanup.
  useEffect(() => {
    if (phase !== 'exiting') return;
    const id = setTimeout(onClose, 260); // just past the 200ms transform tween
    return () => clearTimeout(id);
  }, [phase, onClose]);

  const translateClass = phase === 'open' ? 'translate-x-0' : 'translate-x-full';

  return (
    <aside
      ref={panelRef}
      role="dialog"
      // No aria-modal: the rest of the page stays visible and operable next to
      // this panel. Claiming modality would tell screen readers to hide the map
      // and controls that sighted users can still see and click.
      aria-label={`${state.name} detail`}
      onTransitionEnd={handleTransitionEnd}
      className={[
        'fixed top-0 bottom-0 right-0 w-[28rem] max-w-full',
        'bg-white border-l border-stone-200 shadow-2xl overflow-y-auto',
        // Transform-based slide: GPU-friendly and doesn't disturb layout.
        'transform transition-transform duration-200 ease-out motion-reduce:transition-none',
        translateClass,
      ].join(' ')}
    >
      <StateDetailContent
        state={state}
        meta={meta}
        allStates={allStates}
        onClose={startClose}
        sandboxState={sandboxState}
        method={method}
        methodLabel={methodLabel}
        houseSize={houseSize}
        threshold={threshold}
        retroHistory={retroHistory}
        viewMode={viewMode}
        retroYear={retroYear}
      />
    </aside>
  );
}
