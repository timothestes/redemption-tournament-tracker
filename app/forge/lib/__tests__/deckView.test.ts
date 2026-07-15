import { describe, it, expect } from "vitest";
import {
  resolveDeckEntries,
  groupMainItems,
  sortSideItems,
  splitStack,
  countItems,
  getGroupKey,
  getGroupDisplayName,
} from "../deckView";
import type { Card } from "@/app/decklist/card-search/utils";
import type { GrantedForgeCard } from "@/app/forge/lib/deckPool";
import type { DesignCard } from "@/app/forge/lib/designCard";
import type { ForgeDeckEntry } from "@/app/forge/lib/deckTypes";

const granted = (cardId: string, name: string, overrides: Partial<GrantedForgeCard> = {}): GrantedForgeCard => ({
  cardId,
  setId: "set-1",
  setName: "Test Set",
  hasApprovedArt: false,
  hasApprovedFinished: false,
  versionId: "v1",
  data: {
    name,
    cardType: ["Hero"],
    brigades: ["Blue"],
    testament: [],
    identifiers: [],
    specialAbility: "",
    strength: 5,
    toughness: 5,
    reference: "",
    scripture: "",
    legality: "",
    rarity: "",
    alignment: "Good",
  } as unknown as DesignCard,
  ...overrides,
});

const publicCard = (name: string, set: string, type: string, alignment = "", brigade = ""): Card =>
  ({ name, set, type, alignment, brigade, imgFile: `${name}.jpg`, dataLine: "" } as unknown as Card);

describe("resolveDeckEntries", () => {
  const pool = [granted("abc", "Forged Hero", { hasApprovedArt: true })];
  const catalog = [publicCard("Angel of the Lord", "I", "Hero", "Good", "Silver")];

  it("resolves a granted forge entry to its design card", () => {
    const entries: ForgeDeckEntry[] = [{ source: "forge", cardId: "abc", qty: 2, zone: "main" }];
    const [item] = resolveDeckEntries(pool, entries, catalog);
    expect(item.name).toBe("Forged Hero");
    expect(item.type).toBe("Hero");
    expect(item.qty).toBe(2);
    expect(item.forge?.data?.name).toBe("Forged Hero");
    expect(item.forge?.hasArt).toBe(true);
    expect(item.forge?.hasFinished).toBe(false);
  });

  it("keeps dangling forge refs as explicit placeholders instead of dropping them", () => {
    const entries: ForgeDeckEntry[] = [{ source: "forge", cardId: "gone", qty: 3, zone: "main" }];
    const [item] = resolveDeckEntries(pool, entries, catalog);
    expect(item.forge).not.toBeNull();
    expect(item.forge?.data).toBeNull();
    expect(item.name).toBe("Forge card");
    expect(item.qty).toBe(3);
    // Dangling refs group under an explicit heading, not an empty one.
    expect(getGroupKey(item.type)).toBe("Forge Card");
    expect(getGroupDisplayName(getGroupKey(item.type))).toBe("Forge Cards");
  });

  it("resolves public entries from the catalog by name|set", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "public", name: "Angel of the Lord", set: "I", qty: 1, zone: "main" },
      { source: "public", name: "Not A Card", set: "X", qty: 1, zone: "reserve" },
    ];
    const [hit, miss] = resolveDeckEntries(pool, entries, catalog);
    expect(hit.type).toBe("Hero");
    expect(hit.imgFile).toBe("Angel of the Lord.jpg");
    expect(hit.forge).toBeNull();
    expect(miss.type).toBe("");
    expect(miss.imgFile).toBe("");
  });
});

