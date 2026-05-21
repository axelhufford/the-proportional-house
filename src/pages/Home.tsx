import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import type { Topology } from 'topojson-specification';
import { HomeHero } from '../components/HomeHero';
import { USMap } from '../components/Map';
import { MapLegend } from '../components/MapLegend';
import { NationalSummary } from '../components/NationalSummary';
import { ModeToggle } from '../components/ModeToggle';
import { Sandbox } from '../components/Sandbox';
import { StateDetail } from '../components/StateDetail';
import { recomputeWithSwing } from '../lib/swing';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import type { ProjectionPayload, ViewMode, ColorMode } from '../lib/types';

interface HomeProps {
  onMetaChange?: (payload: ProjectionPayload) => void;
}

const VIEW_MODES: ViewMode[] = ['current', 'retrospective', 'sandbox'];
const COLOR_MODES: ColorMode[] = ['balance', 'distortion'];

function parseViewMode(raw: string | null): ViewMode {
  return raw && (VIEW_MODES as string[]).includes(raw) ? (raw as ViewMode) : 'current';
}
function parseColorMode(raw: string | null): ColorMode {
  return raw && (COLOR_MODES as string[]).includes(raw) ? (raw as ColorMode) : 'balance';
}
function parseBallot(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < -15 || n > 15) return null;
  // Snap to 0.1 to match the slider step.
  return Math.round(n * 10) / 10;
}

