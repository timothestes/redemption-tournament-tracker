// lib/cards/cardAbilities.ts
// -----------------------------------------------------------------------------
// Per-card ability registry.
// NOTE: A duplicate of this file exists at spacetimedb/src/cardAbilities.ts —
// keep the CARD_ABILITIES entries, CardAbility union, and SPECIAL_TOKEN_CARDS
// in sync. Parity is enforced by lib/cards/__tests__/cardAbilities.test.ts.
// -----------------------------------------------------------------------------
import type { ZoneId } from '@/app/shared/types/gameCard';
import { findCard, type CardData } from './lookup';

// Per-ability override for the zones the source card may fire from. When
// omitted, falls back to DEFAULT_ABILITY_SOURCE_ZONES (territory + both
// lands). Used for (Star) abilities that activate from hand — see Virgin
// Birth / Delivered.
type AbilityBase = { sourceZones?: ZoneId[] };

export const DEFAULT_ABILITY_SOURCE_ZONES: ReadonlyArray<ZoneId> = [
  'territory', 'land-of-bondage', 'land-of-redemption',
];

export type CardAbility = AbilityBase & (
  | { type: 'spawn_token'; tokenName: string; count?: number; defaultZone?: ZoneId }
  | { type: 'shuffle_and_draw'; shuffleCount: number; drawCount: number }
  | { type: 'all_players_shuffle_and_draw'; shuffleCount: number; drawCount: number }
  | { type: 'reveal_own_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'look_at_own_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'look_at_opponent_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'reveal_opponent_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'discard_opponent_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'reserve_opponent_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'reserve_top_of_deck'; count: number }
  | { type: 'draw_bottom_of_deck'; count: number }
  | { type: 'underdeck_top_of_deck'; count: number }
  | { type: 'set_card_outline'; color: 'good' | 'evil'; label: string }
  | { type: 'play_all_lost_souls' }
  | { type: 'three_nails_reset' }
  | { type: 'imitate_lost_soul' }
  | { type: 'custom'; reducerName: string; label: string }
);

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
  'Lost Soul "Imitate" [III John 1:11]':                 [{ type: 'imitate_lost_soul' }],
  'Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]':     [{ type: 'imitate_lost_soul' }],
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
  'The Ends of the Earth (RoJ AB)':                      [{ type: 'reveal_opponent_deck', position: 'top', count: 7 }],
  'The Ends of the Earth (RoJ)':                         [{ type: 'reveal_opponent_deck', position: 'top', count: 7 }],
  'Matthew the Publican / Matthew (Levi) (GoC)':         [{ type: 'custom', reducerName: 'matthewDrawBrigades', label: "Draw cards equal to brigades in opponent's hand" }],
  'Delivered':                                           [{ type: 'discard_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  // (Star) — "Reserve the top card of a deck". Surfaced as opponent-deck
  // since that's the impactful play; user can still manually move from
  // own deck via the deck-search modal.
  'Contagious Fear (GoC)':                               [{ type: 'reserve_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Jairus (GoC)':                                        [{ type: 'reserve_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  "Jairus' Daughter (GoC)":                              [{ type: 'reserve_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Massacre of Innocents (GoC)':                         [{ type: 'reserve_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Submission to Christ (GoC)':                          [{ type: 'reserve_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Talitha Kum! (GoC)':                                  [{ type: 'reserve_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Teaching in Parables (GoC)':                          [{ type: 'reserve_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Omen Interpreter':                                    [{ type: 'reveal_own_deck', position: 'top', count: 6 }],
  "Balaam's Prophecy":                                   [{ type: 'reveal_own_deck', position: 'top', count: 6 }],
  'Fruit of the Land':                                   [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'Intervening of Prophecy':                             [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'The Coming Prince':                                   [{ type: 'look_at_own_deck', position: 'top', count: 1 }, { type: 'underdeck_top_of_deck', count: 1 }],
  'Abed-nego (Azariah) (PoC)':                           [{ type: 'underdeck_top_of_deck', count: 1 }],
  'Sign of Jonah':                                       [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'Virgin Birth':                                        [{ type: 'look_at_own_deck', position: 'top', count: 6, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
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
  'Three Woes (RoJ AB)':                                 [{ type: 'set_card_outline', color: 'good', label: 'Choose Good' }, { type: 'set_card_outline', color: 'evil', label: 'Choose Evil' }],
  'Three Woes (RoJ)':                                    [{ type: 'set_card_outline', color: 'good', label: 'Choose Good' }, { type: 'set_card_outline', color: 'evil', label: 'Choose Evil' }],
  'Three Woes [Fundraiser]':                             [{ type: 'set_card_outline', color: 'good', label: 'Choose Good' }, { type: 'set_card_outline', color: 'evil', label: 'Choose Evil' }],
  'Three Woes [Fundraiser - Serialized]':                [{ type: 'set_card_outline', color: 'good', label: 'Choose Good' }, { type: 'set_card_outline', color: 'evil', label: 'Choose Evil' }],
  'Harvest Time (GoC)':                                  [{ type: 'play_all_lost_souls' }],
  'Harvest Time [Fundraiser]':                           [{ type: 'play_all_lost_souls' }],
  'Three Nails (GoC)':                                   [{ type: 'three_nails_reset' }],
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

/**
 * Exact-cardName → image path map for Imitate Lost Soul art swaps.
 * Files live under public/imitate-souls/cards/ (see public/imitate-souls/README.md).
 * Multiple cardName variants can point at the same file when the card
 * has alternate-border or promo variants sharing the same art.
 */
export const IMITATE_SOUL_IMAGES: Record<string, string> = {
  'Lost Soul "Awake" [Ephesians 5:14 - TPC]':                          '/imitate-souls/cards/awake.jpg',
  'Lost Soul "Crowds" [Luke 5:15] [2016 - Local]':                     '/imitate-souls/cards/crowds_local.jpg',
  'Lost Soul "Crowds" [Luke 5:15] [2025 - Worker]':                    '/imitate-souls/cards/crowds_worker.jpg',
  'Lost Soul "Defiled" [Mark 7:21-22]':                                '/imitate-souls/cards/defiled.jpg',
  'Lost Soul "Destruction" [Hebrews 10:39]':                           '/imitate-souls/cards/destruction.jpg',
  'Lost Soul "Destruction" [Hebrews 10:39] [AB - CoW]':                '/imitate-souls/cards/destruction.jpg',
  'Lost Soul "Dull" [Hebrews 5:11]':                                   '/imitate-souls/cards/dull.jpg',
  'Lost Soul "Dull" [Hebrews 5:11] [AB - CoW]':                        '/imitate-souls/cards/dull.jpg',
  'Lost Soul "Forsaken" [Hebrews 10:25]':                              '/imitate-souls/cards/forsaken.jpg',
  'Lost Soul "Forsaken" [Hebrews 10:25] [AB - CoW]':                   '/imitate-souls/cards/forsaken.jpg',
  'Lost Soul "Gain" [Jude 1:16]':                                      '/imitate-souls/cards/gain.jpg',
  'Lost Soul "Gain" [Jude 1:16]  [AB - RoJ]':                          '/imitate-souls/cards/gain.jpg',
  'Lost Soul "Galileans" [Luke 13:2]':                                 '/imitate-souls/cards/galileans.jpg',
  'Lost Soul "Harvest" [John 4:35]':                                   '/imitate-souls/cards/harvest.jpg',
  'Lost Soul "Harvest" [John 4:35] [2023 - 2nd Place]':                '/imitate-souls/cards/harvest_2nd.jpg',
  'Lost Soul "Hopper" [Matthew 18:12] [2025 - Seasonal]':              '/imitate-souls/cards/hopper.jpg',
  'Lost Soul "Humble" [James 4:6 / Proverbs 3:34 - RoJ]':              '/imitate-souls/cards/humble.jpg',
  'Lost Soul "Humble" [James 4:6 / Proverbs 3:34]  [AB - RoJ]':        '/imitate-souls/cards/humble.jpg',
  'Lost Soul "Humble" [James 4:6 / Proverbs 3:34] [2022 - 3rd Place]': '/imitate-souls/cards/humble_3rd.jpg',
  'Lost Soul "Imitate" [III John 1:11]':                               '/imitate-souls/cards/imitate.jpg',
  'Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]':                   '/imitate-souls/cards/imitate.jpg',
  'Lost Soul "Lawless" [Hebrews 12:8]':                                '/imitate-souls/cards/lawless.jpg',
  'Lost Soul "Lawless" [Hebrews 12:8] [2021 - 1st Place]':             '/imitate-souls/cards/lawless.jpg',
  'Lost Soul "Lawless" [Hebrews 12:8] [AB - CoW]':                     '/imitate-souls/cards/lawless.jpg',
  'Lost Soul "Open Hand" [Hebrews 4:13]':                              '/imitate-souls/cards/open_hand.jpg',
  'Lost Soul "Open Hand" [Hebrews 4:13] [AB - CoW]':                   '/imitate-souls/cards/open_hand.jpg',
  'Lost Soul "Rejoice" [Luke 15:6 - J]':                               '/imitate-souls/cards/rejoice.jpg',
  'Lost Soul "Retribution" [Acts 16:22]':                              '/imitate-souls/cards/retribution.jpg',
  'Lost Soul "Revealer" [John 3:20]':                                  '/imitate-souls/cards/revealer.jpg',
  'Lost Soul "Salty" [Matthew 5:13]':                                  '/imitate-souls/cards/salty.jpg',
  'Lost Soul "Shut Door" [Luke 13:25 - LR]':                           '/imitate-souls/cards/shut_door.jpg',
  'Lost Soul "Tempter" [II Timothy 3:6-7 - TPC]':                      '/imitate-souls/cards/tempter.jpg',
  'Lost Soul "The First" [Luke 13:30]':                                '/imitate-souls/cards/the_first.jpg',
  'Lost Soul "Undesirables" [Luke 14:13]':                             '/imitate-souls/cards/undesireables.jpg',
};

/**
 * New Testament book names (lowercased). Used by isNewTestamentLostSoul to
 * reject OT targets in the Imitate ability flow — the rules text on Lost
 * Soul "Imitate" restricts copies to N.T. Lost Souls only. Duplicated in
 * spacetimedb/src/cardAbilities.ts; parity test enforces equality.
 */
const NT_BOOK_NAMES = [
  'matthew', 'mark', 'luke', 'john', 'acts', 'romans',
  'corinthians', 'galatians', 'ephesians', 'philippians',
  'colossians', 'thessalonians', 'timothy', 'titus', 'philemon',
  'hebrews', 'james', 'peter', 'jude', 'revelation',
];

/**
 * Returns true when the Lost Soul's reference is from the New Testament.
 * Strips leading Roman numerals (I, II, III, IV) or Arabic numerals
 * (1, 2, 3) so "III John 1:11" / "II Timothy 3:6-7" / "1 Corinthians 1:27"
 * all match their underlying book. Single-letter "I" in "Isaiah" is
 * untouched because the regex requires a trailing space.
 */
export function isNewTestamentLostSoul(reference: string): boolean {
  if (!reference) return false;
  const lower = reference.toLowerCase().trim();
  const stripped = lower.replace(/^(i{1,3}|iv|\d+)\s+/, '');
  return NT_BOOK_NAMES.some(book => stripped.startsWith(book));
}

/**
 * Extracts a short label from a Lost Soul cardName for the imitation overlay.
 * Priority: quoted name → first parenthetical → cardName with "Lost Soul " prefix stripped.
 */
export function simplifyLostSoulName(cardName: string): string {
  const quoted = cardName.match(/"([^"]+)"/);
  if (quoted) return quoted[1];
  const paren = cardName.match(/\(([^)]+)\)/);
  if (paren) return paren[1];
  return cardName.replace(/^Lost Soul\s+/, '').trim();
}

export function getAbilitiesForCard(identifier: string): CardAbility[] {
  return CARD_ABILITIES[identifier] ?? [];
}

/**
 * Returns the abilities to render in this card's right-click menu, including
 * any inherited from a soul it's currently imitating. When `imitatingName` is
 * set (full cardName of the imitated target), its abilities are appended after
 * the card's own — but any nested `imitate_lost_soul` ability is filtered out
 * to prevent a stray duplicate "Imitate..." item from chained imitation.
 *
 * Server's execute_card_ability dispatch and the client's CardContextMenu must
 * both use this function so abilityIndex resolution stays in sync.
 */
export function getEffectiveAbilities(card: { cardName: string; imitatingName?: string }): CardAbility[] {
  const base = getAbilitiesForCard(card.cardName);
  if (!card.imitatingName) return base;
  const imitated = getAbilitiesForCard(card.imitatingName).filter(a => a.type !== 'imitate_lost_soul');
  return [...base, ...imitated];
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
    case 'reveal_opponent_deck': {
      const where = a.position === 'random' ? `${a.count} random` : `${a.position} ${a.count}`;
      return `Reveal ${where} card${a.count === 1 ? '' : 's'} of opponent's deck`;
    }
    case 'discard_opponent_deck': {
      const where = a.position === 'random' ? `${a.count} random` : `${a.position} ${a.count}`;
      return `Discard ${where} card${a.count === 1 ? '' : 's'} of opponent's deck`;
    }
    case 'reserve_opponent_deck': {
      const where = a.position === 'random' ? `${a.count} random` : `${a.position} ${a.count}`;
      return `Reserve ${where} card${a.count === 1 ? '' : 's'} of opponent's deck`;
    }
    case 'reserve_top_of_deck':
      return `Reserve top ${a.count} card${a.count === 1 ? '' : 's'} of deck`;
    case 'draw_bottom_of_deck':
      return `Draw ${a.count} from bottom of deck`;
    case 'underdeck_top_of_deck':
      return a.count === 1
        ? 'Underdeck top card of deck'
        : `Underdeck top ${a.count} cards of deck`;
    case 'set_card_outline':
      return a.label;
    case 'play_all_lost_souls':
      return 'Play all Lost Souls from each deck';
    case 'three_nails_reset':
      return 'Reset (banishes Nails, both players draw 8)';
    case 'imitate_lost_soul':
      return 'Imitate...';
    case 'custom':
      return a.label;
  }
}
