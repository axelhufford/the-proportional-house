interface Props {
  /** Generic-ballot margin the user has chosen (positive = D lead, points). */
  genericBallot: number;
  /** Net swing relative to 2024 baseline, in points. Computed by caller. */
  swing: number;
  /** 2024 baseline margin (negative = R lead). Used to anchor the slider. */
  baseline2024: number;
  onChange: (genericBallot: number) => void;
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

export function Sandbox({ genericBallot, swing, baseline2024, onChange }: Props) {
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
    </div>
  );
}
