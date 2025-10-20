import React, { useState, useEffect } from "react";
import { Deck } from "../types/deck";
import { SyncStatus } from "../hooks/useDeckState";
import DeckCardList from "./DeckCardList";
import { Card } from "../utils";
import { validateDeck, getValidationSummary } from "../utils/deckValidation";
import GeneratePDFModal from "./GeneratePDFModal";
import ClearDeckModal from "./ClearDeckModal";
import LoadDeckModal from "./LoadDeckModal";

export type TabType = "main" | "reserve" | "info";

interface DeckBuilderPanelProps {
  /** Current deck state */
  deck: Deck;
  /** Cloud sync status */
  syncStatus?: SyncStatus;
  /** Whether there are unsaved changes */
  hasUnsavedChanges?: boolean;
  /** Callback when deck name changes */
  onDeckNameChange: (name: string) => void;
  /** Callback when deck format changes */
  onDeckFormatChange?: (format: string) => void;
  /** Callback to save deck to cloud */
  onSaveDeck?: () => Promise<{ success: boolean; error?: string }>;
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
  /** Callback to load a deck from cloud by ID */
  onLoadDeck?: (deckId: string) => void;
  /** Callback to create a new blank deck */
  onNewDeck?: (name?: string) => void;
  /** Callback when active tab changes */
  onActiveTabChange?: (tab: TabType) => void;
  /** Callback when user wants to view card details */
  onViewCard?: (card: Card) => void;
}

/**
 * Right sidebar panel for deck building
 */
