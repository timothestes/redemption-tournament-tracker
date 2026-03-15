'use client';

import { useCallback } from 'react';
import { useGame } from '../state/GameContext';
import {
  Play,
  Undo2,
  RotateCcw,
  PanelBottomOpen,
  Dices,
} from 'lucide-react';
import { showGameToast } from './GameToast';
import { triggerDiceRoll } from './DiceRollOverlay';

export function GameToolbar() {
  const {
    state,
    drawCard,
    undo,
    newGame,
    toggleSpreadHand,
  } = useGame();

  const handleDraw = useCallback(() => {
    if (state.zones.hand.length >= 16) {
      showGameToast('Hand is full (max 16 cards)');
      return;
    }
    if (state.zones.deck.length === 0) {
      showGameToast('Deck is empty');
      return;
    }
    drawCard();
  }, [drawCard, state.zones.hand.length, state.zones.deck.length]);

  const handleRollDice = useCallback(() => {
    triggerDiceRoll();
  }, []);

  const buttons = [
    { icon: Play, label: 'Draw', onClick: handleDraw, shortcut: 'D' },
    { icon: Dices, label: 'Roll', onClick: handleRollDice, shortcut: 'R' },
    { icon: Undo2, label: 'Undo', onClick: undo, shortcut: '⌘Z' },
    { icon: PanelBottomOpen, label: state.isSpreadHand ? 'Fan' : 'Unfan', onClick: toggleSpreadHand, shortcut: 'H' },
    { icon: RotateCcw, label: 'New Game', onClick: newGame, shortcut: '' },
  ];

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
      {buttons.map(({ icon: Icon, label, onClick, shortcut }) => (
        <button
          key={label}
          onClick={onClick}
          title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            padding: '4px 10px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--gf-text)',
            borderRadius: 4,
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--gf-hover)';
            e.currentTarget.style.color = 'var(--gf-text-bright)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--gf-text)';
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
