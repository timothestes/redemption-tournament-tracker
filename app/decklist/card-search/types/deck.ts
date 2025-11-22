import { Card } from "../utils";

/**
 * Represents a card in a deck with its quantity and location (main/reserve)
 */
export interface DeckCard {
  /** Reference to the full card object with all card data */
  card: Card;
  /** Quantity of this card in the deck (1-4, enforced by validation) */
  quantity: number;
  /** Whether this card is in the reserve/sideboard section */
  isReserve: boolean;
}

/**
 * Represents a complete deck with name, cards, and metadata
 */
export interface Deck {
  /** Unique identifier (UUID) for the deck - only set when saved to cloud */
  id?: string;
  /** User-editable deck name */
  name: string;
  /** Array of cards in the deck (main + reserve) */
  cards: DeckCard[];
  /** Optional description/notes about the deck */
  description?: string;
  /** Optional format (e.g., 'Type 1', 'Type 2', 'Paragon', 'Classic') */
  format?: string;
  /** Optional Paragon name (only for Paragon format decks) */
  paragon?: string;
  /** Optional folder ID for organization */
  folderId?: string | null;
  /** Timestamp when deck was created */
  createdAt: Date;
  /** Timestamp when deck was last modified */
  updatedAt: Date;
}

/**
 * Helper type for deck statistics
 */
export interface DeckStats {
  /** Total cards in main deck */
  mainDeckCount: number;
  /** Total cards in reserve/sideboard */
  reserveCount: number;
  /** Total unique cards */
  uniqueCards: number;
  /** Cards grouped by type (Hero, Evil Character, Enhancement, etc.) */
  cardsByType: Record<string, number>;
  /** Cards grouped by brigade */
  cardsByBrigade: Record<string, number>;
}

/**
 * Result type for import operations
 */
export interface ImportResult {
  /** Successfully parsed deck */
  deck: Deck | null;
  /** Array of warning messages (unrecognized cards, etc.) */
  warnings: string[];
  /** Array of error messages (parse failures, etc.) */
  errors: string[];
}
