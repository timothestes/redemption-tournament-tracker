import { describe, it, expect } from "vitest";
import {
  POOL_ID,
  createDefaultState,
  addToPool,
  addTier,
  removeTier,
  removeCard,
  renameTier,
  clearCards,
  moveCard,
  findContainer,
  totalPlaced,
  encodeShare,
  decodeShare,
  fromSerializable,
  colorForIndex,
} from "../state";

const KEY_A = "Angel of the Lord|Wa";
const KEY_B = "Son of God|GoC";
const KEY_C = "Philosophy|Wo";

describe("createDefaultState", () => {
  it("starts with six empty tiers plus a pool", () => {
    const s = createDefaultState();
    expect(s.tiers.map((t) => t.label)).toEqual(["S", "A", "B", "C", "D", "F"]);
    expect(Object.keys(s.placements)).toHaveLength(7);
    expect(totalPlaced(s)).toBe(0);
  });

  it("gives every tier a distinct id", () => {
    const s = createDefaultState();
    expect(new Set(s.tiers.map((t) => t.id)).size).toBe(6);
  });
});

describe("addToPool", () => {
  it("adds an unseen card", () => {
    const s = addToPool(createDefaultState(), KEY_A);
    expect(s.placements[POOL_ID]).toEqual([KEY_A]);
  });

  it("leaves a card that is already ranked alone", () => {
    let s = addToPool(createDefaultState(), KEY_A);
    s = moveCard(s, KEY_A, s.tiers[0].id);
    const after = addToPool(s, KEY_A);
    expect(after).toBe(s);
    expect(after.placements[POOL_ID]).toEqual([]);
  });
});

describe("moveCard", () => {
  it("moves between rows without leaving a copy behind", () => {
    let s = addToPool(createDefaultState(), KEY_A);
    s = moveCard(s, KEY_A, s.tiers[1].id);
    expect(s.placements[POOL_ID]).toEqual([]);
    expect(s.placements[s.tiers[1].id]).toEqual([KEY_A]);
    expect(findContainer(s, KEY_A)).toBe(s.tiers[1].id);
  });

  it("inserts at the requested index", () => {
    let s = createDefaultState();
    const tier = s.tiers[0].id;
    s = addToPool(s, KEY_A);
    s = addToPool(s, KEY_B);
    s = addToPool(s, KEY_C);
    s = moveCard(s, KEY_A, tier);
    s = moveCard(s, KEY_B, tier);
    s = moveCard(s, KEY_C, tier, 1);
    expect(s.placements[tier]).toEqual([KEY_A, KEY_C, KEY_B]);
  });

  it("reorders within the same row", () => {
    let s = createDefaultState();
    const tier = s.tiers[0].id;
    s = moveCard(addToPool(s, KEY_A), KEY_A, tier);
    s = moveCard(addToPool(s, KEY_B), KEY_B, tier);
    s = moveCard(s, KEY_B, tier, 0);
    expect(s.placements[tier]).toEqual([KEY_B, KEY_A]);
  });

  it("clamps an out-of-range index to the end", () => {
    let s = createDefaultState();
    const tier = s.tiers[0].id;
    s = moveCard(addToPool(s, KEY_A), KEY_A, tier, 99);
    expect(s.placements[tier]).toEqual([KEY_A]);
  });

  it("ignores a row that does not exist", () => {
    const s = addToPool(createDefaultState(), KEY_A);
    expect(moveCard(s, KEY_A, "nope")).toBe(s);
  });

  it("does not mutate the input state", () => {
    const s = addToPool(createDefaultState(), KEY_A);
    const before = [...s.placements[POOL_ID]];
    moveCard(s, KEY_A, s.tiers[0].id);
    expect(s.placements[POOL_ID]).toEqual(before);
  });
});

