import { describe, it, expect } from 'vitest';
import { fnv1a32, mulberry32, rngForRound } from '../rng';

describe('fnv1a32', () => {
  it('returns 0 hash for empty string', () => {
    expect(fnv1a32('')).toBe(2166136261);
  });

  it('produces stable hashes', () => {
    expect(fnv1a32('hello')).toBe(fnv1a32('hello'));
    expect(fnv1a32('hello')).not.toBe(fnv1a32('world'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = fnv1a32('some-tournament-id:3');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
    expect(Number.isInteger(h)).toBe(true);
  });
});

describe('mulberry32', () => {
  it('returns values in [0, 1)', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces identical sequences for the same seed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });
});

describe('rngForRound', () => {
  it('produces identical sequences for the same (tournamentId, round)', () => {
    const a = rngForRound('tournament-abc', 3);
    const b = rngForRound('tournament-abc', 3);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });

  it('produces different sequences for different rounds', () => {
    const r1 = rngForRound('t', 1);
    const r2 = rngForRound('t', 2);
    expect(r1()).not.toBe(r2());
  });

  it('produces different sequences for different tournaments', () => {
    const a = rngForRound('tournament-a', 1);
    const b = rngForRound('tournament-b', 1);
    expect(a()).not.toBe(b());
  });
});
