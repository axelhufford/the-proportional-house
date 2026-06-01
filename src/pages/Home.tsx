import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { Topology } from 'topojson-specification';
import { ChartSkeleton } from '../components/ChartSkeleton';
import { HomeHero } from '../components/HomeHero';
import { USMap } from '../components/Map';
import { MapLegend } from '../components/MapLegend';
import { MethodComparisonTable } from '../components/MethodComparisonTable';
import type { MinorState, MinorPresetSelector } from '../components/MinorPartyControls';
import { NationalSummary } from '../components/NationalSummary';
import { ModeToggle } from '../components/ModeToggle';
import { SegmentedControl } from '../components/SegmentedControl';
import { RetrospectiveTrend } from '../components/RetrospectiveTrend';
import { Sandbox } from '../components/Sandbox';
import { StateDetail } from '../components/StateDetail';
import {
  buildCustomParty,
  CUSTOM_DEFAULT_COLOR,
  type MinorSlot,
  PRESET_MINORS,
} from '../lib/parties';
import {
  cubeRootSize,
  wyomingRuleSize,
} from '../lib/apportionment';
import { ALL_METHODS, resolveEffectiveMethod, type AllocationMethodKind } from '../lib/methods';
import { fetchJson } from '../lib/fetchJson';
import {
  buildSandboxPayload,
  DEFAULT_HOUSE_SIZE,
  type MinorPartySpec,
} from '../lib/sandboxSwing';
import {
  TOTAL_APPORTIONMENT_POPULATION_2020,
  WYOMING_POPULATION_2020,
} from '../lib/statePopulations';
import type { SandboxPayload } from '../lib/sandboxTypes';
import { recomputeWithSwing } from '../lib/swing';
import { cycleToProjectionPayload } from '../lib/retrospective';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { ROUTE_META } from '../lib/routeMeta';
import type { ProjectionPayload, ViewMode, ColorMode, RetrospectivesPayload } from '../lib/types';

// recharts is ~110 KB gzipped. Lazy-load the polling chart so it lands in its
// own chunk after first paint — keeps it out of the initial bundle and off the
// homepage LCP path. The chunk fetches as soon as the Current view renders.
const PollingTrendChart = lazy(() => import('../components/PollingTrendChart'));

interface HomeProps {
  onMetaChange?: (payload: ProjectionPayload) => void;
}

const VIEW_MODES: ViewMode[] = ['current', 'retrospective', 'sandbox'];
const COLOR_MODES: ColorMode[] = ['balance', 'distortion'];

// Retrospective cycles (rolling window of the 5 most recent). The latest is the
// default; the data-driven selector renders whatever retrospectives.json carries.
const RETRO_YEARS = [2016, 2018, 2020, 2022, 2024];
const RETRO_DEFAULT_YEAR = RETRO_YEARS[RETRO_YEARS.length - 1];

function parseRetroYear(raw: string | null): number {
  const n = raw ? Number(raw) : NaN;
  return RETRO_YEARS.includes(n) ? n : RETRO_DEFAULT_YEAR;
}

function parseViewMode(raw: string | null): ViewMode {
  return raw && (VIEW_MODES as string[]).includes(raw) ? (raw as ViewMode) : 'current';
}

// The view is a real, shareable route path; scenario controls stay query params.
const VIEW_PATH: Record<ViewMode, string> = {
  current: '/',
  retrospective: '/retrospective',
  sandbox: '/sandbox',
};
function pathToView(pathname: string): ViewMode | null {
  if (pathname === '/retrospective') return 'retrospective';
  if (pathname === '/sandbox') return 'sandbox';
  if (pathname === '/') return 'current';
  return null;
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
/** Stable per-session id for a restored minor's React key (not serialized). */
function newMinorId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `minor-${Math.random().toString(36).slice(2)}`;
}

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
      id: newMinorId(),
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
      id: newMinorId(),
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

