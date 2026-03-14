'use client';

import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { Search, Shuffle, Eye, Trash2, Archive, ChevronRight, Play, Dices } from 'lucide-react';

// Context to let SubMenuActionRow lock/unlock the parent SubmenuTrigger from auto-closing
const SubmenuLockContext = createContext<{
  lock: () => void;
  unlock: () => void;
} | null>(null);

// Context to coordinate which submenu is open (shared across sibling triggers)
const ActiveSubmenuContext = createContext<{
  active: string | null;
  setActive: (label: string | null) => void;
  closeTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
} | null>(null);

interface DeckContextMenuProps {
  x: number;
  y: number;
  deckSize: number;
  onClose: () => void;
  onSearchDeck: () => void;
  onShuffleDeck: () => void;
  onDrawTop: (count: number) => void;
  onRevealTop: (count: number) => void;
  onDiscardTop: (count: number) => void;
  onReserveTop: (count: number) => void;
  onDrawBottom: (count: number) => void;
  onRevealBottom: (count: number) => void;
  onDiscardBottom: (count: number) => void;
  onReserveBottom: (count: number) => void;
  onDrawRandom: (count: number) => void;
  onRevealRandom: (count: number) => void;
  onDiscardRandom: (count: number) => void;
  onReserveRandom: (count: number) => void;
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

const SUBMENU_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 'auto',
  right: '100%',
  top: -4,
  marginRight: -2,
  background: 'var(--gf-bg)',
  border: '1px solid var(--gf-border)',
  borderRadius: 6,
  padding: '4px 0',
  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
  whiteSpace: 'nowrap',
};

function hoverEnter(e: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) {
  e.currentTarget.style.background = 'var(--gf-hover)';
  e.currentTarget.style.color = 'var(--gf-text-bright)';
}

function hoverLeave(e: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) {
  e.currentTarget.style.background = 'transparent';
  e.currentTarget.style.color = 'var(--gf-text)';
}

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
  const [count, setCount] = useState(3);
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

  return (
    <>
      <div
        style={{ display: 'flex', alignItems: 'center', margin: '0 4px', borderRadius: 6 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {max >= 3 && (
          <button
            style={{ ...QUICK_COUNT_STYLE, marginLeft: 10 }}
            onClick={() => onAction(3)}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(196,149,90,0.35)';
              e.currentTarget.style.borderColor = 'var(--gf-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(196,149,90,0.12)';
              e.currentTarget.style.borderColor = 'var(--gf-border)';
            }}
            title={`${label} 3`}
          >
            3
          </button>
        )}
        {max >= 6 && (
          <button
            style={{ ...QUICK_COUNT_STYLE, marginLeft: 2 }}
            onClick={() => onAction(6)}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(196,149,90,0.35)';
              e.currentTarget.style.borderColor = 'var(--gf-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(196,149,90,0.12)';
              e.currentTarget.style.borderColor = 'var(--gf-border)';
            }}
            title={`${label} 6`}
          >
            6
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

function SubmenuTrigger({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const ctx = useContext(ActiveSubmenuContext);
  const isOpen = ctx?.active === label;
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockedRef = useRef(false);

  const lock = useCallback(() => { lockedRef.current = true; }, []);
  const unlock = useCallback(() => { lockedRef.current = false; }, []);

  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
    };
  }, []);

  const showSub = () => {
    // Cancel any pending close from any sibling trigger
    if (ctx?.closeTimerRef.current) { clearTimeout(ctx.closeTimerRef.current); ctx.closeTimerRef.current = null; }
    if (isOpen) return;

    // Use a delay whether opening fresh or switching between triggers.
    // Switching delay is longer so brief cursor pass-throughs don't steal focus.
    if (!openTimerRef.current) {
      openTimerRef.current = setTimeout(() => {
        openTimerRef.current = null;
        ctx?.setActive(label);
      }, ctx?.active ? 300 : 180);
    }
  };

  const hideSub = () => {
    if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = null; }
    if (lockedRef.current) return;
    // Long delay so users can reach the submenu even with imprecise cursor paths
    if (ctx) {
      ctx.closeTimerRef.current = setTimeout(() => ctx.setActive(null), 400);
    }
  };

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={showSub}
      onMouseLeave={hideSub}
    >
      <div
        style={ITEM_STYLE}
        onMouseEnter={(e) => { hoverEnter(e); showSub(); }}
        onMouseLeave={(e) => { hoverLeave(e); }}
      >
        <ChevronRight size={12} style={{ opacity: 0.6, transform: 'rotate(180deg)' }} />
        <span>{label}</span>
      </div>
      {isOpen && (
        <div style={SUBMENU_STYLE} onContextMenu={(e) => e.preventDefault()}>
          <SubmenuLockContext.Provider value={{ lock, unlock }}>
            {children}
          </SubmenuLockContext.Provider>
        </div>
      )}
    </div>
  );
}

