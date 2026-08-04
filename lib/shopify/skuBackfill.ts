/**
 * Pure planning logic for the one-time SKU/metafield backfill (spec §SKU backfill).
 * IO lives in app/admin/ytg/matching/actions.ts; this module is fully unit-testable.
 */
import { cardSku } from './productFromCard';

export interface BackfillMappingRow {
  card_key: string;
  shopify_product_id: string;
  confidence: number | null;
  match_method: string | null;
  status: string;
}
export interface BackfillProductLite {
  id: string;
  sku: string | null;
  raw_json: { variants?: { id: number | string }[] } | null;
}
export interface BackfillRow {
  productId: string;
  productGid: string;
  variantGid: string;
  cardKey: string;
  sku: string;
}
export interface BackfillSkip { productId: string; cardKey: string; reason: string; }

// Primary-mapping preference: deterministic methods first, then confidence.
const METHOD_RANK: Record<string, number> = { sku: 0, exact: 1, normalized: 2 };
const rank = (m: string | null) => {
  const r = METHOD_RANK[m ?? ''];
  return r === undefined ? 3 : r;
};

export function skuFromCardKey(cardKey: string): string | null {
  const parts = cardKey.split('|');
  if (parts.length !== 3 || parts[1] === '' || parts[2] === '') return null;
  return cardSku({ set: parts[1], imgFile: parts[2] });
}

export function planBackfillRows(
  mappings: BackfillMappingRow[],
  productsById: Map<string, BackfillProductLite>,
  existingSkuOwners: Map<string, string>,
): { toWrite: BackfillRow[]; skippedPermanent: BackfillSkip[]; blocked: BackfillSkip[] } {
  const byProduct = new Map<string, BackfillMappingRow[]>();
  for (const m of mappings) {
    const list = byProduct.get(m.shopify_product_id);
    if (list) list.push(m); else byProduct.set(m.shopify_product_id, [m]);
  }

  const toWrite: BackfillRow[] = [];
  const skippedPermanent: BackfillSkip[] = [];
  const blocked: BackfillSkip[] = [];

  for (const [productId, group] of byProduct) {
    const product = productsById.get(productId);
    if (!product) continue;                                   // ghost mapping — not ours to fix here
    if ((product.sku ?? '').trim() !== '') continue;          // already has a SKU

    const sorted = [...group].sort(
      (a, b) => rank(a.match_method) - rank(b.match_method) || (b.confidence ?? 0) - (a.confidence ?? 0),
    );
    const primary = sorted[0];
    for (const other of sorted.slice(1)) {
      skippedPermanent.push({
        productId, cardKey: other.card_key,
        reason: 'non-primary mapping on a multi-mapped product — permanent by design, not a to-do',
      });
    }

    const sku = skuFromCardKey(primary.card_key);
    if (sku === null) {
      blocked.push({ productId, cardKey: primary.card_key, reason: 'malformed card_key' });
      continue;
    }
    const owner = existingSkuOwners.get(sku);
    if (owner !== undefined && owner !== productId) {
      blocked.push({ productId, cardKey: primary.card_key, reason: `sku already on product ${owner} — resolve that mapping first (duplicate-SKU guard)` });
      continue;
    }
    const variantId = product.raw_json?.variants?.[0]?.id;
    if (variantId === undefined || variantId === null) {
      blocked.push({ productId, cardKey: primary.card_key, reason: 'no variant in raw_json — re-sync products, then re-plan' });
      continue;
    }
    toWrite.push({
      productId,
      productGid: `gid://shopify/Product/${productId}`,
      variantGid: `gid://shopify/ProductVariant/${variantId}`,
      cardKey: primary.card_key,
      sku,
    });
  }
  return { toWrite, skippedPermanent, blocked };
}
