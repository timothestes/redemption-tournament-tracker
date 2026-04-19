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

export type CardAbility =
  | { type: 'spawn_token'; tokenName: string; count?: number; defaultZone?: ZoneId }
  | { type: 'shuffle_and_draw'; shuffleCount: number; drawCount: number }
  | { type: 'all_players_shuffle_and_draw'; shuffleCount: number; drawCount: number }
  | { type: 'reveal_own_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'custom'; reducerName: string; label: string };

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
};

export function getAbilitiesForCard(identifier: string): CardAbility[] {
  return CARD_ABILITIES[identifier] ?? [];
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
