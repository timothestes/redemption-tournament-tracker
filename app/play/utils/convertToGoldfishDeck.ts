import type { DeckDataForGoldfish } from '@/app/goldfish/types';

/**
 * Mirrors the GameCardData interface from app/play/actions.ts.
 * Defined locally to avoid importing from a 'use server' module,
 * which can cause bundling issues in client components.
 */
export interface GameCardData {
  cardName: string;
  cardSet: string;
  cardImgFile: string;
  cardType: string;
  brigade: string;
  strength: string;
  toughness: string;
  alignment: string;
  identifier: string;
  specialAbility: string;
  isReserve: boolean;
}

/**
 * Convert multiplayer GameCardData[] (expanded by quantity) to
 * DeckDataForGoldfish (aggregated with quantity per unique card).
 *
 * Identity key for aggregation: cardName + cardSet + cardImgFile + isReserve.
 * This preserves alternate art printings as distinct entries.
 */
export function convertToGoldfishDeck(
  cards: GameCardData[],
  deckId: string,
  deckName: string,
  format: string,
  paragon?: string | null
): DeckDataForGoldfish {
  if (!cards || cards.length === 0) {
    return {
      id: deckId,
      name: deckName,
      format,
      paragon: paragon ?? null,
      isOwner: true,
      cards: [],
    };
  }

  // Re-aggregate expanded cards back into entries with quantity counts
  const cardMap = new Map<string, {
    card: GameCardData;
    quantity: number;
  }>();

  for (const card of cards) {
    const key = `${card.cardName}||${card.cardSet}||${card.cardImgFile}||${card.isReserve}`;
    const existing = cardMap.get(key);
    if (existing) {
      existing.quantity += 1;
    } else {
      cardMap.set(key, { card, quantity: 1 });
    }
  }

  const goldfishCards = Array.from(cardMap.values()).map(({ card, quantity }) => ({
    card_name: card.cardName,
    card_set: card.cardSet,
    card_img_file: card.cardImgFile,
    card_type: card.cardType,
    card_brigade: card.brigade,
    card_strength: card.strength,
    card_toughness: card.toughness,
    card_special_ability: card.specialAbility,
    card_identifier: card.identifier,
    card_alignment: card.alignment,
    quantity,
    is_reserve: card.isReserve,
  }));

  return {
    id: deckId,
    name: deckName,
    format,
    paragon: paragon ?? null,
    isOwner: true,
    cards: goldfishCards,
  };
}
