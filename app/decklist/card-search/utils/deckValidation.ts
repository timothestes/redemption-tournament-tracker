import { Deck, DeckCard } from "../types/deck";
import { Card } from "../utils";

export interface ValidationIssue {
  type: "error" | "warning" | "info";
  message: string;
  category: "size" | "souls" | "quantity" | "reserve" | "dominants" | "format";
}

export interface DeckValidation {
  isValid: boolean;
  issues: ValidationIssue[];
  stats: {
    totalCards: number;
    mainDeckSize: number;
    reserveSize: number;
    lostSoulCount: number;
    requiredLostSouls: number;
    dominantCount: number;
  };
}

/**
 * Redemption CCG Deck Building Rules Summary:
 * 
 * 1. Deck Size:
 *    - Type 1: 50-154 cards
 *    - Type 2: 100-252 cards
 * 
 * 2. Lost Soul Requirements: Based on Main Deck size ONLY (not including Reserve)
 *    - Every 7 cards in Main Deck requires 1 more Lost Soul
 *    - 50-56 cards = 7 Lost Souls, 57-63 = 8, etc.
 *    - EXCEPTION: "Hopper" Lost Souls (II Chronicles 28:13 variants) do NOT count
 * 
 * 3. Reserve Limits:
 *    - Type 1: Maximum 10 cards
 *    - Type 2: Maximum 15 cards
 *    - Dominants and Lost Souls CANNOT be in Reserve
 * 
 * 4. Dominant Limits:
 *    - Maximum 1 copy of each unique Dominant
 *    - Total Dominants cannot exceed required Lost Souls (based on deck size)
 *    - Example: 50-56 card deck = max 7 Dominants, 57-63 = max 8, etc.
 * 
 * 5. Card Quantity Limits: NOT ENFORCED (per user request)
 */

/**
 * Calculate required Lost Souls based on Main Deck size ONLY (not including Reserve)
 * Pattern: Every 7 cards adds 1 Lost Soul, starting at 7 for 50-56 cards
 */
export function getRequiredLostSouls(mainDeckSize: number): number {
  if (mainDeckSize < 50) return 0; // Invalid deck size
  if (mainDeckSize >= 50 && mainDeckSize <= 56) return 7;
  if (mainDeckSize >= 57 && mainDeckSize <= 63) return 8;
  if (mainDeckSize >= 64 && mainDeckSize <= 70) return 9;
  if (mainDeckSize >= 71 && mainDeckSize <= 77) return 10;
  if (mainDeckSize >= 78 && mainDeckSize <= 84) return 11;
  if (mainDeckSize >= 85 && mainDeckSize <= 91) return 12;
  if (mainDeckSize >= 92 && mainDeckSize <= 98) return 13;
  if (mainDeckSize >= 99 && mainDeckSize <= 105) return 14;
  if (mainDeckSize >= 106 && mainDeckSize <= 112) return 15;
  if (mainDeckSize >= 113 && mainDeckSize <= 119) return 16;
  if (mainDeckSize >= 120 && mainDeckSize <= 126) return 17;
  if (mainDeckSize >= 127 && mainDeckSize <= 133) return 18;
  if (mainDeckSize >= 134 && mainDeckSize <= 140) return 19;
  if (mainDeckSize >= 141 && mainDeckSize <= 147) return 20;
  if (mainDeckSize >= 148 && mainDeckSize <= 154) return 21;
  if (mainDeckSize >= 155 && mainDeckSize <= 161) return 22;
  if (mainDeckSize >= 162 && mainDeckSize <= 168) return 23;
  if (mainDeckSize >= 169 && mainDeckSize <= 175) return 24;
  if (mainDeckSize >= 176 && mainDeckSize <= 182) return 25;
  if (mainDeckSize >= 183 && mainDeckSize <= 189) return 26;
  if (mainDeckSize >= 190 && mainDeckSize <= 196) return 27;
  if (mainDeckSize >= 197 && mainDeckSize <= 203) return 28;
  if (mainDeckSize >= 204 && mainDeckSize <= 210) return 29;
  if (mainDeckSize >= 211 && mainDeckSize <= 217) return 30;
  if (mainDeckSize >= 218 && mainDeckSize <= 224) return 31;
  if (mainDeckSize >= 225 && mainDeckSize <= 231) return 32;
  if (mainDeckSize >= 232 && mainDeckSize <= 238) return 33;
  if (mainDeckSize >= 239 && mainDeckSize <= 245) return 34;
  if (mainDeckSize >= 246 && mainDeckSize <= 252) return 35;
  
  // Extrapolate for larger decks (unlikely but possible)
  return Math.ceil((mainDeckSize - 50) / 7) + 7;
}

