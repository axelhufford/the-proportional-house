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
}

export function HomeHero({ payload, viewMode }: Props) {
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
    // Current: live projection.
    if (dGain === 0) {
      lede = (
        <>
          Right now, the current House delegation matches what proportional allocation of the
          projected statewide vote would deliver. The map shows state-by-state shifts.
        </>
      );
    } else if (dGain > 0) {
      lede = (
        <>
          Right now, Republicans hold{' '}
          <strong className="text-red-700">{absGain} more House seats</strong>{' '}
          than they would under proportional allocation of the projected statewide vote — a
          structural advantage built into single-member districts.
        </>
      );
    } else {
      lede = (
        <>
          Right now, Democrats hold{' '}
          <strong className="text-blue-700">{absGain} more House seats</strong>{' '}
          than they would under proportional allocation of the projected statewide vote — a
          structural advantage built into single-member districts.
        </>
      );
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
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <Link
          to="/rankings"
          className="inline-flex items-center gap-1.5 rounded-full bg-brand-navy text-white px-4 py-2 hover:bg-brand-navy-mid transition-colors"
        >
          See the most distorted state delegations
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
