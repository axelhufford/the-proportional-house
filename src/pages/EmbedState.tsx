import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { StateDetailContent } from '../components/StateDetailContent';
import { useEmbedHeightSync } from '../lib/embedPostMessage';
import type { ProjectionPayload } from '../lib/types';

/**
 * /embed/state/:code — chrome-less state-detail card for iframe embedding.
 *
 * Renders `StateDetailContent` directly with no shell — no close button,
 * no slide animation, no body-scroll lock. Just the seat split, math,
 * polling chart, and similar-states grid. Posts height to the parent.
 */
export function EmbedState() {
  const { code } = useParams<{ code: string }>();
  const [payload, setPayload] = useState<ProjectionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const existing = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const target = code
      ? `https://proportionalhouse.org/state/${code.toLowerCase()}`
      : 'https://proportionalhouse.org/';
    if (existing) existing.href = target;
  }, [code]);

  useEffect(() => {
    fetch('/data/projection.json')
      .then((r) => r.json() as Promise<ProjectionPayload>)
      .then(setPayload)
      .catch((e) => setError(String(e)));
  }, []);

  const state = useMemo(() => {
    if (!payload || !code) return null;
    const upper = code.toUpperCase();
    return payload.states.find((s) => s.code === upper) ?? null;
  }, [payload, code]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  useEmbedHeightSync(containerRef);

  if (error) {
    return (
      <div ref={containerRef} className="p-6 text-sm text-red-700">
        Couldn’t load the projection: {error}
      </div>
    );
  }

  if (!payload) {
    return (
      <div ref={containerRef} className="p-6 text-sm text-stone-500 text-center">
        Loading…
      </div>
    );
  }

  if (!state) {
    return (
      <div ref={containerRef} className="p-6 text-sm text-stone-600">
        Unknown state: <code className="font-mono">{code}</code>. Try a two-letter postal code
        like <code className="font-mono">CA</code>.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="bg-white text-stone-900 font-sans">
      <StateDetailContent
        state={state}
        meta={payload.meta}
        allStates={payload.states}
        // Embed has no close affordance — pass a no-op so the typings hold;
        // the controls are hidden anyway.
        onClose={() => {}}
        showHeaderControls={false}
        autoFocusHeading={false}
      />
      <div className="px-5 pb-4 pt-1 flex items-baseline justify-between text-xs text-stone-500 border-t border-stone-100">
        <span>Source: U.S. House Clerk + Silver Bulletin polls</span>
        <a
          href={`https://proportionalhouse.org/state/${state.code.toLowerCase()}?utm_source=embed`}
          target="_top"
          rel="noopener noreferrer"
          className="text-brand-navy hover:underline font-medium"
        >
          The Proportional House →
        </a>
      </div>
    </div>
  );
}
