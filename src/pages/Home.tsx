import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import type { Topology } from 'topojson-specification';
import { HomeHero } from '../components/HomeHero';
import { USMap } from '../components/Map';
import { MapLegend } from '../components/MapLegend';
import type { MinorState, MinorPresetSelector } from '../components/MinorPartyControls';
import { NationalSummary } from '../components/NationalSummary';
import { ModeToggle } from '../components/ModeToggle';
import { Sandbox } from '../components/Sandbox';
import { StateDetail } from '../components/StateDetail';
import {
  buildCustomParty,
  CUSTOM_DEFAULT_COLOR,
  type MinorSlot,
  PRESET_MINORS,
} from '../lib/parties';
import { buildSandboxPayload, type MinorPartySpec } from '../lib/sandboxSwing';
import type { SandboxPayload } from '../lib/sandboxTypes';
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

/** Hex color regex without the `#` — exactly 6 hex chars. */
const HEX_RE = /^[0-9A-Fa-f]{6}$/;

/**
 * URL serialization for sandbox minor parties.
 *
 *   ?minor1=prog:6.0:85:15     → Progressive Left at 6%, 85/15 draw (canonical)
 *   ?minor1=prog:6.0           → legacy shorthand, falls back to canonical 85/15 draw
 *   ?minor1=af:8.0:60:40       → America First at 8% with a customized draw
 *   ?minor1=custom:8.0:50:50:6E6E6E:Forward+Party
 *                              → Custom party, 8% share, 50/50 draw, gray color, label
 *   ?minor1=custom:8.0:50:50:Forward+Party
 *                              → legacy Custom (no color), defaults to gray
 *
 * Draw fields are optional for the preset forms so old bookmarks keep
 * working; serialization always emits them so the URL round-trips even
 * when the user has tweaked a preset's draw ratio.
 *
 * For Custom the color field sits between draw and label. Parser tries
 * to interpret field 4 as a 6-char hex; if it doesn't match, treats it
 * as the label (legacy path) and defaults the color to gray.
 */
function parseMinor(raw: string | null): MinorState | null {
  if (!raw) return null;
  const parts = raw.split(':');
  const presetRaw = parts[0]?.toUpperCase();
  const sharePct = Number(parts[1]);
  if (!Number.isFinite(sharePct) || sharePct < 0 || sharePct > 25) return null;
  const share = sharePct / 100;

  // Optional explicit draw — accepted for any preset, required for Custom.
  // For PROG / AF, omitting means "use the preset's canonical ratio."
  const drawDPct = parts.length > 2 ? Number(parts[2]) : NaN;
  const explicitDrawD =
    Number.isFinite(drawDPct) && drawDPct >= 0 && drawDPct <= 100 ? drawDPct / 100 : undefined;

  if (presetRaw === 'PROG' || presetRaw === 'AF') {
    return {
      presetId: presetRaw as MinorPresetSelector,
      share,
      drawD: explicitDrawD ?? PRESET_MINORS[presetRaw].draw_from.D,
    };
  }
  if (presetRaw === 'CUSTOM') {
    if (explicitDrawD === undefined) return null; // Custom must specify draw
    // Field 4 might be a hex color (new format) or the label (legacy).
    const rawField4 = parts[4];
    let color: string | undefined;
    let labelField: string | undefined;
    if (rawField4 && HEX_RE.test(rawField4)) {
      color = `#${rawField4.toUpperCase()}`;
      labelField = parts[5];
    } else {
      color = undefined; // defaults to CUSTOM_DEFAULT_COLOR
      labelField = rawField4;
    }
    const label = labelField ? decodeURIComponent(labelField) : undefined;
    return {
      presetId: 'CUSTOM',
      share,
      drawD: explicitDrawD,
      color: color || CUSTOM_DEFAULT_COLOR,
      label,
    };
  }
  return null;
}

