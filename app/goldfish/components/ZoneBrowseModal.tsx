'use client';

import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { useGame } from '../state/GameContext';
import { ZoneId, ZONE_LABELS, GameCard } from '../types';
import { X } from 'lucide-react';
import { useModalCardHover, ModalCardHoverPreview } from './ModalCardHoverPreview';

const BLOB_BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

function sanitizeImgFile(f: string): string {
  return f.replace(/\.jpe?g$/i, '');
}

function getCardImageUrl(imgFile: string): string {
  if (!imgFile) return '';
  return `${BLOB_BASE_URL}/card-images/${sanitizeImgFile(imgFile)}.jpg`;
}

const MOVE_ZONES: { id: ZoneId; label: string }[] = [
  { id: 'hand', label: 'Hand' },
  { id: 'territory', label: 'Territory' },
  { id: 'discard', label: 'Discard' },
  { id: 'reserve', label: 'Reserve' },
];

function CardContextPopup({
  card,
  x,
  y,
  currentZone,
  onClose,
  onMove,
  onMoveToTop,
  onMoveToBottom,
  onShuffleIntoDeck,
}: {
  card: GameCard;
  x: number;
  y: number;
  currentZone: ZoneId;
  onClose: () => void;
  onMove: (zone: ZoneId) => void;
  onMoveToTop: () => void;
  onMoveToBottom: () => void;
  onShuffleIntoDeck: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const itemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '5px 12px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#c9b99a',
    fontSize: 11,
    textAlign: 'left',
    fontFamily: 'var(--font-cinzel), Georgia, serif',
  };

  const filteredZones = MOVE_ZONES.filter(z => z.id !== currentZone);

  return (
    <div
      ref={ref}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: Math.min(x, window.innerWidth - 160),
        top: Math.min(y, window.innerHeight - 300),
        background: '#2a1f12',
        border: '1px solid #6b4e27',
        borderRadius: 6,
        padding: '4px 0',
        zIndex: 600,
        minWidth: 140,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      }}
    >
      <div style={{ ...itemStyle, color: '#8b6532', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'default', padding: '3px 12px' }}>
        Move to...
      </div>
      {filteredZones.map(({ id, label }) => (
        <button
          key={id}
          style={itemStyle}
          onClick={() => { onMove(id); onClose(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196,149,90,0.15)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {label}
        </button>
      ))}
      <div style={{ height: 1, background: '#6b4e27', margin: '4px 8px', opacity: 0.5 }} />
      <button
        style={itemStyle}
        onClick={() => { onMoveToTop(); onClose(); }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196,149,90,0.15)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Top of Deck
      </button>
      <button
        style={itemStyle}
        onClick={() => { onMoveToBottom(); onClose(); }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196,149,90,0.15)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Bottom of Deck
      </button>
      <button
        style={itemStyle}
        onClick={() => { onShuffleIntoDeck(); onClose(); }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196,149,90,0.15)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Shuffle into Deck
      </button>
    </div>
  );
}

interface ZoneBrowseModalProps {
  zoneId: ZoneId;
  onClose: () => void;
  onStartDrag?: (card: GameCard, imageUrl: string, e: React.PointerEvent) => void;
  onStartMultiDrag?: (cards: { card: GameCard; imageUrl: string }[], e: React.PointerEvent) => void;
  didDragRef?: React.MutableRefObject<boolean>;
  isDragActive?: boolean;
}

