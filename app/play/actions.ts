'use server';

import { createClient } from '@/utils/supabase/server';
import { findCard } from '@/lib/cards/lookup';
import type { DeckOption } from './components/DeckPickerCard';

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
  reference: string;
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

  // Try loading as user's own deck first, then fall back to public deck
  const { data: ownDeck } = await supabase
    .from('decks')
    .select('id, name, format')
    .eq('id', deckId)
    .eq('user_id', user.id)
    .single();

  let deck = ownDeck;
  if (!deck) {
    const { data: publicDeck } = await supabase
      .from('decks')
      .select('id, name, format')
      .eq('id', deckId)
      .eq('is_public', true)
      .single();
    deck = publicDeck;
  }

  if (!deck) {
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
    const imgFile = (card.card_img_file || '').replace(/\.jpe?g$/i, '');
    const enriched = findCard(card.card_name || '', card.card_set || undefined, imgFile);

    for (let i = 0; i < quantity; i++) {
      deckData.push({
        cardName: card.card_name || '',
        cardSet: card.card_set || '',
        cardImgFile: card.card_img_file || '',
        cardType: enriched?.type || '',
        brigade: enriched?.brigade || '',
        strength: enriched?.strength || '',
        toughness: enriched?.toughness || '',
        alignment: enriched?.alignment || '',
        identifier: enriched?.identifier || '',
        reference: enriched?.reference || '',
        specialAbility: enriched?.specialAbility || '',
        isReserve: card.is_reserve || false,
      });
    }
  }

  // Stamp last_played_at if this is the user's own deck
  if (ownDeck) {
    await supabase
      .from('decks')
      .update({ last_played_at: new Date().toISOString() })
      .eq('id', deckId);
  }

  return { deck, deckData };
}

/**
 * Search public community decks by name.
 * Returns up to 20 results ordered by view count.
 */
export async function searchCommunityDecks(query: string): Promise<{
  id: string;
  name: string;
  format: string | null;
  card_count: number | null;
  username: string | null;
}[]> {
  if (!query || query.length < 2) return [];

  const supabase = await createClient();

  const { data: decks, error } = await supabase
    .from('decks')
    .select('id, name, format, card_count, user_id')
    .eq('is_public', true)
    .ilike('name', `%${query}%`)
    .order('view_count', { ascending: false })
    .limit(20);

  if (error || !decks) return [];

  // Fetch usernames for the results
  const userIds = [...new Set(decks.map(d => d.user_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username')
    .in('id', userIds);

  const usernameMap = new Map(profiles?.map(p => [p.id, p.username]) ?? []);

  return decks.map(d => ({
    id: d.id,
    name: d.name,
    format: d.format,
    card_count: d.card_count,
    username: usernameMap.get(d.user_id) ?? null,
  }));
}

export interface LoadUserDecksPagedParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: 'latest' | 'last_played' | 'name';
}

export interface LoadUserDecksPagedResult {
  decks: DeckOption[];
  totalCount: number;
}

/**
 * Paginated + searchable loader for the deck picker "My Decks" tab.
 * Mirrors loadPublicDecksAction's shape for consistency.
 */
export async function loadUserDecksPaged(
  params: LoadUserDecksPagedParams = {},
): Promise<LoadUserDecksPagedResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { decks: [], totalCount: 0 };

  const { page = 1, pageSize = 12, search, sort = 'last_played' } = params;
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from('decks')
    .select(
      'id, name, format, card_count, preview_card_1, preview_card_2, paragon, last_played_at',
      { count: 'exact' },
    )
    .eq('user_id', user.id);

  if (search && search.trim()) {
    query = query.ilike('name', `%${search.trim()}%`);
  }

  switch (sort) {
    case 'name':
      query = query.order('name', { ascending: true });
      break;
    case 'latest':
      query = query.order('updated_at', { ascending: false });
      break;
    case 'last_played':
    default:
      query = query
        .order('last_played_at', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false });
      break;
  }

  query = query.range(offset, offset + pageSize - 1);

  const { data, count } = await query;
  return { decks: data ?? [], totalCount: count ?? 0 };
}
