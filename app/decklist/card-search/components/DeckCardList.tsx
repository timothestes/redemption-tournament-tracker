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
}: DeckCardListProps) {
  const [previewCard, setPreviewCard] = React.useState<{ card: Card; x: number; y: number } | null>(null);
  const { getImageUrl } = useCardImageUrl();
  
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
            
            {/* Quantity Badge */}
            <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-bold rounded text-sm">
              {quantity}
            </div>

            {/* Card Info */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {card.name}
              </div>
            </div>

            {/* Quantity Controls */}
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
              
              {/* Decrement Button */}
              <button
                onClick={() => onDecrement(card.name, card.set, isReserve)}
                className="w-6 h-6 flex items-center justify-center rounded bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 transition-colors"
                aria-label="Decrease quantity"
                title="Decrease quantity"
              >
                <span className="text-lg leading-none">−</span>
              </button>

              {/* Increment Button */}
              <button
                onClick={() => onIncrement(card.name, card.set, isReserve)}
                className="w-6 h-6 flex items-center justify-center rounded bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 transition-colors"
                aria-label="Increase quantity"
                title="Increase quantity"
              >
                <span className="text-lg leading-none">+</span>
              </button>

              {/* Remove Button */}
              <button
                onClick={() => onRemove(card.name, card.set, isReserve)}
                className="w-6 h-6 flex items-center justify-center rounded bg-red-500 hover:bg-red-600 text-white transition-colors ml-1"
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
