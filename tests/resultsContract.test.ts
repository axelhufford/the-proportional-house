/**
 * Contract test for public/data/results_<cycle>.json against the TypeScript
 * shape the results view reads (src/lib/types.ts ResultsPayload). Run on the
 * REAL built file, like apiContract.test.ts: data-pipeline/validate_data.py
 * checks the arithmetic, this checks the pipeline and the frontend agree on
 * field names and nullability.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isReporting, resultsToProjectionPayload } from '../src/lib/results';
import type { ProjectionPayload, ResultsPayload } from '../src/lib/types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const election = JSON.parse(readFileSync(resolve(root, 'data-pipeline/election.json'), 'utf-8'));
const path = resolve(root, `public/data/results_${election.cycle}.json`);

describe.runIf(existsSync(path))(`results_${election.cycle}.json`, () => {
  const results = JSON.parse(readFileSync(path, 'utf-8')) as ResultsPayload;
  const projection = JSON.parse(
    readFileSync(resolve(root, 'public/data/projection.json'), 'utf-8'),
  ) as ProjectionPayload;

  it('names its cycle and every state once', () => {
    expect(results.meta.cycle).toBe(election.cycle);
    expect(results.states).toHaveLength(50);
    expect(new Set(results.states.map((s) => s.code)).size).toBe(50);
  });

  it('carries the fields the results view reads, with the documented nullability', () => {
    for (const s of results.states) {
      expect(['pending', 'provisional', 'certified']).toContain(s.status);
      const ae = s.as_elected;
      expect(ae.d_seats + ae.r_seats + ae.other_seats + ae.uncalled_seats).toBe(s.seats);
      if (s.status === 'pending') {
        expect(s.under_pr).toBeNull();
        expect(s.two_party_share).toBeNull();
      } else {
        expect(s.under_pr!.d_seats + s.under_pr!.r_seats).toBe(s.seats);
        expect(typeof s.source_url).toBe('string');
        expect(Number.isNaN(Date.parse(s.as_of ?? ''))).toBe(false);
      }
    }
  });

  it('adds up nationally', () => {
    const n = results.national;
    expect(n.under_pr.d_seats + n.under_pr.r_seats + n.under_pr.pending_seats).toBe(435);
    expect(n.as_elected.d_seats + n.as_elected.r_seats + n.as_elected.other_seats + n.as_elected.uncalled_seats).toBe(435);
    expect(results.meta.seats_called).toBe(435 - n.as_elected.uncalled_seats);
  });

  it('never ships rehearsal data', () => {
    expect(results.meta.rehearsal).toBe(false);
  });

  it('adapts into the map payload: every state, pending ones flagged', () => {
    const p = resultsToProjectionPayload(results, projection);
    expect(p.states).toHaveLength(50);
    expect(p.states.filter(isReporting)).toHaveLength(results.states.filter((s) => s.under_pr).length);
  });
});
