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
  | { type: 'all_players_shuffle_and_draw'; shuffleCount: number; drawCount: number }
  | { type: 'reveal_own_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'look_at_own_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'look_at_opponent_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'discard_opponent_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'reserve_top_of_deck'; count: number }
  | { type: 'draw_bottom_of_deck'; count: number }
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
  'Mayhem':                                              [{ type: 'all_players_shuffle_and_draw', shuffleCount: 6, drawCount: 6 }],
  'Mayhem (2020 Promo)':                                 [{ type: 'all_players_shuffle_and_draw', shuffleCount: 6, drawCount: 6 }],
  'Mayhem [Fundraiser]':                                 [{ type: 'all_players_shuffle_and_draw', shuffleCount: 6, drawCount: 6 }],
  'Mayhem (FoM)':                                        [{ type: 'all_players_shuffle_and_draw', shuffleCount: 6, drawCount: 6 }],
  'Lost Soul "Lawless" [Hebrews 12:8]':                  [{ type: 'reveal_own_deck', position: 'top', count: 6 }],
  'Lost Soul "Lawless" [Hebrews 12:8] [2021 - 1st Place]': [{ type: 'reveal_own_deck', position: 'top', count: 6 }],
  'Lost Soul "Lawless" [Hebrews 12:8] [AB - CoW]':       [{ type: 'reveal_own_deck', position: 'top', count: 6 }],
  'The Ancient of Days':                                 [{ type: 'reveal_own_deck', position: 'top', count: 3 }],
  'The Ancient of Days [T2C AB]':                        [{ type: 'reveal_own_deck', position: 'top', count: 3 }],
  'Given from God':                                      [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'Given from God [T2C AB]':                             [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'Anna, the Widow (GoC)':                               [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'Vain Vision (PoC)':                                   [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Shimei (CoW AB)':                                     [{ type: 'look_at_own_deck', position: 'top', count: 4 }],
  'Shimei (CoW)':                                        [{ type: 'look_at_own_deck', position: 'top', count: 4 }],
  'Zeresh, Wife of Haman (Roots)':                       [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Chaldeans [T2C AB]':                                  [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Chaldeans [T2C]':                                     [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Laban, the Deal Breaker (Roots)':                     [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Divination [K]':                                      [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'House of Samuel':                                     [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'Mount Sinai':                                         [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'Faith of Isaac':                                      [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'False Prophecy (PoC)':                                [{ type: 'look_at_opponent_deck', position: 'top', count: 6 }],
  'Omen Interpreter':                                    [{ type: 'reveal_own_deck', position: 'top', count: 6 }],
  "Balaam's Prophecy":                                   [{ type: 'reveal_own_deck', position: 'top', count: 6 }],
  'Fruit of the Land':                                   [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'Intervening of Prophecy':                             [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'The Coming Prince':                                   [{ type: 'look_at_own_deck', position: 'top', count: 1 }],
  'Sign of Jonah':                                       [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'Virgin Birth':                                        [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Eve, Mother of All (Roots)':                          [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'The Thankful Leper (GoC)':                            [{ type: 'look_at_own_deck', position: 'top', count: 10 }],
  'David (Roots)':                                       [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'Malachi, the Loved':                                  [{ type: 'look_at_own_deck', position: 'top', count: 4 }],
  'Malachi, the Loved [T2C AB]':                         [{ type: 'look_at_own_deck', position: 'top', count: 4 }],
  'Samuel, Born of Prayer':                              [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'David the Psalmist':                                  [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'David, the Psalmist (CoW AB)':                        [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'Prophets of Gibeath (Promo)':                         [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  "David's Spies [K]":                                   [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'Servants by the River [T2C AB]':                      [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'Servants by the River [T2C]':                         [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'The Angel of His Presence [T2C AB]':                  [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'The Angel of His Presence [T2C]':                     [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'The Three Visitors':                                  [{ type: 'look_at_own_deck', position: 'top', count: 9 }],
  'Women of Israel [L]':                                 [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  "Herod's Temple (GoC)":                                [{ type: 'reserve_top_of_deck', count: 1 }],
  "Herod's Temple [2022 - GoC P]":                       [{ type: 'reserve_top_of_deck', count: 1 }],
  'Treacherous Land':                                    [{ type: 'draw_bottom_of_deck', count: 1 }],
  'Treacherous Land (2022 - 2nd Place)':                 [{ type: 'draw_bottom_of_deck', count: 1 }],
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
    case 'all_players_shuffle_and_draw':
      return `All players shuffle ${a.shuffleCount} from hand, draw ${a.drawCount}`;
    case 'reveal_own_deck': {
      const where = a.position === 'random' ? `${a.count} random` : `${a.position} ${a.count}`;
      return `Reveal ${where} card${a.count === 1 ? '' : 's'} of deck`;
    }
    case 'look_at_own_deck': {
      const where = a.position === 'random' ? `${a.count} random` : `${a.position} ${a.count}`;
      return `Look at ${where} card${a.count === 1 ? '' : 's'} of deck`;
    }
    case 'look_at_opponent_deck': {
      const where = a.position === 'random' ? `${a.count} random` : `${a.position} ${a.count}`;
      return `Look at ${where} card${a.count === 1 ? '' : 's'} of opponent's deck`;
    }
    case 'discard_opponent_deck': {
      const where = a.position === 'random' ? `${a.count} random` : `${a.position} ${a.count}`;
      return `Discard ${where} card${a.count === 1 ? '' : 's'} of opponent's deck`;
    }
    case 'reserve_top_of_deck':
      return `Reserve top ${a.count} card${a.count === 1 ? '' : 's'} of deck`;
    case 'draw_bottom_of_deck':
      return `Draw ${a.count} from bottom of deck`;
    case 'custom':
      return a.label;
  }
}
