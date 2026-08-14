import { describe, it, expect } from 'vitest';
import { normalizeFormat, normalizeTournamentFormat, FORMATS, FORMAT_IDS, isBannedInFormat, PARAGON_EXCLUDED_SETS } from '../formats';
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
  it('carries a ban list per category, per DBR 2.0', () => {
    expect(FORMATS.Limited.banList.length).toBe(7);
    // "In Unlimited play, all cards are legal" — except Daniel, both printings.
    expect(FORMATS.Unlimited.banList.map((e) => e.name)).toEqual([
      'Daniel (CoW)',
      'Daniel (CoW AB)',
    ]);
    // T2 is Limited's list plus Harvest Time (both printings).
    expect(FORMATS.T2.banList.length).toBe(FORMATS.Limited.banList.length + 2);
    for (const entry of FORMATS.Limited.banList) {
      expect(FORMATS.T2.banList).toContainEqual(entry);
    }
    // Paragon governs its pool with excluded sets, not a ban list.
    expect(FORMATS.Paragon.banList).toEqual([]);
  });
  it('paragon excluded sets carried over', () => {
    expect(PARAGON_EXCLUDED_SETS.has('Cloud of Witnesses')).toBe(true);
    expect(PARAGON_EXCLUDED_SETS.has('Roots 2')).toBe(false);
  });
});

// ===========================================================================
// Regression guard: every banList entry must match a REAL row in the generated
// card database. This is the direct lesson from the old dead BANNED_CARDS list
// (deleted in Task 2), whose entries keyed on full set names that never
// appeared in ResolvedCard.set (TSV codes) and so matched nothing. If this
// test ever fails, the ban list has drifted from the actual card data — fix
// the entry, don't loosen the matcher.
// ===========================================================================
const ALL_BAN_ENTRIES = FORMAT_IDS.flatMap((id) =>
  FORMATS[id].banList.map((entry) => ({ format: id, entry })),
);

describe('ban list entries match real card rows', () => {
  it.each(ALL_BAN_ENTRIES)('$format: $entry.note matches at least one row in CARDS', ({ entry }) => {
    const matches = CARDS.filter((card) => matchesBanListEntry(card, entry));
    expect(matches.length).toBeGreaterThan(0);
  });
});

// What the card browser's "Banned" chip asks. Since DBR 2.0 the answer depends
// on the format, so the same card gives different answers.
describe('isBannedInFormat', () => {
  const cardRow = (name: string) => {
    const row = CARDS.find((c) => c.name === name);
    expect(row, `no card row named "${name}"`).toBeDefined();
    return row!;
  };

  it.each([
    ['Daniel (CoW)', { Limited: true, Unlimited: true, T2: true, Paragon: false }],
    ['Lost Soul "Imitate" [III John 1:11]', { Limited: true, Unlimited: false, T2: true, Paragon: false }],
    ['Harvest Time (GoC)', { Limited: false, Unlimited: false, T2: true, Paragon: false }],
    ['Ephesian Widow', { Limited: false, Unlimited: false, T2: false, Paragon: false }],
  ] as const)('%s', (name, expected) => {
    for (const id of FORMAT_IDS) {
      expect(isBannedInFormat(cardRow(name), id), `${name} in ${id}`).toBe(expected[id]);
    }
  });
});

// ===========================================================================
// DBR 2.0 decoupled the ban lists from the card data's legality flag. These
// guard the four cases where the two now disagree — each one is a card the
// app would rule on wrongly if an entry were dropped.
// ===========================================================================
describe('DBR 2.0 bans that the legality flag does not cover', () => {
  const bannedIn = (id: (typeof FORMAT_IDS)[number], name: string) =>
    FORMATS[id].banList.some((entry) => entry.name === name);

  it('bans the Imitate Lost Soul in Limited and T2, though both printings are Rotation-legal', () => {
    const printings = CARDS.filter((c) => c.name.startsWith('Lost Soul "Imitate" [III John 1:11]'));
    expect(printings.length).toBe(2);
    for (const card of printings) {
      expect(card.legality).toBe('Rotation');
      expect(FORMATS.Limited.banList.some((e) => matchesBanListEntry(card, e))).toBe(true);
      expect(FORMATS.T2.banList.some((e) => matchesBanListEntry(card, e))).toBe(true);
      // Unlimited bans Daniel only.
      expect(FORMATS.Unlimited.banList.some((e) => matchesBanListEntry(card, e))).toBe(false);
    }
  });

  it('bans Harvest Time in T2 only, not in Limited', () => {
    expect(bannedIn('T2', 'Harvest Time (GoC)')).toBe(true);
    expect(bannedIn('Limited', 'Harvest Time (GoC)')).toBe(false);
    // Imitating Evil shares III John 1:11 and the "Harvest" Lost Soul shares
    // John 4:35 — reference matching would sweep them in, so neither list may
    // use it.
    const harvestSoul = CARDS.find((c) => c.name === 'Lost Soul "Harvest" [John 4:35]');
    expect(harvestSoul).toBeDefined();
    expect(FORMATS.T2.banList.some((e) => matchesBanListEntry(harvestSoul!, e))).toBe(false);
    const imitatingEvil = CARDS.find((c) => c.name === 'Imitating Evil (RoJ)');
    expect(imitatingEvil).toBeDefined();
    expect(FORMATS.Limited.banList.some((e) => matchesBanListEntry(imitatingEvil!, e))).toBe(false);
  });

  it('bans Daniel in Unlimited, where the all-cards pool would otherwise allow it', () => {
    const daniel = CARDS.find((c) => c.name === 'Daniel (CoW)');
    expect(daniel).toBeDefined();
    expect(FORMATS.Unlimited.pool).toBe('all');
    expect(FORMATS.Unlimited.banList.some((e) => matchesBanListEntry(daniel!, e))).toBe(true);
  });

  it('leaves Ephesian Widow unbanned everywhere and in the Limited pool', () => {
    const widow = CARDS.find((c) => c.name === 'Ephesian Widow');
    expect(widow).toBeDefined();
    // Unbanned by 2.0; the lookup layer's legality override is what actually
    // puts it back in the rotation pool (upstream data still says Banned).
    expect(widow!.legality).toBe('Rotation');
    for (const id of FORMAT_IDS) {
      expect(FORMATS[id].banList.some((e) => matchesBanListEntry(widow!, e))).toBe(false);
    }
  });

  it('keeps Samuel (RoA) and the Proverbs 22:14 souls out via the pool, not the ban list', () => {
    const rows = CARDS.filter((c) =>
      ['Samuel (RoA)', 'Lost Souls (Two Liner)', 'Lost Souls (Three Liner)'].includes(c.name),
    );
    expect(rows.length).toBe(3);
    for (const row of rows) {
      // Still flagged in the card data, so the rotation pool test excludes
      // them from Limited/T2 — but no longer named on any ban list.
      expect(row.legality).toBe('Banned');
      for (const id of FORMAT_IDS) {
        expect(FORMATS[id].banList.some((e) => matchesBanListEntry(row, e))).toBe(false);
      }
    }
  });
});
