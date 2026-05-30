import { Link } from 'react-router-dom';
import type { ProjectionPayload, ViewMode } from '../lib/types';

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
}

export function HomeHero({ payload, viewMode, structuralDGain, onSelectView }: Props) {
  const { national, meta } = payload;
  // Positive = PR gives Democrats more seats than today's House (today over-
  // represents R); negative = the reverse.
  const dGain = national.projected.d_seats - national.actual.d_seats;
  const absGain = Math.abs(dGain);

  const color = dGain > 0 ? 'text-red-700' : 'text-blue-700';
  const seats = (n: number) => (n === 1 ? 'seat' : 'seats');
  const towardWord = (v: number) => (v > 0 ? 'toward Democrats' : 'toward Republicans');
  const moreParty = (v: number) => (v > 0 ? 'Republican' : 'Democratic');

  let lede: React.ReactNode;
  let caveat: React.ReactNode = null;

  if (viewMode === 'retrospective') {
    // The clean comparison: PR of the *actual* 2024 vote vs. the 2024 House.
    lede =
      dGain === 0 ? (
        <>
          In the 2024 election, the House matched what proportional representation of the vote
          would have produced. The map shows where individual states diverged.
        </>
      ) : (
        <>
          In the 2024 election, winner-take-all districts left the House about{' '}
          <strong className={color}>
            {absGain} {seats(absGain)} more {moreParty(dGain)}
          </strong>{' '}
          than proportional representation of the actual statewide vote would have — no polling or
          projection, just the map.
        </>
      );
  } else if (viewMode === 'sandbox') {
    const generic = meta.generic_ballot_margin;
    const genericLabel = generic >= 0 ? `D+${generic.toFixed(1)}` : `R+${Math.abs(generic).toFixed(1)}`;
    lede =
      dGain === 0 ? (
        <>
          In a hypothetical <strong>{genericLabel}</strong> national vote, proportional
          representation produces the same split the House has today. Adjust the controls to explore.
        </>
      ) : (
        <>
          In a hypothetical <strong>{genericLabel}</strong> national vote, proportional
          representation would shift the House about{' '}
          <strong className={color}>
            {absGain} {seats(absGain)} {towardWord(dGain)}
          </strong>{' '}
          from today’s. Adjust the controls to build your own scenario.
        </>
      );
  } else {
    // Current: today's House vs. PR of the projected vote. We state the shift
    // plainly, then (honestly) note it's mostly the polling move since 2024 —
    // not the map. The precise structural/swing split is in the "Difference
    // under PR" card below and on the Methodology page.
    if (dGain === 0) {
      lede = (
        <>
          Right now, today’s House already matches what proportional representation of the vote
          would produce. The map shows where individual states still differ.
        </>
      );
    } else {
      lede = (
        <>
          Today’s U.S. House would shift about{' '}
          <strong className={color}>
            {absGain} {seats(absGain)} {towardWord(dGain)}
          </strong>{' '}
          if every state’s seats matched its statewide vote.
        </>
      );
      if (structuralDGain != null) {
        const swing = dGain - structuralDGain;
        const biggerIsSwing = Math.abs(swing) >= Math.abs(structuralDGain);
        const retroLink = (
          <button
            type="button"
            onClick={() => onSelectView?.('retrospective')}
            className="underline underline-offset-2 hover:text-brand-navy"
          >
            2024 Retrospective
          </button>
        );
        caveat = biggerIsSwing ? (
          <>
            Most of that shift is the recent move {towardWord(swing)} in national polling, not the
            district map. The {retroLink} shows the map’s effect on its own.
          </>
        ) : (
          <>
            Most of that is built into the district map itself, not recent polling. The {retroLink}{' '}
            isolates it.
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

      {/* Two columns on lg+: the finding (left) and a plain "what is PR?" aside
        * (right) that fills what was empty space. Stacks on small screens. */}
      <div className="mt-4 sm:mt-5 lg:grid lg:grid-cols-[1.6fr_1fr] lg:gap-10 lg:items-start">
        <div>
          <p className="text-base sm:text-lg text-stone-800 leading-relaxed">{lede}</p>
          {caveat && (
            <p className="mt-3 text-sm sm:text-base text-stone-600 leading-relaxed">{caveat}</p>
          )}
        </div>

        <aside className="mt-6 lg:mt-1 rounded-lg border border-stone-200/80 bg-white/60 p-4">
          <div className="text-sm font-semibold text-stone-900">
            What is proportional representation?
          </div>
          <p className="mt-1.5 text-sm text-stone-600 leading-relaxed">
            It ties each party’s House seats to its share of the statewide vote, instead of the
            winner-take-all districts we use now. This map projects what that would change.
          </p>
        </aside>
      </div>

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
    </section>
  );
}
