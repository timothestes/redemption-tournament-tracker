import { describe, it, expect } from "vitest";
import { searchCardNames } from "../search";
import { CARDS, findCard } from "../lookup";
import { cardNameStem } from "../cardIdentity";

describe("searchCardNames", () => {
  it("returns nothing for a blank query", () => {
    expect(searchCardNames("  ")).toEqual([]);
  });

  it("collapses every Son of God printing into one row that inserts the plain stem", () => {
    const hits = searchCardNames("son of god");
    const sog = hits.filter((h) => h.label === "Son of God");
    expect(sog).toHaveLength(1);
    expect(hits[0].label).toBe("Son of God");
    // No printing is literally named "Son of God"; the stem is what the
    // mention resolver matches on (see cardRefs.test.ts).
    expect(sog[0].name).toBe("Son of God");
    expect(CARDS.some((c) => cardNameStem(c.name, c.type) === sog[0].name)).toBe(true);
    expect(sog[0].imgFile).toBeTruthy();
  });

  it("keeps distinct cards that share a stem as separate rows with printing names", () => {
    const aarons = searchCardNames("aaron", 50).filter((h) => h.label === "Aaron");
    expect(aarons.length).toBeGreaterThan(1);
    for (const h of aarons) {
      expect(h.name).not.toBe("Aaron");
      expect(findCard(h.name)).toBeDefined();
    }
  });

  it("is case-insensitive and matches inside a name", () => {
    const hits = searchCardNames("OF THE LORD");
    expect(hits.some((h) => /of the lord/i.test(h.label))).toBe(true);
  });

  it("respects the limit and fills every field", () => {
    const hits = searchCardNames("a", 5);
    expect(hits).toHaveLength(5);
    for (const h of hits) {
      expect(h.imgFile).toBeTruthy();
      expect(h.set).toBeTruthy();
      expect(h.type).toBeTruthy();
    }
  });
});
