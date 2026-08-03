import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';
import { Hemicycle, type HemicycleParty } from '../components/Hemicycle';
import { Reveal } from '../components/Reveal';
import { allocateN, type AllocationMethod } from '../lib/allocation';
import { balanceColor } from '../lib/colors';
import { fetchJson } from '../lib/fetchJson';
import { PARTY_D, PARTY_R } from '../lib/parties';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { ROUTE_META, datasetSchema } from '../lib/routeMeta';
import type { ECCandidate, ECCycle, ElectoralCollegePayload } from '../lib/types';

const D_COLOR = PARTY_D.color;
const R_COLOR = PARTY_R.color;
// Distinct, color-blind-friendly hues for third parties, assigned in order of
// electors won (so the most consequential third party is most distinct).
const OTHER_PALETTE = ['#059669', '#CA8A04', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

const METHODS: { id: AllocationMethod; label: string }[] = [
  { id: 'sainte-lague', label: 'Sainte-Laguë' },
  { id: 'dhondt', label: "D'Hondt" },
  { id: 'hamilton', label: 'Hamilton' },
];

function partyName(p: 'D' | 'R' | 'O'): string {
  return p === 'D' ? 'Democratic' : p === 'R' ? 'Republican' : 'third-party';
}

interface ComputedCandidate {
  name: string;
  party: 'D' | 'R' | 'O';
  electors: number;
  color: string;
}

interface ComputedState {
  code: string;
  name: string;
  ev: number;
  actual_winner_party: 'D' | 'R' | 'O';
  candidates: (ECCandidate & { electors: number })[];
  dEl: number;
  rEl: number;
}

interface Computed {
  states: ComputedState[];
  candidates: ComputedCandidate[]; // national, electors > 0, sorted desc
  byParty: Record<'D' | 'R' | 'O', number>;
  leader: ComputedCandidate;
  noMajority: boolean;
  majorityGap: number;
}

/** Re-allocate a whole cycle client-side for the chosen method (the data ships
 *  per-state candidate votes precisely so this toggle is faithful). */
function computeCycle(cycle: ECCycle, method: AllocationMethod): Computed {
  const states: ComputedState[] = cycle.states.map((s) => {
    const electors = allocateN({ seats: s.ev, votes: s.candidates.map((c) => c.votes) }, method);
    const cands = s.candidates.map((c, i) => ({ ...c, electors: electors[i] }));
    let dEl = 0;
    let rEl = 0;
    for (const c of cands) {
      if (c.party === 'D') dEl += c.electors;
      else if (c.party === 'R') rEl += c.electors;
    }
    return { code: s.code, name: s.name, ev: s.ev, actual_winner_party: s.actual_winner_party, candidates: cands, dEl, rEl };
  });

  const byParty: Record<'D' | 'R' | 'O', number> = { D: 0, R: 0, O: 0 };
  const byName = new Map<string, { name: string; party: 'D' | 'R' | 'O'; electors: number }>();
  for (const s of states) {
    for (const c of s.candidates) {
      byParty[c.party] += c.electors;
      if (c.electors > 0) {
        const rec = byName.get(c.name) ?? { name: c.name, party: c.party, electors: 0 };
        rec.electors += c.electors;
        byName.set(c.name, rec);
      }
    }
  }

  const sorted = [...byName.values()].sort((a, b) => b.electors - a.electors);
  let otherIdx = 0;
  const candidates: ComputedCandidate[] = sorted.map((c) => ({
    ...c,
    color: c.party === 'D' ? D_COLOR : c.party === 'R' ? R_COLOR : OTHER_PALETTE[otherIdx++ % OTHER_PALETTE.length],
  }));
  // `byName` only collects candidates with electors > 0, so a cycle whose
  // states all allocate zero (or a malformed `states` array) leaves this empty.
  // Reading candidates[0].electors then threw and replaced the whole page with
  // the generic error screen.
  const leader = candidates[0] ?? { name: '—', party: 'O' as const, electors: 0, color: OTHER_PALETTE[0] };
  const noMajority = leader.electors < cycle.majority;
  return { states, candidates, byParty, leader, noMajority, majorityGap: cycle.majority - leader.electors };
}

/** Hemicycle order: Democrats on the left, third parties in the middle (by
 *  size), Republicans on the right — so the 538-dot arc reads left-to-right. */
function hemicycleParties(c: Computed): HemicycleParty[] {
  const d = c.candidates.filter((x) => x.party === 'D');
  const r = c.candidates.filter((x) => x.party === 'R');
  const o = c.candidates.filter((x) => x.party === 'O');
  return [...d, ...o, ...r].map((x) => ({ id: x.name, color: x.color, seats: x.electors, label: x.name }));
}

type ECView = 'proportional' | 'actual';

/** Segmented Proportional⇄Actual switch (used independently by the hemicycle and the map). */
function ViewToggle({ value, onChange, label }: { value: ECView; onChange: (v: ECView) => void; label: string }) {
  return (
    <div className="inline-flex rounded-md border border-stone-200 overflow-hidden text-xs" role="group" aria-label={label}>
      {(['proportional', 'actual'] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={'px-3 py-1 transition-colors ' + (value === v ? 'bg-brand-navy text-white' : 'bg-white text-stone-600 hover:bg-stone-50')}
        >
          {v === 'proportional' ? 'Proportional' : 'Actual'}
        </button>
      ))}
    </div>
  );
}

