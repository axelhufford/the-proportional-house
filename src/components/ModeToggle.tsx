import type { ViewMode, ColorMode } from '../lib/types';
import { SegmentedControl } from './SegmentedControl';
import { ViewModeTabs } from './ViewModeTabs';

interface Props {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
}

const COLOR_MODES: { value: ColorMode; label: string; title?: string }[] = [
  { value: 'balance', label: 'Delegation Balance', title: 'Which party leads each state’s projected delegation.' },
  { value: 'distortion', label: 'Distortion vs Today', title: 'Which way each state’s seats would shift under PR, relative to today.' },
];

export function ModeToggle({ viewMode, onViewModeChange, colorMode, onColorModeChange }: Props) {
  return (
    <div className="space-y-3">
      {/* VIEW is the primary control — prominent descriptive tabs so the
          Retrospective and Sandbox views read as clickable and invite exploration. */}
      <ViewModeTabs value={viewMode} onChange={onViewModeChange} />
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