/**
 * Check if a card is a Lost Soul
 */
function isLostSoul(card: Card): boolean {
  return card.type?.toLowerCase() === "lost soul" || 
         card.type?.toLowerCase() === "lost souls" ||
         card.type?.toLowerCase().includes("lost soul");
}

/**
 * Check if a Lost Soul is a "Hopper" variant that shouldn't count toward the requirement
 * Hopper Lost Souls are special promo/variant cards that don't count
 */
function isHopperLostSoul(card: Card): boolean {
  if (!isLostSoul(card)) return false;
  
  const name = card.name?.toLowerCase() || "";
  
  // Check for "hopper" in the name or if it's a hopper variant
  return name.includes("hopper") || 
         name.includes("ii chronicles 28:13");
}

/**
 * Check if a card is a Dominant
 */
function isDominant(card: Card): boolean {
  return card.type?.toLowerCase() === "dominant" ||
         card.type?.toLowerCase() === "dominants" ||
         card.type?.toLowerCase().includes("dominant");
}

/**
 * Get minimum deck size based on format
 */
function getMinimumDeckSize(format?: string): number {
  const fmt = format?.toLowerCase();
  if (fmt?.includes("type 2") || fmt?.includes("multi")) return 100;
  if (fmt?.includes("type 1") || fmt?.includes("single")) return 50;
  if (fmt?.includes("draft") || fmt?.includes("sealed")) return 40;
  return 50; // Default to Type 1 minimum
}

/**
 * Get maximum deck size based on format
 */
function getMaximumDeckSize(format?: string): number {
  const fmt = format?.toLowerCase();
  if (fmt?.includes("type 2") || fmt?.includes("multi")) return 252;
  if (fmt?.includes("type 1") || fmt?.includes("single")) return 154;
  return 154; // Default to Type 1 maximum
}

/**
 * Get maximum reserve size based on format
 */
function getMaximumReserveSize(format?: string): number {
  const fmt = format?.toLowerCase();
  if (fmt?.includes("type 2") || fmt?.includes("multi")) return 15;
  return 10; // Type 1 and default
}

/**
 * Validate a deck according to Redemption CCG rules
 */
