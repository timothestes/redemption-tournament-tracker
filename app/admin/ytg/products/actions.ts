"use server";

import { hasPermission } from "@/utils/adminUtils";
import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
import { syncShopifyProducts } from "@/lib/pricing/syncShopifyProducts";
import { runAliasedMutations, type AliasedMutation } from "@/lib/shopify/aliasBatch";
import { CARDS, type CardData } from "@/lib/cards/lookup";
import { MANAGED_TAGS } from "@/lib/shopify/tagRules";
import {
  computeProductTagDiff,
  rollupTagChanges,
  splitTags,
  STALENESS_LIMIT_MS,
  type TagDiffRow,
  type TagRollupEntry,
} from "@/lib/shopify/tagDiff";

// ---------- module-private plumbing ----------

const CARD_BY_KEY = new Map<string, CardData>();
for (const card of CARDS) {
  CARD_BY_KEY.set(`${card.name}|${card.set}|${card.imgFile}`, card);
}

// Layout gating does not protect server actions — every action re-checks.
async function requireTagPermission(): Promise<void> {
  const ok = await hasPermission("manage_shopify_imports");
  if (!ok) throw new Error("Unauthorized: manage_shopify_imports permission required");
}

interface ConfirmedMapping {
  card_key: string;
  set_code: string;
  shopify_product_id: string;
}

/**
 * All confirmed mappings. Spec's "matched/manual" = DB statuses
 * 'auto_matched'/'manual' (see CardPriceMapping in lib/pricing/types.ts).
 */
async function loadConfirmedMappings(): Promise<ConfirmedMapping[]> {
  const supabase = getSupabaseAdmin();
  const rows: ConfirmedMapping[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("card_price_mappings")
      .select("card_key, set_code, shopify_product_id")
      .in("status", ["auto_matched", "manual"])
      .not("shopify_product_id", "is", null)
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Failed to load card_price_mappings: ${error.message}`);
    rows.push(...((data ?? []) as ConfirmedMapping[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

interface MirrorProduct {
  id: string;
  title: string;
  handle: string;
  tags: string | null;
  last_synced_at: string | null;
}

async function loadProductsByIds(ids: string[]): Promise<MirrorProduct[]> {
  const supabase = getSupabaseAdmin();
  const products: MirrorProduct[] = [];
  const chunkSize = 500;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("shopify_products")
      .select("id, title, handle, tags, last_synced_at")
      .in("id", chunk);
    if (error) throw new Error(`Failed to load shopify_products: ${error.message}`);
    products.push(...((data ?? []) as MirrorProduct[]));
  }
  return products;
}

/** MIN(last_synced_at); null when empty or any row has never synced (maximally stale). */
function oldestSync(products: { last_synced_at: string | null }[]): string | null {
  let oldest: string | null = null;
  for (const p of products) {
    if (p.last_synced_at === null) return null;
    if (oldest === null || p.last_synced_at < oldest) oldest = p.last_synced_at;
  }
  return oldest;
}

// ---------- actions ----------

export interface MappedSet {
  setCode: string;
  count: number;
}

/** Set codes present in confirmed mappings, for the scope picker. */
export async function listMappedSets(): Promise<MappedSet[]> {
  await requireTagPermission();
  const mappings = await loadConfirmedMappings();
  const counts = new Map<string, number>();
  for (const m of mappings) counts.set(m.set_code, (counts.get(m.set_code) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([setCode, count]) => ({ setCode, count }))
    .sort((a, b) => a.setCode.localeCompare(b.setCode));
}

export interface TagDiffResult {
  rows: TagDiffRow[];              // products with changes only
  rollup: TagRollupEntry[];        // per-tag add/remove counts
  oldestSyncAt: string | null;     // MIN last_synced_at of involved mirror rows
  productCount: number;            // mapped products scanned in scope
}

export async function computeTagDiff(scope: { setCode?: string }): Promise<TagDiffResult> {
  await requireTagPermission();
  const mappings = await loadConfirmedMappings();

  // 1) Scope selects PRODUCTS: any product with a confirmed mapping in the set.
  const inScope = new Set<string>();
  for (const m of mappings) {
    if (scope.setCode !== undefined && scope.setCode !== "" && m.set_code !== scope.setCode) continue;
    inScope.add(m.shopify_product_id);
  }

  // 2) The desired-tag union is over ALL confirmed mappings of those products —
  // never scope the union itself: a set-scoped union on a shared product
  // (promo print + original print) would mark the other print's tags for removal.
  const mappingsByProduct = new Map<string, CardData[]>();
  for (const m of mappings) {
    if (!inScope.has(m.shopify_product_id)) continue;
    const card = CARD_BY_KEY.get(m.card_key);
    if (!card) continue; // mapping predates a carddata regen — skip (fail-closed: no diff row)
    const list = mappingsByProduct.get(m.shopify_product_id);
    if (list) {
      list.push(card);
    } else {
      mappingsByProduct.set(m.shopify_product_id, [card]);
    }
  }

  const products = await loadProductsByIds(Array.from(inScope));
  const rows = computeProductTagDiff(products, mappingsByProduct);
  return {
    rows,
    rollup: rollupTagChanges(rows),
    oldestSyncAt: oldestSync(products),
    productCount: products.length,
  };
}

export interface CollisionEntry {
  tag: string;
  productCount: number;
  sampleTitles: string[];
}

/**
 * One-time reconciliation data: every live tag name across ALL mirror products
 * that is in MANAGED_TAGS but appears on products with NO confirmed mapping —
 * i.e. hand-tagged non-card products whose tag names collide with ours
 * ('Gold'/'Silver' are brigade names). The sync never edits those products;
 * this report is the sign-off context for per-tag removal opt-ins.
 */
export async function getCollisionReport(): Promise<CollisionEntry[]> {
  await requireTagPermission();
  const supabase = getSupabaseAdmin();
  const mappedIds = new Set((await loadConfirmedMappings()).map((m) => m.shopify_product_id));

  const byTag = new Map<string, { productCount: number; sampleTitles: string[] }>();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("shopify_products")
      .select("id, title, tags")
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Failed to load shopify_products: ${error.message}`);
    for (const p of (data ?? []) as { id: string; title: string; tags: string | null }[]) {
      if (mappedIds.has(p.id)) continue;
      for (const tag of splitTags(p.tags)) {
        if (!MANAGED_TAGS.has(tag)) continue;
        let entry = byTag.get(tag);
        if (!entry) {
          entry = { productCount: 0, sampleTitles: [] };
          byTag.set(tag, entry);
        }
        entry.productCount++;
        if (entry.sampleTitles.length < 3) entry.sampleTitles.push(p.title);
      }
    }
    if (!data || data.length < pageSize) break;
  }

  return Array.from(byTag.entries())
    .map(([tag, e]) => ({ tag, productCount: e.productCount, sampleTitles: e.sampleTitles }))
    .sort((a, b) => b.productCount - a.productCount || a.tag.localeCompare(b.tag));
}

