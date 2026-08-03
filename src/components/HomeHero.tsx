import { Link } from 'react-router-dom';
import type { ProjectionPayload, ViewMode } from '../lib/types';
import type { SandboxPayload } from '../lib/sandboxTypes';
import { fmtMargin } from '../lib/format';
import { majorityTippingSentence } from '../lib/majorityTipping';
import { topMinorWithSeats } from '../lib/colors';
import { PARTY_D, PARTY_R } from '../lib/parties';
import { describeSeatShiftBand, seatShiftBand } from '../lib/uncertaintyBand';
import { useCountUp } from '../lib/useCountUp';
import type { WeeklyDelta } from '../lib/weeklyDelta';
import { Hemicycle } from './Hemicycle';
import { Term } from './Term';

/**
 * Homepage hero. Owns the page's <h1> and surfaces the headline finding as a
 * short, plain-language lede a first-time visitor can grasp in seconds.
 *
 * The lede is computed from the live national totals so it stays accurate as
 * the user toggles view modes and drags the sandbox slider. The exact D/R
 * splits live in the NationalSummary cards just below, so the hook only states
 * the magnitude + direction (no number duplication).
 */
interface Props {
  payload: ProjectionPayload;
  viewMode: ViewMode;
  /**
   * Structural component of the Current-view gap (D seats): PR of the *actual
   * 2024* vote minus today's 2024-elected House — the pure SMD-vs-PR
   * distortion. The Current gap = structural + swing-since-2024, so the caveat
   * can honestly say which piece dominates. Optional (absent until the payload
   * loads); without it the caveat is simply omitted.
   */
  structuralDGain?: number;
  /**
   * Switch the active view (e.g. from the "2024 Retrospective" link in the
   * caveat). Goes through the same state setter the mode toggle uses — a plain
   * `<Link>` to `?view=…` wouldn't work, since Home only reads `view` from the
   * URL on initial mount.
   */
  onSelectView?: (view: ViewMode) => void;
  /**
   * Sandbox N-party national totals. When in Sandbox, the hero must use these
   * (not the two-party `payload`) so its shift matches the selected method /
   * minors / House size shown in the cards below.
   */
  sandboxPayload?: SandboxPayload | null;
  /** Active method label (e.g. "Pure PR", "MMD-5") — named in the Sandbox lede. */
  methodLabel?: string;
  /** Selected cycle for the Retrospective view (e.g. 2016…2024). */
  retroYear?: number;
  /**
   * "Since last week" movement of the Current projection; null/absent when
   * history is missing, too short, or has no forward baseline. Rendered as a
   * small chip under the headline, Current view only.
   */
  weeklyDelta?: WeeklyDelta | null;
}

