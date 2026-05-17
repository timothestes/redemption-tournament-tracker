import { describe, it, expect } from 'vitest';
import { validateDeck } from '../deckValidation';
import type { Deck, DeckCard, DeckZone } from '../../types/deck';
import type { Card } from '../../utils';

function card(name: string, overrides: Partial<Card> = {}): Card {
  return {
    dataLine: '',
    name,
    set: 'T',
    imgFile: `${name}.jpg`,
    officialSet: 'Test',
    type: 'Hero',
    brigade: 'Blue',
    strength: '1',
    toughness: '1',
    class: '',
    identifier: name,
    specialAbility: '',
    rarity: '',
    reference: '',
    alignment: 'Good',
    legality: '',
    testament: 'NT',
    isGospel: false,
    ...overrides,
  };
}

function entry(name: string, zone: DeckZone, quantity = 1, overrides: Partial<Card> = {}): DeckCard {
  return { card: card(name, overrides), quantity, zone };
}

function makeDeck(cards: DeckCard[], format = 'Type 1'): Deck {
  return {
    name: 'Test',
    cards,
    createdAt: new Date(),
    updatedAt: new Date(),
    format,
  };
}

describe('validateDeck — maybeboard exclusion', () => {
  it('does not count maybeboard cards toward main deck size', () => {
    const cards: DeckCard[] = [
      ...Array.from({ length: 50 }, (_, i) => entry(`Main${i}`, 'main')),
      ...Array.from({ length: 7 }, (_, i) => entry(`Soul${i}`, 'main', 1, { type: 'Lost Soul' })),
      // 20 cards in maybeboard — should be invisible to the validator
      ...Array.from({ length: 20 }, (_, i) => entry(`Maybe${i}`, 'maybeboard')),
    ];
    const result = validateDeck(makeDeck(cards));
    expect(result.stats.mainDeckSize).toBe(57); // 50 + 7 souls
    expect(result.stats.totalCards).toBe(57); // maybeboard NOT in total
  });

  it('does not count maybeboard cards toward reserve size limit', () => {
    const cards: DeckCard[] = [
      // 20 cards in maybeboard — would blow past the 10-card reserve cap if mis-classified
      ...Array.from({ length: 20 }, (_, i) => entry(`Maybe${i}`, 'maybeboard')),
      entry('Reserve1', 'reserve'),
    ];
    const result = validateDeck(makeDeck(cards));
    const reserveSizeError = result.issues.find(
      (i) => i.category === 'reserve' && i.message.includes('Reserve is too large')
    );
    expect(reserveSizeError).toBeUndefined();
    expect(result.stats.reserveSize).toBe(1);
  });

  it('does not enforce Dominant copy limits on maybeboard', () => {
    // 2 copies of the same Dominant in maybeboard — would fail copy-limit if mis-classified
    const cards: DeckCard[] = [
      entry('Faith', 'maybeboard', 2, { type: 'Dominant' }),
    ];
    const result = validateDeck(makeDeck(cards));
    const dominantError = result.issues.find(
      (i) => i.category === 'dominants' && i.message.includes('Faith')
    );
    expect(dominantError).toBeUndefined();
  });

  it('does not skew Type 2 good/evil balance', () => {
    // Tie in main deck (50G/50E) but 5 lopsided Good cards in maybeboard.
    // If maybeboard leaked into the balance check, we'd see a "need more Evil" error.
    const cards: DeckCard[] = [
      ...Array.from({ length: 50 }, (_, i) => entry(`MainG${i}`, 'main', 1, { alignment: 'Good' })),
      ...Array.from({ length: 50 }, (_, i) => entry(`MainE${i}`, 'main', 1, { alignment: 'Evil' })),
      ...Array.from({ length: 5 }, (_, i) => entry(`MaybeG${i}`, 'maybeboard', 1, { alignment: 'Good' })),
    ];
    const result = validateDeck(makeDeck(cards, 'Type 2'));
    const balanceError = result.issues.find(
      (i) => i.category === 'format' && i.message.includes('more Evil')
    );
    expect(balanceError).toBeUndefined();
  });
});
