import { Deck, DeckCard } from "../types/deck";
import { Card } from "../utils";
import { getParagonByName, ParagonData } from "../data/paragons";

export interface ValidationIssue {
  type: "error" | "warning" | "info";
  message: string;
  category: "size" | "souls" | "quantity" | "reserve" | "dominants" | "format" | "paragon";
}

export interface ParagonBrigadeStats {
  primaryGood: number;
  otherGood: number;
  neutral: number;
  primaryEvil: number;
  otherEvil: number;
  dominants: number;
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
  paragonStats?: ParagonBrigadeStats;
}

/**
 * Redemption CCG Deck Building Rules Summary:
 * 
 * 1. Deck Size:
 *    - Type 1: 50-154 cards
 *    - Type 2: 100-252 cards
 *    - Paragon: 40 cards (exact)
 * 
 * 2. Lost Soul Requirements: Based on Main Deck size ONLY (not including Reserve)
 *    - Every 7 cards in Main Deck requires 1 more Lost Soul
 *    - 50-56 cards = 7 Lost Souls, 57-63 = 8, etc.
 *    - EXCEPTION: "Hopper" Lost Souls (II Chronicles 28:13 variants) do NOT count
 *    - Paragon: NO Lost Souls allowed
 * 
 * 3. Reserve Limits:
 *    - Type 1: Maximum 10 cards
 *    - Type 2: Maximum 15 cards
 *    - Paragon: Maximum 10 cards
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
  if (fmt?.includes("paragon")) return 40;
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
  if (fmt?.includes("paragon")) return 40;
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
  if (fmt?.includes("paragon")) return 10;
  return 10; // Type 1 and default
}

/**
 * Check if a card's brigade matches the given brigade (case-insensitive, handles multi-brigade)
 */
function cardHasBrigade(card: Card, brigade: string): boolean {
  const cardBrigade = card.brigade?.toLowerCase() || "";
  const targetBrigade = brigade.toLowerCase();
  
  // Handle multi-brigade cards (e.g., "Blue/Gold")
  const brigades = cardBrigade.split(/[/,]/).map(b => b.trim());
  
  // Check for exact match first
  if (brigades.includes(targetBrigade)) {
    return true;
  }
  
  // Handle "Good Gold" vs "Gold" and "Evil Gold" vs "Gold" matching
  if (targetBrigade === "gold") {
    return brigades.includes("good gold") || brigades.includes("evil gold");
  }
  
  return false;
}

/**
 * Get card alignment: "good", "evil", or "neutral"
 */
function getCardAlignment(card: Card): "good" | "evil" | "neutral" {
  const alignment = card.alignment || "";
  // Cards with "Good/Evil" alignment are considered neutral for Paragon
  if (alignment.includes("Good/Evil")) return "neutral";
  if (alignment.includes("Good")) return "good";
  if (alignment.includes("Evil")) return "evil";
  return "neutral";
}

/**
 * Calculate Paragon brigade distribution for deck
 */
function calculateParagonStats(
  deck: Deck,
  paragonData: ParagonData
): ParagonBrigadeStats {
  const stats: ParagonBrigadeStats = {
    primaryGood: 0,
    otherGood: 0,
    neutral: 0,
    primaryEvil: 0,
    otherEvil: 0,
    dominants: 0,
  };

  // Count all cards (main deck + reserve)
  deck.cards.forEach((dc) => {
    const alignment = getCardAlignment(dc.card);
    const hasPrimaryGood = cardHasBrigade(dc.card, paragonData.goodBrigade);
    const hasPrimaryEvil = cardHasBrigade(dc.card, paragonData.evilBrigade);
    
    // Track dominants separately for max limit (but still count them in brigade requirements)
    if (isDominant(dc.card)) {
      stats.dominants += dc.quantity;
      // Don't return - continue to count them in brigade requirements below
    }
    
    // Skip Lost Souls from brigade counts
    if (isLostSoul(dc.card)) {
      return;
    }

    if (alignment === "good") {
      if (hasPrimaryGood) {
        stats.primaryGood += dc.quantity;
      } else {
        stats.otherGood += dc.quantity;
      }
    } else if (alignment === "evil") {
      if (hasPrimaryEvil) {
        stats.primaryEvil += dc.quantity;
      } else {
        stats.otherEvil += dc.quantity;
      }
    } else {
      // Neutral
      stats.neutral += dc.quantity;
    }
  });

  return stats;
}

/**
 * Validate Paragon deck requirements
 */
