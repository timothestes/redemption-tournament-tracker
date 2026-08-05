import { describe, it, expect } from "vitest";
import {
  planApply, planResume, planUndo, MAX_CHANGES_PER_CALL,
  type SaleItemState, type ItemStatus,
} from "../saleStateMachine";
import { idempotencyKey } from "../../shopify/inventory";

const it_ = (cardKey: string, status: ItemStatus, over: Partial<SaleItemState> = {}): SaleItemState => ({
  cardKey, status, delta: -2, qtyBefore: 10, qtyAfter: 8,
  inventoryItemId: `gid://shopify/InventoryItem/${cardKey}`, ...over,
});

describe("planApply", () => {
  it("orders by card_key, includes only pending items, baseKey pinned to spec format", () => {
    const items = [
      it_("b|S|b.jpg", "pending"),
      it_("a|S|a.jpg", "pending"),
      it_("c|S|c.jpg", "skipped_unmapped"),
      it_("d|S|d.jpg", "applied"),
    ];
    const plan = planApply("S1", items);
    expect(plan.unresolvable).toEqual([]);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0].n).toBe(0);
    expect(plan.batches[0].baseKey).toBe("sale:S1:batch:0");
    expect(plan.batches[0].changes.map((c) => c.cardKey)).toEqual(["a|S|a.jpg", "b|S|b.jpg"]);
    expect(plan.batches[0].changes[0]).toEqual({
      cardKey: "a|S|a.jpg", inventoryItemId: "gid://shopify/InventoryItem/a|S|a.jpg",
      delta: -2, changeFromQuantity: 10,
    });
  });
  it("chunks at 250 with stable ordinals", () => {
    const items = Array.from({ length: 501 }, (_, i) =>
      it_(`k${String(i).padStart(4, "0")}|S|x.jpg`, "pending"));
    const plan = planApply("S1", items);
    expect(plan.batches.map((b) => b.n)).toEqual([0, 1, 2]);
    expect(plan.batches[0].changes).toHaveLength(MAX_CHANGES_PER_CALL);
    expect(plan.batches[2].changes).toHaveLength(1);
  });
  it("splits duplicate inventoryItemIds across batches (one change per item per call; sequential CAS anchors)", () => {
    const shared = "gid://shopify/InventoryItem/promo";
    const items = [
      it_("a|S|a.jpg", "pending", { inventoryItemId: shared, qtyBefore: 10, qtyAfter: 8 }),
      it_("b|S|b.jpg", "pending", { inventoryItemId: shared, qtyBefore: 8, qtyAfter: 6 }),
    ];
    const plan = planApply("S1", items);
    expect(plan.batches).toHaveLength(2);
    expect(plan.batches[0].changes.map((c) => c.cardKey)).toEqual(["a|S|a.jpg"]);
    expect(plan.batches[1].changes.map((c) => c.cardKey)).toEqual(["b|S|b.jpg"]);
    expect(plan.batches[1].n).toBe(1);
  });
  it("pending items missing ids/anchors are unresolvable, not silently dropped", () => {
    const plan = planApply("S1", [
      it_("a|S|a.jpg", "pending", { inventoryItemId: null }),
      it_("b|S|b.jpg", "pending", { qtyBefore: null }),
      it_("c|S|c.jpg", "pending"),
    ]);
    expect(plan.unresolvable.sort()).toEqual(["a|S|a.jpg", "b|S|b.jpg"]);
    expect(plan.batches[0].changes.map((c) => c.cardKey)).toEqual(["c|S|c.jpg"]);
  });
});

