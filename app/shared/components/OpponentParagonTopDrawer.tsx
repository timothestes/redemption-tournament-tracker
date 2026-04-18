'use client';

import { useState } from 'react';

interface OpponentParagonTopDrawerProps {
  /** Opponent's paragon name, or null if they have none (drawer hidden). */
  paragonName: string | null;
}

const DRAWER_WIDTH = 620;
const HANDLE_WIDTH = 200;
const HANDLE_HEIGHT = 36;

export function OpponentParagonTopDrawer({ paragonName }: OpponentParagonTopDrawerProps) {
  const [open, setOpen] = useState(false);

  if (!paragonName) return null;

  const imageUrl = `/paragons/Paragon ${paragonName}.png`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open opponent's paragon"
        aria-hidden={open}
        tabIndex={open ? -1 : 0}
        style={{
          position: 'fixed',
          right: 400,
          top: 16,
          zIndex: 899,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: HANDLE_WIDTH,
          height: HANDLE_HEIGHT,
          padding: '0 12px 0 4px',
          background: 'rgba(14, 10, 6, 0.96)',
          border: '1px solid rgba(196, 149, 90, 0.5)',
          borderRadius: 6,
          color: '#e8d5a3',
          fontFamily: 'Cinzel, Georgia, serif',
          fontSize: 11,
          letterSpacing: 1.5,
          cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(0, 0, 0, 0.45)',
          opacity: open ? 0 : 1,
          transform: open ? 'translateY(-12px)' : 'translateY(0)',
          transition: 'opacity 200ms ease-out, transform 200ms ease-out',
          pointerEvents: open ? 'none' : 'auto',
        }}
      >
        <img
          src={imageUrl}
          alt=""
          style={{
            width: 38,
            height: 27,
            objectFit: 'cover',
            borderRadius: 2,
            border: '1px solid rgba(196, 149, 90, 0.3)',
            flexShrink: 0,
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
        <span style={{ flex: 1, textAlign: 'left' }}>OPPONENT</span>
        <span aria-hidden style={{ fontSize: 14, opacity: 0.85, lineHeight: 1 }}>
          ▾
        </span>
      </button>

      <div
        role="dialog"
        aria-label={`Opponent's Paragon: ${paragonName}`}
        aria-hidden={!open}
        style={{
          position: 'fixed',
          right: 396,
          top: 0,
          zIndex: 900,
          width: DRAWER_WIDTH,
          maxWidth: 'calc(100vw - 32px)',
          transform: open ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'transform 360ms cubic-bezier(0.32, 0.72, 0, 1)',
          willChange: 'transform',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        <div
          style={{
            background: 'rgba(14, 10, 6, 0.98)',
            border: '1px solid rgba(196, 149, 90, 0.5)',
            borderTop: 'none',
            borderBottomLeftRadius: 10,
            borderBottomRightRadius: 10,
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.55)',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: 8,
              borderBottom: '1px solid rgba(196, 149, 90, 0.15)',
            }}
          >
            <span
              style={{
                fontFamily: 'Cinzel, Georgia, serif',
                fontSize: 12,
                letterSpacing: 1.5,
                color: '#e8d5a3',
              }}
            >
              OPPONENT'S PARAGON
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close opponent paragon drawer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 28,
                padding: '0 6px',
                background: 'transparent',
                border: 'none',
                color: 'rgba(196, 149, 90, 0.75)',
                cursor: 'pointer',
                fontFamily: 'Georgia, serif',
                lineHeight: 1,
              }}
            >
              <span aria-hidden style={{ fontSize: 20 }}>×</span>
            </button>
          </div>

          <img
            src={imageUrl}
            alt={`Paragon ${paragonName}`}
            style={{
              width: '100%',
              height: 'auto',
              aspectRatio: '1.4 / 1',
              objectFit: 'contain',
              borderRadius: 4,
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
            }}
          />
        </div>
      </div>
    </>
  );
}
