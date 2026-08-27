import { describe, it, expect } from "vitest";
import { resolveDeck } from "../resolve";

const parsed = (main: Array<[number, string]>, reserve: Array<[number, string]> = []) => ({
  main: main.map(([quantity, name]) => ({ quantity, name })),
  reserve: reserve.map(([quantity, name]) => ({ quantity, name })),
  hasReserve: reserve.length > 0,
});

describe("resolveDeck", () => {
  it("resolves a known card and attaches quantity, rawBrigade, brigades", () => {
    const deck = resolveDeck(parsed([[2, "Shield of Faith"]]));
    const card = deck.main.get("Shield of Faith")!;
    expect(card.quantity).toBe(2);
    expect(typeof card.rawBrigade).toBe("string");
    expect(Array.isArray(card.brigades)).toBe(true);
    expect(deck.mainSize).toBe(2);
  });

  it("resolves a curly-apostrophe catalog name from straight-apostrophe input", () => {
    // Catalog has "Abraham’s Deceit (LoC)" (curly apostrophe); the deck line
    // input uses a straight apostrophe, as real decklist exports do.
    const deck = resolveDeck(parsed([[1, "Abraham's Deceit (LoC)"]]));
    expect(deck.mainSize).toBe(1);
  });

  it("silently skips unknown names (print-and-skip parity)", () => {
    const deck = resolveDeck(parsed([[1, "Shield of Faith"], [3, "Totally Fake Card"]]));
    expect(deck.mainSize).toBe(1);
    expect(deck.main.has("Totally Fake Card")).toBe(false);
  });

  it("merges duplicate lines by summing quantity", () => {
    const deck = resolveDeck(parsed([[1, "Shield of Faith"], [2, "Shield of Faith"]]));
    expect(deck.main.get("Shield of Faith")!.quantity).toBe(3);
  });

  it("strips doubled and wrapping quotes like the Python", () => {
    // Python: card["name"].replace('""', '"').strip('"')
    const deck = resolveDeck(parsed([[1, '"Shield of Faith"']]));
    expect(deck.mainSize).toBe(1);
  });
});
