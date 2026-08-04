import { NextResponse } from 'next/server';
import { hasPermission } from '@/utils/adminUtils';
import { syncShopifyProducts } from '@/lib/pricing/syncShopifyProducts';

// The multi-type sync (singles + three deck types) is several paginated
// REST passes with rate-limit pauses — give it the same budget as the cron.
export const maxDuration = 300;

export async function POST() {
  if (!(await hasPermission('manage_shopify_imports'))) {
    return NextResponse.json({ error: 'Shopify import permission required' }, { status: 403 });
  }
  try {
    const { upserted, errors } = await syncShopifyProducts();
    return NextResponse.json({ synced: upserted, errors });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
