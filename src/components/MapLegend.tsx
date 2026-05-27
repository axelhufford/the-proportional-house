import { balanceColor, distortionColor } from '../lib/colors';
import type { ColorMode } from '../lib/types';
import type { SandboxPayload } from '../lib/sandboxTypes';

interface Props {
  mode: ColorMode;
  /**
   * When present, replace the diverging color scale with party swatches
   * for the active sandbox parties. Each state's fill is whichever party
   * holds plurality; this legend explains the mapping.
   */
  sandboxPayload?: SandboxPayload | null;
}

// Sample the same diverging color function the map uses, at evenly-spaced
// points across [-1, 1]. Guarantees the legend matches what the map renders.
const STOPS = [-1, -0.66, -0.33, 0, 0.33, 0.66, 1];

const LABELS: Record<ColorMode, { left: string; center: string; right: string; aria: string }> = {
  balance: {
    left: 'Strong R delegation',
    center: 'Even',
    right: 'Strong D delegation',
    aria: 'Color scale: red for states with a Republican-leaning projected delegation, blue for Democratic-leaning, with grey for an even split.',
  },
  distortion: {
    left: 'PR shifts toward R',
    center: 'Same as today',
    right: 'PR shifts toward D',
    aria: 'Color scale: orange for states where proportional representation would shift seats toward Republicans relative to today, purple for shifts toward Democrats, grey for states unchanged.',
  },
};

export function MapLegend({ mode, sandboxPayload }: Props) {
  // Extended sandbox legend: party swatches instead of a diverging
  // scale. Only swap to swatches when minors are actually active —
  // otherwise the map keeps painting balance/distortion (from sandbox
  // data) and the diverging legend stays the right description.
  const hasMinors = !!sandboxPayload && sandboxPayload.minors.length > 0;
  if (hasMinors && sandboxPayload) {
    const activeParties = sandboxPayload.national.parties.filter((p) => p.seats > 0);
    return (
      <div className="mt-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-stone-600">
          <span className="text-stone-500 uppercase tracking-wider">Plurality color:</span>
          {activeParties.map((p) => (
            <span key={p.party.id} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-full border border-stone-300/60"
                style={{ backgroundColor: p.party.color }}
                aria-hidden
              />
              <span className="text-stone-700">{p.party.label}</span>
              <span className="text-stone-400 tabular-nums">{p.seats} seats</span>
            </span>
          ))}
        </div>
        <div className="mt-1.5 text-[11px] text-stone-500">
          Each state’s fill = whichever party holds the most projected seats. Ties render gray.
        </div>
      </div>
    );
  }

  const colorFn = mode === 'balance' ? balanceColor : distortionColor;
  const stops = STOPS.map((v) => colorFn(v));
  const gradient = `linear-gradient(to right, ${stops.join(', ')})`;
  const labels = LABELS[mode];

  return (
    <div className="mt-4">
      <div
        className="h-3 w-full rounded-full"
        style={{ background: gradient }}
        role="img"
        aria-label={labels.aria}
      />
      <div className="mt-1.5 flex justify-between text-xs text-stone-500 tabular-nums">
        <span>{labels.left}</span>
        <span className="text-stone-400">{labels.center}</span>
        <span>{labels.right}</span>
      </div>
    </div>
  );
}
