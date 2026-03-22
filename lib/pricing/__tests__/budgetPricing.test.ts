import { describe, it, expect } from 'vitest';
import {
  normalizeAbility,
  buildCardNameIndex,
  findCheapestEquivalent,
} from '../budgetPricing';
import type { BudgetCard } from '../budgetPricing';
import type { DuplicateGroupIndex, DuplicateGroup, DuplicateSibling } from '../../duplicateCards';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCard(overrides: Partial<BudgetCard> & Pick<BudgetCard, 'name' | 'set'>): BudgetCard {
  return {
    imgFile: `${overrides.name}-img.jpg`,
    specialAbility: '',
    ...overrides,
  };
}

function cardKey(card: BudgetCard): string {
  return `${card.name}|${card.set}|${card.imgFile}`;
}

/** Build a minimal DuplicateGroupIndex from an array of groups */
function buildDupIndex(groups: DuplicateGroup[]): DuplicateGroupIndex {
  const byExact = new Map<string, DuplicateGroup[]>();
  const byNormalized = new Map<string, DuplicateGroup[]>();

  function addToMap(map: Map<string, DuplicateGroup[]>, key: string, group: DuplicateGroup) {
    const existing = map.get(key);
    if (existing) {
      if (!existing.includes(group)) existing.push(group);
    } else {
      map.set(key, [group]);
    }
  }

  for (const group of groups) {
    addToMap(byExact, group.canonicalName, group);
    addToMap(byNormalized, group.canonicalName.toLowerCase(), group);
    for (const member of group.members) {
      addToMap(byExact, member.cardName, group);
      addToMap(byNormalized, member.cardName.toLowerCase(), group);
    }
  }

  return { groups, byExact, byNormalized };
}

function makeSibling(cardName: string): DuplicateSibling {
  return { cardName, ordirSets: '', matched: true };
}

// ---------------------------------------------------------------------------
// normalizeAbility
// ---------------------------------------------------------------------------

describe('normalizeAbility', () => {
  it('lowercases text', () => {
    expect(normalizeAbility('Heal one Hero')).toBe('heal one hero');
  });

  it('collapses and trims whitespace', () => {
    expect(normalizeAbility('  heal   one  hero  ')).toBe('heal one hero');
  });

  it('normalizes smart single quotes', () => {
    // \u2018 and \u2019 → '
    expect(normalizeAbility('\u2018don\u2019t\u2019')).toBe("'don't'");
  });

  it('normalizes smart double quotes', () => {
    // \u201c and \u201d → "
    expect(normalizeAbility('\u201chello\u201d')).toBe('"hello"');
  });

  it('normalizes em dash and en dash to hyphen', () => {
    expect(normalizeAbility('a\u2014b')).toBe('a-b');
    expect(normalizeAbility('a\u2013b')).toBe('a-b');
  });

  it('handles empty string', () => {
    expect(normalizeAbility('')).toBe('');
  });

  it('handles combination of transformations', () => {
    const input = '  Heal\u2014\u201cheaven\u2019s gate\u201d  ';
    expect(normalizeAbility(input)).toBe('heal-"heaven\'s gate"');
  });
});

// ---------------------------------------------------------------------------
// findCheapestEquivalent
// ---------------------------------------------------------------------------

