'use client';

import { useEffect, useState } from 'react';
import type { ParagonEntry } from '../types/paragonEntry';

interface ParagonDrawerProps {
  /** Paragon entries to display. Empty array = drawer hidden entirely. */
  paragons: ParagonEntry[];
}

/**
 * Bottom-right pull-tab that expands into a full-screen overlay showing
 * the current paragon card at its native landscape aspect (1.4:1).
 *
 * In multiplayer with ≥2 paragons, a tab row appears above the card.
 * `P` toggles; backdrop click or `Esc` closes.
 */
export function ParagonDrawer({ paragons }: ParagonDrawerProps) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Default active tab: the local player's paragon, or first entry.
  useEffect(() => {
    if (paragons.length === 0) {
      setActiveId(null);
      return;
    }
    const self = paragons.find((p) => p.isSelf);
    setActiveId((curr) => {
      // keep existing choice if still valid
      if (curr && paragons.some((p) => p.playerId === curr)) return curr;
      return (self ?? paragons[0]).playerId;
    });
  }, [paragons]);

  // Keyboard: P toggles, Esc closes. Ignore when typing in inputs.
  useEffect(() => {
    if (paragons.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [paragons.length, open]);

  if (paragons.length === 0) return null;

  const selfEntry = paragons.find((p) => p.isSelf) ?? paragons[0];
  const activeEntry = paragons.find((p) => p.playerId === activeId) ?? selfEntry;
  const showTabs = paragons.length >= 2;

  return (
    <>
      {/* Pull-tab (always rendered when there's at least one paragon) */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open paragon"
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          zIndex: 900,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 44,
          padding: '4px 10px 4px 4px',
          background: 'rgba(14, 10, 6, 0.92)',
          border: '1px solid rgba(196, 149, 90, 0.5)',
          borderRadius: 6,
          color: '#e8d5a3',
          fontFamily: 'Cinzel, Georgia, serif',
          fontSize: 12,
          letterSpacing: 1,
          cursor: 'pointer',
          boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
        }}
      >
        <img
          src={selfEntry.imageUrl}
          alt=""
          style={{
            width: 50,
            height: 36,
            objectFit: 'cover',
            borderRadius: 3,
            border: '1px solid rgba(196, 149, 90, 0.3)',
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
        PARAGON
      </button>

      {/* Backdrop + drawer (rendered when open) */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          role="presentation"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 950,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingBottom: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Paragon: ${activeEntry.paragonName}`}
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              padding: 16,
              paddingTop: 28,
              background: 'rgba(14, 10, 6, 0.97)',
              border: '1px solid rgba(196, 149, 90, 0.3)',
              borderRadius: 8,
              boxShadow: '0 12px 48px rgba(0,0,0,0.7)',
              maxWidth: '90vw',
            }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close paragon drawer"
              style={{
                position: 'absolute',
                top: 6,
                right: 8,
                width: 26,
                height: 26,
                padding: 0,
                background: 'transparent',
                border: 'none',
                color: 'rgba(196, 149, 90, 0.7)',
                fontSize: 20,
                lineHeight: 1,
                cursor: 'pointer',
                fontFamily: 'Georgia, serif',
              }}
            >
              ×
            </button>
            {/* Tabs (only when ≥2 paragons) */}
            {showTabs && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 4,
                  borderBottom: '1px solid rgba(196, 149, 90, 0.2)',
                  paddingBottom: 8,
                  width: '100%',
                  justifyContent: 'center',
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
                        padding: '6px 14px',
                        background: active ? 'rgba(196, 149, 90, 0.25)' : 'transparent',
                        border: '1px solid rgba(196, 149, 90, 0.4)',
                        borderRadius: 4,
                        color: active ? '#f3e2b4' : 'rgba(196, 149, 90, 0.7)',
                        fontFamily: 'Cinzel, Georgia, serif',
                        fontSize: 12,
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

            {/* Paragon image, landscape aspect preserved */}
            <img
              src={activeEntry.imageUrl}
              alt={`Paragon ${activeEntry.paragonName}`}
              style={{
                width: 'min(90vw, 600px)',
                height: 'auto',
                aspectRatio: '1.4 / 1',
                objectFit: 'contain',
                borderRadius: 4,
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
