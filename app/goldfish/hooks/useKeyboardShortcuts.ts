'use client';

import { useMemo } from 'react';
import { useGame } from '../state/GameContext';
import { useCardPreview } from '../state/CardPreviewContext';
import { triggerDiceRoll } from '../components/DiceRollOverlay';
import { useGameHotkeys } from '../../shared/hooks/useGameHotkeys';
import type { GameActions } from '../../shared/types/gameActions';

interface KeyboardShortcutOptions {
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}

export function useKeyboardShortcuts(options?: KeyboardShortcutOptions) {
  const { state, drawCard, shuffleDeck, undo, advancePhase, toggleSpreadHand } = useGame();
  const { toggleLoupe } = useCardPreview();

  // Build a GameActions-compatible shim from the goldfish context.
  // Only drawCard and shuffleDeck are invoked by the hotkeys hook;
  // the remaining methods are stubbed to satisfy the interface.
  const actions: GameActions = useMemo(() => ({
    drawCard,
    shuffleDeck,
    moveCard: () => {},
    moveCardsBatch: () => {},
    flipCard: () => {},
    meekCard: () => {},
    unmeekCard: () => {},
    addCounter: () => {},
    removeCounter: () => {},
    shuffleCardIntoDeck: () => {},
    setNote: () => {},
    exchangeCards: () => {},
    drawMultiple: () => {},
    moveCardToTopOfDeck: () => {},
    moveCardToBottomOfDeck: () => {},
    randomHandToZone: () => {},
    randomReserveToZone: () => {},
    reloadDeck: () => {},
  }), [drawCard, shuffleDeck]);

  useGameHotkeys({
    actions,
    mode: 'goldfish',
    onToggleLoupe: toggleLoupe,
    onToggleSpreadHand: toggleSpreadHand,
    onRollDice: triggerDiceRoll,
    onUndo: undo,
    onAdvancePhase: advancePhase,
    onZoomIn: options?.onZoomIn,
    onZoomOut: options?.onZoomOut,
    handSize: state.zones.hand.length,
    deckSize: state.zones.deck.length,
  });
}
