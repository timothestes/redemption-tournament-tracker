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
  alignment: string;
  isMeek: boolean;
  counters: Counter[];
  isFlipped: boolean;
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
  | 'ADD_PLAYER_LOST_SOUL';

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

export interface GoldfishOptions {
  format: 'T1' | 'T2' | 'Paragon';
  startingHandSize: number;
  autoRouteLostSouls: boolean;
  showPhaseReminder: boolean;
  showTurnCounter: boolean;
  soundEnabled: boolean;
  alwaysStartWith: string[];
}

export const DEFAULT_OPTIONS: GoldfishOptions = {
  format: 'T1',
  startingHandSize: 8,
  autoRouteLostSouls: true,
  showPhaseReminder: true,
  showTurnCounter: true,
  soundEnabled: true,
  alwaysStartWith: [],
};

export interface GameState {
  sessionId: string;
  deckId: string;
  deckName: string;
  isOwner: boolean;
  format: 'T1' | 'T2' | 'Paragon';
  paragonName: string | null;
  turn: number;
  phase: GamePhase;
  zones: Record<ZoneId, GameCard[]>;
  history: GameState[];
  options: GoldfishOptions;
  isSpreadHand: boolean;
  drawnThisTurn: boolean;
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
    card_alignment: string;
    quantity: number;
    is_reserve: boolean;
  }[];
}
