import type { ReactNode } from 'react';
import type { ViewMode } from '../lib/types';

interface ViewOption {
  value: ViewMode;
  label: string;
  desc: string;
  title: string;
  icon: ReactNode;
}

// Small inline icons (≈17px, currentColor) matching the codebase's inline-SVG
// style. Decorative — the label + descriptor carry the meaning — so aria-hidden.
const iconProps = {
  width: 17,
  height: 17,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

// Current: a target / "you are here" dot.
function CurrentIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Retrospective: a clock (looking back in time).
function ClockIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

// Sandbox: sliders (adjust your own scenario).
function SlidersIcon() {
  return (
    <svg {...iconProps}>
      <line x1="4" y1="8" x2="20" y2="8" />
      <circle cx="9" cy="8" r="2.2" fill="currentColor" stroke="none" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="15" cy="16" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

const VIEW_OPTIONS: ViewOption[] = [
  {
    value: 'current',
    label: 'Current Projection',
    desc: 'Today’s polling',
    title: 'Today’s House vs. a proportional allocation of the projected statewide vote.',
    icon: <CurrentIcon />,
  },
  {
    value: 'retrospective',
    label: 'Retrospective',
    desc: 'Past cycles, 2016–24',
    title: 'How a past election’s actual votes would have allocated under PR — pick the cycle below.',
    icon: <ClockIcon />,
  },
  {
    value: 'sandbox',
    label: 'Sandbox',
    desc: 'Build your own',
    title: 'Experiment: change the generic ballot, parties, allocation method, and House size.',
    icon: <SlidersIcon />,
  },
];

interface Props {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

/**
 * The primary VIEW switch, styled as descriptive tabs so the Retrospective and
 * Sandbox views read as clearly-clickable and their payoff is obvious (icon +
 * label + one-line descriptor). Active = filled brand navy; inactive = bordered
 * white cards with a navy hover. Radio-style group via aria-pressed buttons.
 */
export function ViewModeTabs({ value, onChange }: Props) {
  return (
    <div>
      <span
        id="view-tabs-label"
        className="block text-xs uppercase tracking-wider text-stone-500 font-medium mb-1.5"
      >
        View
      </span>
      <div role="group" aria-labelledby="view-tabs-label" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {VIEW_OPTIONS.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              title={opt.title}
              className={[
                'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                active
                  ? 'bg-brand-navy border-brand-navy text-white shadow-sm'
                  : 'bg-white border-stone-200 text-stone-700 hover:border-brand-navy/40 hover:bg-stone-50',
              ].join(' ')}
            >
              <span className={`mt-0.5 shrink-0 ${active ? 'text-white' : 'text-brand-navy'}`}>
                {opt.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">{opt.label}</span>
                <span className={`block text-xs leading-tight mt-0.5 ${active ? 'text-white/75' : 'text-stone-500'}`}>
                  {opt.desc}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
