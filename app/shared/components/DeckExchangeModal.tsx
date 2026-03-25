'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useGame } from '@/app/goldfish/state/GameContext';
import { GameCard } from '@/app/shared/types/gameCard';
import { X, Search, ArrowLeftRight } from 'lucide-react';
import { useModalCardHover, ModalCardHoverPreview, getHoverGlowStyle } from './ModalCardHoverPreview';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';

interface DeckExchangeModalProps {
  /** The card instance IDs being sent into the deck */
  exchangeCardIds: string[];
  onComplete: () => void;
  onCancel: () => void;
  /** Shared modal drag infrastructure — same as DeckSearchModal */
  onStartDrag?: (card: GameCard, imageUrl: string, e: React.PointerEvent) => void;
  didDragRef?: React.MutableRefObject<boolean>;
  isDragActive?: boolean;
}

export function DeckExchangeModal({
  exchangeCardIds,
  onComplete,
  onCancel,
  onStartDrag,
  didDragRef,
  isDragActive,
}: DeckExchangeModalProps) {
  const { state, moveCard, moveCardToTopOfDeck, shuffleDeck } = useGame();
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState<'all' | 'type' | 'name' | 'brigade' | 'alignment' | 'ability' | 'identifier'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { setPreviewCard, isLoupeVisible } = useCardPreview();
  const { hover, hoverProgress, hoveredCardId, onCardMouseEnter, onCardMouseLeave } = useModalCardHover(350, { setPreviewCard, isLoupeVisible });

  // Track pointer down card to distinguish click from drag
  const pointerDownCardRef = useRef<string | null>(null);

  // Track which card was dragged out so we can complete exchange on drop
  const draggedCardIdRef = useRef<string | null>(null);

  const SEARCH_FIELDS: { id: typeof searchField; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'type', label: 'Type' },
    { id: 'name', label: 'Name' },
    { id: 'brigade', label: 'Brigade' },
    { id: 'alignment', label: 'Alignment' },
    { id: 'identifier', label: 'Identifier' },
    { id: 'ability', label: 'Ability' },
  ];

  const matchesSearch = (c: GameCard, term: string): boolean => {
    const t = term.toLowerCase();
    if (searchField === 'all') {
      return (
        c.type.toLowerCase().includes(t) ||
        c.cardName.toLowerCase().includes(t) ||
        c.brigade.toLowerCase().includes(t) ||
        c.alignment.toLowerCase().includes(t) ||
        c.identifier.toLowerCase().includes(t) ||
        c.specialAbility.toLowerCase().includes(t)
      );
    }
    switch (searchField) {
      case 'type': return c.type.toLowerCase().includes(t);
      case 'name': return c.cardName.toLowerCase().includes(t);
      case 'brigade': return c.brigade.toLowerCase().includes(t);
      case 'alignment': return c.alignment.toLowerCase().includes(t);
      case 'identifier': return c.identifier.toLowerCase().includes(t);
      case 'ability': return c.specialAbility.toLowerCase().includes(t);
    }
  };

  // Find the cards being exchanged (they may be in any zone)
  const exchangeCards = exchangeCardIds.map(id => {
    for (const cards of Object.values(state.zones)) {
      const found = cards.find(c => c.instanceId === id);
      if (found) return found;
    }
    return null;
  }).filter(Boolean) as GameCard[];

  const deckCards = state.zones.deck;
  const filtered = search
    ? deckCards.filter(c => matchesSearch(c, search))
    : deckCards;

  const needCount = exchangeCardIds.length;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  const selectCard = useCallback((cardId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        if (next.size >= needCount) {
          const first = next.values().next().value;
          if (first) next.delete(first);
        }
        next.add(cardId);
      }
      return next;
    });
  }, [needCount]);

  const handleCardClick = useCallback((card: GameCard) => {
    selectCard(card.instanceId);
  }, [selectCard]);

  // Pointer down: start shared modal drag and track which card
  const handlePointerDown = useCallback((card: GameCard, imageUrl: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onCardMouseLeave();
    pointerDownCardRef.current = card.instanceId;
    if (didDragRef) didDragRef.current = false;
    draggedCardIdRef.current = card.instanceId;
    if (onStartDrag) {
      onStartDrag(card, imageUrl, e);
    }
  }, [onCardMouseLeave, onStartDrag, didDragRef]);

  // Pointer up: if no drag happened, treat as click to select
  const handlePointerUp = useCallback((card: GameCard) => {
    if (pointerDownCardRef.current !== card.instanceId) return;
    pointerDownCardRef.current = null;
    if (didDragRef?.current) {
      didDragRef.current = false;
      return;
    }
    handleCardClick(card);
  }, [didDragRef, handleCardClick]);

  // When a drag completes (isDragActive goes true→false), the shared hook
  // already moved the dragged card to the target zone at the drop position.
  // We now send the exchange cards to the deck and complete.
  const prevDragActive = useRef(false);
  useEffect(() => {
    if (prevDragActive.current && !isDragActive) {
      const draggedId = draggedCardIdRef.current;
      if (draggedId) {
        // The dragged card was moved by useModalCardDrag to the drop zone.
        // Now send the exchange cards to the deck.
        for (const id of exchangeCardIds) {
          moveCardToTopOfDeck(id);
        }
        shuffleDeck();
        draggedCardIdRef.current = null;
        onComplete();
      }
    }
    prevDragActive.current = !!isDragActive;
  }, [isDragActive, exchangeCardIds, moveCardToTopOfDeck, shuffleDeck, onComplete]);

  const handleConfirm = useCallback(() => {
    if (selectedIds.size !== needCount) return;

    const pickedIds = Array.from(selectedIds);

    // Move picked cards from deck to the same zone and position as the exchanged cards
    for (let i = 0; i < needCount; i++) {
      const source = exchangeCards[i];
      moveCard(pickedIds[i], source.zone, undefined, source.posX, source.posY);
    }

    // Move the exchanged cards to top of deck
    for (const id of exchangeCardIds) {
      moveCardToTopOfDeck(id);
    }

    // Shuffle after exchange
    shuffleDeck();

    onComplete();
  }, [selectedIds, needCount, exchangeCards, exchangeCardIds, moveCard, moveCardToTopOfDeck, shuffleDeck, onComplete]);

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onCancel}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: '5vh',
          zIndex: 500,
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'var(--gf-bg)',
            border: '1px solid var(--gf-border)',
            borderRadius: 8,
            padding: 20,
            width: '80vw',
            maxWidth: 700,
            height: '80vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            opacity: isDragActive ? 0.15 : 1,
            pointerEvents: isDragActive ? 'none' : 'auto',
            transition: 'opacity 0.2s ease',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ArrowLeftRight size={16} style={{ color: 'var(--gf-accent)' }} />
              <h2
                style={{
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 16,
                  color: 'var(--gf-text-bright)',
                }}
              >
                Exchange — Pick {needCount} card{needCount > 1 ? 's' : ''} from Deck
              </h2>
            </div>
            <button
              onClick={onCancel}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--gf-text-dim)' }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Exchange info banner */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: 'rgba(196, 149, 90, 0.1)',
            border: '1px solid var(--gf-hover-strong)',
            borderRadius: 6,
            marginBottom: 12,
          }}>
            <span style={{ color: 'var(--gf-text)', fontSize: 12, fontFamily: 'var(--font-cinzel), Georgia, serif' }}>
              Sending to deck:
            </span>
            {exchangeCards.map(c => (
              <span key={c.instanceId} style={{
                color: 'var(--gf-text-bright)',
                fontSize: 12,
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                background: 'var(--gf-hover)',
                padding: '2px 8px',
                borderRadius: 4,
              }}>
                {c.cardName}
              </span>
            ))}
            <span style={{ color: 'var(--gf-text-dim)', fontSize: 11, marginLeft: 'auto' }}>
              {selectedIds.size}/{needCount} selected
            </span>
          </div>

          {/* Search input + field selector */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <select
                value={searchField}
                onChange={(e) => setSearchField(e.target.value as typeof searchField)}
                style={{
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  padding: '8px 28px 8px 10px',
                  background: '#1e1610',
                  border: '1px solid var(--gf-border)',
                  borderRadius: 4,
                  color: 'var(--gf-text)',
                  fontSize: 12,
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {SEARCH_FIELDS.map(f => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
              <div style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
                color: 'var(--gf-text-dim)',
                fontSize: 10,
              }}>
                ▼
              </div>
            </div>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--gf-text-dim)',
                }}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchField === 'all' ? 'Search all fields...' : `Search by ${SEARCH_FIELDS.find(f => f.id === searchField)?.label.toLowerCase()}...`}
                autoFocus
                style={{
                  width: '100%',
                  padding: '8px 30px 8px 30px',
                  background: '#1e1610',
                  border: '1px solid var(--gf-border)',
                  borderRadius: 4,
                  color: 'var(--gf-text)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--gf-text-dim)',
                    padding: 2,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Hint */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ color: 'var(--gf-border)', fontSize: 10 }}>
              Click to select · Drag to a zone to exchange · Hover to enlarge
            </span>
          </div>

          {/* Card grid */}
          <div style={{ overflow: 'auto', flex: 1 }}>
            {filtered.length === 0 ? (
              <p style={{ color: 'var(--gf-text-dim)', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>
                {search ? 'No cards match your search' : 'Deck is empty'}
              </p>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: 8,
                  position: 'relative',
                  userSelect: 'none',
                }}
              >
                {filtered.map((card) => {
                  const imageUrl = getCardImageUrl(card.cardImgFile);
                  const isSelected = selectedIds.has(card.instanceId);
                  return (
                    <div
                      key={card.instanceId}
                      style={{ position: 'relative', cursor: 'grab' }}
                      onPointerDown={(e) => handlePointerDown(card, imageUrl, e)}
                      onPointerUp={() => handlePointerUp(card)}
                      onMouseEnter={(e) => onCardMouseEnter(card.cardImgFile, card.cardName, e, card.instanceId)}
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
                              color: 'var(--gf-border)',
                              fontSize: 11,
                              padding: 4,
                              textAlign: 'center',
                              transition: 'border 0.1s ease',
                            }}
                          >
                            {card.cardName}
                          </div>
                        );
                      })()}
                      <p style={{
                        fontSize: 10,
                        color: 'var(--gf-text-dim)',
                        marginTop: 2,
                        textAlign: 'center',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {card.cardName}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer with confirm button */}
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 10,
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid rgba(107, 78, 39, 0.3)',
          }}>
            <button
              onClick={onCancel}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                border: '1px solid var(--gf-border)',
                borderRadius: 6,
                color: 'var(--gf-text-dim)',
                fontSize: 12,
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedIds.size !== needCount}
              style={{
                padding: '8px 20px',
                background: selectedIds.size === needCount ? 'var(--gf-hover-strong)' : 'rgba(107, 78, 39, 0.15)',
                border: `1px solid ${selectedIds.size === needCount ? 'var(--gf-accent)' : 'var(--gf-border)'}`,
                borderRadius: 6,
                color: selectedIds.size === needCount ? 'var(--gf-text-bright)' : 'var(--gf-border)',
                fontSize: 12,
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                cursor: selectedIds.size === needCount ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <ArrowLeftRight size={13} />
              Confirm Exchange
            </button>
          </div>
        </div>
      </motion.div>

      <ModalCardHoverPreview hover={hover} />
    </>
  );
}
