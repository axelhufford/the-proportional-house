import { useEffect, useRef, useState } from 'react';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Animate an integer toward `target` over `durationMs` (easeOutCubic, via
 * requestAnimationFrame) when the value *changes* — e.g. switching views or
 * dragging the Sandbox slider. The initial render shows `target` immediately
 * (not a count from 0): the headline stat must always read correctly, even
 * before the first animation frame, in a background tab, or where rAF never
 * fires. Returns `target` instantly under prefers-reduced-motion.
 */
export function useCountUp(target: number, durationMs = 600): number {
  const reduce = prefersReducedMotion();
  const [value, setValue] = useState(target);
  const ref = useRef(target);

  useEffect(() => {
    const from = ref.current;
    if (reduce || from === target) {
      ref.current = target;
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(from + (target - from) * eased);
      ref.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(step);
      else {
        ref.current = target;
        setValue(target);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, reduce]);

  return value;
}
