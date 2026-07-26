import { describe, it, expect } from 'vitest';
import { normalizeFormat, normalizeTournamentFormat, FORMATS, PARAGON_EXCLUDED_SETS } from '../formats';
import { CARDS } from '../cards/lookup';
import { matchesBanListEntry } from '@/utils/deckcheck/rules';

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
  it('only Limited has a populated ban list; Unlimited/T2/Paragon stay empty by design', () => {
    expect(FORMATS.Limited.banList.length).toBe(8);
    expect(FORMATS.Unlimited.banList).toEqual([]);
    expect(FORMATS.T2.banList).toEqual([]);
    expect(FORMATS.Paragon.banList).toEqual([]);
  });
  it('paragon excluded sets carried over', () => {
    expect(PARAGON_EXCLUDED_SETS.has('Cloud of Witnesses')).toBe(true);
    expect(PARAGON_EXCLUDED_SETS.has('Roots 2')).toBe(false);
  });
});

// ===========================================================================
// Regression guard: every Limited banList entry must match a REAL row in the
// generated card database. This is the direct lesson from the old dead
// BANNED_CARDS list (deleted in Task 2), whose entries keyed on full set
// names that never appeared in ResolvedCard.set (TSV codes) and so matched
// nothing. If this test ever fails, the ban list has drifted from the actual
// card data — fix the entry, don't loosen the matcher.
// ===========================================================================
describe('FORMATS.Limited.banList matches real card rows', () => {
  it.each(FORMATS.Limited.banList)('$note matches at least one row in CARDS', (entry) => {
    const matches = CARDS.filter((card) => matchesBanListEntry(card, entry));
    expect(matches.length).toBeGreaterThan(0);
  });

  it('the reference entry matches both Lost Souls printings (Two Liner and Three Liner)', () => {
    const refEntry = FORMATS.Limited.banList.find((e) => e.reference === 'Proverbs 22:14');
    expect(refEntry).toBeDefined();
    const matches = CARDS.filter((card) => matchesBanListEntry(card, refEntry!));
    const names = matches.map((c) => c.name);
    expect(names).toContain('Lost Souls (Two Liner)');
    expect(names).toContain('Lost Souls (Three Liner)');
  });

  it('covers exactly the 9 known Banned-legality rows (7 name+set + 2 via reference)', () => {
    const bannedRows = CARDS.filter((c) => c.legality === 'Banned');
    expect(bannedRows.length).toBe(9);
    for (const row of bannedRows) {
      const matched = FORMATS.Limited.banList.some((entry) => matchesBanListEntry(row, entry));
      expect(matched, `expected a banList entry to match "${row.name}" (${row.set})`).toBe(true);
    }
  });
});
