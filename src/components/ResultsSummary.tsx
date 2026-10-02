import { fmtMargin } from '../lib/format';
import { PARTY_D, PARTY_R } from '../lib/parties';
import { fmtAsOf } from '../lib/results';
import type { HouseCompositionPayload, ResultsPayload } from '../lib/types';
import { PENDING_COLOR } from './ResultsHero';
import { SeatBar } from './SeatBar';
import { Term } from './Term';

const OTHER_COLOR = '#78716c';

interface Props {
  results: ResultsPayload;
  /** The live chamber from the Clerk — shown as a caption, like NationalSummary does. */
  composition?: HouseCompositionPayload | null;
}

/**
 * The national scoreboard once results are in — NationalSummary's counterpart.
 * Uncalled races and unreported states are shown as their own gray segment,
 * never folded into either party.
 */
export function ResultsSummary({ results, composition }: Props) {
  const { meta, national } = results;
  const pr = national.under_pr;
  const el = national.as_elected;
  const complete = meta.all_called && pr.pending_seats === 0;
  const dGain = pr.d_seats - el.d_seats;
  const reporting = results.states.filter((s) => s.under_pr !== null).length;

  const liveNote =
    composition && composition.meta.congress && composition.meta.congress > 119
      ? `Sworn in: D ${composition.national.d_seats} · R ${composition.national.r_seats}` +
        (composition.national.vacant ? ` · ${composition.national.vacant} vacant` : '')
      : undefined;

  return (
    <section aria-label="National results summary">
      <div className="max-w-6xl mx-auto px-6 pt-3 pb-2">
        <div className="rounded-xl border border-stone-200 border-l-4 border-l-brand-navy bg-white shadow-sm overflow-hidden grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-stone-200">
          <Cell
            label={meta.all_certified ? `Under PR (${meta.cycle} vote)` : `Under PR (${meta.cycle} votes counted)`}
            value={
              <>
                <span className="text-blue-700">D {pr.d_seats}</span>
                <span className="text-stone-400"> · </span>
                <span className="text-red-700">R {pr.r_seats}</span>
              </>
            }
            bar={
              <SeatBar
                className="h-1.5"
                parties={[
                  { id: 'D', color: PARTY_D.color, seats: pr.d_seats, label: 'D' },
                  { id: 'R', color: PARTY_R.color, seats: pr.r_seats, label: 'R' },
                  { id: 'pending', color: PENDING_COLOR, seats: pr.pending_seats, label: 'Not yet reporting' },
                ]}
              />
            }
            note={pr.pending_seats ? `${pr.pending_seats} seats in states not yet reporting` : undefined}
          />
          <Cell
            label={`As elected (${meta.cycle})`}
            value={
              <>
                <span className="text-blue-700">D {el.d_seats}</span>
                <span className="text-stone-400"> · </span>
                <span className="text-red-700">R {el.r_seats}</span>
                {el.other_seats > 0 && (
                  <span className="text-stone-600 text-base"> · {el.other_seats} other</span>
                )}
              </>
            }
            bar={
              <SeatBar
                className="h-1.5"
                parties={[
                  { id: 'D', color: PARTY_D.color, seats: el.d_seats, label: 'D' },
                  { id: 'R', color: PARTY_R.color, seats: el.r_seats, label: 'R' },
                  { id: 'O', color: OTHER_COLOR, seats: el.other_seats, label: 'Other' },
                  { id: 'uncalled', color: PENDING_COLOR, seats: el.uncalled_seats, label: 'Not yet called' },
                ]}
              />
            }
            note={
              [el.uncalled_seats ? `${el.uncalled_seats} races not yet called` : '', liveNote ?? '']
                .filter(Boolean)
                .join(' · ') || undefined
            }
          />
          <Cell
            label="Difference under PR"
            value={
              complete ? (
                dGain === 0 ? (
                  <span className="text-stone-500">±0</span>
                ) : (
                  <span className={dGain > 0 ? 'text-blue-700' : 'text-red-700'}>
                    {dGain > 0 ? '+' : ''}{dGain} D / {dGain > 0 ? '−' : '+'}{Math.abs(dGain)} R
                  </span>
                )
              ) : (
                <span className="text-stone-500 text-base">Waiting on the count</span>
              )
            }
            note={
              complete
                ? undefined
                : `${meta.seats_called}/435 races called · ${reporting}/50 states reporting`
            }
          />
        </div>

        <div className="mt-2.5 text-xs text-stone-500">
          Counted two-party House vote:{' '}
          <span className="font-medium text-stone-700">
            {national.two_party_d_margin_points == null ? '—' : fmtMargin(national.two_party_d_margin_points)}
          </span>
          {' · '}
          {meta.status_counts.certified} certified · {meta.status_counts.provisional} provisional ·{' '}
          {meta.status_counts.pending} not yet reporting
          {meta.as_of && <> · latest update {fmtAsOf(meta.as_of)}</>}
          {' · '}Method:{' '}
          <span className="font-medium text-stone-700"><Term id="sainte-lague">Sainte-Laguë</Term></span>
        </div>
      </div>
    </section>
  );
}

function Cell({
  label,
  value,
  bar,
  note,
}: {
  label: string;
  value: React.ReactNode;
  bar?: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="px-4 py-2.5">
      <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium">{label}</div>
      <div className="text-xl font-semibold mt-0.5 tabular-nums">{value}</div>
      {bar && <div className="mt-1.5">{bar}</div>}
      {note && <div className="text-[11px] text-stone-500 mt-0.5 leading-snug">{note}</div>}
    </div>
  );
}
