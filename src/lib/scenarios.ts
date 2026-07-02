/**
 * Curated sandbox scenarios — one click sets several knobs at once so a
 * newcomer can see a real reform without first understanding every control.
 *
 * Single registry consumed by two strips that must stay in sync:
 *   - the in-sandbox "New here? Try —" strip (Sandbox.tsx), and
 *   - the home-view "Try a what-if —" strip (FeaturedScenarios.tsx), which
 *     jumps into the sandbox with the scenario pre-applied.
 *
 * Configs are declarative data (preset ids, canonical methods, semantic
 * house sizes); consumers turn them into state via their own callbacks —
 * minors through defaultMinorState, house size through scenarioHouseSize.
 * The generic-ballot margin is intentionally never part of a scenario:
 * whatever mood the user (or live polling) has set stays put.
 */
import { WYOMING_RULE_HOUSE_SIZE } from './apportionment';
import type { AllocationMethodKind } from './methods';
import type { PresetMinorId } from './parties';
import { DEFAULT_HOUSE_SIZE } from './sandboxSwing';

export interface ScenarioConfig {
  /** Preset minors to add, in slot order (empty = plain two-party). */
  minors: PresetMinorId[];
  /** Canonical method — consumers must also clear magnitude/share overrides. */
  method: AllocationMethodKind;
  houseSize: 'default' | 'wyoming';
}

export interface Scenario {
  id: 'prog-6' | 'two-parties' | 'mmp-germany' | 'mmd-5' | 'wyoming-house';
  /** Short label for the in-sandbox strip. */
  chipLabel: string;
  /** Question-form label for the home-view strip. */
  homeLabel: string;
  /** One-line description — rendered as the pill's title tooltip. */
  title: string;
  config: ScenarioConfig;
}

/** Resolve a scenario's semantic house size to a seat count. */
export function scenarioHouseSize(config: ScenarioConfig): number {
  return config.houseSize === 'wyoming' ? WYOMING_RULE_HOUSE_SIZE : DEFAULT_HOUSE_SIZE;
}

const REGISTRY: Record<Scenario['id'], Scenario> = {
  'prog-6': {
    id: 'prog-6',
    chipLabel: 'Progressive breakaway',
    homeLabel: 'What if a Progressive party took 6%?',
    title:
      'A Bernie/AOC-style Progressive Left party at 6% of the national vote, with a 5% threshold.',
    config: { minors: ['PROG'], method: 'PR', houseSize: 'default' },
  },
  'two-parties': {
    id: 'two-parties',
    chipLabel: 'Two new parties',
    homeLabel: 'What if both flanks broke away?',
    title: 'Add a Progressive Left and America First party, with a 5% threshold.',
    config: { minors: ['PROG', 'AF'], method: 'PR', houseSize: 'default' },
  },
  'mmp-germany': {
    id: 'mmp-germany',
    chipLabel: 'Mixed-member (Germany)',
    homeLabel: 'What if the U.S. used Germany’s system?',
    title: 'Half single-member districts, half proportional list — the German/NZ system.',
    config: { minors: [], method: 'MMP-50', houseSize: 'default' },
  },
  'mmd-5': {
    id: 'mmd-5',
    chipLabel: 'Multi-member districts',
    homeLabel: 'What if districts elected 5 members each?',
    title: 'Group seats into 5-seat districts with PR inside each.',
    config: { minors: [], method: 'MMD-5', houseSize: 'default' },
  },
  'wyoming-house': {
    id: 'wyoming-house',
    chipLabel: 'Bigger House',
    homeLabel: `What if the House had ${WYOMING_RULE_HOUSE_SIZE} seats?`,
    title: `Expand the House to ${WYOMING_RULE_HOUSE_SIZE} seats (the Wyoming Rule).`,
    config: { minors: [], method: 'PR', houseSize: 'wyoming' },
  },
};

/** The in-sandbox strip — unchanged lineup from before the shared registry. */
export const SANDBOX_SCENARIOS: Scenario[] = [
  REGISTRY['two-parties'],
  REGISTRY['mmp-germany'],
  REGISTRY['mmd-5'],
  REGISTRY['wyoming-house'],
];

/** The home-view strip — leads with the third-party hook. */
export const HOME_SCENARIOS: Scenario[] = [
  REGISTRY['prog-6'],
  REGISTRY['two-parties'],
  REGISTRY['mmp-germany'],
  REGISTRY['wyoming-house'],
];
