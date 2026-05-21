import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectionPayload, StateProjection } from '../lib/types';

/**
 * Jump-to-state search input in the masthead.
 *
 * Implementation: a plain <input list="…"> backed by a <datalist>. The
 * browser handles the dropdown, fuzzy match, and keyboard navigation —
 * no library, no JS overhead, fully accessible. Trade-off vs a custom
 * Combobox: limited styling control over the dropdown, no "did you
 * mean" hinting. Worth it for instant load + native a11y.
 *
 * The component fetches /data/projection.json itself the first time it
 * mounts. The browser caches the file so subsequent mounts are free.
 * This keeps the Layout/Masthead pipeline simple — no need to thread a
 * states prop through every page.
 */
export function StateSearch() {
  const navigate = useNavigate();
  const [states, setStates] = useState<StateProjection[] | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/data/projection.json')
      .then((r) => r.json() as Promise<ProjectionPayload>)
      .then((payload) => {
        if (!cancelled) setStates(payload.states);
      })
      .catch(() => {
        // Silent fail — the search just stays empty rather than breaking
        // the masthead.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!states) return;
    const needle = value.trim().toLowerCase();
    if (!needle) return;
    // Match against name (datalist sets this on selection) or 2-letter code.
    const match = states.find(
      (s) =>
        s.name.toLowerCase() === needle ||
        s.code.toLowerCase() === needle,
    );
    if (!match) return;
    navigate(`/?state=${match.code}`);
    setValue('');
    inputRef.current?.blur();
  };

  // When the user picks an option from the datalist, the input's change
  // event fires with the full state name. Auto-navigate so they don't
  // have to also press Enter.
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setValue(next);
    if (!states) return;
    const exact = states.find((s) => s.name === next);
    if (exact) {
      navigate(`/?state=${exact.code}`);
      setValue('');
      inputRef.current?.blur();
    }
  };

  return (
    <form
      role="search"
      onSubmit={handleSubmit}
      className="flex items-center"
      aria-label="Jump to a state"
    >
      <label htmlFor="state-search-input" className="sr-only">
        Jump to a state
      </label>
      <input
        ref={inputRef}
        id="state-search-input"
        list="state-search-list"
        type="text"
        value={value}
        onChange={handleChange}
        placeholder="Jump to state…"
        autoComplete="off"
        spellCheck="false"
        className="w-32 sm:w-44 px-3 py-1 text-sm rounded-full border border-stone-300 bg-white text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy"
      />
      <datalist id="state-search-list">
        {states?.map((s) => (
          <option key={s.fips} value={s.name} />
        ))}
      </datalist>
    </form>
  );
}
