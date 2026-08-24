import { describe, it, expect } from "vitest";
import { parseDecklistText, normalizeApostrophes } from "../parse";
import { DeckCheckError } from "../errors";

describe("parseDecklistText", () => {
  it("parses qty<TAB>name lines into main deck", () => {
    const deck = parseDecklistText("2\tSon of God\n1\tAngel of the Lord\n");
    expect(deck.main).toEqual([
      { quantity: 2, name: "Son of God" },
      { quantity: 1, name: "Angel of the Lord" },
    ]);
    expect(deck.reserve).toEqual([]);
    expect(deck.hasReserve).toBe(false);
  });

  it("routes lines after Reserve: into the reserve", () => {
    const deck = parseDecklistText("1\tSon of God\nReserve:\n1\tBurial\n");
    expect(deck.main).toEqual([{ quantity: 1, name: "Son of God" }]);
    expect(deck.reserve).toEqual([{ quantity: 1, name: "Burial" }]);
    expect(deck.hasReserve).toBe(true);
  });

  it("stops at Tokens:", () => {
    const deck = parseDecklistText("1\tSon of God\nTokens:\n1\tSome Token\n");
    expect(deck.main).toEqual([{ quantity: 1, name: "Son of God" }]);
  });

  it("skips lines without a tab (blank lines, headers)", () => {
    const deck = parseDecklistText("My Deck\n\n1\tSon of God\n");
    expect(deck.main).toEqual([{ quantity: 1, name: "Son of God" }]);
  });

  it("normalizes curly apostrophes in names", () => {
    const deck = parseDecklistText("1\tKing's Pomp\n");
    expect(deck.main[0].name).toBe("King's Pomp");
  });

  it("throws the exact Python message for an empty main deck", () => {
    expect(() => parseDecklistText("Tokens:\n1\tX\n")).toThrowError(
      new DeckCheckError("Please load a deck_file that contains at least one card in the main deck.")
    );
  });
});

describe("normalizeApostrophes", () => {
  it("replaces U+2019 only", () => {
    expect(normalizeApostrophes("a'b'c")).toBe("a'b'c");
  });

  it("replaces all occurrences of U+2019 (regression for multiple apostrophes)", () => {
    expect(normalizeApostrophes("Joseph's Brothers' Scheme")).toBe("Joseph's Brothers' Scheme");
  });
});

describe("parseDecklistText error handling", () => {
  it("throws a plain Error (not DeckCheckError) for non-numeric quantity", () => {
    expect(() => parseDecklistText("abc\tSon of God\n")).toThrowError(Error);
    expect(() => parseDecklistText("abc\tSon of God\n")).not.toThrowError(DeckCheckError);
  });
});
