'use client';

import { useEffect, useRef, useState } from 'react';
import { GameCard, ZoneId, ZONE_LABELS } from '../../goldfish/types';
import { GameActions } from '@/app/shared/types/gameActions';

const MOVE_TARGETS: ZoneId[] = [
  'territory', 'hand', 'discard', 'reserve',
  'land-of-bondage', 'land-of-redemption', 'banish',
];

const LOST_SOUL_EXCLUDED_TARGETS: ZoneId[] = ['territory', 'discard', 'reserve'];

function isLostSoul(card: GameCard): boolean {
  return (
    card.type === 'LS' ||
    card.type === 'Lost Soul' ||
    card.type.toLowerCase().includes('lost soul') ||
    card.cardName.toLowerCase().startsWith('lost soul')
  );
}

interface MultiCardContextMenuProps {
  selectedIds: string[];
  x: number;
  y: number;
  actions: GameActions;
  onClose: () => void;
  onClearSelection: () => void;
  onExchange?: (cardIds: string[]) => void;
  /** Live zone state for resolving selected card data */
  zones?: Record<ZoneId, GameCard[]>;
}

export function MultiCardContextMenu({ selectedIds, x, y, actions, onClose, onClearSelection, onExchange, zones }: MultiCardContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({ left: x, top: y, ready: false });

  // Find the cards in the current game state
  const selectedCards = zones
    ? selectedIds.flatMap(id => {
        for (const zoneId of Object.keys(zones) as ZoneId[]) {
          const card = (zones[zoneId] ?? []).find(c => c.instanceId === id);
          if (card) return [card];
        }
        return [];
      })
    : [];

  // Determine zones of selected cards to filter move targets
  const selectedZones = new Set<string>();
  if (zones) {
    for (const [zoneName, cards] of Object.entries(zones)) {
      for (const card of cards) {
        if (selectedIds.includes(card.instanceId)) {
          selectedZones.add(zoneName);
        }
      }
    }
  }
  const allInHand = selectedZones.size === 1 && selectedZones.has('hand');
  const HAND_EXCLUDED_TARGETS: ZoneId[] = ['land-of-bondage', 'land-of-redemption'];
  const allLostSouls = selectedCards.length > 0 && selectedCards.every(c => isLostSoul(c));
  // Hide a target zone if ALL selected cards already live there — moving into
  // your current zone is a no-op and adds noise to the menu.
  const allInSameZone = selectedZones.size === 1;
  const currentSharedZone = allInSameZone ? [...selectedZones][0] : null;
  const filteredTargets = MOVE_TARGETS
    .filter(z => !allInHand || !HAND_EXCLUDED_TARGETS.includes(z))
    .filter(z => !allLostSouls || !LOST_SOUL_EXCLUDED_TARGETS.includes(z))
    .filter(z => z !== currentSharedZone);

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
    position: 'fixed',
    left: pos.left,
    top: pos.top,
    background: 'var(--gf-bg)',
    border: '1px solid var(--gf-border)',
    borderRadius: 6,
    padding: '4px 0',
    zIndex: 900,
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

  const meekCount = selectedCards.filter(c => c.isMeek).length;
  const flippedCount = selectedCards.filter(c => c.isFlipped).length;
  const allTokens = selectedCards.length > 0 && selectedCards.every(c => c.isToken);

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
          onClick={() => doAction(() => actions.moveCardsBatch(selectedIds, 'land-of-redemption'))}
          {...hoverHandlers}
        >
          Rescue to L.O.R.
        </button>
        {actions.removeOpponentToken && (
          <>
            <div style={separatorStyle} />
            <button
              style={{ ...itemStyle, color: '#8b4a4a' }}
              onClick={() => doAction(() => { for (const id of selectedIds) actions.removeOpponentToken!(id); })}
              {...hoverHandlers}
            >
              Remove Tokens
            </button>
          </>
        )}
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

      {/* Card state toggles — near top for consistency with single-card menu */}
      <button
        style={itemStyle}
        onClick={() => doAction(() => {
          // If most are meek, unmeek all; otherwise meek all
          const shouldUnmeek = meekCount > selectedCards.length / 2;
          for (const card of selectedCards) {
            if (shouldUnmeek && card.isMeek) actions.unmeekCard(card.instanceId);
            else if (!shouldUnmeek && !card.isMeek) actions.meekCard(card.instanceId);
          }
        })}
        {...hoverHandlers}
      >
        {meekCount > selectedCards.length / 2 ? 'Unmeek All' : 'Meek All'}
      </button>

      {flippedCount < selectedCards.length && (
        <button
          style={itemStyle}
          onClick={() => doAction(() => {
            for (const card of selectedCards) {
              if (!card.isFlipped) actions.flipCard(card.instanceId);
            }
          })}
          {...hoverHandlers}
        >
          Flip All Face-Down
        </button>
      )}

      {flippedCount > 0 && (
        <button
          style={itemStyle}
          onClick={() => doAction(() => {
            for (const card of selectedCards) {
              if (card.isFlipped) actions.flipCard(card.instanceId);
            }
          })}
          {...hoverHandlers}
        >
          Flip All Face-Up
        </button>
      )}

      <div style={separatorStyle} />

      {/* Move to zones */}
      <div style={labelStyle}>Move to...</div>
      {filteredTargets.map(zoneId => (
        <button
          key={zoneId}
          style={itemStyle}
          onClick={() => doAction(() => actions.moveCardsBatch(selectedIds, zoneId))}
          {...hoverHandlers}
        >
          {ZONE_LABELS[zoneId]}
        </button>
      ))}

      <div style={separatorStyle} />

      {/* Deck operations */}
      <div style={labelStyle}>Deck...</div>
      {actions.moveCardToTopOfDeck && (
        <button
          style={itemStyle}
          onClick={() => doAction(() => {
            // Move each card to top of deck in order
            for (const id of selectedIds) {
              actions.moveCardToTopOfDeck!(id);
            }
          })}
          {...hoverHandlers}
        >
          Top of Deck
        </button>
      )}
      {actions.moveCardToBottomOfDeck && (
        <button
          style={itemStyle}
          onClick={() => doAction(() => {
            for (const id of selectedIds) {
              actions.moveCardToBottomOfDeck!(id);
            }
          })}
          {...hoverHandlers}
        >
          Bottom of Deck
        </button>
      )}
      {(() => {
        const nonTokenIds = selectedCards.filter(c => !c.isToken).map(c => c.instanceId);
        if (nonTokenIds.length === 0) return null;
        return (
          <button
            style={itemStyle}
            onClick={() => doAction(() => {
              actions.moveCardsBatch(nonTokenIds, 'deck');
              actions.shuffleDeck();
            })}
            {...hoverHandlers}
          >
            Shuffle into Deck
          </button>
        );
      })()}
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
