import { describe, it, expect } from "vitest";
import { buildReplacedHalf } from "../replaceHalf";
import type { DeckCard, DeckZone } from "../../types/deck";
import type { Card } from "../../utils";

// Minimal DeckCard fixture — buildReplacedHalf only reads card.alignment, quantity, zone.
function dc(
  alignment: string,
  quantity: number,
  name: string,
  zone: DeckZone = "main"
): DeckCard {
  return { card: { name, alignment } as Card, quantity, zone };
}

describe("buildReplacedHalf", () => {
  it("removes strictly-good cards and adds the source's strictly-good cards", () => {
    const current = [dc("Good", 2, "G1"), dc("Evil", 3, "E1"), dc("Neutral", 1, "N1")];
    const source = [dc("Good", 4, "G2"), dc("Evil", 9, "E2")];

    const result = buildReplacedHalf(current, source, "good");

    expect(result.removed).toBe(2); // the 2x G1 removed
    expect(result.added).toBe(4); // the 4x G2 added
    // Evil and Neutral from current are untouched; source evil is ignored.
    const names = result.cards.map((c) => c.card.name).sort();
    expect(names).toEqual(["E1", "G2", "N1"]);
  });

  it("does not treat dual 'Good/Evil' cards as part of the good half", () => {
    const current = [dc("Good/Evil", 2, "D1"), dc("Good", 1, "G1")];
    const source = [dc("Good/Evil", 5, "D2"), dc("Good", 1, "G2")];

    const result = buildReplacedHalf(current, source, "good");

    expect(result.removed).toBe(1); // only G1
    expect(result.added).toBe(1); // only G2 (D2 ignored)
    const names = result.cards.map((c) => c.card.name).sort();
    expect(names).toEqual(["D1", "G2"]); // current dual D1 stays
  });

  it("preserves zone and quantity of added cards", () => {
    const current = [dc("Evil", 1, "E1", "main")];
    const source = [dc("Good", 7, "G1", "reserve"), dc("Good", 2, "G2", "maybeboard")];

    const result = buildReplacedHalf(current, source, "good");

    const g1 = result.cards.find((c) => c.card.name === "G1")!;
    const g2 = result.cards.find((c) => c.card.name === "G2")!;
    expect(g1.zone).toBe("reserve");
    expect(g1.quantity).toBe(7);
    expect(g2.zone).toBe("maybeboard");
  });

  it("works symmetrically for evil", () => {
    const current = [dc("Good", 2, "G1"), dc("Evil", 3, "E1")];
    const source = [dc("Evil", 5, "E2")];

    const result = buildReplacedHalf(current, source, "evil");

    expect(result.removed).toBe(3);
    expect(result.added).toBe(5);
    const names = result.cards.map((c) => c.card.name).sort();
    expect(names).toEqual(["E2", "G1"]);
  });

  it("reports added=0 when the source has no matching-alignment cards", () => {
    const current = [dc("Good", 2, "G1"), dc("Evil", 1, "E1")];
    const source = [dc("Evil", 5, "E2")];

    const result = buildReplacedHalf(current, source, "good");

    expect(result.added).toBe(0);
    expect(result.removed).toBe(2);
  });
});
