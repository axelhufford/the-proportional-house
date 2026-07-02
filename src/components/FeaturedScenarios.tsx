import { HOME_SCENARIOS, type Scenario } from '../lib/scenarios';

interface Props {
  /**
   * Apply a scenario and switch to the sandbox view. The parent owns all
   * sandbox state, so scenario chips must go through its setters — an
   * in-SPA navigation to /sandbox?… would not re-run the URL-param
   * initializers, and the URL-sync effect would immediately rewrite it.
   */
  onApply: (scenario: Scenario) => void;
  /** Open the sandbox as-is, no scenario applied. */
  onOpenSandbox: () => void;
}

/**
 * The home-view "Try a what-if —" strip: curated sandbox scenarios surfaced
 * on the Current view, where visitors who'd never click the Sandbox tab can
 * still trip over what it does. Same registry (and pill styling) as the
 * in-sandbox "New here? Try —" strip, but question-form labels.
 */
export function FeaturedScenarios({ onApply, onOpenSandbox }: Props) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-stone-500 font-medium self-center">Try a what-if —</span>
      {HOME_SCENARIOS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onApply(s)}
          title={s.title}
          className="px-3 py-1.5 sm:py-1 rounded-full border border-brand-navy/30 text-brand-navy hover:bg-brand-navy/5 transition-colors"
        >
          {s.homeLabel}
        </button>
      ))}
      <button
        type="button"
        onClick={onOpenSandbox}
        className="text-stone-500 hover:text-stone-800 underline underline-offset-2 transition-colors"
      >
        Open the sandbox →
      </button>
    </div>
  );
}
