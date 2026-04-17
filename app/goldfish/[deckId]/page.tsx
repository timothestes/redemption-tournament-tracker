import { notFound } from 'next/navigation';
import { loadPublicDeckAction } from '../../decklist/actions';
import { findCard } from '@/lib/cards/lookup';
import GoldfishClient from './client';
import type { DeckDataForGoldfish } from '../types';

export const metadata = {
  title: 'Practice Mode | RedemptionCCG',
  description: 'Practice your Redemption deck in goldfish mode',
};

export default async function GoldfishPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = await params;

  const result = await loadPublicDeckAction(deckId);

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
      const enriched = findCard(c.card_name, c.card_set || undefined, imgFile);

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
        card_reference: enriched?.reference || '',
        card_alignment: enriched?.alignment || '',
        quantity: c.quantity || 1,
        is_reserve: c.is_reserve || false,
      };
    }),
  };

  return <GoldfishClient deck={deckData} />;
}
