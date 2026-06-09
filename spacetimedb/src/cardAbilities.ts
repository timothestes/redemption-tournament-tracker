// spacetimedb/src/cardAbilities.ts
// -----------------------------------------------------------------------------
// DUPLICATE of lib/cards/cardAbilities.ts — keep in sync.
// The SpacetimeDB module's tsconfig has rootDir: './src' and cannot reach the
// app's lib/. A parity test in lib/cards/__tests__/cardAbilities.test.ts
// (added by Task 11) asserts the two copies stay aligned.
// Precedent: soul-defs duplication documented in commit 3035dd5.
//
// TOKEN_CARD_DATA below hardcodes the metadata for the 5 token cards that v1
// spawns. Same reason — the server can't import findCard() or the CARDS
// dataset. If the registry grows to reference a new token, add its metadata
// to TOKEN_CARD_DATA here (and it must also exist in lib/cards/generated/
// cardData.ts, which the lib-side registry test verifies).
// -----------------------------------------------------------------------------

// Zone ids as strings (matches the stringified zone column on CardInstance).
// Kept local — no import from shared types.
type ZoneId = string;

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
  | { type: 'draw_bottom_of_deck_choose' }
  | { type: 'underdeck_top_of_deck'; count: number }
  | { type: 'discard_characters_from_reserve'; target: 'self' | 'opponent' }
  | { type: 'set_card_outline'; color: 'good' | 'evil'; label: string }
  | { type: 'play_all_lost_souls' }
  | { type: 'three_nails_reset' }
  | { type: 'imitate_lost_soul' }
  | { type: 'draw_and_topdeck_self' }
  | { type: 'resurrect_heroes' }
  | { type: 'custom'; reducerName: string; label: string }
);

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
  'Lost Soul "The First" [Luke 13:30]':                  [{ type: 'draw_and_topdeck_self' }],
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
  'Balaam Son of Beor':                                  [{ type: 'draw_bottom_of_deck', count: 2 }],
  'Destructive Sin (GoC)':                               [{ type: 'draw_bottom_of_deck', count: 1 }],
  'High Places (LoC)':                                   [{ type: 'draw_bottom_of_deck', count: 1 }],
  'Choked Seed (GoC)':                                   [{ type: 'draw_bottom_of_deck_choose' }],
  'Destroying Spirit (GoC)':                             [{ type: 'draw_bottom_of_deck_choose' }],
  'Messenger of Satan (EC)':                             [{ type: 'draw_bottom_of_deck_choose' }],
  'Three Woes (RoJ AB)':                                 [{ type: 'set_card_outline', color: 'good', label: 'Choose Good' }, { type: 'set_card_outline', color: 'evil', label: 'Choose Evil' }],
  'Three Woes (RoJ)':                                    [{ type: 'set_card_outline', color: 'good', label: 'Choose Good' }, { type: 'set_card_outline', color: 'evil', label: 'Choose Evil' }],
  'Three Woes [Fundraiser]':                             [{ type: 'set_card_outline', color: 'good', label: 'Choose Good' }, { type: 'set_card_outline', color: 'evil', label: 'Choose Evil' }],
  'Three Woes [Fundraiser - Serialized]':                [{ type: 'set_card_outline', color: 'good', label: 'Choose Good' }, { type: 'set_card_outline', color: 'evil', label: 'Choose Evil' }],
  'Harvest Time (GoC)':                                  [{ type: 'play_all_lost_souls' }],
  'Harvest Time [Fundraiser]':                           [{ type: 'play_all_lost_souls' }],
  'Three Nails (GoC)':                                   [{ type: 'three_nails_reset' }],
  // "You may discard this card to discard all characters from a Reserve."
  // Surfaced as two menu items so the activating player picks which Reserve;
  // no in-menu target picker needed.
  "Darius' Decree [T2C]":                                [{ type: 'discard_characters_from_reserve', target: 'self' }, { type: 'discard_characters_from_reserve', target: 'opponent' }],
  "Darius' Decree [T2C AB]":                             [{ type: 'discard_characters_from_reserve', target: 'self' }, { type: 'discard_characters_from_reserve', target: 'opponent' }],
  // "Resurrect any number of Heroes from each player." Opens a per-player
  // discard picker; selected Heroes return to their own owner's Territory.
  'Emptying the Tombs (GoC)':                            [{ type: 'resurrect_heroes' }],
  'Redemption [2025 - National]':                        [{ type: 'resurrect_heroes' }],
};

export function getAbilitiesForCard(identifier: string): CardAbility[] {
  return CARD_ABILITIES[identifier] ?? [];
}

/**
 * Returns the abilities for this card plus any inherited from a soul it's
 * currently imitating (filter out the nested imitate_lost_soul variant so
 * "Imitate..." doesn't appear twice). Server execute_card_ability and the
 * client CardContextMenu must both use this so abilityIndex stays in sync.
 */
