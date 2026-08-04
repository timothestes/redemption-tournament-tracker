/**
 * PURE sale state machine + apply/undo planner for WS-4 (spec §Record sale).
 * No I/O anywhere in this module — every branch is unit-tested, and the
 * server actions in app/admin/ytg/decks/saleActions.ts are thin executors.
 *
 * Status enums mirror migration 089 exactly.
 */

export const SALE_STATUSES = [
  "pending", "applying", "applied", "partial", "failed",
  "dry_run", "undoing", "undone", "undo_partial",
] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const ITEM_STATUSES = [
  "pending", "applying", "applied", "skipped_unmapped",
  "skipped_untracked", "error", "conflict", "undone", "undo_conflict",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export type PreviewFlag = "ok" | "unmapped" | "untracked" | "would_go_negative";

/** Preview flag classes (spec pt. 2). unmapped ≻ untracked ≻ would_go_negative ≻ ok. */
export function classifyPreviewRow(row: {
  mapped: boolean;    // confirmed mapping (auto_matched|manual) AND product present in the live read
  tracked: boolean;   // variant inventory_management === 'shopify'
  qtyAfter: number | null;
}): PreviewFlag {
  if (!row.mapped) return "unmapped";
  if (!row.tracked) return "untracked";
  if (row.qtyAfter !== null && row.qtyAfter < 0) return "would_go_negative";
  return "ok";
}

/** Items the apply/undo loops may touch — snapshot skips never adjust. */
export function adjustableItems<T extends { status: ItemStatus }>(items: T[]): T[] {
  return items.filter(
    (i) => i.status !== "skipped_unmapped" && i.status !== "skipped_untracked",
  );
}

/** Sale status is DERIVED from items (spec pt. 5). */
export function deriveSaleStatus(
  items: { status: ItemStatus }[],
): "applied" | "partial" | "failed" {
  const adj = adjustableItems(items);
  const applied = adj.filter((i) => i.status === "applied").length;
  if (adj.length > 0 && applied === adj.length) return "applied";
  if (applied > 0) return "partial";
  return "failed";
}

/** Undo terminal status (spec pt. 7): all reversed → undone, else undo_partial. */
export function deriveUndoStatus(
  items: { status: ItemStatus }[],
): "undone" | "undo_partial" {
  const touched = adjustableItems(items).filter(
    (i) => i.status === "undone" || i.status === "undo_conflict" || i.status === "applied",
  );
  const undone = touched.filter((i) => i.status === "undone").length;
  return touched.length > 0 && undone === touched.length ? "undone" : "undo_partial";
}

export type ResumeVerdict = "applied" | "reapply" | "conflict";

/**
 * Resume oracle for an item stranded in 'applying' (spec pt. 4):
 *   live == qty_after  → the adjustment landed; mark applied, never re-adjust
 *   live == qty_before → it never landed; re-apply (same payload ⇒ same key)
 *   anything else      → third party moved stock; human resolves.
 */
export function resumeOracle(
  item: { qtyBefore: number | null; qtyAfter: number | null },
  liveQty: number,
): ResumeVerdict {
  if (item.qtyAfter !== null && liveQty === item.qtyAfter) return "applied";
  if (item.qtyBefore !== null && liveQty === item.qtyBefore) return "reapply";
  return "conflict";
}
