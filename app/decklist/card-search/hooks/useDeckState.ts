import { useState, useEffect, useCallback, useRef } from "react";
import { Card, sanitizeImgFile } from "../utils";
import { Deck, DeckCard, DeckStats } from "../types/deck";
import { saveDeckAction, loadDeckByIdAction, DeckCardData } from "../../actions";
import { CARD_BY_FULL_KEY } from "../data/cardIndex";

const STORAGE_KEY = "redemption-deck-builder-current-deck";
const AUTOSAVE_DEBOUNCE_MS = 1500;

// Stable serialization of the persisted parts of a deck for change detection.
// Used to skip redundant autosaves and to drive the "in-flight changes" indicator.
function snapshotDeck(d: Deck): string {
  const sortedCards = d.cards
    .map((c) => `${c.card.name}|${c.card.set}|${c.quantity}|${c.isReserve ? 1 : 0}`)
    .sort()
    .join("§");
  return JSON.stringify({
    id: d.id ?? null,
    name: d.name,
    description: d.description ?? "",
    format: d.format ?? null,
    paragon: d.paragon ?? null,
    folderId: d.folderId ?? null,
    isPublic: d.isPublic ?? false,
    previewCard1: d.previewCard1 ?? null,
    previewCard2: d.previewCard2 ?? null,
    cards: sortedCards,
  });
}

/**
 * Sync status for cloud operations
 */
export interface SyncStatus {
  isSaving: boolean;
  lastSavedAt: Date | null;
  error: string | null;
}

export interface UseDeckStateOptions {
  /** Whether to auto-save deck changes to the cloud (debounced). Requires the user to be authenticated. */
  autosaveEnabled?: boolean;
}

/**
 * Custom hook for managing deck state with localStorage persistence and cloud sync
 */
