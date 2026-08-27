import { DeckCheckError } from "./errors";
import type { ParsedDeck, DeckEntry } from "./types";

/**
 * Replaces curly apostrophes (U+2019) with straight ones.
 * Parity with Python's normalize_apostrophes.
 */
export function normalizeApostrophes(text: string): string {
  return text.replaceAll("’", "'");
}

/**
 * Parse Lackey .txt decklist format into main and reserve sections.
 * Parity with Python _load_txt_file.
 */
export function parseDecklistText(text: string): ParsedDeck {
  const main: DeckEntry[] = [];
  const reserve: DeckEntry[] = [];
  let hasReserve = false;

  const lines = text.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Break on Tokens:
    if (trimmed.startsWith("Tokens:")) {
      break;
    }

    // Flag Reserve section and continue
    if (trimmed.startsWith("Reserve:")) {
      hasReserve = true;
      continue;
    }

    // Split on first tab only - skip if no tab
    const tabIndex = trimmed.indexOf("\t");
    if (tabIndex > -1) {
      const quantityStr = trimmed.substring(0, tabIndex).trim();

      // Validate quantity is a valid integer (matches Python's int() behavior)
      if (!/^[+-]?\d+$/.test(quantityStr)) {
        throw new Error(`invalid literal for int() with base 10: '${quantityStr}'`);
      }

      const quantity = parseInt(quantityStr, 10);
      const name = normalizeApostrophes(trimmed.substring(tabIndex + 1).trim());

      const entry: DeckEntry = { quantity, name };

      if (hasReserve) {
        reserve.push(entry);
      } else {
        main.push(entry);
      }
    }
  }

  // Validate: main deck must have at least one card
  if (main.length === 0) {
    throw new DeckCheckError(
      "Please load a deck_file that contains at least one card in the main deck."
    );
  }

  return { main, reserve, hasReserve };
}
