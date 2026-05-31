import { describe, expect, it } from 'vitest';
import { GLOSSARY } from './glossary';

describe('glossary', () => {
  it('every entry has a term and a substantive definition', () => {
    for (const [slug, entry] of Object.entries(GLOSSARY)) {
      expect(entry.term, slug).toBeTruthy();
      // Guards the METHOD_DESCRIPTIONS reuse: a one-sentence def, never empty.
      expect(entry.short.length, slug).toBeGreaterThan(20);
    }
  });
});
