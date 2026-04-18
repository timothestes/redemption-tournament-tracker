'use client';

import { useEffect, useRef } from 'react';
import { Trash2, Archive, ChevronUp, ChevronDown, Shuffle, Eye, EyeOff } from 'lucide-react';
import {
  SubMenuActionRow,
  ITEM_STYLE,
  SEPARATOR_STYLE,
} from './SubMenuActionRow';

interface HandContextMenuProps {
  x: number;
  y: number;
  handSize: number;
  onClose: () => void;
  onRandomToDiscard: (count: number) => void;
  onRandomToReserve: (count: number) => void;
  onRandomToDeckTop: (count: number) => void;
  onRandomToDeckBottom: (count: number) => void;
  onShuffleRandomIntoDeck: (count: number) => void;
  isHandRevealed?: boolean;
  onRevealHand?: (revealed: boolean) => void;
  /** 'own' uses "Hand" + "Reveal/Hide Hand"; 'opponent' uses "Opponent's Hand" + "Request Reveal Hand" and relabels random actions */
  mode?: 'own' | 'opponent';
}

export function HandContextMenu({
  x, y, handSize, onClose,
  onRandomToDiscard,
  onRandomToReserve,
  onRandomToDeckTop,
  onRandomToDeckBottom,
  onShuffleRandomIntoDeck,
  isHandRevealed,
  onRevealHand,
  mode = 'own',
}: HandContextMenuProps) {
  const revealLabel = mode === 'opponent'
    ? (isHandRevealed ? 'Hide Hand' : 'Request Reveal Hand')
    : (isHandRevealed ? 'Hide Hand' : 'Reveal Hand');
  const menuRef = useRef<HTMLDivElement>(null);

  const MENU_WIDTH = 200;
  const rightAligned = x + MENU_WIDTH > window.innerWidth;
  const menuLeft = rightAligned ? Math.max(0, x - MENU_WIDTH) : x;

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: menuLeft,
        top: Math.min(y, window.innerHeight - 300),
        background: 'var(--gf-bg)',
        border: '1px solid var(--gf-border)',
        borderRadius: 6,
        padding: '4px 0',
        zIndex: 900,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        whiteSpace: 'nowrap',
      }}
    >
      {onRevealHand && (
        <button
          style={ITEM_STYLE}
          onClick={() => { onRevealHand(!isHandRevealed); onClose(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {isHandRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
          {revealLabel}
        </button>
      )}

      {onRevealHand && <div style={SEPARATOR_STYLE} />}

      <SubMenuActionRow
        icon={<Trash2 size={14} />}
        label="Random to Discard"
        max={handSize}
        onAction={onRandomToDiscard}
      />
      <SubMenuActionRow
        icon={<Archive size={14} />}
        label="Random to Reserve"
        max={handSize}
        onAction={onRandomToReserve}
      />
      <SubMenuActionRow
        icon={<ChevronUp size={14} />}
        label="Random to Deck Top"
        max={handSize}
        onAction={onRandomToDeckTop}
      />
      <SubMenuActionRow
        icon={<ChevronDown size={14} />}
        label="Random to Deck Bottom"
        max={handSize}
        onAction={onRandomToDeckBottom}
      />
      <SubMenuActionRow
        icon={<Shuffle size={14} />}
        label="Shuffle into Deck"
        max={handSize}
        onAction={onShuffleRandomIntoDeck}
      />
    </div>
  );
}
