import { Link } from 'react-router-dom';
import { easternDate } from '../lib/election';
import { fmtMargin } from '../lib/format';
import type { ResultsPayload } from '../lib/types';

interface Props {
  results: ResultsPayload;
}

/**
 * "How the final projection compares" — the frozen pre-election projection set
 * against the votes counted. Everything on the results side is provisional
 * until certification, and says so; nothing here is a verdict until then.
 */
export function ProjectionScorecard({ results }: Props) {
  const vs = results.vs_final_projection;
  if (!vs) return null;
  const { meta } = results;
  const counted = vs.counted_two_party_d_margin_points;
  const miss = counted == null ? null : vs.final_generic_ballot_margin - counted;
  const reporting = results.states.filter((s) => s.under_pr && s.two_party_share && s.final_projection);
  const frozenOn = easternDate(vs.final_generated_at);

  return (
    <section
      id="projection-scorecard"
      className="mt-4 scroll-mt-24 bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-6"
    >
      <h2 className="font-serif text-xl sm:text-2xl text-brand-navy">How the final projection compares</h2>
      <p className="text-xs text-stone-500">
        The projection frozen {frozenOn} vs. the {meta.cycle} votes counted
        {vs.provisional ? ' so far (provisional)' : ' (certified)'}
      </p>

      <dl className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wider text-stone-500">National margin</dt>
          <dd className="mt-0.5 tabular-nums">
            Final polls <strong>{fmtMargin(vs.final_generic_ballot_margin)}</strong>
            {' · '}counted <strong>{counted == null ? '—' : fmtMargin(counted)}</strong>
          </dd>
          {miss != null && (
            <dd className="text-xs text-stone-500 mt-0.5">
              Polls {miss > 0 ? 'overstated Democrats' : miss < 0 ? 'overstated Republicans' : 'matched'}
              {miss !== 0 && ` by ${Math.abs(miss).toFixed(1)} pts`} so far
            </dd>
          )}
        </div>
        <div className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wider text-stone-500">Final projection, under PR</dt>
          <dd className="mt-0.5 tabular-nums">
            <span className="text-blue-700 font-semibold">D {vs.final_projected_pr.d_seats}</span>
            {' · '}
            <span className="text-red-700 font-semibold">R {vs.final_projected_pr.r_seats}</span>
          </dd>
        </div>
        <div className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wider text-stone-500">Votes counted, under PR</dt>
          <dd className="mt-0.5 tabular-nums">
            <span className="text-blue-700 font-semibold">D {vs.pr_on_counted_votes.d_seats}</span>
            {' · '}
            <span className="text-red-700 font-semibold">R {vs.pr_on_counted_votes.r_seats}</span>
            {vs.pr_on_counted_votes.pending_seats > 0 && (
              <span className="text-stone-500"> · {vs.pr_on_counted_votes.pending_seats} pending</span>
            )}
          </dd>
        </div>
      </dl>

      {reporting.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium text-brand-navy rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-navy">
            State by state ({reporting.length} reporting)
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left text-stone-500 border-b border-stone-200">
                  <th scope="col" className="py-1 pr-3 font-medium">State</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Projected D share</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Counted D share</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Projected PR</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Counted PR</th>
                  <th scope="col" className="py-1 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {reporting.map((s) => {
                  const fp = s.final_projection!;
                  return (
                    <tr key={s.code} className="border-b border-stone-100">
                      <th scope="row" className="py-1 pr-3 font-medium text-stone-800 text-left">{s.name}</th>
                      <td className="py-1 pr-3">{(fp.d_share * 100).toFixed(1)}%</td>
                      <td className="py-1 pr-3">{(s.two_party_share!.d_share * 100).toFixed(1)}%</td>
                      <td className="py-1 pr-3">D {fp.d_seats} · R {fp.r_seats}</td>
                      <td className="py-1 pr-3">D {s.under_pr!.d_seats} · R {s.under_pr!.r_seats}</td>
                      <td className="py-1 text-stone-500">
                        {s.status}
                        {s.reporting_pct != null && s.status !== 'certified' ? ` · ${s.reporting_pct}% in` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <p className="mt-3 text-xs text-stone-500">
        The final projection is republished exactly as it stood before any votes were counted.
        To explore it on the map, open the{' '}
        <Link to="/sandbox" className="underline hover:text-brand-navy">Sandbox</Link>, which starts
        at the final polling average. “Counted” shares are two-party House votes; a state with an
        uncontested race counts only the votes cast, as in the past-cycle retrospectives.
      </p>
    </section>
  );
}
