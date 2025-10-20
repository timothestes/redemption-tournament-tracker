import React, { useState, useEffect } from "react";
import { Deck } from "../types/deck";
import DeckCardList from "./DeckCardList";

export type TabType = "main" | "reserve" | "info";

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
  /** Callback when active tab changes */
  onActiveTabChange?: (tab: TabType) => void;
}

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
  onActiveTabChange,
}: DeckBuilderPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("main");
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(deck.name);
  const [showMenu, setShowMenu] = useState(false);

  // Notify parent when tab changes
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    onActiveTabChange?.(tab);
  };

  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return;
    const handleClick = () => setShowMenu(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showMenu]);

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

  // Group cards by type
  const groupCardsByType = (cards: typeof deck.cards) => {
    const grouped = cards.reduce((acc, deckCard) => {
      const type = deckCard.card.type || "Unknown";
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(deckCard);
      return acc;
    }, {} as Record<string, typeof deck.cards>);

    // Sort types alphabetically
    return Object.keys(grouped)
      .sort()
      .map((type) => ({
        type,
        cards: grouped[type],
        count: grouped[type].reduce((sum, dc) => sum + dc.quantity, 0),
      }));
  };

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

        {/* Card Count and Menu Button Row */}
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-sm">
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

          {/* Menu Dropdown */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="px-3 py-1.5 text-sm font-medium rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors flex items-center gap-2"
            >
              Menu
              <svg className={`w-4 h-4 transition-transform ${showMenu ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            {showMenu && (
              <div className="absolute top-full mt-1 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-50 min-w-[160px]">
              <button
                onClick={() => {
                  onExport();
                  setShowMenu(false);
                }}
                className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-900 dark:text-white text-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Export
              </button>
              <button
                onClick={() => {
                  onImport();
                  setShowMenu(false);
                }}
                className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-900 dark:text-white text-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Import
              </button>
              <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
              <button
                onClick={() => {
                  if (confirm("Clear entire deck?")) {
                    onClear();
                  }
                  setShowMenu(false);
                }}
                className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-red-600 dark:text-red-400 text-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Clear Deck
              </button>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <button
          onClick={() => handleTabChange("main")}
          className={`flex-1 px-3 py-3 text-sm font-medium transition-colors ${
            activeTab === "main"
              ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          Main ({mainDeckCount})
        </button>
        <button
          onClick={() => handleTabChange("reserve")}
          className={`flex-1 px-3 py-3 text-sm font-medium transition-colors ${
            activeTab === "reserve"
              ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          Reserve ({reserveCount})
        </button>
        <button
          onClick={() => handleTabChange("info")}
          className={`flex-1 px-3 py-3 text-sm font-medium transition-colors ${
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
        {activeTab === "main" ? (
          <div className="space-y-4">
            {mainDeckCards.length > 0 ? (
              groupCardsByType(mainDeckCards).map(({ type, cards, count }) => (
                <div key={type}>
                  <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wide">
                    {prettifyTypeName(type)} ({count})
                  </h4>
                  <DeckCardList
                    cards={cards}
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
              ))
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  No cards in main deck yet
                </p>
                <p className="text-gray-400 dark:text-gray-500 text-xs mt-2">
                  Click cards from search to add them
                </p>
              </div>
            )}
          </div>
        ) : activeTab === "reserve" ? (
          <div className="space-y-4">
            {reserveCards.length > 0 ? (
              groupCardsByType(reserveCards).map(({ type, cards, count }) => (
                <div key={type}>
                  <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wide">
                    {prettifyTypeName(type)} ({count})
                  </h4>
                  <DeckCardList
                    cards={cards}
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
              ))
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  No cards in reserve yet
                </p>
                <p className="text-gray-400 dark:text-gray-500 text-xs mt-2">
                  Use "Add to Deck" button on cards and select "Add to Reserve"
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
