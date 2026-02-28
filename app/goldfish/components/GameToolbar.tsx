'use client';

import { useCallback } from 'react';
import { useGame } from '../state/GameContext';
import {
  Play,
  Undo2,
  RotateCcw,
  PanelBottomOpen,
} from 'lucide-react';
import { showGameToast } from './GameToast';

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

  const buttons = [
    { icon: Play, label: 'Draw', onClick: handleDraw, shortcut: 'D' },
    { icon: Undo2, label: 'Undo', onClick: undo, shortcut: '⌘Z' },
    { icon: RotateCcw, label: 'New Game', onClick: newGame, shortcut: '' },
    { icon: PanelBottomOpen, label: 'Spread', onClick: toggleSpreadHand, shortcut: 'H' },
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
        border: '1px solid #6b4e27',
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
            color: '#c9b99a',
            borderRadius: 4,
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(196,149,90,0.15)';
            e.currentTarget.style.color = '#e8d5a3';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = '#c9b99a';
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
