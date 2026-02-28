'use client';

import { useRef, useEffect } from 'react';
import { Shuffle, ArrowUp, ArrowDown } from 'lucide-react';

interface DeckDropPopupProps {
  x: number;
  y: number;
  onShuffleIn: () => void;
  onTopDeck: () => void;
  onBottomDeck: () => void;
  onCancel: () => void;
}

export function DeckDropPopup({ x, y, onShuffleIn, onTopDeck, onBottomDeck, onCancel }: DeckDropPopupProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onCancel]);

  const btnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '7px 14px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#c9b99a',
    fontSize: 12,
    fontFamily: 'var(--font-cinzel), Georgia, serif',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  };

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: Math.min(x, window.innerWidth - 170),
        top: Math.min(y, window.innerHeight - 140),
        background: '#2a1f12',
        border: '1px solid #6b4e27',
        borderRadius: 6,
        padding: '4px 0',
        zIndex: 800,
        minWidth: 155,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      }}
    >
      <div style={{
        padding: '3px 14px',
        color: '#8b6532',
        fontSize: 9,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        fontFamily: 'var(--font-cinzel), Georgia, serif',
      }}>
        Add to Deck
      </div>
      <button
        style={btnStyle}
        onClick={onShuffleIn}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196,149,90,0.15)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <Shuffle size={13} /> Shuffle In
      </button>
      <button
        style={btnStyle}
        onClick={onTopDeck}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196,149,90,0.15)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <ArrowUp size={13} /> Top of Deck
      </button>
      <button
        style={btnStyle}
        onClick={onBottomDeck}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196,149,90,0.15)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <ArrowDown size={13} /> Bottom of Deck
      </button>
    </div>
  );
}
