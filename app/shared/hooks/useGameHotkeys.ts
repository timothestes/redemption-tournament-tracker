'use client';

import { useEffect } from 'react';
import type { GameActions } from '../types/gameActions';
import { showGameToast } from '../components/GameToast';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface GameHotkeysConfig {
  actions: GameActions;
  mode: 'goldfish' | 'multiplayer';
  /** In multiplayer, is it the local player's turn? Ignored in goldfish. */
  isMyTurn?: boolean;
  /** Toggle the card loupe / preview panel (Tab). */
  onToggleLoupe?: () => void;
  /** Toggle the spread-hand fan view (H). */
  onToggleSpreadHand?: () => void;
  /** Trigger a dice roll overlay (R). */
  onRollDice?: () => void;
  /** Undo the last action — goldfish only (Ctrl/Cmd+Z). */
  onUndo?: () => void;
  /** Advance the current phase (Enter). */
  onAdvancePhase?: () => void;
  /** Master switch — set to false to suppress all hotkeys. */
  enabled?: boolean;
  /**
   * Extra state needed for draw-card validation.
   * Both modes track hand size and deck size so the hook can show
   * helpful toasts instead of silently failing.
   */
  handSize?: number;
  deckSize?: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Shared keyboard-shortcut hook for goldfish and multiplayer game modes.
 *
 * Keybindings:
 *   D         — draw a card (turn-gated in multiplayer)
 *   S         — shuffle deck (turn-gated in multiplayer)
 *   R         — roll dice (always enabled)
 *   H         — toggle hand spread
 *   Tab       — toggle loupe / card preview
 *   Enter     — advance phase (turn-gated in multiplayer)
 *   Ctrl/Cmd+Z — undo (goldfish only)
 *   Escape    — handled separately by the selection system
 */
export function useGameHotkeys(config: GameHotkeysConfig) {
  const {
    actions,
    mode,
    isMyTurn = true,
    onToggleLoupe,
    onToggleSpreadHand,
    onRollDice,
    onUndo,
    onAdvancePhase,
    enabled = true,
    handSize = 0,
    deckSize = 0,
  } = config;

  useEffect(() => {
    if (!enabled) return;

    /** Whether the action requires it to be the local player's turn. */
    const canAct = mode === 'goldfish' || isMyTurn;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Ctrl/Cmd+Z — undo (goldfish only)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (mode === 'goldfish' && onUndo) {
          e.preventDefault();
          onUndo();
        }
        return;
      }

      switch (e.key) {
        // Tab — toggle loupe
        case 'Tab':
          e.preventDefault();
          onToggleLoupe?.();
          break;

        // D — draw card (turn-gated)
        case 'd':
        case 'D':
          e.preventDefault();
          if (!canAct) {
            showGameToast("Wait for your turn");
          } else if (handSize >= 16) {
            showGameToast('Hand is full (max 16 cards)');
          } else if (deckSize === 0) {
            showGameToast('Deck is empty');
          } else {
            actions.drawCard();
          }
          break;

        // S — shuffle deck (turn-gated, skip when Ctrl/Cmd+S)
        case 's':
        case 'S':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            if (!canAct) {
              showGameToast("Wait for your turn");
            } else {
              actions.shuffleDeck();
            }
          }
          break;

        // R — roll dice (always enabled)
        case 'r':
        case 'R':
          e.preventDefault();
          onRollDice?.();
          break;

        // H — toggle hand spread
        case 'h':
        case 'H':
          e.preventDefault();
          onToggleSpreadHand?.();
          break;

        // Enter — advance phase (turn-gated)
        case 'Enter':
          e.preventDefault();
          if (!canAct) {
            showGameToast("Wait for your turn");
          } else {
            onAdvancePhase?.();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    enabled,
    mode,
    isMyTurn,
    actions,
    handSize,
    deckSize,
    onToggleLoupe,
    onToggleSpreadHand,
    onRollDice,
    onUndo,
    onAdvancePhase,
  ]);
}