export interface TagChange {
  productId: string;
  add: string[];
  remove: string[];
}

export interface ApplyFailure {
  productId: string;
  add: string[];
  remove: string[];
  errors: string[];
}

export interface ApplyResult {
  applied: number;
  failed: ApplyFailure[];
  error: string | null; // non-null ⇒ nothing was attempted (e.g. staleness guard)
}

export async function applyTagChanges(changes: TagChange[]): Promise<ApplyResult> {
  await requireTagPermission();
  const active = changes.filter((c) => c.add.length > 0 || c.remove.length > 0);
  if (active.length === 0) return { applied: 0, failed: [], error: null };

  // Staleness guard: refuse when any targeted mirror row is >1h old (or
  // missing/never synced) — between-sync tag edits by Andy must stay bounded
  // by a window he's aware of.
  const targeted = await loadProductsByIds(active.map((c) => c.productId));
  const oldest = oldestSync(targeted);
  const oldestMs = oldest === null ? null : new Date(oldest).getTime();
  if (targeted.length < active.length || oldestMs === null || Date.now() - oldestMs > STALENESS_LIMIT_MS) {
    return {
      applied: 0,
      failed: [],
      error:
        `Product mirror is stale (oldest sync: ${oldest ?? "never"}). ` +
        `Use "Sync now" and recompute the diff before applying.`,
    };
  }

  // Mock mode short-circuits before any GraphQL write, like the importer.
  // runAliasedMutations deliberately does NOT handle SHOPIFY_WRITE_MOCK.
  if (process.env.SHOPIFY_WRITE_MOCK === "1") {
    return { applied: active.length, failed: [], error: null };
  }

  // Build aliased tagsAdd/tagsRemove calls. JSON.stringify escapes quotes in
  // tag values (officialSet names contain apostrophes) into valid GraphQL
  // string/list literals. aliasBatch chunks ≤40 mutations per document and
  // returns one AliasedResult per input call, including synthetic userErrors
  // for rejected chunks.
  const calls: AliasedMutation[] = [];
  const aliasToProduct = new Map<string, string>();
  active.forEach((change, i) => {
    const gid = JSON.stringify(`gid://shopify/Product/${change.productId}`);
    if (change.add.length > 0) {
      const alias = `add${i}`;
      calls.push({
        alias,
        mutation: `tagsAdd(id: ${gid}, tags: ${JSON.stringify(change.add)})`,
        selection: `{ userErrors { field message } }`,
      });
      aliasToProduct.set(alias, change.productId);
    }
    if (change.remove.length > 0) {
      const alias = `rem${i}`;
      calls.push({
        alias,
        mutation: `tagsRemove(id: ${gid}, tags: ${JSON.stringify(change.remove)})`,
        selection: `{ userErrors { field message } }`,
      });
      aliasToProduct.set(alias, change.productId);
    }
  });

  const results = await runAliasedMutations(calls);

  const errorsByProduct = new Map<string, string[]>();
  for (const result of results) {
    if (result.userErrors.length === 0) continue;
    const productId = aliasToProduct.get(result.alias);
    if (productId === undefined) continue;
    const existing = errorsByProduct.get(productId) ?? [];
    for (const err of result.userErrors) existing.push(err.message);
    errorsByProduct.set(productId, existing);
  }

  const failed: ApplyFailure[] = [];
  for (const change of active) {
    const errors = errorsByProduct.get(change.productId);
    if (errors === undefined) continue;
    failed.push({ productId: change.productId, add: change.add, remove: change.remove, errors });
  }
  return { applied: active.length - failed.length, failed, error: null };
}

/** Inline staleness fix: refresh the mirror, then the client recomputes. */
export async function syncNow(): Promise<{ upserted: number; errors: number }> {
  await requireTagPermission();
  return syncShopifyProducts();
}
