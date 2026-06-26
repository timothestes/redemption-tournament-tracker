"use client";

import { useCallback, useState } from "react";
import type { Card } from "@/app/decklist/card-search/utils";
import type { DeckCard, DeckZone } from "@/app/decklist/card-search/types/deck";
import { addToDeck, removeFromDeck, setQty } from "@/app/forge/lib/deckMutations";

export function useForgeDeckState(initial: DeckCard[]) {
  const [cards, setCards] = useState<DeckCard[]>(initial);
  const addCard = useCallback((card: Card, zone: DeckZone = "main") => setCards((c) => addToDeck(c, card, zone)), []);
  const removeCard = useCallback((dataLine: string, zone: DeckZone) => setCards((c) => removeFromDeck(c, dataLine, zone)), []);
  const setQuantity = useCallback((dataLine: string, zone: DeckZone, qty: number) => setCards((c) => setQty(c, dataLine, zone, qty)), []);
  return { cards, setCards, addCard, removeCard, setQuantity };
}
