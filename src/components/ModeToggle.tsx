import type { ViewMode, ColorMode } from '../lib/types';
import { SegmentedControl } from './SegmentedControl';
import { ViewModeTabs } from './ViewModeTabs';

interface Props {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
  /** Passed through to ViewModeTabs — the 'current' tab's phase-aware wording. */
  currentTab?: { label: string; desc: string; title?: string };
}

// "vs. As Elected", not "vs. Today": the comparison is against the delegation
// voters elected (2024 in the projection), which stops being "today's" House
// the moment a new Congress is seated.
const COLOR_MODES: { value: ColorMode; label: string; title?: string }[] = [
  { value: 'balance', label: 'Delegation Balance', title: 'Which party leads each state’s delegation under PR.' },
  { value: 'distortion', label: 'Distortion vs. As Elected', title: 'Which way each state’s seats would shift under PR, relative to the delegation voters elected.' },
];

export function ModeToggle({ viewMode, onViewModeChange, colorMode, onColorModeChange, currentTab }: Props) {
  return (
    <div className="space-y-3">
      {/* VIEW is the primary control — prominent descriptive tabs so the
          Retrospective and Sandbox views read as clickable and invite exploration. */}
      <ViewModeTabs value={viewMode} onChange={onViewModeChange} current={currentTab} />
      {/* Color-by is a secondary map-coloring control; keep it compact below. */}
      <SegmentedControl
        label="Color by"
        value={colorMode}
        options={COLOR_MODES}
        onChange={onColorModeChange}
      />
    </div>
  );
}