export function useDeckState(
  initialDeckId?: string,
  initialFolderId?: string | null,
  isNewDeck?: boolean,
  options?: UseDeckStateOptions
) {
  const autosaveEnabled = options?.autosaveEnabled ?? false;
  // Initialize with default deck to avoid hydration mismatch
  const [deck, setDeck] = useState<Deck>(getDefaultDeck);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isSaving: false,
    lastSavedAt: null,
    error: null,
  });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const isInitialMount = useRef(true);
  const hasLoadedFromStorage = useRef(false);

  // Mirror of `deck` for use inside async callbacks (autosave reads the latest deck via ref)
  const deckRef = useRef(deck);
  // Snapshot of the most recently saved (or just-loaded) deck — used to dedup autosaves
  const lastSavedSnapshotRef = useRef<string | null>(null);
  // Serializes saves so a manual + debounced autosave can't race
  const savePromiseRef = useRef<Promise<unknown> | null>(null);
  // Pending autosave debounce timer
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    deckRef.current = deck;
  }, [deck]);

  // Track the initial params to avoid re-running on hydration changes
  const initialParamsRef = useRef<{ deckId?: string; isNew?: boolean; initialized: boolean }>({ initialized: false });

  // Load from localStorage on client mount (after hydration)
  // Use a small delay to ensure searchParams has hydrated
  useEffect(() => {
    // Skip if already processed or if still on first render before hydration settles
    if (hasLoadedFromStorage.current) return;
    
    // Wait a tick for searchParams to hydrate properly
    const timer = setTimeout(() => {
      if (hasLoadedFromStorage.current) return;
      
      // Mark the initial params we're working with
      if (!initialParamsRef.current.initialized) {
        initialParamsRef.current = { deckId: initialDeckId, isNew: isNewDeck, initialized: true };
      }
      
      // Only load from storage if no deckId and not creating new deck
      if (!initialDeckId && !isNewDeck) {
        const storedDeck = loadDeckFromStorage();
        // Only update if there's actually a deck in storage (not just the default)
        if (storedDeck.cards.length > 0 || storedDeck.name !== "Untitled Deck" || storedDeck.id) {
          setDeck(storedDeck);
        }
      }
      hasLoadedFromStorage.current = true;
      setIsInitializing(false);
    }, 0);
    
    return () => clearTimeout(timer);
  }, [initialDeckId, isNewDeck]);

  // Persist deck to localStorage whenever it changes
  useEffect(() => {
    saveDeckToStorage(deck);

    // Derive the dirty flag from the saved-snapshot ref so it reflects reality
    // after both edits and successful saves (rather than always flipping to true).
    if (!isInitialMount.current) {
      setHasUnsavedChanges(snapshotDeck(deck) !== lastSavedSnapshotRef.current);
    }
  }, [deck]);

  // Load deck from cloud on mount if deckId provided, or create new deck with folderId if provided
  useEffect(() => {
    if (initialDeckId && isInitialMount.current) {
      // Load existing deck from cloud
      loadDeckFromCloud(initialDeckId);
    } else if (isNewDeck && isInitialMount.current) {
      // Create a fresh blank deck (with optional folderId)
      console.log('[useDeckState] Creating new deck with folderId:', initialFolderId);
      setDeck({
        name: "Untitled Deck",
        cards: [],
        description: "",
        format: undefined,
        folderId: initialFolderId || undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setHasUnsavedChanges(false);
      setIsInitializing(false);
    }
    isInitialMount.current = false;
  }, [initialDeckId, initialFolderId, isNewDeck]);

  /**
   * Load deck from cloud by ID
   */
  const loadDeckFromCloud = useCallback(async (deckId: string) => {
    try {
      setSyncStatus({ isSaving: false, lastSavedAt: null, error: null });
      
      const result = await loadDeckByIdAction(deckId);
      
      if (result.success && result.deck) {
        const cloudDeck = result.deck;
        const isOwner = result.isOwner ?? false;

        // Convert database format to Deck format with full card data
        // If not the owner, clear the ID so saving creates a new copy instead of trying to update
        const loadedDeck: Deck = {
          id: isOwner ? cloudDeck.id : undefined,
          name: isOwner ? cloudDeck.name : `Copy of ${cloudDeck.name}`,
          description: cloudDeck.description || "",
          format: cloudDeck.format,
          paragon: cloudDeck.paragon,
          folderId: cloudDeck.folder_id,
          isPublic: cloudDeck.is_public ?? false,
          previewCard1: cloudDeck.preview_card_1 ?? null,
          previewCard2: cloudDeck.preview_card_2 ?? null,
          cards: cloudDeck.cards.map((dbCard: any) => {
            // Reconstruct the lookup key
            const key = `${dbCard.card_name}|${dbCard.card_set}|${sanitizeImgFile(dbCard.card_img_file)}`;
            const fullCard = CARD_BY_FULL_KEY.get(key);
            
            if (fullCard) {
              // Use full card data from database
              return {
                card: fullCard,
                quantity: dbCard.quantity,
                isReserve: dbCard.is_reserve,
              };
            } else {
              // Fallback: create minimal card object if not found
              console.warn(`Card not found in database: ${dbCard.card_name} (${dbCard.card_set})`);
              return {
                card: {
                  dataLine: "",
                  name: dbCard.card_name,
                  set: dbCard.card_set,
                  imgFile: sanitizeImgFile(dbCard.card_img_file),
                  officialSet: "",
                  type: "Unknown",
                  brigade: "",
                  strength: "",
                  toughness: "",
                  class: "",
                  identifier: "",
                  specialAbility: "",
                  rarity: "",
                  reference: "",
                  alignment: "",
                  legality: "",
                  testament: "",
                  isGospel: false,
                } as Card,
                quantity: dbCard.quantity,
                isReserve: dbCard.is_reserve,
              };
            }
          }),
          createdAt: new Date(cloudDeck.created_at),
          updatedAt: new Date(cloudDeck.updated_at),
        };

        // Mark the loaded deck as the baseline so autosave doesn't immediately re-save it
        lastSavedSnapshotRef.current = snapshotDeck(loadedDeck);
        setDeck(loadedDeck);
        setHasUnsavedChanges(false);
        setIsInitializing(false);
        setSyncStatus({
          isSaving: false,
          lastSavedAt: new Date(cloudDeck.updated_at),
          error: null,
        });
      } else {
        setIsInitializing(false);
        setSyncStatus({
          isSaving: false,
          lastSavedAt: null,
          error: result.error || "Failed to load deck",
        });
      }
    } catch (error) {
      console.error("Error loading deck from cloud:", error);
      setIsInitializing(false);
      setSyncStatus({
        isSaving: false,
        lastSavedAt: null,
        error: "Failed to load deck",
      });
    }
  }, []);

  /**
   * Save current deck to cloud
   */
  const saveDeckToCloud = useCallback(async (overrideName?: string, overrideDeck?: Deck) => {
    const isExplicitCall = overrideName !== undefined || overrideDeck !== undefined;

    // Serialize: chain this save behind any in-flight one so autosave + manual save can't race
    const previous = savePromiseRef.current;
    const next = (async () => {
      if (previous) {
        try { await previous; } catch { /* prior caller already saw the error */ }
      }

      try {
        const targetDeck = overrideDeck ?? deckRef.current;

        // Autosave path: skip if nothing has changed since the last successful save
        if (!isExplicitCall && snapshotDeck(targetDeck) === lastSavedSnapshotRef.current) {
          return { success: true, deckCheckResult: null, skipped: true } as const;
        }

        setSyncStatus({ isSaving: true, lastSavedAt: null, error: null });

        // Convert Deck format to database format
        // Filter out cards with quantity <= 0 to avoid database constraint violations
        const cardsData: DeckCardData[] = targetDeck.cards
          .filter((deckCard) => deckCard.quantity > 0)
          .map((deckCard) => ({
            card_name: deckCard.card.name,
            card_set: deckCard.card.set,
            card_img_file: deckCard.card.imgFile,
            quantity: deckCard.quantity,
            is_reserve: deckCard.isReserve,
          }));

        // Use user-selected preview cards if set, otherwise auto-compute
        let previewCard1 = targetDeck.previewCard1 ?? null;
        let previewCard2 = targetDeck.previewCard2 ?? null;
        if (!previewCard1 || !previewCard2) {
          const mainCards = targetDeck.cards.filter(dc => !dc.isReserve && dc.quantity > 0);
          const heroTypes = ['Hero', 'HC', 'Hero Character'];
          const evilTypes = ['Evil Character', 'EC'];
          const firstHero = mainCards.find(dc => heroTypes.includes(dc.card.type));
          const firstEvil = mainCards.find(dc => evilTypes.includes(dc.card.type));
          previewCard1 = previewCard1 ?? firstHero?.card.imgFile ?? mainCards[0]?.card.imgFile ?? null;
          previewCard2 = previewCard2 ?? firstEvil?.card.imgFile ?? (mainCards.length > 1 ? mainCards[1]?.card.imgFile : null) ?? null;
        }

        const result = await saveDeckAction({
          deckId: targetDeck.id,
          name: overrideName || targetDeck.name,
          description: targetDeck.description,
          format: targetDeck.format,
          paragon: targetDeck.paragon,
          folderId: targetDeck.folderId,
          cards: cardsData,
          previewCard1,
          previewCard2,
        });

        if (result.success) {
          const savedId = result.deckId ?? targetDeck.id;
          // Snapshot the saved state (with its potentially-new id) so subsequent
          // autosaves correctly recognize there's nothing to do.
          lastSavedSnapshotRef.current = snapshotDeck({ ...targetDeck, id: savedId });

          // Update deck with the ID if it was newly created
          if (!targetDeck.id && result.deckId) {
            setDeck((prevDeck) => ({ ...prevDeck, id: result.deckId }));
          }

          setHasUnsavedChanges(false);
          setSyncStatus({
            isSaving: false,
            lastSavedAt: new Date(),
            error: null,
          });

          return { success: true, deckCheckResult: result.deckCheckResult ?? null } as const;
        } else {
          setSyncStatus({
            isSaving: false,
            lastSavedAt: null,
            error: result.error || "Failed to save deck",
          });

          return { success: false, error: result.error } as const;
        }
      } catch (error) {
        console.error("Error saving deck to cloud:", error);
        const errorMessage = "Failed to save deck";
        setSyncStatus({
          isSaving: false,
          lastSavedAt: null,
          error: errorMessage,
        });

        return { success: false, error: errorMessage } as const;
      }
    })();

    savePromiseRef.current = next;
    try {
      return await next;
    } finally {
      if (savePromiseRef.current === next) {
        savePromiseRef.current = null;
      }
    }
  }, []);

  // Autosave: 1.5s after the last edit, push the deck to the cloud.
  // Skips when not authenticated, while still hydrating, or when nothing has changed.
  useEffect(() => {
    if (!autosaveEnabled) return;
    if (isInitializing) return;
    if (isInitialMount.current) return;

    // Don't create DB rows for a brand-new pristine deck (no cards, no id)
    if (deck.cards.length === 0 && !deck.id) return;

    if (snapshotDeck(deck) === lastSavedSnapshotRef.current) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      // Errors surface via syncStatus; nothing to do here
      saveDeckToCloud().catch(() => { /* noop */ });
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [deck, autosaveEnabled, isInitializing, saveDeckToCloud]);

  /**
   * Add a card to the deck or increase its quantity
   */
  const addCard = useCallback((card: Card, isReserve: boolean = false) => {
    setDeck((prevDeck) => {
      const existingCardIndex = prevDeck.cards.findIndex(
        (dc) =>
          dc.card.name === card.name &&
          dc.card.set === card.set &&
          dc.isReserve === isReserve
      );

      let newCards: DeckCard[];

      if (existingCardIndex >= 0) {
        // Card exists, increment quantity (no limit)
        const existingCard = prevDeck.cards[existingCardIndex];

        newCards = [...prevDeck.cards];
        newCards[existingCardIndex] = {
          ...existingCard,
          quantity: existingCard.quantity + 1,
        };
      } else {
        // New card, add with quantity 1
        newCards = [
          ...prevDeck.cards,
          {
            card,
            quantity: 1,
            isReserve,
          },
        ];
      }

      return {
        ...prevDeck,
        cards: newCards,
        updatedAt: new Date(),
      };
    });
  }, []);

  /**
   * Remove a card from the deck or decrease its quantity
   */
  const removeCard = useCallback(
    (cardName: string, cardSet: string, isReserve: boolean = false) => {
      setDeck((prevDeck) => {
        const existingCardIndex = prevDeck.cards.findIndex(
          (dc) =>
            dc.card.name === cardName &&
            dc.card.set === cardSet &&
            dc.isReserve === isReserve
        );

        if (existingCardIndex < 0) {
          return prevDeck; // Card not found
        }

        const existingCard = prevDeck.cards[existingCardIndex];
        let newCards: DeckCard[];

        if (existingCard.quantity > 1) {
          // Decrease quantity
          newCards = [...prevDeck.cards];
          newCards[existingCardIndex] = {
            ...existingCard,
            quantity: existingCard.quantity - 1,
          };
        } else {
          // Remove card entirely
          newCards = prevDeck.cards.filter((_, i) => i !== existingCardIndex);
        }

        return {
          ...prevDeck,
          cards: newCards,
          updatedAt: new Date(),
        };
      });
    },
    []
  );

  /**
   * Update card quantity directly
   */
  const updateQuantity = useCallback(
    (
      cardName: string,
      cardSet: string,
      quantity: number,
      isReserve: boolean = false
    ) => {
      if (quantity < 0) {
        console.warn("Invalid quantity:", quantity);
        return;
      }

      setDeck((prevDeck) => {
        const existingCardIndex = prevDeck.cards.findIndex(
          (dc) =>
            dc.card.name === cardName &&
            dc.card.set === cardSet &&
            dc.isReserve === isReserve
        );

        if (existingCardIndex < 0) {
          return prevDeck; // Card not found
        }

        let newCards: DeckCard[];

        if (quantity === 0) {
          // Remove card
          newCards = prevDeck.cards.filter((_, i) => i !== existingCardIndex);
        } else {
          // Update quantity
          newCards = [...prevDeck.cards];
          newCards[existingCardIndex] = {
            ...newCards[existingCardIndex],
            quantity,
          };
        }

        return {
          ...prevDeck,
          cards: newCards,
          updatedAt: new Date(),
        };
      });
    },
    []
  );

  /**
   * Update deck name
   */
  const setDeckName = useCallback((name: string) => {
    setDeck((prevDeck) => ({
      ...prevDeck,
      name,
      updatedAt: new Date(),
    }));
  }, []);

  /**
   * Update deck description
   */
  const setDeckDescription = useCallback((description: string) => {
    setDeck((prevDeck) => ({
      ...prevDeck,
      description,
      updatedAt: new Date(),
    }));
  }, []);

  /**
   * Update deck format
   */
  const setDeckFormat = useCallback((format: string) => {
    setDeck((prevDeck) => ({
      ...prevDeck,
      format,
      updatedAt: new Date(),
    }));
  }, []);

  /**
   * Set deck's Paragon (for Paragon format)
   */
  const setDeckParagon = useCallback((paragon: string | undefined) => {
    setDeck((prevDeck) => ({
      ...prevDeck,
      paragon,
      updatedAt: new Date(),
    }));
  }, []);

  /**
   * Update deck public visibility (local state only — actual toggle calls server action separately)
   */
  const setDeckPublic = useCallback((isPublic: boolean) => {
    setDeck((prevDeck) => ({
      ...prevDeck,
      isPublic,
    }));
  }, []);

  /**
   * Set user-chosen preview/cover card img files
   */
  const setPreviewCards = useCallback((card1: string | null, card2: string | null) => {
    setDeck((prevDeck) => ({
      ...prevDeck,
      previewCard1: card1,
      previewCard2: card2,
      updatedAt: new Date(),
    }));
    setHasUnsavedChanges(true);
  }, []);

  /**
   * Clear all cards from deck and reset to new blank deck
   */
  const clearDeck = useCallback(() => {
    setDeck({
      id: undefined,
      name: "Untitled Deck",
      cards: [],
      description: "",
      format: undefined,
      folderId: undefined,
      isPublic: false,
      previewCard1: null,
      previewCard2: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }, []);

  /**
   * Reset deck to empty state with new name
   */
  const newDeck = useCallback((name: string = "Untitled Deck", folderId?: string | null) => {
    setDeck({
      name,
      cards: [],
      description: "",
      format: undefined,
      folderId: folderId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }, []);

  /**
   * Load a complete deck (for imports or loading from database)
   */
  const loadDeck = useCallback((newDeck: Deck) => {
    setDeck(newDeck);
  }, []);

  /**
   * Get quantity of a specific card in the deck
   */
  const getCardQuantity = useCallback(
    (cardName: string, cardSet: string, isReserve: boolean = false): number => {
      const deckCard = deck.cards.find(
        (dc) =>
          dc.card.name === cardName &&
          dc.card.set === cardSet &&
          dc.isReserve === isReserve
      );
      return deckCard?.quantity || 0;
    },
    [deck.cards]
  );

  /**
   * Calculate deck statistics
   */
  const getDeckStats = useCallback((): DeckStats => {
    const mainDeckCards = deck.cards.filter((dc) => !dc.isReserve);
    const reserveCards = deck.cards.filter((dc) => dc.isReserve);

    const mainDeckCount = mainDeckCards.reduce((sum, dc) => sum + dc.quantity, 0);
    const reserveCount = reserveCards.reduce((sum, dc) => sum + dc.quantity, 0);

    const cardsByType: Record<string, number> = {};
    const cardsByBrigade: Record<string, number> = {};

    deck.cards.forEach((dc) => {
      // Count by type
      const type = dc.card.type || "Unknown";
      cardsByType[type] = (cardsByType[type] || 0) + dc.quantity;

      // Count by brigade
      const brigade = dc.card.brigade || "None";
      cardsByBrigade[brigade] = (cardsByBrigade[brigade] || 0) + dc.quantity;
    });

    return {
      mainDeckCount,
      reserveCount,
      uniqueCards: deck.cards.length,
      cardsByType,
      cardsByBrigade,
    };
  }, [deck.cards]);

  /**
   * Clear the unsaved changes flag (useful when discarding changes)
   */
  const clearUnsavedChanges = useCallback(() => {
    setHasUnsavedChanges(false);
  }, []);

  return {
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
  };
}

/**
 * Load deck from localStorage
 */
function loadDeckFromStorage(): Deck {
  // Check if we're in the browser (not SSR)
  if (typeof window === 'undefined') {
    return getDefaultDeck();
  }
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Convert date strings back to Date objects
      return {
        ...parsed,
        createdAt: new Date(parsed.createdAt),
        updatedAt: new Date(parsed.updatedAt),
      };
    }
  } catch (error) {
    console.error("Error loading deck from storage:", error);
  }

  return getDefaultDeck();
}

/**
 * Get default empty deck
 */
function getDefaultDeck(): Deck {
  return {
    name: "Untitled Deck",
    cards: [],
    description: "",
    format: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Save deck to localStorage
 */
function saveDeckToStorage(deck: Deck): void {
  // Check if we're in the browser (not SSR)
  if (typeof window === 'undefined') {
    return;
  }
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
  } catch (error) {
    console.error("Error saving deck to storage:", error);
  }
}
