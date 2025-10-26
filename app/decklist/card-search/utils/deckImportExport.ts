import { Card } from "../utils";
import { Deck, DeckCard, ImportResult } from "../types/deck";

/**
 * Normalize card name for comparison by replacing various apostrophe types with standard apostrophe
 */
function normalizeCardName(name: string): string {
  // Replace curly/smart apostrophes and other variants with standard apostrophe
  return name.replace(/[\u2018\u2019\u201B\u2032]/g, "'");
}

/**
 * Parse a deck text in standard tab-separated format
 * Format: Quantity\tName\tSet\tImageFile\tCollectorInfo
 * Supports "Reserve:" section for reserve cards
 * Ignores "Tokens:" section (tokens are not imported)
 * 
 * Example:
 * 4	Abraham	PoC	Abraham (PoC).jpg	"Genesis 11:26; [PoC (R)]"
 * 2	Moses	Patriarchs	Moses (Pa).jpg	"Exodus 2:10; [Pa (UR)]"
 * Reserve:
 * 1	Angel of the Lord	Patriarchs	Angel of the Lord (Pa).jpg	"Genesis 16:7; [Pa (R)]"
 * Tokens:
 * 1	Aaron's Staff (CoW)
 */
export function parseDeckText(
  text: string,
  allCards: Card[]
): ImportResult {
  const lines = text.trim().split("\n");
  const deckCards: DeckCard[] = [];
  const errors: string[] = [];
  let isReserve = false;
  let isTokens = false; // Track if we're in the Tokens section

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines
    if (!line) continue;
    
    // Check for Tokens section marker - ignore all cards after this
    if (line.toLowerCase() === "tokens:") {
      isTokens = true;
      continue;
    }
    
    // Skip all lines if we're in the Tokens section
    if (isTokens) {
      continue;
    }
    
    // Check for Reserve section marker
    if (line.toLowerCase() === "reserve:") {
      isReserve = true;
      continue;
    }
    
    // Parse tab-separated line
    const parts = line.split("\t");
    
    if (parts.length < 2) {
      errors.push(`Line ${i + 1}: Invalid format (expected tab-separated values)`);
      continue;
    }
    
    // Extract quantity and card name (minimum required fields)
    const quantityStr = parts[0].trim();
    const cardName = parts[1].trim();
    
    // Parse quantity
    const quantity = parseInt(quantityStr, 10);
    if (isNaN(quantity) || quantity < 1) {
      errors.push(`Line ${i + 1}: Invalid quantity "${quantityStr}" (must be at least 1)`);
      continue;
    }
    
    // Optional: Extract set name if provided (3rd column)
    const setName = parts.length >= 3 ? parts[2].trim() : undefined;
    
    // Normalize card name for comparison
    const normalizedInputName = normalizeCardName(cardName);
    
    // Find matching card in allCards
    let matchingCard: Card | undefined;
    
    if (setName) {
      // Try to find exact match with set name (using normalized names)
      matchingCard = allCards.find(
        (c) => normalizeCardName(c.name) === normalizedInputName && c.set === setName
      );
      
      if (!matchingCard) {
        // Try matching with officialSet as fallback
        matchingCard = allCards.find(
          (c) => normalizeCardName(c.name) === normalizedInputName && c.officialSet === setName
        );
      }
    }
    
    // If no set specified or no match found, try finding by name only
    if (!matchingCard) {
      const matchingCards = allCards.filter((c) => normalizeCardName(c.name) === normalizedInputName);
      
      if (matchingCards.length === 0) {
        errors.push(`Line ${i + 1}: Card not found: "${cardName}"`);
        continue;
      } else if (matchingCards.length > 1) {
        // Multiple printings found - use first one and warn
        matchingCard = matchingCards[0];
        errors.push(
          `Line ${i + 1}: Multiple versions of "${cardName}" found, using ${matchingCard.set}`
        );
      } else {
        matchingCard = matchingCards[0];
      }
    }
    
    // Add to deck
    deckCards.push({
      card: matchingCard,
      quantity,
      isReserve,
    });
  }
  
  // Create a deck object if we have cards
  const deck: Deck | null = deckCards.length > 0
    ? {
        name: "Imported Deck",
        cards: deckCards,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    : null;
  
  return {
    deck,
    warnings: [], // Could separate warnings from errors in the future
    errors,
  };
}

/**
 * Generate deck text in standard tab-separated format
 * Format: Quantity\tName
 * Reserve cards are separated with "Reserve:" marker
 * Card names are normalized to use standard apostrophes
 */
export function generateDeckText(deck: Deck): string {
  const mainCards = deck.cards.filter((dc) => !dc.isReserve);
  const reserveCards = deck.cards.filter((dc) => dc.isReserve);
  
  const lines: string[] = [];
  
  // Sort cards alphabetically by name
  const sortCards = (a: DeckCard, b: DeckCard) =>
    a.card.name.localeCompare(b.card.name);
  
  // Add main deck cards
  mainCards.sort(sortCards).forEach((dc) => {
    const { card, quantity } = dc;
    // Format: Quantity\tName (with normalized apostrophes)
    const normalizedName = normalizeCardName(card.name);
    lines.push(`${quantity}\t${normalizedName}`);
  });
  
  // Add reserve section if there are reserve cards
  if (reserveCards.length > 0) {
    lines.push(""); // Empty line before Reserve
    lines.push("Reserve:");
    
    reserveCards.sort(sortCards).forEach((dc) => {
      const { card, quantity } = dc;
      const normalizedName = normalizeCardName(card.name);
      lines.push(`${quantity}\t${normalizedName}`);
    });
  }
  
  return lines.join("\n");
}

/**
 * Helper function to download deck as a text file
 */
export function downloadDeckAsFile(deck: Deck, filename?: string): void {
  const deckText = generateDeckText(deck);
  const blob = new Blob([deckText], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || `${deck.name.replace(/\s+/g, "_")}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Helper function to copy deck text to clipboard
 */
export async function copyDeckToClipboard(deck: Deck): Promise<void> {
  const deckText = generateDeckText(deck);
  await navigator.clipboard.writeText(deckText);
}
