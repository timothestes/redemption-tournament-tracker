/**
 * Turning a breakdown into the per-card figures the views actually render.
 *
 * Shared by the single-event Breakdown tab and the cross-event Metagame tab so
 * the two can never disagree about what a play rate is. Kept beside `topCut.ts`
 * rather than in `breakdown.ts` for the same bundle reason: this module imports
 * only *types* from `breakdown.ts`, which erase at compile time, so a client
 * component can use it without dragging the 5,692-card index into the browser.
 */

import type { BreakdownCard } from "./breakdown";

/**
 * A card's identity plus every figure the views need, computed once.
 *
 * `topCutDecks` and everything derived from it move with the cut control, so
 * they are recomputed on the client rather than shipped once per possible cut.
 */
export interface DerivedCard {
  key: string;
  name: string;
  type: string;
  brigade: string;
  alignment: string;
  imgFile: string;
  decks: number;
  fieldRate: number;
  copies: number;
  mainCopies: number;
  reserveCopies: number;
  reserveDecks: number;
  printings: string[];
  deckIndexes: number[];
  topCutDecks: number;
  topCutRate: number;
  /** Top-cut rate minus field rate, in points. Positive = over-represented. */
  delta: number;
}

export function deriveCards(
  cards: BreakdownCard[],
  deckCount: number,
  cutSet: Set<number>,
): DerivedCard[] {
  return cards.map((card) => {
    let topCutDecks = 0;
    for (const deckIndex of card.deckIndexes) if (cutSet.has(deckIndex)) topCutDecks += 1;

    const fieldRate = deckCount === 0 ? 0 : card.deckIndexes.length / deckCount;
    const topCutRate = cutSet.size === 0 ? 0 : topCutDecks / cutSet.size;

    return {
      key: card.key,
      name: card.name,
      type: card.type,
      brigade: card.brigade,
      alignment: card.alignment,
      imgFile: card.imgFile,
      decks: card.deckIndexes.length,
      fieldRate,
      copies: card.copies,
      mainCopies: card.mainCopies,
      reserveCopies: card.reserveCopies,
      reserveDecks: card.reserveDecks,
      printings: card.printings,
      deckIndexes: card.deckIndexes,
      topCutDecks,
      topCutRate,
      delta: topCutRate - fieldRate,
    };
  });
}