export function getEffectiveAbilities(card: { cardName: string; imitatingName?: string }): CardAbility[] {
  const base = getAbilitiesForCard(card.cardName);
  if (!card.imitatingName) return base;
  const imitated = getAbilitiesForCard(card.imitatingName).filter(a => a.type !== 'imitate_lost_soul');
  return [...base, ...imitated];
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
 * Original (canonical) imgFile for each Imitate Lost Soul variant. Used by
 * stop_imitating_lost_soul to revert. Values match the imgFile field in
 * lib/cards/generated/cardData.ts. Parity test enforces this.
 */
export const IMITATE_ORIGINAL_IMG: Record<string, string> = {
  'Lost Soul "Imitate" [III John 1:11]':              '23-Lost-Soul-Imitate-R',
  'Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]':  'RoJ_AB_N23-Lost-Soul-Imitate-R',
};

/**
 * New Testament book names (lowercased). Duplicate of the array in
 * lib/cards/cardAbilities.ts; parity test enforces equality.
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
 * all match their underlying book.
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

/**
 * True when a card is a "character" in Redemption terms — a Hero or an Evil
 * Character (including their token variants and dual-type combos like
 * "Hero/Evil Character"). Handles both the goldfish `type` field and the
 * multiplayer `cardType` field. Duplicate of lib/cards/cardAbilities.ts.
 */
export function isCharacterCard(card: { type?: string; cardType?: string }): boolean {
  const t = (card.type ?? card.cardType ?? '').toLowerCase();
  if (!t) return false;
  return t.includes('hero') || t.includes('evil character');
}

/**
 * True when a card's type contains "Hero" — the valid-target rule for the
 * resurrect_heroes ability. "Contains" rather than exact match so dual-
 * alignment / compound-type Heroes (e.g. "Hero/Evil Character") qualify.
 * Handles both the goldfish `type` field and the multiplayer `cardType`
 * field. Duplicate of lib/cards/cardAbilities.ts.
 */
export function isHeroCard(card: { type?: string; cardType?: string }): boolean {
  const t = (card.type ?? card.cardType ?? '').toLowerCase();
  return t.includes('hero');
}

export interface TokenCardData {
  name: string;
  set: string;
  imgFile: string;
  cardType: string;
  brigade: string;
  strength: string;
  toughness: string;
  alignment: string;
  identifier: string;
  specialAbility: string;
  reference: string;
}

export const TOKEN_CARD_DATA: Record<string, TokenCardData> = {
  'Violent Possessor Token': {
    name: 'Violent Possessor Token',
    set: 'GoC',
    imgFile: 'Violent-Possessor-Token',
    cardType: 'Evil Character Token',
    brigade: 'Orange',
    strength: '2',
    toughness: '2',
    alignment: 'Evil',
    identifier: 'Generic, Demon',
    specialAbility: '',
    reference: 'Matthew 8:28',
  },
  'Wicked Spirit Token': {
    name: 'Wicked Spirit Token',
    set: 'GoC',
    imgFile: 'Wicked-Spirit-Token',
    cardType: 'Evil Character Token',
    brigade: 'Orange',
    strength: '1',
    toughness: '3',
    alignment: 'Evil',
    identifier: 'Generic, Demon',
    specialAbility: '',
    reference: 'Luke 11:26',
  },
  'Proselyte Token': {
    name: 'Proselyte Token',
    set: 'GoC',
    imgFile: 'Proselyte-Token',
    cardType: 'Evil Character Token',
    brigade: 'Gray',
    strength: '2',
    toughness: '2',
    alignment: 'Evil',
    identifier: 'Generic, Pharisee',
    specialAbility: '',
    reference: 'Matthew 23:15',
  },
  'Follower Token': {
    name: 'Follower Token',
    set: 'GoC',
    imgFile: 'Follower-Token',
    cardType: 'Hero Token',
    brigade: 'Clay',
    strength: '6',
    toughness: '8',
    alignment: 'Good',
    identifier: 'Generic, Has the selected church identifier',
    specialAbility: '',
    reference: 'Matthew 16:18',
  },
  'Heavenly Host Token': {
    name: 'Heavenly Host Token',
    set: 'GoC',
    imgFile: 'Heavenly-Host-Token',
    cardType: 'Hero Token',
    brigade: 'Silver',
    strength: '1',
    toughness: '9',
    alignment: 'Good',
    identifier: 'Generic, Nativity, Angel',
    specialAbility: '',
    reference: 'Luke 2:13',
  },
  // Handcrafted lost-soul tokens — images under public/gameplay/. imgFile
  // carries the full path with leading slash (unlike real carddata tokens
  // which use bare filenames resolved elsewhere).
  'Harvest Soul Token': {
    name: 'Lost Soul Token "Harvest"',
    set: '',
    imgFile: '/gameplay/harvest_soul_token.jpg',
    cardType: 'Lost Soul',
    brigade: '',
    strength: '',
    toughness: '',
    alignment: 'Neutral',
    identifier: '',
    specialAbility: '',
    reference: 'John 4:35',
  },
  'Lost Souls Token': {
    name: 'Lost Soul Token "Lost Souls"',
    set: '',
    imgFile: '/gameplay/lost_souls_token.jpg',
    cardType: 'Lost Soul',
    brigade: '',
    strength: '',
    toughness: '',
    alignment: 'Neutral',
    identifier: '',
    specialAbility: '',
    reference: 'Proverbs 2:16-17',
  },
  'Daniel Soul Token': {
    name: 'Daniel Soul Token',
    set: '',
    imgFile: '/gameplay/daniel_soul_token.png',
    cardType: 'Lost Soul',
    brigade: '',
    strength: '',
    toughness: '',
    alignment: 'Neutral',
    identifier: '',
    specialAbility: '',
    reference: '',
  },
};

export function findTokenCard(name: string): TokenCardData | undefined {
  return TOKEN_CARD_DATA[name];
}
