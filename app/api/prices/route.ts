import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import type { PricesResponse } from '@/lib/pricing/types';

export const revalidate = 604800; // 1 week

export async function GET() {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('card_prices')
    .select('card_key, price, shopify_handle, shopify_title, updated_at');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const prices: PricesResponse['prices'] = {};
  let latestUpdate = '';

  for (const row of data ?? []) {
    prices[row.card_key] = {
      price: parseFloat(row.price),
      shopify_handle: row.shopify_handle,
      shopify_title: row.shopify_title,
    };
    if (row.updated_at > latestUpdate) latestUpdate = row.updated_at;
  }

  const response: PricesResponse = {
    updated_at: latestUpdate || new Date().toISOString(),
    prices,
  };

  return NextResponse.json(response, {
    headers: {
      'Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=86400',
    },
  });
}
