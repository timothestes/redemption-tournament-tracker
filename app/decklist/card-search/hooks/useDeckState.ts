import { useState, useEffect, useCallback, useRef } from "react";
import { Card, sanitizeImgFile, normalizeBrigadeField } from "../utils";
import { Deck, DeckCard, DeckStats } from "../types/deck";
import { saveDeckAction, loadDeckByIdAction, DeckCardData } from "../../actions";
import { CARD_DATA_URL, OT_BOOKS, NT_BOOKS, GOSPEL_BOOKS } from "../constants";

const STORAGE_KEY = "redemption-deck-builder-current-deck";

/**
 * Fetch and parse full card database
 */
async function fetchCardDatabase(): Promise<Map<string, Card>> {
  const response = await fetch(CARD_DATA_URL);
  const text = await response.text();
  const lines = text.split("\n");
  const dataLines = lines.slice(1).filter((l) => l.trim());
  
  const cardMap = new Map<string, Card>();
  
  dataLines.forEach((line) => {
    const cols = line.split("\t");
    const cardName = cols[0] || "";
    const cardSet = cols[1] || "";
    const imgFile = sanitizeImgFile(cols[2] || "");
    
    // Enhanced testament and gospel tagging logic
    const reference = cols[12] || "";
    let references: string[] = [];
    for (let refGroup of reference.split(";")) {
      refGroup = refGroup.trim();
      if (refGroup.includes("(") && refGroup.includes(")")) {
        const mainRef = refGroup.split("(")[0].trim();
        if (mainRef) references.push(mainRef);
        const parenContent = refGroup.substring(refGroup.indexOf("(") + 1, refGroup.indexOf(")"));
        const parenRefs = parenContent.split(",").map(pr => pr.trim()).filter(Boolean);
        references.push(...parenRefs);
      } else {
        if (refGroup) references.push(refGroup);
      }
    }
    
    const referencesLower = references.map(r => r.toLowerCase());
    function normalizeBookName(ref: string) {
      return ref.replace(/^(i{1,3}|1|2|3|4|one|two|three|four)\s+/i, '').trim();
    }
    
    const foundTestaments = new Set<string>();
    for (const ref of referencesLower) {
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
    
    const gospelBooksLower = GOSPEL_BOOKS.map(b => b.toLowerCase());
    const isGospel = referencesLower.some(ref => gospelBooksLower.some(b => ref.startsWith(b)));
    
    const rawBrigade = cols[5] || "";
    const alignment = cols[14] || "";
    let normalizedBrigades: string[] = [];
    try {
      normalizedBrigades = normalizeBrigadeField(rawBrigade, alignment, cardName);
    } catch (e) {
      normalizedBrigades = rawBrigade ? [rawBrigade] : [];
    }
    
    const card: Card = {
      dataLine: line,
      name: cardName,
      set: cardSet,
      imgFile: imgFile,
      officialSet: cols[3] || "",
      type: cols[4] || "",
      brigade: normalizedBrigades.join("/"),
      strength: cols[6] || "",
      toughness: cols[7] || "",
      class: cols[8] || "",
      identifier: cols[9] || "",
      specialAbility: cols[10] || "",
      rarity: cols[11] || "",
      reference: reference,
      alignment: alignment,
      legality: cols[15] || "",
      testament: Array.isArray(testament) ? testament.join("/") : testament,
      isGospel: isGospel,
    };
    
    // Use combination of name+set+imgFile as key for exact matching
    const key = `${cardName}|${cardSet}|${imgFile}`;
    cardMap.set(key, card);
  });
  
  return cardMap;
}

/**
 * Sync status for cloud operations
 */
export interface SyncStatus {
  isSaving: boolean;
  lastSavedAt: Date | null;
  error: string | null;
}

/**
 * Custom hook for managing deck state with localStorage persistence and cloud sync
 */
export function useDeckState(initialDeckId?: string, initialFolderId?: string | null, isNewDeck?: boolean) {
  const [deck, setDeck] = useState<Deck>(() => loadDeckFromStorage());
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isSaving: false,
    lastSavedAt: null,
    error: null,
  });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const isInitialMount = useRef(true);

  // Persist deck to localStorage whenever it changes
  useEffect(() => {
    saveDeckToStorage(deck);
    
    // Track unsaved changes (except on initial mount)
    if (!isInitialMount.current) {
      setHasUnsavedChanges(true);
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
        
        // Fetch full card database to reconstruct complete card data
        const cardDatabase = await fetchCardDatabase();
        
        // Convert database format to Deck format with full card data
        const loadedDeck: Deck = {
          id: cloudDeck.id,
          name: cloudDeck.name,
          description: cloudDeck.description || "",
          format: cloudDeck.format,
          paragon: cloudDeck.paragon,
          folderId: cloudDeck.folder_id,
          cards: cloudDeck.cards.map((dbCard: any) => {
            // Reconstruct the lookup key
            const key = `${dbCard.card_name}|${dbCard.card_set}|${sanitizeImgFile(dbCard.card_img_file)}`;
            const fullCard = cardDatabase.get(key);
            
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
        
        setDeck(loadedDeck);
        setHasUnsavedChanges(false);
        setSyncStatus({
          isSaving: false,
          lastSavedAt: new Date(cloudDeck.updated_at),
          error: null,
        });
      } else {
        setSyncStatus({
          isSaving: false,
          lastSavedAt: null,
          error: result.error || "Failed to load deck",
        });
      }
    } catch (error) {
      console.error("Error loading deck from cloud:", error);
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
  const saveDeckToCloud = useCallback(async () => {
    try {
      setSyncStatus({ isSaving: true, lastSavedAt: null, error: null });

      // Convert Deck format to database format
      // Filter out cards with quantity <= 0 to avoid database constraint violations
      const cardsData: DeckCardData[] = deck.cards
        .filter((deckCard) => deckCard.quantity > 0)
        .map((deckCard) => ({
          card_name: deckCard.card.name,
          card_set: deckCard.card.set,
          card_img_file: deckCard.card.imgFile,
          quantity: deckCard.quantity,
          is_reserve: deckCard.isReserve,
        }));

      console.log('[useDeckState] Saving deck with folderId:', deck.folderId);

      const result = await saveDeckAction({
        deckId: deck.id,
        name: deck.name,
        description: deck.description,
        format: deck.format,
        paragon: deck.paragon,
        folderId: deck.folderId,
        cards: cardsData,
      });

      if (result.success) {
        // Update deck with the ID if it was newly created
        if (!deck.id && result.deckId) {
          setDeck((prevDeck) => ({ ...prevDeck, id: result.deckId }));
        }
        
        setHasUnsavedChanges(false);
        setSyncStatus({
          isSaving: false,
          lastSavedAt: new Date(),
          error: null,
        });
        
        return { success: true };
      } else {
        setSyncStatus({
          isSaving: false,
          lastSavedAt: null,
          error: result.error || "Failed to save deck",
        });
        
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error("Error saving deck to cloud:", error);
      const errorMessage = "Failed to save deck";
      setSyncStatus({
        isSaving: false,
        lastSavedAt: null,
        error: errorMessage,
      });
      
      return { success: false, error: errorMessage };
    }
  }, [deck]);

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
   * Clear all cards from deck
   */
  const clearDeck = useCallback(() => {
    setDeck((prevDeck) => ({
      ...prevDeck,
      cards: [],
      updatedAt: new Date(),
    }));
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
    addCard,
    removeCard,
    updateQuantity,
    setDeckName,
    setDeckDescription,
    setDeckFormat,
    setDeckParagon,
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

  // Return default empty deck
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
  } catch (error) {
    console.error("Error saving deck to storage:", error);
  }
}
