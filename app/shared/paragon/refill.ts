import type { GameCard, ZoneId } from '@/app/shared/types/gameCard';

type Zones = Record<ZoneId, GameCard[]>;

const TARGET_IN_PLAY = 3;

/**
 * Move cards from 'soul-deck' to 'land-of-bondage' until the LoB contains
 * TARGET_IN_PLAY Soul-Deck-origin souls, or the soul-deck is empty. Captured
 * characters and LS tokens in the LoB are ignored by the counter.
 *
 * Returns a new zones record — inputs are not mutated.
 */
export function refillSoulDeck(zones: Zones): Zones {
  const soulDeck = zones['soul-deck'];
  const lob = zones['land-of-bondage'];

  const inPlay = lob.filter(c => c.isSoulDeckOrigin === true).length;
  const needed = Math.max(0, TARGET_IN_PLAY - inPlay);
  if (needed === 0 || soulDeck.length === 0) return zones;

  const take = Math.min(needed, soulDeck.length);
  const revealed = soulDeck.slice(0, take).map(c => ({
    ...c,
    zone: 'land-of-bondage' as ZoneId,
    isFlipped: false,
  }));
  const nextSoulDeck = soulDeck.slice(take);
  const nextLob = [...lob, ...revealed];

  return { ...zones, 'soul-deck': nextSoulDeck, 'land-of-bondage': nextLob };
}
