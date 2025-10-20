import React, { useState } from "react";
import { Deck } from "../types/deck";
import DeckCardList from "./DeckCardList";

interface DeckBuilderPanelProps {
  /** Current deck state */
  deck: Deck;
  /** Callback when deck name changes */
  onDeckNameChange: (name: string) => void;
  /** Callback to add a card */
  onAddCard: (cardName: string, cardSet: string, isReserve: boolean) => void;
  /** Callback to remove a card */
  onRemoveCard: (cardName: string, cardSet: string, isReserve: boolean) => void;
  /** Callback to export deck */
  onExport: () => void;
  /** Callback to import deck - parent handles UI */
  onImport: () => void;
  /** Callback to clear deck */
  onClear: () => void;
}

type TabType = "cards" | "info";

/**
 * Right sidebar panel for deck building
 */
export default function DeckBuilderPanel({
  deck,
  onDeckNameChange,
  onAddCard,
  onRemoveCard,
  onExport,
  onImport,
  onClear,
}: DeckBuilderPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("cards");
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(deck.name);

  // Calculate deck stats
  const mainDeckCards = deck.cards.filter((dc) => !dc.isReserve);
  const reserveCards = deck.cards.filter((dc) => dc.isReserve);
  const mainDeckCount = mainDeckCards.reduce((sum, dc) => sum + dc.quantity, 0);
  const reserveCount = reserveCards.reduce((sum, dc) => sum + dc.quantity, 0);
  const totalCards = mainDeckCount + reserveCount;

  const handleNameSubmit = () => {
    if (editedName.trim()) {
      onDeckNameChange(editedName.trim());
    } else {
      setEditedName(deck.name); // Reset if empty
    }
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleNameSubmit();
    } else if (e.key === "Escape") {
      setEditedName(deck.name);
      setIsEditingName(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700">
        {/* Deck Name */}
        {isEditingName ? (
          <input
            type="text"
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={handleNameKeyDown}
            className="w-full text-xl font-semibold px-2 py-1 rounded border border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
        ) : (
          <h2
            className="text-xl font-semibold text-gray-900 dark:text-white cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            onClick={() => {
              setIsEditingName(true);
              setEditedName(deck.name);
            }}
            title="Click to edit deck name"
          >
            {deck.name}
          </h2>
        )}

        {/* Card Count */}
        <div className="mt-2 flex items-center gap-3 text-sm">
          <div className="flex items-center gap-1">
            <span className="text-gray-600 dark:text-gray-400">Main:</span>
            <span className="font-semibold text-gray-900 dark:text-white">{mainDeckCount}</span>
          </div>
          {reserveCount > 0 && (
            <>
              <span className="text-gray-400">•</span>
              <div className="flex items-center gap-1">
                <span className="text-gray-600 dark:text-gray-400">Reserve:</span>
                <span className="font-semibold text-gray-900 dark:text-white">{reserveCount}</span>
              </div>
            </>
          )}
          <span className="text-gray-400">•</span>
          <div className="flex items-center gap-1">
            <span className="text-gray-600 dark:text-gray-400">Total:</span>
            <span className="font-semibold text-gray-900 dark:text-white">{totalCards}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={onExport}
            className="flex-1 px-3 py-2 text-sm font-medium rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            Export
          </button>
          <button
            onClick={onImport}
            className="flex-1 px-3 py-2 text-sm font-medium rounded bg-green-600 hover:bg-green-700 text-white transition-colors"
          >
            Import
          </button>
          <button
            onClick={() => {
              if (confirm("Clear entire deck?")) {
                onClear();
              }
            }}
            className="px-3 py-2 text-sm font-medium rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition-colors"
            title="Clear deck"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <button
          onClick={() => setActiveTab("cards")}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === "cards"
              ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          Cards ({deck.cards.length})
        </button>
        <button
          onClick={() => setActiveTab("info")}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === "info"
              ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          Info
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "cards" ? (
          <div className="space-y-4">
            {/* Main Deck */}
            {mainDeckCards.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Main Deck ({mainDeckCount})
                </h3>
                <DeckCardList
                  cards={mainDeckCards}
                  onIncrement={(name, set, isReserve) => onAddCard(name, set, isReserve)}
                  onDecrement={(name, set, isReserve) => onRemoveCard(name, set, isReserve)}
                  onRemove={(name, set, isReserve) => {
                    // Remove all copies
                    const card = deck.cards.find(
                      (dc) => dc.card.name === name && dc.card.set === set && dc.isReserve === isReserve
                    );
                    if (card) {
                      for (let i = 0; i < card.quantity; i++) {
                        onRemoveCard(name, set, isReserve);
                      }
                    }
                  }}
                  filterReserve={false}
                />
              </div>
            )}

            {/* Reserve */}
            {reserveCards.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Reserve ({reserveCount})
                </h3>
                <DeckCardList
                  cards={reserveCards}
                  onIncrement={(name, set, isReserve) => onAddCard(name, set, isReserve)}
                  onDecrement={(name, set, isReserve) => onRemoveCard(name, set, isReserve)}
                  onRemove={(name, set, isReserve) => {
                    // Remove all copies
                    const card = deck.cards.find(
                      (dc) => dc.card.name === name && dc.card.set === set && dc.isReserve === isReserve
                    );
                    if (card) {
                      for (let i = 0; i < card.quantity; i++) {
                        onRemoveCard(name, set, isReserve);
                      }
                    }
                  }}
                  filterReserve={true}
                />
              </div>
            )}

            {/* Empty State */}
            {deck.cards.length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  Click cards from the search results to add them to your deck
                </p>
              </div>
            )}
          </div>
        ) : (
          // Info Tab
          <div className="space-y-4 text-sm">
            <div>
              <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Deck Statistics
              </h3>
              <div className="space-y-1 text-gray-600 dark:text-gray-400">
                <div className="flex justify-between">
                  <span>Total Cards:</span>
                  <span className="font-medium">{totalCards}</span>
                </div>
                <div className="flex justify-between">
                  <span>Unique Cards:</span>
                  <span className="font-medium">{deck.cards.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Main Deck:</span>
                  <span className="font-medium">{mainDeckCount}</span>
                </div>
                {reserveCount > 0 && (
                  <div className="flex justify-between">
                    <span>Reserve:</span>
                    <span className="font-medium">{reserveCount}</span>
                  </div>
                )}
              </div>
            </div>

            {deck.description && (
              <div>
                <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Description
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  {deck.description}
                </p>
              </div>
            )}

            <div className="text-xs text-gray-500 dark:text-gray-500">
              <div>Created: {deck.createdAt.toLocaleDateString()}</div>
              <div>Updated: {deck.updatedAt.toLocaleString()}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
