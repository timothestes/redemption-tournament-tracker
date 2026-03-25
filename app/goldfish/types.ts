// Re-export all shared game types so existing goldfish imports continue to work.
export type {
  ZoneId,
  GamePhase,
  CounterColorId,
  Counter,
  GameCard,
  ActionType,
  GameAction,
  DeckDataForGoldfish,
} from '../shared/types/gameCard';

export {
  ALL_ZONES,
  ZONE_LABELS,
  PHASE_ORDER,
  COUNTER_COLORS,
} from '../shared/types/gameCard';

// --- Goldfish-specific types (not shared) ---

import type { GamePhase, ZoneId, GameCard } from '../shared/types/gameCard';

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
