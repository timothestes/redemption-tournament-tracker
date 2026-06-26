// Pure: convert between the builder's DeckCard[] and the stored ForgeDeckEntry[],
// hydrate stored entries back into DeckCard[] via injected resolvers (forge cards
// that no longer resolve under the caller's RLS are dropped — fail-closed), and
// build a validateDeck-compatible Deck.
import type { Card } from "@/app/decklist/card-search/utils";
import type { DeckCard, DeckZone, Deck } from "@/app/decklist/card-search/types/deck";
import type { ForgeDeckEntry } from "./deckTypes";
import { isForgeDataLine, cardIdFromDataLine } from "./deckAdapter";

export function entriesFromDeckCards(cards: DeckCard[]): ForgeDeckEntry[] {
  return cards.map((dc) =>
    isForgeDataLine(dc.card.dataLine)
      ? { source: "forge", cardId: cardIdFromDataLine(dc.card.dataLine), qty: dc.quantity, zone: dc.zone }
      : { source: "public", name: dc.card.name, set: dc.card.set, qty: dc.quantity, zone: dc.zone }
  );
}

export function hydrateEntries(
  entries: ForgeDeckEntry[],
  resolveForge: (cardId: string) => Card | undefined,
  resolvePublic: (name: string, set: string) => Card | undefined,
): { cards: DeckCard[]; dropped: number } {
  const cards: DeckCard[] = [];
  let dropped = 0;
  for (const e of entries) {
    const card = e.source === "forge" ? resolveForge(e.cardId) : resolvePublic(e.name, e.set);
    if (!card) { dropped++; continue; }
    cards.push({ card, quantity: e.qty, zone: e.zone });
  }
  return { cards, dropped };
}

export function deckCardCount(entries: ForgeDeckEntry[], zone: DeckZone = "main"): number {
  return entries.reduce((n, e) => n + (e.zone === zone ? e.qty : 0), 0);
}

export function toValidatableDeck(
  cards: DeckCard[], name: string, format: string, paragon?: string | null,
): Deck {
  return {
    name,
    cards,
    format,
    paragon: paragon ?? undefined,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}
