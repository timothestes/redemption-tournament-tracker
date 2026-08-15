import { describe, it, expect } from 'vitest';
import {
  buildBreakdown,
  splitBrigades,
  type BreakdownDeckInput,
} from '../breakdown';
import { topCutSize } from '../topCut';

function deck(
  deckId: string,
  place: number | null,
  cards: [name: string, zone: string, quantity: number][],
): BreakdownDeckInput {
  return {
    deckId,
    playerName: deckId,
    place,
    cards: cards.map(([name, zone, quantity]) => ({
      name,
      set: null,
      imgFile: null,
      quantity,
      zone,
    })),
  };
}

describe('splitBrigades', () => {
  it('splits a multi-brigade card into every colour it names', () => {
    expect(splitBrigades('Green/Gold').sort()).toEqual(['Gold', 'Green']);
  });

  it('treats a parenthesised qualifier as commentary, not a second brigade', () => {
    expect(splitBrigades('Gold (Green)')).toEqual(['Gold']);
  });

  it('falls back to the parenthesised content when nothing else is printed', () => {
    expect(splitBrigades('(Gold/Red)').sort()).toEqual(['Gold', 'Red']);
  });

  it('handles "and" as a separator', () => {
    expect(splitBrigades('Purple and Black').sort()).toEqual(['Black', 'Purple']);
  });

  it('returns nothing for a card with no brigade', () => {
    expect(splitBrigades('')).toEqual([]);
    expect(splitBrigades(undefined)).toEqual([]);
  });

  // The printed strings are messier than "Green/Gold". Each of these appears in
  // the card index and each produced a bogus brigade before the split widened.
  it('splits on "+"', () => {
    expect(splitBrigades('Black/Crimson+Gold').sort()).toEqual(['Black', 'Crimson', 'Gold']);
  });

  it('keeps two-word brigade names whole', () => {
    expect(splitBrigades('Brown/Pale Green').sort()).toEqual(['Brown', 'Pale Green']);
  });

  it('reads "Good Gold" as Gold rather than an alignment plus a brigade', () => {
    expect(splitBrigades('Good Gold')).toEqual(['Gold']);
  });

  it('splits a space-joined run of brigades', () => {
    expect(splitBrigades('Green/Teal Gold/Pale Green').sort()).toEqual([
      'Gold',
      'Green',
      'Pale Green',
      'Teal',
    ]);
  });

  it('drops tokens that do not name a brigade', () => {
    expect(splitBrigades('Good')).toEqual([]);
    expect(splitBrigades('Crimson and White/Purple').sort()).toEqual([
      'Crimson',
      'Purple',
      'White',
    ]);
  });
});

describe('topCutSize', () => {
  it('reads a value below 1 as a fraction of the field', () => {
    expect(topCutSize(62, 0.25)).toBe(16);
  });

  it('reads a value of 1 or more as a deck count', () => {
    expect(topCutSize(62, 8)).toBe(8);
  });

  it('never exceeds the field', () => {
    expect(topCutSize(6, 8)).toBe(6);
  });
});