describe("planResume — the three crash scenarios (spec pt. 4)", () => {
  it("ack-then-crash: live == qty_after → marked applied, NO re-adjustment planned", () => {
    const items = [it_("a|S|a.jpg", "applying"), it_("b|S|b.jpg", "applying")];
    const live = new Map([["a|S|a.jpg", 8], ["b|S|b.jpg", 8]]);
    const plan = planResume("S1", items, live);
    expect(plan.markApplied.sort()).toEqual(["a|S|a.jpg", "b|S|b.jpg"]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.reapply).toEqual([]);
  });
  it("crash-before-call: live == qty_before → reapply with the IDENTICAL payload, hence the SAME idempotency key", () => {
    const items = [it_("a|S|a.jpg", "applying"), it_("b|S|b.jpg", "applying")];
    const original = planApply("S1", items.map((i) => ({ ...i, status: "pending" as ItemStatus })));
    const live = new Map([["a|S|a.jpg", 10], ["b|S|b.jpg", 10]]);
    const plan = planResume("S1", items, live);
    expect(plan.markApplied).toEqual([]);
    expect(plan.reapply).toHaveLength(1);
    expect(plan.reapply[0].n).toBe(0);
    // Shopify dedupes because base + fingerprint reproduce byte-identically:
    expect(idempotencyKey(plan.reapply[0].baseKey, plan.reapply[0].changes))
      .toBe(idempotencyKey(original.batches[0].baseKey, original.batches[0].changes));
  });
  it("third-party moved stock: live matches neither anchor → conflict, human resolves", () => {
    const plan = planResume("S1", [it_("a|S|a.jpg", "applying")], new Map([["a|S|a.jpg", 9]]));
    expect(plan.conflicts).toEqual(["a|S|a.jpg"]);
    expect(plan.reapply).toEqual([]);
  });
  it("mixed batch: applied+reapply+conflict+missing-live all classified; reapply subset gets a NEW key (payload differs)", () => {
    const items = [
      it_("a|S|a.jpg", "applying"), // landed
      it_("b|S|b.jpg", "applying"), // not landed
      it_("c|S|c.jpg", "applying"), // moved
      it_("d|S|d.jpg", "applying"), // vanished from live read
      it_("e|S|e.jpg", "pending"),  // untouched by resume
    ];
    const live = new Map([["a|S|a.jpg", 8], ["b|S|b.jpg", 10], ["c|S|c.jpg", 3]]);
    const plan = planResume("S1", items, live);
    expect(plan.markApplied).toEqual(["a|S|a.jpg"]);
    expect(plan.conflicts.sort()).toEqual(["c|S|c.jpg", "d|S|d.jpg"]);
    expect(plan.reapply[0].changes.map((c) => c.cardKey)).toEqual(["b|S|b.jpg"]);
    const original = planApply("S1", items.map((i) => ({ ...i, status: "pending" as ItemStatus })));
    expect(idempotencyKey(plan.reapply[0].baseKey, plan.reapply[0].changes))
      .not.toBe(idempotencyKey(original.batches[0].baseKey, original.batches[0].changes));
  });
});

describe("planUndo (spec pt. 7)", () => {
  it("reverses ONLY applied items: +|delta| with changeFromQuantity = qty_after, undo base key", () => {
    const items = [
      it_("a|S|a.jpg", "applied"),
      it_("b|S|b.jpg", "error"),
      it_("c|S|c.jpg", "skipped_untracked"),
      it_("d|S|d.jpg", "conflict"),
    ];
    const plan = planUndo("S9", items);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0].baseKey).toBe("undo:S9:batch:0");
    expect(plan.batches[0].changes).toEqual([{
      cardKey: "a|S|a.jpg", inventoryItemId: "gid://shopify/InventoryItem/a|S|a.jpg",
      delta: 2, changeFromQuantity: 8,
    }]);
  });
  it("ordinals stay stable when earlier items are already undone (crash-resume of undo)", () => {
    const mk = (i: number, status: ItemStatus) =>
      it_(`k${String(i).padStart(4, "0")}|S|x.jpg`, status);
    const items = Array.from({ length: 251 }, (_, i) => mk(i, i < 250 ? "undone" : "applied"));
    const plan = planUndo("S9", items);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0].n).toBe(1); // batch 0 fully undone → skipped, ordinal preserved
    expect(plan.batches[0].changes).toHaveLength(1);
  });
});
