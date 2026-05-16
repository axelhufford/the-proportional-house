import { balanceColor, distortionColor } from '../lib/colors';
import type { ColorMode } from '../lib/types';

interface Props {
  mode: ColorMode;
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

export function MapLegend({ mode }: Props) {
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
