import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { allocate, AllocationMethod } from '../src/lib/allocation';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePath = resolve(__dirname, 'fixtures/allocation_cases.json');

interface FixtureCase {
  name: string;
  input: { seats: number; d_votes: number; r_votes: number };
  expected: Record<AllocationMethod, { d_seats: number; r_seats: number }>;
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as { cases: FixtureCase[] };
const methods: AllocationMethod[] = ['sainte-lague', 'dhondt', 'hamilton'];

describe('allocation parity fixture', () => {
  for (const c of fixture.cases) {
    for (const method of methods) {
      it(`${c.name} — ${method}`, () => {
        const result = allocate(c.input, method);
        expect(result).toEqual(c.expected[method]);
      });
    }
  }
});
