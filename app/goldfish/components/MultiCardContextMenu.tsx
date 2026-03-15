'use client';

import { useEffect, useRef, useState } from 'react';
import { useGame } from '../state/GameContext';
import { ZoneId, ZONE_LABELS } from '../types';

const MOVE_TARGETS: ZoneId[] = [
  'territory', 'hand', 'discard', 'reserve',
  'land-of-bondage', 'land-of-redemption', 'banish',
];

interface MultiCardContextMenuProps {
  selectedIds: string[];
  x: number;
  y: number;
  onClose: () => void;
  onClearSelection: () => void;
  onExchange?: (cardIds: string[]) => void;
}

export function MultiCardContextMenu({ selectedIds, x, y, onClose, onClearSelection, onExchange }: MultiCardContextMenuProps) {
  const {
    state, moveCardsBatch, shuffleDeck,
    meekCard, unmeekCard, flipCard,
    moveCardToTopOfDeck, moveCardToBottomOfDeck,
    removeOpponentToken,
  } = useGame();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({ left: x, top: y, ready: false });

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

  // Measure after mount, compute final position, then reveal
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const parent = menu.offsetParent as HTMLElement | null;
    const parentRect = parent?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

    let left = x;
    let top = y;

    if (left + rect.width > parentRect.width) {
      left = Math.max(0, parentRect.width - rect.width - 8);
    }
    if (top + rect.height > parentRect.height) {
      top = Math.max(8, top - rect.height);
    }

    setPos({ left, top, ready: true });
  }, [x, y]);

  const menuStyle: React.CSSProperties = {
    position: 'absolute',
    left: pos.left,
    top: pos.top,
    background: 'var(--gf-bg)',
    border: '1px solid var(--gf-border)',
    borderRadius: 6,
    padding: '4px 0',
    zIndex: 600,
    minWidth: 180,
    maxHeight: '80vh',
    overflowY: 'auto',
    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
    // Hidden until position is measured and finalized — prevents the visible jump
    visibility: pos.ready ? 'visible' : 'hidden',
  };

  const itemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '6px 14px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--gf-text)',
    fontSize: 12,
    textAlign: 'left',
    fontFamily: 'var(--font-cinzel), Georgia, serif',
  };

  const separatorStyle: React.CSSProperties = {
    height: 1,
    background: 'var(--gf-border)',
    margin: '4px 8px',
    opacity: 0.5,
  };

  const labelStyle: React.CSSProperties = {
    ...itemStyle,
    color: 'var(--gf-text-dim)',
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    cursor: 'default',
    padding: '4px 14px 2px',
  };

  const doAction = (fn: () => void) => {
    fn();
    onClearSelection();
    onClose();
  };

  // Find the cards in the current game state
  const selectedCards = selectedIds.flatMap(id => {
    for (const zoneId of Object.keys(state.zones) as ZoneId[]) {
      const card = state.zones[zoneId].find(c => c.instanceId === id);
      if (card) return [card];
    }
    return [];
  });

  const meekCount = selectedCards.filter(c => c.isMeek).length;
  const flippedCount = selectedCards.filter(c => c.isFlipped).length;
  const allTokens = selectedCards.length > 0 && selectedCards.every(c => c.ownerId === 'player2');

  const hoverHandlers = {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'var(--gf-hover)'; },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'transparent'; },
  };

  if (allTokens) {
    return (
      <div ref={menuRef} style={menuStyle} onContextMenu={(e) => e.preventDefault()}>
        <div style={{ ...labelStyle, color: 'var(--gf-text-bright)', fontSize: 11 }}>
          {selectedIds.length} tokens selected
        </div>
        <div style={separatorStyle} />
        <button
          style={itemStyle}
          onClick={() => doAction(() => moveCardsBatch(selectedIds, 'land-of-redemption'))}
          {...hoverHandlers}
        >
          Rescue to L.O.R.
        </button>
        <div style={separatorStyle} />
        <button
          style={{ ...itemStyle, color: '#8b4a4a' }}
          onClick={() => doAction(() => { for (const id of selectedIds) removeOpponentToken(id); })}
          {...hoverHandlers}
        >
          Remove Tokens
        </button>
      </div>
    );
  }

  return (
    <div ref={menuRef} style={menuStyle} onContextMenu={(e) => e.preventDefault()}>
      {/* Header */}
      <div style={{ ...labelStyle, color: 'var(--gf-text-bright)', fontSize: 11 }}>
        {selectedIds.length} cards selected
      </div>
      <div style={separatorStyle} />

      {/* Move to zones */}
      <div style={labelStyle}>Move to...</div>
      {MOVE_TARGETS.map(zoneId => (
        <button
          key={zoneId}
          style={itemStyle}
          onClick={() => doAction(() => moveCardsBatch(selectedIds, zoneId))}
          {...hoverHandlers}
        >
          {ZONE_LABELS[zoneId]}
        </button>
      ))}

      <div style={separatorStyle} />

      {/* Deck operations */}
      <div style={labelStyle}>Deck...</div>
      <button
        style={itemStyle}
        onClick={() => doAction(() => {
          // Move each card to top of deck in order
          for (const id of selectedIds) {
            moveCardToTopOfDeck(id);
          }
        })}
        {...hoverHandlers}
      >
        Top of Deck
      </button>
      <button
        style={itemStyle}
        onClick={() => doAction(() => {
          for (const id of selectedIds) {
            moveCardToBottomOfDeck(id);
          }
        })}
        {...hoverHandlers}
      >
        Bottom of Deck
      </button>
      <button
        style={itemStyle}
        onClick={() => doAction(() => {
          moveCardsBatch(selectedIds, 'deck');
          shuffleDeck();
        })}
        {...hoverHandlers}
      >
        Shuffle into Deck
      </button>
      {onExchange && (
        <button
          style={itemStyle}
          onClick={() => { onClose(); onExchange(selectedIds); }}
          {...hoverHandlers}
        >
          Exchange with Deck
        </button>
      )}

      <div style={separatorStyle} />

      {/* Bulk card operations */}
      <button
        style={itemStyle}
        onClick={() => doAction(() => {
          // If most are meek, unmeek all; otherwise meek all
          const shouldUnmeek = meekCount > selectedCards.length / 2;
          for (const card of selectedCards) {
            if (shouldUnmeek && card.isMeek) unmeekCard(card.instanceId);
            else if (!shouldUnmeek && !card.isMeek) meekCard(card.instanceId);
          }
        })}
        {...hoverHandlers}
      >
        {meekCount > selectedCards.length / 2 ? 'Unmeek All' : 'Meek All'}
      </button>

      <button
        style={itemStyle}
        onClick={() => doAction(() => {
          const shouldFlipUp = flippedCount > selectedCards.length / 2;
          for (const card of selectedCards) {
            if (shouldFlipUp && card.isFlipped) flipCard(card.instanceId);
            else if (!shouldFlipUp && !card.isFlipped) flipCard(card.instanceId);
          }
        })}
        {...hoverHandlers}
      >
        {flippedCount > selectedCards.length / 2 ? 'Flip All Face-Up' : 'Flip All Face-Down'}
      </button>

      <div style={separatorStyle} />

      <button
        style={itemStyle}
        onClick={() => { onClearSelection(); onClose(); }}
        {...hoverHandlers}
      >
        Deselect
      </button>
    </div>
  );
}
