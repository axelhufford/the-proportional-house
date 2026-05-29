import { Link } from 'react-router-dom';
import type { ProjectionPayload, ViewMode } from '../lib/types';

/**
 * Homepage hero. Owns the page's <h1> (a single, topical phrase that
 * Google can index) and surfaces the headline finding as a punchy lede.
 *
 * The lede is computed from the live national totals so it stays accurate
 * as the user toggles between view modes and drags the sandbox slider —
 * no stale copy that contradicts the visualization below it.
 *
 * Sits above NationalSummary in Home.tsx; the structured stat grid below
 * still does the heavy informational lifting for users who want numbers.
 */
interface Props {
  payload: ProjectionPayload;
  viewMode: ViewMode;
  /**
   * Structural component of the Current-view gap (D seats): PR of the *actual
   * 2024* vote minus today's 2024-elected House — the pure SMD-vs-PR
   * distortion. The Current gap decomposes as structural + swing-since-2024,
   * so the lede can attribute each piece honestly. Optional (absent until the
   * payload loads); the lede falls back to a non-decomposed sentence.
   */
  structuralDGain?: number;
}

export function HomeHero({ payload, viewMode, structuralDGain }: Props) {
  const { national, meta } = payload;
  // Positive means PR gives more seats to Democrats than today; negative
  // means the current system already favors Democrats (so PR would shift
  // seats to Republicans). We frame the lede around whichever party is
  // currently *over-represented* — that's the structural distortion.
  const dGain = national.projected.d_seats - national.actual.d_seats;
  const absGain = Math.abs(dGain);

  let lede: React.ReactNode;
  if (viewMode === 'retrospective') {
    // Retrospective: pure PR allocation of 2024's actual votes, no polling.
    if (dGain === 0) {
      lede = (
        <>
          In 2024, the U.S. House delivered the same seat split as proportional
          allocation of the statewide vote would have. The map below shows where
          allocations did diverge state by state.
        </>
      );
    } else if (dGain > 0) {
      lede = (
        <>
          In 2024, the U.S. House delivered{' '}
          <strong className="text-red-700">{absGain} more Republican seats</strong>{' '}
          than proportional allocation of the actual statewide vote would have.
        </>
      );
    } else {
      lede = (
        <>
          In 2024, the U.S. House delivered{' '}
          <strong className="text-blue-700">{absGain} more Democratic seats</strong>{' '}
          than proportional allocation of the actual statewide vote would have.
        </>
      );
    }
  } else if (viewMode === 'sandbox') {
    // Sandbox: hypothetical generic-ballot environment.
    const generic = meta.generic_ballot_margin;
    const genericLabel = generic >= 0 ? `D+${generic.toFixed(1)}` : `R+${Math.abs(generic).toFixed(1)}`;
    if (dGain === 0) {
      lede = (
        <>
          Under a hypothetical <strong>{genericLabel}</strong> generic ballot, single-member
          districts deliver the same seat split as proportional allocation. Drag the slider
          to see where they diverge.
        </>
      );
    } else if (dGain > 0) {
      lede = (
        <>
          Under a hypothetical <strong>{genericLabel}</strong> generic ballot, Republicans would
          hold <strong className="text-red-700">{absGain} more seats</strong> than proportional
          allocation of the statewide vote would give them.
        </>
      );
    } else {
      lede = (
        <>
          Under a hypothetical <strong>{genericLabel}</strong> generic ballot, Democrats would
          hold <strong className="text-blue-700">{absGain} more seats</strong> than proportional
          allocation of the statewide vote would give them.
        </>
      );
    }
  } else {
    // Current: live projection. The headline gap (today's 2024-elected House vs.
    // PR of the *projected* vote) blends two effects, so we name both instead of
    // calling it all "structural" — which it mostly isn't:
    //   structural = PR of the 2024 vote − today's House (the SMD-vs-PR distortion)
    //   swing      = the rest, from the generic-ballot move since 2024
    if (dGain === 0) {
      lede = (
        <>
          Right now, the current House delegation matches what proportional allocation of the
          projected statewide vote would deliver. The map shows state-by-state shifts.
        </>
      );
    } else {
      const overParty = dGain > 0 ? 'Republicans' : 'Democrats';
      const overColor = dGain > 0 ? 'text-red-700' : 'text-blue-700';
      const main = (
        <>
          Right now, the House — elected in 2024 — seats{' '}
          <strong className={overColor}>{overParty} {absGain} more</strong>{' '}
          than proportional allocation of the projected statewide vote would.
        </>
      );
      if (structuralDGain == null) {
        lede = main;
      } else {
        const swing = dGain - structuralDGain;
        const absStruct = Math.abs(structuralDGain);
        const absSwing = Math.abs(swing);
        const seats = (n: number) => (n === 1 ? 'seat' : 'seats');
        const towardWord = (v: number) =>
          v > 0 ? 'toward Democrats' : v < 0 ? 'toward Republicans' : '';
        const partyWord = (v: number) =>
          v > 0 ? 'Democratic' : v < 0 ? 'Republican' : '';
        const structPhrase =
          absStruct === 0
            ? 'have left the seat split essentially unchanged'
            : `have shifted only about ${absStruct} ${seats(absStruct)} ${towardWord(structuralDGain)}`;
        lede = (
          <>
            {main}{' '}
            That gap is mostly the{' '}
            {absSwing >= absStruct
              ? 'swing in the national mood since 2024, not the map itself'
              : 'current map’s structural lean, not the swing since 2024'}
            : proportional allocation of the <em>2024</em> vote alone — same election, no
            swing — would {structPhrase} (the{' '}
            <Link
              to="/?view=retrospective"
              className="underline underline-offset-2 hover:text-brand-navy"
            >
              2024 Retrospective
            </Link>
            )
            {absSwing === 0 ? (
              <>.</>
            ) : (
              <>
                , with the remaining ~{absSwing} {seats(absSwing)} coming from the{' '}
                {partyWord(swing)} swing in the generic ballot since 2024.
              </>
            )}
          </>
        );
      }
    }
  }

  return (
    <section className="max-w-6xl mx-auto w-full px-6 pt-7 sm:pt-9">
      <h1 className="font-serif text-3xl sm:text-5xl font-medium text-brand-navy tracking-tight leading-[1.05]">
        The U.S. House under proportional representation
      </h1>
      <p className="mt-4 sm:mt-5 text-base sm:text-lg text-stone-800 leading-relaxed max-w-2xl">
        {lede}
      </p>
      {/* Static plain-language framing — defines PR and what the map shows, so a
       * first-time visitor isn't left to infer it from the dynamic finding above.
       * Same across all view modes by design. */}
      <p className="mt-3 text-sm sm:text-base text-stone-600 leading-relaxed max-w-2xl">
        Proportional representation ties each state’s House seats to its share of the statewide
        vote. This map projects how that would reshape the chamber — and where today’s
        winner-take-all districts bend the result.
      </p>
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
