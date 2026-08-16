import { describe, it, expect } from "vitest";
import { checkDeck } from "../index";
import type { DeckCheckCard } from "../types";
import { OFFICIAL_DECKS } from "../officialDecks";
import { findCard } from "@/lib/cards/lookup";

/** The 4 official R.A.I.D. lists, as a deck-check caller would submit them. */
function submission(deckIndex: number): DeckCheckCard[] {
  return OFFICIAL_DECKS[deckIndex].cards.map((c) => ({ ...c }));
}

describe("official R.A.I.D. decks", () => {
  it("defines 4 decks of exactly 25 cards each", () => {
    expect(OFFICIAL_DECKS).toHaveLength(4);
    for (const deck of OFFICIAL_DECKS) {
      const size = deck.cards.reduce((sum, c) => sum + c.quantity, 0);
      expect(size, deck.name).toBe(25);
    }
  });

  // Drift guard: `make update-cards` regenerates the card database from
  // upstream. A rename or set-code change there would silently stop these
  // lists from resolving, which would silently unexempt them.
  it("every card resolves against the card database on its exact name+set", () => {
    for (const deck of OFFICIAL_DECKS) {
      for (const entry of deck.cards) {
        const card = findCard(entry.name, entry.set);
        expect(card, `${deck.name}: ${entry.name} (${entry.set})`).toBeDefined();
        expect(card!.name).toBe(entry.name);
        expect(card!.set).toBe(entry.set);
      }
    }
  });

  it.each(OFFICIAL_DECKS.map((d, i) => [d.name, i] as const))(
    "%s passes deck check despite being under the Limited minimum",
    async (_name, index) => {
      const result = await checkDeck(submission(index), [], "Limited");

      expect(result.valid).toBe(true);
      expect(result.issues.filter((i) => i.type === "error")).toEqual([]);
      expect(result.stats.mainDeckSize).toBe(25);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ type: "info", rule: "official-deck" })
      );
    }
  );

  it("stays exempt when the caller omits set codes (raw decklist paste)", async () => {
    const cards = submission(0).map((c) => ({ ...c, set: "" }));
    const result = await checkDeck(cards, [], "Limited");

    expect(result.valid).toBe(true);
  });

  it("stays exempt when the rows arrive in a different order", async () => {
    const cards = submission(1).slice().reverse();
    const result = await checkDeck(cards, [], "Limited");

    expect(result.valid).toBe(true);
  });
});

describe("modified copies of an official R.A.I.D. deck", () => {
  it("is illegal once a card is added", async () => {
    const cards = [
      ...submission(0),
      { name: "Zeal for the Lord (Roots)", set: "RR", quantity: 1 },
    ];
    const result = await checkDeck(cards, [], "Limited");

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.type === "error" && i.rule === "t1-deck-size")).toBe(true);
  });

  it("is illegal once a card is removed", async () => {
    const cards = submission(1).slice(0, -1);
    const result = await checkDeck(cards, [], "Limited");

    expect(result.valid).toBe(false);
  });

  it("is illegal once a quantity changes", async () => {
    const cards = submission(2).map((c) =>
      c.quantity === 5 ? { ...c, quantity: 6 } : c
    );
    const result = await checkDeck(cards, [], "Limited");

    expect(result.valid).toBe(false);
  });

  it("is illegal once a card is swapped for a different card", async () => {
    const cards = submission(3).slice();
    cards[0] = { name: "Hunger (Roots)", set: "RR", quantity: 1 };
    const result = await checkDeck(cards, [], "Limited");

    expect(result.valid).toBe(false);
  });

  it("is illegal once a card is swapped for a different printing", async () => {
    // "Hinds' Feet" exists in both Roots and Prophets; only the Roots
    // printing is in the official list.
    const cards = submission(2).map((c) =>
      c.name === "Hinds’ Feet (Roots)"
        ? { name: "Hinds' Feet", set: "Prp", quantity: 1 }
        : c
    );
    const result = await checkDeck(cards, [], "Limited");

    expect(result.valid).toBe(false);
  });

  it("is illegal once a card is moved to the reserve", async () => {
    const cards = submission(0).slice();
    const moved = cards.pop()!;
    const result = await checkDeck(cards, [moved], "Limited");

    expect(result.valid).toBe(false);
  });
});
