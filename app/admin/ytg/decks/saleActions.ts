"use server";

/**
 * WS-4 Record-sale server actions (spec §Record sale + Addendum 2026-08-04).
 * Thin executors over the pure planner in lib/ytg/saleStateMachine.ts and
 * the gated Shopify client in lib/shopify/inventory.ts. Every action
 * re-checks hasPermission (layout gating does not protect actions) and uses
 * the service-role client — the ledger tables revoke anon/authenticated.
 */

import { hasPermission } from "@/utils/adminUtils";
import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
import { createClient } from "@/utils/supabase/server";
import { getShopifyAccessToken, fetchProductInventory } from "@/lib/pricing/shopify";
import { buildCardKey } from "@/lib/pricing/matching";
import {
  getSingleLocationId, getInventoryItemIds, adjustAvailable, activateItem,
  idempotencyKey, inventoryWritesEnabled, isNotStockedError, isStaleCasError,
  changeIndexOf, type InventoryChange, type InventoryUserError,
} from "@/lib/shopify/inventory";
import {
  classifyPreviewRow, deriveSaleStatus, deriveUndoStatus, planApply,
  planResume, planUndo, type PlannedBatch, type PreviewFlag,
  type SaleItemState, type ItemStatus,
} from "@/lib/ytg/saleStateMachine";

const PERM = "manage_shopify_imports";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function usernamesById(admin: any, ids: (string | null)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unique.length === 0) return out;
  const { data } = await admin.from("profiles").select("id, username").in("id", unique);
  for (const p of data ?? []) if (p.username) out.set(p.id, p.username);
  return out;
}

async function actingUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export interface SalePreviewRow {
  cardKey: string;
  cardName: string;
  qtyPerDeck: number;            // zone IN ('main','reserve'), summed per card_key
  delta: number;                 // -(qtyPerDeck × saleQty)
  qtyBefore: number | null;      // LIVE quantity (never the mirror)
  qtyAfter: number | null;
  singleProductId: string | null;
  variantId: string | null;
  flag: PreviewFlag;
}

export interface SalePreview {
  product: { productId: string; title: string; handle: string; imageUrl: string | null };
  deckId: string;
  deckUpdatedAt: string;
  qty: number;
  rows: SalePreviewRow[];
  recentSale: { id: string; qty: number; createdAt: string; createdByName: string | null } | null;
  activeSale: { id: string; status: string; createdAt: string; createdByName: string | null } | null;
  writesEnabled: boolean;
}

export type PreviewResult =
  | { success: true; preview: SalePreview }
  | { success: false; error: string };

