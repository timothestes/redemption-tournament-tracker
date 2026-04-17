'use client';

import { useEffect, useRef, useMemo } from 'react';
import { GameCard, ZoneId, ZONE_LABELS, COUNTER_COLORS, CounterColorId } from '../../goldfish/types';
import { GameActions } from '@/app/shared/types/gameActions';

const MOVE_TARGETS: ZoneId[] = [
  'territory',
  'discard', 'reserve',
];

const LOST_SOUL_EXCLUDED_TARGETS: ZoneId[] = ['territory', 'discard', 'reserve'];

function isLostSoul(card: GameCard): boolean {
  return card.type === 'LS' || card.type === 'Lost Soul' || card.type.toLowerCase().includes('lost soul');
}

interface CardContextMenuProps {
  card: GameCard;
  x: number;
  y: number;
  actions: GameActions;
  onClose: () => void;
  onExchange?: (cardIds: string[]) => void;
  /** Live zone state for reading updated card data (counters, etc.) */
  zones?: Record<ZoneId, GameCard[]>;
}

export function CardContextMenu({ card: initialCard, x, y, actions, onClose, onExchange, zones }: CardContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Read live card data so counters update while menu is open
  const card = useMemo(() => {
    if (!zones) return initialCard;
    for (const zoneId of Object.keys(zones) as ZoneId[]) {
      const found = zones[zoneId].find(c => c.instanceId === initialCard.instanceId);
      if (found) return found;
    }
    return initialCard;
  }, [zones, initialCard]);

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
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - 400),
    background: 'var(--gf-bg)',
    border: '1px solid var(--gf-border)',
    borderRadius: 6,
    padding: '4px 0',
    zIndex: 900,
    maxHeight: '80vh',
    overflowY: 'auto',
    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
    whiteSpace: 'nowrap',
  };

  const itemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '6px 14px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--gf-text)',
    fontSize: 13,
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

  // Opponent tokens get a simplified menu
  if (card.isToken) {
    return (
      <div ref={menuRef} style={menuStyle} onContextMenu={(e) => e.preventDefault()}>
        <div style={labelStyle}>{card.cardName}</div>
        <button
          style={itemStyle}
          onClick={() => doAction(() => actions.moveCard(card.instanceId, 'land-of-redemption'))}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Rescue to L.O.R.
        </button>
        {actions.removeOpponentToken && (
          <>
            <div style={separatorStyle} />
            <button
              style={{ ...itemStyle, color: '#8b4a4a' }}
              onClick={() => doAction(() => actions.removeOpponentToken!(card.instanceId))}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Remove Token
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div ref={menuRef} style={menuStyle} onContextMenu={(e) => e.preventDefault()}>

      {/* Counter swatches — only for territory and land-of-bondage */}
      {(card.zone === 'territory' || card.zone === 'land-of-bondage') && (
        <>
          <div style={labelStyle}>Counters</div>
          <div style={{ display: 'flex', gap: 6, padding: '4px 16px 2px', alignItems: 'center' }}>
            {COUNTER_COLORS.filter(c => c.id === 'red' || c.id === 'green' || c.id === 'blue').map((color) => {
              const count = getCount(color.id);
              return (
                <button
                  key={color.id}
                  title={`${color.label}${count > 0 ? ` (${count})` : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.addCounter(card.instanceId, color.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (count > 0) actions.removeCounter(card.instanceId, color.id);
                  }}
                  style={{
                    width: 32,
                    height: 32,
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
            {card.counters.some(c => c.count > 0) && (
              <button
                title="Clear all counters"
                aria-label="Clear all counters"
                onClick={(e) => {
                  e.stopPropagation();
                  card.counters.forEach(c => {
                    for (let i = 0; i < c.count; i++) {
                      actions.removeCounter(card.instanceId, c.color);
                    }
                  });
                }}
                style={{
                  width: 22,
                  height: 22,
                  marginLeft: 2,
                  borderRadius: '50%',
                  background: 'transparent',
                  border: '1px solid var(--gf-border)',
                  cursor: 'pointer',
                  transition: 'transform 0.1s, border-color 0.1s, color 0.1s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--gf-text-dim)',
                  fontSize: 12,
                  lineHeight: 1,
                  padding: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.15)';
                  e.currentTarget.style.color = 'var(--gf-text)';
                  e.currentTarget.style.borderColor = 'var(--gf-text-dim)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.color = 'var(--gf-text-dim)';
                  e.currentTarget.style.borderColor = 'var(--gf-border)';
                }}
              >
                ×
              </button>
            )}
          </div>
          <div style={{ padding: '0 16px 4px', fontSize: 9, color: 'var(--gf-border)', fontFamily: 'var(--font-cinzel), Georgia, serif' }}>
            Left-click +1 · Right-click -1
          </div>
        </>
      )}

      <button
        style={itemStyle}
        onClick={() => doAction(() => card.isMeek ? actions.unmeekCard(card.instanceId) : actions.meekCard(card.instanceId))}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {card.isMeek ? 'Unmeek' : 'Make Meek'}
      </button>

      <button
        style={itemStyle}
        onClick={() => doAction(() => actions.flipCard(card.instanceId))}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {card.isFlipped ? 'Turn Face-Up' : 'Turn Face-Down'}
      </button>

      <div style={separatorStyle} />

      {/* Zone targets */}
      <div style={labelStyle}>Move to...</div>
      {MOVE_TARGETS
        .filter(z => z !== card.zone)
        .filter(z => !isLostSoul(card) || !LOST_SOUL_EXCLUDED_TARGETS.includes(z))
        .map(zoneId => (
          <button
            key={zoneId}
            style={itemStyle}
            onClick={() => doAction(() => actions.moveCard(card.instanceId, zoneId))}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {ZONE_LABELS[zoneId]}
          </button>
        ))}

      <div style={separatorStyle} />
      <div style={labelStyle}>Deck...</div>

      {/* Deck actions */}
      {actions.moveCardToTopOfDeck && (
        <button
          style={itemStyle}
          onClick={() => doAction(() => actions.moveCardToTopOfDeck!(card.instanceId))}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Top of Deck
        </button>
      )}
      {actions.moveCardToBottomOfDeck && (
        <button
          style={itemStyle}
          onClick={() => doAction(() => actions.moveCardToBottomOfDeck!(card.instanceId))}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Bottom of Deck
        </button>
      )}
      <button
        style={itemStyle}
        onClick={() => doAction(() => actions.shuffleCardIntoDeck(card.instanceId))}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Shuffle into Deck
      </button>
      {onExchange && card.zone !== 'deck' && (
        <button
          style={itemStyle}
          onClick={() => { onClose(); onExchange([card.instanceId]); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Exchange with Deck
        </button>
      )}
    </div>
  );
}
