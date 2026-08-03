/**
 * Contract test for the public /api/v1 responses, run against the REAL
 * committed payloads in public/data.
 *
 * src/lib/apiShape.test.ts exercises `toApiV1` with a hand-written literal that
 * satisfies `ProjectionPayload` by construction, so it can never notice the
 * pipeline drifting away from the TypeScript types. That's the gap that
 * matters: `loadProjection` in functions/api/v1/_shared.ts does an unchecked
 * `as ProjectionPayload` cast, so if the pipeline renamed `meta.generated_at`,
 * `toApiV1` would emit `undefined`, `JSON.stringify` would silently DROP the
 * key, and the endpoint would return HTTP 200 with a payload missing a
 * documented required field. A sibling repo consumes this endpoint, so that
 * breakage would surface there with no signal here.
 *
 * These tests read the actual JSON the pipeline produced and assert the full
 * documented v1 shape.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  API_VERSION,
  toApiV1,
  toApiV1Csv,
  toApiV1History,
  type ApiV1Payload,
} from '../src/lib/apiShape';
import type { HistoryPayload, ProjectionPayload } from '../src/lib/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, '../public/data');

function load<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(dataDir, name), 'utf-8')) as T;
}

const projection = load<ProjectionPayload>('projection.json');
const history = load<HistoryPayload>('history.json');

/** Assert a key is present AND not undefined — JSON.stringify drops undefined. */
function requireKey(obj: Record<string, unknown>, key: string, path: string) {
  expect(Object.prototype.hasOwnProperty.call(obj, key), `${path}.${key} missing`).toBe(true);
  expect(obj[key], `${path}.${key} is undefined`).toBeDefined();
}

describe('/api/v1/projection.json against the real pipeline output', () => {
  const v1 = toApiV1(projection);

  it('survives a JSON round-trip with every documented key intact', () => {
    // The endpoint serializes with JSON.stringify, which silently omits any
    // key whose value is undefined. Round-tripping is the only way to catch
    // a field that the type system thinks exists but the data doesn't supply.
    const round = JSON.parse(JSON.stringify(v1)) as Record<string, unknown>;
    for (const key of ['api_version', 'generated_at', 'method', 'data_source', 'polling', 'national', 'states']) {
      requireKey(round, key, 'payload');
    }
  });

  it('reports the expected api_version', () => {
    expect(v1.api_version).toBe(API_VERSION);
  });

  it('has a parseable generated_at', () => {
    expect(typeof v1.generated_at).toBe('string');
    expect(Number.isNaN(Date.parse(v1.generated_at))).toBe(false);
  });

  it('has non-empty method and data_source strings', () => {
    // These two have no `??` fallback in toApiV1, unlike the polling fields —
    // so a pipeline rename drops them entirely rather than defaulting.
    expect(v1.method.length).toBeGreaterThan(0);
    expect(v1.data_source.length).toBeGreaterThan(0);
  });

  it('has a fully-populated polling block', () => {
    const p = v1.polling as unknown as Record<string, unknown>;
    for (const key of ['window_days', 'half_life_days', 'n_polls', 'generic_ballot_margin', 'baseline_2024_margin', 'swing']) {
      requireKey(p, key, 'polling');
      expect(Number.isFinite(p[key] as number), `polling.${key} not finite`).toBe(true);
    }
    expect(v1.polling.n_polls).toBeGreaterThan(0);
  });

  it('national seats total 435 and match the sum of states', () => {
    expect(v1.national.total_seats).toBe(435);
    expect(v1.national.actual.D + v1.national.actual.R).toBe(435);
    expect(v1.national.projected.D + v1.national.projected.R).toBe(435);

    const sumActualD = v1.states.reduce((s, x) => s + x.actual.D, 0);
    const sumProjD = v1.states.reduce((s, x) => s + x.projected.D, 0);
    expect(sumActualD).toBe(v1.national.actual.D);
    expect(sumProjD).toBe(v1.national.projected.D);
  });

  it('carries all 50 states, each internally consistent', () => {
    expect(v1.states).toHaveLength(50);
    for (const s of v1.states) {
      const rec = s as unknown as Record<string, unknown>;
      for (const key of [
        'code', 'name', 'fips', 'total_seats', 'actual', 'projected', 'swing',
        'vote_share_2024', 'vote_share_projected',
      ]) {
        requireKey(rec, key, `state ${s.code}`);
      }
      expect(s.code, `${s.name} code`).toMatch(/^[A-Z]{2}$/);
      expect(s.fips, `${s.code} fips`).toMatch(/^\d{2}$/);
      expect(s.actual.D + s.actual.R, `${s.code} actual`).toBe(s.total_seats);
      expect(s.projected.D + s.projected.R, `${s.code} projected`).toBe(s.total_seats);
      expect(s.swing, `${s.code} swing`).toBe(s.projected.D - s.actual.D);
      expect(s.vote_share_2024.D + s.vote_share_2024.R, `${s.code} 2024 shares`).toBeCloseTo(1, 2);
      expect(
        s.vote_share_projected.D + s.vote_share_projected.R,
        `${s.code} projected shares`,
      ).toBeCloseTo(1, 2);
    }
  });

  it('omits optional blocks rather than emitting null', () => {
    // Consumers branch on key presence, so `null` would be a breaking change.
    const round = JSON.parse(JSON.stringify(v1)) as Record<string, unknown>;
    for (const key of ['projected_range', 'majority', 'closest_flips']) {
      const nat = round.national as Record<string, unknown>;
      if (key in nat) expect(nat[key]).not.toBeNull();
    }
  });
});

