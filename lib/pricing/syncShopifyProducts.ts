/**
 * Sync Shopify products into the `shopify_products` mirror table.
 *
 * The single shared sync implementation. Callers:
 *  - app/api/admin/sync-shopify/route.ts  (manual admin trigger)
 *  - app/api/cron/sync-prices/route.ts    (nightly cron)
 *  - lib/shopify/importSet.ts             (post-import reconcile)
 *
 * Fetches singles plus the three deck product types — one paginated REST
 * pass per type, because fetchAllShopifyProducts takes a single
 * product_type value — and mirrors `sku` (variants[0].sku) + `body_html`
 * for the matching pass 0 and deck tooling (migration 088 columns).
 * Per-row upsert on `id` means the extra type passes never churn singles'
 * last_synced_at.
 */

import { getSupabaseAdmin } from './supabase-admin';
import { getShopifyAccessToken, fetchAllShopifyProducts } from './shopify';
import { DECK_PRODUCT_TYPES } from '@/lib/ytg/constants';

const SYNCED_PRODUCT_TYPES: string[] = ['Single', ...DECK_PRODUCT_TYPES];

export async function syncShopifyProducts(): Promise<{ upserted: number; errors: number }> {
  const token = await getShopifyAccessToken();
  const supabase = getSupabaseAdmin();

  let upserted = 0;
  let errors = 0;

  for (const productType of SYNCED_PRODUCT_TYPES) {
    const products = await fetchAllShopifyProducts(token, productType);

    const rows = products.map(p => {
      const price = Math.min(...p.variants.map(v => parseFloat(v.price)));
      const inventory = p.variants.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0);
      return {
        id: String(p.id),
        title: p.title,
        handle: p.handle,
        tags: p.tags || null,
        product_type: p.product_type,
        price,
        inventory_quantity: inventory,
        // `|| null`, not `?? null`: Shopify returns "" for blank SKUs, and an
        // empty-string sku poisons the 088 partial index + backfill planning
        // (pass 0 and planBackfillRows treat ""/null as "no SKU").
        sku: p.variants[0]?.sku || null,
        body_html: p.body_html ?? null,
        raw_json: p,
        last_synced_at: new Date().toISOString(),
      };
    });

    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase
        .from('shopify_products')
        .upsert(batch, { onConflict: 'id' });
      if (error) {
        // Log and continue — a partial failure must not abort the run.
        // (This is why the health strip reads MIN(last_synced_at), not MAX.)
        console.error(`Sync batch error (${productType}):`, error.message);
        errors += batch.length;
      } else {
        upserted += batch.length;
      }
    }
  }

  return { upserted, errors };
}
