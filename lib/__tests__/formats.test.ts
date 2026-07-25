import { describe, it, expect } from 'vitest';
import { normalizeFormat, normalizeTournamentFormat, FORMATS, PARAGON_EXCLUDED_SETS } from '../formats';

describe('normalizeFormat', () => {
  it.each([
    ['Type 1', 'Limited'], ['T1', 'Limited'], ['type 1', 'Limited'],
    [null, 'Limited'], [undefined, 'Limited'], ['', 'Limited'], ['Limited', 'Limited'],
    ['Type 2', 'T2'], ['t2', 'T2'], ['T2', 'T2'], ['Type 2 - 2 Player', 'T2'], ['type2_2player', 'T2'],
    ['Unlimited', 'Unlimited'], ['Type 1 Unlimited', 'Unlimited'], ['Classic', 'Unlimited'], ['classic', 'Unlimited'],
    ['Paragon', 'Paragon'], ['Paragon Type 1', 'Paragon'], ['paragon', 'Paragon'],
    ['Type 1 Limited', 'Limited'], ['Single', 'Limited'],
  ])('maps %j to %s', (input, expected) => {
    expect(normalizeFormat(input as string | null | undefined)).toBe(expected);
  });
});

describe('normalizeTournamentFormat', () => {
  it.each([
    [null, null], ['', null], ['Other', 'Other'],
    ['Booster Draft (GoC x3)', 'Other'], ['Sealed Deck', 'Other'],
    ['T1', 'Limited'], ['Type 1', 'Limited'], ['Type 1 Unlimited', 'Unlimited'],
    ['T2', 'T2'], ['Type 2', 'T2'], ['Paragon', 'Paragon'],
  ])('maps %j to %j', (input, expected) => {
    expect(normalizeTournamentFormat(input as string | null | undefined)).toBe(expected);
  });
});

describe('FORMATS registry', () => {
  it('has the spec sizes', () => {
    expect(FORMATS.Limited.main).toEqual({ min: 50, max: 70 });
    expect(FORMATS.Unlimited.main).toEqual({ min: 50, max: 70 });
    expect(FORMATS.T2.main).toEqual({ min: 100, max: 140 });
    expect(FORMATS.T2.reserveMax).toBe(20);
    expect(FORMATS.Paragon.main).toEqual({ min: 40, max: 40 });
    expect(FORMATS.Limited.reserveMax).toBe(10);
    expect(FORMATS.Unlimited.pool).toBe('all');
  });
  it('all ban lists start empty', () => {
    for (const def of Object.values(FORMATS)) expect(def.banList).toEqual([]);
  });
  it('paragon excluded sets carried over', () => {
    expect(PARAGON_EXCLUDED_SETS.has('Cloud of Witnesses')).toBe(true);
    expect(PARAGON_EXCLUDED_SETS.has('Roots 2')).toBe(false);
  });
});
