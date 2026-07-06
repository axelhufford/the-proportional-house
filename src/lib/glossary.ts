/**
 * Single source of truth for the plain-language glossary surfaced by the
 * <Term> component. Each entry is a one-sentence definition shown inline at
 * the point of use, with an `anchor` that deep-links into the matching
 * Methodology section (ScrollManager handles the hash scroll).
 *
 * Method definitions reuse METHOD_DESCRIPTIONS from ./methods so the tooltip
 * and the Sandbox/comparison-table copy never diverge.
 */
import { METHOD_DESCRIPTIONS } from './methods';

export interface GlossaryEntry {
  /** Canonical display name — used when <Term> is given no children. */
  term: string;
  /** One-sentence plain-language definition shown in the tooltip. */
  short: string;
  /** Methodology section id for the "Learn more →" deep link. */
  anchor?: string;
}

export type GlossarySlug =
  | 'pure-pr'
  | 'sainte-lague'
  | 'dhondt'
  | 'hamilton'
  | 'mmd'
  | 'mmp'
  | 'generic-ballot'
  | 'swing'
  | 'baseline-2024'
  | 'elasticity'
  | 'threshold'
  | 'house-size'
  | 'polling-error';

export const GLOSSARY: Record<GlossarySlug, GlossaryEntry> = {
  'pure-pr': {
    term: 'Pure PR',
    short: METHOD_DESCRIPTIONS.PR,
    anchor: 'sainte-lague',
  },
  'sainte-lague': {
    term: 'Sainte-Laguë',
    short:
      'A divisor method for turning vote shares into whole seats (divisors 1, 3, 5, …). It’s the most neutral between large and small parties, so it’s our default.',
    anchor: 'sainte-lague',
  },
  dhondt: {
    term: 'D’Hondt',
    short: METHOD_DESCRIPTIONS['PR-DH'],
    anchor: 'methods',
  },
  hamilton: {
    term: 'Hamilton',
    short: METHOD_DESCRIPTIONS['PR-HAM'],
    anchor: 'methods',
  },
  mmd: {
    term: 'MMD',
    short:
      'Multi-member districts: each state is split into small districts (e.g. 3 or 5 seats) and seats are shared proportionally within each — less proportional than statewide PR.',
    anchor: 'methods',
  },
  mmp: {
    term: 'MMP',
    short:
      'Mixed-member proportional: half the seats from single-member districts, half from party lists that top each party up toward its proportional share. The German / New Zealand model.',
    anchor: 'methods',
  },
  'generic-ballot': {
    term: 'generic ballot',
    short:
      'The national polling question “which party’s House candidate would you vote for?” We use the current average as the national mood.',
    anchor: 'the-math',
  },
  swing: {
    term: 'swing',
    short:
      'How far the national mood has moved since the 2024 House vote, in percentage points — applied to each state to project today’s vote.',
    anchor: 'the-math',
  },
  'baseline-2024': {
    term: '2024 baseline',
    short:
      'The actual nationwide U.S. House popular vote in 2024 — the starting point the swing is applied to.',
    anchor: 'the-math',
  },
  elasticity: {
    term: 'elasticity',
    short:
      'How sharply a state reacts to national shifts: swingy states move more than the nation, inelastic ones move less.',
    anchor: 'the-math',
  },
  threshold: {
    term: 'threshold',
    short:
      'A minimum vote share a party must clear to win any seats (e.g. 5%). Below it, its votes are set aside before seats are allocated.',
    anchor: 'methods',
  },
  'house-size': {
    term: 'House size',
    short:
      'How many seats the House has in total. Fixed at 435 since 1929; presets here include the Wyoming Rule (~573) and the cube-root rule (~692).',
    anchor: 'house-size',
  },
  'polling-error': {
    term: 'Polling error',
    short:
      'How far final generic-ballot polling averages have missed the actual House vote in recent cycles. We re-run the projection with the margin moved by that much each way — a sensitivity range, not a probability.',
    anchor: 'polling-uncertainty',
  },
};
