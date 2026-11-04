import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PARTY_D, PARTY_R } from '../lib/parties';
import { fmtAsOf, resultsStatusLabel } from '../lib/results';
import type { ResultsPayload } from '../lib/types';
import { CalledCount } from './CalledCount';
import { Hemicycle } from './Hemicycle';

/** Seats not yet allocated: races uncalled, or states with no votes counted. */
export const PENDING_COLOR = '#d6d3d1';
const OTHER_COLOR = '#78716c';

interface Props {
  results: ResultsPayload;
}

/**
 * The homepage hero once election results are in — the counterpart of
 * HomeHero's projection. The headline comparison (PR of the vote vs. the seats
 * voters elected) is only stated once every race is called and every state has
 * votes counted; before that the hero says what is known so far, and what
 * isn't, rather than a gap between two incomplete numbers.
 */
export function ResultsHero({ results }: Props) {
  const { meta, national } = results;
  const cycle = meta.cycle;
  const status = resultsStatusLabel(results);
  const pr = national.under_pr;
  const el = national.as_elected;
  const complete = meta.all_called && pr.pending_seats === 0;
  const dGain = pr.d_seats - el.d_seats;
  const absGain = Math.abs(dGain);
  const seats = (n: number) => (n === 1 ? 'seat' : 'seats');
  const towardColor = dGain > 0 ? 'text-blue-700' : dGain < 0 ? 'text-red-700' : 'text-stone-700';
  const reporting = results.states.filter((s) => s.under_pr !== null).length;

  // The seat chart shows either the House under PR of the votes counted or the
  // House as elected so far (uncalled races gray).
  const [chart, setChart] = useState<'pr' | 'elected'>('pr');
  const hemiParties =
    chart === 'pr'
      ? [
          { id: 'D', color: PARTY_D.color, seats: pr.d_seats },
          { id: 'R', color: PARTY_R.color, seats: pr.r_seats },
          ...(pr.pending_seats ? [{ id: 'pending', color: PENDING_COLOR, seats: pr.pending_seats }] : []),
        ]
      : [
          { id: 'D', color: PARTY_D.color, seats: el.d_seats },
          ...(el.other_seats ? [{ id: 'O', color: OTHER_COLOR, seats: el.other_seats }] : []),
          // Uncalled in the middle, as on election-night seat charts.
          ...(el.uncalled_seats ? [{ id: 'uncalled', color: PENDING_COLOR, seats: el.uncalled_seats }] : []),
          { id: 'R', color: PARTY_R.color, seats: el.r_seats },
        ];
  const hemiAria =
    chart === 'pr'
      ? `${cycle} U.S. House under proportional representation of the votes counted: ` +
        `D ${pr.d_seats}, R ${pr.r_seats}` +
        (pr.pending_seats ? `, ${pr.pending_seats} seats in states not yet reporting` : '') +
        '.'
      : `${cycle} U.S. House as elected${meta.all_called ? '' : ' so far'}: D ${el.d_seats}, R ${el.r_seats}` +
        (el.other_seats ? `, ${el.other_seats} other` : '') +
        (el.uncalled_seats ? `, ${el.uncalled_seats} races not yet called` : '') +
        '.';

  return (
    <section className="max-w-6xl mx-auto w-full px-6 pt-4 sm:pt-6">
      <p className="text-xs uppercase tracking-wider text-stone-500 font-medium">
        {cycle} election results · {status}
        {meta.as_of && !meta.all_certified ? ` · as of ${fmtAsOf(meta.as_of)}` : ''}
      </p>
      <h1 className="mt-1 font-serif text-4xl sm:text-6xl font-medium text-brand-navy tracking-tight leading-[1.03]">
        The U.S. House under proportional representation
      </h1>

      <div className="mt-4 sm:mt-6 lg:grid lg:grid-cols-2 lg:gap-10 lg:items-center">
        <div>
          {complete ? (
            <>
              <div className="flex items-end gap-3">
                <span
                  className={`font-serif font-semibold tabular-nums leading-[0.85] text-6xl sm:text-7xl ${
                    dGain === 0 ? 'text-stone-500' : towardColor
                  }`}
                >
                  {absGain}
                </span>
                <span className="pb-1.5 text-sm sm:text-base font-medium leading-snug">
                  {dGain === 0 ? (
                    <span className="text-stone-600">seats — no net shift under PR</span>
                  ) : (
                    <>
                      <span className="text-stone-700">{seats(absGain)}</span>{' '}
                      <span className={towardColor}>
                        toward {dGain > 0 ? 'Democrats' : 'Republicans'}
                      </span>
                    </>
                  )}
                </span>
              </div>
              <p className="mt-2 text-[11px] uppercase tracking-wider text-stone-500">
                {cycle} votes, under proportional representation
              </p>
              <p className="mt-4 text-base sm:text-lg text-stone-800 leading-relaxed">
                {dGain === 0 ? (
                  <>
                    In the {cycle} election, the House voters elected matched what proportional
                    representation of their votes would have produced.
                  </>
                ) : (
                  <>
                    In the {cycle} election, proportional representation of the votes would have
                    shifted the House about{' '}
                    <strong className={towardColor}>
                      {absGain} {seats(absGain)} toward {dGain > 0 ? 'Democrats' : 'Republicans'}
                    </strong>
                    : D {pr.d_seats} / R {pr.r_seats}, against the D {el.d_seats} / R {el.r_seats}
                    {el.other_seats ? ` / ${el.other_seats} other` : ''} voters elected.
                  </>
                )}
              </p>
              {!meta.all_certified && (
                <p className="mt-3 text-sm text-stone-600 leading-relaxed">
                  Every race is called, but counts are provisional until each state certifies (
                  {meta.status_counts.certified} of 50 so far); the numbers can still move.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-base sm:text-lg text-stone-800 leading-relaxed">
                Votes are being counted. Races called so far:{' '}
                <strong className="text-blue-700">Democrats {el.d_seats}</strong>,{' '}
                <strong className="text-red-700">Republicans {el.r_seats}</strong>
                {el.other_seats ? `, other ${el.other_seats}` : ''}, with{' '}
                <strong>{el.uncalled_seats} of 435</strong> not yet called
                {reporting < 50 ? (
                  <>
                    ; <strong>{reporting} of 50</strong> states have votes in
                  </>
                ) : null}
                . Allocated proportionally, the vote counted so far gives{' '}
                <strong className="text-blue-700">D {pr.d_seats}</strong> ·{' '}
                <strong className="text-red-700">R {pr.r_seats}</strong>
                {pr.pending_seats ? `, with ${pr.pending_seats} seats in states not yet reporting` : ''}.
              </p>
              <p className="mt-3 text-sm text-stone-600 leading-relaxed">
                The headline comparison, proportional representation against the House voters
                elected, waits until every race is called. Every number here is provisional:
                partial counts shift as mail and late ballots come in.
              </p>
            </>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
            <a
              href="#projection-scorecard"
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-navy text-white px-4 py-2 hover:bg-brand-navy-mid transition-colors"
            >
              How the final projection compares <span aria-hidden="true">↓</span>
            </a>
            <Link
              to="/methodology#election-day"
              className="text-stone-600 hover:text-brand-navy underline underline-offset-2"
            >
              How results are sourced
            </Link>
          </div>
        </div>

        <figure className="mt-8 lg:mt-0">
          <div role="group" aria-label="Seat chart" className="mb-3 flex justify-center">
            <div className="inline-flex rounded-full border border-stone-200 bg-white p-0.5 text-xs font-medium">
              {([
                ['pr', 'Under PR'],
                ['elected', meta.all_called ? 'As elected' : 'As elected so far'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={chart === id}
                  onClick={() => setChart(id)}
                  className={`rounded-full px-3 py-1 transition-colors ${
                    chart === id ? 'bg-brand-navy text-white' : 'text-stone-600 hover:text-brand-navy'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Hemicycle parties={hemiParties} ariaLabel={hemiAria} className="w-full max-w-md mx-auto" />
          <figcaption className="mt-2 flex items-center justify-center gap-x-3 gap-y-1 flex-wrap text-xs text-stone-500">
            {chart === 'pr' ? (
              <>
                <span>{cycle} votes{meta.all_certified ? '' : ' counted'}, under PR</span>
                <span aria-hidden="true" className="text-stone-300">·</span>
                <span className="font-semibold tabular-nums" style={{ color: PARTY_D.color }}>D {pr.d_seats}</span>
                <span className="font-semibold tabular-nums" style={{ color: PARTY_R.color }}>R {pr.r_seats}</span>
                {pr.pending_seats > 0 && (
                  <span className="tabular-nums" style={{ color: OTHER_COLOR }}>
                    {pr.pending_seats} not yet reporting
                  </span>
                )}
              </>
            ) : (
              <>
                <span>
                  {cycle} races called{meta.all_called ? '' : ' so far'}
                </span>
                <span aria-hidden="true" className="text-stone-300">·</span>
                <span className="font-semibold">
                  <CalledCount seats={el} />
                </span>
              </>
            )}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
