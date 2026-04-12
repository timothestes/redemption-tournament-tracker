import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import type { PricesResponse } from '@/lib/pricing/types';

export const revalidate = 86400; // 1 day

export async function GET() {
  const supabase = getSupabaseAdmin();

  // Paginate to get all rows (Supabase defaults to 1000 max per query)
  const allData: any[] = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('card_prices')
      .select('card_key, price, shopify_handle, shopify_title, updated_at')
      .range(offset, offset + pageSize - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    allData.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }

  const prices: PricesResponse['prices'] = {};
  let latestUpdate = '';

  for (const row of allData) {
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
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
    },
  });
}
