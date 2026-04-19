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
  | { type: 'custom'; reducerName: string; label: string };

export const CARD_ABILITIES: Record<string, CardAbility[]> = {
  'Two Possessed (GoC)':        [{ type: 'spawn_token', tokenName: 'Violent Possessor Token', count: 2 }],
  'The Accumulator (GoC)':      [{ type: 'spawn_token', tokenName: 'Wicked Spirit Token' }],
  'The Proselytizers (GoC)':    [{ type: 'spawn_token', tokenName: 'Proselyte Token' }],
  'The Church of Christ (GoC)': [{ type: 'spawn_token', tokenName: 'Follower Token' }],
  'Angel of the Harvest (GoC)': [{ type: 'spawn_token', tokenName: 'Heavenly Host Token' }],
  'The Heavenly Host (GoC)':    [{ type: 'spawn_token', tokenName: 'Heavenly Host Token' }],
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
};

export function findTokenCard(name: string): TokenCardData | undefined {
  return TOKEN_CARD_DATA[name];
}
