'use client';

import { motion } from 'framer-motion';
import { useGame } from '../state/GameContext';
import { GameCard, ZoneId, ZONE_LABELS } from '../types';
import { X } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useModalCardHover, ModalCardHoverPreview } from './ModalCardHoverPreview';

const BLOB_BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

function sanitizeImgFile(f: string): string {
  return f.replace(/\.jpe?g$/i, '');
}

function getCardImageUrl(imgFile: string): string {
  if (!imgFile) return '';
  return `${BLOB_BASE_URL}/card-images/${sanitizeImgFile(imgFile)}.jpg`;
}

interface DeckPeekModalProps {
  count: number;
  onClose: () => void;
  onStartDrag?: (card: GameCard, imageUrl: string, e: React.PointerEvent) => void;
  isDragActive?: boolean;
}

export function DeckPeekModal({ count, onClose, onStartDrag, isDragActive }: DeckPeekModalProps) {
  const { state } = useGame();
  const { hover, onCardMouseEnter, onCardMouseLeave } = useModalCardHover();

  // Snapshot the top N card instance IDs on mount so they don't shift as cards are moved
  const [peekedIds] = useState(() =>
    state.zones.deck.slice(0, count).map(c => c.instanceId)
  );

  // Derive live cards from current state (they may have been moved already)
  const peekedCards = peekedIds
    .map(id => state.zones.deck.find(c => c.instanceId === id))
    .filter((c): c is GameCard => !!c);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1e1610',
          border: '1px solid #6b4e27',
          borderRadius: 8,
          padding: 20,
          width: '90vw',
          maxWidth: '90vw',
          maxHeight: '85vh',
          overflowY: 'auto',
          position: 'relative',
          opacity: isDragActive ? 0.15 : 1,
          pointerEvents: isDragActive ? 'none' : 'auto',
          transition: 'opacity 0.2s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            color: '#e8d5a3',
            fontSize: 16,
            margin: 0,
          }}>
            Top {count} of Deck
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#c9b99a', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        <p style={{
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          color: '#8b6532',
          fontSize: 11,
          marginBottom: 12,
        }}>
          Drag to a zone · Hover to enlarge
        </p>

        {peekedCards.length === 0 ? (
          <p style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            color: '#6b4e27',
            fontSize: 13,
            textAlign: 'center',
            padding: 20,
          }}>
            All peeked cards have been moved
          </p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 12,
            }}
          >
            {peekedCards.map((card, idx) => (
              <div
                key={card.instanceId}
                style={{ position: 'relative', cursor: 'grab' }}
                onPointerDown={(e) => {
                  if (e.button === 0 && onStartDrag) {
                    onCardMouseLeave();
                    onStartDrag(card, getCardImageUrl(card.cardImgFile), e);
                  }
                }}
                onMouseEnter={(e) => onCardMouseEnter(card.cardImgFile, card.cardName, e)}
                onMouseLeave={onCardMouseLeave}
              >
                <div style={{
                  position: 'absolute',
                  top: 4,
                  left: 4,
                  background: 'rgba(30,22,16,0.85)',
                  border: '1px solid #6b4e27',
                  borderRadius: 4,
                  padding: '2px 6px',
                  fontSize: 10,
                  color: '#c4955a',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  zIndex: 1,
                }}>
                  #{idx + 1}
                </div>
                {card.cardImgFile ? (
                  <img
                    src={getCardImageUrl(card.cardImgFile)}
                    alt={card.cardName}
                    draggable={false}
                    style={{
                      width: '100%',
                      borderRadius: 4,
                      border: '1px solid #6b4e27',
                    }}
                  />
                ) : (
                  <div style={{
                    width: '100%',
                    aspectRatio: '2.5/3.5',
                    background: '#2a1f12',
                    border: '1px solid #6b4e27',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#c9b99a',
                    fontSize: 11,
                    fontFamily: 'var(--font-cinzel), Georgia, serif',
                    textAlign: 'center',
                    padding: 8,
                  }}>
                    {card.cardName}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </motion.div>

      <ModalCardHoverPreview hover={hover} />
    </div>
  );
}
