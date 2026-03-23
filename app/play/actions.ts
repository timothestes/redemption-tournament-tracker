'use server';

import { createClient } from '@/utils/supabase/server';

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

export interface LoadDeckResult {
  deck: {
    id: string;
    name: string;
    format: string | null;
  };
  deckData: GameCardData[];
}

/**
 * Load a deck and its cards for use in a multiplayer game.
 * Cards with quantity > 1 are expanded into individual entries.
 */
export async function loadDeckForGame(deckId: string): Promise<LoadDeckResult> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error('You must be logged in to load a deck.');
  }

  const { data: deck, error: deckError } = await supabase
    .from('decks')
    .select('id, name, format')
    .eq('id', deckId)
    .eq('user_id', user.id)
    .single();

  if (deckError || !deck) {
    throw new Error('Deck not found.');
  }

  const { data: cards, error: cardsError } = await supabase
    .from('deck_cards')
    .select('card_name, card_set, card_img_file, quantity, is_reserve')
    .eq('deck_id', deckId);

  if (cardsError) {
    throw new Error('Failed to load deck cards.');
  }

  // Expand quantity > 1 rows into individual card entries
  const deckData: GameCardData[] = [];
  for (const card of cards || []) {
    const quantity = card.quantity || 1;
    for (let i = 0; i < quantity; i++) {
      deckData.push({
        cardName: card.card_name || '',
        cardSet: card.card_set || '',
        cardImgFile: card.card_img_file || '',
        // Type data is not stored in deck_cards; the game engine enriches from
        // the card database (same as goldfish mode via fetchCardLookup).
        cardType: '',
        brigade: '',
        strength: '',
        toughness: '',
        alignment: '',
        identifier: '',
        specialAbility: '',
        isReserve: card.is_reserve || false,
      });
    }
  }

  return { deck, deckData };
}
