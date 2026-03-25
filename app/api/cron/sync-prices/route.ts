import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import { getShopifyAccessToken, fetchAllShopifyProducts } from '@/lib/pricing/shopify';
import { runMatchingPipeline, regenerateCardPrices, computeCheapestPrices } from '@/lib/pricing/matching';
import { sendCronAlert } from '@/lib/cron/alerts';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Verify this is a legitimate Vercel cron call
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    // 1. Sync Shopify products
    console.log('[cron] Syncing Shopify products...');
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

    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      await supabase.from('shopify_products').upsert(batch, { onConflict: 'id' });
    }
    console.log(`[cron] Synced ${products.length} Shopify products`);

    // 2. Re-run matching passes 1-4 (skips already-confirmed mappings)
    console.log('[cron] Running matching pipeline...');
    const summary = await runMatchingPipeline();
    console.log('[cron] Matching summary:', summary);

    // 3. Regenerate card_prices
    console.log('[cron] Regenerating card_prices...');
    await regenerateCardPrices();

    // 4. Compute cheapest equivalent prices
    console.log('[cron] Computing cheapest prices...');
    await computeCheapestPrices();

    console.log('[cron] Price sync complete');
    return NextResponse.json({ success: true, shopify_synced: products.length, matching: summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron] Price sync failed:', message);
    await sendCronAlert('Price Sync', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
