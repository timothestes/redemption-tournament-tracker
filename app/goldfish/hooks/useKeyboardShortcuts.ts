'use client';

import { useEffect, useCallback } from 'react';
import { useGame } from '../state/GameContext';
import { showGameToast } from '../components/GameToast';

export function useKeyboardShortcuts() {
  const { state, drawCard, shuffleDeck, undo, newGame, advancePhase, endTurn, toggleSpreadHand } = useGame();

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

      switch (e.key.toLowerCase()) {
        case 'd':
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
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            shuffleDeck();
          }
          break;
        case 'r': {
          e.preventDefault();
          const result = Math.floor(Math.random() * 6) + 1;
          const pips = ['', '\u2680', '\u2681', '\u2682', '\u2683', '\u2684', '\u2685'];
          showGameToast(`${pips[result]}  Rolled a ${result}`);
          break;
        }
        case 'h':
          e.preventDefault();
          toggleSpreadHand();
          break;
        case 'enter':
          e.preventDefault();
          advancePhase();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [state.zones.hand.length, state.zones.deck.length, drawCard, shuffleDeck, undo, newGame, advancePhase, endTurn, toggleSpreadHand]);
}
