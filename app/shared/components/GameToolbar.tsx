'use client';

import { useCallback } from 'react';
import {
  Play,
  Undo2,
  RotateCcw,
  PanelBottomOpen,
  Dices,
  SkipForward,
  Hand,
} from 'lucide-react';
import type { GameActions } from '../types/gameActions';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GameToolbarProps {
  /** Game action dispatcher (shared interface). */
  actions: GameActions;
  /** Which mode the toolbar is rendering in. */
  mode: 'goldfish' | 'multiplayer';
  /** Whether it's the local player's turn (multiplayer only). */
  isMyTurn?: boolean;
  /** Whether the hand is in "spread" / "unfanned" layout. */
  isSpreadHand: boolean;
  /** Toggle spread hand layout. */
  onToggleSpreadHand: () => void;
  /** Cards remaining in deck. */
  deckCount: number;
  /** Cards currently in hand. */
  handCount: number;
  /** Called to trigger a dice roll animation. */
  onRollDice: () => void;
  /** Called to show a toast message (e.g. "Deck is empty"). */
  onShowToast?: (message: string) => void;
  /** Called for undo (goldfish only). */
  onUndo?: () => void;
  /** Called for new game (goldfish only). */
  onNewGame?: () => void;
  /** Called for end turn (multiplayer only). */
  onEndTurn?: () => void;
  /** Called to request action priority (multiplayer, non-active player). */
  onRequestPriority?: () => void;
  /** Whether a priority request is currently pending. */
  hasPendingPriority?: boolean;
  /** Game is finished — keep toolbar active for review but disable end turn. */
  isFinished?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GameToolbar({
  actions,
  mode,
  isMyTurn,
  isSpreadHand,
  onToggleSpreadHand,
  deckCount,
  handCount,
  onRollDice,
  onShowToast,
  onUndo,
  onNewGame,
  onEndTurn,
  onRequestPriority,
  hasPendingPriority,
  isFinished,
}: GameToolbarProps) {
  const isMultiplayer = mode === 'multiplayer';
  const disabled = isMultiplayer && !isMyTurn && !isFinished;

  const handleDraw = useCallback(() => {
    if (handCount >= 16) {
      onShowToast?.('Hand is full (max 16 cards)');
      return;
    }
    if (deckCount === 0) {
      onShowToast?.('Deck is empty');
      return;
    }
    actions.drawCard();
  }, [actions, handCount, deckCount, onShowToast]);

  const handleRollDice = useCallback(() => {
    onRollDice();
  }, [onRollDice]);

  // Build button list — filter based on mode
  interface ToolbarButton {
    icon: typeof Play;
    label: string;
    onClick: () => void;
    shortcut: string;
    disabled?: boolean;
    hidden?: boolean;
  }

  const buttons: ToolbarButton[] = [
    {
      icon: Play,
      label: 'Draw',
      onClick: handleDraw,
      shortcut: 'D',
    },
    {
      icon: Dices,
      label: 'Roll',
      onClick: handleRollDice,
      shortcut: 'R',
    },
    // Undo — goldfish only
    {
      icon: Undo2,
      label: 'Undo',
      onClick: onUndo ?? (() => {}),
      shortcut: '\u2318Z',
      hidden: isMultiplayer,
    },
    {
      icon: PanelBottomOpen,
      label: isSpreadHand ? 'Fan' : 'Unfan',
      onClick: onToggleSpreadHand,
      shortcut: 'H',
    },
    // New Game — goldfish only
    {
      icon: RotateCcw,
      label: 'New Game',
      onClick: onNewGame ?? (() => {}),
      shortcut: '',
      hidden: isMultiplayer,
    },
    // End Turn (active player) or Request Priority (non-active player) — multiplayer only
    ...(isMultiplayer && isMyTurn ? [{
      icon: SkipForward,
      label: 'End Turn',
      onClick: onEndTurn ?? (() => {}),
      shortcut: '',
      disabled: !!isFinished,
    }] : isMultiplayer && !isMyTurn && !isFinished ? [{
      icon: Hand,
      label: hasPendingPriority ? 'Pending...' : 'Priority',
      onClick: onRequestPriority ?? (() => {}),
      shortcut: '',
      disabled: !!hasPendingPriority,
    }] : []),
  ];

  const visibleButtons = buttons.filter(b => !b.hidden);

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        bottom: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 12px',
        background: 'rgba(30,22,16,0.92)',
        border: '1px solid var(--gf-border)',
        borderRadius: 8,
        zIndex: 200,
      }}
    >
      {visibleButtons.map(({ icon: Icon, label, onClick, shortcut, disabled: btnDisabled }) => (
        <button
          key={label}
          onClick={onClick}
          disabled={btnDisabled}
          title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            padding: '4px 10px',
            background: 'transparent',
            border: 'none',
            cursor: btnDisabled ? 'not-allowed' : 'pointer',
            color: btnDisabled ? 'var(--gf-border-dim)' : 'var(--gf-text)',
            borderRadius: 4,
            transition: 'background 0.15s, color 0.15s',
            opacity: btnDisabled ? 0.5 : 1,
          }}
          onMouseEnter={(e) => {
            if (!btnDisabled) {
              e.currentTarget.style.background = 'var(--gf-hover)';
              e.currentTarget.style.color = 'var(--gf-text-bright)';
            }
          }}
          onMouseLeave={(e) => {
            if (!btnDisabled) {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--gf-text)';
            }
          }}
        >
          <Icon size={18} />
          <span
            style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 8,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}
