import { fmtMargin } from '../lib/format';
import type { BallotVariant } from '../lib/types';

interface Props {
  variants: BallotVariant[];
  value: string;
  onChange: (id: string) => void;
}

/**
 * Switches which generic-ballot average drives the Current view.
 *
 * A compact segmented control rather than descriptive cards like ViewModeTabs:
 * this is a refinement of one view, not a change of view, and it sits inline
 * with the ballot figure in the hero.
 *
 * The note under the control is not decoration. The likely-voter option is OUR
 * average of likely-voter polls, and it must never be mistaken for Silver
 * Bulletin's likely-voter-adjusted average, which is a different number
 * produced by a method the public poll database can't support. The poll count
 * rides along for the same reason — the LV average runs on a handful of polls
 * and readers should see that before they lean on it.
 */
export function BallotVariantToggle({ variants, value, onChange }: Props) {
  if (variants.length < 2) return null;
  const active = variants.find((v) => v.id === value) ?? variants[0];

  return (
    <div>
      <span
        id="ballot-variant-label"
        className="block text-xs uppercase tracking-wider text-stone-500 font-medium mb-1.5"
      >
        Polling average
      </span>
      <div
        role="group"
        aria-labelledby="ballot-variant-label"
        className="inline-flex rounded-lg border border-stone-200 bg-white p-0.5"
      >
        {variants.map((v) => {
          const isActive = v.id === active.id;
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(v.id)}
              title={v.note}
              className={[
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-navy text-white shadow-sm'
                  : 'text-stone-600 hover:bg-stone-50 hover:text-brand-navy',
              ].join(' ')}
            >
              {v.short_label}
              <span className={`ml-1.5 tabular-nums ${isActive ? 'text-white/75' : 'text-stone-400'}`}>
                {fmtMargin(v.margin)}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 max-w-prose text-xs leading-snug text-stone-500">
        {active.note}{' '}
        <span className="whitespace-nowrap">
          ({active.n_polls} poll{active.n_polls === 1 ? '' : 's'} in the average.)
        </span>
      </p>
    </div>
  );
}
