'use client';

import { useContext, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Search, Shuffle, Eye, Sparkles, Trash2, Archive, ChevronRight, Play } from 'lucide-react';
import {
  SubMenuActionRow,
  SubmenuLockContext,
  ActiveSubmenuContext,
  ITEM_STYLE,
  SEPARATOR_STYLE,
  STEPPER_BTN_STYLE,
  GO_BTN_STYLE,
  hoverEnter,
  hoverLeave,
} from './SubMenuActionRow';

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
  onLookAtTop?: (count: number) => void;
  onLookAtBottom?: (count: number) => void;
  onLookAtRandom?: (count: number) => void;
  /** When true, hides all draw-related actions (for opponent's deck) */
  hideDrawActions?: boolean;
}

const SUBMENU_STYLE: React.CSSProperties = {
  position: 'fixed',
  background: 'var(--gf-bg)',
  border: '1px solid var(--gf-border)',
  borderRadius: 6,
  padding: '4px 0',
  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
  whiteSpace: 'nowrap',
  zIndex: 910,
};

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
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const [fixedPos, setFixedPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) {
      setFixedPos(null);
      return;
    }
    const trigger = triggerRef.current;
    const sub = submenuRef.current;
    if (!trigger || !sub) return;
    const tRect = trigger.getBoundingClientRect();
    const sRect = sub.getBoundingClientRect();
    const MARGIN = 8;
    let left = tRect.left - sRect.width - 2;
    if (left < MARGIN) left = tRect.right + 2;
    let top = tRect.top - 4;
    const maxTop = window.innerHeight - sRect.height - MARGIN;
    if (top > maxTop) top = maxTop;
    if (top < MARGIN) top = MARGIN;
    setFixedPos({ top, left });
  }, [isOpen]);

  const lock = useCallback(() => { lockedRef.current = true; }, []);
  const unlock = useCallback(() => { lockedRef.current = false; }, []);

  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
    };
  }, []);

  const showSub = () => {
    if (ctx?.closeTimerRef.current) { clearTimeout(ctx.closeTimerRef.current); ctx.closeTimerRef.current = null; }
    if (isOpen) return;
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
    if (ctx) {
      ctx.closeTimerRef.current = setTimeout(() => ctx.setActive(null), 400);
    }
  };

  return (
    <div
      ref={triggerRef}
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
        <div
          ref={submenuRef}
          style={{
            ...SUBMENU_STYLE,
            top: fixedPos?.top ?? -9999,
            left: fixedPos?.left ?? -9999,
            visibility: fixedPos ? 'visible' : 'hidden',
          }}
          onContextMenu={(e) => e.preventDefault()}
          onMouseEnter={showSub}
          onMouseLeave={hideSub}
        >
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
  onLookAtTop,
  onLookAtBottom,
  onLookAtRandom,
  hideDrawActions,
}: DeckContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showDrawX, setShowDrawX] = useState(false);
  const [drawXCount, setDrawXCount] = useState(3);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const submenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      <button style={ITEM_STYLE} onClick={onSearchDeck} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
        <Search size={14} />
        Search Deck
      </button>
      {!hideDrawActions && (
        <>
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
        </>
      )}

      <div style={SEPARATOR_STYLE} />
      <ActiveSubmenuContext.Provider value={{ active: activeSubmenu, setActive: setActiveSubmenu, closeTimerRef: submenuCloseTimerRef }}>
        <SubmenuTrigger label="Top Card">
          {!hideDrawActions && <SubMenuActionRow icon={<Play size={14} />} label="Draw" max={deckSize} onAction={onDrawTop} />}
          {onLookAtTop && <SubMenuActionRow icon={<Eye size={14} />} label="Look" max={deckSize} onAction={onLookAtTop} />}
          <SubMenuActionRow icon={<Sparkles size={14} />} label="Reveal" max={deckSize} onAction={onRevealTop} />
          <SubMenuActionRow icon={<Trash2 size={14} />} label="Discard" max={deckSize} onAction={onDiscardTop} />
          <SubMenuActionRow icon={<Archive size={14} />} label="Reserve" max={deckSize} onAction={onReserveTop} />
        </SubmenuTrigger>
        <SubmenuTrigger label="Bottom Card">
          {!hideDrawActions && <SubMenuActionRow icon={<Play size={14} />} label="Draw" max={deckSize} onAction={onDrawBottom} />}
          {onLookAtBottom && <SubMenuActionRow icon={<Eye size={14} />} label="Look" max={deckSize} onAction={onLookAtBottom} />}
          <SubMenuActionRow icon={<Sparkles size={14} />} label="Reveal" max={deckSize} onAction={onRevealBottom} />
          <SubMenuActionRow icon={<Trash2 size={14} />} label="Discard" max={deckSize} onAction={onDiscardBottom} />
          <SubMenuActionRow icon={<Archive size={14} />} label="Reserve" max={deckSize} onAction={onReserveBottom} />
        </SubmenuTrigger>
        <SubmenuTrigger label="Random Card">
          {!hideDrawActions && <SubMenuActionRow icon={<Play size={14} />} label="Draw" max={deckSize} onAction={onDrawRandom} />}
          {onLookAtRandom && <SubMenuActionRow icon={<Eye size={14} />} label="Look" max={deckSize} onAction={onLookAtRandom} />}
          <SubMenuActionRow icon={<Sparkles size={14} />} label="Reveal" max={deckSize} onAction={onRevealRandom} />
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
