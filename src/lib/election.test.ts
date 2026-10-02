import { describe, expect, it } from 'vitest';
import { easternDate, electionPhase, isFrozen, projectionCopy } from './election';
import type { ElectionMeta } from './types';

const FREEZE = '2026-11-03T10:00:00Z';
const freezeMs = Date.parse(FREEZE);
const election = (phase: ElectionMeta['phase']): ElectionMeta => ({
  cycle: 2026,
  election_date: '2026-11-03',
  freeze_at: FREEZE,
  phase,
  baseline_cycle: 2024,
});

describe('electionPhase', () => {
  it('treats a payload without the block as the projection phase', () => {
    expect(electionPhase(undefined, freezeMs + 1)).toBe('projection');
  });

  it('flips to counting at freeze_at on the clock, to the millisecond', () => {
    expect(electionPhase(election('projection'), freezeMs - 1)).toBe('projection');
    expect(electionPhase(election('projection'), freezeMs)).toBe('counting');
  });

  it('keeps a phase the pipeline already advanced', () => {
    expect(electionPhase(election('results'), 0)).toBe('results');
  });

  it('ignores an unparseable freeze_at rather than freezing', () => {
    expect(electionPhase({ ...election('projection'), freeze_at: 'soon' }, freezeMs)).toBe('projection');
  });
});

describe('projectionCopy', () => {
  const meta = (phase: ElectionMeta['phase']) => ({
    generated_at: '2026-11-03T06:05:00+00:00',
    election: election(phase),
  });

  it('keeps the pre-election wording before the freeze', () => {
    const c = projectionCopy(meta('projection'), freezeMs - 1);
    expect(c.frozen).toBe(false);
    expect(c.viewLabel).toBe('Current Projection');
    expect(c.shareLabel).toBe('CURRENT POLLING');
  });

  it('never calls a frozen projection "today’s" or "current"', () => {
    const c = projectionCopy(meta('projection'), freezeMs);
    expect(c.frozen).toBe(true);
    const all = [c.viewLabel, c.viewDesc, c.pollingPhrase, c.pollingLabel, c.shareLabel, c.updatedLabel].join(' ');
    expect(all).not.toMatch(/today|current/i);
    expect(c.frozenOn).toBe('Nov 3, 2026');
    expect(isFrozen(meta('projection'), freezeMs)).toBe(true);
  });
});

describe('easternDate', () => {
  it('dates a 1 AM ET run as that Eastern day, not the UTC one', () => {
    // 04:30 UTC on Nov 3 is still Nov 2 in Eastern time (EST, UTC−5).
    expect(easternDate('2026-11-03T04:30:00Z')).toBe('Nov 2, 2026');
    expect(easternDate('2026-11-03T06:05:00Z')).toBe('Nov 3, 2026');
    expect(easternDate('nope')).toBe('');
  });
});
