'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, Shuffle, Eye, Trash2, Archive, ChevronRight, Play, Dices } from 'lucide-react';

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
  padding: '8px 14px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: '#c9b99a',
  fontSize: 12,
  textAlign: 'left',
  fontFamily: 'var(--font-cinzel), Georgia, serif',
};

const SEPARATOR_STYLE: React.CSSProperties = {
  height: 1,
  background: '#6b4e27',
  margin: '4px 8px',
  opacity: 0.5,
};

const STEPPER_BTN_STYLE: React.CSSProperties = {
  width: 24,
  height: 24,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(196,149,90,0.15)',
  border: '1px solid #6b4e27',
  borderRadius: 4,
  color: '#e8d5a3',
  fontSize: 14,
  fontWeight: 'bold',
  fontFamily: 'var(--font-cinzel), Georgia, serif',
  cursor: 'pointer',
};

const GO_BTN_STYLE: React.CSSProperties = {
  padding: '4px 10px',
  background: 'rgba(196,149,90,0.25)',
  border: '1px solid #6b4e27',
  borderRadius: 4,
  color: '#e8d5a3',
  fontSize: 10,
  fontFamily: 'var(--font-cinzel), Georgia, serif',
  cursor: 'pointer',
  marginLeft: 2,
};

const SUBMENU_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: '100%',
  top: -4,
  marginLeft: -2,
  background: '#2a1f12',
  border: '1px solid #6b4e27',
  borderRadius: 6,
  padding: '4px 0',
  minWidth: 170,
  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
};

function hoverEnter(e: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) {
  e.currentTarget.style.background = 'rgba(196,149,90,0.15)';
  e.currentTarget.style.color = '#e8d5a3';
}

function hoverLeave(e: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) {
  e.currentTarget.style.background = 'transparent';
  e.currentTarget.style.color = '#c9b99a';
}

/** A submenu action row: click label for 1, or press N to expand stepper */
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

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button
          onClick={() => setExpanded(!expanded)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(196,149,90,0.35)';
            e.currentTarget.style.borderColor = '#c4955a';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = expanded ? 'rgba(196,149,90,0.25)' : 'rgba(196,149,90,0.12)';
            e.currentTarget.style.borderColor = '#6b4e27';
          }}
          style={{
            background: expanded ? 'rgba(196,149,90,0.25)' : 'rgba(196,149,90,0.12)',
            border: '1px solid #6b4e27',
            cursor: 'pointer',
            color: '#e8d5a3',
            fontSize: 9,
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontWeight: 'bold',
            padding: '2px 8px',
            borderRadius: 10,
            marginLeft: 10,
            letterSpacing: '0.05em',
          }}
          title={`${label} multiple...`}
        >
          N
        </button>
        <button
          style={{ ...ITEM_STYLE, flex: 1 }}
          onClick={() => onAction(1)}
          onMouseEnter={hoverEnter}
          onMouseLeave={hoverLeave}
        >
          {icon}
          {label}
        </button>
      </div>
      {expanded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 14px 6px' }}>
          <button
            style={{ ...STEPPER_BTN_STYLE, opacity: count <= 1 ? 0.3 : 1 }}
            onClick={() => setCount(Math.max(1, count - 1))}
          >
            &minus;
          </button>
          <span style={{
            width: 24,
            textAlign: 'center',
            color: '#e8d5a3',
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
  const [open, setOpen] = useState(false);
  const [flipLeft, setFlipLeft] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSub = () => {
    // Cancel any pending close
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }

    // If already open, no delay needed (user is hovering back)
    if (open) return;

    // Delay opening so diagonal mouse movement across siblings doesn't steal focus
    if (!openTimerRef.current) {
      openTimerRef.current = setTimeout(() => {
        openTimerRef.current = null;
        if (triggerRef.current) {
          const rect = triggerRef.current.getBoundingClientRect();
          setFlipLeft(rect.right + 170 > window.innerWidth);
        }
        setOpen(true);
      }, 180);
    }
  };

  const hideSub = () => {
    // Cancel any pending open
    if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = null; }
    // Delay close so user can move to the submenu
    closeTimerRef.current = setTimeout(() => setOpen(false), 150);
  };

  const subStyle: React.CSSProperties = {
    ...SUBMENU_STYLE,
    ...(flipLeft
      ? { left: 'auto', right: '100%', marginLeft: 0, marginRight: -2 }
      : {}),
  };

  return (
    <div
      ref={triggerRef}
      style={{ position: 'relative' }}
      onMouseEnter={showSub}
      onMouseLeave={hideSub}
    >
      <div
        style={{ ...ITEM_STYLE, justifyContent: 'space-between', paddingRight: 10 }}
        onMouseEnter={(e) => { hoverEnter(e); showSub(); }}
        onMouseLeave={(e) => { hoverLeave(e); }}
      >
        <span>{label}</span>
        <ChevronRight size={12} style={{ opacity: 0.6, transform: flipLeft ? 'rotate(180deg)' : undefined }} />
      </div>
      {open && (
        <div style={subStyle} onContextMenu={(e) => e.preventDefault()}>
          {children}
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
  const [showDrawN, setShowDrawN] = useState(false);
  const [drawNCount, setDrawNCount] = useState(3);

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
        left: Math.min(x, window.innerWidth - 200),
        top: Math.min(y, window.innerHeight - 300),
        background: '#2a1f12',
        border: '1px solid #6b4e27',
        borderRadius: 6,
        padding: '4px 0',
        zIndex: 500,
        minWidth: 180,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
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
      <button style={ITEM_STYLE} onClick={() => setShowDrawN(!showDrawN)} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
        <Play size={14} />
        Draw N...
      </button>
      {showDrawN && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 14px 6px' }}>
          <button
            style={{ ...STEPPER_BTN_STYLE, opacity: drawNCount <= 1 ? 0.3 : 1 }}
            onClick={() => setDrawNCount(Math.max(1, drawNCount - 1))}
          >
            &minus;
          </button>
          <span style={{ width: 24, textAlign: 'center', color: '#e8d5a3', fontSize: 13, fontWeight: 'bold', fontFamily: 'var(--font-cinzel), Georgia, serif' }}>
            {drawNCount}
          </span>
          <button
            style={{ ...STEPPER_BTN_STYLE, opacity: drawNCount >= deckSize ? 0.3 : 1 }}
            onClick={() => setDrawNCount(Math.min(deckSize, drawNCount + 1))}
          >
            +
          </button>
          <button style={GO_BTN_STYLE} onClick={() => onDrawTop(drawNCount)}>Go</button>
        </div>
      )}

      <div style={SEPARATOR_STYLE} />
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

      <div style={SEPARATOR_STYLE} />
      <button style={ITEM_STYLE} onClick={onShuffleDeck} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
        <Shuffle size={14} />
        Shuffle Deck
      </button>
    </div>
  );
}
