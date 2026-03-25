'use client';

import { useEffect, useRef } from 'react';

interface LorContextMenuProps {
  x: number;
  y: number;
  onAddSoul: () => void;
  onClose: () => void;
}

export function LorContextMenu({ x, y, onAddSoul, onClose }: LorContextMenuProps) {
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

  return (
    <div
      ref={menuRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        left: Math.min(x, window.innerWidth - 160),
        top: Math.min(y, window.innerHeight - 100),
        background: 'var(--gf-bg)',
        border: '1px solid var(--gf-border)',
        borderRadius: 6,
        padding: '4px 0',
        zIndex: 600,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        whiteSpace: 'nowrap',
      }}
    >
      <button
        onClick={onAddSoul}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; e.currentTarget.style.color = 'var(--gf-text-bright)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--gf-text)'; }}
        style={{
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
        }}
      >
        Add Soul
      </button>
    </div>
  );
}
