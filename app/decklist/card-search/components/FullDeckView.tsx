import React, { useState } from "react";
import { Deck } from "../types/deck";
import { Card } from "../utils";
import { useCardImageUrl } from "../hooks/useCardImageUrl";
import { validateDeck } from "../utils/deckValidation";

interface FullDeckViewProps {
  deck: Deck;
  onViewCard?: (card: Card, isReserve?: boolean) => void;
}

/**
 * Full-screen optimized deck view with compact card display
 * Shows entire deck at a glance with minimal scrolling
 */
export default function FullDeckView({ deck, onViewCard }: FullDeckViewProps) {
  const { getImageUrl } = useCardImageUrl();
  
  // View mode state
    const [viewMode, setViewMode] = useState<'normal' | 'stacked'>('stacked');
  
  // Separate main deck and reserve
  const mainDeckCards = deck.cards.filter((dc) => !dc.isReserve);
  const reserveCards = deck.cards.filter((dc) => dc.isReserve);

    // Sort cards by type, then alignment, then name
  const sortCards = (cards: typeof deck.cards) => {
    return [...cards].sort((a, b) => {
      // First sort by type
      const typeA = a.card.type || 'Unknown';
      const typeB = b.card.type || 'Unknown';
      if (typeA !== typeB) {
        return typeA.localeCompare(typeB);
      }
      
      // Then by alignment
      const alignmentA = a.card.alignment || 'Neutral';
      const alignmentB = b.card.alignment || 'Neutral';
      const alignmentOrder = ['Good', 'Evil', 'Neutral'];
      const aIndex = alignmentOrder.indexOf(alignmentA);
      const bIndex = alignmentOrder.indexOf(alignmentB);
      if (aIndex !== bIndex) {
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      }
      
      // Finally by name
      return a.card.name.localeCompare(b.card.name);
    });
  };

  // Calculate stats
  const mainDeckCount = mainDeckCards.reduce((sum, dc) => sum + dc.quantity, 0);
  const reserveCount = reserveCards.reduce((sum, dc) => sum + dc.quantity, 0);
  const totalCards = mainDeckCount + reserveCount;
  const uniqueCards = deck.cards.length;
  
  // Validation
  const validation = validateDeck(deck);

  // Prettify card type names
  const prettifyTypeName = (type: string): string => {
    const typeMap: Record<string, string> = {
      'GE': 'Good Enhancement',
      'EE': 'Evil Enhancement',
      'EC': 'Evil Character',
      'HC': 'Hero Character',
      'GC': 'Good Character',
      'LS': 'Lost Soul',
      'Dom': 'Dominant',
      'Cov': 'Covenant',
      'Cur': 'Curse',
      'Art': 'Artifact',
      'Fort': 'Fortress',
      'Site': 'Site',
    };
    return typeMap[type] || type;
  };

  // Render a compact card item
  const renderCompactCard = (deckCard: typeof deck.cards[0], index: number) => {
    const card = deckCard.card;
    const imageUrl = getImageUrl(card.imgFile);

    return (
      <div
        className={`group relative w-28 flex-shrink-0 cursor-pointer transition-all hover:z-20 ${
          viewMode === 'stacked' ? '-mb-24' : ''
        }`}
        onClick={(e) => {
          e.stopPropagation();
          console.log('Card clicked:', card.name, 'onViewCard exists:', !!onViewCard);
          if (onViewCard) {
            onViewCard(card, deckCard.isReserve);
          }
        }}
      >
        {/* Card image - compact */}
        <div className="relative aspect-[2.5/3.5] rounded-md overflow-hidden bg-gray-800 border border-gray-700 hover:border-blue-500 transition-all cursor-pointer hover:scale-105 hover:z-10 shadow-md hover:shadow-xl">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={card.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-700">
              <span className="text-xs text-gray-400 text-center px-1">{card.name}</span>
            </div>
          )}
          
          {/* Quantity badge */}
          {deckCard.quantity > 1 && (
            <div className="absolute bottom-1 right-1 bg-gray-900/90 text-white text-xs font-semibold px-1.5 py-0.5 rounded shadow-lg">
              x{deckCard.quantity}
            </div>
          )}

          {/* Hover overlay with card name */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity flex items-end">
            <div className="w-full p-1.5 text-white">
              <p className="text-xs font-semibold leading-tight truncate">{card.name}</p>
              {card.set && (
                <p className="text-[10px] text-gray-300 truncate">{card.set}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full w-full bg-gray-900 text-white overflow-y-auto">
      {/* Header with stats */}
      <div className="sticky top-0 z-20 bg-gradient-to-b from-gray-900 via-gray-900 to-gray-900/95 border-b border-gray-700 shadow-lg">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-2xl font-bold text-white">{deck.name}</h1>
            <div className="flex items-center gap-4 text-sm">
              {/* View Mode Toggle */}
              <button
                onClick={() => setViewMode(viewMode === 'normal' ? 'stacked' : 'normal')}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors"
                title={viewMode === 'normal' ? 'Switch to stacked view' : 'Switch to normal view'}
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {viewMode === 'normal' ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                  )}
                </svg>
                <span className="text-gray-300 text-xs font-medium">
                  {viewMode === 'normal' ? 'Normal' : 'Stacked'}
                </span>
              </button>
              
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Format:</span>
                <span className="font-semibold text-blue-400">{deck.format || 'Type 1'}</span>
              </div>
            </div>
          </div>
          
          {/* Quick stats bar */}
          <div className="flex items-center gap-6 text-sm">
            {/* Validation Status */}
            <div className={`relative group flex items-center gap-2 px-3 py-1.5 border rounded-lg cursor-help ${
              validation.isValid && validation.stats.totalCards > 0
                ? 'bg-green-900/30 border-green-700/50'
                : validation.stats.totalCards === 0
                ? 'bg-gray-800/30 border-gray-700/50'
                : 'bg-red-900/30 border-red-700/50'
            }`}>
              {validation.isValid && validation.stats.totalCards > 0 ? (
                <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : validation.stats.totalCards === 0 ? (
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              <span className={`font-semibold ${
                validation.isValid && validation.stats.totalCards > 0
                  ? 'text-green-400'
                  : validation.stats.totalCards === 0
                  ? 'text-gray-400'
                  : 'text-red-400'
              }`}>
                {validation.isValid && validation.stats.totalCards > 0
                  ? 'Valid'
                  : validation.stats.totalCards === 0
                  ? 'Empty'
                  : 'Invalid'
                }
              </span>
              
              {/* Tooltip showing validation details */}
              {validation.stats.totalCards > 0 && (
                <div className={`absolute left-0 top-full mt-2 w-80 p-4 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none ${
                  validation.isValid
                    ? "bg-green-50 dark:bg-green-900/90 border-2 border-green-300 dark:border-green-600"
                    : "bg-red-50 dark:bg-red-900/90 border-2 border-red-300 dark:border-red-600"
                }`}>
                  {/* Arrow */}
                  <div className={`absolute left-4 bottom-full w-0 h-0 border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent ${
                    validation.isValid
                      ? "border-b-green-300 dark:border-b-green-600"
                      : "border-b-red-300 dark:border-b-red-600"
                  }`}></div>
                  
                  {/* Content */}
                  <div className={`font-semibold mb-3 text-base ${
                    validation.isValid
                      ? "text-green-800 dark:text-green-200"
                      : "text-red-800 dark:text-red-200"
                  }`}>
                    {validation.isValid ? "✓ Passed Basic Checks" : `✗ ${validation.issues.filter(i => i.type === "error").length} Error${validation.issues.filter(i => i.type === "error").length !== 1 ? "s" : ""}`}
                  </div>
                  
                  {validation.issues.length > 0 && (
                    <div className="space-y-2">
                      {validation.issues.map((issue, idx) => (
                        <div
                          key={idx}
                          className={`text-sm flex items-start gap-2 ${
                            issue.type === "error"
                              ? "text-red-700 dark:text-red-300"
                              : issue.type === "warning"
                              ? "text-yellow-700 dark:text-yellow-300"
                              : "text-blue-700 dark:text-blue-300"
                          }`}
                        >
                          <span className="mt-0.5 flex-shrink-0">
                            {issue.type === "error" ? "⚠" : issue.type === "warning" ? "⚠" : "ℹ"}
                          </span>
                          <span className="flex-1">{issue.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-900/30 border border-blue-700/50 rounded-lg">
              <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span className="text-gray-400">Total:</span>
              <span className="font-bold text-white">{totalCards}</span>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Main Deck:</span>
              <span className="font-semibold text-white">{mainDeckCount}</span>
            </div>
            
            {reserveCount > 0 && (
              <>
                <div className="w-px h-4 bg-gray-600"></div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">Reserve:</span>
                  <span className="font-semibold text-white">{reserveCount}</span>
                </div>
              </>
            )}
            
            <div className="w-px h-4 bg-gray-600"></div>
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Unique Cards:</span>
              <span className="font-semibold text-white">{uniqueCards}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="px-6 py-6">
        {/* Single column layout - all cards together */}
        <div>
          {/* Main Deck */}
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-xl font-bold text-blue-400">Main Deck</h2>
              <span className="text-sm text-gray-500">({mainDeckCount} cards)</span>
            </div>
            
            {mainDeckCards.length > 0 ? (
              <div className={`flex flex-wrap gap-2 items-start ${viewMode === 'stacked' ? 'mt-8' : ''}`}>
                {sortCards(mainDeckCards).map((deckCard, index) => (
                  <React.Fragment key={`${deckCard.card.name}-${deckCard.card.set}`}>
                    {renderCompactCard(deckCard, index)}
                  </React.Fragment>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <p>No cards in main deck</p>
              </div>
            )}
          </div>

          {/* Reserve - Show below main deck if present */}
          {reserveCount > 0 && (
            <div className="mt-20 pt-6 border-t-2 border-purple-500/30">
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-xl font-bold text-purple-400">Reserve</h2>
                <span className="text-sm text-gray-500">({reserveCount} cards)</span>
              </div>
              
              <div className={`flex flex-wrap gap-2 items-start ${viewMode === 'stacked' ? 'mt-8' : ''}`}>
                {sortCards(reserveCards).map((deckCard, index) => (
                  <React.Fragment key={`${deckCard.card.name}-${deckCard.card.set}-reserve`}>
                    {renderCompactCard(deckCard, index)}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
