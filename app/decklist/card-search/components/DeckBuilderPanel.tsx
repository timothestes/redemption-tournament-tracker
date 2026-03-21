import React, { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
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
import { duplicateDeckAction, toggleDeckPublicAction, loadGlobalTagsAction, updateDeckTagsAction, GlobalTag } from "../../actions";
import { createGlobalTagAction } from "../../../admin/tags/actions";
import { HexColorPicker } from "react-colorful";
import { GoldfishButton } from "../../../goldfish/components/GoldfishButton";
import { useIsAdmin } from "../../../../hooks/useIsAdmin";
import UsernameModal from "../../my-decks/UsernameModal";
import { getParagonNames, getParagonByName } from "../data/paragons";
import { useCardPrices } from "../hooks/useCardPrices";
import ParagonRequirements from "./ParagonRequirements";
import { useCardImageUrl } from "../hooks/useCardImageUrl";
import ReactMarkdown from "react-markdown";
import BuyDeckModal, { BuyDeckCard } from "./BuyDeckModal";
import DeckLegalityChecklist from "./DeckLegalityChecklist";
import type { DeckCheckResult } from "@/utils/deckcheck/types";

function getTagContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#1f2937" : "#ffffff";
}

export type TabType = "main" | "reserve" | "info" | "cover";

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
  /** Callback to toggle expanded/fullscreen mode */
  onToggleExpand?: () => void;
  /** Callback when deck name changes */
  onDeckNameChange: (name: string) => void;
  /** Callback when deck format changes */
  onDeckFormatChange?: (format: string) => void;
  /** Callback when Paragon changes */
  onParagonChange?: (paragon: string | undefined) => void;
  /** Callback when deck public status changes */
  onDeckPublicChange?: (isPublic: boolean) => void;
  /** Callback to save deck to cloud */
  onSaveDeck?: () => Promise<{ success: boolean; error?: string }>;
  /** Callback to add a card */
  onAddCard: (cardName: string, cardSet: string, isReserve: boolean) => void;
  /** Callback to remove a card */
  onRemoveCard: (cardName: string, cardSet: string, isReserve: boolean) => void;
  /** Callback to export deck (copy to clipboard) */
  onExport: () => void;
  /** Callback to download deck as .txt file */
  onDownload?: () => void;
  /** Callback to import deck - parent handles UI */
  onImport: () => void;
  /** Callback to delete deck */
  onDelete: () => void;
  /** Callback to duplicate current deck */
  onDuplicate?: () => void;
  /** Callback to load a deck from cloud by ID */
  onLoadDeck?: (deckId: string) => void;
  /** Callback to create a new blank deck */
  onNewDeck?: (name?: string, folderId?: string | null, skipConfirmation?: boolean) => void;
  /** Callback when active tab changes */
  onActiveTabChange?: (tab: TabType) => void;
  /** Callback when user wants to view card details */
  onViewCard?: (card: Card, isReserve?: boolean) => void;
  /** Callback to show notifications */
  onNotify?: (message: string, type: 'success' | 'error' | 'info') => void;
  /** Callback when user changes cover card selections */
  onPreviewCardsChange?: (card1: string | null, card2: string | null) => void;
  /** Callback when user changes deck description */
  onDescriptionChange?: (description: string) => void;
  /** Force-disable hover previews (e.g. on mobile) */
  forceDisableHoverPreview?: boolean;
  /** Default tab to show when panel mounts (persists across mobile drawer open/close) */
  defaultTab?: TabType;
  /** Server-side deck check result */
  deckCheckResult?: DeckCheckResult | null;
  /** Whether a deck check is currently in progress */
  isDeckChecking?: boolean;
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
  onToggleExpand,
  onDeckNameChange,
  onDeckFormatChange,
  onParagonChange,
  onDeckPublicChange,
  onSaveDeck,
  onAddCard,
  onRemoveCard,
  onExport,
  onDownload,
  onImport,
  onDelete,
  onDuplicate,
  onLoadDeck,
  onNewDeck,
  onActiveTabChange,
  onViewCard,
  onNotify,
  onPreviewCardsChange,
  onDescriptionChange,
  forceDisableHoverPreview = false,
  defaultTab,
  deckCheckResult,
  isDeckChecking,
}: DeckBuilderPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>(defaultTab ?? "main");
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(deck.name);
  const [showMenu, setShowMenu] = useState(false);
  const [showGeneratePDFModal, setShowGeneratePDFModal] = useState(false);
  const [showGenerateImageModal, setShowGenerateImageModal] = useState(false);
  const [showDeleteDeckModal, setShowDeleteDeckModal] = useState(false);
  const [showLoadDeckModal, setShowLoadDeckModal] = useState(false);
  const [showBuyDeckModal, setShowBuyDeckModal] = useState(false);
  const [showValidationTooltip, setShowValidationTooltip] = useState(false);
  const [showViewDropdown, setShowViewDropdown] = useState(false);
  const viewDropdownBtnRef = useRef<HTMLButtonElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<TabType, HTMLButtonElement | null>>({ main: null, reserve: null, info: null, cover: null });
  const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0 });
  const [showMobileFullDeckView, setShowMobileFullDeckView] = useState(false);
  const [fullViewPreviewCard, setFullViewPreviewCard] = useState<Card | null>(null);
  const [showParagonDropdown, setShowParagonDropdown] = useState(false);
  const [showParagonModal, setShowParagonModal] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  
  const { getImageUrl } = useCardImageUrl();

  // Cover card picker: which slot is open (1, 2, or null)
  const [coverPickerSlot, setCoverPickerSlot] = useState<1 | 2 | null>(null);
  const [coverPickerSort, setCoverPickerSort] = useState<"default" | "name" | "type" | "brigade">("type");
  const [coverPickerSearch, setCoverPickerSearch] = useState("");

  // Measure active tab position for sliding indicator
  useEffect(() => {
    const tab = tabRefs.current[activeTab];
    const bar = tabBarRef.current;
    if (tab && bar) {
      const barRect = bar.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      setTabIndicator({ left: tabRect.left - barRect.left, width: tabRect.width });
    }
  }, [activeTab]);

  // Close cover picker on Escape
  useEffect(() => {
    if (coverPickerSlot === null) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setCoverPickerSlot(null);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [coverPickerSlot]);

  // Description preview mode
  const [descriptionPreview, setDescriptionPreview] = useState(false);

  // Tags
  const { isAdmin, permissions } = useIsAdmin();
  const canManageTags = isAdmin && permissions.includes('manage_tags');
  const [deckTags, setDeckTags] = useState<GlobalTag[]>([]);
  const [allGlobalTags, setAllGlobalTags] = useState<GlobalTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [savingTags, setSavingTags] = useState(false);
  const tagPickerRef = useRef<HTMLDivElement>(null);
  const [tagsBarContainer, setTagsBarContainer] = useState<HTMLDivElement | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createColor, setCreateColor] = useState("#6366f1");
  const [createColorOpen, setCreateColorOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadAllTags = useCallback(async () => {
    setTagsLoading(true);
    const res = await loadGlobalTagsAction();
    if (res.success) setAllGlobalTags(res.tags);
    setTagsLoading(false);
  }, []);

  // Load global tags list when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    loadAllTags();
  }, [isAuthenticated, loadAllTags]);

  // Retry loading tags when the picker opens and the list is empty (handles race/failure)
  useEffect(() => {
    if (tagPickerOpen && isAuthenticated && allGlobalTags.length === 0 && !tagsLoading) {
      loadAllTags();
    }
  }, [tagPickerOpen, isAuthenticated, allGlobalTags.length, tagsLoading, loadAllTags]);

  // Load this deck's current tags when the deck ID changes
  useEffect(() => {
    if (!deck.id || !isAuthenticated) { setDeckTags([]); return; }
    // Tags were already joined in loadPublicDeckAction/loadDeckByIdAction,
    // but in the builder we load them separately since we get the deck differently.
    import("../../actions").then(({ loadGlobalTagsAction: _ }) => {});
    // Fetch deck tags directly
    import("../../../../utils/supabase/client").then(({ createClient }) => {
      const supabase = createClient();
      supabase
        .from("deck_tags")
        .select("tag_id, global_tags(id, name, color)")
        .eq("deck_id", deck.id!)
        .then(({ data }) => {
          const tags = (data || []).map((r: any) => r.global_tags).filter(Boolean);
          setDeckTags(tags);
        });
    });
  }, [deck.id, isAuthenticated]);

  // Close tag picker on outside click
  useEffect(() => {
    if (!tagPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (tagPickerRef.current && !tagPickerRef.current.contains(e.target as Node)) {
        setTagPickerOpen(false);
        setTagFilter("");
        setCreateMode(false);
        setCreateError(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [tagPickerOpen]);

  const toggleTag = useCallback(async (tag: GlobalTag) => {
    if (!deck.id) return;
    const isSelected = deckTags.some((t) => t.id === tag.id);
    const next = isSelected ? deckTags.filter((t) => t.id !== tag.id) : [...deckTags, tag];
    setDeckTags(next);
    setSavingTags(true);
    await updateDeckTagsAction(deck.id, next.map((t) => t.id));
    setSavingTags(false);
  }, [deckTags, deck.id]);

  const filteredGlobalTags = allGlobalTags.filter((t) =>
    t.name.toLowerCase().includes(tagFilter.toLowerCase())
  );

  async function handleCreateTagInBuilder(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim() || !deck.id) return;
    setCreateError(null);
    setCreating(true);
    const res = await createGlobalTagAction(createName.trim(), createColor);
    setCreating(false);
    if (!res.success) { setCreateError(res.error || "Failed to create tag"); return; }
    const newTag = res.tag as GlobalTag;
    setAllGlobalTags((prev) => [...prev, newTag].sort((a, b) => a.name.localeCompare(b.name)));
    const next = [...deckTags, newTag];
    setDeckTags(next);
    setSavingTags(true);
    await updateDeckTagsAction(deck.id, next.map((t) => t.id));
    setSavingTags(false);
    setCreateMode(false);
    setCreateName("");
    setCreateColor("#6366f1");
    setCreateColorOpen(false);
    setCreateError(null);
    setTagFilter("");
  }

  // View options
  const [viewLayout, setViewLayout] = useState<'grid' | 'list'>('grid');

  // Swipe-to-dismiss for mobile bottom sheet
  const sheetTouchRef = useRef<{ startY: number; currentY: number } | null>(null);
  const [sheetTranslateY, setSheetTranslateY] = useState(0);

  const [groupBy, setGroupBy] = useState<'type' | 'alignment'>('type');

  // Expanded (FullDeckView) view options
  const [expandedViewMode, setExpandedViewMode] = useState<'normal' | 'stacked'>('stacked');
  const [expandedGroupBy, setExpandedGroupBy] = useState<'none' | 'alignment' | 'type'>('type');
  const [disableHoverPreview, setDisableHoverPreview] = useState(forceDisableHoverPreview);
  
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
      'Pale Green': '#bfdb9e', // pale green color
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
  const contentRef = useRef<HTMLDivElement>(null);
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    onActiveTabChange?.(tab);
    // Scroll content area to top when switching tabs
    contentRef.current?.scrollTo(0, 0);
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

  // Calculate total deck price
  const { getPrice } = useCardPrices();
  const totalDeckPrice = React.useMemo(() => {
    let total = 0;
    let hasAnyPrice = false;
    for (const dc of deck.cards) {
      const priceKey = `${dc.card.name}|${dc.card.set}|${dc.card.imgFile}`;
      const priceInfo = getPrice(priceKey);
      if (priceInfo) {
        total += priceInfo.price * dc.quantity;
        hasAnyPrice = true;
      }
    }
    return hasAnyPrice ? total : null;
  }, [deck.cards, getPrice]);

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
      // Move one copy from current location to new location
      onRemoveCard(cardName, cardSet, fromReserve);
      onAddCard(cardName, cardSet, toReserve);
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
    <div className="w-full h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2 md:p-4 border-b border-gray-200/60 dark:border-gray-700/60 overflow-visible relative z-30">
        {/* Deck Name + Counts Row */}
        {isEditingName ? (
          <input
            type="text"
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={handleNameKeyDown}
            className="w-full text-lg md:text-xl font-semibold px-2 py-1 rounded border border-ring bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <h2
              className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate min-w-0 flex-shrink"
              onClick={() => {
                setIsEditingName(true);
                setEditedName(deck.name);
              }}
              title="Click to edit deck name"
              suppressHydrationWarning
            >
              {deck.name}
            </h2>
            {deck.id && (
              <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                deck.isPublic
                  ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                  : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
              }`}>
                {deck.isPublic ? "Public" : "Private"}
              </span>
            )}
            {totalDeckPrice !== null && (
              <button
                onClick={() => setShowBuyDeckModal(true)}
                className="md:hidden flex-shrink-0 text-sm font-semibold text-green-600 dark:text-green-400 flex items-center gap-1 hover:underline"
                title="Buy deck on YTG"
              >
                <img src="/sponsors/ytg-dark.png" alt="" className="h-3.5 w-3.5 object-contain hidden dark:block" />
                <img src="/sponsors/ytg-light.png" alt="" className="h-3.5 w-3.5 object-contain dark:hidden" />
                ${totalDeckPrice.toFixed(2)}
              </button>
            )}
            <span className="hidden md:flex items-center gap-1 text-xs whitespace-nowrap ml-auto flex-shrink-0" suppressHydrationWarning>
              <span className="text-gray-500 dark:text-gray-400">{mainDeckCount}</span>
              {reserveCount > 0 && (
                <>
                  <span className="text-gray-400 dark:text-gray-600">/</span>
                  <span className="text-gray-500 dark:text-gray-400">{reserveCount}</span>
                </>
              )}
              <span className="text-gray-400 dark:text-gray-600">=</span>
              <span className="font-semibold text-gray-700 dark:text-gray-300">{totalCards}</span>
              {totalDeckPrice !== null && (
                <>
                  <span className="text-gray-400 dark:text-gray-600 ml-1">·</span>
                  <button
                    onClick={() => setShowBuyDeckModal(true)}
                    className="text-green-600 dark:text-green-400 font-medium hover:underline inline-flex items-center gap-0.5"
                    title="Buy deck on YTG"
                  >
                    <img src="/sponsors/ytg-dark.png" alt="" className="h-3 w-3 object-contain hidden dark:block" />
                    <img src="/sponsors/ytg-light.png" alt="" className="h-3 w-3 object-contain dark:hidden" />
                    ${totalDeckPrice.toFixed(2)}
                  </button>
                </>
              )}
            </span>
          </div>
        )}

        {/* Mobile: Unified toolbar — format selector left, actions right */}
        <div className="md:hidden mt-1.5 flex items-center gap-1.5">
          {/* Format Selector (T1/T2/Paragon) */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-full p-0.5">
            <button
              onClick={() => handleDeckTypeChange('T1')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                deckType === 'T1'
                  ? 'bg-blue-600 dark:bg-blue-500 text-white'
                  : 'text-gray-600 dark:text-gray-400 cursor-pointer'
              }`}
            >
              T1
            </button>
            <button
              onClick={() => handleDeckTypeChange('T2')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                deckType === 'T2'
                  ? 'bg-purple-600 dark:bg-purple-500 text-white'
                  : 'text-gray-600 dark:text-gray-400 cursor-pointer'
              }`}
            >
              T2
            </button>
            <button
              onClick={() => handleDeckTypeChange('Paragon')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                deckType === 'Paragon'
                  ? 'bg-amber-600 dark:bg-amber-500 text-white'
                  : 'text-gray-600 dark:text-gray-400 cursor-pointer'
              }`}
            >
              P
            </button>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Action icons — tight row */}
          <div className="flex items-center gap-1">
            {/* Save */}
            {onSaveDeck && isAuthenticated && (
              <button
                onClick={async () => {
                  const result = await onSaveDeck();
                  if (!result.success && result.error) {
                    onNotify?.(result.error, 'error');
                  }
                }}
                disabled={syncStatus?.isSaving || !isAuthenticated}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                  syncStatus?.isSaving
                    ? 'text-gray-400 dark:text-gray-500'
                    : hasUnsavedChanges
                    ? 'bg-green-600 text-white shadow-sm'
                    : 'text-gray-400 dark:text-gray-500'
                }`}
                title={hasUnsavedChanges ? 'Save deck' : 'All changes saved'}
              >
                {syncStatus?.isSaving ? (
                  <svg className="w-4.5 h-4.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : hasUnsavedChanges ? (
                  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                ) : (
                  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            )}

            {/* New Deck */}
            {onNewDeck && (
              <button
                onClick={() => onNewDeck(undefined, deck.folderId)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-600 transition-colors"
                title="New deck"
              >
                <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
            )}

            {/* Practice */}
            {deck.id && (
              <GoldfishButton deckId={deck.id} deckName={deck.name} format={deck.format} iconOnly />
            )}

            {/* More menu */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 transition-colors"
                title="More options"
              >
                <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-[40]" onClick={() => setShowMenu(false)} />
                  <div
                    className="absolute top-full right-0 mt-1 z-[50] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[180px] max-h-[70vh] overflow-y-auto"
                  >
                  <button
                    onClick={() => { onImport(); setShowMenu(false); }}
                    className="w-full px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2.5 text-gray-900 dark:text-white text-sm"
                  >
                    <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Import
                  </button>
                  <button
                    onClick={() => { onExport(); setShowMenu(false); }}
                    className="w-full px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2.5 text-gray-900 dark:text-white text-sm"
                  >
                    <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                    Copy to Clipboard
                  </button>
                  {onDownload && (
                    <button
                      onClick={() => { onDownload(); setShowMenu(false); }}
                      className="w-full px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2.5 text-gray-900 dark:text-white text-sm"
                    >
                      <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download .txt
                    </button>
                  )}
                  <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                  {onDuplicate && isAuthenticated && deck.id && (
                    <button
                      onClick={async () => {
                        setShowMenu(false);
                        const result = await duplicateDeckAction(deck.id!);
                        if (result.success) {
                          onNotify?.('Deck duplicated successfully!', 'success');
                          if (onLoadDeck && result.deckId) onLoadDeck(result.deckId);
                        } else {
                          onNotify?.(result.error || 'Failed to duplicate deck', 'error');
                        }
                      }}
                      className="w-full px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2.5 text-gray-900 dark:text-white text-sm"
                    >
                      <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Duplicate
                    </button>
                  )}
                  {onLoadDeck && isAuthenticated && (
                    <button
                      onClick={() => { setShowLoadDeckModal(true); setShowMenu(false); }}
                      className="w-full px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2.5 text-gray-900 dark:text-white text-sm"
                    >
                      <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      Load Deck
                    </button>
                  )}
                  {isAuthenticated && deck.id && (
                    <>
                      <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                      <button
                        onClick={async () => {
                          setShowMenu(false);
                          const newPublicState = !deck.isPublic;
                          const result = await toggleDeckPublicAction(deck.id!, newPublicState);
                          if (result.success) {
                            onDeckPublicChange?.(newPublicState);
                            onNotify?.(newPublicState ? 'Deck is now public' : 'Deck is now private', 'success');
                          } else if ((result as any).needsUsername) {
                            setShowUsernameModal(true);
                          } else {
                            onNotify?.(result.error || 'Failed to change visibility', 'error');
                          }
                        }}
                        className="w-full px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2.5 text-gray-900 dark:text-white text-sm"
                      >
                        {deck.isPublic ? (
                          <>
                            <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                            Make Private
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Make Public
                          </>
                        )}
                      </button>
                      {deck.isPublic && (
                        <>
                          <button
                            onClick={() => {
                              const url = `${window.location.origin}/decklist/${deck.id}`;
                              navigator.clipboard.writeText(url);
                              setLinkCopied(true);
                              setTimeout(() => setLinkCopied(false), 2000);
                            }}
                            className="w-full px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2.5 text-gray-900 dark:text-white text-sm"
                          >
                            <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                            {linkCopied ? 'Link Copied!' : 'Copy Share Link'}
                          </button>
                          <a
                            href={`/decklist/${deck.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setShowMenu(false)}
                            className="w-full px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2.5 text-gray-900 dark:text-white text-sm"
                          >
                            <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            View Public Page
                          </a>
                        </>
                      )}
                    </>
                  )}
                  <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                  <button
                    onClick={() => { setShowGeneratePDFModal(true); setShowMenu(false); }}
                    className="w-full px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2.5 text-gray-900 dark:text-white text-sm"
                  >
                    <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Generate PDF
                  </button>
                  <button
                    onClick={() => { setShowGenerateImageModal(true); setShowMenu(false); }}
                    className="w-full px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2.5 text-gray-900 dark:text-white text-sm"
                  >
                    <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Generate Image
                  </button>
                  <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                  {totalDeckPrice !== null && (
                    <button
                      onClick={() => { setShowBuyDeckModal(true); setShowMenu(false); }}
                      className="w-full px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2.5 text-gray-900 dark:text-white text-sm"
                    >
                      <img src="/sponsors/ytg-dark.png" alt="" className="w-4 h-4 object-contain hidden dark:block" />
                      <img src="/sponsors/ytg-light.png" alt="" className="w-4 h-4 object-contain dark:hidden" />
                      Buy on YTG
                    </button>
                  )}
                  {isAuthenticated && (
                    <>
                      <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                      <button
                        onClick={() => { setShowDeleteDeckModal(true); setShowMenu(false); }}
                        className="w-full px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2.5 text-red-600 dark:text-red-400 text-sm"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete Deck
                      </button>
                    </>
                  )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Mobile: Paragon selector — second row when Paragon format active */}
        {deckType === 'Paragon' && (
          <div className="md:hidden mt-1 relative">
            <button
              onClick={() => setShowParagonDropdown(!showParagonDropdown)}
              className="w-full text-xs px-2.5 py-1.5 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg text-amber-900 dark:text-amber-100 font-medium flex items-center gap-1.5 justify-between"
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
                            />
                            <span
                              className="w-3 h-3 rounded-sm border border-black"
                              style={{ backgroundColor: getBrigadeColor(paragonData.evilBrigade) }}
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
                <span className="text-amber-700 dark:text-amber-300">Choose Paragon...</span>
              )}
              <svg className={`w-3 h-3 transition-transform ${showParagonDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showParagonDropdown && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto">
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
                      className={`w-full px-3 py-2 text-left text-xs hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors flex items-center gap-2 ${
                        deck.paragon === name ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-100' : 'text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {paragonData && (
                        <span className="flex gap-0.5 flex-shrink-0">
                          <span
                            className="w-3 h-3 rounded-sm border border-black"
                            style={{ backgroundColor: getBrigadeColor(paragonData.goodBrigade) }}
                          />
                          <span
                            className="w-3 h-3 rounded-sm border border-black"
                            style={{ backgroundColor: getBrigadeColor(paragonData.evilBrigade) }}
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

        {/* Card Count and Menu Button Row — desktop only */}
        <div className="hidden md:flex mt-2 flex-col md:flex-row md:items-center md:justify-between gap-3 min-w-0">
          <div className="flex items-center gap-2 md:gap-3 text-sm flex-wrap min-w-0" suppressHydrationWarning>
            {/* Desktop: Format Selector (T1/T2/Paragon) */}
            <div className="hidden md:flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-full p-0.5">
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
                    ? 'bg-purple-600 dark:bg-purple-500 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 cursor-pointer'
                }`}
              >
                T2
              </button>
              <button
                onClick={() => handleDeckTypeChange('Paragon')}
                className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                  deckType === 'Paragon'
                    ? 'bg-amber-600 dark:bg-amber-500 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 cursor-pointer'
                }`}
              >
                Paragon
              </button>
            </div>

            {/* Desktop: Paragon Selector (only show for Paragon format) */}
            {deckType === 'Paragon' && (
              <div className="hidden md:flex relative items-center gap-1">
                <span className="text-gray-600 dark:text-gray-400 text-xs">Paragon:</span>
                <button
                    onClick={() => setShowParagonDropdown(!showParagonDropdown)}
                    className="text-xs px-2 py-0.5 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded text-amber-900 dark:text-amber-100 font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 flex items-center gap-1.5 min-w-[180px] justify-between"
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
                      <span className="text-amber-700 dark:text-amber-300">Choose a Paragon...</span>
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
                            className={`w-full px-3 py-2 text-left text-xs hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors flex items-center gap-2 ${
                              deck.paragon === name ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-100' : 'text-gray-700 dark:text-gray-300'
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

          {/* Action Buttons — desktop only (mobile has unified toolbar) */}
          <div className="hidden md:flex items-center gap-2 flex-shrink-0 flex-wrap">
            {/* Save Button - desktop only (mobile save is in the format selector row) */}
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
                  }
                }}
                disabled={syncStatus?.isSaving || !isAuthenticated}
                className={`hidden md:flex px-4 py-1.5 text-sm font-medium rounded transition-all items-center gap-2 min-w-[140px] justify-center ${
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
                <span className="hidden md:inline">New Deck</span>
              </button>
            )}

            {/* Practice Button */}
            {deck.id && (
              <GoldfishButton deckId={deck.id} deckName={deck.name} format={deck.format} iconOnly />
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
              <div className="absolute top-full mt-1 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-50 min-w-[160px] max-h-[70vh] overflow-y-auto">
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
                title="Copy deck to clipboard (Ctrl+E / Cmd+E)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
                Copy to Clipboard
              </button>
              {onDownload && (
                <button
                  onClick={() => {
                    onDownload();
                    setShowMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-900 dark:text-white text-sm"
                  title="Download deck as .txt file"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download .txt
                </button>
              )}
              
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
              
              {/* Sharing Section */}
              {isAuthenticated && deck.id && (
                <>
                  <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
                  <button
                    onClick={async () => {
                      setShowMenu(false);
                      const newPublicState = !deck.isPublic;
                      const result = await toggleDeckPublicAction(deck.id!, newPublicState);
                      if (result.success) {
                        onDeckPublicChange?.(newPublicState);
                        onNotify?.(newPublicState ? 'Deck is now public' : 'Deck is now private', 'success');
                      } else if ((result as any).needsUsername) {
                        setShowUsernameModal(true);
                      } else {
                        onNotify?.(result.error || 'Failed to change visibility', 'error');
                      }
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-900 dark:text-white text-sm"
                  >
                    {deck.isPublic ? (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        Make Private
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Make Public
                      </>
                    )}
                  </button>
                  {deck.isPublic && (
                    <>
                      <button
                        onClick={() => {
                          const url = `${window.location.origin}/decklist/${deck.id}`;
                          navigator.clipboard.writeText(url);
                          setLinkCopied(true);
                          setTimeout(() => setLinkCopied(false), 2000);
                        }}
                        className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-900 dark:text-white text-sm"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        {linkCopied ? 'Link Copied!' : 'Copy Share Link'}
                      </button>
                      <a
                        href={`/decklist/${deck.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setShowMenu(false)}
                        className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-900 dark:text-white text-sm"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        View Public Page
                      </a>
                    </>
                  )}
                </>
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
              <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
              {totalDeckPrice !== null && (
                <button
                  onClick={() => { setShowBuyDeckModal(true); setShowMenu(false); }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-900 dark:text-white text-sm"
                >
                  <img src="/sponsors/ytg-dark.png" alt="" className="w-4 h-4 object-contain hidden dark:block" />
                  <img src="/sponsors/ytg-light.png" alt="" className="w-4 h-4 object-contain dark:hidden" />
                  Buy on YTG
                </button>
              )}

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
      <div ref={tabBarRef} className="flex-shrink-0 flex items-center border-b border-gray-200/60 dark:border-gray-700/60 bg-white dark:bg-gray-800 relative z-20">
        {/* Sliding tab indicator */}
        <div
          className="absolute bottom-0 h-0.5 bg-blue-600 dark:bg-blue-500 transition-all duration-200"
          style={{
            transitionTimingFunction: 'var(--ease-out-quart)',
            width: tabIndicator.width,
            transform: `translateX(${tabIndicator.left}px)`,
          }}
        />
        <button
          ref={(el) => { tabRefs.current.main = el; }}
          onClick={() => handleTabChange("main")}
          className={`flex-1 min-w-0 px-1.5 md:px-3 py-3 text-xs md:text-sm font-medium transition-colors duration-200 whitespace-nowrap text-center ${
            activeTab === "main"
              ? "text-blue-600 dark:text-blue-400"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          <span className="md:hidden">Main <span className="text-[10px] opacity-75">{mainDeckCount}</span></span>
          <span className="hidden md:inline">Main ({mainDeckCount})</span>
        </button>
        <button
          ref={(el) => { tabRefs.current.reserve = el; }}
          onClick={() => handleTabChange("reserve")}
          className={`flex-1 min-w-0 px-1.5 md:px-3 py-3 text-xs md:text-sm font-medium transition-colors duration-200 whitespace-nowrap text-center ${
            activeTab === "reserve"
              ? "text-blue-600 dark:text-blue-400"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          <span className="md:hidden">Res <span className="text-[10px] opacity-75">{reserveCount}</span></span>
          <span className="hidden md:inline">Reserve ({reserveCount})</span>
        </button>
        <button
          ref={(el) => { tabRefs.current.info = el; }}
          onClick={() => handleTabChange("info")}
          onMouseEnter={() => setShowValidationTooltip(true)}
          onMouseLeave={() => setShowValidationTooltip(false)}
          className={`relative flex-1 min-w-0 px-1.5 md:px-3 py-3 text-xs md:text-sm font-medium transition-colors duration-200 whitespace-nowrap text-center ${
            activeTab === "info"
              ? "text-blue-600 dark:text-blue-400"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          <span className="flex items-center justify-center gap-1.5">
            Stats
            {validation.stats.totalCards > 0 && (
              isDeckChecking ? (
                <span className="hidden md:inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-500">
                  <svg className="w-2.5 h-2.5 text-white animate-spin" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
                    <path d="M11 6a5 5 0 00-5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </span>
              ) : (
                <span
                  className={`hidden md:inline-flex items-center justify-center w-4 h-4 text-xs rounded-full ${
                    (deckCheckResult?.valid ?? validation.isValid)
                      ? "bg-green-500 text-white"
                      : "bg-red-500 text-white"
                  }`}
                >
                  {(deckCheckResult?.valid ?? validation.isValid) ? "✓" : "!"}
                </span>
              )
            )}
          </span>

          {/* Validation Tooltip — compact pill, details live in Stats tab */}
          {showValidationTooltip && validation.stats.totalCards > 0 && (() => {
            const valid = deckCheckResult?.valid ?? validation.isValid;
            const errCount = deckCheckResult
              ? deckCheckResult.issues.filter(i => i.type === "error").length
              : validation.issues.filter(i => i.type === "error").length;
            const isT2Fmt = deck.format?.toLowerCase().includes("type 2") || deck.format?.toLowerCase().includes("multi");
            const label = valid
              ? "Tournament Legal"
              : `${errCount} issue${errCount !== 1 ? "s" : ""} found`;
            const bg = isDeckChecking
              ? "bg-gray-800 text-gray-300 border-b-gray-800"
              : valid
                ? "bg-green-950 text-green-300 border-b-green-950"
                : "bg-red-950 text-red-300 border-b-red-950";

            // For T2: compute good/evil balance counts for the tooltip
            let balanceLine: string | null = null;
            if (isT2Fmt && !isDeckChecking) {
              const counts = { mainGood: 0, mainEvil: 0, resGood: 0, resEvil: 0 };
              for (const dc of deck.cards) {
                const a = dc.card.alignment || "";
                let side: "good" | "evil" | null = null;
                if (a.includes("Good") && a.includes("Evil")) side = null; // neutral
                else if (a.includes("Good") && a.includes("Neutral")) side = "good";
                else if (a.includes("Evil") && a.includes("Neutral")) side = "evil";
                else if (a.includes("Good")) side = "good";
                else if (a.includes("Evil")) side = "evil";
                if (!side) continue;
                if (dc.isReserve) {
                  if (side === "good") counts.resGood += dc.quantity;
                  else counts.resEvil += dc.quantity;
                } else {
                  if (side === "good") counts.mainGood += dc.quantity;
                  else counts.mainEvil += dc.quantity;
                }
              }
              const resCount = deck.cards.filter(c => c.isReserve).reduce((s, c) => s + c.quantity, 0);
              balanceLine = `Main: ${counts.mainGood}G · ${counts.mainEvil}E`;
              if (resCount > 0) {
                balanceLine += `  |  Res: ${counts.resGood}G · ${counts.resEvil}E`;
              }
            }

            return (
              <div className={`hidden md:block absolute left-1/2 -translate-x-1/2 top-full mt-1.5 px-3 py-1.5 rounded-md shadow-lg z-50 pointer-events-none text-center text-xs font-medium whitespace-nowrap ${bg.split(" ").slice(0, 2).join(" ")}`}>
                <div className={`absolute left-1/2 -translate-x-1/2 bottom-full w-0 h-0 border-l-[5px] border-r-[5px] border-b-[5px] border-l-transparent border-r-transparent ${bg.split(" ")[2]}`} />
                {label}
                {balanceLine && (
                  <div className="text-[10px] opacity-70 mt-0.5">{balanceLine}</div>
                )}
              </div>
            );
          })()}
        </button>

        {/* Details Tab (Cover Cards + Description) */}
        <button
          ref={(el) => { tabRefs.current.cover = el; }}
          onClick={() => handleTabChange("cover")}
          className={`flex-1 min-w-0 px-1.5 md:px-3 py-3 text-xs md:text-sm font-medium transition-colors duration-200 whitespace-nowrap text-center ${
            activeTab === "cover"
              ? "text-blue-600 dark:text-blue-400"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          Details
        </button>

        {/* View Dropdown Button */}
        <div className="relative ml-auto mr-1 md:mr-2">
          <button
            ref={viewDropdownBtnRef}
            onClick={(e) => {
              e.stopPropagation();
              setShowViewDropdown(!showViewDropdown);
            }}
            className="px-1.5 md:px-3 py-2 text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            <span className="hidden md:inline">View</span>
            <svg className={`w-3 h-3 transition-transform ${showViewDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* View dropdown — rendered via portal to escape overflow-hidden ancestors */}
          {showViewDropdown && createPortal(
            <>
              {/* Backdrop — mobile: visible overlay, desktop: transparent click-catcher */}
              <div
                className="fixed inset-0 md:bg-transparent bg-black/40 z-[60]"
                onClick={() => setShowViewDropdown(false)}
              />
              {/* Mobile: bottom sheet */}
              <div
                className="
                  md:hidden
                  fixed bottom-14 left-0 right-0 pb-[env(safe-area-inset-bottom)] rounded-t-2xl max-h-[70vh] overflow-y-auto
                  bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl py-2 z-[70]
                "
                style={{
                  transform: sheetTranslateY > 0 ? `translateY(${sheetTranslateY}px)` : undefined,
                  transition: sheetTranslateY === 0 ? 'transform 0.2s ease-out' : undefined,
                }}
                onTouchStart={(e) => {
                  sheetTouchRef.current = { startY: e.touches[0].clientY, currentY: e.touches[0].clientY };
                }}
                onTouchMove={(e) => {
                  if (!sheetTouchRef.current) return;
                  sheetTouchRef.current.currentY = e.touches[0].clientY;
                  const delta = sheetTouchRef.current.currentY - sheetTouchRef.current.startY;
                  if (delta > 0) {
                    setSheetTranslateY(delta);
                  }
                }}
                onTouchEnd={() => {
                  if (!sheetTouchRef.current) return;
                  const delta = sheetTouchRef.current.currentY - sheetTouchRef.current.startY;
                  if (delta > 80) {
                    setShowViewDropdown(false);
                  }
                  setSheetTranslateY(0);
                  sheetTouchRef.current = null;
                }}
              >
                {/* Drag handle */}
                <div className="flex justify-center py-2">
                  <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                </div>
                {/* Layout */}
                <div className="px-3 py-2">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Layout</div>
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setViewLayout('grid'); }}
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
                      onClick={(e) => { e.stopPropagation(); setViewLayout('list'); }}
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
                {/* Group By */}
                <div className="px-3 py-2">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Group by</div>
                  <div className="space-y-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); setGroupBy('type'); }}
                      className={`w-full px-3 py-2 text-left text-sm rounded transition-colors flex items-center justify-between ${
                        groupBy === 'type'
                          ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      <span>Type</span>
                      {groupBy === 'type' && <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setGroupBy('alignment'); }}
                      className={`w-full px-3 py-2 text-left text-sm rounded transition-colors flex items-center justify-between ${
                        groupBy === 'alignment'
                          ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      <span>Alignment</span>
                      {groupBy === 'alignment' && <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                    </button>
                  </div>
                </div>
                {/* Full Deck View (mobile only) */}
                <div className="border-t border-gray-200 dark:border-gray-700 my-2"></div>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMobileFullDeckView(true); setShowViewDropdown(false); }}
                  className="w-full px-3 py-2.5 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                  Full Deck View
                </button>
                <div className="h-4" />
              </div>
              {/* Desktop: positioned dropdown below button */}
              <div
                className="hidden md:block fixed z-[70] rounded-lg min-w-[220px] max-h-[70vh] overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl py-2"
                style={(() => {
                  const rect = viewDropdownBtnRef.current?.getBoundingClientRect();
                  if (!rect) return {};
                  return { top: rect.bottom + 4, right: window.innerWidth - rect.right };
                })()}
              >
                {/* Layout */}
                <div className="px-3 py-2">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Layout</div>
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setViewLayout('grid'); }}
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
                      onClick={(e) => { e.stopPropagation(); setViewLayout('list'); }}
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
                <div className="flex px-3 py-2 items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Card Hover Preview</span>
                  <Switch
                    checked={!disableHoverPreview}
                    onChange={() => setDisableHoverPreview((v) => !v)}
                    className={`${!disableHoverPreview ? 'bg-green-700' : 'bg-gray-300 dark:bg-gray-700'} relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${!disableHoverPreview ? 'translate-x-5' : 'translate-x-1'}`}
                    />
                  </Switch>
                </div>
                <div className="border-t border-gray-200 dark:border-gray-700 my-2"></div>
                {/* Group By */}
                <div className="px-3 py-2">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Group by</div>
                  <div className="space-y-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); setGroupBy('type'); }}
                      className={`w-full px-3 py-2 text-left text-sm rounded transition-colors flex items-center justify-between ${
                        groupBy === 'type'
                          ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      <span>Type</span>
                      {groupBy === 'type' && <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setGroupBy('alignment'); }}
                      className={`w-full px-3 py-2 text-left text-sm rounded transition-colors flex items-center justify-between ${
                        groupBy === 'alignment'
                          ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      <span>Alignment</span>
                      {groupBy === 'alignment' && <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                    </button>
                  </div>
                </div>
                {/* Full Deck View */}
                <div className="border-t border-gray-200 dark:border-gray-700 my-2"></div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onToggleExpand) {
                      onToggleExpand();
                    }
                    setShowViewDropdown(false);
                  }}
                  className="w-full px-3 py-2.5 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={isExpanded
                      ? "M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25"
                      : "M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                    } />
                  </svg>
                  {isExpanded ? 'Exit Full View' : 'Full Deck View'}
                </button>
              </div>
            </>,
            document.body
          )}
        </div>
      </div>
      )}

      {/* Content */}
      <div ref={contentRef} className={`flex-1 overflow-y-auto overflow-x-hidden ${isExpanded ? '' : 'p-4'}`} data-deck-grid>
        {/* Paragon Requirements (only show for Paragon format with a selected Paragon) */}
        {deckType === 'Paragon' && deck.paragon && validation.paragonStats && (activeTab === 'main' || activeTab === 'reserve') && (
          <div className="mb-4">
            <div className="p-3 md:p-4 bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border-2 border-purple-300 dark:border-purple-600 rounded-xl shadow-md overflow-hidden">
              {/* Mobile: stack vertically. Desktop: side by side */}
              <div className="flex flex-col md:flex-row md:items-start gap-3 md:gap-4">
                {/* Paragon Card Artwork - Click to Expand */}
                <div className="flex items-center gap-3 md:block">
                  <div
                    className="relative group w-20 h-28 md:w-32 md:h-40 rounded-lg shadow-xl flex-shrink-0 cursor-pointer hover:scale-105 hover:shadow-2xl transition-transform overflow-hidden bg-gray-200 dark:bg-gray-700 border-2 border-white dark:border-gray-600"
                    onClick={() => setShowParagonModal(true)}
                    title="Click to view full card"
                  >
                    <Image
                      src={`/paragons/Paragon ${deck.paragon}.png`}
                      alt={deck.paragon}
                      width={128}
                      height={180}
                      className="w-full h-full object-cover object-[1%_center]"
                      unoptimized
                    />
                    {/* Click Indicator Icon - Bottom Left */}
                    <div className="absolute bottom-1 left-1 md:bottom-2 md:left-2 bg-white/90 dark:bg-purple-600/90 rounded-full p-1 md:p-1.5 shadow-lg">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-5 md:w-5 text-purple-600 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                      </svg>
                    </div>
                  </div>
                  {/* Mobile: show paragon name + note inline next to image */}
                  <div className="md:hidden flex-1 min-w-0">
                    <span className="text-sm font-semibold text-purple-900 dark:text-purple-100">{deck.paragon} Requirements</span>
                    <p className="mt-1 text-xs text-purple-700 dark:text-purple-300">No Lost Souls. 40 Main, 10 Reserve. Max 7 Dominants.</p>
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
          <div className="flex flex-col h-full">
            {/* View Controls */}
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <div className="flex items-center gap-1 bg-gray-200 dark:bg-gray-700 rounded-lg p-0.5">
                <button
                  onClick={() => setExpandedViewMode('stacked')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    expandedViewMode === 'stacked'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  Stacked
                </button>
                <button
                  onClick={() => setExpandedViewMode('normal')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    expandedViewMode === 'normal'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  Normal
                </button>
              </div>
              <div className="flex items-center gap-1 bg-gray-200 dark:bg-gray-700 rounded-lg p-0.5">
                <button
                  onClick={() => setExpandedGroupBy('type')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    expandedGroupBy === 'type'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  Type
                </button>
                <button
                  onClick={() => setExpandedGroupBy('alignment')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    expandedGroupBy === 'alignment'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  Align
                </button>
                <button
                  onClick={() => setExpandedGroupBy('none')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    expandedGroupBy === 'none'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  None
                </button>
              </div>
              {/* Preview sidebar toggle */}
              <div className="hidden lg:block ml-auto">
                <button
                  onClick={() => setDisableHoverPreview((v) => !v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    !disableHoverPreview
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  }`}
                  title={disableHoverPreview ? 'Show card preview' : 'Hide card preview'}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {!disableHoverPreview ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878l4.242 4.242M15.12 15.12L21 21" />
                    )}
                  </svg>
                  Preview
                </button>
              </div>
            </div>
            <div ref={setTagsBarContainer} className="relative z-10" />
            <div className="flex-1 overflow-auto">
              <FullDeckView
                deck={deck}
                onViewCard={onViewCard}
                isAuthenticated={isAuthenticated}
                viewMode={expandedViewMode}
                groupBy={expandedGroupBy}
                showPreview={!disableHoverPreview}
                tagsBarContainer={tagsBarContainer}
              />
            </div>
          </div>
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
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  No cards in main deck yet
                </p>
                <p className="text-gray-400 dark:text-gray-500 text-xs mt-2 mb-4">
                  Search for cards and add them to your deck
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
                  className="px-4 py-2 border-2 border-blue-500 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Import or Paste from Clipboard
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
                  Use the <span className="font-medium">...</span> menu on cards to add to reserve
                </p>
              </div>
            )}
          </div>
        ) : activeTab === "cover" ? (
          // Details Tab (Cover Cards + Description)
          <div className="space-y-4 text-sm">
            <div>
              <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Cover Cards</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Choose the two cards shown as the thumbnail on the community page.
              </p>
              <div className="flex gap-3 mb-3 justify-center">
                {([1, 2] as const).map((slot) => {
                  const imgFile = slot === 1 ? deck.previewCard1 : deck.previewCard2;
                  const imgUrl = imgFile ? getImageUrl(imgFile) : null;
                  return (
                    <div key={slot} className="flex flex-col items-center gap-1.5 w-36">
                      <button
                        onClick={() => setCoverPickerSlot(coverPickerSlot === slot ? null : slot)}
                        className={`relative w-full aspect-[2.5/3.5] rounded-lg overflow-hidden border-2 transition-all ${
                          coverPickerSlot === slot
                            ? 'border-blue-500 ring-2 ring-blue-300 dark:ring-blue-700'
                            : 'border-gray-300 dark:border-gray-600 hover:border-green-600'
                        } bg-gray-100 dark:bg-gray-800`}
                        title={`Pick cover card ${slot}`}
                      >
                        {imgUrl ? (
                          <img src={imgUrl} alt={`Cover ${slot}`} className="w-full h-full object-cover" />
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                            <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                            </svg>
                            <span className="text-xs">Card {slot}</span>
                          </div>
                        )}
                      </button>
                      {imgFile && (
                        <button
                          onClick={() => setCoverPickerSlot(slot)}
                          className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-400"
                        >
                          Replace
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Card picker grid */}
              {coverPickerSlot !== null && (() => {
                const mainCards = deck.cards.filter(dc => !dc.isReserve && dc.quantity > 0);
                const filteredPickerCards = coverPickerSearch.trim()
                  ? mainCards.filter(dc => dc.card.name.toLowerCase().includes(coverPickerSearch.trim().toLowerCase()))
                  : mainCards;
                const sortedPickerCards = [...filteredPickerCards].sort((a, b) => {
                  switch (coverPickerSort) {
                    case "name":
                      return a.card.name.localeCompare(b.card.name);
                    case "type":
                      return (a.card.type || "").localeCompare(b.card.type || "") || a.card.name.localeCompare(b.card.name);
                    case "brigade":
                      return (a.card.brigade || "").localeCompare(b.card.brigade || "") || a.card.name.localeCompare(b.card.name);
                    default:
                      return 0;
                  }
                });
                return (
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                        Select card for slot {coverPickerSlot}
                      </span>
                      <div className="flex items-center gap-2">
                        <select
                          value={coverPickerSort}
                          onChange={(e) => setCoverPickerSort(e.target.value as any)}
                          className="text-xs px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                        >
                          <option value="default">Default</option>
                          <option value="name">Name</option>
                          <option value="type">Type</option>
                          <option value="brigade">Brigade</option>
                        </select>
                        <button onClick={() => setCoverPickerSlot(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                      <div className="relative">
                        <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                          type="text"
                          placeholder="Search cards..."
                          value={coverPickerSearch}
                          onChange={(e) => setCoverPickerSearch(e.target.value)}
                          className="w-full pl-7 pr-7 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        {coverPickerSearch && (
                          <button onClick={() => setCoverPickerSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="p-2 grid grid-cols-4 gap-1.5">
                      {sortedPickerCards.map((dc) => (
                        <button
                          key={`${dc.card.name}|${dc.card.set}`}
                          onClick={() => {
                            const imgFile = dc.card.imgFile;
                            const c1 = coverPickerSlot === 1 ? imgFile : (deck.previewCard1 ?? null);
                            const c2 = coverPickerSlot === 2 ? imgFile : (deck.previewCard2 ?? null);
                            onPreviewCardsChange?.(c1, c2);
                            setCoverPickerSlot(null);
                          }}
                          className="relative aspect-[2.5/3.5] rounded overflow-hidden border border-gray-200 dark:border-gray-600 hover:border-blue-500 hover:scale-105 transition-all"
                          title={dc.card.name}
                        >
                          <img
                            src={getImageUrl(dc.card.imgFile)}
                            alt={dc.card.name}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Tags Section */}
            {isAuthenticated && (
              <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Tags</h3>

                {!deck.id ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic">Save your deck first to add tags.</p>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Current tag pills */}
                    {deckTags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => toggleTag(tag)}
                        className="group flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full text-xs font-medium transition-opacity"
                        style={{ backgroundColor: tag.color, color: getTagContrastColor(tag.color) }}
                        title={`Remove "${tag.name}"`}
                      >
                        {tag.name}
                        <svg
                          className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity flex-shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    ))}

                    {/* Picker trigger */}
                    <div className="relative" ref={tagPickerRef}>
                      <button
                        onClick={() => { setTagPickerOpen((o) => !o); setTagFilter(""); setCreateMode(false); }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-gray-400 dark:border-gray-500 text-xs text-gray-500 dark:text-gray-400 hover:border-gray-600 dark:hover:border-gray-300 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        {deckTags.length === 0 ? "Add tags" : "Edit"}
                        {savingTags && <span className="ml-1 opacity-60">·</span>}
                      </button>

                      {tagPickerOpen && (
                        <div className="absolute z-50 top-full mt-1.5 left-0 w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl">
                          {createMode ? (
                            <form onSubmit={handleCreateTagInBuilder} className="p-3 flex flex-col gap-3">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setCreateColorOpen((o) => !o)}
                                  className="w-7 h-7 rounded-md border-2 border-gray-300 dark:border-gray-600 shadow-sm flex-shrink-0 hover:scale-110 transition-transform"
                                  style={{ backgroundColor: createColor }}
                                />
                                <input
                                  autoFocus
                                  type="text"
                                  placeholder="Tag name"
                                  value={createName}
                                  onChange={(e) => setCreateName(e.target.value)}
                                  maxLength={50}
                                  className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                              </div>
                              {createColorOpen && (
                                <div className="flex flex-col items-center gap-1.5">
                                  <HexColorPicker color={createColor} onChange={setCreateColor} style={{ width: "100%" }} />
                                  <span className="font-mono text-xs text-gray-400">{createColor}</span>
                                </div>
                              )}
                              {createName.trim() && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-gray-400">Preview:</span>
                                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: createColor, color: getTagContrastColor(createColor) }}>{createName}</span>
                                </div>
                              )}
                              {createError && <p className="text-xs text-red-500">{createError}</p>}
                              <div className="flex gap-2">
                                <button type="submit" disabled={creating || !createName.trim()} className="flex-1 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
                                  {creating ? "Creating…" : "Create tag"}
                                </button>
                                <button type="button" onClick={() => { setCreateMode(false); setCreateError(null); setCreateName(""); setCreateColorOpen(false); }} className="flex-1 py-1.5 border border-gray-300 dark:border-gray-600 text-sm rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
                                  Cancel
                                </button>
                              </div>
                            </form>
                          ) : (
                            <>
                              <div className="px-3 pt-3 pb-2 border-b border-gray-100 dark:border-gray-800">
                                <input
                                  autoFocus
                                  type="text"
                                  placeholder="Filter tags…"
                                  value={tagFilter}
                                  onChange={(e) => setTagFilter(e.target.value)}
                                  className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                              </div>
                              <div className="max-h-52 overflow-y-auto">
                                {tagsLoading ? (
                                  <div className="flex justify-center py-4">
                                    <svg className="animate-spin w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                    </svg>
                                  </div>
                                ) : filteredGlobalTags.length === 0 ? (
                                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">
                                    {allGlobalTags.length === 0 ? "No tags available yet" : "No matches"}
                                  </p>
                                ) : (
                                  filteredGlobalTags.map((tag) => {
                                    const selected = deckTags.some((t) => t.id === tag.id);
                                    return (
                                      <button
                                        key={tag.id}
                                        onClick={() => toggleTag(tag)}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                                      >
                                        <span className="w-4 flex-shrink-0 flex items-center justify-center">
                                          {selected && (
                                            <svg className="w-3.5 h-3.5 text-gray-700 dark:text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                            </svg>
                                          )}
                                        </span>
                                        <span className="w-3 h-3 rounded-full flex-shrink-0 border border-black/10" style={{ backgroundColor: tag.color }} />
                                        <span className="text-sm text-gray-800 dark:text-gray-200">{tag.name}</span>
                                      </button>
                                    );
                                  })
                                )}
                              </div>
                              {canManageTags && (
                                <div className="border-t border-gray-100 dark:border-gray-800">
                                  <button
                                    onClick={() => { setCreateName(tagFilter); setCreateColor("#6366f1"); setCreateError(null); setCreateMode(true); }}
                                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                  >
                                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                    Create{tagFilter.trim() ? ` "${tagFilter.trim()}"` : " new tag"}
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Description Section */}
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-700 dark:text-gray-300">Description</h3>
                <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
                  <button
                    onClick={() => setDescriptionPreview(false)}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      !descriptionPreview
                        ? 'bg-green-600 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDescriptionPreview(true)}
                    className={`px-3 py-1 text-xs font-medium transition-colors border-l border-gray-300 dark:border-gray-600 ${
                      descriptionPreview
                        ? 'bg-green-600 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    Preview
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Add notes or strategy for your deck (supports Markdown).
              </p>
              {descriptionPreview ? (
                <div className="w-full min-h-[8rem] p-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white overflow-auto prose prose-sm dark:prose-invert max-w-none">
                  {deck.description ? (
                    <ReactMarkdown>{deck.description}</ReactMarkdown>
                  ) : (
                    <p className="text-gray-400 dark:text-gray-500 italic">No description yet</p>
                  )}
                </div>
              ) : (
                <textarea
                  value={deck.description || ""}
                  onChange={(e) => onDescriptionChange?.(e.target.value)}
                  placeholder="Deck strategy, card choices, matchup notes..."
                  className="w-full h-32 p-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                />
              )}
            </div>
          </div>
        ) : (
          // Stats Tab
          <div className="space-y-4 text-sm">
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
                        href="https://landofredemption.com/wp-content/uploads/2026/03/Redemption-Paragon-Format-Rules-v1-1.pdf"
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
            <DeckLegalityChecklist
              clientValidation={validation}
              serverResult={deckCheckResult ?? null}
              isChecking={isDeckChecking ?? false}
              totalCards={validation.stats.totalCards}
              format={deck.format}
            />

            {/* Alignment Breakdown */}
            <div>
              <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Alignment Breakdown
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {(() => {
                  const isT2Format = deck.format?.toLowerCase().includes("type 2") || deck.format?.toLowerCase().includes("multi");

                  // Calculate raw alignment counts (all cards)
                  const alignmentCounts = deck.cards.reduce((acc, deckCard) => {
                    let alignment = deckCard.card.alignment || "Neutral";
                    if (alignment.includes("Good/Evil")) {
                      alignment = "Neutral";
                    }
                    if (!acc[alignment]) {
                      acc[alignment] = 0;
                    }
                    acc[alignment] += deckCard.quantity;
                    return acc;
                  }, {} as Record<string, number>);

                  // For T2: calculate deck-building balance counts (with dual-alignment resolution)
                  // to show as a subtitle when they differ from raw counts
                  let balanceGood = 0;
                  let balanceEvil = 0;
                  if (isT2Format) {
                    for (const dc of deck.cards.filter(c => !c.isReserve)) {
                      const a = dc.card.alignment || "";
                      if (a.includes("Good") && a.includes("Evil")) continue; // Good/Evil = neutral
                      if (a.includes("Good") && a.includes("Neutral")) { balanceGood += dc.quantity; continue; }
                      if (a.includes("Evil") && a.includes("Neutral")) { balanceEvil += dc.quantity; continue; }
                      if (a.includes("Good")) balanceGood += dc.quantity;
                      else if (a.includes("Evil")) balanceEvil += dc.quantity;
                    }
                  }

                  const alignmentConfig = [
                    { name: 'Good', color: 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200' },
                    { name: 'Evil', color: 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-800 dark:text-red-200' },
                    { name: 'Neutral', color: 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200' },
                    { name: 'Dual', color: 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700 text-purple-800 dark:text-purple-200' },
                  ];

                  return alignmentConfig.map(({ name, color }) => {
                    const count = alignmentCounts[name] || 0;
                    if (count === 0 && name === 'Dual') return null;

                    // Show deck-building count subtitle for T2 when it differs from raw count
                    const balanceCount = name === 'Good' ? balanceGood : name === 'Evil' ? balanceEvil : null;
                    const showBalance = isT2Format && balanceCount !== null && balanceCount !== count;

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
                        {showBalance && (
                          <div className={`text-[10px] mt-0.5 ${balanceGood !== balanceEvil ? 'text-red-400' : 'opacity-60'}`}>
                            {balanceCount} in main deck
                          </div>
                        )}
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

                {/* Deck Price */}
                {totalDeckPrice !== null && (
                  <div className="border-t border-gray-200 dark:border-gray-700 my-2 pt-2">
                    <button
                      onClick={() => setShowBuyDeckModal(true)}
                      className="flex justify-between w-full text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 -mx-1 px-1 py-0.5 rounded transition-colors group"
                    >
                      <span className="flex items-center gap-1.5">
                        <img src="/sponsors/ytg-dark.png" alt="" className="h-3.5 w-3.5 object-contain hidden dark:block" />
                        <img src="/sponsors/ytg-light.png" alt="" className="h-3.5 w-3.5 object-contain dark:hidden" />
                        Est. Price:
                      </span>
                      <span className="font-medium text-green-600 dark:text-green-400 group-hover:underline">${totalDeckPrice.toFixed(2)}</span>
                    </button>
                  </div>
                )}

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
          isLegal={deckCheckResult?.valid ?? null}
        />
      )}

      {/* Generate Image Modal */}
      {showGenerateImageModal && (
        <GenerateDeckImageModal
          deck={deck}
          onClose={() => setShowGenerateImageModal(false)}
          isLegal={deckCheckResult?.valid ?? null}
        />
      )}

      {/* Delete Deck Modal */}
      {showDeleteDeckModal && (
        <ClearDeckModal
          deckName={deck.name}
          onConfirm={() => {
            onDelete();
            setShowDeleteDeckModal(false);
          }}
          onClose={() => setShowDeleteDeckModal(false)}
        />
      )}

      {/* Buy Deck Modal */}
      {showBuyDeckModal && (
        <BuyDeckModal
          cards={deck.cards.map(dc => ({
            card_name: dc.card.name,
            card_key: `${dc.card.name}|${dc.card.set}|${dc.card.imgFile}`,
            quantity: dc.quantity,
            isReserve: dc.isReserve,
          }))}
          onClose={() => setShowBuyDeckModal(false)}
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
            <Image
              src={`/paragons/Paragon ${deck.paragon}.png`}
              alt={deck.paragon}
              width={800}
              height={1120}
              className="w-full h-auto rounded-lg shadow-2xl"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
        </div>
      )}

      {/* Username Modal */}
      {showUsernameModal && (
        <UsernameModal
          onSuccess={async () => {
            setShowUsernameModal(false);
            if (deck.id) {
              const result = await toggleDeckPublicAction(deck.id, true);
              if (result.success) {
                onDeckPublicChange?.(true);
                onNotify?.('Deck is now public', 'success');
              } else {
                onNotify?.(result.error || 'Failed to change visibility', 'error');
              }
            }
          }}
          onClose={() => setShowUsernameModal(false)}
        />
      )}

      {/* Hidden image preloader for reserve cards */}
      <div className="hidden" aria-hidden="true">
        {reserveCards.map((deckCard) => {
          const imageUrl = getImageUrl(deckCard.card.imgFile || "");
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

      {/* Mobile Full Deck View Overlay — portaled to body to escape stacking contexts */}
      {showMobileFullDeckView && createPortal(
        <div className="md:hidden fixed inset-0 z-[100] bg-white dark:bg-gray-900 flex flex-col pt-[env(safe-area-inset-top)]">
          {/* Header + View Controls — single compact row */}
          <div className="flex-shrink-0 flex items-center gap-1.5 px-2 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <div className="flex items-center gap-0.5 bg-gray-200 dark:bg-gray-700 rounded-lg p-0.5">
              <button
                onClick={() => setExpandedViewMode('stacked')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  expandedViewMode === 'stacked'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                Stack
              </button>
              <button
                onClick={() => setExpandedViewMode('normal')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  expandedViewMode === 'normal'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                Normal
              </button>
            </div>
            <div className="flex items-center gap-0.5 bg-gray-200 dark:bg-gray-700 rounded-lg p-0.5">
              <button
                onClick={() => setExpandedGroupBy('type')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  expandedGroupBy === 'type'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                Type
              </button>
              <button
                onClick={() => setExpandedGroupBy('alignment')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  expandedGroupBy === 'alignment'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                Align
              </button>
              <button
                onClick={() => setExpandedGroupBy('none')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  expandedGroupBy === 'none'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                None
              </button>
            </div>
            <button
              onClick={() => { setShowMobileFullDeckView(false); setFullViewPreviewCard(null); }}
              className="ml-auto flex-shrink-0 w-8 h-8 flex items-center justify-center bg-red-600 hover:bg-red-700 rounded-full text-white"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Deck Content */}
          <div className="flex-1 overflow-auto">
            <FullDeckView
              deck={deck}
              onViewCard={(card) => setFullViewPreviewCard(card)}
              isAuthenticated={isAuthenticated}
              viewMode={expandedViewMode}
              groupBy={expandedGroupBy}
            />
          </div>

          {/* Card Preview Overlay */}
          {fullViewPreviewCard && (
            <div
              className="absolute inset-0 z-10 bg-black/70 flex items-center justify-center p-6"
              onClick={() => setFullViewPreviewCard(null)}
            >
              <div className="relative max-w-[300px] w-full" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setFullViewPreviewCard(null)}
                  aria-label="Close card preview"
                  className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-gray-800 border border-gray-600 text-white flex items-center justify-center hover:bg-gray-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <img
                  src={getImageUrl(fullViewPreviewCard.imgFile)}
                  alt={fullViewPreviewCard.name}
                  className="w-full rounded-lg shadow-2xl"
                />
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
