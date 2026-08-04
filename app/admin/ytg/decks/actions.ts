"use server";

import { hasPermission } from "@/utils/adminUtils";
import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
import { syncShopifyProducts } from "@/lib/pricing/syncShopifyProducts";
import { createClient } from "@/utils/supabase/server";
import { DECK_PRODUCT_TYPES } from "@/lib/ytg/constants";
import {
  parseDeckContents, buildAliasCandidates, type ParsedLine,
} from "@/lib/ytg/deckContentsParser";
import {
  createDeckLinkedOp, replaceDeckContentsOp, unlinkProductOp,
  type ResolvedEntry, type CreateDeckResult, type ReplaceResult,
} from "@/lib/ytg/deckLinkOps";

const PERM = "manage_shopify_imports";

export interface DeckProductRow {
  productId: string;
  title: string;
  handle: string;
  productType: string;
  price: number | null;
  inventory: number;
  status: string | null;       // raw_json.status when present
  imageUrl: string | null;     // raw_json.images[0].src when present
  linkedDeckId: string | null;
  linkedAt: string | null;
}

export interface DeckProductMeta {
  productId: string;
  title: string;
  handle: string;
  price: number | null;
  inventory: number;
  imageUrl: string | null;
}

export type ParsedContentsResult =
  | {
      success: true;
      product: DeckProductMeta;
      lines: ParsedLine[];
      linked: { deckId: string; currentCardCount: number } | null;
    }
  | { success: false; error: string };

export async function listDeckProducts(): Promise<
  { success: true; products: DeckProductRow[] } | { success: false; error: string }
> {
  if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
  const admin = getSupabaseAdmin();

  const { data: products, error } = await admin
    .from("shopify_products")
    .select("id, title, handle, product_type, price, inventory_quantity, raw_json")
    .in("product_type", [...DECK_PRODUCT_TYPES]);
  if (error) return { success: false, error: error.message };

  // No FK between the mirror and ytg_deck_links — merge in JS.
  const { data: links, error: linkErr } = await admin
    .from("ytg_deck_links")
    .select("shopify_product_id, deck_id, created_at");
  if (linkErr) return { success: false, error: linkErr.message };

  const linkByProduct = new Map<string, { deck_id: string; created_at: string }>();
  for (const l of links ?? []) linkByProduct.set(l.shopify_product_id, l);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: DeckProductRow[] = (products ?? []).map((p: any) => {
    const link = linkByProduct.get(p.id);
    return {
      productId: p.id,
      title: p.title,
      handle: p.handle,
      productType: p.product_type,
      price: p.price,
      inventory: p.inventory_quantity ?? 0,
      status: p.raw_json?.status ?? null,
      imageUrl: p.raw_json?.images?.[0]?.src ?? p.raw_json?.image?.src ?? null,
      linkedDeckId: link ? link.deck_id : null,
      linkedAt: link ? link.created_at : null,
    };
  });

  const live = (r: DeckProductRow) =>
    r.inventory > 0 && (r.status === null || r.status === "active");
  rows.sort((a, b) =>
    (live(b) ? 1 : 0) - (live(a) ? 1 : 0) || a.title.localeCompare(b.title));

  return { success: true, products: rows };
}

export async function getParsedContents(productId: string): Promise<ParsedContentsResult> {
  if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
  const admin = getSupabaseAdmin();

  const { data: p, error } = await admin
    .from("shopify_products")
    .select("id, title, handle, price, inventory_quantity, body_html, raw_json")
    .eq("id", productId)
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!p) return { success: false, error: "not_found" };
  if (!p.body_html) {
    return { success: false, error: "No description synced for this product yet — use Re-sync (or run a product sync) and retry." };
  }

  const { data: aliasRows, error: aliasErr } = await admin
    .from("set_aliases")
    .select("carddata_code, shopify_abbrev");
  if (aliasErr) return { success: false, error: aliasErr.message };

  const lines = parseDeckContents(p.body_html, buildAliasCandidates(aliasRows ?? []));

  const { data: link } = await admin
    .from("ytg_deck_links").select("deck_id")
    .eq("shopify_product_id", productId).maybeSingle();
  let linked: { deckId: string; currentCardCount: number } | null = null;
  if (link) {
    const { data: cards } = await admin
      .from("deck_cards").select("quantity").eq("deck_id", link.deck_id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = (cards ?? []).reduce((s: number, c: any) => s + (c.quantity ?? 0), 0);
    linked = { deckId: link.deck_id, currentCardCount: count };
  }

  return {
    success: true,
    product: {
      productId: p.id,
      title: p.title,
      handle: p.handle,
      price: p.price,
      inventory: p.inventory_quantity ?? 0,
      imageUrl: p.raw_json?.images?.[0]?.src ?? p.raw_json?.image?.src ?? null,
    },
    lines,
    linked,
  };
}

export async function resyncProduct(productId: string): Promise<ParsedContentsResult> {
  if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
  // v1 freshness: syncShopifyProducts() re-syncs ALL mirrored product types
  // (one REST pass per type). Acceptable for a manual refresh button; a
  // single-product fetch is a later optimization.
  await syncShopifyProducts();
  return getParsedContents(productId);
}

export async function createDeckFromContents(
  productId: string,
  resolved: ResolvedEntry[],
): Promise<CreateDeckResult> {
  if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
  if (!resolved || resolved.length === 0) return { success: false, error: "no resolved cards — nothing to create" };
  const admin = getSupabaseAdmin();

  const { data: p, error } = await admin
    .from("shopify_products").select("id, title, handle")
    .eq("id", productId).maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!p) return { success: false, error: "not_found" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return createDeckLinkedOp(admin, {
    productId,
    handle: p.handle,
    productTitle: p.title,
    createdBy: user?.id ?? null,
    resolved,
  });
}

export async function replaceDeckContents(
  productId: string,
  resolved: ResolvedEntry[],
): Promise<ReplaceResult> {
  if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
  if (!resolved || resolved.length === 0) return { success: false, error: "no resolved cards — nothing to replace" };
  return replaceDeckContentsOp(getSupabaseAdmin(), { productId, resolved });
}

export async function unlinkProduct(productId: string): Promise<{ success: boolean; error?: string }> {
  if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
  return unlinkProductOp(getSupabaseAdmin(), productId);
}
