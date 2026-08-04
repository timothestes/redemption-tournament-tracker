import { NextResponse } from 'next/server';
import { hasPermission } from '@/utils/adminUtils';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';

export async function GET() {
  if (!(await hasPermission('manage_shopify_imports'))) {
    return NextResponse.json({ error: 'Shopify import permission required' }, { status: 403 });
  }
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
