import { describe, it, expect } from "vitest";
import { aggregateOwnedByName, computeMissingCards } from "../collectionCheck";
import type { BuyDeckCard } from "../../components/BuyDeckModal";

function bdc(
  name: string,
  quantity: number,
  zone: BuyDeckCard["zone"] = "main",
  set = "Rot"
): BuyDeckCard {
  return { card_name: name, card_key: `${name}|${set}|${name}.jpg`, quantity, zone };
}

describe("aggregateOwnedByName", () => {
  it("sums all printings of a name into a single total", () => {
    const q = new Map<string, number>([
      ["Mayhem|Rot|a.jpg", 1],
      ["Mayhem|Pi|b.jpg", 2],
      ["Angel|Rot|c.jpg", 3],
    ]);
    expect(aggregateOwnedByName(q)).toEqual({ Mayhem: 3, Angel: 3 });
  });

  it("returns an empty record for an empty map", () => {
    expect(aggregateOwnedByName(new Map())).toEqual({});
  });
});

describe("computeMissingCards", () => {
  it("is quantity-aware: deck needs 3, own 1 => missing 2", () => {
    const r = computeMissingCards([bdc("Mayhem", 3)], { Mayhem: 1 });
    expect(r.totalCount).toBe(3);
    expect(r.ownedCount).toBe(1);
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0].quantity).toBe(2);
    expect(r.missing[0].card_key).toBe("Mayhem|Rot|Mayhem.jpg");
  });

  it("pools owned copies by name across printings split over main and reserve", () => {
    // 2x Mayhem (set A, main) + 1x Mayhem (set B, reserve); own 2 total.
    const cards = [
      bdc("Mayhem", 2, "main", "SetA"),
      bdc("Mayhem", 1, "reserve", "SetB"),
    ];
    const r = computeMissingCards(cards, { Mayhem: 2 });
    expect(r.totalCount).toBe(3);
    expect(r.ownedCount).toBe(2);
    // First entries consume the pool; the reserve copy is the one missing.
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0].zone).toBe("reserve");
    expect(r.missing[0].quantity).toBe(1);
  });

  it("treats an empty collection as everything missing", () => {
    const cards = [bdc("Mayhem", 2), bdc("Angel", 1, "reserve")];
    const r = computeMissingCards(cards, {});
    expect(r.ownedCount).toBe(0);
    expect(r.totalCount).toBe(3);
    expect(r.missing).toHaveLength(2);
  });

  it("returns no missing cards when the user owns everything", () => {
    const cards = [bdc("Mayhem", 2), bdc("Angel", 1, "reserve")];
    const r = computeMissingCards(cards, { Mayhem: 5, Angel: 2 });
    expect(r.missing).toHaveLength(0);
    expect(r.ownedCount).toBe(3);
    expect(r.totalCount).toBe(3);
  });

  it("excludes maybeboard from totals and missing", () => {
    const cards = [bdc("Mayhem", 1, "main"), bdc("Scratch", 4, "maybeboard")];
    const r = computeMissingCards(cards, {});
    expect(r.totalCount).toBe(1);
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0].card_name).toBe("Mayhem");
  });
});