export async function previewSale(productId: string, qty: number): Promise<PreviewResult> {
  if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
    return { success: false, error: "qty must be an integer between 1 and 99" };
  }
  const admin = getSupabaseAdmin();

  const { data: link, error: linkErr } = await admin
    .from("ytg_deck_links").select("deck_id")
    .eq("shopify_product_id", productId).maybeSingle();
  if (linkErr) return { success: false, error: linkErr.message };
  if (!link) return { success: false, error: "product is not linked to a deck — pull contents first" };

  const { data: p, error: prodErr } = await admin
    .from("shopify_products").select("id, title, handle, raw_json")
    .eq("id", productId).maybeSingle();
  if (prodErr) return { success: false, error: prodErr.message };
  if (!p) return { success: false, error: "product not found in the mirror" };

  const { data: deck, error: deckErr } = await admin
    .from("decks").select("updated_at").eq("id", link.deck_id).maybeSingle();
  if (deckErr) return { success: false, error: deckErr.message };
  if (!deck) return { success: false, error: "linked deck no longer exists" };

  // Addendum 2026-08-04: the box physically includes the Reserve —
  // decrement reads zone IN ('main','reserve'), SUMMED per card_key.
  const { data: cards, error: cardsErr } = await admin
    .from("deck_cards")
    .select("card_name, card_set, card_img_file, quantity, zone")
    .eq("deck_id", link.deck_id)
    .in("zone", ["main", "reserve"]);
  if (cardsErr) return { success: false, error: cardsErr.message };

  const perKey = new Map<string, { cardName: string; qtyPerDeck: number }>();
  for (const c of cards ?? []) {
    const key = buildCardKey(c.card_name, c.card_set, c.card_img_file);
    const prev = perKey.get(key);
    if (prev) prev.qtyPerDeck += c.quantity ?? 0;
    else perKey.set(key, { cardName: c.card_name, qtyPerDeck: c.quantity ?? 0 });
  }
  if (perKey.size === 0) return { success: false, error: "linked deck has no main/reserve cards" };

  // Confirmed mappings are exactly auto_matched|manual (no 'matched' status exists).
  const { data: mappings, error: mapErr } = await admin
    .from("card_price_mappings")
    .select("card_key, shopify_product_id")
    .in("card_key", [...perKey.keys()])
    .in("status", ["auto_matched", "manual"]);
  if (mapErr) return { success: false, error: mapErr.message };

  const productByKey = new Map<string, string>();
  for (const m of mappings ?? []) {
    if (m.shopify_product_id) productByKey.set(m.card_key, String(m.shopify_product_id));
  }

  // LIVE inventory — never the mirror (mirror staleness → oversell; Shopify
  // happily drives available negative with no error).
  const token = await getShopifyAccessToken();
  const live = await fetchProductInventory(token, [...new Set(productByKey.values())]);

  // Sequential CAS anchors when several card_keys share one single product
  // (promo-fallback mappings): row 2's qtyBefore = row 1's qtyAfter.
  const runningQty = new Map<string, number>();
  const rows: SalePreviewRow[] = [...perKey.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([cardKey, v]) => {
      const singleProductId = productByKey.get(cardKey) ?? null;
      const inv = singleProductId !== null ? live.get(singleProductId) : undefined;
      const delta = -(v.qtyPerDeck * qty);
      const tracked = inv !== undefined && inv.tracked === true;
      let qtyBefore: number | null = null;
      let qtyAfter: number | null = null;
      if (singleProductId !== null && inv !== undefined && tracked) {
        const start = runningQty.get(singleProductId);
        qtyBefore = start === undefined ? inv.inventory : start;
        qtyAfter = qtyBefore + delta;
        runningQty.set(singleProductId, qtyAfter);
      }
      return {
        cardKey,
        cardName: v.cardName,
        qtyPerDeck: v.qtyPerDeck,
        delta,
        qtyBefore,
        qtyAfter,
        singleProductId,
        variantId: inv !== undefined ? inv.variantId : null,
        flag: classifyPreviewRow({
          mapped: singleProductId !== null && inv !== undefined,
          tracked,
          qtyAfter,
        }),
      };
    });

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recent } = await admin
    .from("ytg_deck_sales").select("id, qty, created_at, created_by")
    .eq("shopify_product_id", productId)
    .in("status", ["applied", "partial"])
    .gte("created_at", tenMinAgo)
    .order("created_at", { ascending: false }).limit(1);
  const { data: active } = await admin
    .from("ytg_deck_sales").select("id, status, created_at, created_by")
    .eq("shopify_product_id", productId)
    .in("status", ["pending", "applying"]).limit(1);

  const names = await usernamesById(admin, [
    ...(recent ?? []).map((r: { created_by: string | null }) => r.created_by),
    ...(active ?? []).map((r: { created_by: string | null }) => r.created_by),
  ]);
  const r0 = (recent ?? [])[0];
  const a0 = (active ?? [])[0];

  return {
    success: true,
    preview: {
      product: {
        productId: p.id,
        title: p.title,
        handle: p.handle,
        imageUrl: p.raw_json?.images?.[0]?.src ?? p.raw_json?.image?.src ?? null,
      },
      deckId: link.deck_id,
      deckUpdatedAt: deck.updated_at,
      qty,
      rows,
      recentSale: r0
        ? { id: r0.id, qty: r0.qty, createdAt: r0.created_at, createdByName: names.get(r0.created_by) ?? null }
        : null,
      activeSale: a0
        ? { id: a0.id, status: a0.status, createdAt: a0.created_at, createdByName: names.get(a0.created_by) ?? null }
        : null,
      writesEnabled: inventoryWritesEnabled(),
    },
  };
}

export interface ConfirmInput {
  productId: string;
  qty: number;
  deckId: string;
  deckUpdatedAt: string;   // snapshot-integrity check (spec pt. 3)
  rows: SalePreviewRow[];  // the previewed (possibly row-dropped) snapshot
  ackNegative: boolean;
}

export type ConfirmResult =
  | { success: true; saleId: string; dryRun: boolean }
  | {
      success: false;
      code: "deck_changed" | "needs_ack" | "sale_in_progress" | "empty" | "error";
      error: string;
      inProgress?: { createdAt: string; createdByName: string | null };
    };

