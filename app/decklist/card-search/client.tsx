"use client";
import React, { useEffect, useState, useMemo, useRef } from "react";

const BATCH_SIZE = 60;
import { useRouter, useSearchParams } from "next/navigation";
import ModalWithClose from "./ModalWithClose";
import FilterGrid from "./components/FilterGrid";
import CardImage from "./components/CardImage";
import DeckBuilderPanel, { TabType } from "./components/DeckBuilderPanel";
import SpotlightPanel from "./components/SpotlightPanel";
import { CARD_DATA_URL, OT_BOOKS, NT_BOOKS, GOSPEL_BOOKS } from "./constants";
import { 
  Card, 
  categorizeRarity, 
  isNativityReference, 
  iconPredicates, 
  normalizeBrigadeField 
} from "./utils";
import { useDeckState } from "./hooks/useDeckState";
import { useDeckCheck } from "./hooks/useDeckCheck";
import { parseDeckText, generateDeckText, downloadDeckAsFile, copyDeckToClipboard } from "./utils/deckImportExport";
import { createClient } from "../../../utils/supabase/client";
import type { User } from "@supabase/supabase-js";
import { deleteDeckAction } from "../actions";
import { MobileBottomNav } from "./components/MobileBottomNav";
import { useCardPrices } from "./hooks/useCardPrices";

// Helper component for rename form in new deck modal
function NewDeckRenameForm({ 
  onSubmit, 
  onSkip, 
  onDiscard, 
  onCancel 
}: { 
  onSubmit: (name: string) => void; 
  onSkip: () => void; 
  onDiscard: () => void; 
  onCancel: () => void; 
}) {
  const [deckName, setDeckName] = useState("Untitled Deck");

  return (
    <>
      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
        Your deck is still named <strong className="text-foreground">&quot;Untitled Deck&quot;</strong>. Give it a name before saving?
      </p>

      <div className="mb-5">
        <label className="block text-sm font-medium text-foreground mb-1.5">
          Deck Name
        </label>
        <input
          type="text"
          value={deckName}
          onChange={(e) => setDeckName(e.target.value)}
          placeholder="Enter deck name..."
          className="w-full px-3.5 py-2.5 rounded-lg bg-muted text-foreground placeholder:text-muted-foreground text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onSubmit(deckName.trim() || "Untitled Deck");
            }
          }}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2.5">
        <button
          onClick={() => onSubmit(deckName.trim() || "Untitled Deck")}
          className="w-full px-5 py-2.5 bg-primary/85 text-primary-foreground rounded-lg transition-all font-semibold text-sm hover:bg-primary"
        >
          Save & Create New
        </button>

        <button
          onClick={onDiscard}
          className="w-full px-5 py-2.5 rounded-lg transition-all text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Don&apos;t Save
        </button>

        <button
          onClick={onCancel}
          className="w-full px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </>
  );
}

