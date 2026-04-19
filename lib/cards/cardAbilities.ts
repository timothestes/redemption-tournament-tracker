// lib/cards/cardAbilities.ts
// -----------------------------------------------------------------------------
// Per-card ability registry.
// NOTE: A duplicate of this file exists at spacetimedb/src/cardAbilities.ts —
// keep the CARD_ABILITIES entries, CardAbility union, and SPECIAL_TOKEN_CARDS
// in sync. Parity is enforced by lib/cards/__tests__/cardAbilities.test.ts.
// -----------------------------------------------------------------------------
import type { ZoneId } from '@/app/shared/types/gameCard';
import { findCard, type CardData } from './lookup';

export type CardAbility =
  | { type: 'spawn_token'; tokenName: string; count?: number; defaultZone?: ZoneId }
  | { type: 'shuffle_and_draw'; shuffleCount: number; drawCount: number }
  | { type: 'custom'; reducerName: string; label: string };

/**
 * Registry keyed by GameCard.cardName (which embeds the set suffix for the
 * v1 cards, e.g., "Two Possessed (GoC)"). Each entry lists the abilities
 * exposed on that card's right-click menu. `count` defaults to 1 when
 * omitted; cards that spawn multiple tokens per effect set count explicitly
 * so one click produces all of them atomically.
 */
export const CARD_ABILITIES: Record<string, CardAbility[]> = {
  'Two Possessed (GoC)':                                 [{ type: 'spawn_token', tokenName: 'Violent Possessor Token', count: 2 }],
  'The Accumulator (GoC)':                               [{ type: 'spawn_token', tokenName: 'Wicked Spirit Token', count: 7 }],
  'The Proselytizers (GoC)':                             [{ type: 'spawn_token', tokenName: 'Proselyte Token' }],
  'The Church of Christ (GoC)':                          [{ type: 'spawn_token', tokenName: 'Follower Token' }],
  'Angel of the Harvest (GoC)':                          [{ type: 'spawn_token', tokenName: 'Harvest Soul Token' }],
  'The Heavenly Host (GoC)':                             [{ type: 'spawn_token', tokenName: 'Heavenly Host Token' }],
  'Kingdom of the Divine':                               [{ type: 'spawn_token', tokenName: 'Daniel Soul Token' }],
  'Kingdom of the Divine [T2C AB]':                      [{ type: 'spawn_token', tokenName: 'Daniel Soul Token' }],
  'Lost Soul "Harvest" [John 4:35]':                     [{ type: 'spawn_token', tokenName: 'Harvest Soul Token' }],
  'Lost Soul "Harvest" [John 4:35] [2023 - 2nd Place]':  [{ type: 'spawn_token', tokenName: 'Harvest Soul Token' }],
  'Lost Soul "Lost Souls" [Proverbs 2:16-17]':           [{ type: 'spawn_token', tokenName: 'Lost Souls Token' }],
};

/**
 * Handcrafted tokens that don't exist in the generated CARDS dataset — their
 * images live under public/gameplay/ and they're spawned via right-click
 * actions only. Keys match ability.tokenName entries above.
 *
 * Fields mirror CardData so `resolveTokenCard()` can return a unified shape.
 * imgFile carries the full Next.js public path (leading slash, file extension).
 */
export const SPECIAL_TOKEN_CARDS: Record<string, CardData> = {
  'Harvest Soul Token': {
    name: 'Lost Soul Token "Harvest"',
    set: '',
    imgFile: '/gameplay/harvest_soul_token.jpg',
    officialSet: '',
    type: 'Lost Soul',
    brigade: '',
    strength: '',
    toughness: '',
    class: '',
    identifier: '',
    specialAbility: '',
    rarity: 'Token',
    reference: 'John 4:35',
    alignment: 'Neutral',
    legality: '',
  },
  'Lost Souls Token': {
    name: 'Lost Soul Token "Lost Souls"',
    set: '',
    imgFile: '/gameplay/lost_souls_token.jpg',
    officialSet: '',
    type: 'Lost Soul',
    brigade: '',
    strength: '',
    toughness: '',
    class: '',
    identifier: '',
    specialAbility: '',
    rarity: 'Token',
    reference: 'Proverbs 2:16-17',
    alignment: 'Neutral',
    legality: '',
  },
  'Daniel Soul Token': {
    name: 'Daniel Soul Token',
    set: '',
    imgFile: '/gameplay/daniel_soul_token.png',
    officialSet: '',
    type: 'Lost Soul',
    brigade: '',
    strength: '',
    toughness: '',
    class: '',
    identifier: '',
    specialAbility: '',
    rarity: 'Token',
    reference: '',
    alignment: 'Neutral',
    legality: '',
  },
};

/**
 * Resolves a token name to its card data. Handcrafted tokens (images under
 * public/gameplay/) are checked first; falls back to findCard() for tokens
 * that exist in the generated CARDS dataset.
 */
export function resolveTokenCard(name: string): CardData | undefined {
  return SPECIAL_TOKEN_CARDS[name] ?? findCard(name);
}

export function getAbilitiesForCard(identifier: string): CardAbility[] {
  return CARD_ABILITIES[identifier] ?? [];
}

export function abilityLabel(a: CardAbility): string {
  switch (a.type) {
    case 'spawn_token': {
      const n = a.count ?? 1;
      return n > 1 ? `Create ${n}× ${a.tokenName}` : `Create ${a.tokenName}`;
    }
    case 'shuffle_and_draw':
      return `Shuffle ${a.shuffleCount} from hand, draw ${a.drawCount}`;
    case 'custom':
      return a.label;
  }
}
