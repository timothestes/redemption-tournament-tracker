'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useGame } from '../state/GameContext';
import { GameCard, ZoneId, ZONE_LABELS } from '../types';
import { X, Search } from 'lucide-react';
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

interface DeckSearchModalProps {
  onClose: () => void;
  onStartDrag?: (card: GameCard, imageUrl: string, e: React.PointerEvent) => void;
  isDragActive?: boolean;
}

function CardContextPopup({
  card,
  x,
  y,
  onClose,
  onMove,
  onMoveToTop,
  onMoveToBottom,
}: {
  card: GameCard;
  x: number;
  y: number;
  onClose: () => void;
  onMove: (zone: ZoneId) => void;
  onMoveToTop: () => void;
  onMoveToBottom: () => void;
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

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
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
      {MOVE_ZONES.map(({ id, label }) => (
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
    </div>
  );
}

export function DeckSearchModal({ onClose, onStartDrag, isDragActive }: DeckSearchModalProps) {
  const { state, moveCard, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleDeck } = useGame();
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState<'type' | 'name' | 'brigade' | 'alignment' | 'ability' | 'identifier'>('type');
  const [autoShuffle, setAutoShuffle] = useState(true);
  const [contextCard, setContextCard] = useState<{ card: GameCard; x: number; y: number } | null>(null);
  const { hover, onCardMouseEnter, onCardMouseLeave } = useModalCardHover(800);

  const SEARCH_FIELDS: { id: typeof searchField; label: string }[] = [
    { id: 'type', label: 'Type' },
    { id: 'name', label: 'Name' },
    { id: 'brigade', label: 'Brigade' },
    { id: 'alignment', label: 'Alignment' },
    { id: 'identifier', label: 'Identifier' },
    { id: 'ability', label: 'Ability' },
  ];

  const getFieldValue = (c: GameCard): string => {
    switch (searchField) {
      case 'type': return c.type;
      case 'name': return c.cardName;
      case 'brigade': return c.brigade;
      case 'alignment': return c.alignment;
      case 'identifier': return c.identifier;
      case 'ability': return c.specialAbility;
    }
  };

  const deckCards = state.zones.deck;
  const filtered = search
    ? deckCards.filter(c => getFieldValue(c).toLowerCase().includes(search.toLowerCase()))
    : deckCards;

  const handleClose = useCallback(() => {
    if (autoShuffle) {
      shuffleDeck();
    }
    onClose();
  }, [autoShuffle, shuffleDeck, onClose]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [handleClose]);

  const handleCardContextMenu = (card: GameCard, e: React.MouseEvent) => {
    e.preventDefault();
    setContextCard({ card, x: e.clientX, y: e.clientY });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={handleClose}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '5vh',
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
          <h2
            style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 16,
              color: '#e8d5a3',
            }}
          >
            Search Deck ({deckCards.length} cards)
          </h2>
          <button
            onClick={handleClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#8b6532' }}
          >
            <X size={18} />
          </button>
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
                border: '1px solid #6b4e27',
                borderRadius: 4,
                color: '#c9b99a',
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
              color: '#8b6532',
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
                color: '#8b6532',
              }}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search by ${SEARCH_FIELDS.find(f => f.id === searchField)?.label.toLowerCase()}...`}
              autoFocus
              style={{
                width: '100%',
                padding: '8px 30px 8px 30px',
                background: '#1e1610',
                border: '1px solid #6b4e27',
                borderRadius: 4,
                color: '#c9b99a',
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
                  color: '#8b6532',
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

        {/* Hint + auto-shuffle */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ color: '#6b4e27', fontSize: 10 }}>
            Drag to a zone · Right-click for more · Hover to enlarge
          </span>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: '#8b6532',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={autoShuffle}
              onChange={(e) => setAutoShuffle(e.target.checked)}
            />
            Shuffle on close
          </label>
        </div>

        {/* Card grid */}
        <div style={{ overflow: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <p style={{ color: '#8b6532', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>
              {search ? 'No cards match your search' : 'Deck is empty'}
            </p>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: 8,
              }}
            >
              {filtered.map((card) => {
                const imageUrl = getCardImageUrl(card.cardImgFile);
                return (
                  <div
                    key={card.instanceId}
                    style={{ position: 'relative', cursor: 'grab' }}
                    onContextMenu={(e) => { onCardMouseLeave(); handleCardContextMenu(card, e); }}
                    onPointerDown={(e) => {
                      if (e.button === 0 && onStartDrag) { onCardMouseLeave(); onStartDrag(card, imageUrl, e); }
                    }}
                    onMouseEnter={(e) => onCardMouseEnter(card.cardImgFile, card.cardName, e)}
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
                          border: '1px solid #6b4e27',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '1/1.4',
                          background: '#1e1610',
                          border: '1px solid #6b4e27',
                          borderRadius: 4,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#8b6532',
                          fontSize: 10,
                          padding: 4,
                          textAlign: 'center',
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
      </div>

      <ModalCardHoverPreview hover={hover} />

      {/* Context menu for card zone choices */}
      {contextCard && (
        <CardContextPopup
          card={contextCard.card}
          x={contextCard.x}
          y={contextCard.y}
          onClose={() => setContextCard(null)}
          onMove={(zone) => moveCard(contextCard.card.instanceId, zone)}
          onMoveToTop={() => { moveCardToTopOfDeck(contextCard.card.instanceId); onClose(); }}
          onMoveToBottom={() => { moveCardToBottomOfDeck(contextCard.card.instanceId); onClose(); }}
        />
      )}
    </motion.div>
  );
}
