import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import { regenerateCardPrices } from '@/lib/pricing/matching';

export async function POST(request: NextRequest) {
  try {
    const { card_key, shopify_product_id } = await request.json();
    if (!card_key || !shopify_product_id) {
      return NextResponse.json(
        { error: 'card_key and shopify_product_id are required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from('card_price_mappings')
      .update({
        shopify_product_id,
        status: 'manual',
        reviewed_by: 'admin',
        match_method: 'manual',
        updated_at: new Date().toISOString(),
      })
      .eq('card_key', card_key);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Regenerate the card_prices table
    await regenerateCardPrices();

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
