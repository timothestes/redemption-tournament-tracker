'use client';

import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface CardContextMenuActions {
  moveCard: (cardInstanceId: bigint, toZone: string, zoneIndex?: string, posX?: string, posY?: string) => void;
  shuffleCardIntoDeck: (cardInstanceId: bigint) => void;
  meekCard: (cardInstanceId: bigint) => void;
  unmeekCard: (cardInstanceId: bigint) => void;
  flipCard: (cardInstanceId: bigint) => void;
  addCounter: (cardInstanceId: bigint, color: string) => void;
  removeCounter: (cardInstanceId: bigint, color: string) => void;
  setNote: (cardInstanceId: bigint, text: string) => void;
  drawCard: () => void;
  drawMultiple: (count: bigint) => void;
  shuffleDeck: () => void;
}

interface BaseMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  actions: CardContextMenuActions;
}

interface CardContextMenuProps extends BaseMenuProps {
  cardInstanceId: bigint;
  currentZone?: string;
  isMeek?: boolean;
}

interface DeckContextMenuProps extends BaseMenuProps {
  onSearchDeck?: () => void;
}

interface ZoneContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onBrowseZone?: () => void;
}

// ---------------------------------------------------------------------------
// Zone label map
// ---------------------------------------------------------------------------

const ZONE_LABELS: Record<string, string> = {
  territory: 'Territory',
  hand: 'Hand',
  discard: 'Discard Pile',
  reserve: 'Reserve',
  banish: 'Banished',
  'land-of-bondage': 'Land of Bondage',
  'land-of-redemption': 'Land of Redemption',
  deck: 'Deck',
};

const MOVE_TARGETS = [
  'territory',
  'hand',
  'discard',
  'reserve',
  'banish',
  'land-of-bondage',
  'land-of-redemption',
];

// ---------------------------------------------------------------------------
// Counter colors
// ---------------------------------------------------------------------------

interface CounterColor {
  id: string;
  label: string;
  hex: string;
}

const COUNTER_COLORS: CounterColor[] = [
  { id: 'white',  label: 'White',  hex: '#e5e7eb' },
  { id: 'red',    label: 'Red',    hex: '#ef4444' },
  { id: 'blue',   label: 'Blue',   hex: '#3b82f6' },
  { id: 'green',  label: 'Green',  hex: '#22c55e' },
  { id: 'purple', label: 'Purple', hex: '#a855f7' },
  { id: 'gold',   label: 'Gold',   hex: '#f59e0b' },
];

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const MENU_STYLE: React.CSSProperties = {
  position: 'absolute',
  background: '#1a1a1a',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  padding: '4px 0',
  zIndex: 1000,
  boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
  whiteSpace: 'nowrap',
  minWidth: 180,
};

const ITEM_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 14px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'rgba(255,255,255,0.85)',
  fontSize: 13,
  textAlign: 'left',
  fontFamily: 'var(--font-cinzel), Georgia, serif',
  boxSizing: 'border-box',
};

const LABEL_STYLE: React.CSSProperties = {
  ...ITEM_STYLE,
  color: 'rgba(255,255,255,0.35)',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  cursor: 'default',
  padding: '4px 16px 2px',
};

const SEPARATOR_STYLE: React.CSSProperties = {
  height: 1,
  background: 'rgba(255,255,255,0.1)',
  margin: '4px 8px',
};

const SUBMENU_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: '100%',
  top: -4,
  marginLeft: 2,
  background: '#1a1a1a',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  padding: '4px 0',
  zIndex: 1001,
  boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
  whiteSpace: 'nowrap',
  minWidth: 160,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampMenuPosition(x: number, y: number, width = 200, height = 400) {
  const safeX = typeof window !== 'undefined' ? Math.min(x, window.innerWidth - width) : x;
  const safeY = typeof window !== 'undefined' ? Math.min(y, window.innerHeight - height) : y;
  return { left: Math.max(0, safeX), top: Math.max(0, safeY) };
}

function useMenuDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
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
  }, [ref, onClose]);
}