export function DeckContextMenu({
  x, y, deckSize, onClose,
  onSearchDeck, onShuffleDeck,
  onDrawTop, onRevealTop, onDiscardTop, onReserveTop,
  onDrawBottom, onRevealBottom, onDiscardBottom, onReserveBottom,
  onDrawRandom, onRevealRandom, onDiscardRandom, onReserveRandom,
}: DeckContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showDrawX, setShowDrawX] = useState(false);
  const [drawXCount, setDrawXCount] = useState(3);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const submenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Right-align the menu when the click is near the right edge
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
        position: 'absolute',
        left: menuLeft,
        top: Math.min(y, window.innerHeight - 300),
        background: 'var(--gf-bg)',
        border: '1px solid var(--gf-border)',
        borderRadius: 6,
        padding: '4px 0',
        zIndex: 500,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        whiteSpace: 'nowrap',
      }}
    >
      <button style={ITEM_STYLE} onClick={onSearchDeck} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
        <Search size={14} />
        Search Deck
      </button>
      <button style={ITEM_STYLE} onClick={() => onDrawTop(1)} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
        <Play size={14} />
        Draw 1
      </button>
      <button style={ITEM_STYLE} onClick={() => setShowDrawX(!showDrawX)} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
        <Play size={14} />
        Draw X...
      </button>
      {showDrawX && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 14px 6px' }}>
          <button
            style={{ ...STEPPER_BTN_STYLE, opacity: drawXCount <= 1 ? 0.3 : 1 }}
            onClick={() => setDrawXCount(Math.max(1, drawXCount - 1))}
          >
            &minus;
          </button>
          <span style={{ width: 24, textAlign: 'center', color: 'var(--gf-text-bright)', fontSize: 13, fontWeight: 'bold', fontFamily: 'var(--font-cinzel), Georgia, serif' }}>
            {drawXCount}
          </span>
          <button
            style={{ ...STEPPER_BTN_STYLE, opacity: drawXCount >= deckSize ? 0.3 : 1 }}
            onClick={() => setDrawXCount(Math.min(deckSize, drawXCount + 1))}
          >
            +
          </button>
          <button style={GO_BTN_STYLE} onClick={() => onDrawTop(drawXCount)}>Go</button>
        </div>
      )}

      <div style={SEPARATOR_STYLE} />
      <ActiveSubmenuContext.Provider value={{ active: activeSubmenu, setActive: setActiveSubmenu, closeTimerRef: submenuCloseTimerRef }}>
        <SubmenuTrigger label="Top Card">
          <SubMenuActionRow icon={<Play size={14} />} label="Draw" max={deckSize} onAction={onDrawTop} />
          <SubMenuActionRow icon={<Eye size={14} />} label="Reveal" max={deckSize} onAction={onRevealTop} />
          <SubMenuActionRow icon={<Trash2 size={14} />} label="Discard" max={deckSize} onAction={onDiscardTop} />
          <SubMenuActionRow icon={<Archive size={14} />} label="Reserve" max={deckSize} onAction={onReserveTop} />
        </SubmenuTrigger>
        <SubmenuTrigger label="Bottom Card">
          <SubMenuActionRow icon={<Play size={14} />} label="Draw" max={deckSize} onAction={onDrawBottom} />
          <SubMenuActionRow icon={<Eye size={14} />} label="Reveal" max={deckSize} onAction={onRevealBottom} />
          <SubMenuActionRow icon={<Trash2 size={14} />} label="Discard" max={deckSize} onAction={onDiscardBottom} />
          <SubMenuActionRow icon={<Archive size={14} />} label="Reserve" max={deckSize} onAction={onReserveBottom} />
        </SubmenuTrigger>
        <SubmenuTrigger label="Random Card">
          <SubMenuActionRow icon={<Play size={14} />} label="Draw" max={deckSize} onAction={onDrawRandom} />
          <SubMenuActionRow icon={<Eye size={14} />} label="Reveal" max={deckSize} onAction={onRevealRandom} />
          <SubMenuActionRow icon={<Trash2 size={14} />} label="Discard" max={deckSize} onAction={onDiscardRandom} />
          <SubMenuActionRow icon={<Archive size={14} />} label="Reserve" max={deckSize} onAction={onReserveRandom} />
        </SubmenuTrigger>
      </ActiveSubmenuContext.Provider>

      <div style={SEPARATOR_STYLE} />
      <button style={ITEM_STYLE} onClick={onShuffleDeck} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
        <Shuffle size={14} />
        Shuffle Deck
      </button>
    </div>
  );
}
