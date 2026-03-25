'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useModalGame } from '@/app/shared/contexts/ModalGameContext';
import { ZoneId, ZONE_LABELS, GameCard } from '@/app/shared/types/gameCard';
import { X } from 'lucide-react';
import { useModalCardHover, ModalCardHoverPreview, getHoverGlowStyle } from './ModalCardHoverPreview';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';

const MOVE_ZONES: { id: ZoneId; label: string }[] = [
  { id: 'hand', label: 'Hand' },
  { id: 'territory', label: 'Territory' },
  { id: 'discard', label: 'Discard' },
  { id: 'reserve', label: 'Reserve' },
];

function CardContextPopup({
  card,
  count,
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
  count?: number;
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
    color: 'var(--gf-text)',
    fontSize: 11,
    textAlign: 'left',
    fontFamily: 'var(--font-cinzel), Georgia, serif',
  };

  const filteredZones = MOVE_ZONES.filter(z => z.id !== currentZone);
  const label = count && count > 1 ? `Move ${count} cards to...` : 'Move to...';

  return (
    <div
      ref={ref}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: Math.min(x, window.innerWidth - 160),
        top: Math.min(y, window.innerHeight - 300),
        background: 'var(--gf-bg)',
        border: '1px solid var(--gf-border)',
        borderRadius: 6,
        padding: '4px 0',
        zIndex: 600,
        minWidth: 140,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      }}
    >
      <div style={{ ...itemStyle, color: 'var(--gf-text-dim)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'default', padding: '3px 12px' }}>
        {label}
      </div>
      {filteredZones.map(({ id, label: zoneLabel }) => (
        <button
          key={id}
          style={itemStyle}
          onClick={() => { onMove(id); onClose(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {zoneLabel}
        </button>
      ))}
      <div style={{ height: 1, background: 'var(--gf-border)', margin: '4px 8px', opacity: 0.5 }} />
      <button
        style={itemStyle}
        onClick={() => { onMoveToTop(); onClose(); }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Top of Deck
      </button>
      <button
        style={itemStyle}
        onClick={() => { onMoveToBottom(); onClose(); }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Bottom of Deck
      </button>
      <button
        style={itemStyle}
        onClick={() => { onShuffleIntoDeck(); onClose(); }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Shuffle into Deck
      </button>
    </div>
  );
}

// Check if two axis-aligned rectangles overlap
function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

interface ZoneBrowseModalProps {
  zoneId: ZoneId;
  onClose: () => void;
  onStartDrag?: (card: GameCard, imageUrl: string, e: React.PointerEvent) => void;
  onStartMultiDrag?: (cards: { card: GameCard; imageUrl: string }[], e: React.PointerEvent) => void;
  didDragRef?: React.MutableRefObject<boolean>;
  isDragActive?: boolean;
  readOnly?: boolean;
}

export function ZoneBrowseModal({ zoneId, onClose, onStartDrag, onStartMultiDrag, didDragRef, isDragActive, readOnly }: ZoneBrowseModalProps) {
  const { zones, actions } = useModalGame();
  const { moveCard, moveCardsBatch, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleCardIntoDeck } = actions;
  const cards = zones[zoneId];
  const { setPreviewCard, isLoupeVisible } = useCardPreview();
  const { hover, hoverProgress, hoveredCardId, onCardMouseEnter, onCardMouseLeave } = useModalCardHover(200, { setPreviewCard, isLoupeVisible });
  const [contextCard, setContextCard] = useState<{ card: GameCard; x: number; y: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Refs for card DOM elements (for lasso hit-testing)
  const cardElRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const registerCardEl = useCallback((instanceId: string, el: HTMLDivElement | null) => {
    if (el) cardElRefs.current.set(instanceId, el);
    else cardElRefs.current.delete(instanceId);
  }, []);

  // Lasso selection state
  const gridRef = useRef<HTMLDivElement>(null);
  const [lassoRect, setLassoRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const lassoStart = useRef<{ x: number; y: number } | null>(null);
  const isLassoing = useRef(false);

  // Close modal after a successful drag-to-canvas completes (isDragActive goes from true -> false)
  const prevDragActive = useRef(false);
  useEffect(() => {
    if (prevDragActive.current && !isDragActive) {
      setSelectedIds(new Set());
      onClose();
    }
    prevDragActive.current = !!isDragActive;
  }, [isDragActive, onClose]);

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
    if (readOnly) return;
    onCardMouseLeave();
    setContextCard({ card, x: e.clientX, y: e.clientY });
    // Re-set the loupe preview so it keeps showing the right-clicked card
    setPreviewCard({ cardName: card.cardName, cardImgFile: card.cardImgFile, isMeek: card.isMeek });
  };

  // Track pointer down card to distinguish click from drag on pointer up
  const pointerDownCardRef = useRef<string | null>(null);

  const handlePointerDown = (card: GameCard, imageUrl: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (readOnly) return;
    onCardMouseLeave();
    pointerDownCardRef.current = card.instanceId;

    // Reset didDragRef so we can detect if a drag fires before pointerUp
    if (didDragRef) didDragRef.current = false;

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

  const handlePointerUp = (card: GameCard) => {
    // Only toggle selection if this was a click (no drag occurred) on the same card
    if (pointerDownCardRef.current !== card.instanceId) return;
    pointerDownCardRef.current = null;
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

  // Lasso selection: pointer down on empty space in the content area starts lasso
  const contentRef = useRef<HTMLDivElement>(null);
  const handleContentPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Block lasso on interactive elements (buttons, card images, inputs)
    const target = e.target as HTMLElement;
    const tag = target.tagName.toLowerCase();
    if (tag === 'button' || tag === 'img' || tag === 'input') return;
    // Block lasso if clicking inside a card element (has data-card-id)
    if (target.closest('[data-card-id]')) return;
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const x = e.clientX - rect.left + grid.scrollLeft;
    const y = e.clientY - rect.top + grid.scrollTop;
    lassoStart.current = { x, y };
    isLassoing.current = true;
    setLassoRect(null);
    // Clear selection unless shift is held
    if (!e.shiftKey) {
      setSelectedIds(new Set());
    }
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isLassoing.current || !lassoStart.current || !gridRef.current) return;
      const grid = gridRef.current;
      const rect = grid.getBoundingClientRect();
      const currentX = e.clientX - rect.left + grid.scrollLeft;
      const currentY = e.clientY - rect.top + grid.scrollTop;
      const sx = Math.min(lassoStart.current.x, currentX);
      const sy = Math.min(lassoStart.current.y, currentY);
      const sw = Math.abs(currentX - lassoStart.current.x);
      const sh = Math.abs(currentY - lassoStart.current.y);

      setLassoRect({ x: sx, y: sy, w: sw, h: sh });

      // Hit-test cards against lasso rect
      if (sw > 5 || sh > 5) {
        const hits = new Set<string>();
        for (const [instanceId, el] of cardElRefs.current) {
          const cardRect = el.getBoundingClientRect();
          // Convert card rect to grid-relative coordinates
          const cx = cardRect.left - rect.left + grid.scrollLeft;
          const cy = cardRect.top - rect.top + grid.scrollTop;
          if (rectsOverlap(sx, sy, sw, sh, cx, cy, cardRect.width, cardRect.height)) {
            hits.add(instanceId);
          }
        }
        setSelectedIds(hits);
      }
    };

    const onUp = () => {
      if (isLassoing.current) {
        isLassoing.current = false;
        lassoStart.current = null;
        setLassoRect(null);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

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
        ref={contentRef}
        onClick={(e) => { e.stopPropagation(); setContextCard(null); }}
        onPointerDown={handleContentPointerDown}
        style={{
          background: 'var(--gf-bg)',
          border: '1px solid var(--gf-border)',
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
                color: 'var(--gf-text-bright)',
              }}
            >
              {ZONE_LABELS[zoneId]} ({cards.length})
            </h2>
            {selectedIds.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  color: 'var(--gf-accent)',
                  fontSize: 12,
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                }}>
                  {selectedIds.size} selected
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set()); }}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--gf-border)',
                    borderRadius: 4,
                    color: 'var(--gf-text-dim)',
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
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--gf-text-dim)' }}
          >
            <X size={18} />
          </button>
        </div>

        {cards.length === 0 ? (
          <p style={{ color: 'var(--gf-text-dim)', fontStyle: 'italic' }}>Empty</p>
        ) : (
          <div
            ref={gridRef}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 10,
              position: 'relative',
              userSelect: 'none',
            }}
          >
            {cards.map((card) => {
              const imageUrl = getCardImageUrl(card.cardImgFile);
              const isSelected = selectedIds.has(card.instanceId);
              return (
                <div
                  key={card.instanceId}
                  ref={(el) => registerCardEl(card.instanceId, el)}
                  data-card-id={card.instanceId}
                  style={{ position: 'relative', cursor: 'grab' }}
                  onPointerDown={(e) => { e.stopPropagation(); handlePointerDown(card, imageUrl, e); }}
                  onPointerUp={() => handlePointerUp(card)}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => handleCardContextMenu(card, e)}
                  onMouseEnter={(e) => { if (!contextCard) onCardMouseEnter(card.cardImgFile, card.cardName, e, card.instanceId); }}
                  onMouseLeave={onCardMouseLeave}
                >
                  {(() => {
                    const isHoveredCard = hoveredCardId === card.instanceId && !isSelected;
                    const glowStyle = isHoveredCard ? getHoverGlowStyle(hoverProgress) : undefined;
                    const selectedShadow = isSelected ? '0 0 8px rgba(196,149,90,0.4)' : 'none';
                    return imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={card.cardName}
                        draggable={false}
                        style={{
                          width: '100%',
                          borderRadius: 4,
                          border: isSelected ? '2px solid var(--gf-accent)' : '1px solid var(--gf-border)',
                          boxShadow: glowStyle?.boxShadow ?? selectedShadow,
                          transition: 'border 0.1s ease',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '1/1.4',
                          background: '#1e1610',
                          border: isSelected ? '2px solid var(--gf-accent)' : '1px solid var(--gf-border)',
                          boxShadow: glowStyle?.boxShadow ?? selectedShadow,
                          borderRadius: 4,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--gf-text-dim)',
                          fontSize: 10,
                          transition: 'border 0.1s ease',
                        }}
                      >
                        {card.cardName}
                      </div>
                    );
                  })()}
                </div>
              );
            })}

            {/* Lasso selection rectangle */}
            {lassoRect && lassoRect.w > 5 && lassoRect.h > 5 && (
              <div
                style={{
                  position: 'absolute',
                  left: lassoRect.x,
                  top: lassoRect.y,
                  width: lassoRect.w,
                  height: lassoRect.h,
                  border: '1px dashed var(--gf-accent)',
                  background: 'rgba(196,149,90,0.12)',
                  borderRadius: 2,
                  pointerEvents: 'none',
                  zIndex: 10,
                }}
              />
            )}
          </div>
        )}
      </div>

      {!readOnly && contextCard && (
        isMultiContext ? (
          <CardContextPopup
            card={contextCard.card}
            count={selectedIds.size}
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
