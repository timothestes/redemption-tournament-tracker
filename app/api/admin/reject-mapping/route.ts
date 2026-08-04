import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/utils/adminUtils';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';

export async function POST(request: NextRequest) {
  if (!(await hasPermission('manage_shopify_imports'))) {
    return NextResponse.json({ error: 'Shopify import permission required' }, { status: 403 });
  }
  try {
    const { card_key } = await request.json();
    if (!card_key) {
      return NextResponse.json({ error: 'card_key is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from('card_price_mappings')
      .update({
        shopify_product_id: null,
        status: 'unmatched',
        updated_at: new Date().toISOString(),
      })
      .eq('card_key', card_key);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
