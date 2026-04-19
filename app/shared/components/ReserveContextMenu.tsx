'use client';

import { useEffect, useRef } from 'react';
import { Trash2, Eye, EyeOff, Search } from 'lucide-react';
import {
  SubMenuActionRow,
  ITEM_STYLE,
  SEPARATOR_STYLE,
} from './SubMenuActionRow';

interface ReserveContextMenuProps {
  x: number;
  y: number;
  cardCount: number;
  isRevealed: boolean;
  onToggleReveal?: () => void;
  onLookAtReserve?: () => void;
  onSearchRequest?: () => void;
  onClose: () => void;
  onRandomToDiscard?: (count: number) => void;
}

export function ReserveContextMenu({
  x, y, cardCount, isRevealed, onToggleReveal, onLookAtReserve, onSearchRequest, onClose,
  onRandomToDiscard,
}: ReserveContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

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

  const MENU_WIDTH = 200;
  const rightAligned = x + MENU_WIDTH > window.innerWidth;
  const menuLeft = rightAligned ? Math.max(0, x - MENU_WIDTH) : x;

  const hasRandomActions = !!onRandomToDiscard;

  return (
    <div
      ref={menuRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: menuLeft,
        top: Math.min(y, window.innerHeight - (hasRandomActions ? 300 : 100)),
        background: 'var(--gf-bg)',
        border: '1px solid var(--gf-border)',
        borderRadius: 6,
        padding: '4px 0',
        zIndex: 900,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        whiteSpace: 'nowrap',
      }}
    >
      {onLookAtReserve && cardCount > 0 && (
        <button
          style={ITEM_STYLE}
          onClick={() => { onLookAtReserve(); onClose(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Search size={14} />
          Look at Reserve
        </button>
      )}

      {onSearchRequest && (
        <button
          style={ITEM_STYLE}
          onClick={() => { onSearchRequest(); onClose(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Search size={14} />
          Request Search
        </button>
      )}

      {onToggleReveal && (
        <button
          style={ITEM_STYLE}
          onClick={() => { onToggleReveal(); onClose(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {isRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
          {isRevealed ? 'Hide Reserve' : 'Reveal Reserve'}
        </button>
      )}

      {hasRandomActions && cardCount > 0 && (
        <>
          <div style={SEPARATOR_STYLE} />
          <div style={{
            padding: '4px 14px 2px',
            color: 'var(--gf-text-dim)',
            fontSize: 10,
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            userSelect: 'none',
          }}>
            Random from Reserve
          </div>

          {onRandomToDiscard && (
            <SubMenuActionRow
              icon={<Trash2 size={14} />}
              label="Random to Discard"
              max={cardCount}
              onAction={onRandomToDiscard}
            />
          )}
        </>
      )}
    </div>
  );
}
