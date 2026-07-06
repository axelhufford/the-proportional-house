import { describe, expect, it } from 'vitest';
import { majorityTippingSentence } from './majorityTipping';

describe('majorityTippingSentence', () => {
  it('reads inside the band when the tipping point is within ±ε of today', () => {
    expect(
      majorityTippingSentence({ tippingMargin: 5.0, currentMargin: 6.0, epsilonPoints: 2.2 }),
    ).toBe('Control of the House itself would flip at D+5.0 on the generic ballot — inside that range.');
  });

  it('reads outside the band when the crossing is farther than ε', () => {
    expect(
      majorityTippingSentence({ tippingMargin: -0.6, currentMargin: 6.0, epsilonPoints: 2.2 }),
    ).toBe(
      'Control of the House itself would flip at R+0.6 on the generic ballot — outside that range.',
    );
  });

  it('treats the exact ε boundary as inside', () => {
    expect(
      majorityTippingSentence({ tippingMargin: 3.8, currentMargin: 6.0, epsilonPoints: 2.2 }),
    ).toContain('— inside that range.');
  });

  it('falls back to a distance clause when no band ships', () => {
    expect(majorityTippingSentence({ tippingMargin: -0.6, currentMargin: 6.0 })).toBe(
      "Control of the House itself would flip at R+0.6 on the generic ballot — 6.6 points from today's average.",
    );
  });

  it('phrases an R-side tipping point direction-neutrally', () => {
    const s = majorityTippingSentence({ tippingMargin: -1.4, currentMargin: -3.0, epsilonPoints: 2.2 });
    expect(s).toContain('at R+1.4 on the generic ballot');
    expect(s).toContain('inside');
  });

  it('reads a tie tipping point as an even national vote', () => {
    expect(
      majorityTippingSentence({ tippingMargin: 0, currentMargin: 6.0, epsilonPoints: 2.2 }),
    ).toBe('Control of the House itself would flip at an even national vote — outside that range.');
  });
});
