import { useEffect, useMemo, useState } from 'react';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';
import { Reveal } from '../components/Reveal';
import { distortionColor } from '../lib/colors';
import { fetchJson } from '../lib/fetchJson';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { ROUTE_META, datasetSchema } from '../lib/routeMeta';
import type { SenatePayload, SenateState } from '../lib/types';

const OVER_COLOR = '#5e3c99'; // purple — overrepresented (small states)
const UNDER_COLOR = '#e66101'; // orange — underrepresented (big states)

const fmt = (n: number) => n.toLocaleString('en-US');

/** representation_index (~0.17–11.5) → a diverging signal in [-1, 1], log-scaled
 *  around the national average (1.0). index 8× → +1 (deep purple), 1/8× → −1 (deep orange). */
function repSignal(index: number): number {
  return Math.max(-1, Math.min(1, Math.log2(index) / 3));
}

export function Senate() {
  useDocumentTitle(
    ROUTE_META['/senate'].title,
    ROUTE_META['/senate'].description,
    ROUTE_META['/senate'].canonicalPath,
  );

  const [data, setData] = useState<SenatePayload | null>(null);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState<number | null>(null); // # of smallest states selected

  useEffect(() => {
    fetchJson<SenatePayload>('/data/senate.json')
      .then((d) => {
        setData(d);
        setN(d.majority.states_needed); // open at the majority threshold
      })
      .catch((e) => setError(String(e)));
    fetchJson<Topology>('/data/states-10m.json').then(setTopology).catch(() => null);
  }, []);

  const sortedAsc = useMemo(
    () => (data ? [...data.states].sort((a, b) => a.population - b.population) : []),
    [data],
  );

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <p className="text-red-700">Couldn’t load the Senate data. {error}</p>
      </div>
    );
  }
  if (!data || n == null) {
    return <div className="max-w-5xl mx-auto px-4 py-12 text-stone-500">Loading…</div>;
  }

  const selected = sortedAsc.slice(0, n);
  const selectedCodes = new Set(selected.map((s) => s.code));
  const cumSenators = selected.reduce((a, s) => a + s.senators, 0);
  const cumPop = selected.reduce((a, s) => a + s.population, 0);
  const cumShare = cumPop / data.meta.total_population;
  const isMajority = cumSenators >= 51;

  const stateName = (code: string) => data.states.find((s) => s.code === code)?.name ?? code;
  const byRep = [...data.states].sort((a, b) => b.representation_index - a.representation_index);
  const over = byRep.slice(0, 6);
  const under = byRep.slice(-6).reverse();

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 sm:py-10">
      <header className="max-w-3xl">
        <p className="text-xs uppercase tracking-wider text-stone-500 font-medium">An experiment</p>
        <h1 className="mt-1 font-serif text-3xl sm:text-4xl font-medium text-brand-navy tracking-tight">
          The Senate’s malapportionment
        </h1>
        <p className="mt-3 text-stone-600 leading-relaxed">
          The House and the Electoral College distort through <em>winner-take-all</em>. The Senate distorts a
          different way: every state gets two senators regardless of population — so a{' '}
          <strong>{stateName(data.meta.most_overrepresented)}</strong> voter has about{' '}
          <strong>{data.meta.ratio_extremes}×</strong> the Senate representation of a{' '}
          {stateName(data.meta.most_underrepresented)} voter. The starkest version: the{' '}
          <strong>{data.majority.states_needed} smallest states</strong> hold just{' '}
          <strong>{(data.majority.population_share * 100).toFixed(0)}%</strong> of the population, yet their{' '}
          {data.majority.senators} senators are a Senate majority.
        </p>
      </header>

      {/* Build-a-majority interactive + representation map */}
      <Reveal>
        <div className="mt-8 bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-6">
          <h2 className="font-serif text-xl text-brand-navy">Build a Senate majority from the smallest states</h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Add states from least to most populous and watch how few people it takes to control 51 of 100 seats.
          </p>

          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-5">
            <div className="flex-1">
              <input
                type="range"
                min={1}
                max={50}
                value={n}
                onChange={(e) => setN(Number(e.target.value))}
                className="w-full accent-brand-navy"
                aria-label="Number of smallest states included"
              />
              <div className="flex justify-between text-[11px] text-stone-400 mt-1">
                <span>1 state</span>
                <span>50 states</span>
              </div>
              <button
                onClick={() => setN(data.majority.states_needed)}
                className="mt-2 text-xs underline text-stone-500 hover:text-brand-navy"
              >
                Jump to a 51-seat majority
              </button>
            </div>
            <div className="sm:w-56 text-sm tabular-nums">
              <div>
                <span className="font-semibold">{n}</span> smallest {n === 1 ? 'state' : 'states'}
              </div>
              <div className="mt-0.5">
                <span className={'font-semibold ' + (isMajority ? 'text-brand-navy' : 'text-stone-700')}>
                  {cumSenators}
                </span>{' '}
                of 100 senators
              </div>
              <div className="mt-0.5">
                <span className="font-semibold">{(cumShare * 100).toFixed(1)}%</span> of the U.S. population
              </div>
            </div>
          </div>

          <div
            className={
              'mt-4 rounded-lg px-4 py-3 text-sm ' +
              (isMajority ? 'bg-amber-50 border border-amber-200 text-amber-900' : 'bg-stone-50 border border-stone-200 text-stone-700')
            }
          >
            {isMajority ? (
              <>
                The <strong>{n} smallest states</strong> — {cumSenators} senators — would control the Senate with
                just <strong>{(cumShare * 100).toFixed(1)}%</strong> of the population. Fewer than 1 in{' '}
                {Math.round(1 / cumShare)} Americans live there.
              </>
            ) : (
              <>
                {cumSenators} senators, {(cumShare * 100).toFixed(1)}% of the population — add{' '}
                {Math.ceil((51 - cumSenators) / 2)} more {Math.ceil((51 - cumSenators) / 2) === 1 ? 'state' : 'states'} to
                reach a 51-seat majority.
              </>
            )}
          </div>

          {topology && <SenateMap topology={topology} states={data.states} highlight={selectedCodes} />}

          {/* legend */}
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-stone-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: OVER_COLOR }} /> overrepresented (small states)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: UNDER_COLOR }} /> underrepresented (large states)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm border-2 border-brand-navy bg-white" /> in your selected majority
            </span>
          </div>
        </div>
      </Reveal>

      {/* Rankings */}
      <Reveal>
        <div className="mt-4 bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-6">
          <h2 className="font-serif text-xl text-brand-navy">Whose vote counts most</h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Senate representation per person, relative to the national average (1 senator per{' '}
            {fmt(data.meta.national_people_per_senator)} people).
          </p>
          <div className="mt-4 grid sm:grid-cols-2 gap-x-8 gap-y-6">
            <RepTable title="Most overrepresented" states={over} color={OVER_COLOR} />
            <RepTable title="Most underrepresented" states={under} color={UNDER_COLOR} />
          </div>
        </div>
      </Reveal>

      <footer className="mt-6 text-xs text-stone-400 leading-relaxed max-w-3xl">
        <p>
          Source: {data.meta.source}. Populations are the {data.meta.census_year} Census resident counts. The
          District of Columbia and Puerto Rico have no senators and are excluded. This shows the structural cost
          of equal state representation — not a proportional-representation reform; changing it would require a
          constitutional amendment (which is why the rest of this site focuses on the House).
        </p>
      </footer>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            datasetSchema({
              name: 'U.S. Senate malapportionment by state',
              description:
                'State-by-state U.S. Senate representation per person — population, people per senator, and representation relative to the national average — quantifying the structural cost of equal per-state representation.',
              canonicalPath: '/senate',
              dataPath: '/data/senate.json',
            }),
          ),
        }}
      />
    </div>
  );
}

