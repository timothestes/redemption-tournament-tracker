'use client';

import { useEffect, useState } from 'react';
import type { ParagonEntry } from '../types/paragonEntry';

interface ParagonDrawerProps {
  /** Paragon entries to display. Empty array = drawer hidden entirely. */
  paragons: ParagonEntry[];
}

const DRAWER_WIDTH = 620;
const HANDLE_WIDTH = 180;
const HANDLE_HEIGHT = 36;

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
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (paragons.length < 2) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveId((curr) => {
          const idx = paragons.findIndex((p) => p.playerId === curr);
          const base = idx === -1 ? 0 : idx;
          const step = e.key === 'ArrowRight' ? 1 : -1;
          const next = (base + step + paragons.length) % paragons.length;
          return paragons[next].playerId;
        });
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, paragons]);

  if (paragons.length === 0) return null;

  const selfEntry = paragons.find((p) => p.isSelf) ?? paragons[0];
  const activeEntry = paragons.find((p) => p.playerId === activeId) ?? selfEntry;
  const showTabs = paragons.length >= 2;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open paragon"
        aria-hidden={open}
        tabIndex={open ? -1 : 0}
        style={{
          position: 'fixed',
          right: 400,
          bottom: 16,
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
          transform: open ? 'translateY(12px)' : 'translateY(0)',
          transition: 'opacity 200ms ease-out, transform 200ms ease-out',
          pointerEvents: open ? 'none' : 'auto',
        }}
      >
        <img
          src={selfEntry.imageUrl}
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
        <span style={{ flex: 1, textAlign: 'left' }}>PARAGON</span>
        <span aria-hidden style={{ fontSize: 10, opacity: 0.6 }}>
          ▴
        </span>
      </button>

      <div
        role="dialog"
        aria-label={`Paragon: ${activeEntry.paragonName}`}
        aria-hidden={!open}
        style={{
          position: 'fixed',
          right: 396,
          bottom: 0,
          zIndex: 900,
          width: DRAWER_WIDTH,
          maxWidth: 'calc(100vw - 32px)',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 360ms cubic-bezier(0.32, 0.72, 0, 1)',
          willChange: 'transform',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        <div
          style={{
            background: 'rgba(14, 10, 6, 0.98)',
            border: '1px solid rgba(196, 149, 90, 0.5)',
            borderBottom: 'none',
            borderTopLeftRadius: 10,
            borderTopRightRadius: 10,
            boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.55)',
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
              PARAGON
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close paragon drawer"
              style={{
                width: 28,
                height: 28,
                padding: 0,
                background: 'transparent',
                border: 'none',
                color: 'rgba(196, 149, 90, 0.75)',
                fontSize: 20,
                lineHeight: 1,
                cursor: 'pointer',
                fontFamily: 'Georgia, serif',
              }}
            >
              ×
            </button>
          </div>

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
    </>
  );
}
