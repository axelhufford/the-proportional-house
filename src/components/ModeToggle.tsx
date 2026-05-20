import type { ViewMode, ColorMode } from '../lib/types';

interface Props {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
}

const VIEW_MODES: { value: ViewMode; label: string; disabled?: boolean }[] = [
  { value: 'current', label: 'Current Projection' },
  { value: 'retrospective', label: '2024 Retrospective' },
  { value: 'sandbox', label: 'Sandbox' },
];

const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: 'balance', label: 'Delegation Balance' },
  { value: 'distortion', label: 'Distortion vs Today' },
];

export function ModeToggle({ viewMode, onViewModeChange, colorMode, onColorModeChange }: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <SegmentedControl
        label="View"
        value={viewMode}
        options={VIEW_MODES}
        onChange={onViewModeChange}
      />
      <SegmentedControl
        label="Color by"
        value={colorMode}
        options={COLOR_MODES}
        onChange={onColorModeChange}
      />
    </div>
  );
}

interface SegOpt<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: SegOpt<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span id={`segctl-${label.replace(/\s+/g, '-')}`} className="text-xs uppercase tracking-wider text-stone-500 font-medium">{label}</span>
      <div
        role="group"
        aria-labelledby={`segctl-${label.replace(/\s+/g, '-')}`}
        className="inline-flex rounded-md border border-stone-300 bg-white p-0.5"
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={opt.disabled}
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              className={[
                'px-3 py-1.5 sm:py-1 text-sm rounded',
                active ? 'bg-stone-900 text-white' : 'text-stone-700 hover:bg-stone-100',
                opt.disabled ? 'opacity-40 cursor-not-allowed hover:bg-transparent' : '',
              ].join(' ')}
              title={opt.disabled ? 'Coming in a later phase' : undefined}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
