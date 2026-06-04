import { useEffect, useMemo, useState } from 'react';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';
import { Reveal } from '../components/Reveal';
import { fetchJson } from '../lib/fetchJson';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { ROUTE_META } from '../lib/routeMeta';
import type { CircuitsGroup, CircuitsPayload } from '../lib/types';

type CircuitView = 'current' | 'rebalanced';

// 13-color qualitative palette (distinct enough for adjacent circuits).
const PALETTE = [
  '#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1',
  '#ff9da7', '#9c755f', '#86bcb6', '#d37295', '#a0cbe8', '#8cd17d',
];
const DC_COLOR = '#9aa0a6'; // neutral gray — the D.C. Circuit is the special case

const fmt = (n: number) => n.toLocaleString('en-US');
const fmtM = (n: number) => `${(n / 1e6).toFixed(1)}M`;

function ViewToggle({ value, onChange }: { value: CircuitView; onChange: (v: CircuitView) => void }) {
  return (
    <div className="inline-flex rounded-md border border-stone-200 overflow-hidden text-xs" role="group" aria-label="Current or rebalanced circuits">
      {(['current', 'rebalanced'] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={'px-3 py-1 transition-colors ' + (value === v ? 'bg-brand-navy text-white' : 'bg-white text-stone-600 hover:bg-stone-50')}
        >
          {v === 'current' ? 'Today' : 'Rebalanced'}
        </button>
      ))}
    </div>
  );
}

/** Map circuit id → color (DC always gray; others by their order in the group). */
function colorMap(group: CircuitsGroup): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  for (const c of group.circuits) {
    out[c.id] = c.id === 'DC' || c.id === 'dc' ? DC_COLOR : PALETTE[i++ % PALETTE.length];
  }
  return out;
}

export function Circuits() {
  useDocumentTitle(
    ROUTE_META['/circuits'].title,
    ROUTE_META['/circuits'].description,
    ROUTE_META['/circuits'].canonicalPath,
  );

  const [data, setData] = useState<CircuitsPayload | null>(null);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<CircuitView>('current');
  const [showSeniors, setShowSeniors] = useState(false);

  useEffect(() => {
    fetchJson<CircuitsPayload>('/data/circuits.json').then(setData).catch((e) => setError(String(e)));
    fetchJson<Topology>('/data/states-10m.json').then(setTopology).catch(() => null);
  }, []);

  const group = data ? data[view] : null;
  const colors = useMemo(() => (group ? colorMap(group) : {}), [group]);

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <p className="text-red-700">Couldn’t load the circuits data. {error}</p>
      </div>
    );
  }
  if (!data || !group) {
    return <div className="max-w-5xl mx-auto px-4 py-12 text-stone-500">Loading…</div>;
  }

  const cur = data.current.disparity;
  const reb = data.rebalanced.disparity;
  const rows = [...group.circuits].sort((a, b) => b.population - a.population);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 sm:py-10">
      <header className="max-w-3xl">
        <p className="text-xs uppercase tracking-wider text-stone-500 font-medium">An experiment</p>
        <h1 className="mt-1 font-serif text-3xl sm:text-4xl font-medium text-brand-navy tracking-tight">
          The federal circuit map
        </h1>
        <p className="mt-3 text-stone-600 leading-relaxed">
          The U.S. Courts of Appeals are carved into circuits of wildly unequal size. The{' '}
          <strong>{cur.max.label}</strong> covers <strong>{fmtM(cur.max.population)}</strong> people — about 1 in 5
          Americans — while the <strong>{cur.min.label}</strong> covers {fmtM(cur.min.population)}, a{' '}
          <strong>{cur.ratio}×</strong> gap (the decades-old “split the 9th” debate). Toggle to a{' '}
          <strong>rebalanced</strong> redraw — same idea, drawn for far more equal population — and the gap falls to{' '}
          <strong>{reb.ratio}×</strong>, with judges reassigned so workload per judge evens out too. A circuit’s real
          load is <em>caseload</em>, not population, so treat this as a structural curiosity, not a proposal.
        </p>
      </header>

      <Reveal>
        <div className="mt-8 bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-xl text-brand-navy">
                {view === 'current' ? 'Today’s circuits' : 'A rebalanced map'}
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">
                {view === 'current'
                  ? 'Each state colored by its circuit. The 9th (the entire West) dwarfs the rest.'
                  : 'One illustrative redraw into contiguous, more population-equal circuits (no circuit bigger than California).'}
              </p>
            </div>
            <ViewToggle value={view} onChange={setView} />
          </div>

          {topology && <CircuitMap topology={topology} group={group} colors={colors} showSeniors={showSeniors} />}
        </div>
      </Reveal>

      <Reveal>
        <div className="mt-4 bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-serif text-xl text-brand-navy">
              {view === 'current' ? 'Today’s circuits, by the numbers' : 'The rebalanced circuits'}
            </h2>
            <div className="inline-flex rounded-md border border-stone-200 overflow-hidden text-xs" role="group" aria-label="Count active judges only, or include senior judges">
              {(['active', 'senior'] as const).map((v) => {
                const on = (v === 'senior') === showSeniors;
                return (
                  <button
                    key={v}
                    onClick={() => setShowSeniors(v === 'senior')}
                    aria-pressed={on}
                    className={'px-3 py-1 transition-colors ' + (on ? 'bg-brand-navy text-white' : 'bg-white text-stone-600 hover:bg-stone-50')}
                  >
                    {v === 'senior' ? '+ Senior' : 'Active'}
                  </button>
                );
              })}
            </div>
          </div>
          {showSeniors && (
            <p className="text-xs text-stone-500 mt-1">
              Adding the {data.meta.total_senior_judges} senior circuit judges (semi-retired, still hearing cases) as of{' '}
              {data.meta.senior_judges_as_of}. Seniors carry reduced caseloads, so this is an optimistic floor.
            </p>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-stone-500 border-b border-stone-200">
                  <th className="py-1.5 pr-3 font-medium">Circuit</th>
                  <th className="py-1.5 px-2 font-medium text-right">Population</th>
                  <th className="py-1.5 px-2 font-medium text-right">{showSeniors ? 'Judges (active + senior)' : 'Active judges'}</th>
                  <th className="py-1.5 pl-2 font-medium text-right">People / judge</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const isDC = c.id === 'DC' || c.id === 'dc';
                  const judges = c.active_judges + (showSeniors ? c.senior_judges : 0);
                  const ppj = judges > 0 ? Math.round(c.population / judges) : null;
                  return (
                    <tr key={c.id} className="border-b border-stone-100">
                      <td className="py-1.5 pr-3">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colors[c.id] }} />
                          <span className="text-stone-800">{c.label}</span>
                        </span>
                        <span className="block text-[11px] text-stone-400 ml-[18px]">{c.states.join(' · ')}</span>
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-stone-700">{fmt(c.population)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-stone-700">
                        {judges}
                        {showSeniors && <span className="block text-[11px] text-stone-400">{c.active_judges} + {c.senior_judges}</span>}
                      </td>
                      <td className="py-1.5 pl-2 text-right tabular-nums text-stone-700">
                        {ppj ? fmt(ppj) : '—'}
                        {isDC && <span className="block text-[11px] text-stone-400">federal-gov docket</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Reveal>

      <footer className="mt-6 text-xs text-stone-400 leading-relaxed max-w-3xl">
        <p>
          Circuit composition: {data.meta.composition_source}. Authorized active judgeships: {data.meta.judgeships_source}.
          Senior judges: {data.meta.senior_judges_source} (current as of {data.meta.senior_judges_as_of}).
          Populations: {data.meta.population_source}. {data.meta.note} The D.C. Circuit hears federal-government cases
          rather than a population, so its people-per-judge is not comparable. Puerto Rico (1st Circuit) is included;
          Guam, the Northern Mariana Islands, and the U.S. Virgin Islands are omitted.
        </p>
      </footer>
    </div>
  );
}

