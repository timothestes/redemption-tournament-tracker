import { describe, it, expect } from "vitest";
import { buildAliasIndex, lookupAlias, CARD_ALIASES, aliasTarget, type CardAlias } from "../aliases";
import { CARDS, findCard } from "../lookup";
import { cardNameKey } from "../nameKey";
import { cardNameStem } from "../cardIdentity";

const LAFS: CardAlias = { alias: "LAFS", name: "Love at First Sight (LoC)", set: "LoC" };

describe("buildAliasIndex", () => {
  it("keys an alias the loose way a person types it", () => {
    const index = buildAliasIndex([LAFS]);
    expect(index.get(cardNameKey("  lAfS  "))?.name).toBe("Love at First Sight (LoC)");
  });

  it("keeps the first entry when two rows share a key", () => {
    const index = buildAliasIndex([LAFS, { alias: "lafs", name: "Love at First Sight", set: "Pat" }]);
    expect(index.get("lafs")?.set).toBe("LoC");
  });
});

describe("lookupAlias", () => {
  it("resolves to the exact printing the alias names", () => {
    const card = lookupAlias(buildAliasIndex([LAFS]), "lafs");
    expect(card?.name).toBe("Love at First Sight (LoC)");
    expect(card?.set).toBe("LoC");
    expect(card?.imgFile).toBe(findCard("Love at First Sight (LoC)", "LoC")!.imgFile);
  });

  it("is undefined for an alias nobody defined", () => {
    expect(lookupAlias(buildAliasIndex([LAFS]), "nope")).toBeUndefined();
  });

  it("is undefined when the target printing left the catalog", () => {
    const index = buildAliasIndex([{ alias: "GONE", name: "No Such Card", set: "ZZZ" }]);
    expect(lookupAlias(index, "gone")).toBeUndefined();
  });

  it("does not fall back to another printing when the set is wrong", () => {
    // findCard() degrades to a name-only match; an alias must not inherit that,
    // or a stale set_code would silently point at a different print's art.
    const index = buildAliasIndex([{ alias: "X", name: "Love at First Sight (LoC)", set: "Pat" }]);
    expect(lookupAlias(index, "x")).toBeUndefined();
  });
});

describe("the committed alias overlay", () => {
  it("names a card that is still in the catalog", () => {
    for (const entry of CARD_ALIASES) {
      expect(aliasTarget(entry.alias), `alias "${entry.alias}" is orphaned`).toBeDefined();
    }
  });

  it("never shadows a real card name or name stem", () => {
    const taken = new Set<string>();
    for (const card of CARDS) {
      taken.add(cardNameKey(card.name));
      taken.add(cardNameKey(cardNameStem(card.name, card.type)));
    }
    for (const entry of CARD_ALIASES) {
      expect(taken.has(cardNameKey(entry.alias)), `alias "${entry.alias}" is also a card name`).toBe(false);
    }
  });
});
