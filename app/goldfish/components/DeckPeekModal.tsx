'use client';

import { motion } from 'framer-motion';
import { useGame } from '../state/GameContext';
import { GameCard } from '../types';
import { X, ArrowUp, ArrowDown, Shuffle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useModalCardHover, ModalCardHoverPreview } from './ModalCardHoverPreview';

const BLOB_BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

function sanitizeImgFile(f: string): string {
  return f.replace(/\.jpe?g$/i, '');
}

function getCardImageUrl(imgFile: string): string {
  if (!imgFile) return '';
  return `${BLOB_BASE_URL}/card-images/${sanitizeImgFile(imgFile)}.jpg`;
}

function PeekActionButton({ icon, label, onClick, style }: {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 12px',
        background: '#2a1f12',
        border: '1px solid #6b4e27',
        borderRadius: 5,
        color: '#e8d5a3',
        fontSize: 12,
        fontFamily: 'var(--font-cinzel), Georgia, serif',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#3d2e1a';
        e.currentTarget.style.borderColor = '#c4955a';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#2a1f12';
        e.currentTarget.style.borderColor = '#6b4e27';
      }}
    >
      {icon}
      {label}
    </button>
  );
}

interface DeckPeekModalProps {
  count: number;
  onClose: () => void;
  onStartDrag?: (card: GameCard, imageUrl: string, e: React.PointerEvent) => void;
  isDragActive?: boolean;
}

export function DeckPeekModal({ count, onClose, onStartDrag, isDragActive }: DeckPeekModalProps) {
  const { state, moveCardsBatch, shuffleDeck } = useGame();
  const { hover, onCardMouseEnter, onCardMouseLeave } = useModalCardHover();

  // Snapshot the top N card instance IDs on mount so they don't shift as cards are moved
  const [peekedIds] = useState(() =>
    state.zones.deck.slice(0, count).map(c => c.instanceId)
  );

  // Derive live cards from current state (they may have been moved already)
  const peekedCards = peekedIds
    .map(id => state.zones.deck.find(c => c.instanceId === id))
    .filter((c): c is GameCard => !!c);

  const remainingIds = peekedCards.map(c => c.instanceId);
  const hasRemaining = remainingIds.length > 0;

  const handleCloseAction = (action: 'top' | 'bottom' | 'shuffle') => {
    if (hasRemaining) {
      if (action === 'bottom') {
        // Remove from current positions and push to bottom of deck
        moveCardsBatch(remainingIds, 'deck');
      } else if (action === 'shuffle') {
        shuffleDeck();
      }
      // 'top' → cards are already on top, do nothing
    }
    onClose();
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCloseAction('top');
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [hasRemaining, remainingIds]);

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
      onClick={() => handleCloseAction('top')}
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
            onClick={() => handleCloseAction('top')}
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

        {/* Action footer — choose where remaining peeked cards go */}
        <div style={{
          marginTop: 16,
          paddingTop: 12,
          borderTop: '1px solid #3d2e1a',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}>
          {hasRemaining ? (
            <>
              <span style={{
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                color: '#6b4e27',
                fontSize: 11,
                marginRight: 4,
              }}>
                Put back:
              </span>
              <PeekActionButton
                icon={<ArrowUp size={13} />}
                label="Top of Deck"
                onClick={() => handleCloseAction('top')}
              />
              <PeekActionButton
                icon={<ArrowDown size={13} />}
                label="Bottom of Deck"
                onClick={() => handleCloseAction('bottom')}
              />
              <PeekActionButton
                icon={<Shuffle size={13} />}
                label="Shuffle In"
                onClick={() => handleCloseAction('shuffle')}
              />
            </>
          ) : (
            <PeekActionButton
              label="Close"
              onClick={onClose}
              style={{ marginLeft: 'auto' }}
            />
          )}
        </div>
      </motion.div>

      <ModalCardHoverPreview hover={hover} />
    </div>
  );
}
