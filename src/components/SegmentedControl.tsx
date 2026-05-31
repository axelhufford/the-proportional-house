export interface SegOpt<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

/**
 * Labeled segmented control (a row of mutually-exclusive pill buttons).
 * Shared by the view/color toggles (ModeToggle) and the retrospective year
 * selector. Accessible: a labelled radio-style group with `aria-pressed`.
 */
export function SegmentedControl<T extends string>({
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
  const sid = `segctl-${label.replace(/\s+/g, '-')}`;
  return (
    <div className="flex items-center gap-2">
      <span id={sid} className="text-xs uppercase tracking-wider text-stone-500 font-medium">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={sid}
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
              title={opt.disabled ? 'Coming in a later phase' : opt.title}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
