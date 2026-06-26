import { describe, it, expect } from "vitest";
import { addToDeck, removeFromDeck, setQty } from "../deckMutations";
import type { Card } from "@/app/decklist/card-search/utils";
import type { DeckCard } from "@/app/decklist/card-search/types/deck";

const card = (dataLine: string): Card => ({
  dataLine, name: dataLine, set: "Forge", imgFile: "", officialSet: "", type: "Hero",
  brigade: "Blue", strength: "1", toughness: "1", class: "", identifier: "",
  specialAbility: "", rarity: "", reference: "", alignment: "Good", legality: "",
  testament: "", isGospel: false,
});

describe("deck mutations (keyed by dataLine|zone)", () => {
  it("addToDeck appends new and increments existing", () => {
    let cards: DeckCard[] = [];
    cards = addToDeck(cards, card("forge:a"), "main");
    cards = addToDeck(cards, card("forge:a"), "main");
    cards = addToDeck(cards, card("forge:a"), "reserve");
    expect(cards).toHaveLength(2);
    expect(cards.find((c) => c.card.dataLine === "forge:a" && c.zone === "main")?.quantity).toBe(2);
  });

  it("removeFromDeck decrements then deletes", () => {
    let cards = addToDeck(addToDeck([], card("forge:a"), "main"), card("forge:a"), "main");
    cards = removeFromDeck(cards, "forge:a", "main");
    expect(cards[0].quantity).toBe(1);
    cards = removeFromDeck(cards, "forge:a", "main");
    expect(cards).toHaveLength(0);
  });

  it("setQty sets exact and removes at <= 0", () => {
    let cards = addToDeck([], card("forge:a"), "main");
    cards = setQty(cards, "forge:a", "main", 4);
    expect(cards[0].quantity).toBe(4);
    cards = setQty(cards, "forge:a", "main", 0);
    expect(cards).toHaveLength(0);
  });
});
