'use client';

import { useState, useRef, useEffect } from 'react';
import { Settings, RotateCcw, RefreshCw } from 'lucide-react';

interface CardScaleControlProps {
  cardScale: number;
  setCardScale: (scale: number) => void;
  resetScale: () => void;
  minScale: number;
  maxScale: number;
  step: number;
  /** Called to trigger mid-game deck reload (multiplayer only). */
  onLoadDeck?: () => void;
}

export function CardScaleControl({
  cardScale,
  setCardScale,
  resetScale,
  minScale,
  maxScale,
  step,
  onLoadDeck,
}: CardScaleControlProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const pct = Math.round(cardScale * 100);

  return (
    <div
      ref={popoverRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'absolute', bottom: 8, left: 12, zIndex: 200 }}
    >
      {/* Gear button */}
      <button
        onClick={() => setOpen(prev => !prev)}
        title="Card size settings (+/- keys)"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          background: 'rgba(30,22,16,0.92)',
          border: '1px solid var(--gf-border, #3d2e1f)',
          borderRadius: 8,
          cursor: 'pointer',
          color: 'var(--gf-text, #e8d5a3)',
          transition: 'background 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)';
          e.currentTarget.style.color = 'var(--gf-text-bright, #fff)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(30,22,16,0.92)';
          e.currentTarget.style.color = 'var(--gf-text, #e8d5a3)';
        }}
      >
        <Settings size={18} />
      </button>

      {/* Popover */}
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 44,
            left: 0,
            background: 'rgba(30,22,16,0.96)',
            border: '1px solid var(--gf-border, #3d2e1f)',
            borderRadius: 8,
            padding: '12px 16px',
            minWidth: 200,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {/* Label + percentage */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 11,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--gf-text, #e8d5a3)',
              }}
            >
              Card Size
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--gf-text-bright, #fff)',
                fontVariantNumeric: 'tabular-nums',
                minWidth: 36,
                textAlign: 'right',
              }}
            >
              {pct}%
            </span>
          </div>

          {/* Slider */}
          <input
            type="range"
            min={minScale * 100}
            max={maxScale * 100}
            step={step * 100}
            value={pct}
            onChange={(e) => {
              const newScale = Math.round(parseFloat(e.target.value)) / 100;
              setCardScale(newScale);
            }}
            style={{
              width: '100%',
              accentColor: '#c4955a',
              cursor: 'pointer',
            }}
          />

          {/* Min/max labels + reset */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: 'var(--gf-text-dim, #8a7a66)' }}>
              {Math.round(minScale * 100)}%
            </span>
            <button
              onClick={resetScale}
              title="Reset to 100%"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                background: 'transparent',
                border: '1px solid var(--gf-border, #3d2e1f)',
                borderRadius: 4,
                cursor: 'pointer',
                color: 'var(--gf-text, #e8d5a3)',
                fontSize: 10,
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <RotateCcw size={10} />
              Reset
            </button>
            <span style={{ fontSize: 10, color: 'var(--gf-text-dim, #8a7a66)' }}>
              {Math.round(maxScale * 100)}%
            </span>
          </div>

          {/* Load Deck — multiplayer only */}
          {onLoadDeck && (
            <>
              <div style={{
                height: 1,
                background: 'var(--gf-border, #3d2e1f)',
                margin: '4px 0',
              }} />
              <button
                onClick={() => {
                  onLoadDeck();
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 4px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: 'var(--gf-text, #e8d5a3)',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <RefreshCw size={14} />
                Load Deck
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
