import { useEffect, useRef, useState, type ReactNode } from 'react';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Subtle one-time fade-and-rise as a block scrolls into view. Used only on
 * below-the-fold sections — never the hero — so there's no LCP impact.
 *
 * Safety: starts *shown* when reduced motion is preferred or IntersectionObserver
 * is unavailable, so content is never hidden if the effect can't run. Otherwise
 * it starts hidden and reveals on intersection (and disconnects after).
 */
export function Reveal({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const canAnimate =
    typeof IntersectionObserver !== 'undefined' && !prefersReducedMotion();
  const [shown, setShown] = useState(!canAnimate);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canAnimate || shown) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    io.observe(el);
    // Safety net: never leave content hidden if the observer doesn't fire
    // (throttled background tab, environments without a layout pass, etc.).
    const fallback = window.setTimeout(() => setShown(true), 1200);
    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
  }, [canAnimate, shown]);

  return (
    <div
      ref={ref}
      className={`transition-[opacity,transform] duration-[400ms] ease-out motion-reduce:transition-none ${
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      } ${className}`}
    >
      {children}
    </div>
  );
}
