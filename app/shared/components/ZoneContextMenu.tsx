'use client';

import { useEffect, useRef } from 'react';

interface ZoneContextMenuProps {
  x: number;
  y: number;
  spawnX: number;
  spawnY: number;
  onClose: () => void;
  onAddOpponentLostSoul: (testament: 'NT' | 'OT', posX: number, posY: number) => void;
}

export function ZoneContextMenu({ x, y, spawnX, spawnY, onClose, onAddOpponentLostSoul }: ZoneContextMenuProps) {
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

  const menuStyle: React.CSSProperties = {
    position: 'absolute',
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - 200),
    background: 'var(--gf-bg)',
    border: '1px solid var(--gf-border)',
    borderRadius: 6,
    padding: '4px 0',
    zIndex: 900,
    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
    whiteSpace: 'nowrap',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '4px 16px 2px',
    background: 'transparent',
    border: 'none',
    color: 'var(--gf-text-dim)',
    fontSize: 10,
    textAlign: 'left',
    fontFamily: 'var(--font-cinzel), Georgia, serif',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    cursor: 'default',
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

  const doAction = (fn: () => void) => {
    fn();
    onClose();
  };

  return (
    <div ref={menuRef} style={menuStyle} onContextMenu={(e) => e.preventDefault()}>
      <div style={labelStyle}>Spawn Token</div>
      <button
        style={itemStyle}
        onClick={() => doAction(() => onAddOpponentLostSoul('NT', spawnX, spawnY))}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        N.T. Lost Soul
      </button>
      <button
        style={itemStyle}
        onClick={() => doAction(() => onAddOpponentLostSoul('OT', spawnX, spawnY))}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        O.T. Lost Soul
      </button>
    </div>
  );
}
