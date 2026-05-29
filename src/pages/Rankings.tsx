import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Topology } from 'topojson-specification';
import { RankingRow } from '../components/RankingRow';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { buildStateSilhouettes } from '../lib/stateSilhouettes';
import { fetchJson } from '../lib/fetchJson';
import type { ProjectionPayload, StateProjection } from '../lib/types';

/**
 * /rankings — multi-leaderboard surface. Four sections:
 *   1. Most distorted delegations today  (votes-vs-seats gap; the structural story)
 *   2. Biggest D gains under PR
 *   3. Biggest R gains under PR
 *   4. Most one-sided delegations (single-party sweeps with non-trivial losing-party share)
 *
 * All four leaderboards are derived client-side from /data/projection.json
 * — no pipeline change needed. Each leaderboard emits a JSON-LD ItemList
 * schema so Google can render the rankings as rich SERP results.
 *
 * Routing rationale: this page is read-heavy and indexable, so the URL
 * design (/rankings, anchor IDs per board) supports deep linking from
 * tweets, articles, etc.
 */
const TOP_N = 10;

interface Leaderboard {
  id: string;
  title: string;
  blurb: string;
  rows: { state: StateProjection; caption?: string }[];
}

export function Rankings() {
  useDocumentTitle(
    'House rankings: most distorted delegations under proportional representation · The Proportional House',
    'Which state delegations diverge most from proportional representation? Leaderboards of the biggest D shifts, biggest R shifts, and most one-sided House delegations.',
    '/rankings',
  );

  const [payload, setPayload] = useState<ProjectionPayload | null>(null);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<ProjectionPayload>('/data/projection.json')
      .then(setPayload)
      .catch((e) => setError(String(e)));
  }, []);

  // Topology drives the per-row state silhouettes. Fetched separately (and
  // best-effort) so a slow/failed map file never blocks the leaderboards —
  // rows just render without their shape chip until it resolves.
  useEffect(() => {
    fetchJson<Topology>('/data/states-10m.json')
      .then(setTopology)
      .catch(() => setTopology(null));
  }, []);

  const silhouettes = useMemo(
    () => (topology ? buildStateSilhouettes(topology) : null),
    [topology],
  );

  const leaderboards = useMemo<Leaderboard[] | null>(() => {
    if (!payload) return null;

    // Filter out the 6 single-seat states for the multi-seat leaderboards —
    // a "ranking" of single-seat delegations isn't meaningful (the only D/R
    // option is 1-0 or 0-1, no proportionality math to do).
    const multiSeat = payload.states.filter((s) => s.seats > 1);

    // Board 1: most distorted today. Compare each state's actual D seat
    // share to its 2024 vote share — the gap that proportional allocation
    // would close. Largest absolute gap wins.
    const distortionToday = multiSeat
      .map((s) => {
        const actualDPct = s.actual.d_seats / s.seats;
        const gap = actualDPct - s.baseline_2024.d_share;
        return { state: s, gap };
      })
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
      .slice(0, TOP_N)
      .map(({ state, gap }) => {
        const pctPts = Math.round(Math.abs(gap) * 100);
        const towardParty = gap > 0 ? 'Democrats' : 'Republicans';
        return {
          state,
          caption: `${pctPts} pt gap between vote share and seat share, in favor of ${towardParty}`,
        };
      });

    // Boards 2 & 3: biggest seat shifts under proportional allocation.
    const dGains = [...payload.states]
      .map((s) => ({ state: s, delta: s.projected.d_seats - s.actual.d_seats }))
      .filter((x) => x.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, TOP_N)
      .map(({ state, delta }) => ({
        state,
        caption: `Proportional allocation would add ${delta} Democratic seat${delta === 1 ? '' : 's'}`,
      }));

    const rGains = [...payload.states]
      .map((s) => ({ state: s, delta: s.actual.d_seats - s.projected.d_seats }))
      .filter((x) => x.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, TOP_N)
      .map(({ state, delta }) => ({
        state,
        caption: `Proportional allocation would add ${delta} Republican seat${delta === 1 ? '' : 's'}`,
      }));

    // Board 4: most one-sided delegations today. State sends 100% of its
    // seats to one party despite a non-trivial vote share for the loser.
    // Sort by loser's vote share — the bigger the share that gets zero
    // representation, the more "wasted" the votes are.
    const oneSided = multiSeat
      .map((s) => {
        const allD = s.actual.d_seats === s.seats;
        const allR = s.actual.r_seats === s.seats;
        if (!allD && !allR) return null;
        const losingShare = allD ? s.baseline_2024.r_share : s.baseline_2024.d_share;
        const losingParty = allD ? 'Republican' : 'Democratic';
        return { state: s, losingShare, losingParty };
      })
      .filter((x): x is { state: StateProjection; losingShare: number; losingParty: string } => x !== null)
      .sort((a, b) => b.losingShare - a.losingShare)
      .slice(0, TOP_N)
      .map(({ state, losingShare, losingParty }) => ({
        state,
        caption: `${state.actual.d_seats === state.seats ? 'All D' : 'All R'} delegation; ${losingParty}s got ${Math.round(losingShare * 100)}% of the 2024 House vote but zero seats`,
      }));

    return [
      {
        id: 'most-distorted-today',
        title: 'Most distorted delegations today',
        blurb: 'States where the current delegation diverges furthest from the 2024 statewide House vote. The bigger the gap, the more proportional allocation would change the outcome.',
        rows: distortionToday,
      },
      {
        id: 'biggest-d-gains',
        title: 'Biggest Democratic gains under proportional representation',
        blurb: 'States where Democrats would pick up the most House seats if their delegation matched the statewide vote share.',
        rows: dGains,
      },
      {
        id: 'biggest-r-gains',
        title: 'Biggest Republican gains under proportional representation',
        blurb: 'States where Republicans would pick up the most House seats if their delegation matched the statewide vote share.',
        rows: rGains,
      },
      {
        id: 'most-one-sided',
        title: 'Most one-sided delegations',
        blurb: 'States where one party holds 100% of the House seats even though the other party has a substantial share of the statewide vote: the starkest “wasted-vote” cases.',
        rows: oneSided,
      },
    ];
  }, [payload]);

  // JSON-LD ItemList per leaderboard. Google uses these for rich result
  // rendering — paste a /rankings URL into the rich-results test tool to
  // verify. Each item points at its /state/{code} page so the schema
  // matches the visible link target.
  const jsonLd = useMemo(() => {
    if (!leaderboards) return null;
    return leaderboards.map((board) => ({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: board.title,
      itemListElement: board.rows.map(({ state }, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `https://proportionalhouse.org/state/${state.code.toLowerCase()}`,
        name: state.name,
      })),
    }));
  }, [leaderboards]);

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="bg-white border border-red-200 rounded-lg shadow-sm p-5">
          <h2 className="font-serif text-lg text-red-800">Couldn’t load the rankings</h2>
          <p className="text-sm text-stone-600 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!payload || !leaderboards) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <div
          className="inline-block h-6 w-6 rounded-full border-2 border-stone-300 border-t-brand-navy animate-spin"
          aria-hidden="true"
        />
        <p className="mt-3 text-sm text-stone-500">Loading rankings…</p>
      </div>
    );
  }

  return (
    <article className="max-w-3xl mx-auto px-6 py-8">
      <h1 className="font-serif text-3xl sm:text-4xl font-medium text-brand-navy tracking-tight">
        House rankings under proportional representation
      </h1>
      <p className="mt-3 text-stone-700 leading-relaxed">
        Which state delegations diverge most from their statewide vote? Below: the ten most distorted delegations today, the biggest projected gains for each party under proportional allocation, and the most one-sided “all-one-color” delegations. Tap any state to see its full projection.
      </p>
      <nav aria-label="Rankings sections" className="mt-5 flex flex-wrap gap-2 text-sm">
        {leaderboards.map((b) => (
          <a
            key={b.id}
            href={`#${b.id}`}
            className="px-3 py-1.5 rounded-full border border-stone-200 bg-white text-stone-700 hover:border-brand-navy/40 hover:text-brand-navy"
          >
            {b.title}
          </a>
        ))}
      </nav>

      {leaderboards.map((board) => (
        <section key={board.id} id={board.id} className="mt-10 scroll-mt-6">
          <h2 className="font-serif text-2xl text-brand-navy tracking-tight">{board.title}</h2>
          <p className="text-sm text-stone-600 mt-1.5 leading-relaxed">{board.blurb}</p>
          {board.rows.length === 0 ? (
            <p className="mt-4 text-sm text-stone-500 italic">
              No states meet this criterion in the current projection.
            </p>
          ) : (
            <ol className="mt-4 space-y-2 list-none p-0">
              {board.rows.map((row, i) => (
                <li key={row.state.fips}>
                  <RankingRow
                    rank={i + 1}
                    state={row.state}
                    caption={row.caption}
                    silhouette={silhouettes?.get(row.state.fips)}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}

      <p className="mt-10 text-sm text-stone-500">
        Curious about the math? See the{' '}
        <Link to="/methodology" className="underline hover:text-brand-navy">methodology</Link>.
      </p>

      {jsonLd?.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          // The schema object is JSON we built ourselves; safe to stringify and inject.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </article>
  );
}
