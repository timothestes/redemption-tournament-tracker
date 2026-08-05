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

// ─── Apply/undo planner ─────────────────────────────────────────────────────
// Batch ordinals derive from the IMMUTABLE full adjustable set (sorted by
// card_key, first-fit chunked, duplicate inventoryItemIds pushed to later
// batches — one change per item per call, and sequential CAS anchors need
// ordering). A resume recomputes identical ordinals from DB state alone, so
// an unchanged payload re-fingerprints to the SAME idempotency key.

export const MAX_CHANGES_PER_CALL = 250;

export interface SaleItemState {
  cardKey: string;
  status: ItemStatus;
  delta: number;               // negative on a sale
  qtyBefore: number | null;    // CAS anchors; also the resume oracle
  qtyAfter: number | null;
  inventoryItemId: string | null;
}

export interface PlannedChange {
  cardKey: string;
  inventoryItemId: string;
  delta: number;
  changeFromQuantity: number;
}

export interface PlannedBatch {
  n: number;        // stable ordinal over the full adjustable set
  baseKey: string;  // spec format; executor appends the payload fingerprint
  changes: PlannedChange[];
}

function batchLayout(items: SaleItemState[]): SaleItemState[][] {
  const sorted = adjustableItems(items).slice().sort((a, b) =>
    a.cardKey < b.cardKey ? -1 : a.cardKey > b.cardKey ? 1 : 0);
  const batches: SaleItemState[][] = [];
  for (const item of sorted) {
    let placed = false;
    for (const b of batches) {
      const dup = item.inventoryItemId !== null
        && b.some((x) => x.inventoryItemId === item.inventoryItemId);
      if (b.length < MAX_CHANGES_PER_CALL && !dup) {
        b.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) batches.push([item]);
  }
  return batches;
}

export interface ApplyPlan {
  batches: PlannedBatch[];
  unresolvable: string[]; // pending card_keys missing inventoryItemId/anchors
}

export function planApply(saleId: string, items: SaleItemState[]): ApplyPlan {
  const batches: PlannedBatch[] = [];
  const unresolvable: string[] = [];
  batchLayout(items).forEach((members, n) => {
    const changes: PlannedChange[] = [];
    for (const m of members) {
      if (m.status !== "pending") continue;
      if (m.inventoryItemId === null || m.qtyBefore === null || m.qtyAfter === null) {
        unresolvable.push(m.cardKey);
        continue;
      }
      changes.push({
        cardKey: m.cardKey, inventoryItemId: m.inventoryItemId,
        delta: m.delta, changeFromQuantity: m.qtyBefore,
      });
    }
    if (changes.length > 0) batches.push({ n, baseKey: `sale:${saleId}:batch:${n}`, changes });
  });
  return { batches, unresolvable };
}

export interface ResumePlan {
  markApplied: string[];   // landed — flip to applied, never re-adjust
  conflicts: string[];     // live matches neither anchor (or item unreadable)
  reapply: PlannedBatch[]; // identical payload ⇒ identical key ⇒ server-side dedupe
}

export function planResume(
  saleId: string,
  items: SaleItemState[],
  liveQtyByCardKey: Map<string, number>,
): ResumePlan {
  const markApplied: string[] = [];
  const conflicts: string[] = [];
  const reapply: PlannedBatch[] = [];
  batchLayout(items).forEach((members, n) => {
    const changes: PlannedChange[] = [];
    for (const m of members) {
      if (m.status !== "applying") continue;
      const live = liveQtyByCardKey.get(m.cardKey);
      if (live === undefined || m.inventoryItemId === null) {
        conflicts.push(m.cardKey);
        continue;
      }
      const verdict = resumeOracle({ qtyBefore: m.qtyBefore, qtyAfter: m.qtyAfter }, live);
      if (verdict === "applied") markApplied.push(m.cardKey);
      else if (verdict === "conflict") conflicts.push(m.cardKey);
      else changes.push({
        cardKey: m.cardKey, inventoryItemId: m.inventoryItemId,
        delta: m.delta, changeFromQuantity: m.qtyBefore as number,
      });
    }
    if (changes.length > 0) reapply.push({ n, baseKey: `sale:${saleId}:batch:${n}`, changes });
  });
  return { markApplied, conflicts, reapply };
}

export interface UndoPlan {
  batches: PlannedBatch[];
  unresolvable: string[];
}

/** Positive adjustments with changeFromQuantity = qty_after — never blindly stacks stock. */
export function planUndo(saleId: string, items: SaleItemState[]): UndoPlan {
  const batches: PlannedBatch[] = [];
  const unresolvable: string[] = [];
  batchLayout(items).forEach((members, n) => {
    const changes: PlannedChange[] = [];
    for (const m of members) {
      if (m.status !== "applied") continue;
      if (m.inventoryItemId === null || m.qtyAfter === null) {
        unresolvable.push(m.cardKey);
        continue;
      }
      changes.push({
        cardKey: m.cardKey, inventoryItemId: m.inventoryItemId,
        delta: Math.abs(m.delta), changeFromQuantity: m.qtyAfter,
      });
    }
    if (changes.length > 0) batches.push({ n, baseKey: `undo:${saleId}:batch:${n}`, changes });
  });
  return { batches, unresolvable };
}