/**
 * Parse the ?method= URL param. Accepts case-insensitive forms like
 * "pr" / "PR" / "mmd-3" / "MMP-50". Returns null for unknown values so
 * Home can fall back to the default (PR).
 */
/** Sandbox slider bounds for the MMD magnitude and MMP single-member share. */
const MMD_MIN = 2;
const MMD_MAX = 10;
const MMP_PCT_MIN = 10;
const MMP_PCT_MAX = 90;

interface ParsedMethod {
  method: AllocationMethodKind;
  /** Off-grid MMD magnitude override (null when canonical 3/5). */
  mmdMagnitude: number | null;
  /** Off-grid MMP single-member fraction override (null when canonical 0.5). */
  mmpSmdShare: number | null;
}

/**
 * Parse the ?method= param into a method + optional slider overrides.
 * Accepts the canonical presets ("pr" / "mmd-3" / "mmp-50" …) plus
 * off-grid forms "mmd-N" (N = magnitude) and "mmp-N" (N = SMD percent).
 * Returns null for unknown values so Home falls back to PR.
 */
function parseMethod(raw: string | null): ParsedMethod | null {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();
  const upper = s.toUpperCase();
  if ((ALL_METHODS as string[]).includes(upper)) {
    return { method: upper as AllocationMethodKind, mmdMagnitude: null, mmpSmdShare: null };
  }
  const mmd = s.match(/^mmd-(\d+)$/);
  if (mmd) {
    const n = Number(mmd[1]);
    if (n >= MMD_MIN && n <= MMD_MAX) {
      return {
        method: n === 5 ? 'MMD-5' : 'MMD-3',
        mmdMagnitude: n === 3 || n === 5 ? null : n,
        mmpSmdShare: null,
      };
    }
  }
  const mmp = s.match(/^mmp-(\d+)$/);
  if (mmp) {
    const pct = Number(mmp[1]);
    if (pct >= MMP_PCT_MIN && pct <= MMP_PCT_MAX) {
      return { method: 'MMP-50', mmdMagnitude: null, mmpSmdShare: pct === 50 ? null : pct / 100 };
    }
  }
  return null;
}

function parseThreshold(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  return n / 100;
}

const DEFAULT_THRESHOLD = 0.05;

/** Precomputed Wyoming Rule House size from 2020 census numbers (~573). */
export const WYOMING_RULE_HOUSE_SIZE = wyomingRuleSize(
  TOTAL_APPORTIONMENT_POPULATION_2020,
  WYOMING_POPULATION_2020,
);
/** Precomputed cube root House size from 2020 census numbers (~692). */
export const CUBE_ROOT_HOUSE_SIZE = cubeRootSize(TOTAL_APPORTIONMENT_POPULATION_2020);

/** Acceptable House size range — 435 today; reform proposals go up. */
const MIN_HOUSE_SIZE = 435;
const MAX_HOUSE_SIZE = 800;

/**
 * Parse the ?house= URL param. Accepts numeric values (435–800) and
 * semantic shortcuts:
 *   wyoming → Wyoming Rule (~573)
 *   cube    → cube root rule (~692)
 * Returns null on invalid input so Home can fall back to the default 435.
 */
