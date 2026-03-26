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
  reloadDeck: (deckId: string, deckData: string) => void;
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
}
