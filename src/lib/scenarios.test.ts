import { describe, expect, it } from 'vitest';
import { WYOMING_RULE_HOUSE_SIZE } from './apportionment';
import { ALL_METHODS } from './methods';
import { PRESET_MINORS } from './parties';
import { DEFAULT_HOUSE_SIZE } from './sandboxSwing';
import { HOME_SCENARIOS, SANDBOX_SCENARIOS, scenarioHouseSize } from './scenarios';

const ALL = [...new Set([...SANDBOX_SCENARIOS, ...HOME_SCENARIOS])];

describe('scenario registry', () => {
  it('references only real minor presets and canonical methods', () => {
    for (const s of ALL) {
      for (const id of s.config.minors) {
        expect(PRESET_MINORS[id], `${s.id} minor ${id}`).toBeDefined();
      }
      expect(ALL_METHODS, `${s.id} method`).toContain(s.config.method);
    }
  });

  it('resolves house sizes to real seat counts', () => {
    for (const s of ALL) {
      const size = scenarioHouseSize(s.config);
      expect(size).toBe(s.config.houseSize === 'wyoming' ? WYOMING_RULE_HOUSE_SIZE : DEFAULT_HOUSE_SIZE);
      expect(size).toBeGreaterThanOrEqual(435);
    }
  });

  it('keeps labels present and strips at four entries each', () => {
    expect(SANDBOX_SCENARIOS).toHaveLength(4);
    expect(HOME_SCENARIOS).toHaveLength(4);
    for (const s of ALL) {
      expect(s.chipLabel.length).toBeGreaterThan(0);
      expect(s.homeLabel.endsWith('?')).toBe(true);
      expect(s.title.length).toBeGreaterThan(0);
    }
  });
});
