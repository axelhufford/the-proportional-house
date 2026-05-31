import type { ViewMode, ColorMode } from '../lib/types';
import { SegmentedControl } from './SegmentedControl';

interface Props {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
}

const VIEW_MODES: { value: ViewMode; label: string; disabled?: boolean; title?: string }[] = [
  { value: 'current', label: 'Current Projection', title: 'Today’s House vs. a proportional allocation of the projected statewide vote.' },
  { value: 'retrospective', label: 'Retrospective', title: 'How a past election’s actual votes would have allocated under PR — pick the cycle below.' },
  { value: 'sandbox', label: 'Sandbox', title: 'Experiment: change the generic ballot, parties, allocation method, and House size.' },
];

const COLOR_MODES: { value: ColorMode; label: string; title?: string }[] = [
  { value: 'balance', label: 'Delegation Balance', title: 'Which party leads each state’s projected delegation.' },
  { value: 'distortion', label: 'Distortion vs Today', title: 'Which way each state’s seats would shift under PR, relative to today.' },
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
