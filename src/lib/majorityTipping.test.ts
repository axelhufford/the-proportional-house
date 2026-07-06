import { describe, expect, it } from 'vitest';
import { majorityTippingSentence } from './majorityTipping';

describe('majorityTippingSentence', () => {
  it('states a D-side tipping point', () => {
    expect(majorityTippingSentence(5.0)).toBe(
      'Control of the House itself would flip at D+5.0 on the generic ballot.',
    );
  });

  it('phrases an R-side tipping point direction-neutrally', () => {
    expect(majorityTippingSentence(-0.6)).toBe(
      'Control of the House itself would flip at R+0.6 on the generic ballot.',
    );
  });

  it('reads a tie tipping point as an even national vote', () => {
    expect(majorityTippingSentence(0)).toBe(
      'Control of the House itself would flip at an even national vote.',
    );
  });
});
