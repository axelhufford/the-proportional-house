/**
 * Controls for a single minor party slot in the Sandbox.
 *
 * Picks a preset (Progressive Left, America First, or Custom), edits the
 * national vote share, and — for Custom — picks a label and a D↔R draw
 * bias. The parent (`Sandbox.tsx`) owns the state and gets `onChange` /
 * `onRemove` callbacks.
 *
 * Fully controlled — no internal UI state. URL sync lives one level up
 * in `Home.tsx`.
 */
import {
  CUSTOM_DEFAULT_SHARE,
  DEFAULT_SHARE,
  PRESET_MINORS,
  type PresetMinorId,
} from '../lib/parties';

export type MinorPresetSelector = PresetMinorId | 'CUSTOM';

export interface MinorState {
  presetId: MinorPresetSelector;
  /** Only used (and rendered) for CUSTOM. */
  label?: string;
  /** [0, 0.25] — national vote share. */
  share: number;
  /** Only used for CUSTOM. [0, 1] — fraction drawn from D. drawR = 1 - drawD. */
  drawD?: number;
}

interface Props {
  slot: 1 | 2;
  state: MinorState;
  onChange: (next: MinorState) => void;
  onRemove: () => void;
}

const SHARE_MIN = 0;
const SHARE_MAX = 0.25;
const SHARE_STEP = 0.005;

/** Default state for a freshly-added minor of the given preset. */
export function defaultMinorState(presetId: MinorPresetSelector): MinorState {
  if (presetId === 'CUSTOM') {
    return {
      presetId: 'CUSTOM',
      label: '',
      share: CUSTOM_DEFAULT_SHARE,
      drawD: 0.5,
    };
  }
  // Initialize drawD from the preset's canonical ratio so the slider
  // (now always visible — see below) lands on the brand baseline.
  return {
    presetId,
    share: DEFAULT_SHARE[presetId],
    drawD: PRESET_MINORS[presetId].draw_from.D,
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function MinorPartyControls({ slot, state, onChange, onRemove }: Props) {
  const isCustom = state.presetId === 'CUSTOM';
  const presetParty =
    state.presetId !== 'CUSTOM' ? PRESET_MINORS[state.presetId] : null;
  const drawD = state.drawD ?? 0.5;
  const drawR = 1 - drawD;

  const handlePresetChange = (next: MinorPresetSelector) => {
    if (next === state.presetId) return;
    // Pulling a fresh default for the new preset feels less surprising
    // than carrying over the current share + label.
    onChange(defaultMinorState(next));
  };

  return (
    <div className="border border-stone-200 bg-white rounded-md p-3 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs uppercase tracking-wider text-stone-500 font-medium">
          {slot === 1 ? 'Third party' : 'Fourth party'}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-stone-500 hover:text-stone-900 hover:underline"
          aria-label={`Remove ${slot === 1 ? 'third' : 'fourth'} party`}
        >
          Remove
        </button>
      </div>

      {/* Preset dropdown + (Custom only) label input */}
      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] items-center gap-2">
        <label className="text-xs text-stone-600">Preset</label>
        <select
          value={state.presetId}
          onChange={(e) => handlePresetChange(e.target.value as MinorPresetSelector)}
          className="border border-stone-300 rounded px-2 py-1 text-sm bg-white"
        >
          <option value="PROG">Progressive Left</option>
          <option value="AF">America First</option>
          <option value="CUSTOM">Custom</option>
        </select>
        {isCustom && (
          <>
            <label className="text-xs text-stone-600">Label</label>
            <input
              type="text"
              value={state.label ?? ''}
              onChange={(e) => onChange({ ...state, label: e.target.value })}
              placeholder={`Custom party ${slot}`}
              className="border border-stone-300 rounded px-2 py-1 text-sm"
            />
          </>
        )}
      </div>

      {/* Color swatch + live draw-from description (always reflects the
        * actual slider value below, whether preset or customized). */}
      <div className="flex items-center gap-2 text-xs text-stone-600">
        <span
          className="inline-block h-3 w-3 rounded-full border border-stone-300"
          style={{ backgroundColor: presetParty?.color ?? '#6E6E6E' }}
          aria-hidden
        />
        <span>
          Draws {Math.round(drawD * 100)}% from D · {Math.round(drawR * 100)}% from R
        </span>
      </div>

      {/* Share slider */}
      <div>
        <div className="flex items-baseline justify-between text-xs text-stone-600 mb-1">
          <span>Vote share</span>
          <span className="tabular-nums font-medium text-stone-900">{formatPercent(state.share)}</span>
        </div>
        <input
          type="range"
          min={SHARE_MIN}
          max={SHARE_MAX}
          step={SHARE_STEP}
          value={state.share}
          onChange={(e) => onChange({ ...state, share: Number(e.target.value) })}
          aria-label={`Vote share for ${slot === 1 ? 'third' : 'fourth'} party`}
          aria-valuetext={formatPercent(state.share)}
          className="w-full accent-stone-900"
        />
      </div>

      {/* Draw slider — visible for all minors, including presets. Presets
        * default to their canonical ratio (e.g. Progressive Left = 85/15);
        * the user can tweak from there without changing the party's name
        * or color. Re-selecting the preset resets the slider. */}
      <div>
        <div className="flex items-baseline justify-between text-xs text-stone-600 mb-1">
          <span>Draws votes from</span>
          <span className="tabular-nums text-stone-500">
            D {Math.round(drawD * 100)}% · R {Math.round(drawR * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={drawD}
          onChange={(e) => onChange({ ...state, drawD: Number(e.target.value) })}
          aria-label="Draw bias slider (0 = all from R, 1 = all from D)"
          className="w-full accent-stone-900"
        />
        <div className="flex justify-between text-[10px] text-stone-400 mt-0.5">
          <span>← All from R</span>
          <span>Symmetric</span>
          <span>All from D →</span>
        </div>
      </div>
    </div>
  );
}
