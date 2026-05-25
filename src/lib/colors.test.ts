import { describe, expect, it } from 'vitest';
import { pluralityColor, topMinorWithSeats } from './colors';

describe('topMinorWithSeats', () => {
  // Mini party fixtures — the helper only inspects party.id and seats.
  const D = { party: { id: 'D' }, seats: 0 };
  const R = { party: { id: 'R' }, seats: 0 };
  const PROG = { party: { id: 'PROG' }, seats: 0 };
  const AF = { party: { id: 'AF' }, seats: 0 };

  it('returns null when no minor has any seats', () => {
    expect(topMinorWithSeats([{ ...D, seats: 5 }, { ...R, seats: 5 }])).toBeNull();
  });

  it('returns null when minors are present but all at zero seats', () => {
    expect(topMinorWithSeats([
      { ...D, seats: 5 },
      { ...R, seats: 4 },
      { ...PROG, seats: 0 },
      { ...AF, seats: 0 },
    ])).toBeNull();
  });

  it('returns the lone minor with seats', () => {
    const result = topMinorWithSeats([
      { ...D, seats: 7 },
      { ...R, seats: 4 },
      { ...PROG, seats: 2 },
    ]);
    expect(result?.party.id).toBe('PROG');
    expect(result?.seats).toBe(2);
  });

  it('returns the minor with the most seats when multiple minors compete', () => {
    const result = topMinorWithSeats([
      { ...D, seats: 5 },
      { ...R, seats: 4 },
      { ...PROG, seats: 1 },
      { ...AF, seats: 3 },
    ]);
    expect(result?.party.id).toBe('AF');
    expect(result?.seats).toBe(3);
  });

  it('breaks ties by input order (PROG before AF)', () => {
    const result = topMinorWithSeats([
      { ...D, seats: 5 },
      { ...R, seats: 4 },
      { ...PROG, seats: 2 },
      { ...AF, seats: 2 },
    ]);
    expect(result?.party.id).toBe('PROG');
  });

  it('ignores D and R even if they have the most seats', () => {
    // Confirms major-party exclusion isn't sensitive to majors leading.
    const result = topMinorWithSeats([
      { ...D, seats: 30 },
      { ...R, seats: 18 },
      { ...PROG, seats: 1 },
    ]);
    expect(result?.party.id).toBe('PROG');
  });

  it('respects a custom majorIds set', () => {
    // Treat PROG as a "major" too — then only AF would qualify.
    const result = topMinorWithSeats(
      [
        { ...D, seats: 5 },
        { ...R, seats: 4 },
        { ...PROG, seats: 3 },
        { ...AF, seats: 1 },
      ],
      new Set(['D', 'R', 'PROG']),
    );
    expect(result?.party.id).toBe('AF');
  });
});

describe('pluralityColor', () => {
  it('returns the color of the party with most seats', () => {
    expect(pluralityColor([
      { color: '#blue', seats: 7 },
      { color: '#red', seats: 4 },
    ])).toBe('#blue');
  });

  it('returns the neutral gray on ties', () => {
    expect(pluralityColor([
      { color: '#blue', seats: 5 },
      { color: '#red', seats: 5 },
    ])).toBe('rgb(240, 240, 240)');
  });

  it('handles an empty array gracefully', () => {
    expect(pluralityColor([])).toBe('rgb(240, 240, 240)');
  });
});
