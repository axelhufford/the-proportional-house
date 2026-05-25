import {
  defaultMinorState,
  MinorPartyControls,
  type MinorState,
} from './MinorPartyControls';

interface Props {
  /** Generic-ballot margin the user has chosen (positive = D lead, points). */
  genericBallot: number;
  /** Net swing relative to 2024 baseline, in points. Computed by caller. */
  swing: number;
  /** 2024 baseline margin (negative = R lead). Used to anchor the slider. */
  baseline2024: number;
  onChange: (genericBallot: number) => void;
  /** Extended-mode controls: minor parties + threshold. */
  minors: MinorState[];
  threshold: number;
  onMinorsChange: (minors: MinorState[]) => void;
  onThresholdChange: (threshold: number) => void;
}

const MIN = -15;
const MAX = 15;
const STEP = 0.1;

const PRESETS: { label: string; value: number }[] = [
  { label: 'R+10', value: -10 },
  { label: 'R+5', value: -5 },
  { label: 'Tie', value: 0 },
  { label: 'D+5', value: 5 },
  { label: 'D+10', value: 10 },
];

function fmtMargin(pts: number): string {
  if (Math.abs(pts) < 0.05) return 'Tie';
  return pts >= 0 ? `D+${pts.toFixed(1)}` : `R+${Math.abs(pts).toFixed(1)}`;
}

const THRESHOLD_MIN = 0;
const THRESHOLD_MAX = 0.1;
const THRESHOLD_STEP = 0.005;

export function Sandbox({
  genericBallot,
  swing,
  baseline2024,
  onChange,
  minors,
  threshold,
  onMinorsChange,
  onThresholdChange,
}: Props) {
  const addMinor = () => {
    // Defaults: slot 1 → Progressive Left, slot 2 → America First, slot 3
    // → fully-customizable Custom party. Users can change preset via the
    // dropdown.
    const preset =
      minors.length === 0 ? 'PROG' : minors.length === 1 ? 'AF' : 'CUSTOM';
    onMinorsChange([...minors, defaultMinorState(preset)]);
  };
  const updateMinor = (idx: number, next: MinorState) => {
    const copy = minors.slice();
    copy[idx] = next;
    onMinorsChange(copy);
  };
  const removeMinor = (idx: number) => {
    onMinorsChange(minors.filter((_, i) => i !== idx));
  };

  const MAX_MINORS = 3;
  const addButtonLabel =
    minors.length === 0
      ? '+ Add third party'
      : minors.length === 1
        ? '+ Add fourth party'
        : '+ Add fifth party';

  return (
    <div className="border border-stone-200 bg-stone-50 rounded-lg p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-stone-500 font-medium">
            Hypothetical generic ballot
          </div>
          <div className="text-2xl font-semibold tabular-nums mt-1">
            <span className={genericBallot >= 0 ? 'text-blue-700' : 'text-red-700'}>
              {fmtMargin(genericBallot)}
            </span>
          </div>
        </div>
        <div className="text-xs text-stone-600">
          Resulting national swing vs 2024 baseline ({fmtMargin(baseline2024)}):{' '}
          <span className={swing >= 0 ? 'text-blue-700 font-medium' : 'text-red-700 font-medium'}>
            {swing >= 0 ? '+' : ''}{swing.toFixed(1)} pts toward {swing >= 0 ? 'D' : 'R'}
          </span>
          <div className="text-stone-500 mt-1">
            Each state's projection uses this national swing × that state's elasticity.
          </div>
        </div>
      </div>

      <div className="mt-4 relative">
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={STEP}
          value={genericBallot}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Hypothetical generic ballot margin"
          aria-valuetext={fmtMargin(genericBallot)}
          className="w-full accent-stone-900"
        />
        <div className="mt-1 flex justify-between text-xs text-stone-500 tabular-nums">
          <span>R+{Math.abs(MIN)}</span>
          <span>Tie</span>
          <span>D+{MAX}</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="text-stone-500 uppercase tracking-wider self-center">Presets:</span>
        {PRESETS.map((p) => {
          const active = Math.abs(p.value - genericBallot) < STEP / 2;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(p.value)}
              className={[
                'px-3 py-1.5 sm:px-2 sm:py-1 rounded border',
                active
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'border-stone-300 text-stone-700 hover:bg-stone-100',
              ].join(' ')}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Extended-mode controls: minor parties + threshold. Additive — when
        * no minors are active, the sandbox behaves exactly as before. */}
      <div className="mt-5 pt-4 border-t border-stone-200 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wider text-stone-500 font-medium">
              Add minor parties
            </div>
            <div className="text-xs text-stone-500 mt-0.5">
              See how a coalition split would change every state's projected delegation.
            </div>
          </div>
          {minors.length < MAX_MINORS && (
            <button
              type="button"
              onClick={addMinor}
              className="text-xs px-3 py-1.5 sm:py-1 border border-stone-300 rounded text-stone-700 hover:bg-stone-100 flex-shrink-0"
            >
              {addButtonLabel}
            </button>
          )}
        </div>

        {minors.map((m, i) => (
          <MinorPartyControls
            key={i}
            slot={(i + 1) as 1 | 2 | 3}
            state={m}
            onChange={(next) => updateMinor(i, next)}
            onRemove={() => removeMinor(i)}
          />
        ))}

        {minors.length >= 1 && (
          <div className="pt-1">
            <div className="flex items-baseline justify-between text-xs text-stone-600 mb-1">
              <span className="font-medium text-stone-700">Threshold (per state)</span>
              <span className="tabular-nums font-medium text-stone-900">
                {(threshold * 100).toFixed(1)}%
              </span>
            </div>
            <input
              type="range"
              min={THRESHOLD_MIN}
              max={THRESHOLD_MAX}
              step={THRESHOLD_STEP}
              value={threshold}
              onChange={(e) => onThresholdChange(Number(e.target.value))}
              aria-label="Minor party threshold"
              aria-valuetext={`${(threshold * 100).toFixed(1)} percent`}
              className="w-full accent-stone-900"
            />
            <div className="text-[10px] text-stone-500 mt-0.5">
              Parties below this share within a state win no seats. Real PR systems usually
              set this at 4–5%.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
