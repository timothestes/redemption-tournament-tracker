import { describe, it, expect } from "vitest";
import { candidatesForDeck } from "../candidates";

// Against the real card index: these are the shapes that made the first pass
// miss cards in production descriptions.
const targetFor = (deckCards: string[], name: string) =>
  candidatesForDeck(deckCards).find((c) => c.name === name)?.target;

describe("candidatesForDeck", () => {
  it("uses the plain name when it lands on the deck's own card", () => {
    expect(targetFor(["Son of God (J)"], "Son of God")).toBe("Son of God");
  });

  it("points at the deck's printing when the plain name is somebody else", () => {
    // [[Jacob]] resolves to Jacob (Israel); [[Simeon]] to the Simeon of Luke 2.
    expect(targetFor(["Jacob (FooF)"], "Jacob")).toBe("Jacob (FooF)");
    expect(targetFor(["Simeon (FooF)"], "Simeon")).toBe("Simeon (FooF)");
  });

  it("still links a reprint whose printing name has brackets", () => {
    // "A New Beginning [RR2]" cannot be a mention target, but it is the same
    // card as "A New Beginning" in everything but brigade.
    expect(targetFor(["A New Beginning [RR2]"], "A New Beginning")).toBe("A New Beginning");
  });

  it("never offers a name it could not write as a mention", () => {
    for (const c of candidatesForDeck(["Covenant with David [K]", "Cherubim [Blake]"])) {
      expect(c.name).not.toMatch(/[[\]|]/);
      expect(c.target).not.toMatch(/[[\]|]/);
    }
  });

  it("skips cards that are not in the public index", () => {
    expect(candidatesForDeck(["Definitely Not A Real Card"])).toEqual([]);
  });
});
