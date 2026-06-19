import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { allocateByMethod, type AllocationMethodKind, type MethodAllocationInput } from '../src/lib/methods';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePath = resolve(__dirname, 'fixtures/method_cases.json');

interface FixtureCase {
  name: string;
  input: MethodAllocationInput;
  expected: Record<string, number[]>;
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
  methods: AllocationMethodKind[];
  cases: FixtureCase[];
};

// The fixture's expected values are generated from data-pipeline/methods.py.
// If TS and Python diverge (e.g. the Math.round vs banker's-rounding hazard in
// MMP), these assertions fail — that's the cross-language parity guard.
describe('MMD/MMP Python↔TS parity fixture', () => {
  for (const c of fixture.cases) {
    for (const method of fixture.methods) {
      it(`${c.name} — ${method}`, () => {
        expect(allocateByMethod(c.input, method)).toEqual(c.expected[method]);
      });
    }
  }
});
