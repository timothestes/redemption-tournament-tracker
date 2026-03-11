import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import { getShopifyAccessToken, fetchAllShopifyProducts } from '@/lib/pricing/shopify';

export async function POST() {
  try {
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

    // Upsert in batches
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

    return NextResponse.json({ synced, total: products.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
