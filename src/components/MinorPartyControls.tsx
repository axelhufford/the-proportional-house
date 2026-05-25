/**
 * Controls for a single minor party slot in the Sandbox.
 *
 * Picks a preset (Progressive Left, America First, or Custom), edits the
 * national vote share, and — for Custom — picks a label, a color, and a
 * D↔R draw bias. The parent (`Sandbox.tsx`) owns the state and gets
 * `onChange` / `onRemove` callbacks.
 *
 * Fully controlled — no internal UI state. URL sync lives one level up
 * in `Home.tsx`.
 */
import {
  CUSTOM_DEFAULT_COLOR,
  CUSTOM_DEFAULT_SHARE,
  DEFAULT_SHARE,
  type MinorSlot,
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
  /** [0, 1] — fraction drawn from D. drawR = 1 - drawD. Used by all minors. */
  drawD?: number;
  /** Only used for CUSTOM. Hex string like "#6E6E6E". Defaults to CUSTOM_DEFAULT_COLOR. */
  color?: string;
}

interface Props {
  slot: MinorSlot;
  state: MinorState;
  onChange: (next: MinorState) => void;
  onRemove: () => void;
}

const SHARE_MIN = 0;
const SHARE_MAX = 0.25;
const SHARE_STEP = 0.005;

const SLOT_ORDINAL: Record<MinorSlot, string> = {
  1: 'third',
  2: 'fourth',
  3: 'fifth',
};

/** Default state for a freshly-added minor of the given preset. */
export function defaultMinorState(presetId: MinorPresetSelector): MinorState {
  if (presetId === 'CUSTOM') {
    return {
      presetId: 'CUSTOM',
      label: '',
      share: CUSTOM_DEFAULT_SHARE,
      drawD: 0.5,
      color: CUSTOM_DEFAULT_COLOR,
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
  // For Custom: live color the user has picked (or default gray).
  // For presets: the preset's canonical color — not user-editable here.
  const swatchColor = isCustom
    ? (state.color || CUSTOM_DEFAULT_COLOR)
    : (presetParty?.color ?? CUSTOM_DEFAULT_COLOR);
  const ordinal = SLOT_ORDINAL[slot];

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
          {ordinal.charAt(0).toUpperCase() + ordinal.slice(1)} party
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-stone-500 hover:text-stone-900 hover:underline"
          aria-label={`Remove ${ordinal} party`}
        >
          Remove
        </button>
      </div>

      {/* Preset dropdown + (Custom only) label + color inputs */}
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
            <label className="text-xs text-stone-600" htmlFor={`custom-color-${slot}`}>
              Color
            </label>
            <div className="flex items-center gap-2">
              <input
                id={`custom-color-${slot}`}
                type="color"
                value={state.color || CUSTOM_DEFAULT_COLOR}
                onChange={(e) => onChange({ ...state, color: e.target.value })}
                aria-label={`Color for ${ordinal} party`}
                className="h-8 w-12 border border-stone-300 rounded cursor-pointer bg-white p-0.5"
              />
              <span className="text-xs text-stone-500 font-mono uppercase tabular-nums">
                {(state.color || CUSTOM_DEFAULT_COLOR).toUpperCase()}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Color swatch + live draw-from description (always reflects the
        * actual slider value below, whether preset or customized). */}
      <div className="flex items-center gap-2 text-xs text-stone-600">
        <span
          className="inline-block h-3 w-3 rounded-full border border-stone-300"
          style={{ backgroundColor: swatchColor }}
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
          aria-label={`Vote share for ${ordinal} party`}
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
