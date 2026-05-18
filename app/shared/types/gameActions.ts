import type { GameCard } from '@/app/goldfish/types';

/**
 * Targeting request issued by the menu when the player picks an ability that
 * needs a follow-up card click (currently only `imitate_lost_soul`). The
 * canvas owns the state — it stores the request, dims ineligible cards, and
 * routes the next eligible card click through `onSelect`.
 */
export interface TargetingRequest {
  prompt: string;
  isEligible: (card: GameCard) => boolean;
  onSelect: (targetInstanceId: string) => void;
  onCancel: () => void;
}

/**
 * Common interface for game actions shared between goldfish and multiplayer modes.
 * All IDs are strings — multiplayer adapter converts to bigint internally.
 */
export interface GameActions {
  // Core card operations
  moveCard(cardId: string, toZone: string, posX?: string, posY?: string): void;
  moveCardsBatch(cardIds: string[], toZone: string): void;
  flipCard(cardId: string): void;
  meekCard(cardId: string): void;
  unmeekCard(cardId: string): void;
  addCounter(cardId: string, color: string): void;
  removeCounter(cardId: string, color: string): void;
  shuffleCardIntoDeck(cardId: string): void;
  shuffleDeck(): void;
  randomHandToZone(count: number, toZone: string, deckPosition: string): void;
  randomReserveToZone(count: number, toZone: string, deckPosition: string): void;
  reloadDeck: (deckId: string, deckData: string, paragon: string) => void;
  setNote(cardId: string, text: string): void;
  exchangeCards(cardIds: string[]): void;
  drawCard(): void;
  drawMultiple(count: number): void;

  // Deck position operations (available in both modes)
  moveCardToTopOfDeck(cardId: string): void;
  moveCardToBottomOfDeck(cardId: string): void;

  // Token operations (optional — not all modes may support)
  spawnLostSoul?(testament: 'NT' | 'OT', posX?: string, posY?: string): void;
  removeToken?(cardId: string): void;
  removeOpponentToken?(cardId: string): void;

  // Deck inspection (optional — may not be available in all modes)
  searchDeck?(): void;
  peekTopN?(count: number): void;

  // Equip weapon to warrior (optional — implemented by both goldfish and multiplayer)
  attachCard?(weaponId: string, warriorId: string): void;
  detachCard?(cardId: string, posX?: number, posY?: number): void;

  // Custom per-card abilities (optional — registry-driven right-click actions).
  // Implemented by both goldfish and multiplayer. See lib/cards/cardAbilities.ts.
  executeCardAbility?(sourceInstanceId: string, abilityIndex: number): void;

  // Per-card hand reveal (optional — implemented by both goldfish and multiplayer).
  // Temporarily reveals a single hand card to opponents/spectators for 30 seconds.
  // Duration is fixed at the callee — callers don't pass it.
  revealCardInHand?(cardId: string): void;

  // Imitate Lost Soul ability (optional — implemented by both goldfish and multiplayer).
  // beginTargeting puts the canvas into "click a card" mode for ability flows
  // that need a follow-up target; CardContextMenu calls it for the
  // `imitate_lost_soul` ability variant.
  imitateLostSoul?(sourceInstanceId: string, targetInstanceId: string): void;
  stopImitatingLostSoul?(sourceInstanceId: string): void;
  beginTargeting?(req: TargetingRequest): void;
}