export function HomeHero({
  payload,
  viewMode,
  structuralDGain,
  onSelectView,
  sandboxPayload,
  methodLabel,
  retroYear = 2024,
  weeklyDelta,
}: Props) {
  const { national, meta } = payload;
  // The headline shift = projected D minus the baseline D. In Sandbox we read
  // the N-party sandbox totals (the selected method/minors/House, scaled
  // baseline) so the hero matches the "Difference under …" card exactly;
  // otherwise the two-party `payload` (today's House) is the baseline.
  const sandboxNational = viewMode === 'sandbox' ? sandboxPayload?.national ?? null : null;
  const dGain = sandboxNational
    ? (sandboxNational.parties[0]?.seats ?? 0) - sandboxNational.actual_scaled.d_seats
    : national.projected.d_seats - national.actual.d_seats;
  const absGain = Math.abs(dGain);

  // All three views frame PR's effect as a shift *toward* a party, so the
  // highlighted phrase is colored by that party: blue when PR helps Democrats
  // (dGain > 0), red when it helps Republicans (dGain < 0).
  const towardColor = dGain > 0 ? 'text-blue-700' : dGain < 0 ? 'text-red-700' : 'text-stone-700';
  const seats = (n: number) => (n === 1 ? 'seat' : 'seats');
  // Zero is neither direction. Without this branch a dead-even swing read
  // "+0 seats toward Republicans" in red — the rest of the app (RankingRow,
  // StateRetroHistory, RetrospectiveTrend) already handles the zero case.
  const towardWord = (v: number) =>
    v > 0 ? 'toward Democrats' : v < 0 ? 'toward Republicans' : 'in either direction';
  const swingColor = (v: number) =>
    v > 0 ? 'text-blue-700' : v < 0 ? 'text-red-700' : 'text-stone-700';
  const towardParty = dGain > 0 ? 'Democrats' : 'Republicans';
  const animatedGain = useCountUp(absGain);

  // Hemicycle composition for the active view: Sandbox uses the N-party totals;
  // otherwise the two-party projected-under-PR split. Drives the hero diagram.
  const hemiParties = sandboxNational
    ? sandboxNational.parties
        .filter((p) => p.seats > 0)
        .map((p) => ({ id: p.party.id, color: p.party.color, seats: p.seats }))
    : [
        { id: 'D', color: PARTY_D.color, seats: national.projected.d_seats },
        { id: 'R', color: PARTY_R.color, seats: national.projected.r_seats },
      ];
  const hemiAria =
    'Projected U.S. House composition under proportional representation: ' +
    hemiParties.map((p) => `${p.id} ${p.seats}`).join(', ') +
    '.';
  const hemiCaption =
    viewMode === 'retrospective'
      ? `Projected ${retroYear} House under PR`
      : viewMode === 'sandbox'
        ? 'Projected House — your scenario'
        : 'Projected U.S. House under PR';
  const subLabel =
    viewMode === 'retrospective'
      ? `${retroYear} election, under PR`
      : viewMode === 'sandbox'
        ? 'In your sandbox scenario'
        : 'Under proportional representation';

  let lede: React.ReactNode;
  let caveat: React.ReactNode = null;

  if (viewMode === 'retrospective') {
    // The clean comparison: PR of the *actual* 2024 vote vs. the 2024 House.
    lede =
      dGain === 0 ? (
        <>
          In the {retroYear} election, the House matched what proportional representation of the vote
          would have produced. The map shows where individual states diverged.
        </>
      ) : (
        <>
          In the {retroYear} election, proportional representation would have shifted the House about{' '}
          <strong className={towardColor}>
            {absGain} {seats(absGain)} {towardWord(dGain)}
          </strong>
          : the pure effect of winner-take-all districts, with no polling or projection.
        </>
      );
  } else if (viewMode === 'sandbox') {
    const generic = meta.generic_ballot_margin;
    const genericLabel = fmtMargin(generic);
    const reform = methodLabel ?? 'proportional representation';
    // With extra parties active, "toward Democrats/Republicans" is misleading
    // (both majors can lose seats to a minor), so describe the multi-party
    // result instead of a single two-party shift.
    const minorsActive = !!sandboxNational && (sandboxPayload?.minors.length ?? 0) > 0;
    // topMinorWithSeats filters by party id rather than assuming D and R are
    // exactly indices 0 and 1, which the previous .slice(2) did.
    const topMinor = sandboxNational ? topMinorWithSeats(sandboxNational.parties) : undefined;
    if (minorsActive) {
      lede = topMinor ? (
        <>
          In a hypothetical <strong>{genericLabel}</strong> national vote, {reform} splits the House
          across {sandboxNational!.parties.length} parties —{' '}
          <strong style={{ color: topMinor.party.color }}>
            {topMinor.party.label} would win about {topMinor.seats} {seats(topMinor.seats)}
          </strong>
          . Adjust the controls to build your own scenario.
        </>
      ) : (
        <>
          In a hypothetical <strong>{genericLabel}</strong> national vote with extra parties added,
          none clears your threshold to win seats. Adjust the controls to build your own scenario.
        </>
      );
    } else {
      lede =
        dGain === 0 ? (
          <>
            In a hypothetical <strong>{genericLabel}</strong> national vote, {reform} produces the
            same split the House has today. Adjust the controls to explore.
          </>
        ) : (
          <>
            In a hypothetical <strong>{genericLabel}</strong> national vote, {reform} would shift the
            House about{' '}
            <strong className={towardColor}>
              {absGain} {seats(absGain)} {towardWord(dGain)}
            </strong>{' '}
            from today’s. Adjust the controls to build your own scenario.
          </>
        );
    }
  } else {
    // Current: today's House vs. PR of the projected statewide vote. Lead with
    // the plain finding — under current polling, how many more seats PR would
    // hand the favored party vs. what they won in 2024 — then (honestly) note how
    // much of that gap is the post-2024 polling swing vs. the district map. The
    // precise structural/swing split is in the "Difference under PR" card below
    // and on the Methodology page.
    const generic = meta.generic_ballot_margin;
    const genericLabel = fmtMargin(generic);
    if (dGain === 0) {
      lede = (
        <>
          Under today’s polling (<strong>{genericLabel}</strong>), a proportional U.S. House would
          give both parties about the same number of seats they won in 2024.
        </>
      );
    } else {
      const gainParty = dGain > 0 ? 'Democrats' : 'Republicans';
      lede = (
        <>
          Under today’s polling (<strong>{genericLabel}</strong>), a proportional U.S. House would
          give{' '}
          <strong className={towardColor}>
            {gainParty} about {absGain} more {seats(absGain)}
          </strong>{' '}
          than they won in 2024.
        </>
      );
      if (structuralDGain != null) {
        const swing = dGain - structuralDGain;
        // Signed in the same D-positive convention as the "Difference under PR"
        // card (+ toward Democrats, − toward Republicans). Splitting the gap
        // shows that it's mostly the post-2024 polling swing, while PR applied
        // to the 2024 vote itself barely moves it.
        const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n)}`;
        caveat = (
          <>
            That splits into roughly{' '}
            <strong className={swingColor(swing)}>
              {signed(swing)} {seats(Math.abs(swing))}
            </strong>{' '}
            from the polling swing {towardWord(swing)} since 2024 and{' '}
            <strong className={swingColor(structuralDGain)}>
              {signed(structuralDGain)}
            </strong>{' '}
            from{' '}
            <button
              type="button"
              onClick={() => onSelectView?.('retrospective')}
              className="underline underline-offset-2 hover:text-brand-navy"
            >
              proportional representation itself
            </button>
            .
          </>
        );
      }
    }
  }

  return (
    <section className="max-w-6xl mx-auto w-full px-6 pt-4 sm:pt-6">
      <h1 className="font-serif text-4xl sm:text-6xl font-medium text-brand-navy tracking-tight leading-[1.03]">
        The U.S. House under proportional representation
      </h1>

      {/* Two columns on lg+: the finding + CTAs (left), the hemicycle (right).
        * Stacks on small screens (number → diagram → lede → CTAs). */}
      <div className="mt-4 sm:mt-6 lg:grid lg:grid-cols-2 lg:gap-10 lg:items-center">
        <div>
          {/* Headline shift as a big display number, colored by the party PR favors. */}
          <div className="flex items-end gap-3">
            <span
              className={`font-serif font-semibold tabular-nums leading-[0.85] text-6xl sm:text-7xl ${
                dGain === 0 ? 'text-stone-500' : towardColor
              }`}
            >
              {animatedGain}
            </span>
            <span className="pb-1.5 text-sm sm:text-base font-medium leading-snug">
              {dGain === 0 ? (
                <span className="text-stone-600">seats — no net shift under PR</span>
              ) : (
                <>
                  <span className="text-stone-700">{seats(absGain)}</span>{' '}
                  <span className={towardColor}>toward {towardParty}</span>
                </>
              )}
            </span>
          </div>
          <p className="mt-2 text-[11px] uppercase tracking-wider text-stone-500">{subLabel}</p>

          {viewMode === 'current' && weeklyDelta && <WeeklyDeltaChip delta={weeklyDelta} />}

          <p className="mt-4 text-base sm:text-lg text-stone-800 leading-relaxed">{lede}</p>
          {caveat && (
            <p className="mt-3 text-sm sm:text-base text-stone-600 leading-relaxed">{caveat}</p>
          )}
          {/* Polling-error sensitivity band + majority stakes — Current view
            * only: both are the pipeline's projection at ITS swing, so they
            * are meaningless against a sandbox slider or a past cycle (and
            * recomputeWithSwing strips them from those payloads anyway). */}
          {viewMode === 'current' && (meta.uncertainty || meta.majority) && (
            <p className="mt-3 text-sm text-stone-600 leading-relaxed">
              {meta.uncertainty && (
                <>
                  If the polls miss by the{' '}
                  <Term id="polling-error">
                    historical ±{meta.uncertainty.epsilon_points.toFixed(1)} points
                  </Term>
                  , {describeSeatShiftBand(seatShiftBand(meta.uncertainty, national.actual.d_seats))}.
                </>
              )}
              {meta.majority && (
                <>
                  {meta.uncertainty ? ' ' : ''}
                  {majorityTippingSentence(meta.majority.tipping_margin)}
                </>
              )}
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
            <Link
              to="/rankings"
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-navy text-white px-4 py-2 hover:bg-brand-navy-mid transition-colors"
            >
              {/* Shorter label on mobile so the button doesn't overflow on
               * iPhone-SE-class widths; full descriptive label on sm+. */}
              <span className="sm:hidden">See state rankings</span>
              <span className="hidden sm:inline">See the most distorted state delegations</span>
              <span aria-hidden="true">→</span>
            </Link>
            <Link
              to="/methodology"
              className="text-stone-600 hover:text-brand-navy underline underline-offset-2"
            >
              How this is calculated
            </Link>
          </div>
        </div>

        {/* Signature visual: the projected chamber rendered as its 435 seats. */}
        <figure className="mt-8 lg:mt-0">
          <Hemicycle parties={hemiParties} ariaLabel={hemiAria} className="w-full max-w-md mx-auto" />
          <figcaption className="mt-2 flex items-center justify-center gap-x-3 gap-y-1 flex-wrap text-xs text-stone-500">
            <span>{hemiCaption}</span>
            <span aria-hidden="true" className="text-stone-300">·</span>
            <span className="inline-flex flex-wrap items-baseline gap-x-2">
              {hemiParties.map((p, i) => (
                <span key={p.id} className="inline-flex items-baseline gap-1">
                  {i > 0 && <span aria-hidden="true" className="text-stone-300">·</span>}
                  <span className="font-semibold tabular-nums" style={{ color: p.color }}>
                    {p.id} {p.seats}
                  </span>
                </span>
              ))}
            </span>
          </figcaption>
        </figure>
      </div>

      {/* Newcomer hook, kept but compact, spanning under the hero. */}
      <aside className="mt-5 rounded-xl border border-stone-200 bg-white/70 px-4 py-3 text-sm text-stone-600 leading-relaxed">
        <span className="font-semibold text-stone-900">What is proportional representation?</span>{' '}
        It ties each party’s House seats to its share of the statewide vote, instead of the
        winner-take-all districts we use now — this map projects what that would change.
      </aside>
    </section>
  );
}

/** Chip date: "Jun 12" / with year on the endpoint ("Jun 19, 2026"). */
function fmtChipDate(iso: string, withYear = false): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  });
}

/**
 * Small pill under the headline: how the Current projection moved over the
 * past week. The ▲ always means "gained seats" — it points up for whichever
 * party benefited; the party is conveyed by the D+/R+ label and the text
 * color (blue vs red), not by the arrow direction. The window can
 * legitimately be 5–10 days when a nightly run was skipped, so the title
 * tooltip carries the exact from → to dates backing the "week" claim.
 */
function WeeklyDeltaChip({ delta }: { delta: WeeklyDelta }) {
  const n = Math.abs(delta.seatDelta);
  const fromLabel = fmtMargin(delta.marginFrom);
  const toLabel = fmtMargin(delta.marginTo);
  // Collapse "(D+6.9 → D+6.9)" noise when both ends format identically.
  const marginPart = fromLabel === toLabel ? `(${toLabel})` : `(${fromLabel} → ${toLabel})`;
  const seats = `seat${n === 1 ? '' : 's'}`;

  let visible: string;
  let srText: string;
  let color: string;
  if (delta.seatDelta > 0) {
    visible = `▲ D+${n} ${seats} since last week ${marginPart}`;
    srText = `Democrats gained ${n} ${seats} in the proportional projection since last week; the generic-ballot margin moved from ${fromLabel} to ${toLabel}.`;
    color = 'text-blue-700';
  } else if (delta.seatDelta < 0) {
    visible = `▲ R+${n} ${seats} since last week ${marginPart}`;
    srText = `Republicans gained ${n} ${seats} in the proportional projection since last week; the generic-ballot margin moved from ${fromLabel} to ${toLabel}.`;
    color = 'text-red-700';
  } else {
    visible = `No seat change since last week ${marginPart}`;
    srText = `No change in projected seats since last week; the generic-ballot margin is ${toLabel}.`;
    color = 'text-stone-600';
  }

  return (
    <p
      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium tabular-nums"
      title={`${fmtChipDate(delta.fromDate)} → ${fmtChipDate(delta.toDate, true)}`}
    >
      <span aria-hidden="true" className={color}>{visible}</span>
      <span className="sr-only">{srText}</span>
    </p>
  );
}