export default function DeckBuilderPanel({
  deck,
  syncStatus,
  hasUnsavedChanges = false,
  onDeckNameChange,
  onDeckFormatChange,
  onSaveDeck,
  onAddCard,
  onRemoveCard,
  onExport,
  onImport,
  onClear,
  onLoadDeck,
  onNewDeck,
  onActiveTabChange,
  onViewCard,
}: DeckBuilderPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("main");
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(deck.name);
  const [showMenu, setShowMenu] = useState(false);
  const [showGeneratePDFModal, setShowGeneratePDFModal] = useState(false);
  const [showClearDeckModal, setShowClearDeckModal] = useState(false);
  const [showLoadDeckModal, setShowLoadDeckModal] = useState(false);
  
  // Initialize deck type based on deck.format
  const [deckType, setDeckType] = useState<'T1' | 'T2'>(() => {
    const format = deck.format?.toLowerCase();
    return format?.includes('type 2') || format?.includes('multi') ? 'T2' : 'T1';
  });

  // Calculate validation
  const validation = validateDeck(deck);

  // Handle deck type toggle
  const handleDeckTypeToggle = () => {
    const newType = deckType === 'T1' ? 'T2' : 'T1';
    setDeckType(newType);
    const newFormat = newType === 'T2' ? 'Type 2' : 'Type 1';
    onDeckFormatChange?.(newFormat);
  };

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

  // Handle moving card between main deck and reserve
  const handleMoveCard = (cardName: string, cardSet: string, fromReserve: boolean, toReserve: boolean) => {
    // Find the card
    const deckCard = deck.cards.find(
      (dc) => dc.card.name === cardName && dc.card.set === cardSet && dc.isReserve === fromReserve
    );
    
    if (deckCard) {
      // Remove all copies from current location
      for (let i = 0; i < deckCard.quantity; i++) {
        onRemoveCard(cardName, cardSet, fromReserve);
      }
      // Add all copies to new location
      for (let i = 0; i < deckCard.quantity; i++) {
        onAddCard(cardName, cardSet, toReserve);
      }
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
            suppressHydrationWarning
          >
            {deck.name}
          </h2>
        )}

        {/* Card Count and Menu Button Row */}
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-sm" suppressHydrationWarning>
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
            
            {/* T1/T2 Toggle Switch */}
            <span className="text-gray-400">•</span>
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-full p-0.5">
              <button
                onClick={() => deckType === 'T2' && handleDeckTypeToggle()}
                className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                  deckType === 'T1'
                    ? 'bg-blue-600 dark:bg-blue-500 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                T1
              </button>
              <button
                onClick={() => deckType === 'T1' && handleDeckTypeToggle()}
                className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                  deckType === 'T2'
                    ? 'bg-blue-600 dark:bg-blue-500 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                T2
              </button>
            </div>
          </div>

          {/* Save Button */}
          {onSaveDeck && (
            <button
              onClick={async () => {
                const result = await onSaveDeck();
                if (!result.success && result.error) {
                  alert(result.error);
                }
              }}
              disabled={syncStatus?.isSaving}
              className={`px-4 py-1.5 text-sm font-medium rounded transition-colors flex items-center gap-2 ${
                syncStatus?.isSaving
                  ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-500 cursor-not-allowed'
                  : hasUnsavedChanges
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-green-600 hover:bg-green-700 text-white opacity-75'
              }`}
              title={
                syncStatus?.isSaving
                  ? 'Saving...'
                  : hasUnsavedChanges
                  ? 'Save changes to cloud'
                  : syncStatus?.lastSavedAt
                  ? `Last saved ${new Date(syncStatus.lastSavedAt).toLocaleTimeString()}`
                  : 'Save to cloud'
              }
            >
              {syncStatus?.isSaving ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Saving...
                </>
              ) : hasUnsavedChanges ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  Save
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19h6" />
                  </svg>
                  Saved
                </>
              )}
            </button>
          )}

          {/* New Deck Button */}
          {onNewDeck && (
            <button
              onClick={() => onNewDeck()}
              className="px-3 py-1.5 text-sm font-medium rounded border border-blue-500 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-700 dark:text-blue-300 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Deck
            </button>
          )}

          {/* Menu Dropdown */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="px-3 py-1.5 text-sm font-medium rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
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
              <button
                onClick={() => {
                  setShowGeneratePDFModal(true);
                  setShowMenu(false);
                }}
                className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-900 dark:text-white text-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                Generate PDF
              </button>
              {onLoadDeck && (
                <button
                  onClick={() => {
                    setShowLoadDeckModal(true);
                    setShowMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-900 dark:text-white text-sm"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Load Deck
                </button>
              )}
              <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
              <button
                onClick={() => {
                  setShowClearDeckModal(true);
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
          <span className="flex items-center justify-center gap-1.5">
            Info
            {validation.stats.totalCards > 0 && (
              <span
                className={`inline-flex items-center justify-center w-4 h-4 text-xs rounded-full ${
                  validation.isValid
                    ? "bg-green-500 text-white"
                    : "bg-red-500 text-white"
                }`}
                title={validation.isValid ? "Valid deck" : `${validation.issues.filter(i => i.type === "error").length} error(s)`}
              >
                {validation.isValid ? "✓" : "!"}
              </span>
            )}
          </span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "main" ? (
          <div className="space-y-4">
            {mainDeckCards.length > 0 ? (
              groupCardsByType(mainDeckCards).map(({ type, cards, count }) => {
                return (
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
                    onViewCard={onViewCard}
                    onMoveCard={handleMoveCard}
                  />
                </div>
              );
              })
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  No cards in main deck yet
                </p>
                <p className="text-gray-400 dark:text-gray-500 text-xs mt-2 mb-4">
                  Click cards from search to add them
                </p>
                <button
                  onClick={() => {
                    onImport();
                    // Focus the textarea after the modal opens
                    setTimeout(() => {
                      const textarea = document.getElementById('import-deck-textarea') as HTMLTextAreaElement;
                      if (textarea) {
                        textarea.focus();
                        textarea.select();
                      }
                    }, 150);
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Paste from Clipboard
                </button>
              </div>
            )}
          </div>
        ) : activeTab === "reserve" ? (
          <div className="space-y-4">
            {reserveCards.length > 0 ? (
              groupCardsByType(reserveCards).map(({ type, cards, count }) => {
                return (
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
                    onViewCard={onViewCard}
                    onMoveCard={handleMoveCard}
                  />
                </div>
              );
              })
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
            {/* Validation Status */}
            <div>
              <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Deck Validation
              </h3>
              <div className={`p-3 rounded-lg ${
                validation.isValid && validation.stats.totalCards > 0
                  ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                  : validation.stats.totalCards === 0
                  ? "bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
                  : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
              }`}>
                <div className="font-medium mb-2">
                  {validation.isValid && validation.stats.totalCards > 0 ? (
                    <span className="text-green-700 dark:text-green-400">✓ Valid Deck</span>
                  ) : validation.stats.totalCards === 0 ? (
                    <span className="text-gray-600 dark:text-gray-400">Empty Deck</span>
                  ) : (
                    <span className="text-red-700 dark:text-red-400">
                      ✗ {validation.issues.filter(i => i.type === "error").length} Error{validation.issues.filter(i => i.type === "error").length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                
                {validation.issues.length > 0 && (
                  <div className="space-y-1">
                    {validation.issues.map((issue, idx) => (
                      <div
                        key={idx}
                        className={`text-xs flex items-start gap-1 ${
                          issue.type === "error"
                            ? "text-red-700 dark:text-red-400"
                            : issue.type === "warning"
                            ? "text-yellow-700 dark:text-yellow-400"
                            : "text-blue-700 dark:text-blue-400"
                        }`}
                      >
                        <span className="mt-0.5">
                          {issue.type === "error" ? "⚠" : issue.type === "warning" ? "⚠" : "ℹ"}
                        </span>
                        <span>{issue.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

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
                <div className="border-t border-gray-200 dark:border-gray-700 my-2 pt-2">
                  <div className="flex justify-between">
                    <span>Lost Souls:</span>
                    <span className={`font-medium ${
                      validation.stats.lostSoulCount < validation.stats.requiredLostSouls
                        ? "text-red-600 dark:text-red-400"
                        : validation.stats.lostSoulCount > validation.stats.requiredLostSouls
                        ? "text-red-600 dark:text-red-400"
                        : "text-green-600 dark:text-green-400"
                    }`}>
                      {validation.stats.lostSoulCount}/{validation.stats.requiredLostSouls}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Dominants:</span>
                    <span className="font-medium">{validation.stats.dominantCount}</span>
                  </div>
                </div>
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

      {/* Generate PDF Modal */}
      {showGeneratePDFModal && (
        <GeneratePDFModal
          deck={deck}
          onClose={() => setShowGeneratePDFModal(false)}
        />
      )}

      {/* Clear Deck Modal */}
      {showClearDeckModal && (
        <ClearDeckModal
          deckName={deck.name}
          onConfirm={onClear}
          onClose={() => setShowClearDeckModal(false)}
        />
      )}

      {/* Load Deck Modal */}
      {showLoadDeckModal && onLoadDeck && (
        <LoadDeckModal
          onLoadDeck={onLoadDeck}
          onClose={() => setShowLoadDeckModal(false)}
        />
      )}
    </div>
  );
}
