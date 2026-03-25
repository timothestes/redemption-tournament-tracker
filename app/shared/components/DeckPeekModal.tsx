'use client';

import { motion } from 'framer-motion';
import { useGame } from '@/app/goldfish/state/GameContext';
import { GameCard } from '@/app/shared/types/gameCard';
import { X, ArrowUp, ArrowDown, Shuffle } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useModalCardHover, ModalCardHoverPreview, getHoverGlowStyle } from './ModalCardHoverPreview';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';

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
        background: 'var(--gf-bg)',
        border: '1px solid var(--gf-border)',
        borderRadius: 5,
        color: 'var(--gf-text-bright)',
        fontSize: 12,
        fontFamily: 'var(--font-cinzel), Georgia, serif',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#3d2e1a';
        e.currentTarget.style.borderColor = 'var(--gf-accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--gf-bg)';
        e.currentTarget.style.borderColor = 'var(--gf-border)';
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// Check if two axis-aligned rectangles overlap
function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

interface DeckPeekModalProps {
  cardIds: string[];
  title: string;
  onClose: () => void;
  onStartDrag?: (card: GameCard, imageUrl: string, e: React.PointerEvent) => void;
  onStartMultiDrag?: (cards: { card: GameCard; imageUrl: string }[], e: React.PointerEvent) => void;
  didDragRef?: React.MutableRefObject<boolean>;
  isDragActive?: boolean;
}

export function DeckPeekModal({ cardIds, title, onClose, onStartDrag, onStartMultiDrag, didDragRef, isDragActive }: DeckPeekModalProps) {
  const { state, moveCardsBatch, shuffleDeck } = useGame();
  const { setPreviewCard, isLoupeVisible } = useCardPreview();
  const { hover, hoverProgress, hoveredCardId, onCardMouseEnter, onCardMouseLeave } = useModalCardHover(200, { setPreviewCard, isLoupeVisible });

  // Guard against stray click events closing the modal immediately after mount
  const [readyForClose, setReadyForClose] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReadyForClose(true), 150);
    return () => clearTimeout(timer);
  }, []);

  // Selection state
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

  // Snapshot the card IDs on mount so the list is stable
  const [peekedIds] = useState(() => cardIds);

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
      if (e.key === 'Escape') {
        if (selectedIds.size > 0) {
          setSelectedIds(new Set());
        } else {
          handleCloseAction('top');
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [hasRemaining, remainingIds, selectedIds.size]);

  // Track pointer down card to distinguish click from drag on pointer up
  const pointerDownCardRef = useRef<string | null>(null);

  const handlePointerDown = (card: GameCard, imageUrl: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onCardMouseLeave();
    pointerDownCardRef.current = card.instanceId;

    // Reset didDragRef so we can detect if a drag fires before pointerUp
    if (didDragRef) didDragRef.current = false;

    const isSelected = selectedIds.has(card.instanceId);
    if (isSelected && selectedIds.size > 1 && onStartMultiDrag) {
      // Multi-card drag: gather all selected cards that are still in the deck
      const allSelected = peekedCards.filter(c => selectedIds.has(c.instanceId));
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

  // Compute max width based on card count for a tighter layout with few cards
  const cardCount = peekedCards.length;
  const maxWidth = cardCount <= 2 ? 380 : cardCount <= 4 ? 600 : '90vw';

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
      onClick={() => { if (readyForClose) handleCloseAction('top'); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <motion.div
        initial={false}
        animate={{ opacity: 1, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={handleContentPointerDown}
        style={{
          background: '#1e1610',
          border: '1px solid var(--gf-border)',
          borderRadius: 8,
          padding: 20,
          width: typeof maxWidth === 'string' ? maxWidth : undefined,
          maxWidth: maxWidth,
          maxHeight: '85vh',
          overflowY: 'auto',
          position: 'relative',
          opacity: isDragActive ? 0.15 : 1,
          pointerEvents: isDragActive ? 'none' : 'auto',
          transition: 'opacity 0.2s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              color: 'var(--gf-text-bright)',
              fontSize: 16,
              margin: 0,
            }}>
              {title}
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
            onClick={() => handleCloseAction('top')}
            style={{ background: 'none', border: 'none', color: 'var(--gf-text)', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        <p style={{
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          color: 'var(--gf-text-dim)',
          fontSize: 11,
          marginBottom: 12,
        }}>
          Drag to a zone · Click to select · Lasso to multi-select
        </p>

        {peekedCards.length === 0 ? (
          <p style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            color: 'var(--gf-border)',
            fontSize: 13,
            textAlign: 'center',
            padding: 20,
          }}>
            All peeked cards have been moved
          </p>
        ) : (
          <div
            ref={gridRef}
            style={{
              display: 'grid',
              gridTemplateColumns: cardCount <= 2 ? `repeat(${cardCount}, 1fr)` : 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 12,
              position: 'relative',
              userSelect: 'none',
            }}
          >
            {peekedCards.map((card) => {
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
                  onMouseEnter={(e) => onCardMouseEnter(card.cardImgFile, card.cardName, e, card.instanceId)}
                  onMouseLeave={onCardMouseLeave}
                >
                  {(() => {
                    const isHoveredCard = hoveredCardId === card.instanceId && !isSelected;
                    const glowStyle = isHoveredCard ? getHoverGlowStyle(hoverProgress) : undefined;
                    const selectedShadow = isSelected ? '0 0 8px rgba(196,149,90,0.4)' : 'none';
                    return card.cardImgFile ? (
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
                      <div style={{
                        width: '100%',
                        aspectRatio: '2.5/3.5',
                        background: 'var(--gf-bg)',
                        border: isSelected ? '2px solid var(--gf-accent)' : '1px solid var(--gf-border)',
                        boxShadow: glowStyle?.boxShadow ?? selectedShadow,
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--gf-text)',
                        fontSize: 11,
                        fontFamily: 'var(--font-cinzel), Georgia, serif',
                        textAlign: 'center',
                        padding: 8,
                        transition: 'border 0.1s ease',
                      }}>
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
                color: 'var(--gf-border)',
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