describe("tier editing", () => {
  it("renames one tier only", () => {
    const s = renameTier(createDefaultState(), createDefaultState().tiers[0].id, "X");
    expect(s.tiers.map((t) => t.label)).toEqual(["S", "A", "B", "C", "D", "F"]);
  });

  it("renames by id", () => {
    const base = createDefaultState();
    const s = renameTier(base, base.tiers[2].id, "Meta");
    expect(s.tiers[2].label).toBe("Meta");
    expect(s.tiers[1].label).toBe("A");
  });

  it("adds an empty tier with a placement slot", () => {
    const s = addTier(createDefaultState());
    expect(s.tiers).toHaveLength(7);
    expect(s.placements[s.tiers[6].id]).toEqual([]);
  });

  it("returns a removed tier's cards to the pool", () => {
    let s = createDefaultState();
    const doomed = s.tiers[0].id;
    s = moveCard(addToPool(s, KEY_A), KEY_A, doomed);
    s = removeTier(s, doomed);
    expect(s.tiers).toHaveLength(5);
    expect(s.placements[POOL_ID]).toEqual([KEY_A]);
    expect(s.placements[doomed]).toBeUndefined();
  });

  it("recolors remaining tiers so the ramp stays in order", () => {
    const s = removeTier(createDefaultState(), createDefaultState().tiers[0].id);
    expect(s.tiers[0].color).toBe(colorForIndex(0));
  });

  it("refuses to remove the last tier", () => {
    let s = createDefaultState();
    while (s.tiers.length > 1) s = removeTier(s, s.tiers[0].id);
    expect(removeTier(s, s.tiers[0].id)).toBe(s);
  });
});

describe("removeCard / clearCards", () => {
  it("removes a card from wherever it sits", () => {
    let s = moveCard(addToPool(createDefaultState(), KEY_A), KEY_A, createDefaultState().tiers[0].id);
    s = addToPool(s, KEY_B);
    s = removeCard(s, KEY_B);
    expect(findContainer(s, KEY_B)).toBeNull();
  });

  it("empties every row but keeps custom labels", () => {
    let s = renameTier(createDefaultState(), createDefaultState().tiers[0].id, "Top");
    s = addToPool(s, KEY_A);
    s = clearCards(s);
    expect(s.placements[POOL_ID]).toEqual([]);
    expect(totalPlaced(s)).toBe(0);
    expect(s.tiers).toHaveLength(6);
  });
});

describe("share encoding", () => {
  it("round-trips labels and placements", () => {
    let s = createDefaultState();
    s = renameTier(s, s.tiers[0].id, "Broken");
    s = moveCard(addToPool(s, KEY_A), KEY_A, s.tiers[0].id);
    s = moveCard(addToPool(s, KEY_B), KEY_B, s.tiers[3].id);
    s = addToPool(s, KEY_C);

    const back = decodeShare(encodeShare(s))!;
    expect(back).not.toBeNull();
    expect(back.tiers.map((t) => t.label)).toEqual(["Broken", "A", "B", "C", "D", "F"]);
    expect(back.placements[back.tiers[0].id]).toEqual([KEY_A]);
    expect(back.placements[back.tiers[3].id]).toEqual([KEY_B]);
    expect(back.placements[POOL_ID]).toEqual([KEY_C]);
  });

  it("survives non-ASCII card names", () => {
    const weird = "Ephesian Widow’s Mite|TPC";
    const s = addToPool(createDefaultState(), weird);
    expect(decodeShare(encodeShare(s))!.placements[POOL_ID]).toEqual([weird]);
  });

  it("produces a URL-safe string", () => {
    const s = addToPool(createDefaultState(), KEY_A);
    expect(encodeShare(s)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns null on garbage rather than throwing", () => {
    expect(decodeShare("not-base64!!")).toBeNull();
    expect(decodeShare("")).toBeNull();
  });

  it("rejects a payload whose rows and labels disagree", () => {
    expect(fromSerializable({ v: 1, l: ["S", "A"], r: [[]], u: [] })).toBeNull();
  });

  it("rejects an unknown schema version", () => {
    expect(fromSerializable({ v: 2, l: ["S"], r: [[]], u: [] })).toBeNull();
  });

  it("drops a card duplicated across two rows", () => {
    const s = fromSerializable({ v: 1, l: ["S", "A"], r: [[KEY_A], [KEY_A]], u: [KEY_A] })!;
    expect(s.placements[s.tiers[0].id]).toEqual([KEY_A]);
    expect(s.placements[s.tiers[1].id]).toEqual([]);
    expect(s.placements[POOL_ID]).toEqual([]);
  });

  it("tolerates a missing unranked list", () => {
    const s = fromSerializable({ v: 1, l: ["S"], r: [[KEY_A]] })!;
    expect(s.placements[POOL_ID]).toEqual([]);
  });
});
