import type { DeckCard } from "../types/deck";

export type ReplaceAlignment = "good" | "evil";

export interface ReplaceHalfResult {
  /** New card list: current cards minus the replaced half, plus the source's matching half. */
  cards: DeckCard[];
  /** Total quantity of strictly-aligned cards removed from the current deck. */
  removed: number;
  /** Total quantity of strictly-aligned cards added from the source deck. */
  added: number;
}

/** True only for strictly "Good" or strictly "Evil" (dual "Good/Evil" and neutral excluded). */
function isStrictlyAligned(card: DeckCard["card"], alignment: ReplaceAlignment): boolean {
  return (card.alignment ?? "").toLowerCase() === alignment;
}

/**
 * Replace the current deck's good (or evil) half with the source deck's good (or evil) half.
 * Cards that are neutral, dual-aligned, or of the opposite alignment are left untouched.
 * Zones and quantities of the added cards are preserved as-is.
 */
export function buildReplacedHalf(
  currentCards: DeckCard[],
  sourceCards: DeckCard[],
  alignment: ReplaceAlignment
): ReplaceHalfResult {
  const removed = currentCards
    .filter((dc) => isStrictlyAligned(dc.card, alignment))
    .reduce((sum, dc) => sum + dc.quantity, 0);

  const kept = currentCards.filter((dc) => !isStrictlyAligned(dc.card, alignment));

  const toAdd = sourceCards.filter((dc) => isStrictlyAligned(dc.card, alignment));
  const added = toAdd.reduce((sum, dc) => sum + dc.quantity, 0);

  return { cards: [...kept, ...toAdd], removed, added };
}
