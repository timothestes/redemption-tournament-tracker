// Pure immutable list helpers for the Forge deck builder, keyed by dataLine|zone
// (public Cards have a unique name|set|imgFile dataLine; forge Cards use forge:{cardId}).
import type { Card } from "@/app/decklist/card-search/utils";
import type { DeckCard, DeckZone } from "@/app/decklist/card-search/types/deck";

const match = (dc: DeckCard, dataLine: string, zone: DeckZone) =>
  dc.card.dataLine === dataLine && dc.zone === zone;

export function addToDeck(cards: DeckCard[], card: Card, zone: DeckZone): DeckCard[] {
  const i = cards.findIndex((dc) => match(dc, card.dataLine, zone));
  if (i >= 0) {
    const next = [...cards];
    next[i] = { ...next[i], quantity: next[i].quantity + 1 };
    return next;
  }
  return [...cards, { card, quantity: 1, zone }];
}

export function removeFromDeck(cards: DeckCard[], dataLine: string, zone: DeckZone): DeckCard[] {
  const i = cards.findIndex((dc) => match(dc, dataLine, zone));
  if (i < 0) return cards;
  if (cards[i].quantity > 1) {
    const next = [...cards];
    next[i] = { ...next[i], quantity: next[i].quantity - 1 };
    return next;
  }
  return cards.filter((_, j) => j !== i);
}

export function setQty(cards: DeckCard[], dataLine: string, zone: DeckZone, qty: number): DeckCard[] {
  if (qty <= 0) return cards.filter((dc) => !match(dc, dataLine, zone));
  const i = cards.findIndex((dc) => match(dc, dataLine, zone));
  if (i < 0) return cards;
  const next = [...cards];
  next[i] = { ...next[i], quantity: qty };
  return next;
}
