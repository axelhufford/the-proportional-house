import { useMemo, useState } from 'react';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';
import type { StateProjection, ColorMode } from '../lib/types';
import type { SandboxPayload } from '../lib/sandboxTypes';
import { balanceColor, distortionColor, balanceMargin, distortionMargin, pluralityColor } from '../lib/colors';

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
 * get the same information in words.
 */
function buildAriaLabel(state: StateProjection, colorMode: ColorMode): string {
  const base = `${state.name}, ${state.seats} ${state.seats === 1 ? 'seat' : 'seats'}: ` +
    `currently ${state.actual.d_seats} Democratic, ${state.actual.r_seats} Republican; ` +
    `projected under PR ${state.projected.d_seats} Democratic, ${state.projected.r_seats} Republican.`;
  if (colorMode === 'distortion') {
    const dShift = state.projected.d_seats - state.actual.d_seats;
    if (dShift === 0) return `${base} No seat shift under PR.`;
    const direction = dShift > 0 ? 'Democrats' : 'Republicans';
    return `${base} Shifts ${Math.abs(dShift)} ${Math.abs(dShift) === 1 ? 'seat' : 'seats'} toward ${direction} under PR.`;
  }
  return base;
}

const WIDTH = 975;
const HEIGHT = 610;

export function USMap({ topology, states, colorMode, selectedFips, onSelect, sandboxPayload }: MapProps) {
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

  const hovered = hoverFips ? projectionByFips.get(hoverFips) : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label="U.S. map of projected House delegation under proportional representation"
      >
        {geojson.features.map((f) => {
          const fips = String(f.id).padStart(2, '0');
          const state = projectionByFips.get(fips);
          if (!state) {
            return (
              <path
                key={fips}
                d={pathGen(f) || ''}
                fill="#e5e7eb"
                stroke="#fff"
                strokeWidth={0.75}
              />
            );
          }
          // Extended sandbox: pick the plurality party's color for this
          // state. Falls back to the balance/distortion scale when no
          // sandboxPayload (or when this state somehow isn't in it).
          const sandboxState = sandboxByFips.get(fips);
          let fill: string;
          if (sandboxState) {
            fill = pluralityColor(
              sandboxState.parties.map((p) => ({ color: p.party.color, seats: p.seats })),
            );
          } else {
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
            fill = colorMode === 'balance' ? balanceColor(margin) : distortionColor(margin);
          }
          const isSelected = selectedFips === fips;
          const isHover = hoverFips === fips;
          return (
            <path
              key={fips}
              d={pathGen(f) || ''}
              fill={fill}
              stroke={isSelected ? '#111' : '#fff'}
              strokeWidth={isSelected ? 2 : isHover ? 1.5 : 0.75}
              // Fill transition tweens the choropleth when the user switches
              // view modes or drags the sandbox slider — React's reconciler
              // keeps the path stable (key=fips), so CSS handles the rest.
              // motion-reduce: variant respects user OS preference.
              className="cursor-pointer transition-[fill,stroke-width] duration-200 ease-out motion-reduce:transition-none"
              data-fips={fips}
              onMouseEnter={() => setHoverFips(fips)}
              onMouseLeave={() => setHoverFips(null)}
              onClick={() => onSelect(fips)}
              role="button"
              tabIndex={0}
              aria-label={buildAriaLabel(state, colorMode)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(fips);
                }
              }}
            />
          );
        })}
      </svg>
      {hovered && (
        <Tooltip state={hovered} />
      )}
    </div>
  );
}

function Tooltip({ state }: { state: StateProjection }) {
  const dGain = state.projected.d_seats - state.actual.d_seats;
  return (
    <div className="absolute top-2 right-2 bg-white/95 border border-stone-200 rounded-md px-3 py-2 shadow-sm text-sm pointer-events-none">
      <div className="font-semibold text-stone-900">{state.name}</div>
      <div className="text-stone-600 text-xs">{state.seats} {state.seats === 1 ? 'seat' : 'seats'}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-blue-700 font-medium">D {state.projected.d_seats}</span>
        <span className="text-stone-400">·</span>
        <span className="text-red-700 font-medium">R {state.projected.r_seats}</span>
      </div>
      <div className="text-xs text-stone-500 mt-0.5">
        Now: D {state.actual.d_seats} / R {state.actual.r_seats}
        {dGain !== 0 && (
          <span className={dGain > 0 ? ' text-blue-700' : ' text-red-700'}>
            {' '}({dGain > 0 ? '+' : ''}{dGain} D)
          </span>
        )}
      </div>
    </div>
  );
}
