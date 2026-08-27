import { CARDS, type CardData } from "@/lib/cards/lookup";
import { normalizeApostrophes } from "./parse";
import { normalizeBrigadesFrozen } from "./brigades";
import type { DeckEntry, ParsedDeck, ResolvedCard, ResolvedDeck } from "./types";

let cardMap: Map<string, CardData> | null = null;

/** Name-keyed, apostrophe-normalized, last-wins (parity with the jsonl loader + getCardDatabase semantics). */
export function buildNormalizedCardMap(): Map<string, CardData> {
  if (cardMap) return cardMap;
  cardMap = new Map();
  for (const card of CARDS) cardMap.set(normalizeApostrophes(card.name), card);
  return cardMap;
}

/** Parity with Python: card["name"].replace('""', '"').strip('"'). */
function stripQuotes(name: string): string {
  return name.replace(/""/g, '"').replace(/^"+|"+$/g, "");
}

/** Parity with Python Decklist._map_card_metadata. */
function mapCardMetadata(entries: DeckEntry[], map: Map<string, CardData>): Map<string, ResolvedCard> {
  const result = new Map<string, ResolvedCard>();
  for (const entry of entries) {
    const cardName = stripQuotes(entry.name);
    const card = map.get(cardName);
    if (!card) {
      console.warn(`Could not find ${entry.name}. Skipping loading it.`);
      continue;
    }
    const existing = result.get(cardName);
    if (existing) {
      existing.quantity += entry.quantity;
    } else {
      result.set(cardName, {
        ...card,
        quantity: entry.quantity,
        rawBrigade: card.brigade,
        // Python passes the deck line's (pre-quote-stripped) name here, not the
        // catalog name or the quote-stripped lookup key — keep that.
        brigades: normalizeBrigadesFrozen(card.brigade, card.alignment, entry.name),
      });
    }
  }
  return result;
}

/** Parity with Python Decklist._get_size_of. */
function getSizeOf(cardList: Map<string, ResolvedCard>): number {
  let total = 0;
  for (const card of cardList.values()) total += card.quantity;
  return total;
}

export function resolveDeck(parsed: ParsedDeck): ResolvedDeck {
  const map = buildNormalizedCardMap();
  const main = mapCardMetadata(parsed.main, map);
  const reserve = mapCardMetadata(parsed.reserve, map);
  return {
    main,
    reserve,
    mainSize: getSizeOf(main),
    reserveSize: getSizeOf(reserve),
  };
}