function parseHouseSize(raw: string | null): number | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (lower === 'wyoming') return WYOMING_RULE_HOUSE_SIZE;
  if (lower === 'cube' || lower === 'cuberoot' || lower === 'cube-root') return CUBE_ROOT_HOUSE_SIZE;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_HOUSE_SIZE || n > MAX_HOUSE_SIZE) return null;
  return n;
}

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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [payload, setPayload] = useState<ProjectionPayload | null>(null);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFips, setSelectedFips] = useState<string | null>(null);
  // Initialize view + color from URL on first render so deep links land in
  // the right mode without an intermediate flash. View comes from the path
  // (/retrospective, /sandbox); legacy `?view=` links are honored as a fallback.
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    // Path is canonical (/retrospective, /sandbox). On the bare home path,
    // honor a legacy ?view= deep link (the sync effect auto-upgrades it to the
    // clean path); otherwise default to Current.
    if (location.pathname === '/retrospective') return 'retrospective';
    if (location.pathname === '/sandbox') return 'sandbox';
    return parseViewMode(searchParams.get('view'));
  });
  const [colorMode, setColorMode] = useState<ColorMode>(() => parseColorMode(searchParams.get('color')));

  // Per-view document title/description/canonical (each view path has its own).
  const routeMeta = ROUTE_META[VIEW_PATH[viewMode]] ?? ROUTE_META['/'];
  useDocumentTitle(routeMeta.title, routeMeta.description, routeMeta.canonicalPath);

  // Path → view: keep the active view in sync when the URL path changes
  // externally (browser back/forward, or a direct/cross-page link). Home is
  // reused (not remounted) across the /, /retrospective, /sandbox routes, so
  // the initializer above only runs once — this effect handles later changes.
  // React to *changes* in the path (back/forward, or links between the view
  // routes — Home is reused, not remounted). A value-based ref (not a
  // "first run" flag) so it's correct under StrictMode's double-invoked
  // effects, and so the mount path '/' of a legacy `?view=` link isn't
  // mistaken for Current before the sync effect upgrades it to the clean path.
  const lastPathRef = useRef(location.pathname);
  useEffect(() => {
    if (location.pathname === lastPathRef.current) return;
    lastPathRef.current = location.pathname;
    const v = pathToView(location.pathname);
    if (v && v !== viewMode) setViewMode(v);
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  // Multi-cycle retrospectives + the selected cycle (Retrospective view only).
  const [retros, setRetros] = useState<RetrospectivesPayload | null>(null);
  const [retroYear, setRetroYear] = useState<number>(() => parseRetroYear(searchParams.get('year')));
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
  // Allocation method (PR | MMD-3 | MMD-5 | MMP-50). Defaults to PR so
  // existing URLs without ?method= behave identically to before. The two
  // override states let an MMD/MMP method be dialed off its preset value
  // (e.g. MMD-4, MMP-30); null means "use the preset's canonical value".
  const initialMethod = parseMethod(searchParams.get('method'));
  const [method, setMethod] = useState<AllocationMethodKind>(() => initialMethod?.method ?? 'PR');
  const [mmdMagnitude, setMmdMagnitude] = useState<number | null>(
    () => initialMethod?.mmdMagnitude ?? null,
  );
  const [mmpSmdShare, setMmpSmdShare] = useState<number | null>(
    () => initialMethod?.mmpSmdShare ?? null,
  );

  // Picking a preset method button clears any slider override so the slider
  // snaps to that preset's canonical magnitude/share.
  const handleMethodChange = useCallback((m: AllocationMethodKind) => {
    setMethod(m);
    setMmdMagnitude(null);
    setMmpSmdShare(null);
  }, []);
  // Total House size — 435 by default. Wyoming Rule ≈ 573, cube root ≈ 692.
  // Only meaningful in Sandbox; ignored in Current / Retrospective.
  const [houseSize, setHouseSize] = useState<number>(
    () => parseHouseSize(searchParams.get('house')) ?? DEFAULT_HOUSE_SIZE,
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
      fetchJson<ProjectionPayload>('/data/projection.json'),
      fetchJson<Topology>('/data/states-10m.json'),
      // Multi-cycle retrospectives. Non-fatal if it 404s (older deploy): the
      // Retrospective view falls back to the 2024-from-projection computation.
      fetchJson<RetrospectivesPayload>('/data/retrospectives.json').catch(() => null),
    ])
      .then(([proj, topo, retro]) => {
        setPayload(proj);
        setTopology(topo);
        if (retro) setRetros(retro);
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

  // "Click logo → go home" reset. The masthead logo is a `<Link to="/">`
  // which clears the URL but doesn't otherwise touch the React state above
  // (viewMode, minors, threshold, method, houseSize are all useState
  // values that stay stuck on whatever the user set them to). Without
  // this effect, clicking the logo from a Sandbox URL clears the URL but
  // leaves the user visually in Sandbox — confusing.
  //
  // The effect only fires on the *transition* "URL went from has-params
  // to bare" — that's the genuine logo-click signal. The previous-attempt
  // version had every state value in the dep array, which made it fire
  // on every toggle click, racing the state→URL effect below and
  // reverting the user's click on the same frame (broke the Mode and
  // Color toggles entirely). Using a ref to compare current vs prior
  // searchParams avoids the race: the effect only runs reset when the
  // URL actually became bare *after* having had params.
  const prevUrlRef = useRef<string>(
    location.pathname + (searchParams.toString() ? `?${searchParams.toString()}` : ''),
  );
  useEffect(() => {
    const search = searchParams.toString();
    const url = location.pathname + (search ? `?${search}` : '');
    const prev = prevUrlRef.current;
    prevUrlRef.current = url;
    // Skip unless the URL just became the bare home '/' after being something
    // else. With path-based views, '/retrospective' and '/sandbox' are NOT bare
    // — so switching between views (which clears the query) must not reset.
    if (url !== '/' || prev === '/') return;
    setViewMode('current');
    setColorMode('balance');
    setMinors([]);
    setThreshold(DEFAULT_THRESHOLD);
    setMethod('PR');
    setMmdMagnitude(null);
    setMmpSmdShare(null);
    setHouseSize(DEFAULT_HOUSE_SIZE);
    setSelectedFips(null);
    // sandboxBallot: snap back to the live polling margin so a future
    // visit to Sandbox starts at the headline number, not the last value
    // the user dragged the slider to.
    if (payload) setSandboxBallot(payload.meta.generic_ballot_margin);
  }, [location.pathname, searchParams, payload]);

  // App state → URL: keep the URL in sync with the current view so links
  // are shareable. Crucially, `searchParams` is NOT a dep here — that
  // would clobber external URL changes from the effect above. Uses
  // `replace` so slider ticks don't pollute back-button history.
  useEffect(() => {
    if (!payload) return;
    const next = new URLSearchParams();
    // The view is carried by the path (VIEW_PATH), not a query param.
    if (colorMode !== 'balance') next.set('color', colorMode);
    // Emit ?year= in retrospective mode for any non-default cycle so a specific
    // retrospective is shareable (the latest cycle stays a clean URL).
    if (viewMode === 'retrospective' && retroYear !== RETRO_DEFAULT_YEAR) {
      next.set('year', String(retroYear));
    }
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
      // Emit ?method= as the *effective* method (including any slider
      // override, e.g. "mmd-4" / "mmp-30") so dialed scenarios are
      // shareable. Omitted for the default (Pure PR) to keep URLs short.
      const eff = resolveEffectiveMethod(method, mmdMagnitude, mmpSmdShare);
      const methodParam =
        eff.family === 'MMD'
          ? `mmd-${eff.size}`
          : eff.family === 'MMP'
            ? `mmp-${Math.round((eff.smdShare ?? 0.5) * 100)}`
            : method !== 'PR'
              ? method.toLowerCase()
              : null;
      if (methodParam) next.set('method', methodParam);
      // Emit ?house= when expanded. Use semantic shortcuts when the
      // size matches a recognized preset, otherwise the numeric value.
      if (houseSize !== DEFAULT_HOUSE_SIZE) {
        if (houseSize === WYOMING_RULE_HOUSE_SIZE) next.set('house', 'wyoming');
        else if (houseSize === CUBE_ROOT_HOUSE_SIZE) next.set('house', 'cube');
        else next.set('house', String(houseSize));
      }
    }
    if (selectedFips) {
      const state = payload.states.find((s) => s.fips === selectedFips);
      if (state) next.set('state', state.code);
    }
    const search = next.toString();
    navigate(
      { pathname: VIEW_PATH[viewMode], search: search ? `?${search}` : '' },
      { replace: true },
    );
  }, [payload, viewMode, colorMode, retroYear, sandboxBallot, minors, threshold, method, mmdMagnitude, mmpSmdShare, houseSize, selectedFips, navigate]);

  // Derive what the user actually sees based on the active view mode.
  // - current: pipeline-computed projection (no client recompute).
  // - retrospective: 2024 PR under swing=0.
  // - sandbox: PR under user-controlled hypothetical generic-ballot.
  const effectivePayload = useMemo<ProjectionPayload | null>(() => {
    if (!payload) return null;
    if (viewMode === 'current') return payload;
    if (viewMode === 'retrospective') {
      // Adapt the selected cycle from retrospectives.json. Falls back to the
      // 2024-from-projection computation if the data hasn't loaded (or 404s on
      // an older deploy) — that path equals retrospectives.json's 2024 cycle.
      const cycle = retros?.cycles[String(retroYear)];
      return cycle ? cycleToProjectionPayload(cycle, retroYear) : recomputeWithSwing(payload, 0);
    }
    // sandbox
    const ballot = sandboxBallot ?? payload.meta.generic_ballot_margin;
    const swing = ballot - payload.meta.baseline_2024_margin;
    return recomputeWithSwing(payload, swing);
  }, [payload, viewMode, sandboxBallot, retros, retroYear]);

  // Structural-distortion baseline for the Current-view headline decomposition.
  // PR of the *actual 2024* vote (swing = 0) minus today's 2024-elected House —
  // i.e. the pure SMD-vs-PR distortion, the same number the 2024 Retrospective
  // shows (computed the same way). The Current gap then decomposes exactly as
  // structural + swing-since-2024, so the headline can attribute each honestly.
  const structuralDGain = useMemo<number | null>(() => {
    if (!payload) return null;
    const retro = recomputeWithSwing(payload, 0).national;
    return retro.projected.d_seats - payload.national.actual.d_seats;
  }, [payload]);

  // Sandbox payload: built whenever the user is in Sandbox view, so that
  // method + house-size + minors + threshold + ballot ALL drive the map,
  // tooltip, national totals, and state detail. When minors.length === 0
  // and method === 'PR' and houseSize === 435 the seat counts here equal
  // the two-party `effectivePayload` counts (the no-regression case).
  //
  // The threshold filter inside sandboxSwing zeroes any party below the
  // cutoff. The threshold slider UI is hidden when no minors are active,
  // so a stale 5% default could otherwise silently bite a major in an
  // extreme state — pass threshold=0 when no minors are active to avoid.
  // The active allocation, resolving the picked preset + any slider override
  // into a single descriptor (family, magnitude/share, label, canonical key).
  const effective = resolveEffectiveMethod(method, mmdMagnitude, mmpSmdShare);

  const sandboxPayload = useMemo<SandboxPayload | null>(() => {
    if (!effectivePayload || viewMode !== 'sandbox') return null;
    const specs = minors.map((m, i) => buildSpec(m, (i + 1) as MinorSlot));
    const effectiveThreshold = minors.length > 0 ? threshold : 0;
    return buildSandboxPayload(effectivePayload, specs, effectiveThreshold, method, houseSize, {
      mmdMagnitude: effective.size,
      mmpSmdShare: effective.smdShare,
    });
  }, [effectivePayload, viewMode, minors, threshold, method, mmdMagnitude, mmpSmdShare, houseSize]);

  // When the live setting is dialed off a canonical preset (e.g. MMD-4),
  // the comparison table gets one extra highlighted "current" row. Its
  // payload is exactly the live sandboxPayload (already built with the
  // override), so we reuse it rather than recompute.
  const currentComparisonRow =
    effective.canonicalKey === null && sandboxPayload
      ? { label: effective.label, payload: sandboxPayload }
      : null;

  // Precompute every method's national totals for the comparison table.
  // Only built in sandbox view. Same threshold-safety guard as above.
  const methodComparison = useMemo(() => {
    if (!effectivePayload || viewMode !== 'sandbox') return null;
    const specs = minors.map((m, i) => buildSpec(m, (i + 1) as MinorSlot));
    const effectiveThreshold = minors.length > 0 ? threshold : 0;
    return ALL_METHODS.map((m) => ({
      method: m,
      payload: buildSandboxPayload(effectivePayload, specs, effectiveThreshold, m, houseSize),
    }));
  }, [effectivePayload, viewMode, minors, threshold, houseSize]);

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="bg-white border border-red-200 rounded-lg shadow-sm p-5">
          <h2 className="font-serif text-lg text-red-800">Couldn’t load the projection</h2>
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

  // Current generic-ballot average, for the polling-trend card under the map.
  const pollMargin = payload.meta.generic_ballot_margin;
  const pollLabel =
    Math.abs(pollMargin) < 0.05
      ? 'Tie'
      : pollMargin >= 0
        ? `D+${pollMargin.toFixed(1)}`
        : `R+${Math.abs(pollMargin).toFixed(1)}`;

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
    // Data license (CC BY 4.0): free to reuse with attribution. Clears the
    // "missing field license" Dataset warning and lets Google Dataset Search
    // filter/surface it by license.
    license: 'https://creativecommons.org/licenses/by/4.0/',
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
      <HomeHero
        payload={effectivePayload}
        viewMode={viewMode}
        structuralDGain={structuralDGain ?? undefined}
        onSelectView={setViewMode}
        sandboxPayload={sandboxPayload}
        methodLabel={effective.label}
        retroYear={retroYear}
      />
      <NationalSummary
        payload={effectivePayload}
        viewMode={viewMode}
        sandboxPayload={sandboxPayload}
        method={method}
        methodLabel={effective.canonicalKey === null ? effective.label : undefined}
        houseSize={houseSize}
        structuralDGain={structuralDGain ?? undefined}
        retroYear={retroYear}
      />

      <section id="main" className="max-w-6xl mx-auto w-full px-6 py-3">
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
              method={method}
              onMethodChange={handleMethodChange}
              effective={effective}
              onMmdMagnitudeChange={setMmdMagnitude}
              onMmpSmdShareChange={setMmpSmdShare}
              houseSize={houseSize}
              wyomingRuleHouseSize={WYOMING_RULE_HOUSE_SIZE}
              cubeRootHouseSize={CUBE_ROOT_HOUSE_SIZE}
              onHouseSizeChange={setHouseSize}
            />
            {methodComparison && (
              <MethodComparisonTable
                basePayload={effectivePayload}
                comparison={methodComparison}
                activeKey={effective.canonicalKey}
                currentRow={currentComparisonRow}
              />
            )}
          </div>
        )}

        {viewMode === 'retrospective' && (
          <div className="mt-5 space-y-4">
            <SegmentedControl
              label="Cycle"
              value={String(retroYear)}
              options={(retros?.meta.cycles ?? RETRO_YEARS).map((y) => ({
                value: String(y),
                label: String(y),
              }))}
              onChange={(v) => setRetroYear(Number(v))}
            />
            {retros && (
              <RetrospectiveTrend
                series={retros.series}
                selectedYear={retroYear}
                onSelect={setRetroYear}
              />
            )}
            {retros && (
              <details className="text-sm text-stone-700 bg-stone-50 border border-stone-200 rounded-lg p-4">
                <summary className="cursor-pointer font-medium text-brand-navy">
                  Why is 2016 such an outlier?
                </summary>
                <div className="mt-2 space-y-2 text-stone-600 leading-relaxed">
                  <p>
                    In 2016, Democrats won about 49% of the House vote nationwide but only 45% of the
                    seats. Proportional representation would have closed almost all of that gap, adding
                    roughly 20 Democratic seats. And it wasn’t one rogue state. A dozen states with
                    Republican-drawn maps (Texas, Pennsylvania, Ohio, North Carolina, Michigan,
                    Georgia, and more) each turned a near-even statewide vote into a lopsided
                    delegation. Those were the most aggressive maps of the decade, drawn after the
                    2010 census and not yet thrown out by courts.
                  </p>
                  <p>
                    It also reflects something the map keeps showing: Democratic voters cluster in
                    cities, so the party piles up big margins in a few districts and “wastes” a lot of
                    votes. By 2018 several of those maps had been struck down or handed to independent
                    commissions (including Pennsylvania and Michigan), and a strong Democratic year
                    turned votes into seats more efficiently. The maps used in 2022 and 2024 are close
                    to nationally balanced, because new Democratic gerrymanders (Illinois) and
                    Republican ones (Florida, Texas) roughly cancel out. So proportional representation
                    changes far fewer seats now, the gap you see in the other years.
                  </p>
                </div>
              </details>
            )}
            <div className="text-sm text-stone-700 bg-stone-50 border border-stone-200 rounded-lg p-4">
              <strong>{retroYear} Retrospective.</strong>{' '}
              What if {retroYear}’s actual House votes had been allocated by proportional
              representation, with no swing applied? This isolates the distortion of that election’s
              district map from any polling or projection.
              {retroYear !== 2024 &&
                ' Prior-cycle vote totals come from the MIT Election Lab; 2024 from the U.S. House Clerk.'}
              {' '}
              <a href="/retrospectives" className="underline underline-offset-2 hover:text-brand-navy whitespace-nowrap">
                Read the write-up →
              </a>
            </div>
          </div>
        )}

        <div className="mt-4 bg-white rounded-xl border border-stone-200 shadow-sm p-4">
          {/* Read-first: a one-line how-to and the color key, placed above the
           * map so newcomers know what they're looking at before they look. */}
          <div className="mb-3 space-y-2">
            <p className="text-xs text-stone-500">
              Hover a state for its numbers · click any state for full detail.
            </p>
            <MapLegend mode={colorMode} sandboxPayload={sandboxPayload} />
          </div>
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
          <p className="mt-3 text-xs text-stone-500">
            Each state’s seats are allocated by its projected statewide vote share.{' '}
            <Link to="/methodology" className="underline underline-offset-2 hover:text-brand-navy">
              How it’s calculated
            </Link>
            .
          </p>
        </div>

        {/* National generic-ballot polling trend. It's the input to the Current
         * projection, so it lives under the map in that view only — not in the
         * historical Retrospective or the hypothetical Sandbox. */}
        {viewMode === 'current' && (
          <div className="mt-4 bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div>
                <h2 className="font-serif text-xl sm:text-2xl text-brand-navy">
                  National generic-ballot polling
                </h2>
                <p className="text-xs text-stone-500">Last 180 days</p>
              </div>
              <div className="text-right">
                <div
                  className={`text-2xl font-semibold tabular-nums ${
                    pollMargin >= 0 ? 'text-blue-700' : 'text-red-700'
                  }`}
                >
                  {pollLabel}
                </div>
                <div className="text-xs text-stone-500">14-day weighted average</div>
              </div>
            </div>
            <div className="mt-4">
              <Suspense fallback={<ChartSkeleton className="h-[300px]" />}>
                <PollingTrendChart currentAverageMargin={pollMargin} height={300} />
              </Suspense>
            </div>
            <p className="mt-3 text-xs text-stone-500">
              Each dot is one poll; size scales with sample size. The navy line is the same 14-day
              weighted average we use in the projection. Source: Silver Bulletin’s public
              generic-ballot database.
            </p>
          </div>
        )}
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
            method={method}
            methodLabel={effective.canonicalKey === null ? effective.label : undefined}
            houseSize={houseSize}
            threshold={threshold}
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
