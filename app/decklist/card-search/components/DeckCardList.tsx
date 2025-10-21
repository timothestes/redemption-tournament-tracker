import React from "react";
import { DeckCard } from "../types/deck";
import { Card } from "../utils";
import { useCardImageUrl } from "../hooks/useCardImageUrl";

interface DeckCardListProps {
  /** Array of cards to display */
  cards: DeckCard[];
  /** Callback when quantity is increased */
  onIncrement: (cardName: string, cardSet: string, isReserve: boolean) => void;
  /** Callback when quantity is decreased */
  onDecrement: (cardName: string, cardSet: string, isReserve: boolean) => void;
  /** Callback when card is removed entirely */
  onRemove: (cardName: string, cardSet: string, isReserve: boolean) => void;
  /** Optional: Show only main deck or reserve cards */
  filterReserve?: boolean;
  /** Optional: Callback when card is clicked to view details */
  onViewCard?: (card: Card) => void;
  /** Optional: Callback to move card between main deck and reserve */
  onMoveCard?: (cardName: string, cardSet: string, fromReserve: boolean, toReserve: boolean) => void;
  /** Optional: Whether to show type icons in card rows (default: true) */
  showTypeIcons?: boolean;
  /** Optional: Layout view mode (default: 'list') */
  viewLayout?: 'grid' | 'list';
}

/**
 * Reusable component for displaying a list of cards in a deck with quantity controls
 */