export function ZoneBrowseModal({ zoneId, onClose, onStartDrag, onStartMultiDrag, didDragRef, isDragActive }: ZoneBrowseModalProps) {
  const { state, moveCard, moveCardsBatch, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleCardIntoDeck } = useGame();
  const cards = state.zones[zoneId];
  const { hover, onCardMouseEnter, onCardMouseLeave } = useModalCardHover();
  const [contextCard, setContextCard] = useState<{ card: GameCard; x: number; y: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Clear selection after a drag completes (isDragActive goes from true -> false)
  const prevDragActive = useRef(false);
  useEffect(() => {
    if (prevDragActive.current && !isDragActive) {
      setSelectedIds(new Set());
    }
    prevDragActive.current = !!isDragActive;
  }, [isDragActive]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedIds.size > 0) {
          setSelectedIds(new Set());
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, selectedIds.size]);

  const handleCardContextMenu = (card: GameCard, e: React.MouseEvent) => {
    e.preventDefault();
    onCardMouseLeave();
    setContextCard({ card, x: e.clientX, y: e.clientY });
  };

  const handleCardClick = (card: GameCard) => {
    // Skip toggle if a drag just happened
    if (didDragRef?.current) {
      didDragRef.current = false;
      return;
    }
    setContextCard(null);
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(card.instanceId)) {
        next.delete(card.instanceId);
      } else {
        next.add(card.instanceId);
      }
      return next;
    });
  };

  const handlePointerDown = (card: GameCard, imageUrl: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onCardMouseLeave();

    const isSelected = selectedIds.has(card.instanceId);
    if (isSelected && selectedIds.size > 1 && onStartMultiDrag) {
      // Multi-card drag: gather all selected cards
      const allSelected = cards.filter(c => selectedIds.has(c.instanceId));
      onStartMultiDrag(
        allSelected.map(c => ({ card: c, imageUrl: getCardImageUrl(c.cardImgFile) })),
        e,
      );
    } else if (onStartDrag) {
      onStartDrag(card, imageUrl, e);
    }
  };

  // Multi-card context menu handlers
  const handleMultiMove = (zone: ZoneId) => {
    const ids = Array.from(selectedIds);
    moveCardsBatch(ids, zone);
    setSelectedIds(new Set());
    setContextCard(null);
  };

  const handleMultiTopDeck = () => {
    for (const id of selectedIds) moveCardToTopOfDeck(id);
    setSelectedIds(new Set());
    setContextCard(null);
  };

  const handleMultiBottomDeck = () => {
    for (const id of selectedIds) moveCardToBottomOfDeck(id);
    setSelectedIds(new Set());
    setContextCard(null);
  };

  const handleMultiShuffleIntoDeck = () => {
    for (const id of selectedIds) shuffleCardIntoDeck(id);
    setSelectedIds(new Set());
    setContextCard(null);
  };

  // Determine if context card is part of a multi-selection
  const isMultiContext = contextCard && selectedIds.has(contextCard.card.instanceId) && selectedIds.size > 1;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => { setContextCard(null); onClose(); }}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500,
      }}
    >
      <div
        onClick={(e) => { e.stopPropagation(); setContextCard(null); }}
        style={{
          background: '#2a1f12',
          border: '1px solid #6b4e27',
          borderRadius: 8,
          padding: 20,
          maxWidth: 850,
          maxHeight: '85vh',
          width: '90vw',
          overflow: 'auto',
          position: 'relative',
          opacity: isDragActive ? 0.15 : 1,
          pointerEvents: isDragActive ? 'none' : 'auto',
          transition: 'opacity 0.2s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2
              style={{
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 16,
                color: '#e8d5a3',
              }}
            >
              {ZONE_LABELS[zoneId]} ({cards.length})
            </h2>
            {selectedIds.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  color: '#c4955a',
                  fontSize: 12,
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                }}>
                  {selectedIds.size} selected
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set()); }}
                  style={{
                    background: 'transparent',
                    border: '1px solid #6b4e27',
                    borderRadius: 4,
                    color: '#8b6532',
                    fontSize: 10,
                    padding: '2px 6px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-cinzel), Georgia, serif',
                  }}
                >
                  Deselect
                </button>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#8b6532' }}
          >
            <X size={18} />
          </button>
        </div>

        {cards.length === 0 ? (
          <p style={{ color: '#8b6532', fontStyle: 'italic' }}>Empty</p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 10,
            }}
          >
            {cards.map((card) => {
              const imageUrl = getCardImageUrl(card.cardImgFile);
              const isSelected = selectedIds.has(card.instanceId);
              return (
                <div
                  key={card.instanceId}
                  style={{ position: 'relative', cursor: 'grab' }}
                  onPointerDown={(e) => handlePointerDown(card, imageUrl, e)}
                  onClick={(e) => { e.stopPropagation(); handleCardClick(card); }}
                  onContextMenu={(e) => handleCardContextMenu(card, e)}
                  onMouseEnter={(e) => { if (!contextCard) onCardMouseEnter(card.cardImgFile, card.cardName, e); }}
                  onMouseLeave={onCardMouseLeave}
                >
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={card.cardName}
                      draggable={false}
                      style={{
                        width: '100%',
                        borderRadius: 4,
                        border: isSelected ? '2px solid #c4955a' : '1px solid #6b4e27',
                        boxShadow: isSelected ? '0 0 8px rgba(196,149,90,0.4)' : 'none',
                        transition: 'border 0.1s ease, box-shadow 0.1s ease',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        aspectRatio: '1/1.4',
                        background: '#1e1610',
                        border: isSelected ? '2px solid #c4955a' : '1px solid #6b4e27',
                        boxShadow: isSelected ? '0 0 8px rgba(196,149,90,0.4)' : 'none',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#8b6532',
                        fontSize: 10,
                        transition: 'border 0.1s ease, box-shadow 0.1s ease',
                      }}
                    >
                      {card.cardName}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {contextCard && (
        isMultiContext ? (
          <CardContextPopup
            card={contextCard.card}
            x={contextCard.x}
            y={contextCard.y}
            currentZone={zoneId}
            onClose={() => setContextCard(null)}
            onMove={handleMultiMove}
            onMoveToTop={handleMultiTopDeck}
            onMoveToBottom={handleMultiBottomDeck}
            onShuffleIntoDeck={handleMultiShuffleIntoDeck}
          />
        ) : (
          <CardContextPopup
            card={contextCard.card}
            x={contextCard.x}
            y={contextCard.y}
            currentZone={zoneId}
            onClose={() => setContextCard(null)}
            onMove={(zone) => moveCard(contextCard.card.instanceId, zone)}
            onMoveToTop={() => moveCardToTopOfDeck(contextCard.card.instanceId)}
            onMoveToBottom={() => moveCardToBottomOfDeck(contextCard.card.instanceId)}
            onShuffleIntoDeck={() => shuffleCardIntoDeck(contextCard.card.instanceId)}
          />
        )
      )}

      <ModalCardHoverPreview hover={hover} />
    </motion.div>
  );
}
