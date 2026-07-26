/**
 * Sync Shopify products into the `shopify_products` mirror table.
 *
 * Extracted from the sync body duplicated in app/api/admin/sync-shopify/route.ts
 * and the cron job, so importSet's post-import reconcile step can reuse it
 * without an HTTP round-trip. Those two call sites are left as-is.
 */

import { getSupabaseAdmin } from './supabase-admin';
import { getShopifyAccessToken, fetchAllShopifyProducts } from './shopify';

export async function syncShopifyProducts(): Promise<number> {
  const token = await getShopifyAccessToken();
  const products = await fetchAllShopifyProducts(token, 'Single');

  const supabase = getSupabaseAdmin();
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
      raw_json: p,
      last_synced_at: new Date().toISOString(),
    };
  });

  let synced = 0;
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from('shopify_products')
      .upsert(batch, { onConflict: 'id' });
    if (error) {
      console.error(`Sync batch error:`, error.message);
    } else {
      synced += batch.length;
    }
  }

  return synced;
}
