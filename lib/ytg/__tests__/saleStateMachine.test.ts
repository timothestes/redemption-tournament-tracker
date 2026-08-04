import { describe, it, expect } from "vitest";
import {
  classifyPreviewRow, adjustableItems, deriveSaleStatus, deriveUndoStatus,
  resumeOracle, type ItemStatus,
} from "../saleStateMachine";

const item = (status: ItemStatus) => ({ status });

describe("classifyPreviewRow — every branch", () => {
  it("unmapped beats everything", () => {
    expect(classifyPreviewRow({ mapped: false, tracked: false, qtyAfter: null })).toBe("unmapped");
    expect(classifyPreviewRow({ mapped: false, tracked: true, qtyAfter: -1 })).toBe("unmapped");
  });
  it("untracked when mapped but inventory_management ≠ shopify", () => {
    expect(classifyPreviewRow({ mapped: true, tracked: false, qtyAfter: null })).toBe("untracked");
  });
  it("would_go_negative when qtyAfter < 0", () => {
    expect(classifyPreviewRow({ mapped: true, tracked: true, qtyAfter: -1 })).toBe("would_go_negative");
  });
  it("ok at exactly zero and above", () => {
    expect(classifyPreviewRow({ mapped: true, tracked: true, qtyAfter: 0 })).toBe("ok");
    expect(classifyPreviewRow({ mapped: true, tracked: true, qtyAfter: 7 })).toBe("ok");
  });
  it("ok when qtyAfter unknown (null) but mapped+tracked", () => {
    expect(classifyPreviewRow({ mapped: true, tracked: true, qtyAfter: null })).toBe("ok");
  });
});

describe("adjustableItems", () => {
  it("excludes exactly the snapshot skips", () => {
    const all: ItemStatus[] = ["pending","applying","applied","skipped_unmapped","skipped_untracked","error","conflict","undone","undo_conflict"];
    const kept = adjustableItems(all.map(item)).map((i) => i.status);
    expect(kept).toEqual(["pending","applying","applied","error","conflict","undone","undo_conflict"]);
  });
});

describe("deriveSaleStatus — every branch (spec pt. 5)", () => {
  it("all adjustable applied → applied (skips don't count against it)", () => {
    expect(deriveSaleStatus([item("applied"), item("applied"), item("skipped_unmapped"), item("skipped_untracked")])).toBe("applied");
  });
  it("some applied → partial", () => {
    expect(deriveSaleStatus([item("applied"), item("error")])).toBe("partial");
    expect(deriveSaleStatus([item("applied"), item("conflict")])).toBe("partial");
    expect(deriveSaleStatus([item("applied"), item("pending")])).toBe("partial");
  });
  it("none applied → failed (undo offered only on applied/partial, so failed strands nothing)", () => {
    expect(deriveSaleStatus([item("error"), item("conflict")])).toBe("failed");
    expect(deriveSaleStatus([item("skipped_unmapped")])).toBe("failed");
    expect(deriveSaleStatus([])).toBe("failed");
  });
});

describe("deriveUndoStatus — every branch (spec pt. 7)", () => {
  it("all reversed → undone", () => {
    expect(deriveUndoStatus([item("undone"), item("undone"), item("skipped_untracked")])).toBe("undone");
  });
  it("any undo_conflict → undo_partial", () => {
    expect(deriveUndoStatus([item("undone"), item("undo_conflict")])).toBe("undo_partial");
  });
  it("any still-applied leftover → undo_partial", () => {
    expect(deriveUndoStatus([item("undone"), item("applied")])).toBe("undo_partial");
  });
});

describe("resumeOracle — every branch (spec pt. 4)", () => {
  const anchors = { qtyBefore: 10, qtyAfter: 7 };
  it("live == qty_after → applied (ack-then-crash: never re-adjust)", () => {
    expect(resumeOracle(anchors, 7)).toBe("applied");
  });
  it("live == qty_before → reapply (crash before the call landed)", () => {
    expect(resumeOracle(anchors, 10)).toBe("reapply");
  });
  it("anything else → conflict (third party moved stock)", () => {
    expect(resumeOracle(anchors, 8)).toBe("conflict");
    expect(resumeOracle(anchors, 0)).toBe("conflict");
  });
  it("null anchors can never claim applied/reapply", () => {
    expect(resumeOracle({ qtyBefore: null, qtyAfter: null }, 5)).toBe("conflict");
  });
  it("qty_after checked FIRST (delta is never 0, but ordering is pinned)", () => {
    expect(resumeOracle({ qtyBefore: 7, qtyAfter: 7 }, 7)).toBe("applied");
  });
});
