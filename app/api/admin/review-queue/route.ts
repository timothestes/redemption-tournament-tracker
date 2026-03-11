import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';

export async function GET() {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('card_price_mappings')
    .select(`
      *,
      shopify_products (
        id,
        title,
        handle,
        tags,
        price,
        inventory_quantity
      )
    `)
    .eq('status', 'needs_review')
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}
