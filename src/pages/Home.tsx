import { useEffect, useMemo, useState } from 'react';
import type { Topology } from 'topojson-specification';
import { USMap } from '../components/Map';
import { MapLegend } from '../components/MapLegend';
import { NationalSummary } from '../components/NationalSummary';
import { ModeToggle } from '../components/ModeToggle';
import { Sandbox } from '../components/Sandbox';
import { StateDetail } from '../components/StateDetail';
import { recomputeWithSwing } from '../lib/swing';
import type { ProjectionPayload, ViewMode, ColorMode } from '../lib/types';

interface HomeProps {
  onMetaChange?: (payload: ProjectionPayload) => void;
}

export function Home({ onMetaChange }: HomeProps) {
  const [payload, setPayload] = useState<ProjectionPayload | null>(null);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFips, setSelectedFips] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('current');
  const [colorMode, setColorMode] = useState<ColorMode>('balance');
  // Sandbox slider state: hypothetical generic-ballot margin in points.
  // Initialized to the live pipeline value once the payload loads.
  const [sandboxBallot, setSandboxBallot] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/data/projection.json').then((r) => r.json()) as Promise<ProjectionPayload>,
      fetch('/data/states-10m.json').then((r) => r.json()) as Promise<Topology>,
    ])
      .then(([proj, topo]) => {
        setPayload(proj);
        setTopology(topo);
        setSandboxBallot((cur) => (cur === null ? proj.meta.generic_ballot_margin : cur));
        onMetaChange?.(proj);
      })
      .catch((e) => setError(String(e)));
  }, [onMetaChange]);

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
    return <div className="p-6 text-red-700">Failed to load data: {error}</div>;
  }

  if (!payload || !topology || !effectivePayload) {
    return <div className="p-6 text-stone-500">Loading…</div>;
  }

  const selectedState = selectedFips
    ? effectivePayload.states.find((s) => s.fips === selectedFips) ?? null
    : null;

  const ballot = sandboxBallot ?? payload.meta.generic_ballot_margin;
  const sandboxSwing = ballot - payload.meta.baseline_2024_margin;

  return (
    <>
      <NationalSummary payload={effectivePayload} viewMode={viewMode} />

      <section className="max-w-6xl mx-auto w-full px-6 py-5">
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

        <div className="mt-5 bg-white rounded-lg border border-stone-200 p-4">
          <USMap
            topology={topology}
            states={effectivePayload.states}
            colorMode={colorMode}
            selectedFips={selectedFips}
            onSelect={setSelectedFips}
          />
          <MapLegend mode={colorMode} />
          <p className="mt-3 text-xs text-stone-500">
            Click any state to inspect its projected delegation and Sainte-Laguë allocation.
            Color encodes {colorMode === 'balance' ? "the projected D-R margin of each state's delegation" : 'the per-seat shift (projected minus actual) under proportional allocation'}.
          </p>
        </div>
      </section>

      {selectedState && (
        <StateDetail
          state={selectedState}
          meta={effectivePayload.meta}
          onClose={() => setSelectedFips(null)}
        />
      )}
    </>
  );
}
