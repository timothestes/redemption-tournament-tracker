'use client';

import { useState, useRef, useEffect } from 'react';
import { Settings, RotateCcw } from 'lucide-react';

const DIMENSION_PRESETS = [
  { label: '4:3 (1440x1080)', width: 1440, height: 1080 },
  { label: '16:10 (1680x1050)', width: 1680, height: 1050 },
  { label: '16:9 (1920x1080)', width: 1920, height: 1080 },
  { label: '21:9 Ultrawide (2560x1080)', width: 2560, height: 1080 },
  { label: '32:9 Super UW (3440x1080)', width: 3440, height: 1080 },
  { label: 'iPad (1024x768)', width: 1024, height: 768 },
] as const;

interface CardScaleControlProps {
  cardScale: number;
  setCardScale: (scale: number) => void;
  resetScale: () => void;
  minScale: number;
  maxScale: number;
  step: number;
  /** When set, overrides the container with a simulated size */
  onSimulateDimensions?: (width: number, height: number) => void;
  /** Clear the simulation, return to real container size */
  onClearSimulation?: () => void;
  /** Currently simulating? */
  simulatedLabel?: string | null;
}

export function CardScaleControl({
  cardScale,
  setCardScale,
  resetScale,
  minScale,
  maxScale,
  step,
  onSimulateDimensions,
  onClearSimulation,
  simulatedLabel,
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
          {/* Dimension simulation (dev tool) */}
          {onSimulateDimensions && (
            <>
              <div style={{ borderTop: '1px solid var(--gf-border, #3d2e1f)', margin: '4px 0' }} />
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
                  Test Display
                </span>
                {simulatedLabel && onClearSimulation && (
                  <button
                    onClick={onClearSimulation}
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      background: 'transparent',
                      border: '1px solid var(--gf-border, #3d2e1f)',
                      borderRadius: 4,
                      cursor: 'pointer',
                      color: 'var(--gf-text, #e8d5a3)',
                      fontFamily: 'var(--font-cinzel), Georgia, serif',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {DIMENSION_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => onSimulateDimensions(preset.width, preset.height)}
                    style={{
                      padding: '4px 8px',
                      background: simulatedLabel === preset.label ? 'var(--gf-hover, #2a1f12)' : 'transparent',
                      border: simulatedLabel === preset.label ? '1px solid #c4955a' : '1px solid transparent',
                      borderRadius: 4,
                      cursor: 'pointer',
                      color: simulatedLabel === preset.label ? '#fff' : 'var(--gf-text-dim, #8a7a66)',
                      fontSize: 11,
                      textAlign: 'left',
                      transition: 'background 0.15s, color 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      if (simulatedLabel !== preset.label) {
                        e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)';
                        e.currentTarget.style.color = 'var(--gf-text, #e8d5a3)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (simulatedLabel !== preset.label) {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'var(--gf-text-dim, #8a7a66)';
                      }
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
