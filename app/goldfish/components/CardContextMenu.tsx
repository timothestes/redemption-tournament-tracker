'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useGame } from '../state/GameContext';
import { GameCard, ZoneId, ZONE_LABELS, COUNTER_COLORS, CounterColorId } from '../types';

const MOVE_TARGETS: ZoneId[] = [
  'territory',
  'discard', 'reserve',
];

interface CardContextMenuProps {
  card: GameCard;
  x: number;
  y: number;
  onClose: () => void;
  onExchange?: (cardIds: string[]) => void;
}

export function CardContextMenu({ card: initialCard, x, y, onClose, onExchange }: CardContextMenuProps) {
  const {
    state, moveCard, moveCardToTopOfDeck, moveCardToBottomOfDeck,
    shuffleCardIntoDeck, addCounter, removeCounter,
    meekCard, unmeekCard, flipCard, addNote,
  } = useGame();
  const menuRef = useRef<HTMLDivElement>(null);

  // Read live card data so counters update while menu is open
  const card = useMemo(() => {
    for (const zoneId of Object.keys(state.zones) as ZoneId[]) {
      const found = state.zones[zoneId].find(c => c.instanceId === initialCard.instanceId);
      if (found) return found;
    }
    return initialCard;
  }, [state.zones, initialCard.instanceId]);

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

  const menuStyle: React.CSSProperties = {
    position: 'absolute',
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - 400),
    background: '#2a1f12',
    border: '1px solid #6b4e27',
    borderRadius: 6,
    padding: '4px 0',
    zIndex: 500,
    maxHeight: '80vh',
    overflowY: 'auto',
    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
    whiteSpace: 'nowrap',
  };

  const itemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '8px 16px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#c9b99a',
    fontSize: 13,
    textAlign: 'left',
    fontFamily: 'var(--font-cinzel), Georgia, serif',
  };

  const separatorStyle: React.CSSProperties = {
    height: 1,
    background: '#6b4e27',
    margin: '4px 8px',
    opacity: 0.5,
  };

  const labelStyle: React.CSSProperties = {
    ...itemStyle,
    color: '#8b6532',
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    cursor: 'default',
    padding: '4px 16px 2px',
  };

  const doAction = (fn: () => void) => {
    fn();
    onClose();
  };

  // Get count for a given color
  const getCount = (colorId: CounterColorId): number => {
    const c = card.counters.find(c => c.color === colorId);
    return c?.count ?? 0;
  };

  return (
    <div ref={menuRef} style={menuStyle} onContextMenu={(e) => e.preventDefault()}>

      {/* Counter swatches — only for territory and land-of-bondage */}
      {(card.zone === 'territory' || card.zone === 'land-of-bondage') && (
        <>
          <div style={labelStyle}>Counters</div>
          <div style={{ display: 'flex', gap: 6, padding: '4px 16px 2px' }}>
            {COUNTER_COLORS.filter(c => c.id === 'red' || c.id === 'green' || c.id === 'blue').map((color) => {
              const count = getCount(color.id);
              return (
                <button
                  key={color.id}
                  title={`${color.label}${count > 0 ? ` (${count})` : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    addCounter(card.instanceId, color.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (count > 0) removeCounter(card.instanceId, color.id);
                  }}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    background: color.hex,
                    border: count > 0 ? '2px solid rgba(255,255,255,0.8)' : '2px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                    transition: 'transform 0.1s, border-color 0.1s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: 11,
                    fontWeight: 'bold',
                    position: 'relative',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                >
                  {count > 0 ? count : ''}
                </button>
              );
            })}
          </div>
          <div style={{ padding: '0 16px 4px', fontSize: 9, color: '#6b4e27', fontFamily: 'var(--font-cinzel), Georgia, serif' }}>
            Left-click +1 · Right-click -1
          </div>
        </>
      )}

      <button
        style={itemStyle}
        onClick={() => doAction(() => card.isMeek ? unmeekCard(card.instanceId) : meekCard(card.instanceId))}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196,149,90,0.15)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {card.isMeek ? 'Unmeek' : 'Make Meek'}
      </button>

      <button
        style={itemStyle}
        onClick={() => doAction(() => flipCard(card.instanceId))}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196,149,90,0.15)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {card.isFlipped ? 'Turn Face-Up' : 'Turn Face-Down'}
      </button>

      <div style={separatorStyle} />
      <div style={labelStyle}>Move to...</div>

      {/* Deck actions */}
      <button
        style={itemStyle}
        onClick={() => doAction(() => moveCardToTopOfDeck(card.instanceId))}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196,149,90,0.15)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Top of Deck
      </button>
      <button
        style={itemStyle}
        onClick={() => doAction(() => moveCardToBottomOfDeck(card.instanceId))}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196,149,90,0.15)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Bottom of Deck
      </button>
      <button
        style={itemStyle}
        onClick={() => doAction(() => shuffleCardIntoDeck(card.instanceId))}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196,149,90,0.15)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Shuffle into Deck
      </button>
      {onExchange && card.zone !== 'deck' && (
        <button
          style={itemStyle}
          onClick={() => { onClose(); onExchange([card.instanceId]); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196,149,90,0.15)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Exchange with Deck
        </button>
      )}

      <div style={separatorStyle} />

      {/* Zone targets */}
      {MOVE_TARGETS
        .filter(z => z !== card.zone)
        .map(zoneId => (
          <button
            key={zoneId}
            style={itemStyle}
            onClick={() => doAction(() => moveCard(card.instanceId, zoneId))}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196,149,90,0.15)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {ZONE_LABELS[zoneId]}
          </button>
        ))}
    </div>
  );
}
