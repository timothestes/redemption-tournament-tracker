'use client';

import { useEffect, useRef } from 'react';
import { Search, Eye } from 'lucide-react';

interface OpponentZoneContextMenuProps {
  x: number;
  y: number;
  zoneName: string;
  zone: string;
  onSearch: () => void;
  onRevealHand?: () => void;
  onClose: () => void;
}

export function OpponentZoneContextMenu({ x, y, zoneName, zone, onSearch, onRevealHand, onClose }: OpponentZoneContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
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

  const btnStyle: React.CSSProperties = {
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

  return (
    <div
      ref={menuRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: Math.min(x, typeof window !== 'undefined' ? window.innerWidth - 200 : x),
        top: Math.min(y, typeof window !== 'undefined' ? window.innerHeight - 60 : y),
        background: 'var(--gf-bg)',
        border: '1px solid var(--gf-border)',
        borderRadius: 6,
        padding: '4px 0',
        zIndex: 900,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        whiteSpace: 'nowrap',
      }}
    >
      {zone === 'hand' && onRevealHand ? (
        <button
          onClick={onRevealHand}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          style={btnStyle}
        >
          <Eye size={14} />
          Request Reveal Hand
        </button>
      ) : (
        <button
          onClick={onSearch}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          style={btnStyle}
        >
          <Search size={14} />
          Search {zoneName}
        </button>
      )}
    </div>
  );
}
