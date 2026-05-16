import { useEffect, useState } from 'react';
import type { Topology } from 'topojson-specification';
import { USMap } from '../components/Map';
import { MapLegend } from '../components/MapLegend';
import { NationalSummary } from '../components/NationalSummary';
import { ModeToggle } from '../components/ModeToggle';
import { StateDetail } from '../components/StateDetail';
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

  useEffect(() => {
    Promise.all([
      fetch('/data/projection.json').then((r) => r.json()) as Promise<ProjectionPayload>,
      fetch('/data/states-10m.json').then((r) => r.json()) as Promise<Topology>,
    ])
      .then(([proj, topo]) => {
        setPayload(proj);
        setTopology(topo);
        onMetaChange?.(proj);
      })
      .catch((e) => setError(String(e)));
  }, [onMetaChange]);

  if (error) {
    return <div className="p-6 text-red-700">Failed to load data: {error}</div>;
  }

  if (!payload || !topology) {
    return <div className="p-6 text-stone-500">Loading…</div>;
  }

  const selectedState = selectedFips
    ? payload.states.find((s) => s.fips === selectedFips) ?? null
    : null;

  return (
    <>
      <NationalSummary payload={payload} />

      <section className="max-w-6xl mx-auto w-full px-6 py-5">
        <ModeToggle
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          colorMode={colorMode}
          onColorModeChange={setColorMode}
        />
        <div className="mt-5 bg-white rounded-lg border border-stone-200 p-4">
          <USMap
            topology={topology}
            states={payload.states}
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
          meta={payload.meta}
          onClose={() => setSelectedFips(null)}
        />
      )}
    </>
  );
}
