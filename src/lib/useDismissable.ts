import { useEffect, type RefObject } from 'react';

/** Elements that can receive keyboard focus, for the focus trap. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Options {
  /** The dialog container. */
  ref: RefObject<HTMLElement | null>;
  /** Called when the user asks to dismiss (Escape). */
  onDismiss: () => void;
  /**
   * True for a genuinely modal surface — one that covers the page with a
   * blocking backdrop. Locks body scroll and traps Tab inside the container.
   *
   * Pass false for a non-modal panel that leaves the page interactive. Trapping
   * focus in a surface the user can still click past is worse than not
   * trapping: Tab would refuse to leave a panel the mouse can leave freely.
   */
  modal?: boolean;
}

/**
 * Escape-to-dismiss, optional scroll lock, and optional focus trap.
 *
 * The Escape listener is deliberately scoped: it only fires when focus is
 * inside the container. Both state-detail shells previously listened on
 * `window` and called `preventDefault()` unconditionally, so an open panel
 * swallowed Escape for everything else on the page — including dismissing the
 * masthead's search dropdown, which stays reachable while the panel is open.
 */
export function useDismissable({ ref, onDismiss, modal = false }: Options): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = ref.current;
      // Only claim Escape when it's ours to claim.
      if (el && !el.contains(document.activeElement)) return;
      e.preventDefault();
      onDismiss();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [ref, onDismiss]);

  // Body scroll lock — modal surfaces only. Restores the previous value rather
  // than clearing it, so switching between panels can't leak a locked body.
  useEffect(() => {
    if (!modal) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [modal]);

  // Focus trap — modal surfaces only.
  useEffect(() => {
    if (!modal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const el = ref.current;
      if (!el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [ref, modal]);
}