export default function CardSearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Get deck ID from URL params if editing existing deck
  const deckIdFromUrl = searchParams.get("deckId") || undefined;
  // Get folder ID from URL params if creating a new deck in a folder
  const folderIdFromUrl = searchParams.get("folderId") || undefined;
  // Check if this is an explicit "new deck" request
  const isNewDeck = searchParams.get("new") === "true";
  
  // Collapse state for filter grid — collapsed by default on mobile
  const [filterGridCollapsed, setFilterGridCollapsed] = useState(false);
  useEffect(() => {
    if (window.innerWidth < 768) setFilterGridCollapsed(true);
  }, []);
  // Query state - each query has its own text, search field, and operator
  type QueryOperator = 'AND' | 'OR' | 'AND NOT' | 'NOT';
  type QueryWithOp = { text: string; field: string; operator: QueryOperator };
  const [queries, setQueries] = useState<QueryWithOp[]>([{text: "", field: "everything", operator: "AND"}]);

  // Icon filters with individual operators for each filter
  type IconFilterOperator = 'AND' | 'OR' | 'AND NOT';
  type IconFilterWithOp = { icon: string; operator: IconFilterOperator };
  const [selectedIconFilters, setSelectedIconFilters] = useState<IconFilterWithOp[]>([]);
  
  // Deprecated - keeping for backwards compatibility with URL params
  const [iconFilterMode, setIconFilterMode] = useState<IconFilterOperator>('AND');
  
  // Strength and toughness filter state
  const [strengthFilter, setStrengthFilter] = useState<number | null>(null);
  const [strengthOp, setStrengthOp] = useState<string>('eq');
  const [toughnessFilter, setToughnessFilter] = useState<number | null>(null);
  const [toughnessOp, setToughnessOp] = useState<string>('eq');
  const [cards, setCards] = useState<Card[]>([]);
  // Card legality filter mode: Rotation, Classic (all), Banned, Scrolls (not Rotation or Banned), Paragon
  const [legalityMode, setLegalityMode] = useState<'Rotation'|'Classic'|'Banned'|'Scrolls'|'Paragon'>('Rotation');
  const [visibleCount, setVisibleCount] = useState(0); // Number of cards to show
  const [sortBy, setSortBy] = useState<'name' | 'set' | 'strength' | 'toughness' | 'type' | 'brigade'>('name');

  const [modalCard, setModalCardRaw] = useState<Card | null>(null);
  const modalOpenedFromDeckRef = useRef(false);
  const setModalCard = React.useCallback((card: Card | null) => {
    if (card === null && modalOpenedFromDeckRef.current) {
      // Reopen deck drawer when closing modal that was opened from deck
      setIsMobileDeckDrawerOpen(true);
      modalOpenedFromDeckRef.current = false;
    }
    setModalCardRaw(card);
  }, []);
  // Alignment filters: Good, Evil, Neutral (multiple selection)
  const [selectedAlignmentFilters, setSelectedAlignmentFilters] = useState<string[]>([]);
  // Rarity filters
  const [selectedRarityFilters, setSelectedRarityFilters] = useState<string[]>([]);
  // Advanced filters
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedTestaments, setSelectedTestaments] = useState<string[]>([]);
  const [isGospel, setIsGospel] = useState(false);
  const [noAltArt, setnoAltArt] = useState(true);
  const [noFirstPrint, setnoFirstPrint] = useState(true);
  const [nativityOnly, setNativityOnly] = useState(false);
  const [hasStarOnly, setHasStarOnly] = useState(false);
  const [cloudOnly, setCloudOnly] = useState(false);
  const [angelOnly, setAngelOnly] = useState(false);
  const [demonOnly, setDemonOnly] = useState(false);
  const [danielOnly, setDanielOnly] = useState(false);
  const [postexilicOnly, setPostexilicOnly] = useState(false);
  
  // Negation states for misc filters (true = NOT/exclude)
  const [nativityNot, setNativityNot] = useState(false);
  const [hasStarNot, setHasStarNot] = useState(false);
  const [cloudNot, setCloudNot] = useState(false);
  const [angelNot, setAngelNot] = useState(false);
  const [demonNot, setDemonNot] = useState(false);
  const [danielNot, setDanielNot] = useState(false);
  const [postexilicNot, setPostexilicNot] = useState(false);
  
  // Testament and Gospel NOT states
  const [testamentNots, setTestamentNots] = useState<Record<string, boolean>>({});
  const [gospelNot, setGospelNot] = useState(false);
  
  const [copyLinkNotification, setCopyLinkNotification] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Notification state
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error' | 'info'} | null>(null);

  // Import/export state
  const [importText, setImportText] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);
  const [exportNotification, setExportNotification] = useState(false);

  // Unsaved changes modal state
  const [showUnsavedChangesModal, setShowUnsavedChangesModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  
  // New deck confirmation modal state
  const [showNewDeckModal, setShowNewDeckModal] = useState(false);
  const [pendingNewDeckFolderId, setPendingNewDeckFolderId] = useState<string | null | undefined>(undefined);

  // ESC key handler for new deck modal
  useEffect(() => {
    function handleEscKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && showNewDeckModal) {
        setShowNewDeckModal(false);
      }
    }
    
    document.addEventListener('keydown', handleEscKey);
    return () => document.removeEventListener('keydown', handleEscKey);
  }, [showNewDeckModal]);

  // Panel visibility state
  const [showDeckBuilder, setShowDeckBuilder] = useState(true);
  const [showSearch, setShowSearch] = useState(true);
  const [isMobileDeckDrawerOpen, setIsMobileDeckDrawerOpen] = useState(false);

  // Spotlight mode state
  const [mode, setMode] = useState<"deck" | "spotlight">("deck");
  const [spotlightCard, setSpotlightCard] = useState<Card | null>(null);
  const isSpotlight = mode === "spotlight";

  // Auto-open deck drawer on mobile when editing an existing deck
  useEffect(() => {
    if (deckIdFromUrl && !isNewDeck && window.innerWidth < 768) {
      setIsMobileDeckDrawerOpen(true);
    }
  }, [deckIdFromUrl, isNewDeck]);

  // Lock body scroll when mobile deck drawer is open to prevent iOS elastic overscroll
  useEffect(() => {
    if (isMobileDeckDrawerOpen && window.innerWidth < 768) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isMobileDeckDrawerOpen]);

  // Deck panel resize state
  const containerRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);
  const currentDeckPanelWidthRef = useRef(38.2);
  const [deckPanelWidth, setDeckPanelWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('deck-panel-width');
      return saved ? parseFloat(saved) : 38.2;
    }
    return 38.2;
  });
  // Keep ref in sync so mouseup handler can read latest value
  currentDeckPanelWidthRef.current = deckPanelWidth;

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = deckPanelWidth;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current || !containerRef.current) return;
      const containerWidth = containerRef.current.offsetWidth;
      const deltaX = e.clientX - resizeStartXRef.current;
      const deltaPercent = (deltaX / containerWidth) * 100;
      const newWidth = Math.max(20, Math.min(70, resizeStartWidthRef.current - deltaPercent));
      setDeckPanelWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('deck-panel-width', String(currentDeckPanelWidthRef.current));
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);


  // Track active tab in deck builder
  const [activeDeckTab, setActiveDeckTab] = useState<TabType>("main");

  // Track which section we're viewing in full deck view (for modal navigation)
  const [fullDeckViewSection, setFullDeckViewSection] = useState<'main' | 'reserve'>('main');

  // Track which card's "..." menu is open in the search results grid
  const [openSearchMenuCard, setOpenSearchMenuCard] = useState<string | null>(null);

  // Close search card menu on click-outside or ESC
  useEffect(() => {
    if (!openSearchMenuCard) return;
    const handleClick = () => setOpenSearchMenuCard(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenSearchMenuCard(null);
    };
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [openSearchMenuCard]);

  // User authentication state
  const [user, setUser] = useState<User | null>(null);
  const supabase = createClient();

  // Deck builder state
  const {
    deck,
    syncStatus,
    hasUnsavedChanges,
    isInitializing,
    addCard,
    removeCard,
    updateQuantity,
    setDeckName,
    setDeckDescription,
    setDeckFormat,
    setDeckParagon,
    setDeckPublic,
    setPreviewCards,
    clearDeck,
    newDeck,
    loadDeck,
    loadDeckFromCloud,
    saveDeckToCloud,
    getCardQuantity,
    getDeckStats,
    clearUnsavedChanges,
  } = useDeckState(deckIdFromUrl, folderIdFromUrl, isNewDeck);

  const { result: deckCheckResult, isChecking: isDeckChecking, setResult: setDeckCheckResult } = useDeckCheck(deck);

  const { getPrice } = useCardPrices();

  // Refs for input fields to enable auto-focus
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Helper functions for managing multiple queries
  const updateQuery = (index: number, text: string) => {
    const newQueries = [...queries];
    newQueries[index] = { ...newQueries[index], text };
    setQueries(newQueries);
  };

  const updateQueryField = (index: number, field: string) => {
    const newQueries = [...queries];
    newQueries[index] = { ...newQueries[index], field };
    setQueries(newQueries);
    
    // Auto-focus the input field after changing the field dropdown
    setTimeout(() => {
      inputRefs.current[index]?.focus();
    }, 0);
  };

  const updateQueryOperator = (index: number, operator: QueryOperator) => {
    const newQueries = [...queries];
    newQueries[index] = { ...newQueries[index], operator };
    setQueries(newQueries);
  };

  const addNewQuery = () => {
    setQueries([...queries, {text: "", field: "everything", operator: "AND"}]);
  };

  const removeQuery = (index: number) => {
    if (queries.length > 1) {
      const newQueries = queries.filter((_, i) => i !== index);
      setQueries(newQueries);
    }
  };

  // Function to update URL with current filter state
  // Two modes: deck editing (deckId in URL, no filter params) vs browse (filter params in URL)
  const updateURL = React.useCallback((filters: Record<string, any>) => {
    // Mode 1: Deck editing - keep only deckId in the URL, filters are ephemeral
    if (deck.id) {
      router.replace(`/decklist/card-search?deckId=${deck.id}`, { scroll: false });
      return;
    }

    // Mode 2: Browse/search mode - write filter state to URL
    const params = new URLSearchParams();

    // Only add non-default values to URL
    const activeQueries = filters.queries?.filter(q => q.text.trim()) || [];
    if (activeQueries.length > 0) {
      params.set('q', activeQueries[0].text); // For now, only save first query to URL
      if (activeQueries[0].field !== 'everything') params.set('field', activeQueries[0].field);
    }
    if (filters.legalityMode !== 'Rotation') params.set('legality', filters.legalityMode);
    if (filters.iconFilterMode !== 'AND') params.set('iconMode', filters.iconFilterMode);
    if (filters.selectedIconFilters.length > 0) {
      // Save icon filters with their operators as JSON
      params.set('icons', JSON.stringify(filters.selectedIconFilters));
    }
    if (filters.selectedAlignmentFilters.length > 0) params.set('alignment', filters.selectedAlignmentFilters.join(','));
    if (filters.selectedRarityFilters.length > 0) params.set('rarity', filters.selectedRarityFilters.join(','));
    if (filters.selectedTestaments.length > 0) params.set('testaments', filters.selectedTestaments.join(','));
    if (filters.isGospel) params.set('gospel', 'true');
    if (filters.strengthFilter !== null) {
      params.set('strength', filters.strengthFilter.toString());
      params.set('strengthOp', filters.strengthOp);
    }
    if (filters.toughnessFilter !== null) {
      params.set('toughness', filters.toughnessFilter.toString());
      params.set('toughnessOp', filters.toughnessOp);
    }
    if (!filters.noAltArt) params.set('showAltArt', 'true');
    if (!filters.noFirstPrint) params.set('showFirstPrint', 'true');
    if (filters.nativityOnly) params.set('nativity', 'true');
    if (filters.hasStarOnly) params.set('hasStar', 'true');
    if (filters.cloudOnly) params.set('cloud', 'true');
    if (filters.angelOnly) params.set('angel', 'true');
    if (filters.demonOnly) params.set('demon', 'true');
    if (filters.danielOnly) params.set('daniel', 'true');
    if (filters.postexilicOnly) params.set('postexilic', 'true');
    if (mode === 'spotlight') params.set('mode', 'spotlight');

    const url = params.toString() ? `?${params.toString()}` : '';
    router.replace(`/decklist/card-search${url}`, { scroll: false });
  }, [router, deck.id, mode]);

  // Check user authentication on mount
  useEffect(() => {
    const getUser = async () => {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      setUser(currentUser);
    };

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load state from URL on mount (only once)
  // Skip filter loading when in deck editing mode (deckId present)
  useEffect(() => {
    if (searchParams && !isInitialized) {
      // In deck editing mode, don't load filters from URL — they're ephemeral
      if (searchParams.get('deckId')) {
        setIsInitialized(true);
        return;
      }
      const urlQuery = searchParams.get('q') || '';
      const urlField = searchParams.get('field') || 'everything';
      setQueries(urlQuery ? [{text: urlQuery, field: urlField, operator: "AND"}] : [{text: "", field: "everything", operator: "AND"}]);
      setLegalityMode((searchParams.get('legality') as any) || 'Rotation');
      setIconFilterMode((searchParams.get('iconMode') as any) || 'AND');
      
      // Load icon filters from URL (try JSON first for new format, fall back to CSV for old format)
      const iconsParam = searchParams.get('icons');
      if (iconsParam) {
        try {
          const parsed = JSON.parse(iconsParam);
          if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
            setSelectedIconFilters(parsed);
          } else {
            // Old format: just strings, convert to new format
            const iconNames = iconsParam.split(',').filter(Boolean);
            setSelectedIconFilters(iconNames.map(icon => ({ icon, operator: 'AND' })));
          }
        } catch {
          // Old format: CSV of icon names
          const iconNames = iconsParam.split(',').filter(Boolean);
          setSelectedIconFilters(iconNames.map(icon => ({ icon, operator: 'AND' })));
        }
      }
      
      setSelectedAlignmentFilters(searchParams.get('alignment')?.split(',').filter(Boolean) || []);
      setSelectedRarityFilters(searchParams.get('rarity')?.split(',').filter(Boolean) || []);
      setSelectedTestaments(searchParams.get('testaments')?.split(',').filter(Boolean) || []);
      setIsGospel(searchParams.get('gospel') === 'true');
      
      const strengthParam = searchParams.get('strength');
      if (strengthParam) {
        setStrengthFilter(parseInt(strengthParam, 10));
        setStrengthOp(searchParams.get('strengthOp') || 'eq');
      }
      
      const toughnessParam = searchParams.get('toughness');
      if (toughnessParam) {
        setToughnessFilter(parseInt(toughnessParam, 10));
        setToughnessOp(searchParams.get('toughnessOp') || 'eq');
      }
      
      setnoAltArt(searchParams.get('showAltArt') !== 'true');
      setnoFirstPrint(searchParams.get('showFirstPrint') !== 'true');
      setNativityOnly(searchParams.get('nativity') === 'true');
      setHasStarOnly(searchParams.get('hasStar') === 'true');
      setCloudOnly(searchParams.get('cloud') === 'true');
      setAngelOnly(searchParams.get('angel') === 'true');
      setDemonOnly(searchParams.get('demon') === 'true');
      setDanielOnly(searchParams.get('daniel') === 'true');
      setPostexilicOnly(searchParams.get('postexilic') === 'true');
      
      // Spotlight mode from URL (desktop only — mobile fallback handled in render)
      if (searchParams.get('mode') === 'spotlight') {
        setMode('spotlight');
      }

      setIsInitialized(true);
    }
  }, [searchParams, isInitialized]);

  // Update URL whenever filters change
  useEffect(() => {
    const filters = {
      queries,
      legalityMode,
      iconFilterMode,
      selectedIconFilters,
      selectedAlignmentFilters,
      selectedRarityFilters,
      selectedTestaments,
      isGospel,
      strengthFilter,
      strengthOp,
      toughnessFilter,
      toughnessOp,
      noAltArt,
      noFirstPrint,
      nativityOnly,
      hasStarOnly,
      cloudOnly,
      angelOnly,
      demonOnly,
      danielOnly,
      postexilicOnly,
    };
    
    updateURL(filters);
  }, [
    queries, legalityMode, iconFilterMode, selectedIconFilters,
    selectedAlignmentFilters, selectedRarityFilters, selectedTestaments, isGospel, strengthFilter,
    strengthOp, toughnessFilter, toughnessOp, noAltArt, noFirstPrint,
    nativityOnly, hasStarOnly, cloudOnly, angelOnly, demonOnly, danielOnly,
    postexilicOnly, updateURL, mode
  ]);

  // Note: We don't warn on page unload because the deck is always saved to localStorage
  // automatically. "Unsaved changes" only refers to cloud sync, not local storage.
  // Users can safely close the tab or navigate away - their deck is preserved locally.

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl (Windows/Linux) or Cmd (Mac)
      const modKey = e.ctrlKey || e.metaKey;
      
      // Arrow key navigation for panel visibility (without modifier keys)
      if (!modKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        // Only handle arrow keys if not focused on an input element
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
        
        // Don't handle arrow keys if modal is open
        if (modalCard) {
          return;
        }
        
        e.preventDefault();
        
        // Left arrow: Show fullscreen (hide search to show only deck builder)
        if (e.key === 'ArrowLeft') {
          if (!showDeckBuilder) {
            setShowDeckBuilder(true);
          } else if (showSearch) {
            setShowSearch(false);
          }
        }
        
        // Right arrow: Close fullscreen (show search, hide deck builder if both are visible)
        else if (e.key === 'ArrowRight') {
          if (!showSearch) {
            setShowSearch(true);
          } else if (showDeckBuilder) {
            setShowDeckBuilder(false);
          }
        }
        
        return;
      }
      
      if (!modKey) return;

      // Ctrl+S / Cmd+S to save
      if (e.key === 's') {
        e.preventDefault();
        const stats = getDeckStats();
        if (user && !syncStatus?.isSaving && (stats.mainDeckCount + stats.reserveCount) > 0) {
          saveDeckToCloud().then((result) => {
            if (result?.deckCheckResult) {
              setDeckCheckResult(result.deckCheckResult);
            }
          });
        }
      }
      
      // Ctrl+E / Cmd+E to export
      else if (e.key === 'e') {
        e.preventDefault();
        handleExportDeck();
      }
      
      // Ctrl+I / Cmd+I to import
      else if (e.key === 'i') {
        e.preventDefault();
        setShowImportModal(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [user, syncStatus?.isSaving, saveDeckToCloud, handleExportDeck, showSearch, showDeckBuilder, modalCard, getDeckStats]);

  // sanitize imgFile to avoid duplicate extensions - now imported from utils

  // Adjust parsing to skip header row
  useEffect(() => {
    fetch(CARD_DATA_URL)
      .then((res) => res.text())
      .then((text) => {
        const lines = text.split("\n");
        const dataLines = lines.slice(1).filter((l) => l.trim());
        const parsed = dataLines.map((line) => {
          const cols = line.split("\t");
          // Enhanced testament and gospel tagging logic
          const reference = cols[12] || "";
          let references: string[] = [];
          for (let refGroup of reference.split(";")) {
            refGroup = refGroup.trim();
            if (refGroup.includes("(") && refGroup.includes(")")) {
              // Extract main reference
              const mainRef = refGroup.split("(")[0].trim();
              if (mainRef) references.push(mainRef);
              // Extract parenthetical references
              const parenContent = refGroup.substring(refGroup.indexOf("(") + 1, refGroup.indexOf(")"));
              const parenRefs = parenContent.split(",").map(pr => pr.trim()).filter(Boolean);
              references.push(...parenRefs);
            } else {
              if (refGroup) references.push(refGroup);
            }
          }
          // Lowercase all references for matching
          const referencesLower = references.map(r => r.toLowerCase());
          // Helper to normalize book names with numbers (e.g., II Samuel -> Samuel)
          function normalizeBookName(ref) {
            // Remove leading roman numerals or numbers (I, II, 1, 2, 3, 4, one, two, three, four)\s+/i, '')
            return ref.replace(/^(i{1,3}|1|2|3|4|one|two|three|four)\s+/i, '').trim();
          }
          // Tagging strategy: collect all matching testaments
          const foundTestaments = new Set<string>();
          for (const ref of referencesLower) {
            // Try both original and normalized book name
            const book = ref.split(' ')[0];
            const normalizedBook = normalizeBookName(ref).split(' ')[0];
            if (NT_BOOKS.some(b => book === b.toLowerCase() || normalizedBook === b.toLowerCase())) foundTestaments.add('NT');
            if (OT_BOOKS.some(b => book === b.toLowerCase() || normalizedBook === b.toLowerCase())) foundTestaments.add('OT');
          }
          let testament: string | string[] = '';
          if (foundTestaments.size === 1) {
            testament = Array.from(foundTestaments)[0];
          } else if (foundTestaments.size > 1) {
            testament = Array.from(foundTestaments);
          }
          // IsGospel: true if any reference starts with a Gospel book name
          const gospelBooksLower = GOSPEL_BOOKS.map(b => b.toLowerCase());
          const isGospel = referencesLower.some(ref => gospelBooksLower.some(b => ref.startsWith(b)));
          // Normalize brigade field
          const rawBrigade = cols[5] || "";
          const alignment = cols[14] || "";
          const cardName = cols[0] || "";
          let normalizedBrigades = [];
          try {
            normalizedBrigades = normalizeBrigadeField(rawBrigade, alignment, cardName);
          } catch (e) {
            // fallback to raw brigade if normalization fails
            normalizedBrigades = rawBrigade ? [rawBrigade] : [];
          }
          const brigade = normalizedBrigades.join("/");
          return {
            dataLine: line,
            name: cols[0] || "",
            set: cols[1] || "",
            imgFile: cols[2] || "",
            officialSet: cols[3] || "",
            type: cols[4] || "",
            brigade,
            strength: cols[6] || "",
            toughness: cols[7] || "",
            class: cols[8] || "",
            identifier: cols[9] || "",
            specialAbility: cols[10] || "",
            rarity: cols[11] || "",
            reference,
            alignment: cols[14] || "",
            legality: cols[15] || "",
            testament,
            isGospel,
          } as Card;
        });
        setCards(parsed);
      })
      .catch(console.error);
  }, []);

  // Quick icon filters for type-based icons (reordered) and color-coded brigades
  const colorIcons = [
    "Black",
    "Blue",
    "Brown",
    "Clay",
    "Crimson",
    "Gold",
    "Gray",
    "Green",
    "Orange",
    "Pale Green",
    "Purple",
    "Silver",
    "White",
    "Red",
    "Teal",
  ];

  const filtered = useMemo(
    () =>
      cards
        .filter((c) => {
          // Handle multiple queries with operators - similar to icon filter logic
          const activeQueries = queries.filter(q => q.text.trim());
          if (activeQueries.length === 0) return true;
          
          // Start with the first query's result
          let result: boolean;
          const firstQuery = activeQueries[0];
          const norm = (s: string) => s.toLowerCase().replace(/[\u2018\u2019\u201B\u2032\u0060]/g, "'");
          const firstMatches = (queryObj: QueryWithOp): boolean => {
            const q = norm(queryObj.text);
            const searchField = queryObj.field;
            switch (searchField) {
              case 'name':
                return norm(c.name).includes(q);
              case 'type':
                return norm(c.type).includes(q);
              case 'brigade':
                return norm(c.brigade).includes(q);
              case 'specialAbility':
                return norm(c.specialAbility).includes(q);
              case 'setName':
                return norm(c.officialSet).includes(q) || norm(c.set).includes(q);
              case 'identifier':
                return norm(c.identifier).includes(q);
              case 'reference':
                return norm(c.reference).includes(q);
              default:
                return norm(Object.values(c).join(" ")).includes(q);
            }
          };
          
          // First query - check if it has a NOT operator (unary negation)
          const firstQueryMatches = firstMatches(firstQuery);
          result = firstQuery.operator === 'NOT' ? !firstQueryMatches : firstQueryMatches;
          
          // Apply each subsequent query with its own operator
          for (let i = 1; i < activeQueries.length; i++) {
            const query = activeQueries[i];
            const matches = firstMatches(query);
            
            // Each query's operator defines how IT combines with the previous result
            const currentOperator = query.operator;
            
            if (currentOperator === 'AND') {
              result = result && matches;
            } else if (currentOperator === 'OR') {
              result = result || matches;
            } else if (currentOperator === 'AND NOT') {
              result = result && !matches;
            } else if (currentOperator === 'NOT') {
              // NOT without AND means AND NOT
              result = result && !matches;
            }
          }
          
          return result;
        })
        // Filter out specific unwanted cards
        .filter((c) => {
          // Exclude Lost Soul Token OT [2024 - Nationals]
          return c.name !== "Lost Soul Token OT [2024 - Nationals]";
        })
        // Legality mode filter
        .filter((c) => {
          if (legalityMode === 'Classic') return true;
          if (legalityMode === 'Scrolls') return c.legality !== 'Rotation' && c.legality !== 'Banned';
          if (legalityMode === 'Paragon') {
            // Paragon format: exclude Lost Souls (not allowed in Paragon)
            if (c.type.toLowerCase().includes('lost soul')) {
              return false;
            }
            // Paragon format: exclude non-legal sets (easier to maintain than include list)
            const paragonExcludedSets = [
              '10th Anniversary',
              '1st Edition',
              '1st Edition Unlimited',
              '2nd Edition',
              '2nd Edition Revised',
              '3rd Edition',
              'Angel Wars',
              'Apostles',
              'Cloud of Witnesses',
              'Cloud of Witnesses (Alternate Border)',
              'Disciples',
              'Early Church',
              'Faith of Our Fathers',
              'Fall of Man',
              'Fundraiser',
              'Gospel of Christ',
              'Gospel of Christ Token',
              'Kings',
              'Lineage of Christ',
              'Main',
              'Main Unlimited',
              'Patriarchs',
              'Persecuted Church',
              'Priests',
              'Promo',
              'Promo Token',
              'Prophecies of Christ',
              'Prophecies of Christ Token',
              'Prophets',
              'Revelation of John',
              'Revelation of John (Alternate Border)',
              'Rock of Ages',
              'Thesaurus ex Preteritus',
              'Warriors',
              'Women'
            ];
            return !paragonExcludedSets.includes(c.officialSet);
          }
          return c.legality === legalityMode;
        })
        // Alignment filters (OR across selected filters)
        .filter((c) => {
          if (selectedAlignmentFilters.length === 0) return true;
          return selectedAlignmentFilters.some((mode) => {
            if (mode === 'Neutral') {
              // Neutral includes cards with "Good/Evil" alignment or cards with no Good/Evil alignment
              return c.alignment.includes('Good/Evil') || (!c.alignment.includes('Good') && !c.alignment.includes('Evil'));
            }
            // For Good or Evil filters, exclude cards with "Good/Evil" alignment (they're neutral)
            // Only match cards that are purely Good or purely Evil
            if (c.alignment.includes('Good/Evil')) return false;
            return c.alignment.includes(mode);
          });
        })
        // Rarity filters (OR across selected filters)
        .filter((c) => {
          if (selectedRarityFilters.length === 0) return true;
          const cardRarityCategory = categorizeRarity(c.rarity, c.officialSet);
          return selectedRarityFilters.includes(cardRarityCategory);
        })
        .filter((c) => {
          if (selectedIconFilters.length === 0) return true;
          
          // New logic: evaluate each filter with its operator
          // Start with the first filter's result
          let result: boolean;
          const firstFilter = selectedIconFilters[0];
          const pred = iconPredicates[firstFilter.icon];
          const matches = pred ? pred(c) : c.brigade.toLowerCase().includes(firstFilter.icon.toLowerCase());
          
          // First filter is always evaluated positively
          result = matches;
          
          // Now apply each subsequent filter with its operator
          for (let i = 1; i < selectedIconFilters.length; i++) {
            const filter = selectedIconFilters[i];
            const filterPred = iconPredicates[filter.icon];
            const filterMatches = filterPred ? filterPred(c) : c.brigade.toLowerCase().includes(filter.icon.toLowerCase());
            
            // Get the operator from the PREVIOUS filter (operator between prev and current)
            const prevOperator = selectedIconFilters[i - 1].operator;
            
            if (prevOperator === 'AND') {
              result = result && filterMatches;
            } else if (prevOperator === 'OR') {
              result = result || filterMatches;
            } else if (prevOperator === 'AND NOT') {
              result = result && !filterMatches;
            }
          }
          
          return result;
        })
        // Testament filters
        .filter((c) => {
          if (selectedTestaments.length === 0) return true;
          // Helper to check if testament contains NT or OT
          const hasTestament = (testament, test) => {
            if (Array.isArray(testament)) return testament.includes(test);
            if (typeof testament === 'string') return testament === test || testament.includes(test);
            return false;
          };
          // Check each testament with its NOT state
          return selectedTestaments.every(test => {
            const cardHasTestament = hasTestament(c.testament, test) || (test === 'OT' && c.identifier && c.identifier.includes('O.T.'));
            const isNot = testamentNots[test] || false;
            // If NOT is set, card should NOT have this testament
            // If NOT is not set, card should have this testament
            return isNot ? !cardHasTestament : cardHasTestament;
          });
        })
        // IsGospel filter
        .filter((c) => {
          if (!isGospel) return true;
          const cardIsGospel = c.isGospel;
          // If gospelNot is true, exclude gospel cards; otherwise include only gospel cards
          return gospelNot ? !cardIsGospel : cardIsGospel;
        })
        // Strength filter
        .filter((c) => {
          if (strengthFilter === null) return true;
          const val = parseInt(c.strength, 10);
          if (isNaN(val)) return false;
          switch (strengthOp) {
            case 'lt': return val < strengthFilter;
            case 'lte': return val <= strengthFilter;
            case 'eq': return val === strengthFilter;
            case 'gt': return val > strengthFilter;
            case 'gte': return val >= strengthFilter;
            default: return true;
          }
        })
        // Toughness filter
        .filter((c) => {
          if (toughnessFilter === null) return true;
          const val = parseInt(c.toughness, 10);
          if (isNaN(val)) return false;
          switch (toughnessOp) {
            case 'lt': return val < toughnessFilter;
            case 'lte': return val <= toughnessFilter;
            case 'eq': return val === toughnessFilter;
            case 'gt': return val > toughnessFilter;
            case 'gte': return val >= toughnessFilter;
            default: return true;
          }
        })
        // Misc filters (hide AB Versions, hide 1st Print K/L Starters)
        .filter((c) => !noAltArt || !c.set.includes("AB"))
        .filter((c) => !noFirstPrint || (
          !c.set.includes("K1P") && !c.set.includes("L1P")
        ))
        .filter((c) => {
          if (!nativityOnly) return true;
          const matches = isNativityReference(c.reference);
          return nativityNot ? !matches : matches;
        })
        .filter((c) => {
          if (!cloudOnly) return true;
          const matches = c.class.toLowerCase().includes("cloud");
          return cloudNot ? !matches : matches;
        })
        .filter((c) => {
          if (!hasStarOnly) return true;
          const matches = c.specialAbility.toLowerCase().includes("star:") || c.specialAbility.toLowerCase().includes("(star)");
          return hasStarNot ? !matches : matches;
        })
        .filter((c) => {
          if (!angelOnly) return true;
          const matches = c.type.includes("Hero") && c.brigade.includes("Silver") && !c.identifier.includes("Human") && !c.identifier.includes("Genderless") && c.name !== "Moses in Glory (GoC)" && c.name !== "Noah, the Righteous / Noah (Rest and Comfort) (LoC)" && c.name !== "Daniel (Promo)";
          return angelNot ? !matches : matches;
        })
        .filter((c) => {
          if (!demonOnly) return true;
          const matches = c.type.includes("Evil Character") && (c.brigade.includes("Orange") || c.name.toLowerCase().includes("demon") || c.name.toLowerCase().includes("obsidian minion") || c.name === "Foul Spirit (E)" || c.name === "Lying Spirit" || c.name === "Spirit of Doubt" || c.name === "Unclean Spirit (E)" || c.name === "Wandering Spirit (Ap)") && c.name !== "Babylon The Harlot (RoJ)" && c.brigade !== "Black/Brown/Crimson/Evil Gold/Gray/Orange/Pale Green" && !c.identifier.includes("Symbolic") && !c.identifier.includes("Animal") && c.name !== "Sabbath Breaker [Gray/Orange]" && c.name !== "The Divining Damsel (Promo)" && c.name !== "The False Prophet (EC)" && c.name !== "The False Prophet (RoJ)" && c.name !== "The False Prophet (RoJ AB)" && c.name !== "Damsel with Spirit of Divination (TxP)" && c.name !== "Saul/Paul" && c.name !== "Judas Iscariot / Judas, the Betrayer (GoC)";
          return demonNot ? !matches : matches;
        })
        .filter((c) => {
          if (!danielOnly) return true;
          const matches = c.reference.toLowerCase().includes("daniel");
          return danielNot ? !matches : matches;
        })
        .filter((c) => {
          if (!postexilicOnly) return true;
          // Check if name contains "postexilic"
          if (c.identifier.toLowerCase().includes("postexilic")) {
            const matches = true;
            return postexilicNot ? !matches : matches;
          }
          // Check if it's one of the specific postexilic cards
          const postexilicCards = [
            "Nehemiah",
            "Eliashib the High Priest",
            "Ezra",
            "Haggai",
            "Haggai (PoC)",
            "Joiada, Son of Eliashib",
            "Joiakim, Son of Joshua",
            "Jonathan, son of Joiada",
            "Joshua the High Priest (PoC)",
            "Joshua the High Priest",
            "Malachi (PoC)",
            "Malachi, the Loved",
            "Malachi",
            "Shelemiah the Priest",
            "Zechariah (Pi)",
            "Zechariah (Pr)",
            "Zechariah (RoA)",
            "Zechariah, the Renewer",
            "Zerubbabel",
            "Foolish Shepherd",
            "Unfaithful Priests"
          ];
          const matches = postexilicCards.includes(c.name);
          return postexilicNot ? !matches : matches;
        }),
    [cards, queries, selectedIconFilters, legalityMode, selectedAlignmentFilters, selectedRarityFilters, selectedTestaments, isGospel, noAltArt, noFirstPrint, nativityOnly, hasStarOnly, cloudOnly, angelOnly, demonOnly, danielOnly, postexilicOnly, strengthFilter, strengthOp, toughnessFilter, toughnessOp, iconFilterMode, nativityNot, hasStarNot, cloudNot, angelNot, demonNot, danielNot, postexilicNot, testamentNots, gospelNot]
  );

  // Effect to show all cards when any filter is applied
  useEffect(() => {
    // If any meaningful filters are active, show all filtered cards, otherwise show none
    // Note: searchField change alone shouldn't trigger showing cards without a query
    const hasActiveQueries = queries.some(q => q.text.trim());
    const hasActiveFilters = hasActiveQueries || 
      selectedIconFilters.length > 0 || 
      selectedAlignmentFilters.length > 0 || 
      selectedRarityFilters.length > 0 || 
      selectedTestaments.length > 0 || 
      isGospel || 
      strengthFilter !== null || 
      toughnessFilter !== null || 
      !noAltArt || 
      !noFirstPrint || 
      nativityOnly || 
      hasStarOnly || 
      cloudOnly || 
      angelOnly || 
      demonOnly || 
      danielOnly || 
      postexilicOnly ||
      legalityMode !== 'Rotation';
    
    if (hasActiveFilters) {
      setVisibleCount(BATCH_SIZE);
    } else {
      setVisibleCount(0);
    }
  }, [filtered.length, queries, legalityMode, selectedIconFilters, selectedAlignmentFilters, selectedRarityFilters, selectedTestaments, isGospel, strengthFilter, toughnessFilter, noAltArt, noFirstPrint, nativityOnly, hasStarOnly, cloudOnly, angelOnly, demonOnly, danielOnly, postexilicOnly, testamentNots, gospelNot]);

  const visibleCards = useMemo(() => {
    return [...filtered]
      .sort((a, b) => {
        switch (sortBy) {
          case 'set':
            return a.officialSet.localeCompare(b.officialSet) || a.name.localeCompare(b.name);
          case 'strength': {
            const aStr = parseInt(a.strength) || 0;
            const bStr = parseInt(b.strength) || 0;
            return bStr - aStr || a.name.localeCompare(b.name);
          }
          case 'toughness': {
            const aTgh = parseInt(a.toughness) || 0;
            const bTgh = parseInt(b.toughness) || 0;
            return bTgh - aTgh || a.name.localeCompare(b.name);
          }
          case 'type':
            return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
          case 'brigade':
            return a.brigade.localeCompare(b.brigade) || a.name.localeCompare(b.name);
          case 'name':
          default:
            return a.name.localeCompare(b.name);
        }
      })
      .slice(0, visibleCount);
  }, [filtered, visibleCount, sortBy]);

  // Whether any filter pills should be shown in the summary bar
  const hasActiveFilters = queries.some(q => q.text.trim()) ||
    legalityMode !== 'Rotation' ||
    selectedAlignmentFilters.length > 0 ||
    selectedRarityFilters.length > 0 ||
    selectedIconFilters.length > 0 ||
    selectedTestaments.length > 0 ||
    isGospel ||
    strengthFilter !== null ||
    toughnessFilter !== null ||
    !noAltArt ||
    !noFirstPrint ||
    nativityOnly ||
    hasStarOnly ||
    cloudOnly ||
    angelOnly ||
    demonOnly ||
    danielOnly ||
    postexilicOnly;


  // Infinite scroll: load more cards when sentinel comes into view
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= filtered.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + BATCH_SIZE, filtered.length));
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, filtered.length]);

  // Toggler for icon filters
  function toggleIconFilter(value: string) {
    setSelectedIconFilters((prev) => {
      const exists = prev.find(f => f.icon === value);
      if (exists) {
        // Remove the filter
        return prev.filter((v) => v.icon !== value);
      } else {
        // Add the filter with default operator (AND)
        return [...prev, { icon: value, operator: 'AND' }];
      }
    });
  }
  
  // Update operator for a specific icon filter
  function updateIconFilterOperator(icon: string, operator: IconFilterOperator) {
    setSelectedIconFilters((prev) => 
      prev.map(f => f.icon === icon ? { ...f, operator } : f)
    );
  }

  // Update operator for ALL icon filters (used by Icon Filter Mode button)
  function updateAllIconFilterOperators(operator: IconFilterOperator) {
    setSelectedIconFilters((prev) => 
      prev.map(filter => ({ ...filter, operator }))
    );
  }

  // Toggler for alignment filters
  function toggleAlignmentFilter(value: string) {
    setSelectedAlignmentFilters((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }
  
  // Toggler for rarity filters
  function toggleRarityFilter(value: string) {
    setSelectedRarityFilters((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  // Brigade normalization helpers - now imported from utils

  // Handle deck format change - also update legality mode filter
  function handleDeckFormatChange(format: string) {
    setDeckFormat(format);
    // If format is Paragon, automatically set legality filter to Paragon
    if (format.toLowerCase().includes('paragon')) {
      setLegalityMode('Paragon');
    } else if (legalityMode === 'Paragon') {
      // Switching away from Paragon — reset filter back to Rotation
      setLegalityMode('Rotation');
    }
  }

  // Reset filters handler
  function handleResetFilters() {
    setQueries([{text: "", field: "everything", operator: "AND"}]);
    setSelectedIconFilters([]);
    // Keep current legality mode when resetting (don't reset to Rotation)
    // setLegalityMode('Rotation');
    setIconFilterMode('AND');
    setSelectedAlignmentFilters([]);
    setSelectedRarityFilters([]);
    setSelectedTestaments([]);
    setIsGospel(false);
    setnoAltArt(true);
    setnoFirstPrint(true);
    setNativityOnly(false);
    setHasStarOnly(false);
    setCloudOnly(false);
    setAngelOnly(false);
    setDemonOnly(false);
    setDanielOnly(false);
    setPostexilicOnly(false);
    setStrengthFilter(null);
    setStrengthOp('eq');
    setToughnessFilter(null);
    setToughnessOp('eq');
    
    // Reset NOT states
    setNativityNot(false);
    setHasStarNot(false);
    setCloudNot(false);
    setAngelNot(false);
    setDemonNot(false);
    setDanielNot(false);
    setPostexilicNot(false);
    setTestamentNots({});
    setGospelNot(false);
    
    setVisibleCount(0); // Don't show any cards after reset
    
    // Clear URL
    router.replace('/decklist/card-search', { scroll: false });
  }

  // Copy current search URL to clipboard
  function handleCopyLink() {
    const currentUrl = window.location.href;
    navigator.clipboard.writeText(currentUrl).then(() => {
      setCopyLinkNotification(true);
      setTimeout(() => setCopyLinkNotification(false), 2000); // Hide after 2 seconds
    }).catch(err => {
      console.error('Failed to copy link:', err);
    });
  }

  // Export deck to clipboard (with file download fallback)
  async function handleExportDeck() {
    try {
      await copyDeckToClipboard(deck);
      setExportNotification(true);
      setTimeout(() => setExportNotification(false), 2000);
    } catch (err) {
      console.error('Failed to copy deck to clipboard:', err);
      // Fallback to download if clipboard fails
      downloadDeckAsFile(deck);
    }
  }

  // Download deck as .txt file
  function handleDownloadDeck() {
    downloadDeckAsFile(deck);
  }

  // Import deck from text
  function handleImportDeck(text: string) {
    const result = parseDeckText(text, cards);
    
    if (result.errors.length > 0) {
      setImportErrors(result.errors);
    } else {
      setImportErrors([]);
    }
    
    if (result.deck) {
      // Preserve the existing deck name when importing
      const importedDeck = {
        ...result.deck,
        name: deck.name || result.deck.name,
      };
      loadDeck(importedDeck);
      setShowImportModal(false);
      setImportText("");
    }
  }

  // Handle new deck with confirmation
  function handleNewDeck(name?: string, folderId?: string | null, skipConfirmation?: boolean) {
    const stats = getDeckStats();
    const hasCards = stats.mainDeckCount + stats.reserveCount > 0;
    
    // If deck has cards and not skipping confirmation, show confirmation modal
    if (hasCards && !skipConfirmation) {
      setPendingNewDeckFolderId(folderId);
      setShowNewDeckModal(true);
      return;
    }
    
    // No cards or skipping confirmation, just create new deck
    clearUnsavedChanges();
    newDeck(name, folderId);
  }
  
  // Proceed with new deck creation after confirmation
  async function proceedWithNewDeck(shouldSave: boolean, newName?: string) {
    if (shouldSave && user) {
      try {
        // Update name if provided, and pass it directly to save
        let saveResult;
        if (newName && newName !== deck.name) {
          setDeckName(newName);
          // Pass the new name directly to saveDeckToCloud to avoid closure issues
          saveResult = await saveDeckToCloud(newName);
        } else {
          saveResult = await saveDeckToCloud();
        }
        if (saveResult?.deckCheckResult) {
          setDeckCheckResult(saveResult.deckCheckResult);
        }
        setNotification({ message: 'Deck saved successfully!', type: 'success' });
        setTimeout(() => setNotification(null), 3000);
      } catch (error) {
        setNotification({ message: 'Failed to save deck', type: 'error' });
        setTimeout(() => setNotification(null), 3000);
      }
    }
    
    // Create new deck
    newDeck("Untitled Deck", pendingNewDeckFolderId);
    setShowNewDeckModal(false);
    setPendingNewDeckFolderId(undefined);
  }

  // Delete deck
  async function handleDeleteDeck() {
    if (!deck.id) {
      // If deck hasn't been saved yet, just clear it
      clearDeck();
      clearUnsavedChanges();
      return;
    }

    if (!user) {
      setNotification({ message: 'Please sign in to delete decks.', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const result = await deleteDeckAction(deck.id);
    if (result.success) {
      clearUnsavedChanges();
      clearDeck();
      // Clear the deckId from URL
      router.replace('/decklist/card-search?new=true', { scroll: false });
      setNotification({ message: 'Deck deleted successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    } else {
      setNotification({ message: result.error || 'Failed to delete deck', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
    }
  }

  // ...existing code...
  return (
    <>
      {/* Modal - Rendered outside main container to avoid z-index issues */}
      {modalCard && (
        <ModalWithClose
          modalCard={modalCard}
          setModalCard={setModalCard}
          visibleCards={!showSearch 
            ? deck.cards
                .filter(dc => dc.isReserve === (fullDeckViewSection === 'reserve'))
                .map(dc => dc.card)
                .sort((a, b) => {
                  // Sort by type first
                  const typeA = a.type || 'Unknown';
                  const typeB = b.type || 'Unknown';
                  if (typeA !== typeB) {
                    return typeA.localeCompare(typeB);
                  }
                  // Then by name
                  return a.name.localeCompare(b.name);
                })
            : visibleCards
          }
          onAddCard={addCard}
          onRemoveCard={removeCard}
          getCardQuantity={getCardQuantity}
          activeDeckTab={activeDeckTab}
          legalityFilter={legalityMode}
          allCards={cards}
        />
      )}
      
    <div ref={containerRef} className="flex w-full h-screen overflow-hidden bg-background">
      {/* Left panel: Card search */}
      {showSearch && (
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="bg-background text-foreground transition-colors duration-200 flex-1 flex flex-col overflow-auto md:overflow-hidden">
          <div className="p-1.5 md:p-2 flex flex-col items-center md:sticky md:top-0 z-40 bg-background text-foreground border-b border-border shadow-sm">
        <div className="relative w-full px-1 md:px-2 flex flex-col items-center justify-center gap-1.5 md:gap-2">
          <div className="w-full flex flex-col gap-1.5 md:gap-2 text-center">
            <div className="flex flex-col gap-1.5 md:gap-2 w-full">
              {queries.map((queryObj, index) => (
                <div key={index} className="flex items-center gap-1 min-w-0">
                  {/* Field dropdown */}
                  <select
                    value={queryObj.field}
                    onChange={e => updateQueryField(index, e.target.value)}
                    className="border rounded px-1 sm:px-2 h-9 sm:h-11 bg-muted text-foreground border-border shadow-sm focus:ring-2 focus:ring-ring text-center text-xs sm:text-sm min-w-0"
                  >
                    <option value="everything">All</option>
                    <option value="name">Name</option>
                    <option value="type">Type</option>
                    <option value="brigade">Brigade</option>
                    <option value="specialAbility">Special Ability</option>
                    <option value="setName">Set Name</option>
                    <option value="identifier">Identifier</option>
                    <option value="reference">Reference</option>
                  </select>
                  
                  {/* Operator dropdown - shown for all queries */}
                  <select
                    value={queryObj.operator}
                    onChange={e => updateQueryOperator(index, e.target.value as QueryOperator)}
                    className="border rounded px-1 sm:px-2 h-9 sm:h-11 bg-muted text-foreground border-border shadow-sm focus:ring-2 focus:ring-ring text-center text-xs sm:text-sm min-w-0"
                    title={index === 0 ? "Negate this query" : "How to combine this query with previous results"}
                  >
                    {index === 0 ? (
                      <>
                        <option value="AND">—</option>
                        <option value="NOT">NOT</option>
                      </>
                    ) : (
                      <>
                        <option value="AND">AND</option>
                        <option value="OR">OR</option>
                        <option value="AND NOT">NOT</option>
                      </>
                    )}
                  </select>
                  
                  {/* Search input */}
                  <input
                    ref={el => { inputRefs.current[index] = el; }}
                    type="text"
                    placeholder={index === 0 ? "Search" : `Search ${index + 1}`}
                    className="flex-1 min-w-0 px-2 sm:px-3 h-9 sm:h-11 border rounded text-base focus:outline-none focus:ring-2 focus:ring-ring text-foreground bg-card border-border"
                    value={queryObj.text}
                    onChange={(e) => updateQuery(index, e.target.value)}
                    maxLength={64}
                  />
                  
                  {/* Remove button - only show if more than one query */}
                  {queries.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeQuery(index)}
                      className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center text-destructive/70 hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors text-lg font-bold"
                      title="Remove this query"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            {/* Mobile: original layout */}
            <div className="flex sm:hidden flex-row flex-wrap gap-1.5 w-full justify-center">
            <button
              className="px-2.5 flex-1 rounded bg-muted text-muted-foreground hover:bg-muted/80 border border-border transition font-medium shadow-sm text-center text-xs h-8"
              onClick={handleResetFilters}
            >
              <span className="flex items-center justify-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Reset
              </span>
            </button>
            <button
              className="px-3 flex-1 shrink-0 rounded bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30 transition font-medium shadow-sm text-center relative text-xs h-8"
              onClick={addNewQuery}
              title="Add new query"
            >
              +
            </button>
            </div>
            {/* Desktop: centered buttons with filters right-aligned */}
            <div className="hidden sm:flex flex-row gap-2 w-full items-center justify-center relative">
            <button
              className="px-4 shrink-0 rounded bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30 transition font-medium shadow-sm text-center relative h-9 sm:h-11"
              onClick={addNewQuery}
              title="Add new query"
            >
              +
            </button>
            <button
              className="px-4 rounded bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground border border-border transition font-medium shadow-sm text-center text-sm h-9 sm:h-11"
              onClick={handleResetFilters}
            >
              Reset Filters
            </button>
            <button
              className={`px-4 rounded border transition font-medium shadow-sm text-center relative h-9 sm:h-11 ${
                queries.filter(q => q.text.trim()).length > 1
                  ? 'bg-muted text-muted-foreground/50 border-border cursor-not-allowed opacity-50'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground border-border'
              }`}
              onClick={queries.filter(q => q.text.trim()).length > 1 ? undefined : handleCopyLink}
              title={
                queries.filter(q => q.text.trim()).length > 1
                  ? 'Multiple query link sharing sadly not supported'
                  : copyLinkNotification ? 'Link copied!' : 'Copy search link'
              }
              disabled={queries.filter(q => q.text.trim()).length > 1}
            >
              {copyLinkNotification ? '✓' : '🔗'}
            </button>
            {/* Sort + Filter collapse — desktop only, right-aligned */}
            <div className="hidden md:flex absolute right-0 items-center gap-2">
            <div className="flex items-center gap-1.5">
              <label htmlFor="card-sort" className="text-sm text-muted-foreground font-medium">Sort:</label>
              <select
                id="card-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="px-2 py-1.5 border rounded text-sm font-semibold bg-muted text-foreground border-border focus:outline-none h-9 sm:h-11"
              >
                <option value="name">Name</option>
                <option value="set">Set</option>
                <option value="strength">Strength</option>
                <option value="toughness">Toughness</option>
                <option value="type">Type</option>
                <option value="brigade">Brigade</option>
              </select>
            </div>
            <button
              aria-label="Toggle filter grid"
              className={`flex px-3 shrink-0 rounded items-center justify-center gap-1.5 border transition font-medium shadow-sm text-sm h-9 sm:h-11 ${
                filterGridCollapsed
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 border-border'
              }`}
              onClick={() => setFilterGridCollapsed(v => !v)}
              title={filterGridCollapsed ? 'Show filters' : 'Hide filters'}
            >
              {filterGridCollapsed ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                </svg>
              )}
              Filters
            </button>
            </div>{/* end Sort + Filter collapse wrapper */}
            </div>
          </div>
        </div>
      </div>
      {/* Active Filters Summary Bar — always visible on desktop to prevent layout jump, hidden on mobile when empty */}
      <div className={`w-full transition-all duration-300 md:sticky md:top-[64px] z-30 bg-background text-foreground border-b border-border ${hasActiveFilters ? 'flex' : 'hidden md:flex'} items-center`}>
        {/* Scrollable pills area */}
        <div className="flex-1 overflow-x-auto flex flex-nowrap sm:flex-wrap gap-1.5 sm:gap-2 items-center sm:justify-center px-2 sm:px-4 py-1.5 sm:py-2 sm:overflow-visible min-h-[44px]">
        {/* Query Pills */}
        {queries.map((queryObj, originalIndex) => {
          if (!queryObj.text.trim()) return null;
          
          // For first query, show its own operator if it's NOT
          // For subsequent queries, show the query's own operator (how it combines with previous)
          let operatorPrefix = '';
          if (originalIndex === 0 && queryObj.operator === 'NOT') {
            operatorPrefix = 'NOT ';
          } else if (originalIndex > 0) {
            const currentOperator = queryObj.operator;
            if (currentOperator === 'AND NOT' || currentOperator === 'NOT') {
              operatorPrefix = 'AND NOT ';
            } else {
              operatorPrefix = `${currentOperator} `;
            }
          }
          
          return (
            <span
              key={`${originalIndex}-${queryObj.field}-${queryObj.text}`}
              className="animate-pill-enter bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap"
              onClick={() => updateQuery(originalIndex, "")}
              tabIndex={0}
              role="button"
              aria-label={`Remove Search filter ${originalIndex + 1}`}
            >
              {operatorPrefix && <span className="font-bold mr-1">{operatorPrefix}</span>}
              {queryObj.field === 'everything' && `"${queryObj.text}"`}
              {queryObj.field === 'name' && `Name: "${queryObj.text}"`}
              {queryObj.field === 'type' && `Type: "${queryObj.text}"`}
              {queryObj.field === 'brigade' && `Brigade: "${queryObj.text}"`}
              {queryObj.field === 'specialAbility' && `Ability: "${queryObj.text}"`}
              {queryObj.field === 'setName' && `Set: "${queryObj.text}"`}
              {queryObj.field === 'identifier' && `ID: "${queryObj.text}"`}
              {queryObj.field === 'reference' && `Ref: "${queryObj.text}"`}
              <span className="ml-1">×</span>
            </span>
          );
        })}
        {/* Legality */}
        {legalityMode !== 'Rotation' && (
          <span className="animate-pill-enter bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap" onClick={() => setLegalityMode('Rotation')} tabIndex={0} role="button" aria-label="Remove Legality filter">
            {legalityMode}
            <span className="ml-1">×</span>
          </span>
        )}
        {/* Alignment */}
        {selectedAlignmentFilters.map(mode => (
          <span
            key={mode}
            className="animate-pill-enter bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap"
            onClick={() => setSelectedAlignmentFilters(selectedAlignmentFilters.filter(m => m !== mode))}
            tabIndex={0}
            role="button"
            aria-label={`Remove ${mode} alignment filter`}
          >
            {mode}
            <span className="ml-1">×</span>
          </span>
        ))}
        {/* Rarity */}
        {selectedRarityFilters.map(rarity => (
          <span
            key={rarity}
            className="animate-pill-enter bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap"
            onClick={() => setSelectedRarityFilters(selectedRarityFilters.filter(r => r !== rarity))}
            tabIndex={0}
            role="button"
            aria-label={`Remove ${rarity} rarity filter`}
          >
            {rarity}
            <span className="ml-1">×</span>
          </span>
        ))}
        {/* Icon Filters */}
        {selectedIconFilters.map((filter, idx) => {
          const pillClass = 'animate-pill-enter bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap';
          return (
            <React.Fragment key={filter.icon}>
              <span className={pillClass} onClick={() => setSelectedIconFilters(selectedIconFilters.filter(f => f.icon !== filter.icon))} tabIndex={0} role="button" aria-label={`Remove ${filter.icon} filter`}>
                {filter.icon}
                <span className="ml-1">×</span>
              </span>
              {idx < selectedIconFilters.length - 1 && (
                <span 
                  className="animate-pill-enter mx-1 font-bold text-xs text-gray-500 dark:text-gray-400 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors px-2 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                  onClick={(e) => {
                    e.preventDefault();
                    // Left-click: cycle through AND → OR → AND NOT → AND
                    const currentOp = filter.operator;
                    if (currentOp === 'AND') {
                      updateIconFilterOperator(filter.icon, 'OR');
                    } else if (currentOp === 'OR') {
                      updateIconFilterOperator(filter.icon, 'AND NOT');
                    } else if (currentOp === 'AND NOT') {
                      updateIconFilterOperator(filter.icon, 'AND');
                    }
                  }}
                  title="Click to cycle: AND → OR → AND NOT"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      // Same as left-click
                      const currentOp = filter.operator;
                      if (currentOp === 'AND') {
                        updateIconFilterOperator(filter.icon, 'OR');
                      } else if (currentOp === 'OR') {
                        updateIconFilterOperator(filter.icon, 'AND NOT');
                      } else if (currentOp === 'AND NOT') {
                        updateIconFilterOperator(filter.icon, 'AND');
                      }
                    }
                  }}
                >
                  {filter.operator}
                </span>
              )}
            </React.Fragment>
          );
        })}
        {/* Testament */}
        {selectedTestaments.map(t => (
          <span key={t} className="animate-pill-enter bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap" onClick={() => { setSelectedTestaments(selectedTestaments.filter(x => x !== t)); setTestamentNots(prev => { const newNots = { ...prev }; delete newNots[t]; return newNots; }); }} tabIndex={0} role="button" aria-label={`Remove ${t} testament filter`}>
            {testamentNots[t] ? 'NOT ' : ''}{t}
            <span className="ml-1">×</span>
          </span>
        ))}
        {/* Gospel */}
        {isGospel && (
          <span className="animate-pill-enter bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap" onClick={() => { setIsGospel(false); setGospelNot(false); }} tabIndex={0} role="button" aria-label="Remove Gospel filter">
            {gospelNot ? 'NOT ' : ''}Gospel
            <span className="ml-1">×</span>
          </span>
        )}
        {/* Strength */}
        {strengthFilter !== null && (
          <span className="animate-pill-enter bg-destructive/15 text-destructive px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap" onClick={() => setStrengthFilter(null)} tabIndex={0} role="button" aria-label="Remove Strength filter">
            Strength {strengthOp === 'eq' ? '=' : strengthOp === 'lt' ? '<' : strengthOp === 'lte' ? '≤' : strengthOp === 'gt' ? '>' : '≥'} {strengthFilter}
            <span className="ml-1">×</span>
          </span>
        )}
        {/* Toughness */}
        {toughnessFilter !== null && (
          <span className="animate-pill-enter bg-destructive/15 text-destructive px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap" onClick={() => setToughnessFilter(null)} tabIndex={0} role="button" aria-label="Remove Toughness filter">
            Toughness {toughnessOp === 'eq' ? '=' : toughnessOp === 'lt' ? '<' : toughnessOp === 'lte' ? '≤' : toughnessOp === 'gt' ? '>' : '≥'} {toughnessFilter}
            <span className="ml-1">×</span>
          </span>
        )}
        {/* Misc */}
        {noAltArt === false && (
          <span className="animate-pill-enter bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap" onClick={() => setnoAltArt(true)} tabIndex={0} role="button" aria-label="Remove AB Versions filter">
            AB Versions
            <span className="ml-1">×</span>
          </span>
        )}
        {noFirstPrint === false && (
          <span className="animate-pill-enter bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap" onClick={() => setnoFirstPrint(true)} tabIndex={0} role="button" aria-label="Remove 1st Print K/L Starters filter">
            1st Print K/L Starters
            <span className="ml-1">×</span>
          </span>
        )}
        {nativityOnly && (
          <span className="animate-pill-enter bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap" onClick={() => { setNativityOnly(false); setNativityNot(false); }} tabIndex={0} role="button" aria-label="Remove Nativity filter">
            {nativityNot ? 'NOT ' : ''}Nativity
            <span className="ml-1">×</span>
          </span>
        )}
        {hasStarOnly && (
          <span className="animate-pill-enter bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap" onClick={() => { setHasStarOnly(false); setHasStarNot(false); }} tabIndex={0} role="button" aria-label="Remove Has Star filter">
            {hasStarNot ? 'NOT ' : ''}Has Star
            <span className="ml-1">×</span>
          </span>
        )}
        {cloudOnly && (
          <span className="animate-pill-enter bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap" onClick={() => { setCloudOnly(false); setCloudNot(false); }} tabIndex={0} role="button" aria-label="Remove Cloud filter">
            {cloudNot ? 'NOT ' : ''}Cloud
            <span className="ml-1">×</span>
          </span>
        )}
        {angelOnly && (
          <span className="animate-pill-enter bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap" onClick={() => { setAngelOnly(false); setAngelNot(false); }} tabIndex={0} role="button" aria-label="Remove Angel filter">
            {angelNot ? 'NOT ' : ''}Angel
            <span className="ml-1">×</span>
          </span>
        )}
        {demonOnly && (
          <span className="animate-pill-enter bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap" onClick={() => { setDemonOnly(false); setDemonNot(false); }} tabIndex={0} role="button" aria-label="Remove Demon filter">
            {demonNot ? 'NOT ' : ''}Demon
            <span className="ml-1">×</span>
          </span>
        )}
        {danielOnly && (
          <span className="animate-pill-enter bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap" onClick={() => { setDanielOnly(false); setDanielNot(false); }} tabIndex={0} role="button" aria-label="Remove Daniel filter">
            {danielNot ? 'NOT ' : ''}Daniel
            <span className="ml-1">×</span>
          </span>
        )}
        {postexilicOnly && (
          <span className="animate-pill-enter bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer whitespace-nowrap" onClick={() => { setPostexilicOnly(false); setPostexilicNot(false); }} tabIndex={0} role="button" aria-label="Remove Postexilic filter">
            {postexilicNot ? 'NOT ' : ''}Postexilic
            <span className="ml-1">×</span>
          </span>
        )}
        </div>
      </div>
      {/* Collapse/Expand Filter Grid Button — mobile only (on desktop it's in the search header) */}
      <div className={`flex-shrink-0 ${!filterGridCollapsed ? 'sticky top-0 z-30' : ''} flex md:hidden flex-row items-center justify-between px-3 py-1.5 bg-background border-b border-border`}>
        <div className="flex items-center gap-1.5">
          <label htmlFor="card-sort-mobile" className="text-xs text-muted-foreground font-medium">Sort:</label>
          <select
            id="card-sort-mobile"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-2 py-1 border rounded text-xs font-semibold bg-muted text-foreground border-border focus:outline-none"
          >
            <option value="name">Name</option>
            <option value="set">Set</option>
            <option value="strength">Strength</option>
            <option value="toughness">Toughness</option>
            <option value="type">Type</option>
            <option value="brigade">Brigade</option>
          </select>
        </div>
        <button
          aria-label="Toggle filter grid"
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full border text-xs font-semibold transition ${
            filterGridCollapsed
              ? 'bg-primary/15 text-primary border-primary/30'
              : 'bg-muted text-muted-foreground border-border'
          }`}
          onClick={() => setFilterGridCollapsed(v => !v)}
        >
          {filterGridCollapsed ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
            </svg>
          )}
          Filters
        </button>
      </div>
      <main className="p-2 pb-16 md:pb-2 md:overflow-auto md:flex-1 bg-background text-foreground transition-colors duration-200" style={{ scrollbarGutter: 'stable' }}>
        {/* Responsive grid for filters */}
        {!filterGridCollapsed && (
          <FilterGrid
            legalityMode={legalityMode}
            setLegalityMode={setLegalityMode}
            selectedAlignmentFilters={selectedAlignmentFilters}
            toggleAlignmentFilter={toggleAlignmentFilter}
            selectedRarityFilters={selectedRarityFilters}
            toggleRarityFilter={toggleRarityFilter}
            advancedOpen={advancedOpen}
            setAdvancedOpen={setAdvancedOpen}
            selectedTestaments={selectedTestaments}
            setSelectedTestaments={setSelectedTestaments}
            testamentNots={testamentNots}
            setTestamentNots={setTestamentNots}
            isGospel={isGospel}
            setIsGospel={setIsGospel}
            gospelNot={gospelNot}
            setGospelNot={setGospelNot}
            strengthFilter={strengthFilter}
            setStrengthFilter={setStrengthFilter}
            strengthOp={strengthOp}
            setStrengthOp={setStrengthOp}
            toughnessFilter={toughnessFilter}
            setToughnessFilter={setToughnessFilter}
            toughnessOp={toughnessOp}
            setToughnessOp={setToughnessOp}
            noAltArt={noAltArt}
            setnoAltArt={setnoAltArt}
            noFirstPrint={noFirstPrint}
            setnoFirstPrint={setnoFirstPrint}
            nativityOnly={nativityOnly}
            setNativityOnly={setNativityOnly}
            nativityNot={nativityNot}
            setNativityNot={setNativityNot}
            hasStarOnly={hasStarOnly}
            setHasStarOnly={setHasStarOnly}
            hasStarNot={hasStarNot}
            setHasStarNot={setHasStarNot}
            cloudOnly={cloudOnly}
            setCloudOnly={setCloudOnly}
            cloudNot={cloudNot}
            setCloudNot={setCloudNot}
            angelOnly={angelOnly}
            setAngelOnly={setAngelOnly}
            angelNot={angelNot}
            setAngelNot={setAngelNot}
            demonOnly={demonOnly}
            setDemonOnly={setDemonOnly}
            demonNot={demonNot}
            setDemonNot={setDemonNot}
            danielOnly={danielOnly}
            setDanielOnly={setDanielOnly}
            danielNot={danielNot}
            setDanielNot={setDanielNot}
            postexilicOnly={postexilicOnly}
            setPostexilicOnly={setPostexilicOnly}
            postexilicNot={postexilicNot}
            setPostexilicNot={setPostexilicNot}
            selectedIconFilters={selectedIconFilters}
            toggleIconFilter={toggleIconFilter}
            updateIconFilterOperator={updateIconFilterOperator}
            updateAllIconFilterOperators={updateAllIconFilterOperators}
            iconFilterMode={iconFilterMode}
            setIconFilterMode={setIconFilterMode}
          />
        )}
        {/* Card grid */}
        {visibleCards.length > 0 ? (
          <>
          {/* Sort + count bar */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-4 mt-2 sm:mt-4">
            {visibleCards.map((c, cardIndex) => {
              const quantityInDeck = getCardQuantity(c.name, c.set, false);
              const quantityInReserve = getCardQuantity(c.name, c.set, true);
              const isMenuOpen = openSearchMenuCard === c.dataLine;
              return (
                <div
                  key={c.dataLine}
                  className="relative cursor-pointer group rounded overflow-hidden transition-all duration-200"
                >
                  {/* Backdrop overlay when menu is open */}
                  {isMenuOpen && (
                    <div
                      className="absolute inset-0 bg-black/60 backdrop-blur-sm z-30 rounded"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenSearchMenuCard(null);
                      }}
                    />
                  )}

                  {/* Menu items overlay */}
                  {isMenuOpen && (
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1.5 py-4 z-40">
                      {/* Add to Main Deck */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          addCard(c, false);
                          setOpenSearchMenuCard(null);
                        }}
                        className="w-10 h-10 hover:scale-110 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-200 transition-all"
                        title="Add to deck"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>

                      {/* Add to Reserve */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          addCard(c, true);
                          setOpenSearchMenuCard(null);
                        }}
                        className="w-10 h-10 hover:scale-110 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-200 transition-all"
                        title="Add to reserve"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                        </svg>
                      </button>

                      {/* Remove from Deck (only if card is in deck) */}
                      {quantityInDeck > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeCard(c.name, c.set, false);
                            setOpenSearchMenuCard(null);
                          }}
                          className="w-10 h-10 hover:scale-110 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-300 dark:border-gray-600 flex items-center justify-center text-red-600 dark:text-red-400 transition-all"
                          title="Remove from deck"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" />
                          </svg>
                        </button>
                      )}

                      {/* Remove from Reserve (only if card is in reserve) */}
                      {quantityInReserve > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeCard(c.name, c.set, true);
                            setOpenSearchMenuCard(null);
                          }}
                          className="w-10 h-10 hover:scale-110 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-300 dark:border-gray-600 flex items-center justify-center text-orange-600 dark:text-orange-400 transition-all"
                          title="Remove from reserve"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Card Image - Click to view modal */}
                  <div
                    className="relative overflow-hidden rounded"
                    onClick={() => setModalCard(c)}
                  >
                    <CardImage
                      imgFile={c.imgFile}
                      alt={c.name}
                      className="rounded w-full"
                      sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 16vw"
                    />

                    {/* Controls Overlay - Centered on Card */}
                    <div className="absolute inset-0 flex items-center justify-center transition-opacity duration-200">
                      <div className="flex items-center gap-3 md:gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeCard(c.name, c.set, activeDeckTab === "reserve");
                          }}
                          className="flex w-11 h-11 md:w-9 md:h-9 items-center justify-center rounded-lg bg-black/50 md:bg-black/30 md:hover:bg-black/50 backdrop-blur-md text-white transition-all font-bold text-2xl md:text-xl border border-white/20 md:opacity-0 md:group-hover:opacity-100 md:pointer-events-none md:group-hover:pointer-events-auto"
                          aria-label="Remove card"
                          title="Remove card from deck"
                        >
                          −
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            addCard(c, activeDeckTab === "reserve");
                          }}
                          className="flex w-11 h-11 md:w-9 md:h-9 items-center justify-center rounded-lg bg-black/50 md:bg-black/30 md:hover:bg-black/50 backdrop-blur-md text-white transition-all font-bold text-2xl md:text-xl border border-white/20 md:opacity-0 md:group-hover:opacity-100 md:pointer-events-none md:group-hover:pointer-events-auto"
                          aria-label="Add card"
                          title="Add card to deck"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Menu Button - Bottom Left */}
                    <div className="absolute bottom-0.5 left-0.5 z-10">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenSearchMenuCard(isMenuOpen ? null : c.dataLine);
                        }}
                        className="w-9 h-9 md:w-7 md:h-7 flex items-center justify-center rounded-lg md:rounded-md bg-black/50 md:bg-black/30 hover:bg-black/50 backdrop-blur-md text-white transition-all border border-white/20 md:opacity-0 md:group-hover:opacity-100 md:pointer-events-none md:group-hover:pointer-events-auto"
                        aria-label="Card options"
                      >
                        <svg className="w-5 h-5 md:w-4 md:h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
                        </svg>
                      </button>
                    </div>


                    {/* Quantity Badge - Bottom Right, Always Visible */}
                    {(quantityInDeck > 0 || quantityInReserve > 0) && (
                      <div className="absolute bottom-1 right-1 flex flex-col items-end gap-0.5">
                        {quantityInDeck > 0 && (
                          <div key={`m${quantityInDeck}`} className="animate-qty-pop bg-black/75 backdrop-blur-sm text-white px-1.5 py-0.5 rounded font-bold text-xs shadow-lg">
                            ×{quantityInDeck}
                          </div>
                        )}
                        {quantityInReserve > 0 && (
                          <div key={`r${quantityInReserve}`} className="animate-qty-pop bg-black/75 backdrop-blur-sm text-white px-1.5 py-0.5 rounded font-bold text-xs shadow-lg">
                            ×{quantityInReserve} R
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <p className="text-xs sm:text-sm mt-1 text-center truncate hidden sm:block">{c.name}</p>
                  {(() => {
                    const priceKey = `${c.name}|${c.set}|${c.imgFile}`;
                    const priceInfo = getPrice(priceKey);
                    return priceInfo ? (
                      <p className="text-xs sm:text-xs text-center text-gray-500 dark:text-gray-400 font-medium">${priceInfo.price.toFixed(2)}</p>
                    ) : null;
                  })()}
                </div>
              );
            })}
          </div>
          <div className="py-3 text-center text-xs sm:text-sm text-muted-foreground">
            Showing {Math.min(visibleCount, filtered.length)} of {filtered.length}
          </div>
          {visibleCount < filtered.length && (
            <div ref={sentinelRef} className="h-8 flex items-center justify-center mt-2">
              <div className="text-sm text-gray-400 dark:text-gray-500">Loading more...</div>
            </div>
          )}
          </>
        ) : (
          <div className="flex items-center justify-center mt-16 mb-16">
            <div className="text-center">
              <p className="text-xl text-gray-500 dark:text-gray-400 mb-2">Ready to filter cards</p>
              <p className="text-sm text-gray-400 dark:text-gray-500">Use the search or filters above to find cards</p>
            </div>
          </div>
        )}
      </main>
        </div>
        </div>
      )}

      {/* Spotlight Mode Toggle - Desktop only */}
      <button
        onClick={() => {
          const newMode = mode === "spotlight" ? "deck" : "spotlight";
          setMode(newMode);
          if (newMode === "spotlight") {
            setShowDeckBuilder(true);
            setShowSearch(true);
          }
        }}
        className={`hidden md:flex fixed top-20 right-4 z-50 items-center gap-2 px-3 py-2 rounded-lg shadow-lg transition-all text-sm font-medium ${
          isSpotlight
            ? "bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/30"
            : "bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600"
        }`}
        title="Spotlight Mode — preview cards for streaming"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        Spotlight
      </button>

      {/* Central Divider with Toggle Buttons */}
      {showSearch && showDeckBuilder && (
        <div
          className="hidden md:flex relative bg-gradient-to-b from-transparent via-gray-300 to-transparent dark:via-gray-700 hover:via-blue-400 dark:hover:via-blue-500 items-center justify-center cursor-ew-resize select-none transition-colors flex-shrink-0"
          style={{ width: '6px' }}
          onMouseDown={handleResizeStart}
          title="Drag to resize panels"
        >
          {/* Toggle buttons container - centered vertically */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-3 z-10">
            {/* Hide Search Button */}
            <button
              onClick={() => setShowSearch(false)}
              className="group relative w-7 h-7 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 hover:border-blue-500 dark:hover:border-green-600 flex items-center justify-center"
              title="Hide search panel"
            >
              <svg className="w-3 h-3 text-gray-500 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15 19l-7-7 7-7" />
              </svg>
              {/* Tooltip */}
              <span className="absolute left-full ml-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none shadow-lg">
                Hide Search (right arrow key)
              </span>
            </button>
            
            {/* Hide Deck Button */}
            <button
              onClick={() => setShowDeckBuilder(false)}
              className="group relative w-7 h-7 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 hover:border-blue-500 dark:hover:border-green-600 flex items-center justify-center"
              title="Hide deck builder"
            >
              <svg className="w-3 h-3 text-gray-500 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 5l7 7-7 7" />
              </svg>
              {/* Tooltip */}
              <span className="absolute left-full ml-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none shadow-lg">
                Hide Deck (left arrow key)
              </span>
            </button>
          </div>
        </div>
      )}
      
      {/* Floating restore buttons (when panels are hidden) */}
      {!showSearch && (
        <button
          onClick={() => setShowSearch(true)}
          className="hidden md:flex fixed left-0 top-1/2 -translate-y-1/2 z-50 flex-col items-center gap-2 px-2 py-4 bg-gradient-to-r from-blue-600 to-blue-500 dark:from-blue-700 dark:to-blue-600 rounded-r-xl shadow-2xl hover:shadow-blue-500/50 dark:hover:shadow-blue-700/50 transition-all hover:pl-3 text-white font-medium group border-r-4 border-green-600 dark:border-blue-500"
          title="Show search panel"
        >
          <svg className="w-4 h-4 group-hover:scale-105 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="text-xs font-semibold whitespace-nowrap [writing-mode:vertical-lr] rotate-180 tracking-wider">SEARCH</span>
        </button>
      )}
      
      {!showDeckBuilder && (
        <button
          onClick={() => setShowDeckBuilder(true)}
          className="hidden md:flex fixed right-0 top-1/2 -translate-y-1/2 z-50 flex-col items-center gap-3 px-4 py-8 bg-gradient-to-l from-purple-600 to-purple-500 dark:from-purple-700 dark:to-purple-600 rounded-l-2xl shadow-2xl hover:shadow-purple-500/50 dark:hover:shadow-purple-700/50 transition-all hover:pr-6 text-white font-medium group border-l-4 border-purple-400 dark:border-purple-500"
          title="Show deck builder"
        >
          <svg className="w-6 h-6 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span className="text-xs font-semibold whitespace-nowrap [writing-mode:vertical-lr] rotate-180 tracking-wider">DECK</span>
        </button>
      )}
      
      {/* Right panel: Deck builder (hidden on mobile, toggleable on desktop) */}
      {showDeckBuilder && (
        <div
          className="hidden md:flex flex-col overflow-visible flex-shrink-0"
          style={{ width: showSearch ? `${deckPanelWidth}%` : '100%' }}
        >
          {isSpotlight ? (
            <SpotlightPanel
              card={spotlightCard}
              price={
                spotlightCard
                  ? (() => {
                      const priceKey = `${spotlightCard.name}|${spotlightCard.set}|${spotlightCard.imgFile}`;
                      const priceInfo = getPrice(priceKey);
                      return priceInfo ? priceInfo.price : null;
                    })()
                  : null
              }
              onClear={() => setSpotlightCard(null)}
            />
          ) : isInitializing ? (
            <div className="flex-1 flex items-center justify-center bg-background">
              <div className="text-muted-foreground text-sm">Loading deck...</div>
            </div>
          ) : (
          <DeckBuilderPanel
            deck={deck}
            syncStatus={syncStatus}
            hasUnsavedChanges={hasUnsavedChanges}
            isAuthenticated={!!user}
            isExpanded={!showSearch}
            deckCheckResult={deckCheckResult}
            isDeckChecking={isDeckChecking}
            allCards={cards}
            onToggleExpand={() => setShowSearch(prev => !prev)}
            onDeckNameChange={setDeckName}
            onDeckFormatChange={handleDeckFormatChange}
            onParagonChange={setDeckParagon}
            onDeckPublicChange={setDeckPublic}
            onSaveDeck={saveDeckToCloud}
            onAddCard={(cardName, cardSet, isReserve) => {
              // Find the card in the cards array
              const card = cards.find(c => c.name === cardName && c.set === cardSet);
              if (card) {
                addCard(card, isReserve);
              }
            }}
            onRemoveCard={(cardName, cardSet, isReserve) => {
              removeCard(cardName, cardSet, isReserve);
            }}
            onExport={handleExportDeck}
            onDownload={handleDownloadDeck}
            onImport={() => setShowImportModal(true)}
            onDelete={handleDeleteDeck}
            onDuplicate={() => {
              // Duplicate will be handled internally by DeckBuilderPanel
              // Just need to provide the callback for re-rendering
            }}
            onNewDeck={handleNewDeck}
            onLoadDeck={loadDeckFromCloud}
            defaultTab={activeDeckTab}
            onActiveTabChange={setActiveDeckTab}
            onViewCard={(card, isReserve) => {
              setFullDeckViewSection(isReserve ? 'reserve' : 'main');
              setModalCard(card);
            }}
            onNotify={(message, type) => {
              setNotification({ message, type });
              setTimeout(() => setNotification(null), 3000);
            }}
            onPreviewCardsChange={setPreviewCards}
            onDescriptionChange={setDeckDescription}
          />
          )}
        </div>
      )}
      
      {/* Mobile Reserve Indicator - shows on Search tab when Reserve is active */}
      {!isMobileDeckDrawerOpen && activeDeckTab === "reserve" && (
        <div className="md:hidden fixed bottom-14 inset-x-0 z-50 flex justify-center pointer-events-none pb-[env(safe-area-inset-bottom)]">
          <div className="pointer-events-auto bg-amber-500 dark:bg-amber-600 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-lg flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            +/− adds to Reserve
          </div>
        </div>
      )}

      {/* Mobile Bottom Nav */}
      <MobileBottomNav
        isDeckOpen={isMobileDeckDrawerOpen}
        onToggleDeck={() => {
          setIsMobileDeckDrawerOpen(prev => {
            if (!prev) setModalCard(null); // Close card carousel when opening deck
            return !prev;
          });
        }}
        deckCardCount={getDeckStats().mainDeckCount + getDeckStats().reserveCount}
        onSaveDeck={saveDeckToCloud}
        hasUnsavedChanges={hasUnsavedChanges}
        isSaving={syncStatus?.isSaving}
        isAuthenticated={!!user}
      />

      {/* Mobile Deck View (replaces search when Deck tab is active) */}
      {isMobileDeckDrawerOpen && (
        <div className="md:hidden fixed inset-x-0 top-[64px] bottom-[3.5rem] z-40 bg-white dark:bg-gray-900 flex flex-col overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {isInitializing ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-gray-400 dark:text-gray-500 text-sm">Loading deck...</div>
            </div>
          ) : (
            <DeckBuilderPanel
              deck={deck}
              syncStatus={syncStatus}
              hasUnsavedChanges={hasUnsavedChanges}
              isAuthenticated={!!user}
              isExpanded={false}
              forceDisableHoverPreview
              deckCheckResult={deckCheckResult}
              isDeckChecking={isDeckChecking}
              allCards={cards}
              onDeckNameChange={setDeckName}
              onDeckFormatChange={handleDeckFormatChange}
              onParagonChange={setDeckParagon}
              onDeckPublicChange={setDeckPublic}
              onSaveDeck={saveDeckToCloud}
              onAddCard={(cardName, cardSet, isReserve) => {
                const card = cards.find(c => c.name === cardName && c.set === cardSet);
                if (card) {
                  addCard(card, isReserve);
                }
              }}
              onRemoveCard={(cardName, cardSet, isReserve) => {
                removeCard(cardName, cardSet, isReserve);
              }}
              onExport={handleExportDeck}
              onDownload={handleDownloadDeck}
              onImport={() => setShowImportModal(true)}
              onDelete={handleDeleteDeck}
              onDuplicate={() => {}}
              onNewDeck={handleNewDeck}
              onLoadDeck={loadDeckFromCloud}
              defaultTab={activeDeckTab}
              onActiveTabChange={setActiveDeckTab}
              onViewCard={(card, isReserve) => {
                setFullDeckViewSection(isReserve ? 'reserve' : 'main');
                modalOpenedFromDeckRef.current = true;
                setModalCard(card);
                setIsMobileDeckDrawerOpen(false);
              }}
              onNotify={(message, type) => {
                setNotification({ message, type });
                setTimeout(() => setNotification(null), 3000);
              }}
              onPreviewCardsChange={setPreviewCards}
              onDescriptionChange={setDeckDescription}
            />
          )}
        </div>
      )}

      {/* Import modal */}
      {showImportModal && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => {
            setShowImportModal(false);
            setImportText("");
            setImportErrors([]);
          }}
        >
          <div 
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
              Import Deck
            </h3>
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-4 space-y-2">
              <p>
                <strong>From Lackey CCG:</strong> Click the "Copy" button in your deck editor, then paste here.
              </p>
              <p>
                <strong>Format:</strong> Each line should be: <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">Quantity[TAB]Card Name</code>
              </p>
              <p className="text-xs">
                Add "Reserve:" on its own line to separate reserve cards.
              </p>
            </div>
            <textarea
              id="import-deck-textarea"
              className="w-full h-64 p-3 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm"
              placeholder={`1\tSon of God "Manger" (Promo)\n1\tThe Second Coming (CoW AB)\n1\tAngel of the Lord (2017 Promo)\n\nReserve:\n1\tGibeonite Trickery (Roots)\n1\tNot Among You`}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              autoFocus
            />
            {importErrors.length > 0 && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
                <p className="text-sm font-semibold text-red-800 dark:text-red-300 mb-2">
                  Import Warnings:
                </p>
                <ul className="text-xs text-red-700 dark:text-red-400 list-disc list-inside space-y-1">
                  {importErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-6 flex gap-3 items-center">
              <label
                htmlFor="import-deck-file"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded cursor-pointer transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
                Upload .txt
              </label>
              <input
                id="import-deck-file"
                type="file"
                accept=".txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      const text = event.target?.result as string;
                      setImportText(text);
                    };
                    reader.readAsText(file);
                  }
                  e.target.value = "";
                }}
              />
              <div className="ml-auto flex gap-3">
              <button
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                onClick={() => {
                  setShowImportModal(false);
                  setImportText("");
                  setImportErrors([]);
                }}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-700 text-white rounded hover:bg-green-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => handleImportDeck(importText)}
                disabled={!importText.trim()}
              >
                Import
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved Changes Modal */}
      {showUnsavedChangesModal && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setShowUnsavedChangesModal(false)}
        >
          <div 
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header - Less vibrant, more subtle */}
            <div className="bg-gradient-to-r from-slate-600 to-slate-700 dark:from-slate-700 dark:to-slate-800 px-6 py-5">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-white/10 backdrop-blur-sm rounded-xl flex items-center justify-center">
                  <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-white mb-1">Save to Cloud?</h3>
                  <p className="text-sm text-slate-200">Your deck is saved locally on this device</p>
                </div>
              </div>
            </div>
            
            {/* Content */}
            <div className="px-6 py-6">
              <p className="text-gray-600 dark:text-gray-300 mb-5 leading-relaxed">
                Your deck is saved locally. {user ? 'Would you like to save it to the cloud before continuing?' : 'Sign in to save it to the cloud and access it from any device.'}
              </p>
              
              {/* Deck info card */}
              <div className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900/50 dark:to-gray-900/30 rounded-xl p-4 border border-gray-200 dark:border-gray-700 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-green-600/10 dark:bg-green-600/20 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900 dark:text-white text-base">
                      {deck.name || "Untitled Deck"}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                      <span>{getDeckStats().mainDeckCount + getDeckStats().reserveCount} cards</span>
                      <span className="text-gray-400 dark:text-gray-600">•</span>
                      <span>{deck.format || "Type 1"}</span>
                    </div>
                  </div>
                </div>
                {!user && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2">
                      <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Sign in to save your deck to the cloud</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
            
            {/* Actions - Using tournament modal style */}
            <div className="px-6 py-5 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
              <div className="flex flex-col gap-3">
                <button
                  onClick={async () => {
                    if (user) {
                      try {
                        const saveResult = await saveDeckToCloud();
                        if (saveResult?.deckCheckResult) {
                          setDeckCheckResult(saveResult.deckCheckResult);
                        }
                        setNotification({ message: 'Deck saved successfully!', type: 'success' });
                        setTimeout(() => setNotification(null), 3000);

                        // Wait a bit for save to complete, then navigate
                        setTimeout(() => {
                          if (pendingNavigation) {
                            pendingNavigation();
                          }
                        }, 500);
                      } catch (error) {
                        setNotification({ message: 'Failed to save deck', type: 'error' });
                        setTimeout(() => setNotification(null), 3000);
                      }
                    }
                    setShowUnsavedChangesModal(false);
                    setPendingNavigation(null);
                  }}
                  disabled={!user}
                  className="w-full px-6 py-3 bg-white dark:bg-gray-800 rounded-lg transition-all font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border-2 hover:bg-green-50 dark:hover:bg-green-950/20"
                  style={{
                    borderImage: 'linear-gradient(to right, rgb(34 197 94), rgb(59 130 246)) 1',
                  }}
                >
                  <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  <span className="text-gray-900 dark:text-white">
                    Save & Continue
                  </span>
                </button>

                {/* Leave without saving - Destructive action */}
                <button
                  onClick={() => {
                    // Clear unsaved changes flag to prevent browser warning
                    clearUnsavedChanges();
                    
                    // Close modal first
                    setShowUnsavedChangesModal(false);
                    setPendingNavigation(null);
                    
                    // Navigate after a brief delay to ensure state updates
                    setTimeout(() => {
                      if (pendingNavigation) {
                        pendingNavigation();
                      }
                    }, 0);
                  }}
                  className="w-full px-6 py-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg transition-all font-semibold flex items-center justify-center gap-2 border-2 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                  Leave without saving
                </button>

                {/* Cancel - Close modal */}
                <button
                  onClick={() => {
                    setShowUnsavedChangesModal(false);
                    setPendingNavigation(null);
                  }}
                  className="w-full px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* New Deck Confirmation Modal */}
      {showNewDeckModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150"
          onClick={() => setShowNewDeckModal(false)}
        >
          <div
            className="bg-card text-card-foreground rounded-xl w-full max-w-md animate-in zoom-in-95 duration-200"
            style={{ boxShadow: '0 16px 40px rgba(0, 20, 80, 0.15)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <h3 className="text-lg font-semibold text-foreground mb-3">
                {!user ? 'Create New Deck?' : hasUnsavedChanges ? 'Unsaved Changes' : 'Create New Deck?'}
              </h3>

              {!user ? (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Your current deck will be lost — it&apos;s only saved locally on this device. Sign in to save multiple decks to the cloud.
                </p>
              ) : hasUnsavedChanges && deck.name === "Untitled Deck" ? (
                <NewDeckRenameForm
                  onSubmit={(newName) => proceedWithNewDeck(true, newName)}
                  onSkip={() => proceedWithNewDeck(true)}
                  onDiscard={() => proceedWithNewDeck(false)}
                  onCancel={() => setShowNewDeckModal(false)}
                />
              ) : hasUnsavedChanges ? (
                <>
                  <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                    Save changes to <strong className="text-foreground">{deck.name}</strong> before creating a new deck?
                  </p>
                  <div className="bg-muted/60 rounded-lg p-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                      </div>
                      <div>
                        <div className="font-medium text-foreground text-sm">{deck.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {getDeckStats().mainDeckCount + getDeckStats().reserveCount} cards · {deck.format || "Type 1"}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Start a fresh deck?
                </p>
              )}

              {/* Actions */}
              {(!user || !hasUnsavedChanges || deck.name !== "Untitled Deck") && (
                <div className="mt-5 flex flex-col gap-2.5">
                  {user && hasUnsavedChanges && (
                    <button
                      onClick={() => proceedWithNewDeck(true)}
                      className="w-full px-5 py-2.5 bg-primary/85 text-primary-foreground rounded-lg transition-all font-semibold text-sm hover:bg-primary"
                    >
                      Save & Create New
                    </button>
                  )}

                  {!user && (
                    <button
                      onClick={() => {
                        setShowNewDeckModal(false);
                        router.push('/sign-in');
                      }}
                      className="w-full px-5 py-2.5 bg-primary/85 text-primary-foreground rounded-lg transition-all font-semibold text-sm hover:bg-primary"
                    >
                      Sign In to Save Decks
                    </button>
                  )}

                  <button
                    onClick={() => proceedWithNewDeck(false)}
                    className={`w-full px-5 py-2.5 rounded-lg transition-all text-sm ${
                      (user && hasUnsavedChanges) || !user
                        ? 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground'
                        : 'bg-primary/85 text-primary-foreground font-semibold hover:bg-primary'
                    }`}
                  >
                    {user && hasUnsavedChanges ? "Don\u2019t Save" : !user ? "Discard & Start New" : "Create New Deck"}
                  </button>

                  <button
                    onClick={() => setShowNewDeckModal(false)}
                    className="w-full px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* General notification */}
      {notification && (
        <div className={`fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in ${
          notification.type === 'success' ? 'bg-green-600 text-white' :
          notification.type === 'error' ? 'bg-red-600 text-white' :
          'bg-green-700 text-white'
        }`}>
          {notification.message}
        </div>
      )}
      
      {/* Export notification */}
      {exportNotification && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in">
          Deck copied to clipboard!
        </div>
      )}
    </div>
    </>
  );
}