export function Home({ onMetaChange }: HomeProps) {
  useDocumentTitle(
    'The Proportional House — U.S. House under proportional representation',
    'See how the U.S. House would look if every state allocated its seats by proportional representation, based on current generic-ballot polling.',
    '/',
  );

  const [searchParams, setSearchParams] = useSearchParams();

  const [payload, setPayload] = useState<ProjectionPayload | null>(null);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFips, setSelectedFips] = useState<string | null>(null);
  // Initialize view + color from URL on first render so deep links land in
  // the right mode without an intermediate flash.
  const [viewMode, setViewMode] = useState<ViewMode>(() => parseViewMode(searchParams.get('view')));
  const [colorMode, setColorMode] = useState<ColorMode>(() => parseColorMode(searchParams.get('color')));
  // Sandbox slider state: hypothetical generic-ballot margin in points.
  // Initialized from URL `ballot=` if present; otherwise from the pipeline
  // value once the payload loads.
  const [sandboxBallot, setSandboxBallot] = useState<number | null>(() => parseBallot(searchParams.get('ballot')));
  // The URL has a `state=XX` (state code) param that resolves to a FIPS once
  // the payload loads. Stash it pending payload-load.
  const pendingStateCodeRef = useRef<string | null>(searchParams.get('state'));
  // Track the FIPS of the last-clicked state so we can return keyboard focus
  // to it when the state-detail dialog closes.
  const lastSelectedFipsRef = useRef<string | null>(null);

  const handleSelect = useCallback((fips: string) => {
    lastSelectedFipsRef.current = fips;
    setSelectedFips(fips);
  }, []);

  const handleDeselect = useCallback(() => {
    const fips = lastSelectedFipsRef.current;
    setSelectedFips(null);
    // Defer the focus restore so React unmounts the dialog first.
    if (fips) {
      requestAnimationFrame(() => {
        const path = document.querySelector<SVGPathElement>(`svg path[data-fips="${fips}"]`);
        path?.focus();
      });
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/data/projection.json').then((r) => r.json()) as Promise<ProjectionPayload>,
      fetch('/data/states-10m.json').then((r) => r.json()) as Promise<Topology>,
    ])
      .then(([proj, topo]) => {
        setPayload(proj);
        setTopology(topo);
        setSandboxBallot((cur) => (cur === null ? proj.meta.generic_ballot_margin : cur));
        // Resolve any ?state=XX URL param to its FIPS now that the payload
        // is loaded. Invalid codes are silently ignored.
        const pending = pendingStateCodeRef.current;
        if (pending) {
          pendingStateCodeRef.current = null;
          const match = proj.states.find((s) => s.code === pending.toUpperCase());
          if (match) {
            lastSelectedFipsRef.current = match.fips;
            setSelectedFips(match.fips);
          }
        }
        onMetaChange?.(proj);
      })
      .catch((e) => setError(String(e)));
  }, [onMetaChange]);

  // Sync local state → URL so links are shareable. Defaults are omitted from
  // the URL to keep typical visits clean. Uses `replace` so back-button
  // history isn't polluted by every slider tick.
  useEffect(() => {
    if (!payload) return;
    const next = new URLSearchParams();
    if (viewMode !== 'current') next.set('view', viewMode);
    if (colorMode !== 'balance') next.set('color', colorMode);
    if (viewMode === 'sandbox' && sandboxBallot !== null) {
      // Only persist the ballot when it differs from the live pipeline value
      // (the default the slider sits on when sandbox first opens).
      const liveBallot = payload.meta.generic_ballot_margin;
      if (Math.abs(sandboxBallot - liveBallot) > 0.05) {
        next.set('ballot', sandboxBallot.toFixed(1));
      }
    }
    if (selectedFips) {
      const state = payload.states.find((s) => s.fips === selectedFips);
      if (state) next.set('state', state.code);
    }
    setSearchParams(next, { replace: true });
  }, [payload, viewMode, colorMode, sandboxBallot, selectedFips, setSearchParams]);

  // Derive what the user actually sees based on the active view mode.
  // - current: pipeline-computed projection (no client recompute).
  // - retrospective: 2024 PR under swing=0.
  // - sandbox: PR under user-controlled hypothetical generic-ballot.
  const effectivePayload = useMemo<ProjectionPayload | null>(() => {
    if (!payload) return null;
    if (viewMode === 'current') return payload;
    if (viewMode === 'retrospective') {
      return recomputeWithSwing(payload, 0);
    }
    // sandbox
    const ballot = sandboxBallot ?? payload.meta.generic_ballot_margin;
    const swing = ballot - payload.meta.baseline_2024_margin;
    return recomputeWithSwing(payload, swing);
  }, [payload, viewMode, sandboxBallot]);

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="bg-white border border-red-200 rounded-lg shadow-sm p-5">
          <h2 className="font-serif text-lg text-red-800">Couldn't load the projection</h2>
          <p className="text-sm text-stone-600 mt-1">{error}</p>
          <p className="text-xs text-stone-500 mt-3">
            Try refreshing. If this keeps happening the pipeline may be mid-deploy.
          </p>
        </div>
      </div>
    );
  }

  if (!payload || !topology || !effectivePayload) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16 text-center">
        <div
          className="inline-block h-6 w-6 rounded-full border-2 border-stone-300 border-t-brand-navy animate-spin"
          aria-hidden="true"
        />
        <p className="mt-3 text-sm text-stone-500">Loading projection…</p>
      </div>
    );
  }

  const selectedState = selectedFips
    ? effectivePayload.states.find((s) => s.fips === selectedFips) ?? null
    : null;

  const ballot = sandboxBallot ?? payload.meta.generic_ballot_margin;
  const sandboxSwing = ballot - payload.meta.baseline_2024_margin;

  // Dataset JSON-LD for the homepage — declares the projection as a public
  // dataset that Google Dataset Search and other crawlers can index. Kept
  // page-scoped (only emitted on /) so it doesn't pollute every route.
  const datasetSchema = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'U.S. House proportional representation projection',
    description: 'State-by-state projection of the U.S. House of Representatives under proportional representation, based on 2024 House election results, current generic-ballot polling, and Sainte-Laguë seat allocation.',
    url: 'https://proportionalhouse.org/',
    isAccessibleForFree: true,
    creator: {
      '@type': 'Person',
      name: 'Axel Hufford',
      url: 'https://axelhufford.com',
    },
    distribution: {
      '@type': 'DataDownload',
      encodingFormat: 'application/json',
      contentUrl: 'https://proportionalhouse.org/data/projection.json',
    },
  };

  return (
    <>
      <HomeHero payload={effectivePayload} viewMode={viewMode} />
      <NationalSummary payload={effectivePayload} viewMode={viewMode} />

      <section id="main" className="max-w-6xl mx-auto w-full px-6 py-5">
        <ModeToggle
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          colorMode={colorMode}
          onColorModeChange={setColorMode}
        />

        {viewMode === 'sandbox' && (
          <div className="mt-5">
            <Sandbox
              genericBallot={ballot}
              swing={sandboxSwing}
              baseline2024={payload.meta.baseline_2024_margin}
              onChange={setSandboxBallot}
            />
          </div>
        )}

        {viewMode === 'retrospective' && (
          <div className="mt-5 text-sm text-stone-700 bg-stone-50 border border-stone-200 rounded-lg p-4">
            <strong>2024 Retrospective.</strong>{' '}
            What if 2024's actual House votes had been allocated by proportional representation, with no swing applied? This isolates the distortion of the current map from the projection's polling assumption.
          </div>
        )}

        <div className="mt-5 bg-white rounded-lg border border-stone-200 shadow-sm p-4">
          <USMap
            topology={topology}
            states={effectivePayload.states}
            colorMode={colorMode}
            selectedFips={selectedFips}
            onSelect={handleSelect}
          />
          {/* Screen-reader-only tabular fallback for the map. */}
          <table className="sr-only">
            <caption>
              {colorMode === 'balance'
                ? 'Projected House delegation by state under proportional representation.'
                : 'Distortion shift by state under proportional representation.'}
            </caption>
            <thead>
              <tr>
                <th scope="col">State</th>
                <th scope="col">Seats</th>
                <th scope="col">Actual today</th>
                <th scope="col">Projected under PR</th>
              </tr>
            </thead>
            <tbody>
              {effectivePayload.states.map((s) => (
                <tr key={s.fips}>
                  <th scope="row">{s.name}</th>
                  <td>{s.seats}</td>
                  <td>{`Democratic ${s.actual.d_seats}, Republican ${s.actual.r_seats}`}</td>
                  <td>{`Democratic ${s.projected.d_seats}, Republican ${s.projected.r_seats}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <MapLegend mode={colorMode} />
          <p className="mt-3 text-xs text-stone-500">
            Click any state to inspect its projected delegation and Sainte-Laguë allocation.
            Color encodes {colorMode === 'balance' ? "the projected D-R margin of each state's delegation" : 'the per-seat shift (projected minus actual) under proportional allocation'}.
          </p>
        </div>
      </section>

      {selectedState && createPortal(
        <div data-state-detail-portal="true">
          {/* Mobile-only scrim behind the bottom sheet. Tap to dismiss. */}
          <div
            className="fixed inset-0 bg-stone-900/30 sm:hidden z-30"
            aria-hidden="true"
            onClick={handleDeselect}
          />
          <div className="relative z-40">
            <StateDetail
              state={selectedState}
              meta={effectivePayload.meta}
              onClose={handleDeselect}
            />
          </div>
        </div>,
        document.body
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetSchema) }}
      />
    </>
  );
}
