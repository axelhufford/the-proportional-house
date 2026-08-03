import { memo, useMemo, useState } from 'react';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';
import type { StateProjection, ColorMode } from '../lib/types';
import type { PartyShare, SandboxPayload } from '../lib/sandboxTypes';
import {
  balanceColor,
  distortionColor,
  balanceMargin,
  distortionMargin,
  pluralityColor,
  isMinorParty,
} from '../lib/colors';
import { displayName, PARTY_D, PARTY_R } from '../lib/parties';
import { formatSeatPct } from '../lib/format';
import { SeatBar } from './SeatBar';

/**
 * Sanitize a hex color (or any string) into something safe for use in an
 * SVG element id. Strips the leading `#` and any non-alphanumeric chars.
 */
function safeId(hex: string): string {
  return hex.replace(/[^A-Za-z0-9]/g, '');
}

interface MapProps {
  topology: Topology;
  states: StateProjection[];
  colorMode: ColorMode;
  selectedFips: string | null;
  onSelect: (fips: string) => void;
  /**
   * When present, state fills use plurality-party colors from the
   * extended sandbox projection instead of the balance/distortion
   * scales. The `colorMode` prop is ignored in this mode.
   */
  sandboxPayload?: SandboxPayload | null;
}

interface StateFeatureProps {
  name: string;
}

/**
 * Build a screen-reader-friendly label for a map state that adapts to the
 * current color mode. Sighted users get the visual color encoding; AT users
 * get the same information in words. `projectedD` / `projectedR` /
 * `projectedTotal` default to the state's static `state.projected` /
 * `state.seats` values, but in Sandbox mode the caller passes the
 * sandbox-derived seat counts so the spoken label reflects method and
 * house-size changes too.
 */
function buildAriaLabel(
  state: StateProjection,
  colorMode: ColorMode,
  projectedD: number = state.projected.d_seats,
  projectedR: number = state.projected.r_seats,
  projectedTotal: number = state.seats,
  // Baseline D seats for the distortion "shift" — today's delegation scaled to
  // the projected House size in Sandbox, so chamber growth isn't spoken as a
  // partisan shift. Defaults to today's real actual.
  baselineD: number = state.actual.d_seats,
): string {
  const totalLabel = `${projectedTotal} ${projectedTotal === 1 ? 'seat' : 'seats'}`;
  const base = `${state.name}, ${totalLabel}: ` +
    `currently ${state.actual.d_seats} Democratic, ${state.actual.r_seats} Republican; ` +
    `projected under PR ${projectedD} Democratic, ${projectedR} Republican.`;
  if (colorMode === 'distortion') {
    const dShift = projectedD - baselineD;
    if (dShift === 0) return `${base} No seat shift under PR.`;
    const direction = dShift > 0 ? 'Democrats' : 'Republicans';
    return `${base} Shifts ${Math.abs(dShift)} ${Math.abs(dShift) === 1 ? 'seat' : 'seats'} toward ${direction} under PR.`;
  }
  return base;
}

const WIDTH = 975;
const HEIGHT = 610;