export default function DeckCardList({
  cards,
  onIncrement,
  onDecrement,
  onRemove,
  filterReserve,
  onViewCard,
  onMoveCard,
  showTypeIcons = true,
  viewLayout = 'list',
}: DeckCardListProps) {
  const [openMenuCard, setOpenMenuCard] = React.useState<string | null>(null);
  const [previewCard, setPreviewCard] = React.useState<{ card: Card; x: number; y: number } | null>(null);
  const { getImageUrl } = useCardImageUrl();
  
  // Close menu when clicking outside or pressing ESC
  React.useEffect(() => {
    const handleClickOutside = () => {
      if (openMenuCard) {
        setOpenMenuCard(null);
      }
    };
    
    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openMenuCard) {
        setOpenMenuCard(null);
      }
    };
    
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleEscapeKey);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [openMenuCard]);
  
  // Helper function to calculate preview position avoiding screen edges
  const calculatePreviewPosition = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const previewWidth = 300;
    const previewHeight = 400;
    const padding = 10;
    
    let x = rect.right + padding;
    let y = rect.top;
    
    // Check if preview would go off the right edge
    if (x + previewWidth > window.innerWidth) {
      // Position to the left of the element instead
      x = rect.left - previewWidth - padding;
    }
    
    // Check if preview would go off the bottom edge
    if (y + previewHeight > window.innerHeight) {
      // Align to bottom of viewport with padding
      y = window.innerHeight - previewHeight - padding;
    }
    
    // Make sure y doesn't go negative
    if (y < padding) {
      y = padding;
    }
    
    return { x, y };
  };
  
  // Filter cards based on filterReserve prop
  const filteredCards = React.useMemo(() => {
    if (filterReserve === undefined) return cards;
    return cards.filter((dc) => dc.isReserve === filterReserve);
  }, [cards, filterReserve]);

  // Sort cards alphabetically by name
  const sortedCards = React.useMemo(() => {
    return [...filteredCards].sort((a, b) => 
      a.card.name.localeCompare(b.card.name)
    );
  }, [filteredCards]);

  if (sortedCards.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-400 dark:text-gray-500 text-sm">
        No cards yet
      </div>
    );
  }

  // Grid View
  if (viewLayout === 'grid') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
        {sortedCards.map((deckCard) => {
          const { card, quantity, isReserve } = deckCard;
          const cardKey = `${card.name}-${card.set}-${isReserve}`;
          
          return (
            <div
              key={cardKey}
              className="relative group rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all duration-200"
            >
              {/* Backdrop overlay for this card only */}
              {openMenuCard === cardKey && (
                <div 
                  className="absolute inset-0 bg-black/60 backdrop-blur-sm z-30"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuCard(null);
                  }}
                />
              )}

              {/* Card Image */}
              <div 
                className="aspect-[2.5/3.5] bg-gray-200 dark:bg-gray-700 cursor-pointer relative"
                onClick={() => onViewCard?.(card)}
              >
                <img
                  src={getImageUrl(card.imgFile)}
                  alt={card.name}
                  className="w-full h-full object-cover"
                  crossOrigin="anonymous"
                  onError={(e) => {
                    e.currentTarget.src = '/placeholder-card.png';
                  }}
                />
              </div>
              
              {/* Dropdown Menu - Vertical stack centered on card */}
              {openMenuCard === cardKey && (
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1.5 py-6 z-40">
                  {/* Move to Reserve/Main */}
                  {onMoveCard && filterReserve !== undefined && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveCard(card.name, card.set, isReserve, !isReserve);
                        setOpenMenuCard(null);
                      }}
                      className="w-10 h-10 hover:scale-110 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-200 transition-all"
                      title={isReserve ? "Move to main deck" : "Move to reserve"}
                    >
                      {isReserve ? (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                        </svg>
                      )}
                    </button>
                  )}

                  {/* View Card Details */}
                  {onViewCard && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewCard(card);
                        setOpenMenuCard(null);
                      }}
                      className="w-10 h-10 hover:scale-110 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-200 transition-all"
                      title="View card details"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </button>
                  )}

                  {/* Remove All Copies */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(card.name, card.set, isReserve);
                      setOpenMenuCard(null);
                    }}
                    className="w-10 h-10 hover:scale-110 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-300 dark:border-gray-600 flex items-center justify-center text-red-600 dark:text-red-400 transition-all"
                    title="Remove all copies"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Controls Overlay - Shows on Hover, Golden Ratio 2x2 Grid */}
              <div className="absolute inset-x-0 bottom-0 transition-opacity duration-200">
                {/* Using golden ratio: top section ~61.8%, bottom ~38.2% */}
                <div className="grid grid-rows-[1.618fr_1fr] grid-cols-2 gap-1.5 p-3 h-32">
                  {/* Top Left: Decrement */}
                  <div className="flex items-center justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDecrement(card.name, card.set, isReserve);
                      }}
                      className="w-14 h-14 max-w-full max-h-full flex items-center justify-center rounded-lg bg-black/30 hover:bg-black/50 backdrop-blur-md text-white transition-all font-bold text-3xl border border-white/20 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                  </div>
                  
                  {/* Top Right: Increment */}
                  <div className="flex items-center justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onIncrement(card.name, card.set, isReserve);
                      }}
                      className="w-14 h-14 max-w-full max-h-full flex items-center justify-center rounded-lg bg-black/30 hover:bg-black/50 backdrop-blur-md text-white transition-all font-bold text-3xl border border-white/20 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                  
                  {/* Bottom Left: Menu Button */}
                  <div className="flex items-center justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuCard(openMenuCard === cardKey ? null : cardKey);
                      }}
                      className="w-10 h-10 max-w-full max-h-full flex items-center justify-center rounded-lg bg-black/30 hover:bg-black/50 backdrop-blur-md text-white transition-all border border-white/20 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                      aria-label="Card options"
                    >
                      {/* Horizontal dots icon */}
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
                      </svg>
                    </button>
                  </div>
                  
                  {/* Bottom Right: Quantity Display - Always Visible, Compact Style */}
                  <div className="flex items-center justify-center">
                    <div className="bg-black/75 backdrop-blur-sm text-white px-2.5 py-1 rounded-md font-bold text-sm shadow-lg">
                      ×{quantity}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // List View (default)
  return (
    <div className="space-y-1">
      {sortedCards.map((deckCard) => {
        const { card, quantity, isReserve } = deckCard;
        const cardKey = `${card.name}-${card.set}-${isReserve}`;
        
        // Determine icon path for dominants, fortresses, and enhancements based on alignment/type
        const getIconPath = () => {
          if (card.type === 'Dominant' || card.type === 'Dom') {
            if (card.alignment === 'Good') {
              return '/filter-icons/Good Dominant.png';
            } else if (card.alignment === 'Evil') {
              return '/filter-icons/Evil Dominant.png';
            } else if (card.alignment === 'Neutral') {
              // For neutral dominants, we'll show both icons
              return null; // Handle separately
            }
          }
          if (card.type === 'Fortress' || card.type === 'Fort') {
            if (card.alignment === 'Good') {
              return '/filter-icons/Good Fortress.png';
            } else if (card.alignment === 'Evil') {
              return '/filter-icons/Evil Fortress.png';
            } else if (card.alignment === 'Neutral') {
              // For neutral fortresses, we'll show both icons
              return null; // Handle separately
            }
          }
          // Handle Good Enhancement (GE) and Evil Enhancement (EE)
          // Check for combined types like "GE/EE" - show both icons
          if (card.type === 'GE/EE' || card.type === 'EE/GE') {
            return null; // Handle with dual icons
          }
          if (card.type === 'GE' || card.type === 'Good Enhancement') {
            return '/filter-icons/GE.png';
          }
          if (card.type === 'EE' || card.type === 'Evil Enhancement') {
            return '/filter-icons/EE.png';
          }
          // Handle Hero/Evil Character dual type
          if (card.type === 'Hero/Evil Character' || card.type === 'Evil Character/Hero') {
            return null; // Handle with dual icons
          }
          // Handle Evil Character/Fortress dual type
          if (card.type === 'Evil Character/Fortress' || card.type === 'Fortress/Evil Character') {
            return null; // Handle with dual icons
          }
          // Handle Hero/Fortress dual type
          if (card.type === 'Hero/Fortress' || card.type === 'Fortress/Hero') {
            return null; // Handle with dual icons
          }
          // Handle Hero/GE dual type
          if (card.type === 'Hero/GE' || card.type === 'GE/Hero') {
            return null; // Handle with dual icons
          }
          // Handle EE/Evil Character dual type
          if (card.type === 'EE/Evil Character' || card.type === 'Evil Character/EE') {
            return null; // Handle with dual icons
          }
          // Handle GE/Evil Character dual type
          if (card.type === 'GE/Evil Character' || card.type === 'Evil Character/GE') {
            return null; // Handle with dual icons
          }
          return `/filter-icons/${card.type}.png`;
        };
        
        const iconPath = getIconPath();
        const isNeutralDominant = (card.type === 'Dominant' || card.type === 'Dom') && card.alignment === 'Neutral';
        const isNeutralFortress = (card.type === 'Fortress' || card.type === 'Fort') && card.alignment === 'Neutral';
        const isDualEnhancement = card.type === 'GE/EE' || card.type === 'EE/GE';
        const isDualHeroEC = card.type === 'Hero/Evil Character' || card.type === 'Evil Character/Hero';
        const isDualECFortress = card.type === 'Evil Character/Fortress' || card.type === 'Fortress/Evil Character';
        const isDualHeroFortress = card.type === 'Hero/Fortress' || card.type === 'Fortress/Hero';
        const isDualHeroGE = card.type === 'Hero/GE' || card.type === 'GE/Hero';
        const isDualEEEC = card.type === 'EE/Evil Character' || card.type === 'Evil Character/EE';
        const isDualGEEC = card.type === 'GE/Evil Character' || card.type === 'Evil Character/GE';

        return (
          <div
            key={cardKey}
            className="flex items-center gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
          >
            {/* Type Icon */}
            {showTypeIcons && (
              <>
                {isNeutralDominant ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/Good Dominant.png" 
                      alt="Good Dominant"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/Evil Dominant.png" 
                      alt="Evil Dominant"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : isNeutralFortress ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/Good Fortress.png" 
                      alt="Good Fortress"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/Evil Fortress.png" 
                      alt="Evil Fortress"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : isDualEnhancement ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/GE.png" 
                      alt="Good Enhancement"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/EE.png" 
                      alt="Evil Enhancement"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : isDualHeroEC ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/Hero.png" 
                      alt="Hero"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/Evil Character.png" 
                      alt="Evil Character"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : isDualECFortress ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/Evil Character.png" 
                      alt="Evil Character"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/Evil Fortress.png" 
                      alt="Evil Fortress"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : isDualHeroFortress ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/Hero.png" 
                      alt="Hero"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/Good Fortress.png" 
                      alt="Good Fortress"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : isDualHeroGE ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/Hero.png" 
                      alt="Hero"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/GE.png" 
                      alt="Good Enhancement"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : isDualEEEC ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/EE.png" 
                      alt="Evil Enhancement"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/Evil Character.png" 
                      alt="Evil Character"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : isDualGEEC ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/GE.png" 
                      alt="Good Enhancement"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/Evil Character.png" 
                      alt="Evil Character"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : iconPath && (
                  <img 
                    src={iconPath} 
                    alt={card.type}
                    className="w-8 h-8 object-contain flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                    onError={(e) => {
                      // Hide icon if image doesn't exist
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
              </>
            )}
            
            {/* Quantity Controls with Badge */}
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {/* Decrement Button (always visible) */}
              <button
                onClick={() => onDecrement(card.name, card.set, isReserve)}
                className="w-7 h-7 flex items-center justify-center rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors font-semibold text-base"
                aria-label="Decrease quantity"
                title="Decrease quantity"
              >
                −
              </button>

              {/* Quantity Badge (always visible, not a button) */}
              <div className="flex-shrink-0 w-9 h-7 flex items-center justify-center text-gray-900 dark:text-white font-bold text-sm">
                {quantity}
              </div>

              {/* Increment Button (always visible) */}
              <button
                onClick={() => onIncrement(card.name, card.set, isReserve)}
                className="w-7 h-7 flex items-center justify-center rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors font-semibold text-base"
                aria-label="Increase quantity"
                title="Increase quantity"
              >
                +
              </button>
            </div>

            {/* Card Info */}
            <div className="flex-1 min-w-0">
              <div 
                className="text-sm font-medium text-gray-900 dark:text-white truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                onMouseEnter={(e) => {
                  const pos = calculatePreviewPosition(e.currentTarget);
                  setPreviewCard({
                    card,
                    ...pos
                  });
                }}
                onMouseLeave={() => setPreviewCard(null)}
              >
                {card.name}
              </div>
            </div>

            {/* Additional Controls */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {/* View Card Button */}
              {onViewCard && (
                <button
                  onClick={() => onViewCard(card)}
                  className="w-6 h-6 flex items-center justify-center rounded bg-gray-200 dark:bg-gray-600 hover:bg-blue-500 dark:hover:bg-blue-600 text-gray-700 dark:text-gray-200 hover:text-white transition-colors"
                  aria-label="View card details"
                  title="View card details"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
                  </svg>
                </button>
              )}
              
              {/* Move Card Button (between main deck and reserve) */}
              {onMoveCard && filterReserve !== undefined && (
                <button
                  onClick={() => onMoveCard(card.name, card.set, isReserve, !isReserve)}
                  className="w-8 h-6 flex items-center justify-center rounded bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 transition-colors text-xs font-bold"
                  aria-label={isReserve ? "Move to main deck" : "Move to reserve"}
                  title={isReserve ? "Move to main deck" : "Move to reserve"}
                >
                  {isReserve ? "<<" : ">>"}
                </button>
              )}

              {/* Remove Button */}
              <button
                onClick={() => onRemove(card.name, card.set, isReserve)}
                className="w-6 h-6 flex items-center justify-center rounded bg-red-500 hover:bg-red-600 text-white transition-colors"
                aria-label="Remove card"
                title="Remove card from deck"
              >
                <span className="text-lg leading-none">×</span>
              </button>
            </div>
          </div>
        );
      })}
      
      {/* Card Preview on Hover */}
      {previewCard && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: `${previewCard.x}px`,
            top: `${previewCard.y}px`,
            maxWidth: '300px',
          }}
        >
          <img
            src={getImageUrl(previewCard.card.imgFile)}
            alt={previewCard.card.name}
            className="rounded-lg shadow-2xl border-2 border-gray-300 dark:border-gray-600"
            style={{ maxHeight: '400px', width: 'auto' }}
          />
        </div>
      )}
    </div>
  );
}
