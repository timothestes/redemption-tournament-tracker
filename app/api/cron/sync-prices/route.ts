import { NextRequest, NextResponse } from 'next/server';
import { syncShopifyProducts } from '@/lib/pricing/syncShopifyProducts';
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
    // 1. Sync Shopify products (singles + deck types; sku/body_html mirrored)
    console.log('[cron] Syncing Shopify products...');
    const { upserted, errors: syncErrors } = await syncShopifyProducts();
    console.log(`[cron] Synced ${upserted} Shopify products (${syncErrors} upsert errors)`);

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
    return NextResponse.json({ success: true, shopify_synced: upserted, matching: summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron] Price sync failed:', message);
    await sendCronAlert('Price Sync', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