// --- Map -------------------------------------------------------------------

const MAP_W = 975;
const MAP_H = 610;

function SenateMap({
  topology,
  states,
  highlight,
}: {
  topology: Topology;
  states: SenateState[];
  highlight: Set<string>;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const byName = useMemo(() => new Map(states.map((s) => [s.name, s])), [states]);
  const geojson = useMemo(
    () => feature(topology, topology.objects.states) as unknown as FeatureCollection<Geometry, { name: string }>,
    [topology],
  );
  const pathGen = useMemo(() => geoPath(geoAlbersUsa().fitSize([MAP_W, MAP_H], geojson)), [geojson]);
  const hovered = hover ? byName.get(hover) ?? null : null;

  return (
    <div className="relative mt-4">
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="w-full h-auto" role="img" aria-label="Map of U.S. Senate representation per person by state">
        {geojson.features.map((f, i) => {
          const st = byName.get(f.properties.name);
          const fill = st ? distortionColor(repSignal(st.representation_index)) : '#e5e7eb';
          const hi = st ? highlight.has(st.code) : false;
          const isHover = hover === f.properties.name;
          return (
            <path
              key={i}
              d={pathGen(f) || ''}
              fill={fill}
              stroke={hi || isHover ? '#1F2E4D' : '#fff'}
              strokeWidth={hi ? 2 : isHover ? 1.5 : 0.75}
              className="cursor-pointer transition-[stroke-width] duration-150"
              onMouseEnter={() => setHover(f.properties.name)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(f.properties.name)}
              onBlur={() => setHover(null)}
              tabIndex={st ? 0 : -1}
              aria-label={
                st
                  ? `${st.name}: ${st.representation_index}× the national-average Senate representation, ${fmt(st.people_per_senator)} people per senator`
                  : undefined
              }
            />
          );
        })}
      </svg>

      {/* Screen-reader-only tabular fallback for the map. */}
      <table className="sr-only">
        <caption>
          U.S. Senate representation by state: population, people per senator, and representation
          relative to the national average.
        </caption>
        <thead>
          <tr>
            <th scope="col">State</th>
            <th scope="col">Population</th>
            <th scope="col">People per senator</th>
            <th scope="col">Representation vs. national average</th>
          </tr>
        </thead>
        <tbody>
          {[...states]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((s) => (
              <tr key={s.code}>
                <th scope="row">{s.name}</th>
                <td>{fmt(s.population)}</td>
                <td>{fmt(s.people_per_senator)}</td>
                <td>{s.representation_index}×</td>
              </tr>
            ))}
        </tbody>
      </table>
      {hovered && (
        <div className="absolute top-2 right-2 w-56 bg-white/95 backdrop-blur-sm border border-stone-200 rounded-xl px-3 py-2.5 shadow-lg text-sm pointer-events-none">
          <div className="font-semibold text-stone-900">{hovered.name}</div>
          <div className="text-xs text-stone-500">{fmt(hovered.population)} people</div>
          <div className="mt-1 text-stone-700">{fmt(hovered.people_per_senator)} per senator</div>
          <div className="text-stone-700">
            <span className="font-semibold">{hovered.representation_index}×</span> the national average
          </div>
        </div>
      )}
    </div>
  );
}

// --- Rankings table --------------------------------------------------------

function RepTable({ title, states, color }: { title: string; states: SenateState[]; color: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-stone-900 flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
        {title}
      </h3>
      <table className="w-full mt-2 text-sm">
        <tbody>
          {states.map((s) => (
            <tr key={s.code} className="border-b border-stone-100">
              <td className="py-1.5 pr-2 text-stone-800">{s.name}</td>
              <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-stone-900">
                {s.representation_index}×
              </td>
              <td className="py-1.5 pl-2 text-right tabular-nums text-stone-500">
                {fmt(s.people_per_senator)}/sen
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Senate;