function USMapInner({ topology, states, colorMode, selectedFips, onSelect, sandboxPayload }: MapProps) {
  const [hoverFips, setHoverFips] = useState<string | null>(null);

  const projectionByFips = useMemo(() => {
    const map = new Map<string, StateProjection>();
    for (const s of states) map.set(s.fips, s);
    return map;
  }, [states]);

  // Fast fips → sandbox state lookup for plurality coloring. Empty Map
  // when not in extended sandbox so the loop below short-circuits.
  const sandboxByFips = useMemo(() => {
    const m = new Map<string, NonNullable<SandboxPayload['states'][number]>>();
    if (sandboxPayload) {
      for (const s of sandboxPayload.states) m.set(s.fips, s);
    }
    return m;
  }, [sandboxPayload]);

  const geojson = useMemo(() => {
    return feature(topology, topology.objects.states) as unknown as FeatureCollection<
      Geometry,
      StateFeatureProps
    >;
  }, [topology]);

  const pathGen = useMemo(() => {
    const projection = geoAlbersUsa().fitSize([WIDTH, HEIGHT], geojson);
    return geoPath(projection);
  }, [geojson]);

  // Serialized path data, keyed by FIPS. The geometry never changes, so these
  // strings are computed once per topology — deliberately in their own memo
  // rather than folded into `visuals` below, which also depends on colorMode
  // and the sandbox payload.
  //
  // These used to be generated inline in the JSX, twice per state (visual layer
  // + hit layer). That re-serialized all 102 paths out of the 114 KB topology
  // on every render — including every mouse move across the map (setHoverFips)
  // and every tick of the sandbox ballot slider.
  const pathByFips = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of geojson.features) {
      m.set(String(f.id).padStart(2, '0'), pathGen(f) || '');
    }
    return m;
  }, [geojson.features, pathGen]);

  const hovered = hoverFips ? projectionByFips.get(hoverFips) : null;

  // Compute per-state visuals up front: solid fill color and (if extended
  // sandbox + minors won seats with a major holding plurality) a list of
  // stripe colors — one per minor with seats — for the diagonal overlay.
  // Returning fillRef as a final string lets the JSX below stay simple.
  type StateVisual = {
    fips: string;
    feature: (typeof geojson.features)[number];
    state: StateProjection | null;
    fillRef: string;
    ariaLabel?: string;
  };
  type PatternKey = { bg: string; stripes: string[]; id: string };

  const { visuals, patterns } = useMemo(() => {
    const out: StateVisual[] = [];
    const seenPatterns = new Map<string, PatternKey>();

    for (const f of geojson.features) {
      const fips = String(f.id).padStart(2, '0');
      const state = projectionByFips.get(fips);
      if (!state) {
        out.push({ fips, feature: f, state: null, fillRef: '#e5e7eb' });
        continue;
      }

      const sandboxState = sandboxByFips.get(fips);
      let bgColor: string;
      let stripeColors: string[] = [];
      // Effective projected D/R seats — pulled from sandboxState when
      // present so method + house-size changes flow through the
      // balance/distortion palette, the aria-label, and the tooltip
      // (not just the plurality-color branch).
      let projectedD = state.projected.d_seats;
      let projectedR = state.projected.r_seats;
      let projectedTotal = state.seats;
      // Baseline for the distortion "shift" — today's delegation scaled to the
      // projected House size in Sandbox (zero-sum, so growth isn't read as a
      // partisan shift). Defaults to today's real actual.
      let baselineD = state.actual.d_seats;
      let baselineR = state.actual.r_seats;

      if (sandboxState) {
        projectedD = sandboxState.parties[0]?.seats ?? 0; // D is canonical slot 0
        projectedR = sandboxState.parties[1]?.seats ?? 0; // R is canonical slot 1
        projectedTotal = sandboxState.total_seats;
        baselineD = sandboxState.actual_scaled.d_seats;
        baselineR = sandboxState.actual_scaled.r_seats;

        const hasMinorSeats = sandboxState.parties.some(
          (p) => isMinorParty(p.party.id) && p.seats > 0,
        );

        if (hasMinorSeats) {
          // Extended-sandbox visual: plurality color, with stripes when a
          // major holds plurality but minors also won seats.
          bgColor = pluralityColor(
            sandboxState.parties.map((p) => ({ color: p.party.color, seats: p.seats })),
          );
          const winner = findPluralityParty(sandboxState.parties);
          const pluralityIsMajor = winner !== null && (winner.party.id === 'D' || winner.party.id === 'R');
          if (pluralityIsMajor) {
            stripeColors = sandboxState.parties
              .filter((p) => isMinorParty(p.party.id) && p.seats > 0)
              .map((p) => p.party.color);
          }
        } else {
          // Sandbox without minors: keep the diverging balance/distortion
          // palette, but compute the margin from sandbox-projected seats
          // so method/house-size changes update the fill.
          const margin =
            colorMode === 'balance'
              ? balanceMargin(projectedD, projectedR, projectedTotal)
              : distortionMargin(
                  projectedD,
                  projectedR,
                  baselineD,
                  baselineR,
                  projectedTotal,
                );
          bgColor = colorMode === 'balance' ? balanceColor(margin) : distortionColor(margin);
        }
      } else {
        // Not in Sandbox view: original two-party rendering from
        // effectivePayload's projected counts.
        const margin =
          colorMode === 'balance'
            ? balanceMargin(state.projected.d_seats, state.projected.r_seats, state.seats)
            : distortionMargin(
                state.projected.d_seats,
                state.projected.r_seats,
                state.actual.d_seats,
                state.actual.r_seats,
                state.seats,
              );
        bgColor = colorMode === 'balance' ? balanceColor(margin) : distortionColor(margin);
      }

      let fillRef = bgColor;
      if (stripeColors.length > 0) {
        const id = `stripe-${safeId(bgColor)}-${stripeColors.map(safeId).join('-')}`;
        if (!seenPatterns.has(id)) {
          seenPatterns.set(id, { bg: bgColor, stripes: stripeColors, id });
        }
        fillRef = `url(#${id})`;
      }

      out.push({
        fips,
        feature: f,
        state,
        fillRef,
        ariaLabel: buildAriaLabel(state, colorMode, projectedD, projectedR, projectedTotal, baselineD),
      });
    }

    return { visuals: out, patterns: Array.from(seenPatterns.values()) };
  }, [geojson.features, projectionByFips, sandboxByFips, colorMode]);

  return (
    <div className="relative">
      {/* No role="img" on the <svg>. ARIA prunes every descendant of an
        * img-role element from the accessibility tree, which silenced the 51
        * per-state buttons below (each carrying its own aria-label) while
        * leaving them keyboard-focusable — 51 unlabeled tab stops. Home also
        * renders an sr-only table with the same numbers as a linear summary. */}
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        aria-label="U.S. map of projected House delegation under proportional representation"
      >
        {/* Pattern defs for diagonal stripes on states with minor seats.
          * One <pattern> per unique (bg, stripe-colors) combo. Stripes
          * are 3px thick on a 6px period — N stripes interleaved means
          * the pattern is N * 6 wide, so a state with two minors winning
          * seats shows green + gold alternating, a state with three shows
          * green + gold + custom-color alternating, etc. */}
        {patterns.length > 0 && (
          <defs>
            {patterns.map((p) => {
              const period = 6;
              const stripeWidth = 3;
              const width = period * p.stripes.length;
              return (
                <pattern
                  key={p.id}
                  id={p.id}
                  patternUnits="userSpaceOnUse"
                  width={width}
                  height={period}
                  patternTransform="rotate(45)"
                >
                  <rect width={width} height={period} fill={p.bg} />
                  {p.stripes.map((c, i) => (
                    <line
                      key={`stripe-${i}-${c}`}
                      x1={i * period + stripeWidth / 2}
                      y1={0}
                      x2={i * period + stripeWidth / 2}
                      y2={period}
                      stroke={c}
                      strokeWidth={stripeWidth}
                    />
                  ))}
                </pattern>
              );
            })}
          </defs>
        )}
        {/* Visual layer: choropleth fill + selection/hover stroke. Tweens the
          * fill on view/slider/method changes. This layer is NON-interactive
          * ([pointer-events:none]); every click, hover, and focus is handled
          * by the transparent hit layer rendered on top (below).
          *
          * Why the split: the interactive element's fill used to swap between
          * a solid color and a url(#stripe-…) pattern (when a minor wins seats)
          * mid-transition. SVG hit-testing keys off the fill's paint state, and
          * Chromium can drop clicks on an element whose paint is changing —
          * even with pointer-events:all (the prior fix, which wasn't enough).
          * The hit layer's fill is always transparent and never transitions,
          * so it stays reliably clickable regardless of the visual fill. */}
        {visuals.map((v) => {
          if (!v.state) {
            return (
              <path
                key={v.fips}
                d={pathByFips.get(v.fips) ?? ''}
                fill={v.fillRef}
                stroke="#fff"
                strokeWidth={0.75}
              />
            );
          }
          const isSelected = selectedFips === v.fips;
          const isHover = hoverFips === v.fips;
          return (
            <path
              key={v.fips}
              d={pathByFips.get(v.fips) ?? ''}
              fill={v.fillRef}
              stroke={isSelected ? '#1F2E4D' : '#fff'}
              strokeWidth={isSelected ? 2 : isHover ? 1.5 : 0.75}
              className="transition-[fill,stroke-width] duration-200 ease-out motion-reduce:transition-none [pointer-events:none]"
            />
          );
        })}
        {/* Hit layer: one transparent, never-transitioning path per state,
          * stacked on top of the visual layer. Owns the interaction handlers
          * and a11y. data-fips lives here (not on the visual paths) so the
          * focus-restore selector in Home (svg path[data-fips=…]) targets the
          * focusable element. */}
        {visuals.map((v) =>
          v.state ? (
            <path
              key={v.fips}
              d={pathByFips.get(v.fips) ?? ''}
              fill="transparent"
              className="cursor-pointer [pointer-events:all]"
              data-fips={v.fips}
              onMouseEnter={() => setHoverFips(v.fips)}
              onMouseLeave={() => setHoverFips(null)}
              onClick={() => onSelect(v.fips)}
              role="button"
              tabIndex={0}
              aria-label={v.ariaLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(v.fips);
                }
              }}
            />
          ) : null,
        )}
      </svg>
      {hovered && (
        <Tooltip state={hovered} sandboxState={sandboxByFips.get(hovered.fips) ?? null} />
      )}
    </div>
  );
}

