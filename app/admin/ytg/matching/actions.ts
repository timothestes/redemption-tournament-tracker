"use server";

import { hasPermission } from '@/utils/adminUtils';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import { getShopifyAccessToken } from '@/lib/pricing/shopify';
import { shopifyGraphQL } from '@/lib/shopify/admin-write';
import { runAliasedMutations, type AliasedMutation } from '@/lib/shopify/aliasBatch';
import {
  planBackfillRows, skuFromCardKey,
  type BackfillRow, type BackfillSkip, type BackfillMappingRow, type BackfillProductLite,
} from '@/lib/shopify/skuBackfill';

async function requireYtgPermission(): Promise<void> {
  if (!(await hasPermission('manage_shopify_imports'))) {
    throw new Error('Forbidden: manage_shopify_imports permission required');
  }
}

export interface BackfillExecRow extends BackfillRow {
  variantOk: boolean;
  metafieldOk: boolean;
  mirrorOk: boolean;
  mock: boolean;
  error: string | null;
}

export async function planSkuBackfill(): Promise<{
  toWrite: BackfillRow[]; skippedPermanent: BackfillSkip[]; blocked: BackfillSkip[]; count: number;
}> {
  await requireYtgPermission();
  const supabase = getSupabaseAdmin();
  const pageSize = 1000;

  // Confirmed mappings whose product is a Single (!inner join makes the
  // embedded filters constrain the parent rows). NO sku-is-null prefilter:
  // synced blank SKUs land as "" (empty string), so the "already has a SKU"
  // decision belongs to planBackfillRows' trim check, which treats ""/null
  // both as missing.
  const mappings: (BackfillMappingRow & { shopify_products: BackfillProductLite })[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('card_price_mappings')
      .select('card_key, shopify_product_id, confidence, match_method, status, shopify_products!inner(id, sku, product_type, raw_json)')
      .in('status', ['auto_matched', 'manual'])
      .not('shopify_product_id', 'is', null)
      .eq('shopify_products.product_type', 'Single')
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`planSkuBackfill mappings: ${error.message}`);
    mappings.push(...((data ?? []) as unknown as (BackfillMappingRow & { shopify_products: BackfillProductLite })[]));
    if (!data || data.length < pageSize) break;
  }

  // Existing SKU owners (duplicate-SKU guard input)
  const existingSkuOwners = new Map<string, string>();
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('shopify_products')
      .select('id, sku')
      .not('sku', 'is', null)
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`planSkuBackfill skus: ${error.message}`);
    for (const p of data ?? []) {
      if ((p.sku ?? '').trim() !== '') existingSkuOwners.set(p.sku, p.id);
    }
    if (!data || data.length < pageSize) break;
  }

  const productsById = new Map<string, BackfillProductLite>();
  for (const m of mappings) productsById.set(m.shopify_products.id, m.shopify_products);

  const plan = planBackfillRows(
    mappings.map(m => ({
      card_key: m.card_key, shopify_product_id: m.shopify_product_id,
      confidence: m.confidence, match_method: m.match_method, status: m.status,
    })),
    productsById,
    existingSkuOwners,
  );
  return { ...plan, count: plan.toWrite.length };
}

const METAFIELDS_SET_MUTATION = `
mutation setCardKeys($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id key }
    userErrors { field message code }
  }
}`;