describe('/api/v1/projection.csv against the real pipeline output', () => {
  const csv = toApiV1Csv(projection);
  const lines = csv.trim().split('\n');

  it('emits a header plus one row per state', () => {
    expect(lines).toHaveLength(51);
  });

  it('quotes any field containing a comma, quote, or newline', () => {
    for (const [i, line] of lines.entries()) {
      // Split on commas that are outside quotes; every field with a special
      // char must be quoted, or a consumer's parser silently shifts columns.
      const fields = line.match(/("([^"]|"")*"|[^,]*)/g)?.filter((_, idx) => idx % 2 === 0) ?? [];
      for (const f of fields) {
        if (/[,"\n\r]/.test(f) && !f.startsWith('"')) {
          throw new Error(`line ${i}: unquoted special char in field ${JSON.stringify(f)}`);
        }
      }
    }
  });

  it('has the same column count on every row', () => {
    const counts = new Set(lines.map((l) => (l.match(/,/g) ?? []).length));
    expect(counts.size, `ragged rows: ${[...counts].join(', ')}`).toBe(1);
  });
});

describe('/api/v1/history.json against the real pipeline output', () => {
  const v1 = toApiV1History(history);

  it('survives a JSON round-trip with its documented keys', () => {
    const round = JSON.parse(JSON.stringify(v1)) as Record<string, unknown>;
    for (const key of ['api_version', 'generated_at', 'total_seats', 'methods', 'points']) {
      requireKey(round, key, 'history');
    }
  });

  it('has ascending, unique, well-formed dates', () => {
    let last = '';
    const seen = new Set<string>();
    for (const p of v1.points) {
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(seen.has(p.date), `duplicate ${p.date}`).toBe(false);
      expect(p.date >= last, `out of order at ${p.date}`).toBe(true);
      seen.add(p.date);
      last = p.date;
    }
  });

  it('has every method on every point summing to total_seats', () => {
    for (const p of v1.points) {
      expect(Object.keys(p.seats).length, `${p.date} has no methods`).toBeGreaterThan(0);
      for (const [method, s] of Object.entries(p.seats)) {
        expect(s.D + s.R, `${p.date} ${method}`).toBe(v1.total_seats);
      }
      // PR is the documented always-present series.
      expect(p.seats.PR, `${p.date} missing PR`).toBeDefined();
    }
  });

  it('declares total_seats and the method list', () => {
    expect(v1.total_seats).toBe(435);
    expect(v1.methods).toContain('PR');
  });

  it('marks reconstructed points explicitly', () => {
    // ~96% of this series is a hindcast. The flag is how a consumer tells a
    // real forward snapshot from a reconstruction, so it must always be a
    // boolean — never absent, never undefined.
    for (const p of v1.points) {
      expect(typeof p.reconstructed, `reconstructed at ${p.date}`).toBe('boolean');
    }
  });
});

/**
 * Guards the v1 key set. A diff here is a public API change.
 *
 * Expressed as required ⊆ actual ⊆ (required ∪ optional) rather than an exact
 * snapshot: several v1 keys are deliberately omitted when the pipeline has no
 * value for them, so an exact-match assertion passes or fails depending on
 * which optional blocks happened to be present in whatever data was on disk.
 */
const REQUIRED_TOP_LEVEL = [
  'api_version',
  'data_source',
  'generated_at',
  'method',
  'national',
  'polling',
  'states',
];
/** Emitted only when the pipeline produces them (key omitted, never null). */
const OPTIONAL_TOP_LEVEL = ['closest_flips'];

describe('v1 shape is stable', () => {
  it('has every required top-level key', () => {
    const v1: ApiV1Payload = toApiV1(projection);
    const keys = Object.keys(v1);
    const missing = REQUIRED_TOP_LEVEL.filter((k) => !keys.includes(k));
    expect(missing, `missing required v1 keys: ${missing.join(', ')}`).toEqual([]);
  });

  it('emits no undocumented top-level key', () => {
    const v1: ApiV1Payload = toApiV1(projection);
    const known = new Set([...REQUIRED_TOP_LEVEL, ...OPTIONAL_TOP_LEVEL]);
    const unexpected = Object.keys(v1).filter((k) => !known.has(k));
    expect(
      unexpected,
      `undocumented keys in the v1 payload — adding one is a public API change ` +
        `and must be recorded in OPTIONAL_TOP_LEVEL here: ${unexpected.join(', ')}`,
    ).toEqual([]);
  });

  it('has every required key inside national', () => {
    const v1 = toApiV1(projection);
    const known = new Set([
      'total_seats', 'actual', 'projected', 'projected_range', 'majority_tipping',
    ]);
    for (const k of ['total_seats', 'actual', 'projected']) {
      expect(Object.keys(v1.national)).toContain(k);
    }
    const unexpected = Object.keys(v1.national).filter((k) => !known.has(k));
    expect(unexpected, `undocumented national keys: ${unexpected.join(', ')}`).toEqual([]);
  });

  it('state keys match the documented contract', () => {
    const v1 = toApiV1(projection);
    expect(Object.keys(v1.states[0]).sort()).toEqual(
      [
        'actual', 'code', 'fips', 'name', 'projected', 'swing', 'total_seats',
        'vote_share_2024', 'vote_share_projected',
      ].sort(),
    );
  });
});