describe('buildBreakdown', () => {
  it('counts a deck once per card however many copies it runs', () => {
    const result = buildBreakdown([
      deck('a', 1, [['Angel of the Lord (J)', 'main', 3]]),
      deck('b', 2, [['Angel of the Lord (J)', 'main', 1]]),
    ]);
    const card = result.cards.find((c) => c.name === 'Angel of the Lord');
    expect(card?.deckIndexes).toHaveLength(2);
    expect(card?.copies).toBe(4);
  });

  it('merges printings of one card into a single row', () => {
    const result = buildBreakdown([
      deck('a', 1, [['Son of God (J)', 'main', 1]]),
      deck('b', 2, [['Son of God [Fundraiser]', 'main', 1]]),
      deck('c', 3, [['Son of God "Manger" (Promo)', 'main', 1]]),
    ]);
    const sonOfGod = result.cards.filter((c) => c.name === 'Son of God');
    expect(sonOfGod).toHaveLength(1);
    expect(sonOfGod[0].deckIndexes).toHaveLength(3);
    expect(sonOfGod[0].printings).toHaveLength(3);
  });

  it('splits main and reserve copies of the same card', () => {
    const result = buildBreakdown([
      deck('a', 1, [
        ['Foreign Wives', 'main', 1],
        ['Foreign Wives', 'reserve', 2],
      ]),
    ]);
    const card = result.cards.find((c) => c.name === 'Foreign Wives');
    expect(card?.mainCopies).toBe(1);
    expect(card?.reserveCopies).toBe(2);
    expect(card?.reserveDecks).toBe(1);
    // Still one deck, not two.
    expect(card?.deckIndexes).toEqual([0]);
  });

  it('ignores the maybeboard, which is never part of a submitted list', () => {
    const result = buildBreakdown([
      deck('a', 1, [
        ['Angel of the Lord (J)', 'main', 1],
        ['The Second Coming', 'maybeboard', 1],
      ]),
    ]);
    expect(result.cards.map((c) => c.name)).toEqual(['Angel of the Lord']);
    expect(result.decks[0].mainSize).toBe(1);
  });

  it('scores spice from cards no other deck played', () => {
    const result = buildBreakdown([
      // Two shared cards, one card only this deck plays.
      deck('a', 1, [
        ['Angel of the Lord (J)', 'main', 1],
        ['The Second Coming', 'main', 1],
        ['Three Woes (RoJ)', 'main', 1],
      ]),
      deck('b', 2, [
        ['Angel of the Lord (J)', 'main', 1],
        ['The Second Coming', 'main', 1],
      ]),
    ]);
    const a = result.decks.find((d) => d.deckId === 'a');
    const b = result.decks.find((d) => d.deckId === 'b');
    expect(a?.uniqueCards).toBe(1);
    expect(a?.spice).toBeCloseTo(1 / 3);
    expect(b?.uniqueCards).toBe(0);
    expect(b?.spice).toBe(0);
  });

  it('ranks nearest neighbours by shared-card overlap', () => {
    const result = buildBreakdown([
      deck('a', 1, [
        ['Angel of the Lord (J)', 'main', 1],
        ['The Second Coming', 'main', 1],
      ]),
      // Identical to a.
      deck('b', 2, [
        ['Angel of the Lord (J)', 'main', 1],
        ['The Second Coming', 'main', 1],
      ]),
      // Shares nothing.
      deck('c', 3, [['Three Woes (RoJ)', 'main', 1]]),
    ]);
    const a = result.decks.find((d) => d.deckId === 'a');
    expect(a?.neighbors[0].deckId).toBe('b');
    expect(a?.neighbors[0].similarity).toBe(1);
    expect(a?.neighbors[a.neighbors.length - 1].similarity).toBe(0);
  });

  it('counts a multi-brigade card toward each of its brigades', () => {
    // A Royal Priesthood is Green/Purple/Teal — one card, three brigades.
    const result = buildBreakdown([deck('a', 1, [['A Royal Priesthood', 'main', 2]])]);
    expect(result.brigades.map((b) => b.label).sort()).toEqual(['Green', 'Purple', 'Teal']);
    for (const brigade of result.brigades) {
      expect(brigade.decks).toBe(1);
      expect(brigade.copies).toBe(2);
    }
  });

  it('leaves a brigade-less Dominant out of the brigade tally', () => {
    const result = buildBreakdown([deck('a', 1, [['Angel of the Lord (J)', 'main', 1]])]);
    expect(result.brigades).toEqual([]);
    expect(result.types.find((t) => t.label === 'Dominant')?.decks).toBe(1);
  });

  it('reports median main size and Lost Soul count', () => {
    const result = buildBreakdown([
      deck('a', 1, [
        ['Angel of the Lord (J)', 'main', 10],
        ['Lost Soul "Wicked" [Genesis 6:5]', 'main', 7],
      ]),
      deck('b', 2, [
        ['Angel of the Lord (J)', 'main', 20],
        ['Lost Soul "Wicked" [Genesis 6:5]', 'main', 9],
      ]),
    ]);
    expect(result.medianMainSize).toBe((17 + 29) / 2);
    expect(result.medianLostSouls).toBe(8);
  });

  it('keeps unknown cards distinct instead of pooling them', () => {
    const result = buildBreakdown([
      deck('a', 1, [
        ['Some Forge Card', 'main', 1],
        ['Another Forge Card', 'main', 1],
      ]),
    ]);
    expect(result.cards).toHaveLength(2);
  });

  it('carries a shared decklist’s other players through', () => {
    const result = buildBreakdown([
      { ...deck('a', 4, [['Angel of the Lord (J)', 'main', 1]]), alsoPlayedBy: ['Nic'] },
    ]);
    expect(result.decks[0].alsoPlayedBy).toEqual(['Nic']);
  });

  it('returns an empty shape for a field with no decks', () => {
    const result = buildBreakdown([]);
    expect(result.deckCount).toBe(0);
    expect(result.cards).toEqual([]);
    expect(result.medianMainSize).toBe(0);
  });
});