function validateParagonDeck(
  deck: Deck,
  paragonData: ParagonData,
  issues: ValidationIssue[]
): ParagonBrigadeStats {
  const stats = calculateParagonStats(deck, paragonData);

  // Validate primary good brigade
  if (stats.primaryGood !== paragonData.primaryGood) {
    issues.push({
      type: "error",
      category: "paragon",
      message: `${paragonData.name} requires exactly ${paragonData.primaryGood} ${paragonData.goodBrigade} good cards (currently: ${stats.primaryGood})`,
    });
  }

  // Validate other good brigades
  if (stats.otherGood !== paragonData.otherGood) {
    issues.push({
      type: "error",
      category: "paragon",
      message: `${paragonData.name} requires exactly ${paragonData.otherGood} other good cards (currently: ${stats.otherGood})`,
    });
  }

  // Validate neutral cards
  if (stats.neutral !== paragonData.neutral) {
    issues.push({
      type: "error",
      category: "paragon",
      message: `${paragonData.name} requires exactly ${paragonData.neutral} neutral cards (currently: ${stats.neutral})`,
    });
  }

  // Validate primary evil brigade
  if (stats.primaryEvil !== paragonData.primaryEvil) {
    issues.push({
      type: "error",
      category: "paragon",
      message: `${paragonData.name} requires exactly ${paragonData.primaryEvil} ${paragonData.evilBrigade} evil cards (currently: ${stats.primaryEvil})`,
    });
  }

  // Validate other evil brigades
  if (stats.otherEvil !== paragonData.otherEvil) {
    issues.push({
      type: "error",
      category: "paragon",
      message: `${paragonData.name} requires exactly ${paragonData.otherEvil} other evil cards (currently: ${stats.otherEvil})`,
    });
  }

  // Validate dominants (max 7 in Paragon format)
  if (stats.dominants > 7) {
    issues.push({
      type: "error",
      category: "paragon",
      message: `Paragon format allows maximum 7 Dominants (currently: ${stats.dominants})`,
    });
  }

  return stats;
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
  
  const reserveLostSoulsCount = reserveCards
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
  const isParagon = deck.format?.toLowerCase().includes("paragon");
  
  if (isParagon) {
    // Paragon format: No Lost Souls allowed
    if (mainDeckLostSouls > 0 || reserveLostSoulsCount > 0) {
      issues.push({
        type: "error",
        category: "souls",
        message: `Paragon format does not allow Lost Souls: found ${mainDeckLostSouls + reserveLostSoulsCount} Lost Soul(s)`,
      });
    }
  } else if (mainDeckSize >= minDeckSize) {
    // Standard formats: Lost Soul requirements
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
  // Only enforce this rule when deck has reached minimum size threshold
  // SKIP for Paragon format (has separate max 7 dominants rule)
  const minDeckSizeForValidation = getMinimumDeckSize(deck.format);
  if (!isParagon && mainDeckSize >= minDeckSizeForValidation && dominantCount > requiredLostSouls) {
    issues.push({
      type: "error",
      category: "dominants",
      message: `Too many Dominants: ${dominantCount}/${requiredLostSouls} maximum for ${mainDeckSize}-card deck`,
    });
  }
  
  // Validation: Type 2 requires equal Good and Evil cards (in both main deck and reserve)
  const isType2 = deck.format?.toLowerCase().includes("type 2") || deck.format?.toLowerCase().includes("multi");
  if (isType2) {
    // Check Main Deck - INCLUDE Lost Souls and Dominants in alignment check
    const mainGoodCards = deck.cards
      .filter((dc) => !dc.isReserve && dc.card.alignment?.toLowerCase() === "good")
      .reduce((sum, dc) => sum + dc.quantity, 0);
    
    const mainEvilCards = deck.cards
      .filter((dc) => !dc.isReserve && dc.card.alignment?.toLowerCase() === "evil")
      .reduce((sum, dc) => sum + dc.quantity, 0);
    
    if (mainGoodCards !== mainEvilCards && (mainGoodCards > 0 || mainEvilCards > 0)) {
      const difference = Math.abs(mainGoodCards - mainEvilCards);
      const needMore = mainGoodCards < mainEvilCards ? "Good" : "Evil";
      
      issues.push({
        type: "error",
        category: "format",
        message: `Main Deck: Need ${difference} more ${needMore} (${mainGoodCards} Good, ${mainEvilCards} Evil)`,
      });
    }
    
    // Check Reserve - INCLUDE Lost Souls and Dominants in alignment check
    const reserveGoodCards = deck.cards
      .filter((dc) => dc.isReserve && dc.card.alignment?.toLowerCase() === "good")
      .reduce((sum, dc) => sum + dc.quantity, 0);
    
    const reserveEvilCards = deck.cards
      .filter((dc) => dc.isReserve && dc.card.alignment?.toLowerCase() === "evil")
      .reduce((sum, dc) => sum + dc.quantity, 0);
    
    if (reserveGoodCards !== reserveEvilCards && (reserveGoodCards > 0 || reserveEvilCards > 0)) {
      const difference = Math.abs(reserveGoodCards - reserveEvilCards);
      const needMore = reserveGoodCards < reserveEvilCards ? "Good" : "Evil";
      
      issues.push({
        type: "error",
        category: "format",
        message: `Reserve: Need ${difference} more ${needMore} (${reserveGoodCards} Good, ${reserveEvilCards} Evil)`,
      });
    }
  }
  
  // Validation: Type 1 requires unique Lost Souls (no duplicates)
  // Exception: Lost Souls with no special ability can have multiples
  const isType1 = !isType2; // Type 1 if not Type 2
  if (isType1) {
    // Find Lost Soul duplicates (excluding those with no special ability)
    const lostSoulCounts = deck.cards
      .filter((dc) => {
        if (!isLostSoul(dc.card)) return false;
        // Allow multiples of Lost Souls with no special ability
        const hasSpecialAbility = dc.card.specialAbility && dc.card.specialAbility.trim() !== '';
        return hasSpecialAbility;
      })
      .reduce((acc, dc) => {
        const key = `${dc.card.name}-${dc.card.set}`;
        if (!acc[key]) {
          acc[key] = { name: dc.card.name, count: 0 };
        }
        acc[key].count += dc.quantity;
        return acc;
      }, {} as Record<string, { name: string; count: number }>);
    
    const duplicateLostSouls = Object.values(lostSoulCounts).filter(ls => ls.count > 1);
    
    if (duplicateLostSouls.length > 0) {
      duplicateLostSouls.forEach(ls => {
        issues.push({
          type: "error",
          category: "souls",
          message: `Type 1 requires unique Lost Souls with special abilities: "${ls.name}" appears ${ls.count} times (must be 1)`,
        });
      });
    }
  }
  
  // Validation: Type 2 allows maximum 2 copies of each Lost Soul
  // Exception: Lost Souls with no special ability can have unlimited copies
  if (isType2) {
    // Find Lost Souls with more than 2 copies (excluding those with no special ability)
    const lostSoulCounts = deck.cards
      .filter((dc) => {
        if (!isLostSoul(dc.card)) return false;
        // Allow unlimited copies of Lost Souls with no special ability
        const hasSpecialAbility = dc.card.specialAbility && dc.card.specialAbility.trim() !== '';
        return hasSpecialAbility;
      })
      .reduce((acc, dc) => {
        const key = `${dc.card.name}-${dc.card.set}`;
        if (!acc[key]) {
          acc[key] = { name: dc.card.name, count: 0 };
        }
        acc[key].count += dc.quantity;
        return acc;
      }, {} as Record<string, { name: string; count: number }>);
    
    const excessLostSouls = Object.values(lostSoulCounts).filter(ls => ls.count > 2);
    
    if (excessLostSouls.length > 0) {
      excessLostSouls.forEach(ls => {
        issues.push({
          type: "error",
          category: "souls",
          message: `Type 2 allows maximum 2 copies of each Lost Soul with special abilities: "${ls.name}" appears ${ls.count} times (max 2)`,
        });
      });
    }
  }
  
  // Validation: Empty deck warning
  if (totalCards === 0) {
    issues.push({
      type: "info",
      category: "size",
      message: "Deck is empty",
    });
  }
  
  // Paragon format validation
  let paragonStats: ParagonBrigadeStats | undefined;
  const isParagonFormat = deck.format?.toLowerCase().includes("paragon");
  
  if (isParagonFormat && deck.paragon) {
    const paragonData = getParagonByName(deck.paragon);
    if (paragonData) {
      paragonStats = validateParagonDeck(deck, paragonData, issues);
    } else {
      issues.push({
        type: "error",
        category: "paragon",
        message: `Unknown Paragon: "${deck.paragon}"`,
      });
    }
  } else if (isParagonFormat && !deck.paragon) {
    issues.push({
      type: "warning",
      category: "paragon",
      message: "No Paragon selected for Paragon format deck",
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
    paragonStats,
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
    return "✓ Passed Basic Checks";
  }
  
  const errorCount = validation.issues.filter((i) => i.type === "error").length;
  return `✗ ${errorCount} error${errorCount !== 1 ? "s" : ""}`;
}
