'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Trash2, Eye, EyeOff, Search } from 'lucide-react';

// Context to let SubMenuActionRow lock/unlock the parent from auto-closing
const SubmenuLockContext = createContext<{
  lock: () => void;
  unlock: () => void;
} | null>(null);

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

const ITEM_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
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

const SEPARATOR_STYLE: React.CSSProperties = {
  height: 1,
  background: 'var(--gf-border)',
  margin: '4px 8px',
  opacity: 0.5,
};

const STEPPER_BTN_STYLE: React.CSSProperties = {
  width: 36,
  height: 36,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--gf-hover)',
  border: '1px solid var(--gf-border)',
  borderRadius: 4,
  color: 'var(--gf-text-bright)',
  fontSize: 14,
  fontWeight: 'bold',
  fontFamily: 'var(--font-cinzel), Georgia, serif',
  cursor: 'pointer',
};

const GO_BTN_STYLE: React.CSSProperties = {
  padding: '4px 10px',
  background: 'var(--gf-hover-strong)',
  border: '1px solid var(--gf-border)',
  borderRadius: 4,
  color: 'var(--gf-text-bright)',
  fontSize: 10,
  fontFamily: 'var(--font-cinzel), Georgia, serif',
  cursor: 'pointer',
  marginLeft: 2,
};

const QUICK_COUNT_STYLE: React.CSSProperties = {
  width: 36,
  height: 36,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(196,149,90,0.12)',
  border: '1px solid var(--gf-border)',
  borderRadius: 4,
  color: 'var(--gf-text)',
  fontSize: 11,
  fontWeight: 'bold',
  fontFamily: 'var(--font-cinzel), Georgia, serif',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

/** A submenu action row: click label for 1, quick-counts on the right, X for custom */
function SubMenuActionRow({
  icon,
  label,
  max,
  onAction,
}: {
  icon: React.ReactNode;
  label: string;
  max: number;
  onAction: (count: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [count, setCount] = useState(Math.min(3, max));
  const lockCtx = useContext(SubmenuLockContext);

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      lockCtx?.lock();
    } else {
      lockCtx?.unlock();
    }
  };

  const quickCount3 = Math.min(3, max);
  const quickCount6 = Math.min(6, max);

  return (
    <>
      <div
        style={{ display: 'flex', alignItems: 'center', margin: '0 4px', borderRadius: 6 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {max >= 1 && (
          <button
            style={{ ...QUICK_COUNT_STYLE, marginLeft: 10 }}
            onClick={() => onAction(quickCount3)}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(196,149,90,0.35)';
              e.currentTarget.style.borderColor = 'var(--gf-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(196,149,90,0.12)';
              e.currentTarget.style.borderColor = 'var(--gf-border)';
            }}
            title={`${label} ${quickCount3}`}
          >
            {quickCount3}
          </button>
        )}
        {max >= 4 && (
          <button
            style={{ ...QUICK_COUNT_STYLE, marginLeft: 2 }}
            onClick={() => onAction(quickCount6)}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(196,149,90,0.35)';
              e.currentTarget.style.borderColor = 'var(--gf-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(196,149,90,0.12)';
              e.currentTarget.style.borderColor = 'var(--gf-border)';
            }}
            title={`${label} ${quickCount6}`}
          >
            {quickCount6}
          </button>
        )}
        <button
          onClick={toggleExpanded}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(196,149,90,0.35)';
            e.currentTarget.style.borderColor = 'var(--gf-accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = expanded ? 'var(--gf-hover-strong)' : 'rgba(196,149,90,0.12)';
            e.currentTarget.style.borderColor = 'var(--gf-border)';
          }}
          style={{
            ...QUICK_COUNT_STYLE,
            marginLeft: 2,
            background: expanded ? 'var(--gf-hover-strong)' : 'rgba(196,149,90,0.12)',
            fontSize: 9,
            letterSpacing: '0.05em',
          }}
          title={`${label} custom amount...`}
        >
          X
        </button>
        <button
          style={{ ...ITEM_STYLE, flex: 1, background: 'transparent', paddingLeft: 8 }}
          onClick={() => onAction(1)}
        >
          {icon}
          {label}
        </button>
      </div>
      {expanded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 14px 6px', justifyContent: 'center' }}>
          <button
            style={{ ...STEPPER_BTN_STYLE, opacity: count <= 1 ? 0.3 : 1 }}
            onClick={() => setCount(Math.max(1, count - 1))}
          >
            &minus;
          </button>
          <span style={{
            width: 24,
            textAlign: 'center',
            color: 'var(--gf-text-bright)',
            fontSize: 13,
            fontWeight: 'bold',
            fontFamily: 'var(--font-cinzel), Georgia, serif',
          }}>
            {count}
          </span>
          <button
            style={{ ...STEPPER_BTN_STYLE, opacity: count >= max ? 0.3 : 1 }}
            onClick={() => setCount(Math.min(max, count + 1))}
          >
            +
          </button>
          <button style={GO_BTN_STYLE} onClick={() => onAction(count)}>
            Go
          </button>
        </div>
      )}
    </>
  );
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
      {/* Look at Reserve (private browse) */}
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

      {/* Request search (opponent reserve, unrevealed) */}
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

      {/* Reveal / Hide — only shown for own reserve */}
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

      {/* Random actions — only show when there are cards and callbacks */}
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