export function validateDeck(deck: Deck): DeckValidation {
  const issues: ValidationIssue[] = [];
  
  // Calculate basic stats
  const mainDeckCards = deck.cards.filter((dc) => !dc.isReserve);
  const reserveCards = deck.cards.filter((dc) => dc.isReserve);
  
  const mainDeckSize = mainDeckCards.reduce((sum, dc) => sum + dc.quantity, 0);
  const reserveSize = reserveCards.reduce((sum, dc) => sum + dc.quantity, 0);
  const totalCards = mainDeckSize + reserveSize;
  
  // Count Lost Souls (only in Main Deck for requirement calculation)
  // Exclude "Hopper" Lost Souls from the count as they don't count toward the requirement
  const mainDeckLostSouls = mainDeckCards
    .filter((dc) => isLostSoul(dc.card) && !isHopperLostSoul(dc.card))
    .reduce((sum, dc) => sum + dc.quantity, 0);
  
  const totalLostSoulCount = deck.cards
    .filter((dc) => isLostSoul(dc.card) && !isHopperLostSoul(dc.card))
    .reduce((sum, dc) => sum + dc.quantity, 0);
  
  // Count Dominants
  const dominantCount = deck.cards
    .filter((dc) => isDominant(dc.card))
    .reduce((sum, dc) => sum + dc.quantity, 0);
  
  // Lost Soul requirement based on Main Deck size ONLY
  const requiredLostSouls = getRequiredLostSouls(mainDeckSize);
  
  // Validation: Minimum deck size
  const minDeckSize = getMinimumDeckSize(deck.format);
  if (mainDeckSize < minDeckSize) {
    issues.push({
      type: "error",
      category: "size",
      message: `Main deck is too small: ${mainDeckSize} cards (minimum ${minDeckSize} for ${deck.format || "Type 1"})`,
    });
  }
  
  // Validation: Maximum deck size
  const maxDeckSize = getMaximumDeckSize(deck.format);
  if (mainDeckSize > maxDeckSize) {
    issues.push({
      type: "error",
      category: "size",
      message: `Main deck is too large: ${mainDeckSize} cards (maximum ${maxDeckSize} for ${deck.format || "Type 1"})`,
    });
  }
  
  // Validation: Lost Soul requirement (based on Main Deck size only)
  if (mainDeckSize >= minDeckSize) {
    if (mainDeckLostSouls < requiredLostSouls) {
      issues.push({
        type: "error",
        category: "souls",
        message: `Not enough Lost Souls in Main Deck: ${mainDeckLostSouls}/${requiredLostSouls} required for ${mainDeckSize} cards`,
      });
    } else if (mainDeckLostSouls > requiredLostSouls) {
      issues.push({
        type: "error",
        category: "souls",
        message: `Too many Lost Souls in Main Deck: ${mainDeckLostSouls}/${requiredLostSouls} required for ${mainDeckSize} cards (${mainDeckLostSouls - requiredLostSouls} extra)`,
      });
    }
  }
  
  // Validation: Reserve size limit
  const maxReserveSize = getMaximumReserveSize(deck.format);
  if (reserveSize > maxReserveSize) {
    issues.push({
      type: "error",
      category: "reserve",
      message: `Reserve is too large: ${reserveSize} cards (maximum ${maxReserveSize} for ${deck.format || "Type 1"})`,
    });
  }
  
  // Validation: Dominants and Lost Souls cannot be in Reserve
  const reserveDominants = reserveCards.filter((dc) => isDominant(dc.card));
  const reserveLostSouls = reserveCards.filter((dc) => isLostSoul(dc.card));
  
  if (reserveDominants.length > 0) {
    reserveDominants.forEach((dc) => {
      issues.push({
        type: "error",
        category: "reserve",
        message: `Dominants cannot be in Reserve: "${dc.card.name}" must be in Main Deck`,
      });
    });
  }
  
  if (reserveLostSouls.length > 0) {
    reserveLostSouls.forEach((dc) => {
      issues.push({
        type: "error",
        category: "reserve",
        message: `Lost Souls cannot be in Reserve: "${dc.card.name}" must be in Main Deck`,
      });
    });
  }
  
  // Validation: Card quantity limits - REMOVED per user request
  // "We will not be enforcing card quality limits at this time"
  
  // Validation: Dominant limits (max 1 per unique Dominant)
  const dominantQuantities = new Map<string, number>();
  
  deck.cards.forEach((dc) => {
    if (isDominant(dc.card)) {
      const key = dc.card.name.toLowerCase();
      dominantQuantities.set(key, (dominantQuantities.get(key) || 0) + dc.quantity);
    }
  });
  
  dominantQuantities.forEach((quantity, dominantName) => {
    if (quantity > 1) {
      issues.push({
        type: "error",
        category: "dominants",
        message: `Too many copies of Dominant "${dominantName}": ${quantity}/1 maximum`,
      });
    }
  });
  
  // Validation: Total Dominants cannot exceed required Lost Souls (based on deck size)
  // This means: 50-56 cards = max 7 Dominants, 57-63 = max 8 Dominants, etc.
  if (dominantCount > requiredLostSouls) {
    issues.push({
      type: "error",
      category: "dominants",
      message: `Too many Dominants: ${dominantCount}/${requiredLostSouls} maximum for ${mainDeckSize}-card deck`,
    });
  }
  
  // Validation: Empty deck warning
  if (totalCards === 0) {
    issues.push({
      type: "info",
      category: "size",
      message: "Deck is empty",
    });
  }
  
  // Determine if deck is valid (no errors, only warnings/info allowed)
  const isValid = !issues.some((issue) => issue.type === "error");
  
  return {
    isValid,
    issues,
    stats: {
      totalCards,
      mainDeckSize,
      reserveSize,
      lostSoulCount: mainDeckLostSouls,
      requiredLostSouls,
      dominantCount,
    },
  };
}

/**
 * Get a summary string of validation status
 */
export function getValidationSummary(validation: DeckValidation): string {
  if (validation.stats.totalCards === 0) {
    return "Empty deck";
  }
  
  if (validation.isValid) {
    return "✓ Valid deck";
  }
  
  const errorCount = validation.issues.filter((i) => i.type === "error").length;
  return `✗ ${errorCount} error${errorCount !== 1 ? "s" : ""}`;
}
