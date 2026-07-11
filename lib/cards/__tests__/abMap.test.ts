import { describe, it, expect } from "vitest";
import { CARDS, hasAbReprint } from "../lookup";
import abMap from "../generated/abMap.json";

// The generator (scripts/parse-carddata.js) asserts these invariants at build
// time; this test guards the committed artifact in CI without re-running it.

const isAb = (set: string) => /\(AB\)/.test(set);
const keyOf = (c: { name: string; set: string }) => `${c.name}|${c.set}`;
const map = abMap as Record<string, string>;

const abCards = CARDS.filter((c) => isAb(c.set));
const byKey = new Map(CARDS.map((c) => [keyOf(c), c] as const));

describe("abMap.json integrity", () => {
  it("has the AB cards we expect (3 sets, 129 each)", () => {
    expect(abCards.length).toBe(387);
    const sets = new Set(abCards.map((c) => c.set));
    expect([...sets].sort()).toEqual(["CoW (AB)", "RoJ (AB)", "T2C (AB)"]);
  });

  it("maps every AB card to an original", () => {
    const unmapped = abCards.filter((c) => !(keyOf(c) in map));
    expect(unmapped.map(keyOf)).toEqual([]);
    expect(Object.keys(map).length).toBe(abCards.length);
  });

  it("is 1:1 — no original claimed by two AB cards", () => {
    const originals = Object.values(map);
    expect(new Set(originals).size).toBe(originals.length);
  });

  it("points every original at a real, non-AB card", () => {
    for (const [abKey, origKey] of Object.entries(map)) {
      const original = byKey.get(origKey);
      expect(original, `original missing for ${abKey}`).toBeDefined();
      expect(isAb(original!.set), `original ${origKey} is itself AB`).toBe(false);
    }
  });

  it("hasAbReprint() is true for mapped originals and false for their AB cards", () => {
    // Every mapped original reports true.
    for (const origKey of Object.values(map)) {
      const c = byKey.get(origKey)!;
      expect(hasAbReprint(c.name, c.set)).toBe(true);
    }
    // The AB prints themselves are not "originals with an AB".
    for (const ab of abCards) {
      expect(hasAbReprint(ab.name, ab.set)).toBe(false);
    }
  });

  it("resolves a couple of known tricky pairs correctly", () => {
    expect(map["Cherubim [Blake] [T2C AB]|T2C (AB)"]).toBe("Cherubim [Blake]|T2C");
    expect(map["Daniel (CoW AB)|CoW (AB)"]).toBe("Daniel (CoW)|CoW [Ban]");
    expect(map["The Blinding Angel (RoJ AB)|RoJ (AB)"]).toBe("The Binding Angel (RoJ)|RoJ");
  });
});
