'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { GameCard } from '@/app/shared/types/gameCard';

interface CardReaderOverlayProps {
  card: GameCard;
  /** Already resolved (forge-aware) image URL, or '' when unavailable. */
  imageUrl: string;
  onClose: () => void;
}

/**
 * Full-screen card reader.
 *
 * On a pointer device a player reads a card by hovering it — the hover preview
 * and the right panel's loupe are both hover-fed, and both are disabled on
 * touch (see the `!isTouch` gate on the hover preview in MultiplayerCanvas and
 * `[data-panel-preview] { display: none }` in globals.css). That left a phone
 * player with no way at all to read a card's text: board cards render around
 * 57x79 px at fit.
 *
 * This is that missing surface — reached from the touch context sheet's header
 * and from the board browse sheets. Landscape phones are wide and short, so the
 * layout is a row: the scan fills the height, the text column scrolls beside it.
 */
export function CardReaderOverlay({ card, imageUrl, onClose }: CardReaderOverlayProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stats = card.strength || card.toughness
    ? `${card.strength || '–'} / ${card.toughness || '–'}`
    : null;

  return (
    <div
      data-card-reader
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        inset: 0,
        // Above the touch context sheet (900) and the right panel's phone
        // overlay (300) — the reader is opened FROM the sheet and must cover it.
        zIndex: 1200,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 'max(10px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left))',
        // The scan is tall; a landscape phone is short. Row keeps the image as
        // large as the height allows and gives the text the leftover width.
        flexDirection: 'row',
      }}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={card.cardName}
          onClick={(e) => e.stopPropagation()}
          style={{
            height: '100%',
            width: 'auto',
            maxWidth: '55%',
            objectFit: 'contain',
            borderRadius: 8,
            boxShadow: '0 10px 40px rgba(0,0,0,0.7)',
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            height: '100%',
            aspectRatio: '5 / 7',
            borderRadius: 8,
            border: '1px solid rgba(107,78,39,0.5)',
            background: 'rgba(30,22,16,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(232,213,163,0.5)',
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          No scan
        </div>
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          minWidth: 0,
          maxWidth: 460,
          maxHeight: '100%',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          color: '#e8d5a3',
        }}
      >
        <div style={{
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 17,
          fontWeight: 700,
          lineHeight: 1.25,
          paddingRight: 52, // clear of the close button
        }}>
          {card.cardName || 'Face-down card'}
        </div>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px 10px',
          marginTop: 6,
          fontSize: 12,
          color: 'rgba(232,213,163,0.65)',
        }}>
          {card.type && <span>{card.type}</span>}
          {card.brigade && <span style={{ color: 'rgba(212,168,103,0.85)' }}>{card.brigade}</span>}
          {stats && <span>{stats}</span>}
          {card.identifier && <span>{card.identifier}</span>}
        </div>
        {card.specialAbility && (
          <p style={{
            marginTop: 10,
            fontSize: 13,
            lineHeight: 1.45,
            color: 'rgba(232,213,163,0.92)',
            whiteSpace: 'pre-wrap',
          }}>
            {card.specialAbility}
          </p>
        )}
        {card.reference && (
          <p style={{
            marginTop: 8,
            fontSize: 11,
            fontStyle: 'italic',
            color: 'rgba(232,213,163,0.55)',
          }}>
            {card.reference}
          </p>
        )}
        {card.notes && (
          <p style={{
            marginTop: 10,
            fontSize: 12,
            lineHeight: 1.4,
            color: '#c4955a',
            borderTop: '1px solid rgba(107,78,39,0.5)',
            paddingTop: 8,
          }}>
            {card.notes}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close card view"
        data-testid="card-reader-close"
        style={{
          position: 'absolute',
          top: 'max(8px, env(safe-area-inset-top))',
          right: 'max(8px, env(safe-area-inset-right))',
          width: 44,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          border: '1px solid rgba(107,78,39,0.6)',
          background: 'rgba(14,10,6,0.9)',
          color: '#e8d5a3',
        }}
      >
        <X size={20} />
      </button>
    </div>
  );
}
