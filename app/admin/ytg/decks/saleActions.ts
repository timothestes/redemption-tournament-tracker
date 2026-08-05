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