// --- Map -------------------------------------------------------------------

const MAP_W = 975;
const MAP_H = 610;

function CircuitMap({
  topology,
  group,
  colors,
  showSeniors,
}: {
  topology: Topology;
  group: CircuitsGroup;
  colors: Record<string, string>;
  showSeniors: boolean;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const labelByState = useMemo(() => {
    const m = new Map<string, { circuit: string; population: number; active: number; senior: number }>();
    for (const c of group.circuits) {
      for (const code of c.states) {
        m.set(code, { circuit: c.label, population: c.population, active: c.active_judges, senior: c.senior_judges });
      }
    }
    return m;
  }, [group]);

  // states-10m features carry a 2-digit FIPS id and a name; we color by postal
  // code, so map name → postal via the by_state keys is indirect. Use FIPS→code.
  const geojson = useMemo(
    () => feature(topology, topology.objects.states) as unknown as FeatureCollection<Geometry, { name: string }>,
    [topology],
  );
  const pathGen = useMemo(() => geoPath(geoAlbersUsa().fitSize([MAP_W, MAP_H], geojson)), [geojson]);

  const codeForName = (name: string) => NAME_TO_CODE[name];
  const hovered = hover ? labelByState.get(codeForName(hover) ?? '') ?? null : null;

  return (
    <div className="relative mt-3">
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="w-full h-auto" role="img" aria-label="Map of the U.S. courts of appeals circuits by state">
        {geojson.features.map((f, i) => {
          const code = codeForName(f.properties.name);
          const cid = code ? group.by_state[code] : undefined;
          const fill = cid ? colors[cid] : '#e5e7eb';
          const isHover = hover === f.properties.name;
          return (
            <path
              key={i}
              d={pathGen(f) || ''}
              fill={fill}
              stroke={isHover ? '#1F2E4D' : '#fff'}
              strokeWidth={isHover ? 1.5 : 0.75}
              className="cursor-pointer transition-[fill,stroke-width] duration-150"
              onMouseEnter={() => setHover(f.properties.name)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>
      {hovered && (
        <div className="absolute top-2 right-2 w-56 bg-white/95 backdrop-blur-sm border border-stone-200 rounded-xl px-3 py-2.5 shadow-lg text-sm pointer-events-none">
          <div className="font-semibold text-stone-900">{hover}</div>
          <div className="text-stone-700 mt-0.5">{hovered.circuit}</div>
          {(() => {
            const judges = hovered.active + (showSeniors ? hovered.senior : 0);
            return (
              <div className="text-xs text-stone-500 mt-1">
                {fmt(hovered.population)} people{judges ? ` · ${fmt(Math.round(hovered.population / judges))}/judge` : ''}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// states-10m features use full state names; we key data by postal code.
const NAME_TO_CODE: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
  Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID',
  Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
  Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
  Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
  Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA',
  'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};

export default Circuits;
