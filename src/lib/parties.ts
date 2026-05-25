/**
 * Preset party library for the Sandbox extended mode.
 *
 * Two coalition-split presets reflect today's actual U.S. political
 * fault lines — a Bernie/AOC-style breakaway from the Democratic
 * coalition (Progressive Left) and a Trump/MAGA-style breakaway from
 * the Republican coalition (America First). The user can also build a
 * Custom party for any other scenario (Centrist / Forward Party, Green,
 * Libertarian, regional, etc.) by setting their own draw ratio.
 *
 * The D and R "presets" exist so components have a single source of
 * truth for label + color across two-party and N-party rendering.
 */
import type { Party, PartyId } from './sandboxTypes';

export const PARTY_D: Party = {
  id: 'D',
  label: 'Democrats',
  color: '#2166ac',
  draw_from: { D: 1, R: 0 },
};

export const PARTY_R: Party = {
  id: 'R',
  label: 'Republicans',
  color: '#b2182b',
  draw_from: { D: 0, R: 1 },
};

/**
 * Minor-party presets selectable from the Sandbox dropdown. Order in
 * this object determines dropdown order.
 */
export const PRESET_MINORS = {
  PROG: {
    id: 'PROG' as PartyId,
    label: 'Progressive Left',
    color: '#059669', // emerald — maximum distinction from D blue and R red in mixed seat bars
    draw_from: { D: 0.85, R: 0.15 },
  },
  AF: {
    id: 'AF' as PartyId,
    label: 'America First',
    color: '#CA8A04', // mustard gold — earthy, evokes nationalist symbology, distinct from R red
    draw_from: { D: 0.15, R: 0.85 },
  },
} as const satisfies Record<string, Party>;

export type PresetMinorId = keyof typeof PRESET_MINORS; // 'PROG' | 'AF'

/**
 * Default national share applied when a preset is first added to the
 * sandbox. Asymmetric on purpose: the right flank is empirically larger
 * today than the left flank, so a "both flanks break off" baseline
 * lands closer to reality than two symmetric percentages.
 */
export const DEFAULT_SHARE: Record<PresetMinorId, number> = {
  PROG: 0.06,
  AF: 0.08,
};

/** Default share for a freshly-added Custom party. */
export const CUSTOM_DEFAULT_SHARE = 0.05;

/** Color used by all Custom parties — no color picker in v1. */
export const CUSTOM_COLOR = '#6E6E6E';

/**
 * Build a Custom party at runtime from user input. Custom parties get
 * a unique id so two of them can coexist as third + fourth slots.
 */
export function buildCustomParty(opts: {
  label?: string;
  draw_from: { D: number; R: number };
  slot: 1 | 2;
}): Party {
  return {
    id: `CUSTOM-${opts.slot}`,
    label: opts.label?.trim() || `Custom party ${opts.slot}`,
    color: CUSTOM_COLOR,
    draw_from: opts.draw_from,
  };
}

/** Convenience: look up a preset minor by id. */
export function getPresetMinor(id: PresetMinorId): Party {
  return PRESET_MINORS[id];
}
