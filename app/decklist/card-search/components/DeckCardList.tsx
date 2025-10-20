import React from "react";
import { DeckCard } from "../types/deck";

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
}: DeckCardListProps) {
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

        return (
          <div
            key={cardKey}
            className="flex items-center gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
          >
            {/* Quantity Badge */}
            <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-blue-500 text-white font-bold rounded text-sm">
              {quantity}
            </div>

            {/* Card Info */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {card.name}
              </div>
              {card.officialSet && (
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {card.officialSet}
                </div>
              )}
            </div>

            {/* Quantity Controls */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                disabled={quantity >= 4}
                className="w-6 h-6 flex items-center justify-center rounded bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Increase quantity"
                title={quantity >= 4 ? "Maximum quantity reached (4)" : "Increase quantity"}
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
    </div>
  );
}