export async function executeSkuBackfill(rows: BackfillRow[]): Promise<BackfillExecRow[]> {
  await requireYtgPermission();
  if (rows.length === 0) return [];
  if (rows.length > 40) throw new Error('executeSkuBackfill: send at most 40 rows per call (client chunks)');

  // Mock short-circuit, same pattern as productSetUpsert (admin-write.ts:113).
  // runAliasedMutations does NOT handle SHOPIFY_WRITE_MOCK — this guard must
  // come first. Do NOT touch the mirror in mock mode — a mirror sku the store
  // doesn't have would poison pass 0.
  if (process.env.SHOPIFY_WRITE_MOCK === '1') {
    return rows.map(r => ({ ...r, variantOk: true, metafieldOk: true, mirrorOk: false, mock: true, error: null }));
  }

  // 1) Variant SKU writes — one aliased productVariantsBulkUpdate per product.
  //    EXACT 2026-07 shape: sku lives at inventoryItem.sku in ProductVariantsBulkInput.
  const calls: AliasedMutation[] = rows.map((r, i) => ({
    alias: `v${i}`,
    mutation: `productVariantsBulkUpdate(productId: ${JSON.stringify(r.productGid)}, variants: [{ id: ${JSON.stringify(r.variantGid)}, inventoryItem: { sku: ${JSON.stringify(r.sku)} } }])`,
    selection: `{ productVariants { id } userErrors { field message } }`,
  }));
  const aliasResults = await runAliasedMutations(calls);
  const byAlias = new Map(aliasResults.map(r => [r.alias, r]));

  const out: BackfillExecRow[] = rows.map((r, i) => {
    const res = byAlias.get(`v${i}`);
    const errs = res ? res.userErrors : [{ message: 'no result returned for alias' }];
    return {
      ...r,
      variantOk: errs.length === 0,
      metafieldOk: false,
      mirrorOk: false,
      mock: false,
      error: errs.length > 0 ? errs.map(e => e.message).join('; ') : null,
    };
  });

  // 2) rtt_card_key metafields for variant-OK rows, chunks of 25 (metafieldsSet cap).
  const okRows = out.filter(r => r.variantOk);
  if (okRows.length > 0) {
    const token = await getShopifyAccessToken();
    for (let i = 0; i < okRows.length; i += 25) {
      const chunk = okRows.slice(i, i + 25);
      try {
        const data = await shopifyGraphQL<{ metafieldsSet: { userErrors: { field?: string[] | null; message: string }[] } }>(
          token, METAFIELDS_SET_MUTATION,
          { metafields: chunk.map(r => ({ ownerId: r.productGid, namespace: 'custom', key: 'rtt_card_key', type: 'single_line_text_field', value: r.cardKey })) },
        );
        const errs = data.metafieldsSet.userErrors;
        if (errs.length === 0) {
          for (const r of chunk) r.metafieldOk = true;
        } else {
          // userError field paths look like ["metafields","3","value"] — map back per index when possible
          const badIdx = new Set(errs.map(e => Number(e.field?.[1])).filter(n => Number.isInteger(n)));
          chunk.forEach((r, idx) => {
            const bad = badIdx.size > 0 ? badIdx.has(idx) : true;
            r.metafieldOk = bad === false;
            if (bad) r.error = [r.error, `metafield: ${errs.map(e => e.message).join('; ')}`].filter(Boolean).join(' | ');
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'metafieldsSet failed';
        for (const r of chunk) r.error = [r.error, `metafield: ${msg}`].filter(Boolean).join(' | ');
      }
    }
  }

  // 3) Mirror update so pass 0 sees the new SKUs without waiting for a sync.
  const supabase = getSupabaseAdmin();
  for (const r of out) {
    if (r.variantOk === false) continue;
    const { error } = await supabase.from('shopify_products').update({ sku: r.sku }).eq('id', r.productId);
    r.mirrorOk = !error;
    if (error) r.error = [r.error, `mirror: ${error.message}`].filter(Boolean).join(' | ');
  }
  return out;
}

const STALE_IDENTITY_QUERY = `
query staleIdentity($id: ID!) {
  product(id: $id) {
    id
    metafield(namespace: "custom", key: "rtt_card_key") { id value }
    variants(first: 1) { nodes { id inventoryItem { sku } } }
  }
}`;

const VARIANT_SKU_CLEAR_MUTATION = `
mutation clearVariantSku($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id }
    userErrors { field message }
  }
}`;

const METAFIELDS_DELETE_MUTATION = `
mutation deleteCardKey($metafields: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(metafields: $metafields) {
    deletedMetafields { key namespace ownerId }
    userErrors { field message }
  }
}`;

/**
 * Re-mapping hygiene (spec): when the review queue moves a card OFF a product,
 * clear the old product's identity metadata IF it belongs to this card —
 * stale SKU/rtt_card_key that outlives a mapping is how duplicate SKUs are born.
 * Reads live Shopify state (mirror may be stale), then clears + updates mirror.
 */
export async function clearStaleIdentity(oldProductId: string, cardKey: string): Promise<{
  clearedSku: boolean; clearedMetafield: boolean; mock: boolean;
}> {
  await requireYtgPermission();
  const productGid = `gid://shopify/Product/${oldProductId}`;
  const expectedSku = skuFromCardKey(cardKey);

  if (process.env.SHOPIFY_WRITE_MOCK === '1') {
    return { clearedSku: false, clearedMetafield: false, mock: true };
  }

  const token = await getShopifyAccessToken();
  const data = await shopifyGraphQL<{
    product: {
      id: string;
      metafield: { id: string; value: string } | null;
      variants: { nodes: { id: string; inventoryItem: { sku: string | null } | null }[] };
    } | null;
  }>(token, STALE_IDENTITY_QUERY, { id: productGid });

  const product = data.product;
  if (!product) return { clearedSku: false, clearedMetafield: false, mock: false };

  let clearedSku = false;
  let clearedMetafield = false;

  const variant = product.variants.nodes[0];
  if (expectedSku !== null && variant && variant.inventoryItem && variant.inventoryItem.sku === expectedSku) {
    // 2026-07: InventoryItemInput.sku is a nullable String — null is the documented
    // "clear" value. If Shopify rejects null with a userError, fall back to "":
    // an empty-string SKU renders as no SKU in Admin and can never collide with a
    // cardSku (those always contain "<set>-"). Decision recorded here on purpose.
    let result = await shopifyGraphQL<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(
      token, VARIANT_SKU_CLEAR_MUTATION,
      { productId: productGid, variants: [{ id: variant.id, inventoryItem: { sku: null } }] },
    );
    if (result.productVariantsBulkUpdate.userErrors.length > 0) {
      result = await shopifyGraphQL<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(
        token, VARIANT_SKU_CLEAR_MUTATION,
        { productId: productGid, variants: [{ id: variant.id, inventoryItem: { sku: '' } }] },
      );
    }
    clearedSku = result.productVariantsBulkUpdate.userErrors.length === 0;
    if (clearedSku) {
      await getSupabaseAdmin().from('shopify_products').update({ sku: null }).eq('id', oldProductId);
    }
  }

  if (product.metafield && product.metafield.value === cardKey) {
    const del = await shopifyGraphQL<{ metafieldsDelete: { userErrors: { message: string }[] } }>(
      token, METAFIELDS_DELETE_MUTATION,
      { metafields: [{ ownerId: productGid, namespace: 'custom', key: 'rtt_card_key' }] },
    );
    clearedMetafield = del.metafieldsDelete.userErrors.length === 0;
  }

  return { clearedSku, clearedMetafield, mock: false };
}

export async function searchSingleProducts(q: string): Promise<{
  id: string; title: string; handle: string; price: number | null; tags: string | null; sku: string | null;
}[]> {
  await requireYtgPermission();
  const term = q.trim().replace(/[%_]/g, ' ');
  if (term.length < 2) return [];
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('shopify_products')
    .select('id, title, handle, price, tags, sku')
    // REQUIRED: nothing else enforces the Single filter on this new path —
    // without it "Pick different" could map a card to a deck product.
    .eq('product_type', 'Single')
    .ilike('title', `%${term}%`)
    .order('title')
    .limit(20);
  if (error) throw new Error(`searchSingleProducts: ${error.message}`);
  return data ?? [];
}
