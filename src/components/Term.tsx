import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { GLOSSARY, type GlossarySlug } from '../lib/glossary';

interface TermProps {
  id: GlossarySlug;
  /** Display text; defaults to the glossary term's canonical name. */
  children?: React.ReactNode;
}

/**
 * Inline glossary term with an accessible definition popover. Opens on hover,
 * keyboard focus, or tap; closes on Escape, blur, or outside pointer-down. The
 * "Learn more →" link deep-links into the matching Methodology section (handled
 * by ScrollManager). Definitions come from src/lib/glossary.ts.
 *
 * mouseenter/leave live on the wrapper (not the button) so moving the pointer
 * onto the popover — a descendant — doesn't dismiss it; the popover sits flush
 * at top-full with its gap as internal padding so there's no dead strip.
 */
export function Term({ id, children }: TermProps) {
  const entry = GLOSSARY[id];
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Tap-away / click-outside dismissal (covers touch, where there's no blur).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-describedby={open ? tipId : undefined}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        style={{ font: 'inherit', color: 'inherit' }}
        className="cursor-help border-b border-dotted border-stone-400 hover:border-stone-600"
      >
        {children ?? entry.term}
        <span aria-hidden="true" className="ml-0.5 align-super text-[0.65em] opacity-60">
          ⓘ
        </span>
      </button>
      {open && (
        <span role="tooltip" id={tipId} className="absolute left-1/2 top-full z-50 -translate-x-1/2 pt-1.5">
          <span className="block w-64 max-w-[calc(100vw-2rem)] rounded-md border border-stone-200 bg-white p-3 text-left text-xs font-normal not-italic leading-snug text-stone-700 shadow-lg">
            <span className="block font-semibold text-stone-900">{entry.term}</span>
            <span className="mt-1 block text-stone-600">{entry.short}</span>
            {entry.anchor && (
              <Link
                to={`/methodology#${entry.anchor}`}
                className="mt-2 inline-block font-medium text-brand-navy underline underline-offset-2 hover:text-brand-navy-mid"
              >
                Learn more →
              </Link>
            )}
          </span>
        </span>
      )}
    </span>
  );
}