/**
 * Local helper: return the party with the most seats, or null on a tie.
 * Distinct from `pluralityColor` (which returns a hex string) because the
 * stripe logic needs the party's id to decide if it's a major or minor.
 */
function findPluralityParty(parties: PartyShare[]): PartyShare | null {
  let winner: PartyShare | null = null;
  let tie = false;
  for (const p of parties) {
    if (winner === null || p.seats > winner.seats) {
      winner = p;
      tie = false;
    } else if (p.seats === winner.seats) {
      tie = true;
    }
  }
  return tie ? null : winner;
}

/**
 * The map re-renders on every parent state change — and Home re-renders on
 * every sandbox slider tick. Memoizing means a parent render that didn't
 * actually change the map's props (e.g. the ballot readout updating) skips the
 * 51-state diff entirely. All props are stable references from Home's memos,
 * so the default shallow comparison is enough.
 */
export const USMap = memo(USMapInner);

function Tooltip({
  state,
  sandboxState,
}: {
  state: StateProjection;
  sandboxState: SandboxPayload['states'][number] | null;
}) {
  // Decide which projected numbers to show. In Sandbox view, always
  // pull from sandboxState so method + house-size changes are reflected.
  // Outside Sandbox, use the static state.projected values.
  const hasMinorSeats =
    !!sandboxState &&
    sandboxState.parties.some(
      (p) => isMinorParty(p.party.id) && p.seats > 0,
    );
  const projectedD = sandboxState ? sandboxState.parties[0]?.seats ?? 0 : state.projected.d_seats;
  const projectedR = sandboxState ? sandboxState.parties[1]?.seats ?? 0 : state.projected.r_seats;
  const projectedTotal = sandboxState ? sandboxState.total_seats : state.seats;
  const actualTotal = state.actual.d_seats + state.actual.r_seats;
  // Compare against today's delegation scaled to the projected House size in
  // Sandbox, so a bigger House isn't shown as a partisan gain.
  const baselineD = sandboxState ? sandboxState.actual_scaled.d_seats : state.actual.d_seats;
  const dGain = projectedD - baselineD;
  return (
    <div className="absolute top-2 right-2 w-52 bg-white/95 backdrop-blur-sm border border-stone-200 rounded-xl px-3 py-2.5 shadow-lg text-sm pointer-events-none">
      <div className="font-semibold text-stone-900">{state.name}</div>
      <div className="text-stone-600 text-xs">{projectedTotal} {projectedTotal === 1 ? 'seat' : 'seats'}</div>
      {hasMinorSeats ? (
        // Extended sandbox: list every party with seats, color-coded by
        // party.color. Skip parties at 0 to keep the line short.
        <div className="mt-1 flex items-baseline gap-2 flex-wrap">
          {sandboxState!.parties
            .filter((p) => p.seats > 0)
            .map((p, i) => (
              <span key={p.party.id} className="inline-flex items-baseline gap-2">
                {i > 0 && <span className="text-stone-400">·</span>}
                <span className="font-medium" style={{ color: p.party.color }}>
                  {displayName(p.party)} {p.seats}
                  <span className="ml-1 text-[11px] font-normal text-stone-400 tabular-nums">
                    {formatSeatPct(p.seats, projectedTotal)}
                  </span>
                </span>
              </span>
            ))}
        </div>
      ) : (
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-blue-700 font-medium">
            D {projectedD}
            <span className="ml-1 text-[11px] font-normal text-stone-400 tabular-nums">
              {formatSeatPct(projectedD, projectedTotal)}
            </span>
          </span>
          <span className="text-stone-400">·</span>
          <span className="text-red-700 font-medium">
            R {projectedR}
            <span className="ml-1 text-[11px] font-normal text-stone-400 tabular-nums">
              {formatSeatPct(projectedR, projectedTotal)}
            </span>
          </span>
        </div>
      )}
      <SeatBar
        className="h-1.5 mt-1.5"
        parties={
          hasMinorSeats
            ? sandboxState!.parties
                .filter((p) => p.seats > 0)
                .map((p) => ({ id: p.party.id, color: p.party.color, seats: p.seats, label: displayName(p.party) }))
            : [
                { id: 'D', color: PARTY_D.color, seats: projectedD, label: 'D' },
                { id: 'R', color: PARTY_R.color, seats: projectedR, label: 'R' },
              ]
        }
      />
      <div className="text-xs text-stone-500 mt-1.5">
        Now: D {state.actual.d_seats}
        {actualTotal > 0 && (
          <span className="text-stone-400 tabular-nums"> {formatSeatPct(state.actual.d_seats, actualTotal)}</span>
        )}
        {' / '}R {state.actual.r_seats}
        {actualTotal > 0 && (
          <span className="text-stone-400 tabular-nums"> {formatSeatPct(state.actual.r_seats, actualTotal)}</span>
        )}
        {/* Drop the "(+X D)" delta in extended mode — it's a two-party
          * concept and reads as misleading when minors are in the mix. */}
        {!hasMinorSeats && dGain !== 0 && (
          <span className={dGain > 0 ? ' text-blue-700' : ' text-red-700'}>
            {' '}({dGain > 0 ? '+' : ''}{dGain} D)
          </span>
        )}
      </div>
    </div>
  );
}