export async function confirmSale(input: ConfirmInput): Promise<ConfirmResult> {
  if (!(await hasPermission(PERM))) return { success: false, code: "error", error: "forbidden" };
  const admin = getSupabaseAdmin();
  const { productId, qty, deckId, deckUpdatedAt, rows, ackNegative } = input;

  if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
    return { success: false, code: "error", error: "qty must be an integer between 1 and 99" };
  }
  const adjustable = (rows ?? []).filter(
    (r) => r.flag === "ok" || r.flag === "would_go_negative",
  );
  if (!rows || rows.length === 0 || adjustable.length === 0) {
    return { success: false, code: "empty", error: "nothing to apply — every row is unmapped/untracked or dropped" };
  }
  if (rows.some((r) => r.flag === "would_go_negative") && ackNegative !== true) {
    return { success: false, code: "needs_ack", error: "some rows would go negative — acknowledge to proceed" };
  }

  // Deck-changed check: apply acts on the previewed snapshot, never a re-read.
  const { data: deck, error: deckErr } = await admin
    .from("decks").select("updated_at").eq("id", deckId).maybeSingle();
  if (deckErr) return { success: false, code: "error", error: deckErr.message };
  if (!deck || deck.updated_at !== deckUpdatedAt) {
    return { success: false, code: "deck_changed", error: "deck changed since preview — re-preview before recording" };
  }

  const createdBy = await actingUserId();
  const { data: inserted, error: insErr } = await admin
    .from("ytg_deck_sales")
    .insert({ shopify_product_id: productId, deck_id: deckId, qty, status: "pending", created_by: createdBy })
    .select("id");
  if (insErr) {
    if (insErr.code === "23505") {
      // Partial unique index: one active sale per product (WS-3 guard reads the same rows).
      const { data: who } = await admin
        .from("ytg_deck_sales").select("created_at, created_by")
        .eq("shopify_product_id", productId)
        .in("status", ["pending", "applying"]).limit(1);
      const w = (who ?? [])[0];
      const names = await usernamesById(admin, [w?.created_by ?? null]);
      return {
        success: false, code: "sale_in_progress",
        error: "a sale is already being recorded for this product",
        inProgress: w
          ? { createdAt: w.created_at, createdByName: names.get(w.created_by) ?? null }
          : undefined,
      };
    }
    return { success: false, code: "error", error: insErr.message };
  }
  const saleId: string = inserted[0].id;

  // Snapshot items — quantities already summed per card_key (items PK).
  const itemRows = rows.map((r) => ({
    sale_id: saleId,
    card_key: r.cardKey,
    card_name: r.cardName,
    qty_per_deck: r.qtyPerDeck,
    delta: r.delta,
    qty_before: r.qtyBefore,
    qty_after: r.qtyAfter,
    single_product_id: r.singleProductId,
    variant_id: r.variantId,
    inventory_item_id: null,
    status:
      r.flag === "unmapped" ? "skipped_unmapped"
      : r.flag === "untracked" ? "skipped_untracked"
      : "pending",
    error: null,
  }));
  const { error: itemsErr } = await admin.from("ytg_deck_sale_items").insert(itemRows);
  if (itemsErr) {
    await admin.from("ytg_deck_sales").delete().eq("id", saleId); // items cascade
    return { success: false, code: "error", error: `snapshot failed: ${itemsErr.message}` };
  }

  // Dry-run short-circuit: recorded, visibly segregated, never applied, non-replayable.
  if (inventoryWritesEnabled() === false) {
    const { error: dryErr } = await admin
      .from("ytg_deck_sales").update({ status: "dry_run" }).eq("id", saleId);
    if (dryErr) return { success: false, code: "error", error: dryErr.message };
    return { success: true, saleId, dryRun: true };
  }

  // Server-side claim: CAS pending→applying. A refresh-and-resume or a
  // second admin loses this and sees "already being applied".
  const { data: claimed, error: claimErr } = await admin
    .from("ytg_deck_sales").update({ status: "applying" })
    .eq("id", saleId).eq("status", "pending").select("id");
  if (claimErr) return { success: false, code: "error", error: claimErr.message };
  if (!claimed || claimed.length === 0) {
    return { success: false, code: "sale_in_progress", error: "sale is already being applied" };
  }
  return { success: true, saleId, dryRun: false };
}

export interface SaleItemView {
  cardKey: string;
  cardName: string | null;
  qtyPerDeck: number;
  delta: number;
  qtyBefore: number | null;
  qtyAfter: number | null;
  singleProductId: string | null;
  status: string;
  error: string | null;
}

