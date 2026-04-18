'use client';

import { useEffect, useState } from 'react';
import type { ParagonEntry } from '../types/paragonEntry';

interface ParagonDrawerProps {
  /** Paragon entries to display. Empty array = drawer hidden entirely. */
  paragons: ParagonEntry[];
}

const DRAWER_WIDTH = 340;
const HANDLE_HEIGHT = 40;

/**
 * Bottom-left slide-up drawer. Handle peeks above the viewport edge; clicking
 * it toggles the drawer open, revealing the paragon card at its native
 * landscape aspect (1.4:1). Positioned away from the right-side chat/preview.
 *
 * In multiplayer with ≥2 paragons, a tab row sits above the card.
 * Handle click toggles; `Esc` closes while open.
 */
export function ParagonDrawer({ paragons }: ParagonDrawerProps) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (paragons.length === 0) {
      setActiveId(null);
      return;
    }
    const self = paragons.find((p) => p.isSelf);
    setActiveId((curr) => {
      if (curr && paragons.some((p) => p.playerId === curr)) return curr;
      return (self ?? paragons[0]).playerId;
    });
  }, [paragons]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  if (paragons.length === 0) return null;

  const selfEntry = paragons.find((p) => p.isSelf) ?? paragons[0];
  const activeEntry = paragons.find((p) => p.playerId === activeId) ?? selfEntry;
  const showTabs = paragons.length >= 2;

  return (
    <div
      style={{
        position: 'fixed',
        right: 396,
        bottom: 0,
        width: DRAWER_WIDTH,
        maxWidth: 'calc(100vw - 32px)',
        zIndex: 900,
        transform: open
          ? 'translateY(0)'
          : `translateY(calc(100% - ${HANDLE_HEIGHT}px))`,
        transition: 'transform 340ms cubic-bezier(0.32, 0.72, 0, 1)',
        willChange: 'transform',
        pointerEvents: 'auto',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? 'Close paragon drawer' : 'Open paragon drawer'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          height: HANDLE_HEIGHT,
          padding: '0 14px 0 6px',
          background: 'rgba(14, 10, 6, 0.96)',
          border: '1px solid rgba(196, 149, 90, 0.5)',
          borderBottom: 'none',
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          color: '#e8d5a3',
          fontFamily: 'Cinzel, Georgia, serif',
          fontSize: 12,
          letterSpacing: 1.5,
          cursor: 'pointer',
          boxShadow: '0 -4px 16px rgba(0, 0, 0, 0.35)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src={selfEntry.imageUrl}
            alt=""
            style={{
              width: 42,
              height: 30,
              objectFit: 'cover',
              borderRadius: 2,
              border: '1px solid rgba(196, 149, 90, 0.3)',
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
            }}
          />
          PARAGON
        </span>
        <span
          aria-hidden
          style={{
            fontSize: 16,
            opacity: 0.8,
            transition: 'transform 340ms cubic-bezier(0.32, 0.72, 0, 1)',
            transform: open ? 'rotate(0deg)' : 'rotate(180deg)',
            lineHeight: 1,
          }}
        >
          ▾
        </span>
      </button>

      <div
        role="dialog"
        aria-label={`Paragon: ${activeEntry.paragonName}`}
        style={{
          background: 'rgba(14, 10, 6, 0.96)',
          border: '1px solid rgba(196, 149, 90, 0.5)',
          borderBottomLeftRadius: 8,
          borderBottomRightRadius: 8,
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {showTabs && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              justifyContent: 'center',
              borderBottom: '1px solid rgba(196, 149, 90, 0.2)',
              paddingBottom: 8,
            }}
          >
            {paragons.map((p) => {
              const active = p.playerId === activeEntry.playerId;
              return (
                <button
                  key={p.playerId}
                  type="button"
                  onClick={() => setActiveId(p.playerId)}
                  style={{
                    padding: '5px 12px',
                    background: active ? 'rgba(196, 149, 90, 0.25)' : 'transparent',
                    border: '1px solid rgba(196, 149, 90, 0.4)',
                    borderRadius: 3,
                    color: active ? '#f3e2b4' : 'rgba(196, 149, 90, 0.7)',
                    fontFamily: 'Cinzel, Georgia, serif',
                    fontSize: 11,
                    letterSpacing: 1,
                    cursor: 'pointer',
                  }}
                >
                  {p.displayName.toUpperCase()}
                </button>
              );
            })}
          </div>
        )}

        <img
          src={activeEntry.imageUrl}
          alt={`Paragon ${activeEntry.paragonName}`}
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
  );
}