function MenuItem({
  children,
  onClick,
  disabled,
  style,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button
      style={{ ...ITEM_STYLE, opacity: disabled ? 0.4 : 1, ...style }}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Submenu trigger (hover to open, appears on the right)
// ---------------------------------------------------------------------------

function SubMenuTrigger({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleOpen = () => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    if (!open && !openTimerRef.current) {
      openTimerRef.current = setTimeout(() => { openTimerRef.current = null; setOpen(true); }, 150);
    }
  };

  const scheduleClose = () => {
    if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = null; }
    closeTimerRef.current = setTimeout(() => { closeTimerRef.current = null; setOpen(false); }, 300);
  };

  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
    >
      <div
        style={{
          ...ITEM_STYLE,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <span>{label}</span>
        <span style={{ opacity: 0.5, fontSize: 10, marginLeft: 8 }}>&#9654;</span>
      </div>
      {open && (
        <div style={SUBMENU_STYLE} onMouseEnter={scheduleOpen} onMouseLeave={scheduleClose}>
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. CardContextMenu
// ---------------------------------------------------------------------------

export function CardContextMenu({
  x,
  y,
  onClose,
  cardInstanceId,
  currentZone,
  isMeek,
  actions,
}: CardContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuDismiss(menuRef, onClose);

  const { left, top } = clampMenuPosition(x, y, 220, 500);

  const doAction = (fn: () => void) => {
    fn();
    onClose();
  };

  const handleAddNote = () => {
    onClose();
    const text = window.prompt('Add a note to this card:');
    if (text !== null) {
      actions.setNote(cardInstanceId, text);
    }
  };

  const moveTargets = MOVE_TARGETS.filter((z) => z !== currentZone);

  return (
    <div
      ref={menuRef}
      style={{ ...MENU_STYLE, left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Move to section */}
      <div style={LABEL_STYLE}>Move to</div>
      {moveTargets.map((zone) => (
        <MenuItem key={zone} onClick={() => doAction(() => actions.moveCard(cardInstanceId, zone))}>
          {ZONE_LABELS[zone] ?? zone}
        </MenuItem>
      ))}

      <div style={SEPARATOR_STYLE} />

      {/* Deck actions */}
      <div style={LABEL_STYLE}>Deck</div>
      <MenuItem onClick={() => doAction(() => actions.moveCard(cardInstanceId, 'deck', '0'))}>
        Top of Deck
      </MenuItem>
      <MenuItem onClick={() => doAction(() => actions.moveCard(cardInstanceId, 'deck', '-1'))}>
        Bottom of Deck
      </MenuItem>
      <MenuItem onClick={() => doAction(() => actions.shuffleCardIntoDeck(cardInstanceId))}>
        Shuffle Into Deck
      </MenuItem>

      <div style={SEPARATOR_STYLE} />

      {/* Card state */}
      <div style={LABEL_STYLE}>State</div>
      <MenuItem onClick={() => doAction(() => isMeek ? actions.unmeekCard(cardInstanceId) : actions.meekCard(cardInstanceId))}>
        {isMeek ? 'Unmeek' : 'Meek'}
      </MenuItem>
      <MenuItem onClick={() => doAction(() => actions.flipCard(cardInstanceId))}>
        Flip
      </MenuItem>

      <div style={SEPARATOR_STYLE} />

      {/* Counters */}
      <SubMenuTrigger label="Add Counter">
        {COUNTER_COLORS.map((color) => (
          <MenuItem
            key={color.id}
            onClick={() => doAction(() => actions.addCounter(cardInstanceId, color.id))}
          >
            <span
              style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: color.hex,
                border: '1px solid rgba(255,255,255,0.3)',
                flexShrink: 0,
              }}
            />
            {color.label}
          </MenuItem>
        ))}
      </SubMenuTrigger>
      <SubMenuTrigger label="Remove Counter">
        {COUNTER_COLORS.map((color) => (
          <MenuItem
            key={color.id}
            onClick={() => doAction(() => actions.removeCounter(cardInstanceId, color.id))}
          >
            <span
              style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: color.hex,
                border: '1px solid rgba(255,255,255,0.3)',
                flexShrink: 0,
              }}
            />
            {color.label}
          </MenuItem>
        ))}
      </SubMenuTrigger>

      <div style={SEPARATOR_STYLE} />

      {/* Notes */}
      <div style={LABEL_STYLE}>Notes</div>
      <MenuItem onClick={handleAddNote}>Add Note</MenuItem>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. DeckContextMenu
// ---------------------------------------------------------------------------

export function DeckContextMenu({
  x,
  y,
  onClose,
  actions,
  onSearchDeck,
}: DeckContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuDismiss(menuRef, onClose);

  const { left, top } = clampMenuPosition(x, y, 200, 200);

  const doAction = (fn: () => void) => {
    fn();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{ ...MENU_STYLE, left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItem onClick={() => doAction(() => actions.drawCard())}>
        Draw Card
      </MenuItem>
      <MenuItem onClick={() => doAction(() => actions.drawMultiple(BigInt(3)))}>
        Draw 3 Cards
      </MenuItem>

      <div style={SEPARATOR_STYLE} />

      <MenuItem onClick={() => doAction(() => actions.shuffleDeck())}>
        Shuffle Deck
      </MenuItem>

      <div style={SEPARATOR_STYLE} />

      <MenuItem
        onClick={() => {
          onClose();
          onSearchDeck?.();
        }}
      >
        Search Deck
        <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.4 }}>coming soon</span>
      </MenuItem>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. ZoneContextMenu
// ---------------------------------------------------------------------------

export function ZoneContextMenu({ x, y, onClose, onBrowseZone }: ZoneContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuDismiss(menuRef, onClose);

  const { left, top } = clampMenuPosition(x, y, 200, 100);

  return (
    <div
      ref={menuRef}
      style={{ ...MENU_STYLE, left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItem
        onClick={() => {
          onClose();
          onBrowseZone?.();
        }}
      >
        Browse Zone
        <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.4 }}>coming soon</span>
      </MenuItem>
    </div>
  );
}
