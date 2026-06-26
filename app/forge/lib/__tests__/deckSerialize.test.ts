import { describe, it, expect } from "vitest";
import { entriesFromDeckCards, hydrateEntries, deckCardCount, toValidatableDeck } from "../deckSerialize";
import { designCardToCard } from "../deckAdapter";
import type { Card } from "@/app/decklist/card-search/utils";
import type { DeckCard } from "@/app/decklist/card-search/types/deck";
import { validateDeck } from "@/app/decklist/card-search/utils/deckValidation";

const pub = (name: string, set: string): Card => ({
  dataLine: `${name}|${set}|${name}_(${set})`, name, set, imgFile: `${name}_(${set})`,
  officialSet: set, type: "Hero", brigade: "Blue", strength: "5", toughness: "5",
  class: "", identifier: "", specialAbility: "", rarity: "Common", reference: "",
  alignment: "Good", legality: "Rotation", testament: "OT", isGospel: false,
});
const forge = designCardToCard({ name: "FC", cardType: ["Hero"], brigades: ["Blue"] }, "cid", "S");

describe("deck serialize / hydrate", () => {
  it("round-trips public + forge entries", () => {
    const cards: DeckCard[] = [
      { card: pub("Angel", "Pa"), quantity: 2, zone: "main" },
      { card: forge, quantity: 1, zone: "reserve" },
    ];
    const entries = entriesFromDeckCards(cards);
    expect(entries).toEqual([
      { source: "public", name: "Angel", set: "Pa", qty: 2, zone: "main" },
      { source: "forge", cardId: "cid", qty: 1, zone: "reserve" },
    ]);
  });

  it("hydrate drops entries that no longer resolve (revoked grant / un-approved card)", () => {
    const entries = entriesFromDeckCards([
      { card: pub("Angel", "Pa"), quantity: 1, zone: "main" },
      { card: forge, quantity: 1, zone: "main" },
    ]);
    const { cards, dropped } = hydrateEntries(
      entries,
      () => undefined,                         // forge card no longer granted → drop
      (name, set) => (name === "Angel" && set === "Pa" ? pub("Angel", "Pa") : undefined),
    );
    expect(cards).toHaveLength(1);
    expect(dropped).toBe(1);
  });

  it("deckCardCount sums main-zone quantities by default", () => {
    const entries = entriesFromDeckCards([
      { card: pub("A", "Pa"), quantity: 3, zone: "main" },
      { card: pub("B", "Pa"), quantity: 5, zone: "reserve" },
    ]);
    expect(deckCardCount(entries)).toBe(3);
  });

  it("toValidatableDeck produces a Deck that validateDeck can score", () => {
    const deck = toValidatableDeck([{ card: pub("Angel", "Pa"), quantity: 1, zone: "main" }], "My Deck", "Type 1");
    const result = validateDeck(deck);
    expect(result.stats.mainDeckSize).toBe(1);
    expect(typeof result.isValid).toBe("boolean");
  });
});
