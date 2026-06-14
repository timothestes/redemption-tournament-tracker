import type { BuyDeckCard } from "../components/BuyDeckModal";

/**
 * Collapse the collection's `name|set|imgFile`-keyed quantity map into a
 * name-only total. The "Check my collection" feature matches by card name
 * (any printing counts as owned), so all printings of a name are summed.
 */
export function aggregateOwnedByName(
  quantities: Map<string, number>
): Record<string, number> {
  const owned: Record<string, number> = {};
  for (const [fullKey, qty] of quantities) {
    const name = fullKey.split("|")[0];
    owned[name] = (owned[name] || 0) + qty;
  }
  return owned;
}

export interface MissingResult {
  /** Deck entries (main+reserve) the user is short on, with original card_key/zone preserved. */
  missing: BuyDeckCard[];
  /** Total copies (main+reserve) the user already owns, capped at what the deck needs. */
  ownedCount: number;
  /** Total copies the deck needs across main+reserve. */
  totalCount: number;
}

/**
 * Compute which deck cards the user is missing from their collection.
 *
 * Matching is by card NAME only (any printing counts), quantity-aware, and
 * limited to the `main` and `reserve` zones (the maybeboard is a scratchpad).
 * Owned copies are pooled per name and allocated greedily across deck entries
 * in array order, so two printings of the same name — even split across main
 * and reserve — share one owned pool. Each missing entry keeps its original
 * `card_key`/`zone` so it can be handed to the YTG buy flow.
 */
export function computeMissingCards(
  cards: BuyDeckCard[],
  ownedByName: Record<string, number>
): MissingResult {
  const remaining: Record<string, number> = { ...ownedByName };
  const missing: BuyDeckCard[] = [];
  let totalCount = 0;
  let ownedCount = 0;

  for (const card of cards) {
    if (card.zone !== "main" && card.zone !== "reserve") continue;
    totalCount += card.quantity;
    const have = remaining[card.card_name] || 0;
    const used = Math.min(have, card.quantity);
    if (used > 0) {
      remaining[card.card_name] = have - used;
      ownedCount += used;
    }
    const short = card.quantity - used;
    if (short > 0) missing.push({ ...card, quantity: short });
  }

  return { missing, ownedCount, totalCount };
}
