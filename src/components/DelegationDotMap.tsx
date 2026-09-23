import { memo, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { Topology } from 'topojson-specification';
import {
  buildSeatDotGeometry,
  DOT_RADIUS,
  placeSeatDots,
  type SeatDotGeometry,
  type SeatKind,
  type StateDelegation,
} from '../lib/seatDots';
import { PARTY_D, PARTY_R } from '../lib/parties';
import { SegmentedControl } from './SegmentedControl';

/** One side of the toggle: a full set of state delegations plus its copy. */
export interface DelegationSet {
  delegations: StateDelegation[];
  /** Toggle button text, e.g. "Under PR" or "Today’s House". */
  toggleLabel: string;
  /** Tooltip row label, e.g. "Under PR" or "Today". */
  rowLabel: string;
  /** Line under the heading while this side is shown. */
  subtitle: string;
}

interface Props {
  topology: Topology;
  title: string;
  /** Seats as PR allocates them — the same projection as the main map. */
  proportional: DelegationSet;
  /** Who actually holds (or won) the seats — the live chamber, or a cycle as elected. */
  actual: DelegationSet;
  /** Open a state's detail panel — Home's handleSelect. */
  onSelect: (fips: string) => void;
}

type Side = 'pr' | 'actual';

const OTHER_COLOR = '#78716c';
const VACANT_STROKE = '#a8a29e';
const STATE_FILL = '#e7e5e4';
const STATE_FILL_HOVER = '#d6d3d1';

const DOT_FILL: Record<SeatKind, string> = {
  D: PARTY_D.color,
  R: PARTY_R.color,
  other: OTHER_COLOR,
  vacant: '#ffffff',
};

// The geometry depends only on the topology (~50 ms to build), so it's cached
// per topology object: switching to Sandbox unmounts this map, and coming back
// shouldn't pay for it again.
const geometryCache = new WeakMap<Topology, SeatDotGeometry>();
function geometryFor(topology: Topology): SeatDotGeometry {
  let g = geometryCache.get(topology);
  if (!g) {
    g = buildSeatDotGeometry(topology);
    geometryCache.set(topology, g);
  }
  return g;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function sumDelegations(delegations: StateDelegation[]) {
  const t = { d: 0, r: 0, other: 0, vacant: 0 };
  for (const d of delegations) {
    t.d += d.d;
    t.r += d.r;
    t.other += d.other;
    t.vacant += d.vacant;
  }
  return t;
}

/**
 * Every seat, state by state: one dot per seat, drawn inside its state
 * (geometry in src/lib/seatDots.ts). Shows the PR allocation by default, with a
 * toggle to the House as it actually is. Both sides place a state's seats on
 * the same dots, so flipping the toggle recolors exactly the seats PR would
 * move. Numbers stay off the map — they're in the hover tooltip and the
 * screen-reader table. Clicking a state opens the main map's detail panel.
 */
function DelegationDotMapInner({ topology, title, proportional, actual, onSelect }: Props) {
  const [side, setSide] = useState<Side>('pr');
  const shown = side === 'pr' ? proportional : actual;

  const geometry = useMemo(() => geometryFor(topology), [topology]);
  const placement = useMemo(
    () => placeSeatDots(geometry, shown.delegations),
    [geometry, shown.delegations],
  );
  const [hoverFips, setHoverFips] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const prByFips = useMemo(
    () => new Map(proportional.delegations.map((d) => [d.fips, d])),
    [proportional.delegations],
  );
  const actualByFips = useMemo(
    () => new Map(actual.delegations.map((d) => [d.fips, d])),
    [actual.delegations],
  );
  const totals = useMemo(() => sumDelegations(shown.delegations), [shown.delegations]);

  // Follow the cursor by writing the tooltip's position straight to the DOM, so
  // mouse moves don't re-render 435 dots. Sits above-right of the pointer and
  // flips left near the right edge.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const placeTooltip = () => {
    const frame = frameRef.current;
    const tip = tooltipRef.current;
    const pos = pointerRef.current;
    if (!frame || !tip || !pos) return;
    const flip = pos.x > frame.clientWidth - tip.offsetWidth - 24;
    tip.style.left = `${flip ? pos.x - tip.offsetWidth - 12 : pos.x + 12}px`;
    tip.style.top = `${Math.max(0, pos.y - tip.offsetHeight - 8)}px`;
  };
  const moveTooltip = (e: MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    placeTooltip();
  };
  // Re-place once the tooltip is shown with the new state's content: while it
  // was hidden it measured 0×0, and a longer name changes its size.
  useLayoutEffect(placeTooltip, [hoverFips]);

  const hoveredPr = hoverFips ? prByFips.get(hoverFips) : undefined;
  const hoveredActual = hoverFips ? actualByFips.get(hoverFips) : undefined;
  const hoveredName = hoveredPr?.name ?? hoveredActual?.name;
  const states = [...geometry.states.values()];
  // The tooltip lists the side on the map first, in party colors.
  const tooltipRows = (
    side === 'pr'
      ? [
          { set: proportional, del: hoveredPr, active: true },
          { set: actual, del: hoveredActual, active: false },
        ]
      : [
          { set: actual, del: hoveredActual, active: true },
          { set: proportional, del: hoveredPr, active: false },
        ]
  ).filter((row): row is { set: DelegationSet; del: StateDelegation; active: boolean } => !!row.del);

  const summary =
    `${title}, ${shown.toggleLabel.toLowerCase()}: one dot per seat, grouped by state. ` +
    `Nationally ${totals.d} Democrats and ${totals.r} Republicans` +
    (totals.other ? `, ${totals.other} other` : '') +
    (totals.vacant ? `, ${plural(totals.vacant, 'vacant seat', 'vacant seats')}` : '') +
    '.';

  return (
    <section
      aria-labelledby="delegation-dot-map-heading"
      className="mt-4 bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div>
          <h2
            id="delegation-dot-map-heading"
            className="font-serif text-xl sm:text-2xl text-brand-navy"
          >
            {title}
          </h2>
          <p className="text-xs text-stone-500">{shown.subtitle}</p>
        </div>
        <SegmentedControl<Side>
          label="Seats"
          value={side}
          options={[
            { value: 'pr', label: proportional.toggleLabel },
            { value: 'actual', label: actual.toggleLabel },
          ]}
          onChange={setSide}
        />
      </div>

      <ul
        className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-600"
        aria-hidden="true"
      >
        <LegendItem kind="D" label="Democrat" />
        <LegendItem kind="R" label="Republican" />
        {totals.other > 0 && <LegendItem kind="other" label="Other" />}
        {totals.vacant > 0 && <LegendItem kind="vacant" label="Vacant" />}
      </ul>

      <div ref={frameRef} className="relative mt-2" onMouseMove={moveTooltip}>
        <svg
          viewBox={`0 0 ${placement.width} ${placement.height}`}
          className="w-full h-auto"
          role="img"
          aria-label={summary}
        >
          {states.map((geo) => (
            <path
              key={geo.fips}
              d={geo.path}
              fill={hoverFips === geo.fips ? STATE_FILL_HOVER : STATE_FILL}
              stroke="#fff"
              strokeWidth={0.75}
              className="transition-[fill] duration-150 motion-reduce:transition-none"
            />
          ))}

          {placement.callouts.map((c) => (
            <g key={c.fips} className="[pointer-events:none]">
              <line
                x1={c.leader[0][0]}
                y1={c.leader[0][1]}
                x2={c.leader[1][0]}
                y2={c.leader[1][1]}
                stroke={VACANT_STROKE}
                strokeWidth={0.75}
              />
              <circle cx={c.leader[0][0]} cy={c.leader[0][1]} r={1.3} fill={OTHER_COLOR} />
              <text
                x={c.labelX}
                y={c.labelY}
                dominantBaseline="central"
                fontSize={10}
                fontWeight={600}
                fill={hoverFips === c.fips ? '#1F2E4D' : '#57534e'}
              >
                {c.code}
              </text>
            </g>
          ))}

          {placement.dots.map((dot) => (
            <circle
              // Positions are unique map-wide and don't change between the two
              // sides, so a seat keeps its element and its fill transitions
              // when the toggle (or cycle) hands it to the other party.
              key={`${dot.x.toFixed(2)}:${dot.y.toFixed(2)}`}
              cx={dot.x}
              cy={dot.y}
              r={dot.kind === 'vacant' ? DOT_RADIUS - 0.6 : DOT_RADIUS}
              fill={DOT_FILL[dot.kind]}
              stroke={dot.kind === 'vacant' ? VACANT_STROKE : 'none'}
              strokeWidth={1.2}
              className="transition-[fill,stroke] duration-300 ease-out motion-reduce:transition-none [pointer-events:none]"
            />
          ))}

          {/* Hit layer: transparent state shapes and callout boxes on top, so
            * the pointer lands on a state whether it's over a dot or a gap. */}
          {states.map((geo) =>
            prByFips.has(geo.fips) ? (
              <path
                key={geo.fips}
                d={geo.path}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoverFips(geo.fips)}
                onMouseLeave={() => setHoverFips(null)}
                onClick={() => onSelect(geo.fips)}
              />
            ) : null,
          )}
          {placement.callouts.map((c) => (
            <rect
              key={c.fips}
              x={c.x - 3}
              y={c.y - 3}
              width={c.labelX - c.x + 22}
              height={c.height + 6}
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={() => setHoverFips(c.fips)}
              onMouseLeave={() => setHoverFips(null)}
              onClick={() => onSelect(c.fips)}
            />
          ))}
        </svg>

        <div
          ref={tooltipRef}
          className={`absolute w-56 bg-white/95 backdrop-blur-sm border border-stone-200 rounded-xl px-3 py-2.5 shadow-lg text-sm pointer-events-none ${
            hoveredName ? '' : 'hidden'
          }`}
        >
          {hoveredName && (
            <>
              <div className="font-semibold text-stone-900">{hoveredName}</div>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                {tooltipRows.map(({ set, del, active }) => (
                  <div key={set.rowLabel} className="contents">
                    <dt className={active ? 'text-stone-700 font-medium' : 'text-stone-500'}>
                      {set.rowLabel}
                    </dt>
                    <dd className={`tabular-nums ${active ? 'font-medium' : 'text-stone-500'}`}>
                      <span className={active ? 'text-blue-700' : ''}>D {del.d}</span>
                      {' · '}
                      <span className={active ? 'text-red-700' : ''}>R {del.r}</span>
                      {del.other > 0 && ` · ${del.other} other`}
                      {del.vacant > 0 && ` · ${del.vacant} vacant`}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      </div>

      <p className="mt-3 text-xs text-stone-500">
        Each dot is one seat, with Democrats on the left of each state and Republicans on the
        right. The six smallest Northeast states are drawn offshore. Flip between{' '}
        {proportional.toggleLabel} and {actual.toggleLabel} to watch the seats that change hands.
        Hover a state for its numbers, or click it for full detail.
      </p>

      <table className="sr-only">
        <caption>{`Seats by state: ${proportional.rowLabel} vs. ${actual.rowLabel}.`}</caption>
        <thead>
          <tr>
            <th scope="col">State</th>
            <th scope="col">{proportional.rowLabel}</th>
            <th scope="col">{actual.rowLabel}</th>
          </tr>
        </thead>
        <tbody>
          {proportional.delegations.map((pr) => {
            const act = actualByFips.get(pr.fips);
            return (
              <tr key={pr.fips}>
                <th scope="row">{pr.name}</th>
                <td>{`Democratic ${pr.d}, Republican ${pr.r}`}</td>
                <td>
                  {act
                    ? `Democratic ${act.d}, Republican ${act.r}` +
                      (act.other ? `, other ${act.other}` : '') +
                      (act.vacant ? `, vacant ${act.vacant}` : '')
                    : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function LegendItem({ kind, label }: { kind: SeatKind; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <svg width="10" height="10" viewBox="0 0 10 10">
        <circle
          cx="5"
          cy="5"
          r={kind === 'vacant' ? 3.9 : 4.5}
          fill={DOT_FILL[kind]}
          stroke={kind === 'vacant' ? VACANT_STROKE : 'none'}
          strokeWidth={1.2}
        />
      </svg>
      {label}
    </li>
  );
}

/** Memoized like USMap: Home re-renders often, and these props are stable memos. */
export const DelegationDotMap = memo(DelegationDotMapInner);
