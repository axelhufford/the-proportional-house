import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  allocateByMethod,
  type AllocationMethodKind,
  type MethodAllocationInput,
  type MethodParams,
} from '../src/lib/methods';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePath = resolve(__dirname, 'fixtures/method_cases.json');

/** Slider overrides, stored snake_case in the fixture so Python can read it too. */
interface FixtureParams {
  mmd_magnitude?: number;
  mmp_smd_share?: number;
}

interface FixtureCase {
  name: string;
  input: MethodAllocationInput;
  params?: FixtureParams;
  expected: Record<string, number[]>;
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
  methods: AllocationMethodKind[];
  cases: FixtureCase[];
};

function toParams(p: FixtureParams | undefined): MethodParams | undefined {
  if (!p) return undefined;
  return { mmdMagnitude: p.mmd_magnitude, mmpSmdShare: p.mmp_smd_share };
}

// The fixture's expected values are generated from data-pipeline/methods.py by
// data-pipeline/generate_parity_fixtures.py. If TS and Python diverge (e.g. the
// Math.round vs banker's-rounding hazard in MMP, or an epsilon-vs-exact
// quotient comparison), these assertions fail — that's the parity guard.
describe('MMD/MMP Python↔TS parity fixture', () => {
  for (const c of fixture.cases) {
    for (const method of fixture.methods) {
      it(`${c.name} — ${method}`, () => {
        expect(allocateByMethod(c.input, method, toParams(c.params))).toEqual(
          c.expected[method],
        );
      });
    }
  }
});

// Python's test_methods.py has always asserted this; the TS side did not, which
// is why MMP could silently return 5 seats for a 10-seat state whose actual
// delegation was 0-0 without any test noticing.
describe('every method allocates exactly total_seats', () => {
  for (const c of fixture.cases) {
    for (const method of fixture.methods) {
      it(`${c.name} — ${method}`, () => {
        const seats = allocateByMethod(c.input, method, toParams(c.params));
        expect(seats.reduce((a, b) => a + b, 0)).toBe(c.input.total_seats);
        expect(seats.every((s) => Number.isInteger(s) && s >= 0)).toBe(true);
      });
    }
  }
});
