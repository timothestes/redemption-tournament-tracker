import { notFound } from 'next/navigation';
import { loadPublicDeckAction } from '../../decklist/actions';
import GoldfishClient from './client';
import type { DeckDataForGoldfish } from '../types';

const CARD_DATA_URL =
  "https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt";

export const metadata = {
  title: 'Practice Mode | RedemptionCCG',
  description: 'Practice your Redemption deck in goldfish mode',
};

/**
 * Fetch the full card database and build a lookup map.
 * Key: "cardName|cardSet" (lowercase) for matching against deck_cards rows.
 */
async function fetchCardLookup(): Promise<
  Map<string, { type: string; brigade: string; strength: string; toughness: string; specialAbility: string; identifier: string; alignment: string }>
> {
  const response = await fetch(CARD_DATA_URL, { next: { revalidate: 3600 } });
  const text = await response.text();
  const lines = text.split('\n');
  const dataLines = lines.slice(1).filter((l) => l.trim());

  const map = new Map<
    string,
    { type: string; brigade: string; strength: string; toughness: string; specialAbility: string; identifier: string; alignment: string }
  >();

  for (const line of dataLines) {
    const cols = line.split('\t');
    const name = cols[0] || '';
    const set = cols[1] || '';
    const imgFile = (cols[2] || '').replace(/\.jpe?g$/i, '');

    const entry = {
      type: cols[4] || '',
      brigade: cols[5] || '',
      strength: cols[6] || '',
      toughness: cols[7] || '',
      specialAbility: cols[10] || '',
      identifier: cols[9] || '',
      alignment: cols[14] || '',
    };

    // Index by multiple keys for flexible matching
    map.set(`${name}|${set}`, entry);
    map.set(`${name}|${set}|${imgFile}`, entry);
    // Fallback: name-only (takes last seen)
    if (!map.has(name)) {
      map.set(name, entry);
    }
  }

  return map;
}

export default async function GoldfishPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = await params;

  const [result, cardLookup] = await Promise.all([
    loadPublicDeckAction(deckId),
    fetchCardLookup(),
  ]);

  if (!result.success || !result.deck) {
    notFound();
  }

  const deck = result.deck;

  // Enrich DB card rows with type data from the card database
  const deckData: DeckDataForGoldfish = {
    id: deck.id,
    name: deck.name,
    format: deck.format || 'Type 1',
    paragon: deck.paragon || null,
    isOwner: result.isOwner ?? false,
    cards: (deck.cards || []).map((c: any) => {
      const imgFile = (c.card_img_file || '').replace(/\.jpe?g$/i, '');
      // Try exact match first, then name+set, then name-only
      const enriched =
        cardLookup.get(`${c.card_name}|${c.card_set || ''}|${imgFile}`) ||
        cardLookup.get(`${c.card_name}|${c.card_set || ''}`) ||
        cardLookup.get(c.card_name);

      return {
        card_name: c.card_name,
        card_set: c.card_set || '',
        card_img_file: c.card_img_file || '',
        card_type: enriched?.type || '',
        card_brigade: enriched?.brigade || '',
        card_strength: enriched?.strength || '',
        card_toughness: enriched?.toughness || '',
        card_special_ability: enriched?.specialAbility || '',
        card_identifier: enriched?.identifier || '',
        card_alignment: enriched?.alignment || '',
        quantity: c.quantity || 1,
        is_reserve: c.is_reserve || false,
      };
    }),
  };

  return <GoldfishClient deck={deckData} />;
}
