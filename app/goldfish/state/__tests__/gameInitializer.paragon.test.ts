import { describe, it, expect } from 'vitest';
import { buildInitialGameState } from '../gameInitializer';
import type { DeckDataForGoldfish } from '../../types';

function makeDeck(format: string): DeckDataForGoldfish {
  // Minimal deck with 50 non-LS cards to avoid opening-hand LS routing
  return {
    id: 'd1',
    name: 'Test',
    format,
    cards: Array.from({ length: 50 }, (_, i) => ({
      card_name: `Card ${i}`,
      card_set: 'T',
      card_img_file: `/card-${i}.png`,
      card_type: 'Hero',
      card_brigade: '',
      card_strength: '1',
      card_toughness: '1',
      card_special_ability: '',
      card_identifier: `c${i}`,
      card_reference: '',
      card_alignment: 'Good',
      quantity: 1,
      is_reserve: false,
    })),
  };
}

describe('buildInitialGameState (Paragon)', () => {
  it('creates a 21-card soul deck when format is Paragon', () => {
    const state = buildInitialGameState(makeDeck('Paragon'));
    const totalSoulOrigin =
      state.zones['soul-deck'].length +
      state.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin).length;
    expect(totalSoulOrigin).toBe(21);
  });

  it('reveals exactly 3 souls face-up in Land of Bondage after init', () => {
    const state = buildInitialGameState(makeDeck('Paragon'));
    const lobSoulOrigins = state.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin);
    expect(lobSoulOrigins).toHaveLength(3);
    expect(lobSoulOrigins.every(c => !c.isFlipped && c.zone === 'land-of-bondage')).toBe(true);
  });

  it('leaves 18 face-down cards in the soul-deck zone', () => {
    const state = buildInitialGameState(makeDeck('Paragon'));
    const soulDeck = state.zones['soul-deck'];
    expect(soulDeck).toHaveLength(18);
    expect(soulDeck.every(c => c.isFlipped && c.ownerId === 'shared' && c.isSoulDeckOrigin)).toBe(true);
  });

  it('does NOT create a soul deck for T1 format', () => {
    const state = buildInitialGameState(makeDeck('T1'));
    expect(state.zones['soul-deck']).toHaveLength(0);
    const soulOriginInLob = state.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin);
    expect(soulOriginInLob).toHaveLength(0);
  });

  it('assigns ownerId "shared" to every soul-deck-origin card', () => {
    const state = buildInitialGameState(makeDeck('Paragon'));
    const allSoulOrigins = [
      ...state.zones['soul-deck'],
      ...state.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin),
    ];
    expect(allSoulOrigins).toHaveLength(21);
    expect(allSoulOrigins.every(c => c.ownerId === 'shared')).toBe(true);
  });
});
