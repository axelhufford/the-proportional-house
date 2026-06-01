import { Link } from 'react-router-dom';
import type { ProjectionPayload, ViewMode } from '../lib/types';
import type { SandboxPayload } from '../lib/sandboxTypes';

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
}

export function HomeHero({
  payload,
  viewMode,
  structuralDGain,
  onSelectView,
  sandboxPayload,
  methodLabel,
  retroYear = 2024,
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
  const towardColor = dGain > 0 ? 'text-blue-700' : 'text-red-700';
  const seats = (n: number) => (n === 1 ? 'seat' : 'seats');
  const towardWord = (v: number) => (v > 0 ? 'toward Democrats' : 'toward Republicans');

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
    const genericLabel = generic >= 0 ? `D+${generic.toFixed(1)}` : `R+${Math.abs(generic).toFixed(1)}`;
    const reform = methodLabel ?? 'proportional representation';
    // With extra parties active, "toward Democrats/Republicans" is misleading
    // (both majors can lose seats to a minor), so describe the multi-party
    // result instead of a single two-party shift.
    const minorsActive = !!sandboxNational && (sandboxPayload?.minors.length ?? 0) > 0;
    const topMinor = sandboxNational
      ? sandboxNational.parties.slice(2).filter((p) => p.seats > 0).sort((a, b) => b.seats - a.seats)[0]
      : undefined;
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
    // hand the favored party vs. what they hold now — then (honestly) note how
    // much of that gap is the post-2024 polling swing vs. the district map. The
    // precise structural/swing split is in the "Difference under PR" card below
    // and on the Methodology page.
    const generic = meta.generic_ballot_margin;
    const genericLabel =
      generic >= 0 ? `D+${generic.toFixed(1)}` : `R+${Math.abs(generic).toFixed(1)}`;
    if (dGain === 0) {
      lede = (
        <>
          Under today’s polling (<strong>{genericLabel}</strong>), a proportional U.S. House would
          give both parties about the same number of seats they hold now.
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
          than they hold now.
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
            <strong className={swing > 0 ? 'text-blue-700' : 'text-red-700'}>
              {signed(swing)} {seats(Math.abs(swing))}
            </strong>{' '}
            from the polling swing {towardWord(swing)} since 2024 and{' '}
            <strong className={structuralDGain > 0 ? 'text-blue-700' : 'text-red-700'}>
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
      <h1 className="font-serif text-3xl sm:text-5xl font-medium text-brand-navy tracking-tight leading-[1.05]">
        The U.S. House under proportional representation
      </h1>

      {/* Two columns on lg+: the finding (left) and a plain "what is PR?" aside
        * (right) that fills what was empty space. Stacks on small screens. */}
      <div className="mt-3 sm:mt-4 lg:grid lg:grid-cols-[1.6fr_1fr] lg:gap-10 lg:items-start">
        <div>
          <p className="text-base sm:text-lg text-stone-800 leading-relaxed">{lede}</p>
          {caveat && (
            <p className="mt-3 text-sm sm:text-base text-stone-600 leading-relaxed">{caveat}</p>
          )}
        </div>

        <aside className="mt-6 lg:mt-1 rounded-lg border border-stone-200 bg-white shadow-sm p-4">
          <div className="text-sm font-semibold text-stone-900">
            What is proportional representation?
          </div>
          <p className="mt-1.5 text-sm text-stone-600 leading-relaxed">
            It ties each party’s House seats to its share of the statewide vote, instead of the
            winner-take-all districts we use now. This map projects what that would change.
          </p>
        </aside>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
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
    </section>
  );
}
