import { useState, useEffect, useCallback } from "react";
import { Card } from "../utils";
import { Deck, DeckCard, DeckStats } from "../types/deck";

const STORAGE_KEY = "redemption-deck-builder-current-deck";

/**
 * Custom hook for managing deck state with localStorage persistence
 */
export function useDeckState() {
  const [deck, setDeck] = useState<Deck>(() => loadDeckFromStorage());

  // Persist deck to localStorage whenever it changes
  useEffect(() => {
    saveDeckToStorage(deck);
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
        // Card exists, increment quantity (max 4)
        const existingCard = prevDeck.cards[existingCardIndex];
        if (existingCard.quantity >= 4) {
          return prevDeck; // Already at max
        }

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
      if (quantity < 0 || quantity > 4) {
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
  const newDeck = useCallback((name: string = "Untitled Deck") => {
    setDeck({
      name,
      cards: [],
      description: "",
      format: undefined,
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

  return {
    deck,
    addCard,
    removeCard,
    updateQuantity,
    setDeckName,
    setDeckDescription,
    setDeckFormat,
    clearDeck,
    newDeck,
    loadDeck,
    getCardQuantity,
    getDeckStats,
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