export interface SaleView {
  id: string;
  productId: string;
  productTitle: string | null;
  qty: number;
  status: string;
  createdAt: string;
  undoneAt: string | null;
  items: SaleItemView[];
  writesEnabled: boolean;
  degraded: "scope_missing" | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadSaleView(admin: any, saleId: string, degraded: "scope_missing" | null = null): Promise<
  { success: true; sale: SaleView } | { success: false; error: string }
> {
  const { data: sale, error: saleErr } = await admin
    .from("ytg_deck_sales")
    .select("id, shopify_product_id, qty, status, created_at, undone_at")
    .eq("id", saleId).maybeSingle();
  if (saleErr) return { success: false, error: saleErr.message };
  if (!sale) return { success: false, error: "sale not found" };
  const { data: items, error: itemsErr } = await admin
    .from("ytg_deck_sale_items")
    .select("card_key, card_name, qty_per_deck, delta, qty_before, qty_after, single_product_id, status, error")
    .eq("sale_id", saleId).order("card_key");
  if (itemsErr) return { success: false, error: itemsErr.message };
  const { data: prod } = await admin
    .from("shopify_products").select("title").eq("id", sale.shopify_product_id).maybeSingle();
  return {
    success: true,
    sale: {
      id: sale.id,
      productId: sale.shopify_product_id,
      productTitle: prod ? prod.title : null,
      qty: sale.qty,
      status: sale.status,
      createdAt: sale.created_at,
      undoneAt: sale.undone_at,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: (items ?? []).map((i: any) => ({
        cardKey: i.card_key, cardName: i.card_name, qtyPerDeck: i.qty_per_deck,
        delta: i.delta, qtyBefore: i.qty_before, qtyAfter: i.qty_after,
        singleProductId: i.single_product_id, status: i.status, error: i.error,
      })),
      writesEnabled: inventoryWritesEnabled(),
      degraded,
    },
  };
}

export type SaleResult = { success: true; sale: SaleView } | { success: false; error: string };

export async function getSale(saleId: string): Promise<SaleResult> {
  if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
  return loadSaleView(getSupabaseAdmin(), saleId);
}

export interface SaleHistoryRow {
  id: string;
  productId: string;
  productTitle: string;
  qty: number;
  status: string;
  createdAt: string;
  createdByName: string | null;
  undoneAt: string | null;
  undoneByName: string | null;
  appliedCount: number;
  skippedCount: number;
  troubleCount: number;   // error|conflict|undo_conflict
  totalItems: number;
}

export async function listSales(): Promise<
  { success: true; sales: SaleHistoryRow[]; writesEnabled: boolean } | { success: false; error: string }
> {
  if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
  const admin = getSupabaseAdmin();
  const { data: sales, error } = await admin
    .from("ytg_deck_sales")
    .select("id, shopify_product_id, qty, status, created_at, created_by, undone_at, undone_by")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return { success: false, error: error.message };
  const rows = sales ?? [];
  if (rows.length === 0) return { success: true, sales: [], writesEnabled: inventoryWritesEnabled() };

  const { data: items } = await admin
    .from("ytg_deck_sale_items").select("sale_id, status")
    .in("sale_id", rows.map((s: { id: string }) => s.id));
  const counts = new Map<string, { applied: number; skipped: number; trouble: number; total: number }>();
  for (const it of items ?? []) {
    const c = counts.get(it.sale_id) ?? { applied: 0, skipped: 0, trouble: 0, total: 0 };
    c.total += 1;
    if (it.status === "applied" || it.status === "undone") c.applied += 1;
    if (it.status === "skipped_unmapped" || it.status === "skipped_untracked") c.skipped += 1;
    if (it.status === "error" || it.status === "conflict" || it.status === "undo_conflict") c.trouble += 1;
    counts.set(it.sale_id, c);
  }

  const { data: prods } = await admin
    .from("shopify_products").select("id, title")
    .in("id", [...new Set(rows.map((s: { shopify_product_id: string }) => s.shopify_product_id))]);
  const titleById = new Map<string, string>();
  for (const pr of prods ?? []) titleById.set(String(pr.id), pr.title);

  const names = await usernamesById(admin, [
    ...rows.map((s: { created_by: string | null }) => s.created_by),
    ...rows.map((s: { undone_by: string | null }) => s.undone_by),
  ]);

  return {
    success: true,
    writesEnabled: inventoryWritesEnabled(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sales: rows.map((s: any) => {
      const c = counts.get(s.id) ?? { applied: 0, skipped: 0, trouble: 0, total: 0 };
      return {
        id: s.id,
        productId: s.shopify_product_id,
        productTitle: titleById.get(s.shopify_product_id) ?? s.shopify_product_id,
        qty: s.qty,
        status: s.status,
        createdAt: s.created_at,
        createdByName: s.created_by ? (names.get(s.created_by) ?? null) : null,
        undoneAt: s.undone_at,
        undoneByName: s.undone_by ? (names.get(s.undone_by) ?? null) : null,
        appliedCount: c.applied,
        skippedCount: c.skipped,
        troubleCount: c.trouble,
        totalItems: c.total,
      };
    }),
  };
}

// ─── Apply / resume / retry / undo executors ────────────────────────────────

const CONFLICT_MSG =
  "live quantity moved between preview and apply (compare-and-swap rejected) — verify in Shopify, then retry";
const RESUME_CONFLICT_MSG =
  "live quantity matches neither anchor — a third party moved stock; resolve in Shopify";
const UNDO_CONFLICT_MSG =
  "live quantity moved since the sale — undo refused to stack stock; review in Shopify";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setItems(admin: any, saleId: string, cardKeys: string[], patch: Record<string, unknown>) {
  if (cardKeys.length === 0) return;
  await admin.from("ytg_deck_sale_items").update(patch)
    .eq("sale_id", saleId).in("card_key", cardKeys);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadItemStates(admin: any, saleId: string): Promise<
  { success: true; items: (SaleItemState & { variantId: string | null; singleProductId: string | null })[] }
  | { success: false; error: string }
> {
  const { data, error } = await admin
    .from("ytg_deck_sale_items")
    .select("card_key, status, delta, qty_before, qty_after, inventory_item_id, variant_id, single_product_id")
    .eq("sale_id", saleId);
  if (error) return { success: false, error: error.message };
  return {
    success: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: (data ?? []).map((i: any) => ({
      cardKey: i.card_key,
      status: i.status as ItemStatus,
      delta: i.delta,
      qtyBefore: i.qty_before,
      qtyAfter: i.qty_after,
      inventoryItemId: i.inventory_item_id,
      variantId: i.variant_id,
      singleProductId: i.single_product_id,
    })),
  };
}

/**
 * Resolve inventory_item_ids for adjustable items that still lack them and
 * persist onto the rows (idempotent; resume re-runs this harmlessly).
 * Items whose variant has no inventory item become 'error'.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveInventoryItemIds(admin: any, token: string, saleId: string): Promise<void> {
  const loaded = await loadItemStates(admin, saleId);
  if (loaded.success === false) return;
  const need = loaded.items.filter(
    (i) => (i.status === "pending" || i.status === "applying")
      && i.inventoryItemId === null && i.variantId !== null,
  );
  if (need.length === 0) return;
  const gidOf = (variantId: string) => `gid://shopify/ProductVariant/${variantId}`;
  const map = await getInventoryItemIds(token, need.map((i) => gidOf(i.variantId as string)));
  for (const i of need) {
    const itemGid = map.get(gidOf(i.variantId as string));
    if (itemGid) {
      await admin.from("ytg_deck_sale_items")
        .update({ inventory_item_id: itemGid })
        .eq("sale_id", saleId).eq("card_key", i.cardKey);
    } else {
      await setItems(admin, saleId, [i.cardKey], {
        status: "error", error: "variant has no inventory item in Shopify",
      });
    }
  }
}

/**
 * Execute one planned batch. The mutation is atomic — on userErrors, mark
 * the offending changes (stale → conflict, not-stocked → activate then
 * retry, other → error) and re-run the pruned remainder under its new
 * (payload-derived) key. Bounded passes; leftovers become 'error'.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runBatch(
  admin: any, token: string, locationId: string, saleId: string, batch: PlannedBatch,
): Promise<void> {
  let changes = batch.changes.slice();
  for (let pass = 0; pass < 4 && changes.length > 0; pass++) {
    const invChanges: InventoryChange[] = changes.map((c) => ({
      inventoryItemId: c.inventoryItemId, delta: c.delta, changeFromQuantity: c.changeFromQuantity,
    }));
    const key = idempotencyKey(batch.baseKey, invChanges);
    const outcome = await adjustAvailable(token, {
      idempotencyKey: key, locationId, changes: invChanges,
    });

    if (outcome.userErrors.length === 0) {
      await setItems(admin, saleId, changes.map((c) => c.cardKey), { status: "applied", error: null });
      return;
    }

    // Whole-mutation idempotency signals (no change index):
    const concurrent = outcome.userErrors.some((e) => e.code === "IDEMPOTENCY_CONCURRENT_REQUEST");
    if (concurrent) return; // another tab is applying this exact payload — leave 'applying', Resume reconciles
    const prevFailed = outcome.userErrors.some(
      (e) => e.code === "IDEMPOTENCY_PREVIOUS_ATTEMPT_FAILED" || e.code === "IDEMPOTENCY_KEY_PARAMETER_MISMATCH",
    );
    if (prevFailed) {
      // The key is burned but nothing applied (previous attempt failed).
      // changeFromQuantity remains the true guard — retry under a salted key.
      const salted = `${batch.baseKey}:retry:${pass + 1}`;
      const retry = await adjustAvailable(token, {
        idempotencyKey: idempotencyKey(salted, invChanges), locationId, changes: invChanges,
      });
      if (retry.userErrors.length === 0) {
        await setItems(admin, saleId, changes.map((c) => c.cardKey), { status: "applied", error: null });
        return;
      }
      outcome.userErrors = retry.userErrors;
    }

    const failedIdx = new Set<number>();
    const activations: { idx: number; inventoryItemId: string }[] = [];
    let unattributed: InventoryUserError | null = null;
    for (const e of outcome.userErrors) {
      const idx = changeIndexOf(e);
      if (idx === null || idx >= changes.length) { unattributed = e; continue; }
      failedIdx.add(idx);
      if (isNotStockedError(e)) {
        activations.push({ idx, inventoryItemId: changes[idx].inventoryItemId });
      } else if (isStaleCasError(e)) {
        await setItems(admin, saleId, [changes[idx].cardKey], { status: "conflict", error: CONFLICT_MSG });
      } else {
        await setItems(admin, saleId, [changes[idx].cardKey], {
          status: "error", error: `${e.code ?? "SHOPIFY_ERROR"}: ${e.message}`,
        });
      }
    }
    if (unattributed !== null && failedIdx.size === 0) {
      await setItems(admin, saleId, changes.map((c) => c.cardKey), {
        status: "error", error: `${unattributed.code ?? "SHOPIFY_ERROR"}: ${unattributed.message}`,
      });
      return;
    }

    // Never-activated items: inventoryActivate(available: 0) with the
    // spec-pinned key, then the change goes back into the retry payload.
    const reactivated = new Set<number>();
    for (const a of activations) {
      const act = await activateItem(token, {
        idempotencyKey: `sale:${saleId}:activate:${a.inventoryItemId}`,
        inventoryItemId: a.inventoryItemId, locationId,
      });
      if (act.userErrors.length === 0) reactivated.add(a.idx);
      else await setItems(admin, saleId, [changes[a.idx].cardKey], {
        status: "error", error: `activate failed: ${act.userErrors.map((e) => e.message).join("; ")}`,
      });
    }

    // Atomicity: non-failing changes were NOT applied — re-run them, plus
    // any freshly-activated ones. Pruned payload ⇒ new fingerprint ⇒ new key.
    changes = changes.filter((c, idx) => !failedIdx.has(idx) || reactivated.has(idx));
  }
  if (changes.length > 0) {
    await setItems(admin, saleId, changes.map((c) => c.cardKey), {
      status: "error", error: "retry passes exhausted — use per-row Retry",
    });
  }
}

function isAccessDenied(e: unknown): boolean {
  return e instanceof Error && /ACCESS_DENIED|access denied/i.test(e.message);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function degradeToDryRun(admin: any, saleId: string): Promise<void> {
  // Scope not granted after all: revert in-flight items, park the sale as
  // dry_run (visibly segregated, never applied, non-replayable — spec).
  const { data: inflight } = await admin
    .from("ytg_deck_sale_items").select("card_key")
    .eq("sale_id", saleId).eq("status", "applying");
  await setItems(admin, saleId, (inflight ?? []).map((i: { card_key: string }) => i.card_key), {
    status: "pending", error: null,
  });
  await admin.from("ytg_deck_sales").update({ status: "dry_run" }).eq("id", saleId);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function finishApplyPass(admin: any, token: string, locationId: string, saleId: string): Promise<void> {
  const loaded = await loadItemStates(admin, saleId);
  if (loaded.success === false) return;
  const plan = planApply(saleId, loaded.items);
  await setItems(admin, saleId, plan.unresolvable, {
    status: "error", error: "missing inventory item id or CAS anchors",
  });
  for (const batch of plan.batches) {
    // CAS the batch's items pending→applying BEFORE the Shopify call —
    // losing rows here means another tab owns them; skip those.
    const { data: flipped } = await admin
      .from("ytg_deck_sale_items").update({ status: "applying" })
      .eq("sale_id", saleId)
      .in("card_key", batch.changes.map((c) => c.cardKey))
      .eq("status", "pending")
      .select("card_key");
    const owned = new Set((flipped ?? []).map((f: { card_key: string }) => f.card_key));
    const ownedChanges = batch.changes.filter((c) => owned.has(c.cardKey));
    if (ownedChanges.length === 0) continue;
    await runBatch(admin, token, locationId, saleId, { ...batch, changes: ownedChanges });
  }
  // Sale status is DERIVED from items.
  const after = await loadItemStates(admin, saleId);
  if (after.success === false) return;
  if (after.items.some((i) => i.status === "applying")) return; // concurrent tab still in flight
  await admin.from("ytg_deck_sales")
    .update({ status: deriveSaleStatus(after.items) })
    .eq("id", saleId).eq("status", "applying");
}

export async function applySale(saleId: string): Promise<SaleResult> {
  if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
  const admin = getSupabaseAdmin();
  const { data: sale, error: saleErr } = await admin
    .from("ytg_deck_sales").select("id, status").eq("id", saleId).maybeSingle();
  if (saleErr) return { success: false, error: saleErr.message };
  if (!sale) return { success: false, error: "sale not found" };
  if (sale.status === "pending") {
    // Crash between confirm-insert and claim: re-claim.
    const { data: claimed } = await admin
      .from("ytg_deck_sales").update({ status: "applying" })
      .eq("id", saleId).eq("status", "pending").select("id");
    if (!claimed || claimed.length === 0) return loadSaleView(admin, saleId);
  } else if (sale.status !== "applying") {
    return loadSaleView(admin, saleId); // terminal — just show it
  }
  if (inventoryWritesEnabled() === false) {
    await degradeToDryRun(admin, saleId);
    return loadSaleView(admin, saleId, "scope_missing");
  }
  try {
    const token = await getShopifyAccessToken();
    const locationId = await getSingleLocationId(token);
    await resolveInventoryItemIds(admin, token, saleId);
    await finishApplyPass(admin, token, locationId, saleId);
  } catch (e) {
    if (isAccessDenied(e)) {
      await degradeToDryRun(admin, saleId);
      return loadSaleView(admin, saleId, "scope_missing");
    }
    return { success: false, error: e instanceof Error ? e.message : "apply failed" };
  }
  return loadSaleView(admin, saleId);
}

export async function resumeSale(saleId: string): Promise<SaleResult> {
  if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
  const admin = getSupabaseAdmin();
  const { data: sale, error: saleErr } = await admin
    .from("ytg_deck_sales").select("id, status").eq("id", saleId).maybeSingle();
  if (saleErr) return { success: false, error: saleErr.message };
  if (!sale) return { success: false, error: "sale not found" };
  if (sale.status === "pending") return applySale(saleId);
  if (sale.status !== "applying") return loadSaleView(admin, saleId);
  if (inventoryWritesEnabled() === false) {
    await degradeToDryRun(admin, saleId);
    return loadSaleView(admin, saleId, "scope_missing");
  }
  try {
    const token = await getShopifyAccessToken();
    const locationId = await getSingleLocationId(token);
    await resolveInventoryItemIds(admin, token, saleId);

    // Oracle phase: 'applying' items are UNKNOWN — re-read live quantities.
    const loaded = await loadItemStates(admin, saleId);
    if (loaded.success === false) return { success: false, error: loaded.error };
    const stranded = loaded.items.filter((i) => i.status === "applying");
    if (stranded.length > 0) {
      const live = await fetchProductInventory(
        token,
        [...new Set(stranded.map((i) => i.singleProductId).filter((x): x is string => Boolean(x)))],
      );
      const liveByCardKey = new Map<string, number>();
      for (const i of stranded) {
        const inv = i.singleProductId !== null ? live.get(i.singleProductId) : undefined;
        if (inv !== undefined) liveByCardKey.set(i.cardKey, inv.inventory);
      }
      const plan = planResume(saleId, loaded.items, liveByCardKey);
      await setItems(admin, saleId, plan.markApplied, { status: "applied", error: null });
      await setItems(admin, saleId, plan.conflicts, { status: "conflict", error: RESUME_CONFLICT_MSG });
      for (const batch of plan.reapply) {
        // Same payload ⇒ same key ⇒ Shopify dedupes even if the original
        // call arrived late (spec: "makes even the re-apply race safe").
        await runBatch(admin, token, locationId, saleId, batch);
      }
    }
    await finishApplyPass(admin, token, locationId, saleId);
  } catch (e) {
    if (isAccessDenied(e)) {
      await degradeToDryRun(admin, saleId);
      return loadSaleView(admin, saleId, "scope_missing");
    }
    return { success: false, error: e instanceof Error ? e.message : "resume failed" };
  }
  return loadSaleView(admin, saleId);
}

export type RetryResult =
  | SaleResult
  | { success: false; error: string; needsAck: true; qtyBefore: number; qtyAfter: number };

/**
 * Per-row retry for 'error'/'conflict' items: re-read live quantity (the
 * spec's "after re-preview"), refresh the CAS anchors on the row, then a
 * single-change adjust under a payload-derived key. Undo stays correct
 * because qty_after is refreshed too.
 */
export async function retrySaleItem(
  saleId: string, cardKey: string, ackNegative: boolean,
): Promise<RetryResult> {
  if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
  const admin = getSupabaseAdmin();
  if (inventoryWritesEnabled() === false) {
    return { success: false, error: "inventory writes are not enabled — retry is unavailable in dry-run" };
  }
  const { data: item, error: itemErr } = await admin
    .from("ytg_deck_sale_items")
    .select("card_key, status, delta, single_product_id, variant_id, inventory_item_id")
    .eq("sale_id", saleId).eq("card_key", cardKey).maybeSingle();
  if (itemErr) return { success: false, error: itemErr.message };
  if (!item) return { success: false, error: "sale item not found" };
  if (item.status !== "error" && item.status !== "conflict") {
    return loadSaleView(admin, saleId);
  }
  if (!item.single_product_id) return { success: false, error: "item has no mapped product" };
  try {
    const token = await getShopifyAccessToken();
    const locationId = await getSingleLocationId(token);
    await resolveInventoryItemIds(admin, token, saleId);
    const live = await fetchProductInventory(token, [item.single_product_id]);
    const inv = live.get(item.single_product_id);
    if (inv === undefined || inv.tracked === false) {
      return { success: false, error: "product is gone or untracked in Shopify — fix in Matching/Shopify first" };
    }
    const qtyBefore = inv.inventory;
    const qtyAfter = qtyBefore + item.delta;
    if (qtyAfter < 0 && ackNegative !== true) {
      return { success: false, error: "would go negative — acknowledge to proceed", needsAck: true, qtyBefore, qtyAfter };
    }
    const { data: fresh } = await admin
      .from("ytg_deck_sale_items").select("inventory_item_id")
      .eq("sale_id", saleId).eq("card_key", cardKey).maybeSingle();
    const inventoryItemId: string | null = fresh ? fresh.inventory_item_id : null;
    if (inventoryItemId === null) return { success: false, error: "no inventory item id for this variant" };
    // CAS claim + refreshed anchors (the resume oracle keys off these).
    const { data: claimed } = await admin
      .from("ytg_deck_sale_items")
      .update({ status: "applying", qty_before: qtyBefore, qty_after: qtyAfter, error: null })
      .eq("sale_id", saleId).eq("card_key", cardKey)
      .in("status", ["error", "conflict"]).select("card_key");
    if (!claimed || claimed.length === 0) return loadSaleView(admin, saleId);
    await runBatch(admin, token, locationId, saleId, {
      n: 0,
      baseKey: `sale:${saleId}:item:${inventoryItemId}`,
      changes: [{ cardKey, inventoryItemId, delta: item.delta, changeFromQuantity: qtyBefore }],
    });
    const after = await loadItemStates(admin, saleId);
    if (after.success === true && !after.items.some((i) => i.status === "applying")) {
      await admin.from("ytg_deck_sales")
        .update({ status: deriveSaleStatus(after.items) })
        .eq("id", saleId).in("status", ["applied", "partial", "failed", "applying"]);
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "retry failed" };
  }
  return loadSaleView(admin, saleId);
}

export async function undoSale(saleId: string): Promise<SaleResult> {
  if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
  const admin = getSupabaseAdmin();
  if (inventoryWritesEnabled() === false) {
    return { success: false, error: "inventory writes are not enabled — undo is unavailable" };
  }
  // Double-click/two-tab safe claim; a sale stranded in 'undoing' (crash)
  // may re-enter — payload-derived keys make the re-run dedupe-safe.
  const { data: claimed, error: claimErr } = await admin
    .from("ytg_deck_sales").update({ status: "undoing" })
    .eq("id", saleId).in("status", ["applied", "partial"]).select("id");
  if (claimErr) return { success: false, error: claimErr.message };
  if (!claimed || claimed.length === 0) {
    const { data: cur } = await admin
      .from("ytg_deck_sales").select("status").eq("id", saleId).maybeSingle();
    if (!cur || cur.status !== "undoing") {
      return { success: false, error: "sale is not undoable (only applied/partial sales can be undone, once)" };
    }
  }
  try {
    const token = await getShopifyAccessToken();
    const locationId = await getSingleLocationId(token);
    const loaded = await loadItemStates(admin, saleId);
    if (loaded.success === false) return { success: false, error: loaded.error };
    const plan = planUndo(saleId, loaded.items);
    for (const batch of plan.batches) {
      let changes = batch.changes.slice();
      for (let pass = 0; pass < 3 && changes.length > 0; pass++) {
        const invChanges: InventoryChange[] = changes.map((c) => ({
          inventoryItemId: c.inventoryItemId, delta: c.delta, changeFromQuantity: c.changeFromQuantity,
        }));
        const outcome = await adjustAvailable(token, {
          idempotencyKey: idempotencyKey(batch.baseKey, invChanges), locationId, changes: invChanges,
        });
        if (outcome.userErrors.length === 0) {
          await setItems(admin, saleId, changes.map((c) => c.cardKey), { status: "undone", error: null });
          changes = [];
          break;
        }
        const failedIdx = new Set<number>();
        for (const e of outcome.userErrors) {
          const idx = changeIndexOf(e);
          if (idx === null || idx >= changes.length) continue;
          failedIdx.add(idx);
          await setItems(admin, saleId, [changes[idx].cardKey], {
            status: "undo_conflict",
            error: isStaleCasError(e) ? UNDO_CONFLICT_MSG : `${e.code ?? "SHOPIFY_ERROR"}: ${e.message}`,
          });
        }
        if (failedIdx.size === 0) {
          // Whole-mutation failure (idempotency signal etc.) — leave items
          // 'applied'; deriveUndoStatus lands on undo_partial below.
          break;
        }
        changes = changes.filter((_, idx) => !failedIdx.has(idx));
      }
    }
    const after = await loadItemStates(admin, saleId);
    if (after.success === false) return { success: false, error: after.error };
    await admin.from("ytg_deck_sales").update({
      status: deriveUndoStatus(after.items),
      undone_by: await actingUserId(),
      undone_at: new Date().toISOString(),
    }).eq("id", saleId).eq("status", "undoing");
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "undo failed" };
  }
  return loadSaleView(admin, saleId);
}
