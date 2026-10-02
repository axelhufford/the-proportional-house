import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Topology } from 'topojson-specification';
import { USMap } from '../components/Map';
import { MapLegend } from '../components/MapLegend';
import { useEmbedHeightSync } from '../lib/embedPostMessage';
import { isFrozen, projectionCopy } from '../lib/election';
import { hasResults, resultsStatusLabel, resultsToProjectionPayload } from '../lib/results';
import { fmtMargin } from '../lib/format';
import { recomputeWithSwing } from '../lib/swing';
import { fetchJson } from '../lib/fetchJson';
import type { ProjectionPayload, ResultsPayload, ViewMode, ColorMode } from '../lib/types';

/**
 * /embed/national — chrome-less map + headline numbers for iframe embedding.
 *
 * No nav, no footer, no toggle UI. URL params still control the data
 * variant so host pages can pin the embed to a specific view:
 *   ?view=current|retrospective|sandbox|results
 *   ?color=balance|distortion
 *   ?ballot=<margin>   (sandbox only)
 *
 * Posts its height to the parent window via postMessage so the host can
 * size the iframe correctly. See `embedPostMessage.ts` for the protocol.
 */

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
  return Math.round(n * 10) / 10;
}

export function EmbedNational() {
  const [searchParams] = useSearchParams();
  const viewMode = parseViewMode(searchParams.get('view'));
  const colorMode = parseColorMode(searchParams.get('color'));
  const ballotParam = parseBallot(searchParams.get('ballot'));
  // ?view=results: the election results once votes are counted. Until then
  // (or if the results file can't load) it shows the Current view, so an
  // embed placed ahead of election night works before and after.
  const wantsResults = searchParams.get('view') === 'results';

  const [payload, setPayload] = useState<ProjectionPayload | null>(null);
  const [results, setResults] = useState<ResultsPayload | null>(null);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Embeds shouldn't claim canonical authority — point crawlers at the
  // full app. Side-effect set on mount since the static index.html
  // canonical defaults to the homepage.
  useEffect(() => {
    const existing = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const target = 'https://proportionalhouse.org/';
    if (existing) existing.href = target;
  }, []);

  useEffect(() => {
    Promise.all([
      fetchJson<ProjectionPayload>('/data/projection.json'),
      fetchJson<Topology>('/data/states-10m.json'),
    ])
      .then(([proj, topo]) => {
        setPayload(proj);
        setTopology(topo);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const resultsCycle = payload && isFrozen(payload.meta) ? payload.meta.election?.cycle : undefined;
  useEffect(() => {
    if (!wantsResults || !resultsCycle) return;
    fetchJson<ResultsPayload>(`/data/results_${resultsCycle}.json`).then(setResults).catch(() => {});
  }, [wantsResults, resultsCycle]);
  const showResults = wantsResults && hasResults(results);

  const effectivePayload = useMemo<ProjectionPayload | null>(() => {
    if (!payload) return null;
    if (showResults && results) return resultsToProjectionPayload(results, payload);
    if (viewMode === 'current') return payload;
    if (viewMode === 'retrospective') return recomputeWithSwing(payload, 0);
    const ballot = ballotParam ?? payload.meta.generic_ballot_margin;
    const swing = ballot - payload.meta.baseline_2024_margin;
    return recomputeWithSwing(payload, swing);
  }, [payload, viewMode, ballotParam, showResults, results]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  useEmbedHeightSync(containerRef);

  if (error) {
    return (
      <div ref={containerRef} className="p-6 text-sm text-red-700">
        Couldn’t load the projection: {error}
      </div>
    );
  }

  if (!effectivePayload || !topology) {
    return (
      <div ref={containerRef} className="p-6 text-sm text-stone-500 text-center">
        Loading…
      </div>
    );
  }

  const { national, meta } = effectivePayload;
  const dGain = national.projected.d_seats - national.actual.d_seats;
  const ballot = ballotParam ?? meta.generic_ballot_margin;
  // Embeds live in other people's articles, written about the projection, so
  // after the election freeze the Current view keeps showing it — labeled as
  // the final projection, with a pointer to the results.
  const copy = projectionCopy(meta);
  const modeLabel = showResults && results
    ? `${results.meta.cycle} results · ${resultsStatusLabel(results)}`
    : viewMode === 'retrospective'
      ? '2024 Retrospective'
      : viewMode === 'sandbox'
        ? `Sandbox · ${fmtMargin(ballot)}`
        : `${copy.frozen ? 'Final projection' : 'Current polling'} · ${fmtMargin(meta.generic_ballot_margin)}`;

  return (
    <div ref={containerRef} className="bg-white text-stone-900 font-sans p-4">
      <header className="px-1 pb-3 border-b border-stone-200">
        <div className="text-xs uppercase tracking-wider text-stone-500 font-medium">{modeLabel}</div>
        <h1 className="font-serif text-xl mt-0.5 text-brand-navy">U.S. House under proportional representation</h1>
        {copy.frozen && viewMode === 'current' && !showResults && (
          <p className="mt-1 text-xs text-stone-600">
            The final pre-election projection{copy.frozenOn ? `, frozen ${copy.frozenOn}` : ''}.{' '}
            <a
              href="https://proportionalhouse.org/?utm_source=embed"
              target="_top"
              rel="noopener noreferrer"
              className="text-brand-navy underline underline-offset-2"
            >
              Follow the {copy.cycle} results →
            </a>
          </p>
        )}
      </header>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <SummaryStat
          label={
            showResults && results
              ? results.meta.all_certified ? `Under PR (${results.meta.cycle} vote)` : 'Under PR (votes counted)'
              : 'Projected under PR'
          }
          d={national.projected.d_seats}
          r={national.projected.r_seats}
        />
        <SummaryStat
          label={showResults && results ? `As elected (${results.meta.cycle})` : 'As elected (2024)'}
          d={national.actual.d_seats}
          r={national.actual.r_seats}
        />
        <div>
          <div className="text-[10px] uppercase tracking-wider text-stone-500 font-medium">
            Difference
          </div>
          <div className="text-lg font-semibold mt-0.5 tabular-nums">
            {showResults && results && !(results.meta.all_called && results.national.under_pr.pending_seats === 0) ? (
              // Mid-count: a gap between two partial numbers isn't a finding.
              <span className="text-stone-500 text-sm">Counting</span>
            ) : dGain === 0 ? (
              <span className="text-stone-500">±0</span>
            ) : (
              <span className={dGain > 0 ? 'text-blue-700' : 'text-red-700'}>
                {dGain > 0 ? '+' : ''}
                {dGain} D / {dGain > 0 ? '-' : '+'}
                {Math.abs(dGain)} R
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 bg-white">
        <USMap
          topology={topology}
          states={effectivePayload.states}
          colorMode={colorMode}
          selectedFips={null}
          // No-op: clicks in the embed don't open a panel (would break the
          // height-sync contract and feel weird inside a foreign page).
          onSelect={() => {}}
        />
        <MapLegend mode={colorMode} />
      </div>

      <footer className="mt-3 pt-2 border-t border-stone-200 flex items-baseline justify-between text-xs text-stone-500">
        <span>Source: U.S. House Clerk + Silver Bulletin polls</span>
        <a
          href="https://proportionalhouse.org/?utm_source=embed"
          target="_top"
          rel="noopener noreferrer"
          className="text-brand-navy hover:underline font-medium"
        >
          The Proportional House →
        </a>
      </footer>
    </div>
  );
}

function SummaryStat({ label, d, r }: { label: string; d: number; r: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-stone-500 font-medium">{label}</div>
      <div className="text-lg font-semibold mt-0.5 tabular-nums">
        <span className="text-blue-700">D {d}</span>
        <span className="text-stone-400"> · </span>
        <span className="text-red-700">R {r}</span>
      </div>
    </div>
  );
}
