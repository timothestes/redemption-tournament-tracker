/**
 * Port of redemption-tournament-api/src/utilities/text_to_pdf.py's
 * `clean_card_name` (lines 78-107). Cleans a card's display name for the
 * deck-check sheet (and its overflow page):
 * - Lost Souls: keep a quoted nickname (unquoted) + first verse reference
 *   only, dropping set/bracket info; falls back to text before the first
 *   `[` if there's no quoted nickname.
 * - Cards with a `/` (double-sided cards), except the `(I/J+)` special case:
 *   keep only the part before the first `/`, plus any trailing `(...)` set
 *   suffix.
 * - Otherwise: unchanged.
 */
import type { ResolvedCard } from "./types";

// Trailing `(...)` group at the very end of the string, ported verbatim from
// SET_NAME_PATTERN = re.compile(r"(\([^)]*\))\s*$").
const SET_NAME_PATTERN = /(\([^)]*\))\s*$/;

export function cleanCardName(name: string, card: Pick<ResolvedCard, "type">): string {
  // Special handling for Lost Souls
  if (card.type === "Lost Soul" && name.includes("Lost Soul")) {
    const nicknameMatch = name.match(/"([^"]+)"/);
    if (nicknameMatch) {
      const nickname = nicknameMatch[1];
      const verseMatch = name.match(/\[([^/\]]+)/);
      if (verseMatch) {
        const verse = `[${verseMatch[1]}]`;
        return `${nickname} ${verse}`;
      }
    }
    return name.split("[")[0].trim();
  }

  // Handle cards with set information, special case for (I/J+)
  if (name.includes("/") && !name.includes("(I/J+)")) {
    const baseName = name.split("/")[0].trim();
    const match = name.match(SET_NAME_PATTERN);
    if (match) {
      return `${baseName} ${match[1].trim()}`;
    }
    return baseName;
  }

  return name;
}