describe('findCheapestEquivalent', () => {
  it('returns own price when card has no sibling group', () => {
    const card = makeCard({ name: 'Lone Card', set: 'A', specialAbility: 'do stuff' });
    const allCards = [card];
    const dupIndex = buildDupIndex([]);
    const prices = new Map([[cardKey(card), 2.5]]);
    const getPrice = (key: string) => prices.get(key) ?? null;

    const result = findCheapestEquivalent(card, allCards, dupIndex, getPrice);

    expect(result.ownPrice).toBe(2.5);
    expect(result.cheapestPrice).toBe(2.5);
    expect(result.cheapestCardKey).toBe(cardKey(card));
  });

  it('finds cheaper sibling with same ability', () => {
    const card = makeCard({ name: 'Angel (Pr)', set: 'Pr', specialAbility: 'protect hero' });
    const sibling = makeCard({ name: 'Angel (CoW)', set: 'CoW', specialAbility: 'protect hero' });
    const allCards = [card, sibling];

    const group: DuplicateGroup = {
      canonicalName: 'Angel',
      members: [makeSibling('Angel (Pr)'), makeSibling('Angel (CoW)')],
    };
    const dupIndex = buildDupIndex([group]);

    const prices = new Map([
      [cardKey(card), 5.0],
      [cardKey(sibling), 1.5],
    ]);
    const getPrice = (key: string) => prices.get(key) ?? null;

    const result = findCheapestEquivalent(card, allCards, dupIndex, getPrice);

    expect(result.ownPrice).toBe(5.0);
    expect(result.cheapestPrice).toBe(1.5);
    expect(result.cheapestCardKey).toBe(cardKey(sibling));
  });

  it('ignores sibling with different ability', () => {
    const card = makeCard({ name: 'Angel (Pr)', set: 'Pr', specialAbility: 'protect hero' });
    const sibling = makeCard({ name: 'Angel (CoW)', set: 'CoW', specialAbility: 'different ability text' });
    const allCards = [card, sibling];

    const group: DuplicateGroup = {
      canonicalName: 'Angel',
      members: [makeSibling('Angel (Pr)'), makeSibling('Angel (CoW)')],
    };
    const dupIndex = buildDupIndex([group]);

    const prices = new Map([
      [cardKey(card), 5.0],
      [cardKey(sibling), 0.5],
    ]);
    const getPrice = (key: string) => prices.get(key) ?? null;

    const result = findCheapestEquivalent(card, allCards, dupIndex, getPrice);

    expect(result.ownPrice).toBe(5.0);
    // sibling is filtered out — only own card qualifies
    expect(result.cheapestPrice).toBe(5.0);
    expect(result.cheapestCardKey).toBe(cardKey(card));
  });

  it('returns nulls when no prices exist for card or siblings', () => {
    const card = makeCard({ name: 'Angel (Pr)', set: 'Pr', specialAbility: 'protect hero' });
    const sibling = makeCard({ name: 'Angel (CoW)', set: 'CoW', specialAbility: 'protect hero' });
    const allCards = [card, sibling];

    const group: DuplicateGroup = {
      canonicalName: 'Angel',
      members: [makeSibling('Angel (Pr)'), makeSibling('Angel (CoW)')],
    };
    const dupIndex = buildDupIndex([group]);

    const getPrice = (_key: string) => null;

    const result = findCheapestEquivalent(card, allCards, dupIndex, getPrice);

    expect(result.ownPrice).toBeNull();
    expect(result.cheapestPrice).toBeNull();
    expect(result.cheapestCardKey).toBeNull();
  });

  it('returns nulls when card is unpriced and sibling has different ability', () => {
    const card = makeCard({ name: 'Angel (Pr)', set: 'Pr', specialAbility: 'protect hero' });
    const sibling = makeCard({ name: 'Angel (CoW)', set: 'CoW', specialAbility: 'a completely different ability' });
    const allCards = [card, sibling];

    const group: DuplicateGroup = {
      canonicalName: 'Angel',
      members: [makeSibling('Angel (Pr)'), makeSibling('Angel (CoW)')],
    };
    const dupIndex = buildDupIndex([group]);

    const prices = new Map([[cardKey(sibling), 3.0]]);
    const getPrice = (key: string) => prices.get(key) ?? null;

    const result = findCheapestEquivalent(card, allCards, dupIndex, getPrice);

    expect(result.ownPrice).toBeNull();
    expect(result.cheapestPrice).toBeNull();
    expect(result.cheapestCardKey).toBeNull();
  });

  it('finds sibling price when card is unpriced but same-ability sibling is priced', () => {
    const card = makeCard({ name: 'Angel (Pr)', set: 'Pr', specialAbility: 'protect hero' });
    const sibling = makeCard({ name: 'Angel (CoW)', set: 'CoW', specialAbility: 'protect hero' });
    const allCards = [card, sibling];

    const group: DuplicateGroup = {
      canonicalName: 'Angel',
      members: [makeSibling('Angel (Pr)'), makeSibling('Angel (CoW)')],
    };
    const dupIndex = buildDupIndex([group]);

    const prices = new Map([[cardKey(sibling), 2.0]]);
    const getPrice = (key: string) => prices.get(key) ?? null;

    const result = findCheapestEquivalent(card, allCards, dupIndex, getPrice);

    expect(result.ownPrice).toBeNull();
    expect(result.cheapestPrice).toBe(2.0);
    expect(result.cheapestCardKey).toBe(cardKey(sibling));
  });

  it('treats two cards with empty specialAbility as equivalent', () => {
    const card = makeCard({ name: 'Soldier (Pr)', set: 'Pr', specialAbility: '' });
    const sibling = makeCard({ name: 'Soldier (CoW)', set: 'CoW', specialAbility: '' });
    const allCards = [card, sibling];

    const group: DuplicateGroup = {
      canonicalName: 'Soldier',
      members: [makeSibling('Soldier (Pr)'), makeSibling('Soldier (CoW)')],
    };
    const dupIndex = buildDupIndex([group]);

    const prices = new Map([
      [cardKey(card), 4.0],
      [cardKey(sibling), 0.75],
    ]);
    const getPrice = (key: string) => prices.get(key) ?? null;

    const result = findCheapestEquivalent(card, allCards, dupIndex, getPrice);

    expect(result.ownPrice).toBe(4.0);
    expect(result.cheapestPrice).toBe(0.75);
    expect(result.cheapestCardKey).toBe(cardKey(sibling));
  });

  it('produces same result with cardNameIndex as without', () => {
    const card = makeCard({ name: 'Angel (Pr)', set: 'Pr', specialAbility: 'protect hero' });
    const sibling = makeCard({ name: 'Angel (CoW)', set: 'CoW', specialAbility: 'protect hero' });
    const allCards = [card, sibling];

    const group: DuplicateGroup = {
      canonicalName: 'Angel',
      members: [makeSibling('Angel (Pr)'), makeSibling('Angel (CoW)')],
    };
    const dupIndex = buildDupIndex([group]);

    const prices = new Map([
      [cardKey(card), 5.0],
      [cardKey(sibling), 1.5],
    ]);
    const getPrice = (key: string) => prices.get(key) ?? null;

    const cardNameIndex = buildCardNameIndex(allCards);

    const withoutIndex = findCheapestEquivalent(card, allCards, dupIndex, getPrice);
    const withIndex = findCheapestEquivalent(card, allCards, dupIndex, getPrice, cardNameIndex);

    expect(withIndex.ownPrice).toBe(withoutIndex.ownPrice);
    expect(withIndex.cheapestPrice).toBe(withoutIndex.cheapestPrice);
    expect(withIndex.cheapestCardKey).toBe(withoutIndex.cheapestCardKey);
  });
});