function serializeMinor(m: MinorState): string {
  const sharePct = (m.share * 100).toFixed(1);
  const drawDPct = Math.round((m.drawD ?? 0.5) * 100);
  const drawRPct = 100 - drawDPct;
  if (m.presetId === 'CUSTOM') {
    // Color hex stripped of the leading `#` so it doesn't need URL escaping.
    const colorHex = (m.color || CUSTOM_DEFAULT_COLOR).replace(/^#/, '').toUpperCase();
    const labelPart = m.label && m.label.trim() ? `:${encodeURIComponent(m.label.trim())}` : '';
    return `custom:${sharePct}:${drawDPct}:${drawRPct}:${colorHex}${labelPart}`;
  }
  // Always include draw for presets too — round-trips a customized
  // Progressive Left at 60/40 without losing the user's tweak.
  return `${m.presetId.toLowerCase()}:${sharePct}:${drawDPct}:${drawRPct}`;
}

function parseThreshold(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  return n / 100;
}

const DEFAULT_THRESHOLD = 0.05;

/** Convert a UI MinorState into the swing-math MinorPartySpec. */
function buildSpec(m: MinorState, slot: MinorSlot): MinorPartySpec {
  if (m.presetId === 'CUSTOM') {
    const drawD = m.drawD ?? 0.5;
    return {
      party: buildCustomParty({
        label: m.label,
        draw_from: { D: drawD, R: 1 - drawD },
        slot,
        color: m.color,
      }),
      national_share: m.share,
    };
  }
  // Preset minors: keep the preset's label/color/id but honor any
  // user-customized draw ratio. When `m.drawD` matches the preset's
  // canonical value, this is a no-op; when the user has tweaked the
  // slider, the spec carries the new ratio through to the swing math.
  const preset = PRESET_MINORS[m.presetId];
  const drawD = m.drawD ?? preset.draw_from.D;
  return {
    party: {
      ...preset,
      draw_from: { D: drawD, R: 1 - drawD },
    },
    national_share: m.share,
  };
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
  // Sandbox extended mode: up to two minor parties + a per-state threshold.
  // Initialized from URL params (?minor1, ?minor2, ?threshold). Empty
  // array means extended mode is off and rendering stays two-party.
  const [minors, setMinors] = useState<MinorState[]>(() => {
    const m1 = parseMinor(searchParams.get('minor1'));
    const m2 = parseMinor(searchParams.get('minor2'));
    const m3 = parseMinor(searchParams.get('minor3'));
    return [m1, m2, m3].filter((x): x is MinorState => x !== null);
  });
  const [threshold, setThreshold] = useState<number>(
    () => parseThreshold(searchParams.get('threshold')) ?? DEFAULT_THRESHOLD,
  );
  // The URL has a `state=XX` (state code) param that resolves to a FIPS once
  // the payload loads. Stash it pending payload-load.
  const pendingStateCodeRef = useRef<string | null>(searchParams.get('state'));
  // Track the last URL state code we've *processed* in the URL→state effect.
  // Without this, after a close (setSelectedFips(null)) the URL→state effect
  // would re-fire (selectedFips changed), see the still-stale ?state=WY in
  // searchParams, and reopen the panel before the state→URL effect strips it.
  const lastSeenUrlStateRef = useRef<string | null>(searchParams.get('state'));
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

  // URL → app state: when the URL gets a `?state=XX` from outside this
  // component (StateSearch input, /state/:code redirect, browser back/
  // forward), adopt it and open the matching panel. Without this effect
  // the in-SPA URL change would be silently overwritten by the
  // app-state-→-URL effect below.
  //
  // Gated on lastSeenUrlStateRef so the effect only fires when the URL's
  // state code actually *changed in the URL*, not just because selectedFips
  // changed (which would otherwise cause close → reopen loops, since the
  // URL is updated by the second effect after a tick).
  useEffect(() => {
    if (!payload) return;
    const urlStateCode = searchParams.get('state');
    if (urlStateCode === lastSeenUrlStateRef.current) return;
    lastSeenUrlStateRef.current = urlStateCode;
    if (!urlStateCode) return;
    const match = payload.states.find((s) => s.code === urlStateCode.toUpperCase());
    if (match && match.fips !== selectedFips) {
      lastSelectedFipsRef.current = match.fips;
      setSelectedFips(match.fips);
    }
  }, [payload, searchParams, selectedFips]);

  // App state → URL: keep the URL in sync with the current view so links
  // are shareable. Crucially, `searchParams` is NOT a dep here — that
  // would clobber external URL changes from the effect above. Uses
  // `replace` so slider ticks don't pollute back-button history.
  useEffect(() => {
    if (!payload) return;
    const next = new URLSearchParams();
    if (viewMode !== 'current') next.set('view', viewMode);
    if (colorMode !== 'balance') next.set('color', colorMode);
    if (viewMode === 'sandbox' && sandboxBallot !== null) {
      const liveBallot = payload.meta.generic_ballot_margin;
      if (Math.abs(sandboxBallot - liveBallot) > 0.05) {
        next.set('ballot', sandboxBallot.toFixed(1));
      }
    }
    // Sandbox extended params — only emit them in sandbox mode so they
    // don't clutter URLs for users on Current / Retrospective.
    if (viewMode === 'sandbox') {
      if (minors[0]) next.set('minor1', serializeMinor(minors[0]));
      if (minors[1]) next.set('minor2', serializeMinor(minors[1]));
      if (minors[2]) next.set('minor3', serializeMinor(minors[2]));
      if (minors.length > 0 && Math.abs(threshold - DEFAULT_THRESHOLD) > 0.0005) {
        next.set('threshold', (threshold * 100).toFixed(1));
      }
    }
    if (selectedFips) {
      const state = payload.states.find((s) => s.fips === selectedFips);
      if (state) next.set('state', state.code);
    }
    setSearchParams(next, { replace: true });
  }, [payload, viewMode, colorMode, sandboxBallot, minors, threshold, selectedFips, setSearchParams]);

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

  // Extended-mode sandbox payload (N-party). Built only when the user is
  // in sandbox view AND has at least one minor active; otherwise null and
  // the rest of the page renders via the existing two-party path.
  const sandboxPayload = useMemo<SandboxPayload | null>(() => {
    if (!effectivePayload || viewMode !== 'sandbox' || minors.length === 0) return null;
    const specs = minors.map((m, i) => buildSpec(m, (i + 1) as MinorSlot));
    return buildSandboxPayload(effectivePayload, specs, threshold);
  }, [effectivePayload, viewMode, minors, threshold]);

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
      <NationalSummary payload={effectivePayload} viewMode={viewMode} sandboxPayload={sandboxPayload} />

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
              minors={minors}
              threshold={threshold}
              onMinorsChange={setMinors}
              onThresholdChange={setThreshold}
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
            sandboxPayload={sandboxPayload}
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
          <MapLegend mode={colorMode} sandboxPayload={sandboxPayload} />
          <p className="mt-3 text-xs text-stone-500">
            Click any state to inspect its projected delegation and Sainte-Laguë allocation.
            Color encodes {colorMode === 'balance' ? "the projected D-R margin of each state's delegation" : 'the per-seat shift (projected minus actual) under proportional allocation'}.
          </p>
        </div>
      </section>

      {selectedState && createPortal(
        // The shell components provide their own positioning, animation, and
        // (on mobile) backdrop + body-scroll lock. The portal just gets the
        // dialog out of the page flow.
        <div data-state-detail-portal="true">
          <StateDetail
            state={selectedState}
            meta={effectivePayload.meta}
            allStates={effectivePayload.states}
            onClose={handleDeselect}
            sandboxState={sandboxPayload?.states.find((s) => s.fips === selectedState.fips) ?? null}
          />
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
