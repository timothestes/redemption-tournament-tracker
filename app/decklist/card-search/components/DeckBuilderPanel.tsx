import React, { useState, useEffect } from "react";
import { Deck } from "../types/deck";
import { SyncStatus } from "../hooks/useDeckState";
import DeckCardList from "./DeckCardList";
import FullDeckView from "./FullDeckView";
import { Switch } from "@headlessui/react";
import { Card } from "../utils";
import { validateDeck } from "../utils/deckValidation";
import GeneratePDFModal from "./GeneratePDFModal";
import GenerateDeckImageModal from "./GenerateDeckImageModal";
import ClearDeckModal from "./ClearDeckModal";
import LoadDeckModal from "./LoadDeckModal";
import { duplicateDeckAction } from "../../actions";
import { getParagonNames, getParagonByName } from "../data/paragons";
import ParagonRequirements from "./ParagonRequirements";
import { useCardImageUrl } from "../hooks/useCardImageUrl";

export type TabType = "main" | "reserve" | "info";

interface DeckBuilderPanelProps {
  /** Current deck state */
  deck: Deck;
  /** Cloud sync status */
  syncStatus?: SyncStatus;
  /** Whether there are unsaved changes */
  hasUnsavedChanges?: boolean;
  /** Whether the user is authenticated */
  isAuthenticated?: boolean;
  /** Whether the panel is expanded to full width */
  isExpanded?: boolean;
  /** Callback when deck name changes */
  onDeckNameChange: (name: string) => void;
  /** Callback when deck format changes */
  onDeckFormatChange?: (format: string) => void;
  /** Callback when Paragon changes */
  onParagonChange?: (paragon: string | undefined) => void;
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
  /** Callback to delete deck */
  onDelete: () => void;
  /** Callback to duplicate current deck */
  onDuplicate?: () => void;
  /** Callback to load a deck from cloud by ID */
  onLoadDeck?: (deckId: string) => void;
  /** Callback to create a new blank deck */
  onNewDeck?: (name?: string, folderId?: string | null) => void;
  /** Callback when active tab changes */
  onActiveTabChange?: (tab: TabType) => void;
  /** Callback when user wants to view card details */
  onViewCard?: (card: Card, isReserve?: boolean) => void;
  /** Callback to show notifications */
  onNotify?: (message: string, type: 'success' | 'error' | 'info') => void;
}

/**
 * Right sidebar panel for deck building
 */
