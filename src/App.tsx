import { useEffect, useState } from 'react';
import type { Topology } from 'topojson-specification';
import { USMap } from './components/Map';
import { NationalSummary } from './components/NationalSummary';
import { ModeToggle } from './components/ModeToggle';
import { StateDetail } from './components/StateDetail';
import type { ProjectionPayload, ViewMode, ColorMode } from './lib/types';

export default function App() {
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
      })
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="p-6 text-red-700">Failed to load data: {error}</div>
    );
  }

  if (!payload || !topology) {
    return (
      <div className="p-6 text-stone-500">Loading…</div>
    );
  }

  const selectedState = selectedFips
    ? payload.states.find((s) => s.fips === selectedFips) ?? null
    : null;

  return (
    <div className="min-h-screen flex flex-col">
      <NationalSummary payload={payload} />

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-5">
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
          <p className="mt-3 text-xs text-stone-500">
            Click any state to inspect its projected delegation and Sainte-Laguë allocation.
            Color encodes {colorMode === 'balance' ? "the projected D-R margin of each state's delegation" : 'the per-seat shift (projected minus actual) under proportional allocation'}.
          </p>
        </div>
      </main>

      <footer className="border-t border-stone-200 py-3 text-xs text-stone-500">
        <div className="max-w-6xl mx-auto px-6 flex flex-wrap items-baseline justify-between gap-2">
          <span>
            Updated {new Date(payload.meta.generated_at).toLocaleString()}
            {' · '}Source: {payload.meta.data_source}
          </span>
          <span>
            Swing applied:{' '}
            <span className={payload.meta.swing >= 0 ? 'text-blue-700 font-medium' : 'text-red-700 font-medium'}>
              {payload.meta.swing >= 0 ? '+' : ''}{payload.meta.swing.toFixed(1)} pts toward {payload.meta.swing >= 0 ? 'D' : 'R'}
            </span>
            {payload.meta.n_polls_in_average !== undefined && (
              <> {' · '} {payload.meta.n_polls_in_average} polls in average (last {payload.meta.poll_window_days ?? 30}d)</>
            )}
          </span>
        </div>
      </footer>

      {selectedState && (
        <StateDetail
          state={selectedState}
          meta={payload.meta}
          onClose={() => setSelectedFips(null)}
        />
      )}
    </div>
  );
}
