/**
 * Core game card types shared between goldfish and multiplayer modes.
 *
 * Goldfish-specific types (GoldfishOptions, DEFAULT_OPTIONS, GameState)
 * remain in app/goldfish/types.ts and re-export everything from here.
 */

export type ZoneId =
  | 'deck'
  | 'hand'
  | 'reserve'
  | 'discard'
  | 'paragon'
  | 'land-of-bondage'
  | 'territory'
  | 'land-of-redemption'
  | 'banish';

export const ALL_ZONES: ZoneId[] = [
  'deck', 'hand', 'reserve', 'discard', 'paragon',
  'land-of-bondage', 'territory',
  'land-of-redemption', 'banish',
];

export const ZONE_LABELS: Record<ZoneId, string> = {
  'deck': 'Deck',
  'hand': 'Hand',
  'reserve': 'Reserve',
  'discard': 'Discard',
  'paragon': 'Paragon',
  'land-of-bondage': 'Land of Bondage',
  'territory': 'Territory',
  'land-of-redemption': 'Land of Redemption',
  'banish': 'Banish Zone',
};

export type GamePhase = 'setup' | 'draw' | 'upkeep' | 'preparation' | 'battle' | 'discard';

export const PHASE_ORDER: GamePhase[] = ['draw', 'upkeep', 'preparation', 'battle', 'discard'];

export const COUNTER_COLORS = [
  { id: 'red', label: 'Red', hex: '#8b1a1a' },
  { id: 'blue', label: 'Blue', hex: '#1a3a8b' },
  { id: 'green', label: 'Green', hex: '#1a6b1a' },
  { id: 'yellow', label: 'Yellow', hex: '#8b7a1a' },
  { id: 'purple', label: 'Purple', hex: '#6b1a8b' },
  { id: 'white', label: 'White', hex: '#888888' },
] as const;

export type CounterColorId = typeof COUNTER_COLORS[number]['id'];

export interface Counter {
  color: CounterColorId;
  count: number;
}

export interface GameCard {
  instanceId: string;
  cardName: string;
  cardSet: string;
  cardImgFile: string;
  type: string;
  brigade: string;
  strength: string;
  toughness: string;
  specialAbility: string;
  identifier: string;
  reference: string;
  alignment: string;
  isMeek: boolean;
  counters: Counter[];
  isFlipped: boolean;
  isToken: boolean;
  zone: ZoneId;
  ownerId: 'player1' | 'player2';
  notes: string;
  posX?: number;
  posY?: number;
}

export type ActionType =
  | 'MOVE_CARD'
  | 'DRAW_CARD'
  | 'DRAW_MULTIPLE'
  | 'SHUFFLE_DECK'
  | 'ADD_COUNTER'
  | 'REMOVE_COUNTER'
  | 'MEEK_CARD'
  | 'UNMEEK_CARD'
  | 'FLIP_CARD'
  | 'RESET_GAME'
  | 'START_GAME'
  | 'ADVANCE_PHASE'
  | 'REGRESS_PHASE'
  | 'END_TURN'
  | 'ADD_NOTE'
  | 'ADD_OPPONENT_LOST_SOUL'
  | 'REMOVE_OPPONENT_TOKEN'
  | 'SHUFFLE_AND_MOVE_TO_TOP'
  | 'SHUFFLE_AND_MOVE_TO_BOTTOM'
  | 'MOVE_CARDS_BATCH'
  | 'ADD_PLAYER_LOST_SOUL'
  | 'REORDER_HAND'
  | 'REORDER_LOB';

export interface GameAction {
  id: string;
  type: ActionType;
  playerId: 'player1' | 'player2';
  timestamp: number;
  payload: {
    cardInstanceId?: string;
    cardInstanceIds?: string[];
    fromZone?: ZoneId;
    toZone?: ZoneId;
    toIndex?: number;
    quantity?: number;
    value?: number | string;
    color?: CounterColorId;
    posX?: number;
    posY?: number;
    positions?: Record<string, { posX: number; posY: number }>;
  };
}

export interface DeckDataForGoldfish {
  id: string;
  name: string;
  format: string;
  paragon?: string | null;
  isOwner?: boolean;
  cards: {
    card_name: string;
    card_set: string;
    card_img_file: string;
    card_type: string;
    card_brigade: string;
    card_strength: string;
    card_toughness: string;
    card_special_ability: string;
    card_identifier: string;
    card_reference: string;
    card_alignment: string;
    quantity: number;
    is_reserve: boolean;
  }[];
}