export default function DeckBuilderPanel({
  deck,
  syncStatus,
  hasUnsavedChanges = false,
  isAuthenticated = false,
  isExpanded = false,
  onDeckNameChange,
  onDeckFormatChange,
  onParagonChange,
  onSaveDeck,
  onAddCard,
  onRemoveCard,
  onExport,
  onImport,
  onDelete,
  onDuplicate,
  onLoadDeck,
  onNewDeck,
  onActiveTabChange,
  onViewCard,
  onNotify,
}: DeckBuilderPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("main");
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(deck.name);
  const [showMenu, setShowMenu] = useState(false);
  const [showGeneratePDFModal, setShowGeneratePDFModal] = useState(false);
  const [showGenerateImageModal, setShowGenerateImageModal] = useState(false);
  const [showDeleteDeckModal, setShowDeleteDeckModal] = useState(false);
  const [showLoadDeckModal, setShowLoadDeckModal] = useState(false);
  const [showValidationTooltip, setShowValidationTooltip] = useState(false);
  const [showViewDropdown, setShowViewDropdown] = useState(false);
  const [showParagonDropdown, setShowParagonDropdown] = useState(false);
  const [showParagonModal, setShowParagonModal] = useState(false);
  
  // View options
  const [viewLayout, setViewLayout] = useState<'grid' | 'list'>('grid');
  const [groupBy, setGroupBy] = useState<'type' | 'alignment'>('type');
  const [disableHoverPreview, setDisableHoverPreview] = useState(false);
  
  // Initialize deck type based on deck.format
  const [deckType, setDeckType] = useState<'T1' | 'T2' | 'Paragon'>(() => {
    const format = deck.format?.toLowerCase();
    if (format?.includes('paragon')) return 'Paragon';
    if (format?.includes('type 2') || format?.includes('multi')) return 'T2';
    return 'T1';
  });

  // Sync deckType with deck.format when deck changes (e.g., when loading a deck)
  useEffect(() => {
    const format = deck.format?.toLowerCase();
    let newType: 'T1' | 'T2' | 'Paragon';
    if (format?.includes('paragon')) {
      newType = 'Paragon';
    } else if (format?.includes('type 2') || format?.includes('multi')) {
      newType = 'T2';
    } else {
      newType = 'T1';
    }
    setDeckType(newType);
  }, [deck.format]);

  // Calculate validation
  const validation = validateDeck(deck);

  // Helper function to get brigade color
  const getBrigadeColor = (brigade: string): string => {
    const brigadeColors: Record<string, string> = {
      'Red': '#DC2626',      // red-600
      'Blue': '#2b57a2',     // custom blue color
      'Green': '#02b65f',    // custom green color
      'Purple': '#b75ba9',   // custom purple color
      'Gold': '#ffda5b',     // custom gold color
      'White': '#ffffff',    // custom white color
      'Black': '#020406',    // custom black color
      'Brown': '#a97b27',    // custom brown color
      'Teal': '#0D9488',     // teal-600
      'Crimson': '#f34088',  // custom crimson color
      'Orange': '#fcbb72',   // custom orange color
      'Silver': '#b5b8b9',   // custom silver color
      'Clay': '#e2b7b3',     // custom clay color
      'Gray': '#b3c0ba',     // custom gray color
    };
    return brigadeColors[brigade] || '#6B7280'; // default to gray-500
  };

  // Handle deck type change
  const handleDeckTypeChange = (newType: 'T1' | 'T2' | 'Paragon') => {
    setDeckType(newType);
    let newFormat: string;
    if (newType === 'T2') newFormat = 'Type 2';
    else if (newType === 'Paragon') newFormat = 'Paragon';
    else newFormat = 'Type 1';
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

  // Close view dropdown when clicking outside
  useEffect(() => {
    if (!showViewDropdown) return;
    const handleClick = () => setShowViewDropdown(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showViewDropdown]);

  // Close paragon dropdown when clicking outside
  useEffect(() => {
    if (!showParagonDropdown) return;
    const handleClick = () => setShowParagonDropdown(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showParagonDropdown]);

  // Close paragon modal with Escape key
  useEffect(() => {
    if (!showParagonModal) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowParagonModal(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showParagonModal]);

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
        // Sort cards within each type by alignment, then by name
        cards: grouped[type].sort((a, b) => {
          const alignmentA = a.card.alignment || 'Neutral';
          const alignmentB = b.card.alignment || 'Neutral';
          
          // Define alignment order: Good, Evil, Neutral
          const alignmentOrder = ['Good', 'Evil', 'Neutral'];
          const aIndex = alignmentOrder.indexOf(alignmentA);
          const bIndex = alignmentOrder.indexOf(alignmentB);
          
          // Sort by alignment first
          if (aIndex !== bIndex) {
            return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
          }
          
          // Then by card name
          return a.card.name.localeCompare(b.card.name);
        }),
        count: grouped[type].reduce((sum, dc) => sum + dc.quantity, 0),
      }));
  };

  // Group cards by alignment
  const groupCardsByAlignment = (cards: typeof deck.cards) => {
    const grouped = cards.reduce((acc, deckCard) => {
      const alignment = deckCard.card.alignment || "Neutral";
      if (!acc[alignment]) {
        acc[alignment] = [];
      }
      acc[alignment].push(deckCard);
      return acc;
    }, {} as Record<string, typeof deck.cards>);

    // Sort alignments: Good, Evil, Neutral
    const alignmentOrder = ['Good', 'Evil', 'Neutral'];
    return Object.keys(grouped)
      .sort((a, b) => {
        const aIndex = alignmentOrder.indexOf(a);
        const bIndex = alignmentOrder.indexOf(b);
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      })
      .map((alignment) => ({
        type: alignment,
        // Sort cards within each alignment by type, then by name
        cards: grouped[alignment].sort((a, b) => {
          const typeA = a.card.type || '';
          const typeB = b.card.type || '';
          if (typeA !== typeB) {
            return typeA.localeCompare(typeB);
          }
          return a.card.name.localeCompare(b.card.name);
        }),
        count: grouped[alignment].reduce((sum, dc) => sum + dc.quantity, 0),
      }));
  };

  // Group cards based on current groupBy setting
  const groupCards = (cards: typeof deck.cards) => {
    return groupBy === 'alignment' 
      ? groupCardsByAlignment(cards) 
      : groupCardsByType(cards);
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

  // Get icon path for card type - returns single icon path or null for dual icons
  const getTypeIcon = (type: string): string | null => {
    // Only show icons for simple single types
    // Skip multi-type cards (those with "/" in the type)
    if (type.includes('/')) {
      return null;
    }
    
    // Return null for types that need dual icons
    if (type === 'Dominant' || type === 'Dom') {
      return null; // Will show both Good and Evil Dominant icons
    }
    
    // Map types to icon paths
    const iconMap: Record<string, string> = {
      'Artifact': '/filter-icons/Artifact.png',
      'Art': '/filter-icons/Artifact.png',
      'City': '/filter-icons/City.png',
      'Covenant': '/filter-icons/Covenant.png',
      'Cov': '/filter-icons/Covenant.png',
      'Curse': '/filter-icons/Curse.png',
      'Cur': '/filter-icons/Curse.png',
      'Evil Character': '/filter-icons/Evil Character.png',
      'EC': '/filter-icons/Evil Character.png',
      'Evil Enhancement': '/filter-icons/EE.png',
      'EE': '/filter-icons/EE.png',
      'Fortress': '/filter-icons/Good Fortress.png', // Just use Good version
      'Fort': '/filter-icons/Good Fortress.png',
      'Good Character': '/filter-icons/Hero.png',
      'GC': '/filter-icons/Hero.png',
      'Hero': '/filter-icons/Hero.png',
      'HC': '/filter-icons/Hero.png',
      'Good Enhancement': '/filter-icons/GE.png',
      'GE': '/filter-icons/GE.png',
      'Lost Soul': '/filter-icons/Lost Soul.png',
      'LS': '/filter-icons/Lost Soul.png',
      'Site': '/filter-icons/Site.png',
    };
    return iconMap[type] || null;
  };

  // Check if a type should show dual icons
  const shouldShowDualIcons = (type: string): boolean => {
    return type === 'Dominant' || type === 'Dom' || type === 'GE/EE' || type === 'EE/GE';
  };

  // Get dual icon configuration for a type
  const getDualIconConfig = (type: string): { icon1: string; alt1: string; icon2: string; alt2: string } | null => {
    if (type === 'Dominant' || type === 'Dom') {
      return {
        icon1: '/filter-icons/Good Dominant.png',
        alt1: 'Good Dominant',
        icon2: '/filter-icons/Evil Dominant.png',
        alt2: 'Evil Dominant'
      };
    }
    if (type === 'GE/EE' || type === 'EE/GE') {
      return {
        icon1: '/filter-icons/GE.png',
        alt1: 'Good Enhancement',
        icon2: '/filter-icons/EE.png',
        alt2: 'Evil Enhancement'
      };
    }
    return null;
  };

  return (
    <div className="w-full h-full flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700 overflow-visible">
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
        <div className="mt-2 flex items-center justify-between gap-3 min-w-0">
          <div className="flex items-center gap-3 text-sm flex-wrap min-w-0" suppressHydrationWarning>
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
            
            {/* Format Selector (T1/T2/Paragon) */}
            <span className="text-gray-400">•</span>
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-full p-0.5">
              <button
                onClick={() => handleDeckTypeChange('T1')}
                className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                  deckType === 'T1'
                    ? 'bg-blue-600 dark:bg-blue-500 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 cursor-pointer'
                }`}
              >
                T1
              </button>
              <button
                onClick={() => handleDeckTypeChange('T2')}
                className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                  deckType === 'T2'
                    ? 'bg-blue-600 dark:bg-blue-500 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 cursor-pointer'
                }`}
              >
                T2
              </button>
              <button
                onClick={() => handleDeckTypeChange('Paragon')}
                className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                  deckType === 'Paragon'
                    ? 'bg-purple-600 dark:bg-purple-500 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 cursor-pointer'
                }`}
              >
                Paragon
              </button>
            </div>
            
            {/* Paragon Selector (only show for Paragon format) */}
            {deckType === 'Paragon' && (
              <div className="relative flex items-center gap-1">
                <span className="text-gray-600 dark:text-gray-400 text-xs">Paragon:</span>
                <button
                    onClick={() => setShowParagonDropdown(!showParagonDropdown)}
                    className="text-xs px-2 py-0.5 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700 rounded text-purple-900 dark:text-purple-100 font-medium focus:outline-none focus:ring-2 focus:ring-purple-500 flex items-center gap-1.5 min-w-[180px] justify-between"
                  >
                    {deck.paragon ? (
                      <span className="flex items-center gap-1.5">
                        {(() => {
                          const paragonData = getParagonByName(deck.paragon);
                          if (paragonData) {
                            return (
                              <>
                                <span className="flex gap-0.5">
                                  <span
                                    className="w-3 h-3 rounded-sm border border-black"
                                    style={{ backgroundColor: getBrigadeColor(paragonData.goodBrigade) }}
                                    title={`${paragonData.goodBrigade} (Good)`}
                                  />
                                  <span
                                    className="w-3 h-3 rounded-sm border border-black"
                                    style={{ backgroundColor: getBrigadeColor(paragonData.evilBrigade) }}
                                    title={`${paragonData.evilBrigade} (Evil)`}
                                  />
                                </span>
                                <span>{deck.paragon}</span>
                              </>
                            );
                          }
                          return <span>{deck.paragon}</span>;
                        })()}
                      </span>
                    ) : (
                      <span className="text-purple-700 dark:text-purple-300">Choose a Paragon...</span>
                    )}
                    <svg className={`w-3 h-3 transition-transform ${showParagonDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {/* Custom Dropdown Menu */}
                  {showParagonDropdown && (
                    <div className="absolute top-full mt-1 left-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto min-w-[240px]">
                      <button
                        onClick={() => {
                          onParagonChange?.(undefined);
                          setShowParagonDropdown(false);
                        }}
                        className="w-full px-3 py-2 text-left text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        Choose a Paragon...
                      </button>
                      {getParagonNames().map((name) => {
                        const paragonData = getParagonByName(name);
                        return (
                          <button
                            key={name}
                            onClick={() => {
                              onParagonChange?.(name);
                              setShowParagonDropdown(false);
                            }}
                            className={`w-full px-3 py-2 text-left text-xs hover:bg-purple-50 dark:hover:bg-purple-900/30 transition-colors flex items-center gap-2 ${
                              deck.paragon === name ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-900 dark:text-purple-100' : 'text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {paragonData && (
                              <span className="flex gap-0.5 flex-shrink-0">
                                <span
                                  className="w-3 h-3 rounded-sm border border-black"
                                  style={{ backgroundColor: getBrigadeColor(paragonData.goodBrigade) }}
                                  title={`${paragonData.goodBrigade} (Good)`}
                                />
                                <span
                                  className="w-3 h-3 rounded-sm border border-black"
                                  style={{ backgroundColor: getBrigadeColor(paragonData.evilBrigade) }}
                                  title={`${paragonData.evilBrigade} (Evil)`}
                                />
                              </span>
                            )}
                            <span className="font-medium">{name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Save Button */}
            {onSaveDeck && isAuthenticated && (
              <button
                onClick={async () => {
                  if (!isAuthenticated) {
                    onNotify?.('Please sign in to save your deck to the cloud.', 'error');
                    return;
                  }
                  const result = await onSaveDeck();
                  if (!result.success && result.error) {
                    onNotify?.(result.error, 'error');
                  } else if (result.success) {
                    onNotify?.('Deck saved successfully!', 'success');
                  }
                }}
                disabled={syncStatus?.isSaving || !isAuthenticated}
                className={`px-4 py-1.5 text-sm font-medium rounded transition-all flex items-center gap-2 min-w-[140px] justify-center ${
                  syncStatus?.isSaving || !isAuthenticated
                    ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-500 cursor-not-allowed'
                    : hasUnsavedChanges
                    ? 'bg-green-600 hover:bg-green-700 text-white shadow-sm'
                    : 'bg-gray-500 hover:bg-gray-600 text-white'
                }`}
                title={
                  !isAuthenticated
                    ? 'Only signed in users may save decks'
                    : syncStatus?.isSaving
                    ? 'Saving...'
                    : hasUnsavedChanges
                    ? 'You have unsaved changes - Click to save to cloud (Ctrl+S / Cmd+S)'
                    : syncStatus?.lastSavedAt
                    ? `All changes saved - Last saved ${new Date(syncStatus.lastSavedAt).toLocaleTimeString()} (Ctrl+S / Cmd+S)`
                    : 'No changes to save (Ctrl+S / Cmd+S)'
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
                    Save (Ctrl+S)
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Saved
                  </>
                )}
              </button>
            )}

            {/* New Deck Button */}
            {onNewDeck && (
              <button
                onClick={() => onNewDeck(undefined, deck.folderId)}
                className="px-3 py-1.5 text-sm font-medium rounded border border-blue-500 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-700 dark:text-blue-300 transition-colors flex items-center gap-2 flex-shrink-0"
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
              {/* Import/Export Section */}
              <button
                onClick={() => {
                  onImport();
                  setShowMenu(false);
                }}
                className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-900 dark:text-white text-sm"
                title="Import deck from clipboard (Ctrl+I / Cmd+I)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Import (Ctrl+I)
              </button>
              <button
                onClick={() => {
                  onExport();
                  setShowMenu(false);
                }}
                className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-900 dark:text-white text-sm"
                title="Export deck to clipboard (Ctrl+E / Cmd+E)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Export (Ctrl+E)
              </button>
              
              <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
              
              {/* Duplicate/Load Section */}
              {onDuplicate && isAuthenticated && deck.id && (
                <button
                  onClick={async () => {
                    setShowMenu(false);
                    const result = await duplicateDeckAction(deck.id!);
                    if (result.success) {
                      onNotify?.('Deck duplicated successfully!', 'success');
                      // Optionally reload or navigate to the duplicated deck
                      if (onLoadDeck && result.deckId) {
                        onLoadDeck(result.deckId);
                      }
                    } else {
                      onNotify?.(result.error || 'Failed to duplicate deck', 'error');
                    }
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-900 dark:text-white text-sm"
                  title="Create a copy of this deck"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Duplicate
                </button>
              )}
              {onLoadDeck && isAuthenticated && (
                <button
                  onClick={() => {
                    setShowLoadDeckModal(true);
                    setShowMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-900 dark:text-white text-sm"
                  title="Load a saved deck from the cloud"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  Load Deck
                </button>
              )}
              
              <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
              
              {/* Generate Section */}
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
              <button
                onClick={() => {
                  setShowGenerateImageModal(true);
                  setShowMenu(false);
                }}
                className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-900 dark:text-white text-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Generate Image
              </button>
              
              {isAuthenticated && (
                <>
                  <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
                  <button
                    onClick={() => {
                      setShowDeleteDeckModal(true);
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-red-600 dark:text-red-400 text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete Deck
                  </button>
                </>
              )}
            </div>
          )}
          </div>
          </div>
        </div>
      </div>

      {/* ...existing code... */}
      {/* Tabs - Hide when expanded (full screen view) */}
      {!isExpanded && (
      <div className="flex-shrink-0 flex items-center border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
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
          onMouseEnter={() => setShowValidationTooltip(true)}
          onMouseLeave={() => setShowValidationTooltip(false)}
          className={`relative flex-1 px-3 py-3 text-sm font-medium transition-colors ${
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
              >
                {validation.isValid ? "✓" : "!"}
              </span>
            )}
          </span>
          
          {/* Validation Tooltip */}
          {showValidationTooltip && validation.stats.totalCards > 0 && (
            <div className={`absolute left-1/2 -translate-x-1/2 top-full mt-2 w-72 p-4 rounded-lg shadow-xl z-50 pointer-events-none ${
              validation.isValid
                ? "bg-green-50 dark:bg-green-900/90 border-2 border-green-300 dark:border-green-600"
                : "bg-red-50 dark:bg-red-900/90 border-2 border-red-300 dark:border-red-600"
            }`}>
              {/* Arrow */}
              <div className={`absolute left-1/2 -translate-x-1/2 bottom-full w-0 h-0 border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent ${
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
        </button>
        
        {/* View Dropdown Button */}
        <div className="relative ml-auto mr-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowViewDropdown(!showViewDropdown);
            }}
            className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            View
            <svg className={`w-3 h-3 transition-transform ${showViewDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {showViewDropdown && (
            <div className="absolute top-full mt-1 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-2 z-50 min-w-[220px]">
              {/* Layout Section */}
              <div className="px-3 py-2">
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                  Layout
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewLayout('grid');
                    }}
                    className={`flex-1 p-2 rounded flex flex-col items-center gap-1 transition-colors ${
                      viewLayout === 'grid'
                        ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                    title="Grid view"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                    <span className="text-xs font-medium">Grid</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewLayout('list');
                    }}
                    className={`flex-1 p-2 rounded flex flex-col items-center gap-1 transition-colors ${
                      viewLayout === 'list'
                        ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                    title="List view"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="text-xs font-medium">List</span>
                  </button>
                </div>
              </div>
              
              <div className="border-t border-gray-200 dark:border-gray-700 my-2"></div>

              {/* Card Hover Preview Toggle */}
              <div className="px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Card Hover Preview</span>
                <Switch
                  checked={!disableHoverPreview}
                  onChange={() => setDisableHoverPreview((v) => !v)}
                  className={`${!disableHoverPreview ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-700'} relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${!disableHoverPreview ? 'translate-x-5' : 'translate-x-1'}`}
                  />
                </Switch>
              </div>
              {/* Divider for new section */}
              <div className="border-t border-gray-200 dark:border-gray-700 my-2"></div>
              
              {/* Group By Section */}
              <div className="px-3 py-2">
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                  Group by
                </div>
                <div className="space-y-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setGroupBy('type');
                    }}
                    className={`w-full px-3 py-2 text-left text-sm rounded transition-colors flex items-center justify-between ${
                      groupBy === 'type'
                        ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    <span>Type</span>
                    {groupBy === 'type' && (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setGroupBy('alignment');
                    }}
                    className={`w-full px-3 py-2 text-left text-sm rounded transition-colors flex items-center justify-between ${
                      groupBy === 'alignment'
                        ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    <span>Alignment</span>
                    {groupBy === 'alignment' && (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4" data-deck-grid>
        {/* Paragon Requirements (only show for Paragon format with a selected Paragon) */}
        {deckType === 'Paragon' && deck.paragon && validation.paragonStats && (
          <div className="mb-4">
            <div className="p-4 bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border-2 border-purple-300 dark:border-purple-600 rounded-xl shadow-md">
              <div className="flex items-start gap-4">
                {/* Paragon Card Artwork - Click to Expand */}
                <div 
                  className="relative group w-32 h-40 rounded-lg shadow-xl flex-shrink-0 cursor-pointer hover:scale-105 hover:shadow-2xl transition-transform overflow-hidden bg-gray-200 dark:bg-gray-700 border-2 border-white dark:border-gray-600"
                  onClick={() => setShowParagonModal(true)}
                  title="Click to view full card"
                >
                  <img 
                    src={`/paragons/Paragon ${deck.paragon}.png`}
                    alt={deck.paragon}
                    className="w-full h-full object-cover object-[1%_center]"
                    onError={(e) => {
                      // Hide container if image doesn't exist
                      e.currentTarget.parentElement!.style.display = 'none';
                    }}
                  />
                  {/* Click Indicator Icon - Bottom Left */}
                  <div className="absolute bottom-2 left-2 bg-white/90 dark:bg-purple-600/90 rounded-full p-1.5 shadow-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-purple-600 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                    </svg>
                  </div>
                </div>
                
                {/* Paragon Requirements */}
                <div className="flex-1 min-w-0">
                  <ParagonRequirements
                    paragonName={deck.paragon}
                    stats={validation.paragonStats}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Show Full Deck View when expanded */}
        {isExpanded ? (
          <FullDeckView 
            deck={deck}
            onViewCard={onViewCard}
          />
        ) : (
          <>
        {activeTab === "main" ? (
          <div className="space-y-4">
            {mainDeckCards.length > 0 ? (
              groupCards(mainDeckCards).map(({ type, cards, count }) => {
                const typeIcon = groupBy === 'type' ? getTypeIcon(type) : null;
                const dualIconConfig = groupBy === 'type' ? getDualIconConfig(type) : null;
                return (
                <div key={type}>
                  <div className="flex items-center gap-2 mb-2">
                    {dualIconConfig ? (
                      <div className="flex gap-0.5 flex-shrink-0">
                        <img 
                          src={dualIconConfig.icon1} 
                          alt={dualIconConfig.alt1}
                          className="w-6 h-6 object-contain"
                        />
                        <img 
                          src={dualIconConfig.icon2} 
                          alt={dualIconConfig.alt2}
                          className="w-6 h-6 object-contain"
                        />
                      </div>
                    ) : typeIcon && (
                      <img 
                        src={typeIcon} 
                        alt={type}
                        className="w-6 h-6 object-contain flex-shrink-0"
                      />
                    )}
                    <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                      {groupBy === 'type' ? prettifyTypeName(type) : type} ({count})
                    </h4>
                  </div>
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
                    showTypeIcons={false}
                    viewLayout={viewLayout}
                    disableHoverPreview={disableHoverPreview}
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
              groupCards(reserveCards).map(({ type, cards, count }) => {
                const typeIcon = groupBy === 'type' ? getTypeIcon(type) : null;
                const dualIconConfig = groupBy === 'type' ? getDualIconConfig(type) : null;
                return (
                <div key={type}>
                  <div className="flex items-center gap-2 mb-2">
                    {dualIconConfig ? (
                      <div className="flex gap-0.5 flex-shrink-0">
                        <img 
                          src={dualIconConfig.icon1} 
                          alt={dualIconConfig.alt1}
                          className="w-6 h-6 object-contain"
                        />
                        <img 
                          src={dualIconConfig.icon2} 
                          alt={dualIconConfig.alt2}
                          className="w-6 h-6 object-contain"
                        />
                      </div>
                    ) : typeIcon && (
                      <img 
                        src={typeIcon} 
                        alt={type}
                        className="w-6 h-6 object-contain flex-shrink-0"
                      />
                    )}
                    <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                      {groupBy === 'type' ? prettifyTypeName(type) : type} ({count})
                    </h4>
                  </div>
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
                    showTypeIcons={false}
                    viewLayout={viewLayout}
                    disableHoverPreview={disableHoverPreview}
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
            {/* Disclaimer - Hide for Paragon format */}
            {deckType !== 'Paragon' && (
              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  <p className="text-xs text-blue-800 dark:text-blue-200">
                    Not all deckbuilding checks are implemented, just the basic ones. Please refer to the{' '}
                    <a 
                      href="https://landofredemption.com/wp-content/uploads/2024/10/Deck_Building_Rules_1.2.pdf"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold underline hover:text-blue-600 dark:hover:text-blue-300 transition-colors"
                    >
                      official deck building rules
                    </a>
                    {' '}to ensure the legality of your deck.
                  </p>
                </div>
              </div>
            )}

            {/* Paragon Resources - Only show for Paragon format */}
            {deckType === 'Paragon' && (
              <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
                <div className="flex items-start gap-2 mb-2">
                  <svg className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  <div className="flex-1">
                    <h4 className="text-xs font-semibold text-purple-800 dark:text-purple-200 mb-2">
                      Paragon Format Resources
                    </h4>
                    <div className="space-y-1">
                      <a 
                        href="https://landofredemption.com/wp-content/uploads/2025/11/Paragon-Format-Paragons-v1.pdf"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-purple-700 dark:text-purple-300 hover:text-purple-600 dark:hover:text-purple-200 underline transition-colors"
                      >
                        Paragon Cards PDF
                      </a>
                      <a 
                        href="https://landofredemption.com/wp-content/uploads/2025/11/Paragon-Format-Rules-v1.pdf"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-purple-700 dark:text-purple-300 hover:text-purple-600 dark:hover:text-purple-200 underline transition-colors"
                      >
                        Paragon Rules PDF
                      </a>
                      <a 
                        href="https://landofredemption.com/wp-content/uploads/2025/11/Paragon-Format-Lost-Souls-Color-v1.pdf"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-purple-700 dark:text-purple-300 hover:text-purple-600 dark:hover:text-purple-200 underline transition-colors"
                      >
                        Lost Souls (Color) PDF
                      </a>
                      <a 
                        href="https://landofredemption.com/wp-content/uploads/2025/11/Paragon-Format-Lost-Souls-BW-v1.pdf"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-purple-700 dark:text-purple-300 hover:text-purple-600 dark:hover:text-purple-200 underline transition-colors"
                      >
                        Lost Souls (B&W) PDF
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
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
                    <span className="text-green-700 dark:text-green-400">✓ Passed Basic Checks</span>
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

            {/* Alignment Breakdown */}
            <div>
              <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Alignment Breakdown
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {(() => {
                  // Calculate alignment counts
                  const alignmentCounts = deck.cards.reduce((acc, deckCard) => {
                    let alignment = deckCard.card.alignment || "Neutral";
                    // Treat "Good/Evil" cards as Neutral
                    if (alignment.includes("Good/Evil")) {
                      alignment = "Neutral";
                    }
                    if (!acc[alignment]) {
                      acc[alignment] = 0;
                    }
                    acc[alignment] += deckCard.quantity;
                    return acc;
                  }, {} as Record<string, number>);
                  
                  // Define order and styling for alignments
                  const alignmentConfig = [
                    { name: 'Good', color: 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200' },
                    { name: 'Evil', color: 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-800 dark:text-red-200' },
                    { name: 'Neutral', color: 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200' },
                    { name: 'Dual', color: 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700 text-purple-800 dark:text-purple-200' },
                  ];
                  
                  return alignmentConfig.map(({ name, color }) => {
                    const count = alignmentCounts[name] || 0;
                    if (count === 0 && name === 'Dual') return null; // Hide Dual if 0
                    
                    return (
                      <div
                        key={name}
                        className={`p-3 rounded-lg border-2 ${color}`}
                      >
                        <div className="text-xs font-semibold uppercase tracking-wide mb-1">
                          {name}
                        </div>
                        <div className="text-2xl font-bold">
                          {count}
                        </div>
                      </div>
                    );
                  });
                })()}
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
                
                {/* Card Type Breakdown */}
                <div className="border-t border-gray-200 dark:border-gray-700 my-2 pt-2">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                    Card Types
                  </div>
                  <div className="space-y-0.5">
                    {(() => {
                      // Calculate card type counts
                      const typeCounts = deck.cards.reduce((acc, deckCard) => {
                        const type = deckCard.card.type || "Unknown";
                        const prettyType = prettifyTypeName(type);
                        if (!acc[prettyType]) {
                          acc[prettyType] = 0;
                        }
                        acc[prettyType] += deckCard.quantity;
                        return acc;
                      }, {} as Record<string, number>);
                      
                      // Sort by count (descending) then by name
                      const sortedTypes = Object.entries(typeCounts)
                        .sort(([nameA, countA], [nameB, countB]) => {
                          if (countB !== countA) return countB - countA;
                          return nameA.localeCompare(nameB);
                        });
                      
                      return sortedTypes.map(([type, count]) => (
                        <div key={type} className="flex justify-between gap-2 text-sm">
                          <span className="flex-shrink-0">{type}:</span>
                          <span className="font-medium ml-auto">{count}</span>
                        </div>
                      ));
                    })()}
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
        </>
        )}
      </div>

      {/* Generate PDF Modal */}
      {showGeneratePDFModal && (
        <GeneratePDFModal
          deck={deck}
          onClose={() => setShowGeneratePDFModal(false)}
        />
      )}

      {/* Generate Image Modal */}
      {showGenerateImageModal && (
        <GenerateDeckImageModal
          deck={deck}
          onClose={() => setShowGenerateImageModal(false)}
        />
      )}

      {/* Delete Deck Modal */}
      {showDeleteDeckModal && onNewDeck && (
        <ClearDeckModal
          deckName={deck.name}
          onConfirm={() => {
            onNewDeck(undefined, deck.folderId);
            setShowDeleteDeckModal(false);
          }}
          onClose={() => setShowDeleteDeckModal(false)}
        />
      )}

      {/* Load Deck Modal */}
      {showLoadDeckModal && onLoadDeck && (
        <LoadDeckModal
          onLoadDeck={onLoadDeck}
          onClose={() => setShowLoadDeckModal(false)}
        />
      )}

      {/* Paragon Card Modal */}
      {showParagonModal && deck.paragon && (
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowParagonModal(false)}
        >
          <div 
            className="relative max-w-4xl w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setShowParagonModal(false)}
              className="absolute -top-4 -right-4 w-10 h-10 bg-white dark:bg-gray-800 rounded-full shadow-lg flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors z-10"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            {/* Paragon Card Image - Full Size */}
            <img 
              src={`/paragons/Paragon ${deck.paragon}.png`}
              alt={deck.paragon}
              className="w-full h-auto rounded-lg shadow-2xl"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
        </div>
      )}

      {/* Hidden image preloader for reserve cards */}
      <div className="hidden" aria-hidden="true">
        {reserveCards.map((deckCard) => {
          const imageUrl = (() => {
            const { getImageUrl } = useCardImageUrl();
            return getImageUrl(deckCard.card.imgFile || "");
          })();
          return imageUrl ? (
            <img
              key={`preload-${deckCard.card.name}-${deckCard.card.set}`}
              src={imageUrl}
              alt=""
              loading="eager"
            />
          ) : null;
        })}
      </div>
    </div>
  );
}