export function ElectoralCollege() {
  useDocumentTitle(
    ROUTE_META['/electoral-college'].title,
    ROUTE_META['/electoral-college'].description,
    ROUTE_META['/electoral-college'].canonicalPath,
  );

  const [payload, setPayload] = useState<ElectoralCollegePayload | null>(null);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [method, setMethod] = useState<AllocationMethod>('sainte-lague');
  // Independent Proportional⇄Actual toggles for the hemicycle and the map.
  const [hemiView, setHemiView] = useState<'proportional' | 'actual'>('proportional');
  const [mapView, setMapView] = useState<'proportional' | 'actual'>('proportional');

  useEffect(() => {
    fetchJson<ElectoralCollegePayload>('/data/electoral_college.json')
      .then((p) => {
        setPayload(p);
        // Default to the most recent cycle that actually has data. Taking the
        // last entry of meta.cycles blindly meant a year listed in meta but
        // missing from p.cycles left the page stuck on "Loading…" forever,
        // with no error path.
        const usable = [...p.meta.cycles].reverse().find((y) => p.cycles[String(y)]);
        if (usable == null) {
          setError('electoral_college.json lists no cycle with data.');
          return;
        }
        setYear(usable);
      })
      .catch((e) => setError(String(e)));
    fetchJson<Topology>('/data/states-10m.json')
      .then(setTopology)
      .catch(() => null); // map is best-effort; table still works
  }, []);

  const cycle = payload && year != null ? payload.cycles[String(year)] : null;
  const computed = useMemo(() => (cycle ? computeCycle(cycle, method) : null), [cycle, method]);

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <p className="text-red-700">Couldn’t load the Electoral College data. {error}</p>
      </div>
    );
  }
  if (!payload || !cycle || !computed || year == null) {
    return <div className="max-w-5xl mx-auto px-4 py-12 text-stone-500">Loading…</div>;
  }

  const noMajorityCount = payload.series.filter((s) => s.no_majority).length;
  const leadTie =
    computed.candidates.length >= 2 && computed.candidates[0].electors === computed.candidates[1].electors;

  // Actual (winner-take-all) view: only D and R ever won electoral votes 1976-2024.
  const dCand = computed.candidates.find((c) => c.party === 'D');
  const rCand = computed.candidates.find((c) => c.party === 'R');
  const dName = dCand?.name ?? 'Democrat';
  const rName = rCand?.name ?? 'Republican';
  const aD = cycle.actual.by_party.D;
  const aR = cycle.actual.by_party.R;
  const actualWinnerD = cycle.actual.winner_party === 'D';
  const actualParties: HemicycleParty[] = [
    { id: 'D', color: D_COLOR, seats: aD, label: dName },
    { id: 'R', color: R_COLOR, seats: aR, label: rName },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 sm:py-10">
      <header className="max-w-3xl">
        <p className="text-xs uppercase tracking-wider text-stone-500 font-medium">An experiment</p>
        <h1 className="mt-1 font-serif text-3xl sm:text-4xl font-medium text-brand-navy tracking-tight">
          The Proportional Electoral College
        </h1>
        <p className="mt-3 text-stone-600 leading-relaxed">
          What if every state split its electoral votes in proportion to its popular vote, instead of
          winner-take-all? Apply that to each presidential election since 1976 and a striking pattern
          emerges: in <strong>{noMajorityCount} of {payload.series.length}</strong> cycles, no candidate
          reaches 270 — the election would have gone to a contingent vote in the U.S. House. This is a
          historical hindcast from the real, certified state results; see the{' '}
          <Link className="underline hover:text-brand-navy" to="/methodology#limitations">methodology</Link>.
        </p>
      </header>

      {/* Cycle selector */}
      <div className="mt-8">
        <div className="text-xs uppercase tracking-wider text-stone-500 font-medium mb-2">Election</div>
        <div className="flex flex-wrap gap-1.5">
          {payload.meta.cycles.map((y) => {
            const nm = payload.series.find((s) => s.year === y)?.no_majority;
            const active = y === year;
            return (
              <button
                key={y}
                onClick={() => setYear(y)}
                className={
                  'relative px-2.5 py-1.5 rounded-md text-sm tabular-nums transition-colors ' +
                  (active
                    ? 'bg-brand-navy text-white'
                    : 'bg-white text-stone-700 border border-stone-200 hover:border-brand-navy')
                }
                aria-pressed={active}
                title={nm ? `${y}: no 270 majority under PR` : String(y)}
              >
                {y}
                {nm && (
                  <span
                    className={'absolute -top-1 -right-1 w-2 h-2 rounded-full ' + (active ? 'bg-amber-300' : 'bg-amber-500')}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-stone-400">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-500 align-middle" /> marks cycles
          with no 270 majority under proportional allocation.
        </p>
      </div>

      {/* Result summary + hemicycle */}
      <Reveal>
        <div className="mt-6 bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl text-brand-navy">{year}</h2>
              <p className="text-sm text-stone-500 mt-0.5">
                Actual result:{' '}
                <span className={actualWinnerD ? 'text-blue-700' : 'text-red-700'}>
                  {actualWinnerD ? 'Democratic' : 'Republican'} win
                </span>{' '}
                — {aD} D / {aR} R (winner-take-all)
              </p>
            </div>
            <div className="flex flex-col items-start sm:items-end gap-2">
              <ViewToggle value={hemiView} onChange={setHemiView} label="Hemicycle: proportional or actual" />
              {hemiView === 'proportional' && (
                <div className="flex items-center gap-1 text-xs" role="group" aria-label="Allocation method">
                  <span className="text-stone-400 mr-0.5">Method</span>
                  {METHODS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMethod(m.id)}
                      className={
                        'px-2 py-1 rounded-md border transition-colors ' +
                        (method === m.id
                          ? 'bg-brand-navy text-white border-brand-navy'
                          : 'bg-white text-stone-600 border-stone-200 hover:border-brand-navy')
                      }
                      aria-pressed={method === m.id}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {hemiView === 'actual' ? (
            <div className="mt-4 rounded-lg bg-stone-50 border border-stone-200 px-4 py-3">
              <p className="text-stone-800">
                <span className={(actualWinnerD ? 'text-blue-700' : 'text-red-700') + ' font-semibold'}>
                  {actualWinnerD ? dName : rName}
                </span>{' '}
                won the Electoral College with {actualWinnerD ? aD : aR} electoral votes ({actualWinnerD ? rName : dName}{' '}
                {actualWinnerD ? aR : aD}).
              </p>
            </div>
          ) : computed.noMajority ? (
            <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
              <p className="text-amber-900 font-medium">
                No 270 majority — the election would go to the U.S. House.
              </p>
              <p className="text-amber-800 text-sm mt-0.5">
                {leadTie ? (
                  <>
                    {computed.candidates[0].name} and {computed.candidates[1].name} tie at{' '}
                    {computed.leader.electors} electors — {computed.majorityGap} short of 270.
                  </>
                ) : (
                  <>
                    {computed.leader.name} leads with {computed.leader.electors} electors,{' '}
                    {computed.majorityGap} short of 270.
                  </>
                )}{' '}
                Under the 12th Amendment, the House would choose the president (one vote per state
                delegation).
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded-lg bg-stone-50 border border-stone-200 px-4 py-3">
              <p className="text-stone-800">
                <span style={{ color: computed.leader.color }} className="font-semibold">
                  {computed.leader.name}
                </span>{' '}
                wins a proportional majority with {computed.leader.electors} electors.
              </p>
            </div>
          )}

          <div className="mt-4">
            <Hemicycle
              parties={hemiView === 'proportional' ? hemicycleParties(computed) : actualParties}
              ariaLabel={
                hemiView === 'proportional'
                  ? `Proportional Electoral College, ${year}: ${computed.candidates
                      .map((c) => `${c.name} ${c.electors}`)
                      .join(', ')}. 270 needed for a majority.`
                  : `Actual Electoral College, ${year}: ${dName} ${aD}, ${rName} ${aR}.`
              }
            />
          </div>

          {/* National per-candidate breakdown */}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
            {(hemiView === 'proportional'
              ? computed.candidates
              : [
                  { name: dName, color: D_COLOR, electors: aD, party: 'D' as const },
                  { name: rName, color: R_COLOR, electors: aR, party: 'R' as const },
                ].sort((a, b) => b.electors - a.electors)
            ).map((c) => (
              <span key={c.name} className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c.color }} aria-hidden="true" />
                <span className="text-stone-700">{c.name}</span>
                <span className="font-semibold tabular-nums text-stone-900">{c.electors}</span>
                {c.party === 'O' && <span className="text-xs text-stone-400">({partyName(c.party)})</span>}
              </span>
            ))}
          </div>
        </div>
      </Reveal>

      {/* Map + table */}
      <Reveal>
        <div className="mt-4 bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-serif text-xl text-brand-navy">State by state</h2>
            <ViewToggle value={mapView} onChange={setMapView} label="Map: proportional or actual" />
          </div>
          <p className="text-xs text-stone-500 mt-0.5">
            {mapView === 'proportional' ? (
              <>
                Shaded by the proportional Democratic–Republican elector margin; hover for each state’s
                split. Maine and Nebraska are allocated statewide here (the actual result splits them by
                district).
              </>
            ) : (
              <>
                Each state’s actual winner, winner-take-all. Maine and Nebraska are shown by their statewide
                winner (they split their electoral votes by district in reality).
              </>
            )}
          </p>
          {topology && <ECMap topology={topology} states={computed.states} view={mapView} />}
          <ECTable states={computed.states} />
        </div>
      </Reveal>

      <footer className="mt-6 text-xs text-stone-400 leading-relaxed max-w-3xl">
        <p>
          Sources: {payload.meta.sources['1976-1996']}; {payload.meta.sources['2000-2024']}; electoral
          votes from the {payload.meta.sources['electoral_votes']}. Winner-take-all over this data
          reproduces the actual Electoral College result of every cycle. Electors are allocated only
          among named candidates; a small number of ballots the source records as blank, scattered, or
          unattributed (“other”) are excluded, since an elector can’t be cast for them. Faithless
          electors (which made a few real tallies differ by an elector or two) are not modeled. Tiny
          candidates that win no electors are omitted from the breakdown.
        </p>
      </footer>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            datasetSchema({
              name: 'The Proportional Electoral College, 1976–2024',
              description:
                'Every U.S. presidential election since 1976 recomputed as if each state allocated its electoral votes in proportion to its popular vote instead of winner-take-all — with per-state elector splits and how often no candidate reaches a 270 majority.',
              canonicalPath: '/electoral-college',
              dataPath: '/data/electoral_college.json',
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

function ECMap({ topology, states, view }: { topology: Topology; states: ComputedState[]; view: ECView }) {
  const [hover, setHover] = useState<string | null>(null);
  const byName = useMemo(() => new Map(states.map((s) => [s.name, s])), [states]);

  const geojson = useMemo(
    () => feature(topology, topology.objects.states) as unknown as FeatureCollection<Geometry, { name: string }>,
    [topology],
  );
  const pathGen = useMemo(() => geoPath(geoAlbersUsa().fitSize([MAP_W, MAP_H], geojson)), [geojson]);

  const hovered = hover ? byName.get(hover) ?? null : null;
  const actualFill = (p: 'D' | 'R' | 'O') => (p === 'D' ? D_COLOR : p === 'R' ? R_COLOR : '#d6d3d1');

  return (
    <div className="relative mt-3">
      {/* role="img" omitted deliberately — see the note in src/components/Map.tsx. */}
      <svg
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        className="w-full h-auto"
        aria-label={
          view === 'proportional'
            ? 'Map of the Proportional Electoral College result by state'
            : 'Map of the actual Electoral College result by state'
        }
      >
        {geojson.features.map((f, i) => {
          const st = byName.get(f.properties.name);
          let fill = '#e5e7eb';
          if (st) {
            fill =
              view === 'actual'
                ? actualFill(st.actual_winner_party)
                : balanceColor(st.ev > 0 ? (st.dEl - st.rEl) / st.ev : 0);
          }
          const aria = !st
            ? undefined
            : view === 'actual'
              ? `${st.name}: ${st.actual_winner_party === 'D' ? 'Democratic' : st.actual_winner_party === 'R' ? 'Republican' : 'split'} won (${st.ev} electoral votes)`
              : `${st.name}: ${st.dEl} Democratic, ${st.rEl} Republican electors of ${st.ev}`;
          return (
            <path
              key={i}
              d={pathGen(f) || ''}
              fill={fill}
              stroke={hover === f.properties.name ? '#1F2E4D' : '#fff'}
              strokeWidth={hover === f.properties.name ? 1.5 : 0.75}
              className="cursor-pointer transition-[stroke-width,fill] duration-150"
              onMouseEnter={() => setHover(f.properties.name)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(f.properties.name)}
              onBlur={() => setHover(null)}
              tabIndex={st ? 0 : -1}
              aria-label={aria}
            />
          );
        })}
      </svg>
      {hovered && (
        <div className="absolute top-2 right-2 w-52 bg-white/95 backdrop-blur-sm border border-stone-200 rounded-xl px-3 py-2.5 shadow-lg text-sm pointer-events-none">
          <div className="font-semibold text-stone-900">{hovered.name}</div>
          <div className="text-xs text-stone-500">{hovered.ev} electoral votes</div>
          {view === 'actual' ? (
            <div className="mt-1 text-stone-700">
              Won by{' '}
              <span className={hovered.actual_winner_party === 'D' ? 'text-blue-700 font-medium' : 'text-red-700 font-medium'}>
                {hovered.actual_winner_party === 'D' ? 'Democrat' : hovered.actual_winner_party === 'R' ? 'Republican' : '—'}
              </span>
            </div>
          ) : (
            <div className="mt-1 space-y-0.5">
              {hovered.candidates.filter((c) => c.electors > 0).map((c) => (
                <div key={c.name} className="flex justify-between gap-3">
                  <span className="text-stone-700">{c.name}</span>
                  <span className="font-semibold tabular-nums">{c.electors}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Table -----------------------------------------------------------------

function ECTable({ states }: { states: ComputedState[] }) {
  const rows = useMemo(() => [...states].sort((a, b) => b.ev - a.ev), [states]);
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-stone-500 border-b border-stone-200">
            <th className="py-1.5 pr-3 font-medium">State</th>
            <th className="py-1.5 px-2 font-medium text-right">EV</th>
            <th className="py-1.5 px-2 font-medium">Proportional split</th>
            <th className="py-1.5 pl-2 font-medium">Actual (WTA)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.code} className="border-b border-stone-100">
              <td className="py-1.5 pr-3 text-stone-800">{s.name}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-stone-600">{s.ev}</td>
              <td className="py-1.5 px-2 text-stone-700">
                {s.candidates
                  .filter((c) => c.electors > 0)
                  .map((c) => `${c.name.split(' ').slice(-1)[0]} ${c.electors}`)
                  .join(' · ')}
              </td>
              <td className="py-1.5 pl-2">
                <span className={s.actual_winner_party === 'D' ? 'text-blue-700' : s.actual_winner_party === 'R' ? 'text-red-700' : 'text-stone-600'}>
                  {s.actual_winner_party === 'D' ? 'D' : s.actual_winner_party === 'R' ? 'R' : '—'} sweep
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ElectoralCollege;
