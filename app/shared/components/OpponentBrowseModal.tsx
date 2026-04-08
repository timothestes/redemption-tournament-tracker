'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { GameCard } from '@/app/shared/types/gameCard';
import { X, Search } from 'lucide-react';
import { useModalCardHover, ModalCardHoverPreview, getHoverGlowStyle } from './ModalCardHoverPreview';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';

const OPPONENT_ACTIONS = [
  { id: 'discard', label: 'Discard' },
  { id: 'banish', label: 'Banish' },
  { id: 'deck-top', label: 'Top of Deck' },
  { id: 'deck-bottom', label: 'Bottom of Deck' },
  { id: 'deck-shuffle', label: 'Shuffle into Deck' },
] as const;

function OpponentCardPopup({
  card,
  x,
  y,
  onClose,
  onAction,
}: {
  card: GameCard;
  x: number;
  y: number;
  onClose: () => void;
  onAction: (action: string) => void;
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

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: Math.min(x, window.innerWidth - 160),
        top: Math.min(y, window.innerHeight - 200),
        background: 'var(--gf-bg)',
        border: '1px solid var(--gf-border)',
        borderRadius: 6,
        padding: '4px 0',
        zIndex: 800,
        minWidth: 140,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      }}
    >
      <div style={{ ...itemStyle, color: 'var(--gf-text-dim)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'default', padding: '3px 12px' }}>
        {card.cardName}
      </div>
      {OPPONENT_ACTIONS.map(({ id, label }) => (
        <button
          key={id}
          style={itemStyle}
          onClick={() => { onAction(id); onClose(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

interface OpponentBrowseModalProps {
  zoneName: string;
  cards: GameCard[];
  onMoveCard: (cardId: string, action: string) => void;
  onClose: () => void;
  onStartDrag?: (card: GameCard, imageUrl: string, e: React.PointerEvent) => void;
  didDragRef?: React.MutableRefObject<boolean>;
  isDragActive?: boolean;
}

const SEARCH_FIELDS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'type', label: 'Type' },
  { id: 'name', label: 'Name' },
  { id: 'brigade', label: 'Brigade' },
  { id: 'alignment', label: 'Alignment' },
  { id: 'identifier', label: 'Identifier' },
  { id: 'ability', label: 'Ability' },
];

const TYPE_ALIASES: Record<string, string[]> = {
  'ls': ['lost soul', 'lost souls'],
  'he': ['hero', 'heroes'],
  'ec': ['evil character', 'evil characters'],
  'gc': ['good character', 'good characters'],
  'ee': ['evil enhancement', 'evil enhancements'],
  'ge': ['good enhancement', 'good enhancements'],
  'da': ['dominant artifact', 'dominant artifacts'],
  'ar': ['artifact'],
  'fo': ['fortress'],
  'si': ['site'],
  'cu': ['curse'],
  'co': ['covenant'],
};

export function OpponentBrowseModal({
  zoneName,
  cards,
  onMoveCard,
  onClose,
  onStartDrag,
  didDragRef,
  isDragActive,
}: OpponentBrowseModalProps) {
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState<string>('all');
  const [contextCard, setContextCard] = useState<{ card: GameCard; x: number; y: number } | null>(null);
  const { setPreviewCard, isLoupeVisible } = useCardPreview();
  const { hover, hoverProgress, hoveredCardId, onCardMouseEnter, onCardMouseLeave } = useModalCardHover(350, { setPreviewCard, isLoupeVisible });

  const isReserve = zoneName.toLowerCase().includes('reserve');
  const sortedCards = isReserve
    ? [...cards].sort((a, b) => a.type.localeCompare(b.type) || a.cardName.localeCompare(b.cardName))
    : cards;

  const matchesSearch = (c: GameCard, term: string): boolean => {
    const t = term.toLowerCase();
    const matchesType = (type: string, s: string): boolean => {
      const tl = type.toLowerCase();
      if (tl.includes(s)) return true;
      const aliases = TYPE_ALIASES[tl];
      return aliases ? aliases.some(a => a.includes(s)) : false;
    };
    if (searchField === 'all') {
      return matchesType(c.type, t) || c.cardName.toLowerCase().includes(t) ||
        c.brigade.toLowerCase().includes(t) || c.alignment.toLowerCase().includes(t) ||
        c.identifier.toLowerCase().includes(t) || c.specialAbility.toLowerCase().includes(t);
    }
    if (searchField === 'type') return matchesType(c.type, t);
    if (searchField === 'name') return c.cardName.toLowerCase().includes(t);
    if (searchField === 'brigade') return c.brigade.toLowerCase().includes(t);
    if (searchField === 'alignment') return c.alignment.toLowerCase().includes(t);
    if (searchField === 'identifier') return c.identifier.toLowerCase().includes(t);
    if (searchField === 'ability') return c.specialAbility.toLowerCase().includes(t);
    return true;
  };

  const filtered = search
    ? sortedCards.filter(c => matchesSearch(c, search))
    : sortedCards;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleCardContextMenu = useCallback((card: GameCard, e: React.MouseEvent) => {
    e.preventDefault();
    onCardMouseLeave();
    setContextCard({ card, x: e.clientX, y: e.clientY });
    setPreviewCard({ cardName: card.cardName, cardImgFile: card.cardImgFile, isMeek: card.isMeek });
  }, [onCardMouseLeave, setPreviewCard]);

  const pointerDownCardRef = useRef<string | null>(null);

  const handlePointerDown = useCallback((card: GameCard, imageUrl: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onCardMouseLeave();
    pointerDownCardRef.current = card.instanceId;
    if (didDragRef) didDragRef.current = false;
    if (onStartDrag) {
      onStartDrag(card, imageUrl, e);
    }
  }, [onCardMouseLeave, didDragRef, onStartDrag]);

  const handlePointerUp = useCallback((card: GameCard) => {
    if (pointerDownCardRef.current !== card.instanceId) return;
    pointerDownCardRef.current = null;
    if (didDragRef?.current) {
      didDragRef.current = false;
      return;
    }
    setContextCard(null);
  }, [didDragRef]);

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
        right: isLoupeVisible ? 'clamp(280px, 20vw, 380px)' : '36px',
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 900,
      }}
    >
      <div
        onClick={(e) => { e.stopPropagation(); setContextCard(null); }}
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
          <h2
            style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 16,
              color: 'var(--gf-text-bright)',
            }}
          >
            {zoneName} ({cards.length})
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--gf-text-dim)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Search input + field selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <select
              value={searchField}
              onChange={(e) => { setSearchField(e.target.value); setSearch(''); }}
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
        <div style={{ marginBottom: 12 }}>
          <span style={{ color: 'var(--gf-border)', fontSize: 10 }}>
            Right-click for actions · Drag to a zone · Hover to enlarge
          </span>
        </div>

        {/* Card grid — scrollable */}
        <div style={{ overflow: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <p style={{ color: 'var(--gf-text-dim)', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>
              {search ? 'No cards match your search' : 'No cards in this zone'}
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
                return (
                  <div
                    key={card.instanceId}
                    data-card-id={card.instanceId}
                    style={{ position: 'relative', cursor: 'grab' }}
                    onContextMenu={(e) => handleCardContextMenu(card, e)}
                    onPointerDown={(e) => { e.stopPropagation(); handlePointerDown(card, imageUrl, e); }}
                    onPointerUp={() => handlePointerUp(card)}
                    onClick={(e) => e.stopPropagation()}
                    onMouseEnter={(e) => { if (!contextCard) onCardMouseEnter(card.cardImgFile, card.cardName, e, card.instanceId); }}
                    onMouseLeave={onCardMouseLeave}
                  >
                    {(() => {
                      const isHoveredCard = hoveredCardId === card.instanceId;
                      const glowStyle = isHoveredCard ? getHoverGlowStyle(hoverProgress) : undefined;
                      return imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={card.cardName}
                          draggable={false}
                          style={{
                            width: '100%',
                            borderRadius: 4,
                            border: '1px solid var(--gf-border)',
                            boxShadow: glowStyle?.boxShadow ?? 'none',
                            transition: 'border 0.1s ease',
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            aspectRatio: '1/1.4',
                            background: '#1e1610',
                            border: '1px solid var(--gf-border)',
                            boxShadow: glowStyle?.boxShadow ?? 'none',
                            borderRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--gf-text-dim)',
                            fontSize: 10,
                            padding: 4,
                            textAlign: 'center',
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
            </div>
          )}
        </div>
      </div>

      <ModalCardHoverPreview hover={hover} />

      {/* Context menu */}
      {contextCard && (
        <OpponentCardPopup
          card={contextCard.card}
          x={contextCard.x}
          y={contextCard.y}
          onClose={() => setContextCard(null)}
          onAction={(action) => onMoveCard(contextCard.card.instanceId, action)}
        />
      )}
    </motion.div>
  );
}
