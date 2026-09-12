import { describe, it, expect } from "vitest";
import { searchCardNames } from "../search";
import { CARDS, findCard } from "../lookup";
import { cardNameStem } from "../cardIdentity";
import { CARD_ALIASES, aliasTarget } from "../aliases";
import { resolveCardRef } from "@/app/articles/lib/cardRefs";

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

describe("searchCardNames + aliases", () => {
  it("finds a card by a curated alias", () => {
    for (const entry of CARD_ALIASES) {
      const hits = searchCardNames(entry.alias, 50);
      const match = hits.find((h) => h.alias === entry.alias);
      expect(match, `alias "${entry.alias}" is not searchable`).toBeDefined();
      expect(match!.imgFile).toBeTruthy();
    }
  });

  it("inserts text that resolves back to the printing the alias names", () => {
    // Usually the printing's own name. Not always: "DR" names
    // "Dragon Raid [RR2]", and brackets cannot appear inside `[[ ]]`, so the
    // alias itself is inserted instead. Either way the round trip must hold —
    // asserting the text is merely "a card name" would accept the wrong card.
    for (const entry of CARD_ALIASES) {
      const match = searchCardNames(entry.alias, 50).find((h) => h.alias === entry.alias)!;
      expect(match.name).not.toMatch(/[[\]|\n]/);
      expect(resolveCardRef(match.name)?.imgFile, `"${match.name}" does not lead back to ${entry.alias}`).toBe(
        aliasTarget(entry.alias)!.imgFile,
      );
    }
  });

  it("ranks an alias match above substring matches", () => {
    for (const entry of CARD_ALIASES) {
      expect(searchCardNames(entry.alias, 50)[0]?.alias).toBe(entry.alias);
    }
  });

  it("returns one row per card even when the alias and the name both match", () => {
    for (const entry of CARD_ALIASES) {
      const hits = searchCardNames(entry.alias, 50);
      expect(new Set(hits.map((h) => `${h.name}|${h.set}`)).size).toBe(hits.length);
    }
  });

  it("leaves alias unset on an ordinary name match", () => {
    expect(searchCardNames("son of god")[0].alias).toBeUndefined();
  });
});
