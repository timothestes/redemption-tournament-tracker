'use client';

import { useEffect, useCallback } from 'react';
import { useGame } from '../state/GameContext';
import { useCardPreview } from '../state/CardPreviewContext';
import { showGameToast } from '../components/GameToast';
import { triggerDiceRoll } from '../components/DiceRollOverlay';

export function useKeyboardShortcuts() {
  const { state, drawCard, shuffleDeck, undo, newGame, advancePhase, endTurn, toggleSpreadHand } = useGame();
  const { toggleLoupe } = useCardPreview();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Ctrl/Cmd+Z for undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
        return;
      }

      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          toggleLoupe();
          break;
        case 'd':
        case 'D':
          e.preventDefault();
          if (state.zones.hand.length >= 16) {
            showGameToast('Hand is full (max 16 cards)');
          } else if (state.zones.deck.length === 0) {
            showGameToast('Deck is empty');
          } else {
            drawCard();
          }
          break;
        case 's':
        case 'S':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            shuffleDeck();
          }
          break;
        case 'r':
        case 'R': {
          e.preventDefault();
          triggerDiceRoll();
          break;
        }
        case 'h':
        case 'H':
          e.preventDefault();
          toggleSpreadHand();
          break;
        case 'Enter':
          e.preventDefault();
          advancePhase();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [state.zones.hand.length, state.zones.deck.length, drawCard, shuffleDeck, undo, newGame, advancePhase, endTurn, toggleSpreadHand, toggleLoupe]);
}
