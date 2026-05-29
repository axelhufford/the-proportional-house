import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { StateDetailContent } from './StateDetailContent';
import type { AllocationMethodKind } from '../lib/methods';
import type { SandboxStateProjection } from '../lib/sandboxTypes';
import type { StateProjection, ProjectionMeta } from '../lib/types';

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
}

type Phase = 'entering' | 'open' | 'exiting';

/**
 * Mobile shell for the StateDetail. Bottom-anchored sheet that slides up
 * from the bottom edge on mount and back down on close. Includes:
 *
 *   - Backdrop with its own fade (tap to dismiss).
 *   - Body scroll lock while open so the page beneath doesn't scroll.
 *   - Safe-area inset padding so content doesn't sit under the home indicator.
 *   - Decorative drag handle (visual affordance only; no drag gesture in v1).
 *
 * Like the side panel, the exit animation is driven inside the shell — the
 * parent `onClose` is only invoked after the transform transition completes
 * so the sheet animates out instead of disappearing.
 */
export function StateDetailBottomSheet({ state, meta, allStates, onClose, sandboxState, method, methodLabel, houseSize, threshold }: Props) {
  const [phase, setPhase] = useState<Phase>('entering');

  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setPhase('open'));
    return () => cancelAnimationFrame(id);
  }, []);

  const startClose = useCallback(() => {
    setPhase((p) => (p === 'exiting' ? p : 'exiting'));
  }, []);

  // Body scroll lock while open. Restore the original overflow on unmount
  // so we don't leak state if the user switches sheets quickly.
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        startClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [startClose]);

  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLElement>) => {
      if (e.propertyName !== 'transform') return;
      if (phase === 'exiting') onClose();
    },
    [phase, onClose],
  );

  // Fallback so onClose always fires once we start exiting. The exit normally
  // completes via onTransitionEnd above, but a transitionend isn't guaranteed:
  // prefers-reduced-motion disables the transition (motion-reduce:transition-none),
  // and a re-render can interrupt/cancel it. Without this, onClose would never
  // run, selectedFips would never clear, and the sheet would stay mounted but
  // stuck off-screen — silently swallowing the next state tap. If the
  // transition does fire, the unmount clears this timer via the cleanup.
  useEffect(() => {
    if (phase !== 'exiting') return;
    const id = setTimeout(onClose, 320); // just past the 250ms transform tween
    return () => clearTimeout(id);
  }, [phase, onClose]);

  const sheetTranslate = phase === 'open' ? 'translate-y-0' : 'translate-y-full';
  const backdropOpacity = phase === 'open' ? 'opacity-100' : 'opacity-0';

  return (
    <>
      <div
        aria-hidden="true"
        onClick={startClose}
        className={[
          'fixed inset-0 bg-stone-900/40 z-30',
          'transition-opacity duration-200 ease-out motion-reduce:transition-none',
          backdropOpacity,
        ].join(' ')}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${state.name} detail`}
        onTransitionEnd={handleTransitionEnd}
        // Safe-area inset: pad the bottom so content sits above the iPhone
        // home indicator and any other notched-device chrome.
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        className={[
          'fixed bottom-0 left-0 right-0 z-40 max-h-[90vh] rounded-t-2xl',
          'bg-white border-t border-stone-200 shadow-2xl overflow-y-auto',
          'transform transition-transform duration-[250ms] ease-out motion-reduce:transition-none',
          sheetTranslate,
        ].join(' ')}
      >
        {/* Visual drag-handle affordance. v1 has no drag gesture; the handle
         * is a familiar mobile cue so users know the sheet can be dismissed. */}
        <div aria-hidden="true" className="flex justify-center pt-2 pb-1">
          <span className="block h-1.5 w-12 rounded-full bg-stone-300" />
        </div>
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
        />
      </aside>
    </>
  );
}