describe("grouping and sorting", () => {
  it("merges Artifact/Covenant/Curse and Fortress/Site groups like the public page", () => {
    expect(getGroupKey("Art")).toBe("Artifact/Covenant/Curse");
    expect(getGroupKey("Curse")).toBe("Artifact/Covenant/Curse");
    expect(getGroupKey("Site")).toBe("Fortress/Site");
    expect(getGroupKey("GE")).toBe("Good Enhancement");
    expect(getGroupDisplayName("Lost Soul")).toBe("Lost Souls");
  });

  it("orders main-item groups canonically and Good before Evil within a group", () => {
    const catalog = [
      publicCard("Zeal", "I", "GE", "Good", "Silver"),
      publicCard("Guard", "I", "Hero", "Good", "Silver"),
      publicCard("Demon", "I", "EC", "Evil", "Brown"),
      publicCard("Mixed", "I", "Hero", "Evil", "Brown"),
    ];
    const entries: ForgeDeckEntry[] = catalog.map((c) => ({
      source: "public" as const, name: c.name, set: c.set, qty: 1, zone: "main" as const,
    }));
    const groups = groupMainItems(resolveDeckEntries([], entries, catalog));
    expect(groups.map(([g]) => g)).toEqual(["Hero", "Good Enhancement", "Evil Character"]);
    const heroes = groups.find(([g]) => g === "Hero")![1];
    // Same type → Good alignment before Evil.
    expect(heroes.map((i) => i.name)).toEqual(["Guard", "Mixed"]);
  });

  it("groups by alignment in Good > Evil > Neutral order, blank alignment → Neutral", () => {
    const catalog = [
      publicCard("Demon", "I", "EC", "Evil", "Brown"),
      publicCard("Guard", "I", "Hero", "Good", "Silver"),
      publicCard("Wall", "I", "Fort", "", ""),
    ];
    const entries: ForgeDeckEntry[] = catalog.map((c) => ({
      source: "public" as const, name: c.name, set: c.set, qty: 1, zone: "main" as const,
    }));
    const groups = groupMainItems(resolveDeckEntries([], entries, catalog), "alignment");
    expect(groups.map(([g]) => g)).toEqual(["Good", "Evil", "Neutral"]);
    expect(groups.find(([g]) => g === "Neutral")![1].map((i) => i.name)).toEqual(["Wall"]);
  });

  it("puts everything in one sorted group when grouping is off", () => {
    const catalog = [
      publicCard("Demon", "I", "EC", "Evil", "Brown"),
      publicCard("Guard", "I", "Hero", "Good", "Silver"),
    ];
    const entries: ForgeDeckEntry[] = catalog.map((c) => ({
      source: "public" as const, name: c.name, set: c.set, qty: 1, zone: "main" as const,
    }));
    const groups = groupMainItems(resolveDeckEntries([], entries, catalog), "none");
    expect(groups.map(([g]) => g)).toEqual(["All Cards"]);
    expect(groups[0][1].map((i) => i.name)).toEqual(["Demon", "Guard"]); // "EC" before "Hero" by type
  });

  it("sorts side items in the classic deck order and counts quantities", () => {
    const catalog = [
      publicCard("Bravery", "I", "GE"),
      publicCard("Axe", "I", "EE"),
    ];
    const entries: ForgeDeckEntry[] = [
      { source: "public", name: "Bravery", set: "I", qty: 2, zone: "reserve" },
      { source: "public", name: "Axe", set: "I", qty: 1, zone: "reserve" },
    ];
    const items = sortSideItems(resolveDeckEntries([], entries, catalog));
    expect(items.map((i) => i.name)).toEqual(["Axe", "Bravery"]); // "EE" before "GE" by type
    expect(countItems(items)).toBe(3);
  });
});

describe("splitStack", () => {
  const item = (name: string, qty: number) => {
    const catalog = [publicCard(name, "I", "Hero", "Good", "Silver")];
    const entries: ForgeDeckEntry[] = [{ source: "public", name, set: "I", qty, zone: "main" }];
    return resolveDeckEntries([], entries, catalog)[0];
  };

  it("keeps a group at or under the column cap in one column", () => {
    const items = [item("A", 10), item("B", 7)];
    expect(splitStack(items)).toEqual([items]);
  });

  it("splits by physical card count (quantities expanded), not unique cards", () => {
    const items = [item("A", 10), item("B", 10), item("C", 10)];
    const columns = splitStack(items);
    expect(columns.length).toBe(2);
    expect(columns.flat()).toEqual(items);
    // Balanced: neither column exceeds ~half the 30 cards by more than one item.
    const counts = columns.map((col) => col.reduce((n, i) => n + i.qty, 0));
    expect(Math.max(...counts)).toBeLessThanOrEqual(20);
  });
});
