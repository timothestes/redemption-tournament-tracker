'use client';

import { useCallback, useMemo } from 'react';
import { useGame } from '../state/GameContext';
import { GameToolbar as SharedGameToolbar } from '../../shared/components/GameToolbar';
import { showGameToast } from './GameToast';
import { triggerDiceRoll } from './DiceRollOverlay';
import type { GameActions } from '../../shared/types/gameActions';

/**
 * Goldfish-mode adapter for the shared GameToolbar.
 * Reads from useGame() context and passes props to the shared component.
 */
export function GameToolbar() {
  const {
    state,
    drawCard,
    drawMultiple,
    moveCard,
    moveCardsBatch,
    moveCardToTopOfDeck,
    moveCardToBottomOfDeck,
    shuffleCardIntoDeck,
    shuffleDeck,
    flipCard,
    meekCard,
    unmeekCard,
    addCounter,
    removeCounter,
    addNote,
    removeOpponentToken,
    undo,
    newGame,
    toggleSpreadHand,
  } = useGame();

  // Adapt the goldfish context methods into the shared GameActions interface
  const actions: GameActions = useMemo(() => ({
    drawCard,
    drawMultiple,
    moveCard: (cardId: string, toZone: string, posX?: string, posY?: string) => {
      moveCard(
        cardId,
        toZone as any,
        undefined,
        posX ? parseFloat(posX) : undefined,
        posY ? parseFloat(posY) : undefined,
      );
    },
    moveCardsBatch: (cardIds: string[], toZone: string) => {
      moveCardsBatch(cardIds, toZone as any);
    },
    flipCard,
    meekCard,
    unmeekCard,
    addCounter: (cardId: string, color: string) => addCounter(cardId, color as any),
    removeCounter: (cardId: string, color: string) => removeCounter(cardId, color as any),
    shuffleCardIntoDeck,
    shuffleDeck,
    setNote: addNote,
    exchangeCards: () => {}, // not used in goldfish
    moveCardToTopOfDeck,
    moveCardToBottomOfDeck,
    removeOpponentToken,
  }), [
    drawCard, drawMultiple, moveCard, moveCardsBatch, flipCard,
    meekCard, unmeekCard, addCounter, removeCounter,
    shuffleCardIntoDeck, shuffleDeck, addNote,
    moveCardToTopOfDeck, moveCardToBottomOfDeck, removeOpponentToken,
  ]);

  const handleRollDice = useCallback(() => {
    triggerDiceRoll();
  }, []);

  return (
    <SharedGameToolbar
      actions={actions}
      mode="goldfish"
      isSpreadHand={state.isSpreadHand}
      onToggleSpreadHand={toggleSpreadHand}
      deckCount={state.zones.deck.length}
      handCount={state.zones.hand.length}
      onRollDice={handleRollDice}
      onShowToast={showGameToast}
      onUndo={undo}
      onNewGame={newGame}
    />
  );
}
