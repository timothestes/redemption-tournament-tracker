import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import { getShopifyAccessToken, fetchProductInventory } from '@/lib/pricing/shopify';

interface CartItem {
  card_key: string;
  quantity: number;
  card_name: string;
}

interface MatchedCard {
  card_name: string;
  card_key: string;
  quantity: number;
  price: number;
}

interface UnmatchedCard {
  card_name: string;
  card_key: string;
  quantity: number;
  reason: 'no_match' | 'sold_out';
}

interface CartResult {
  cartUrl: string | null;
  matched: MatchedCard[];
  unmatched: UnmatchedCard[];
  matchedTotal: number;
  unmatchedTotal: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const cards: CartItem[] = body.cards;

    if (!cards || !Array.isArray(cards) || cards.length === 0) {
      return NextResponse.json({ error: 'No cards provided' }, { status: 400 });
    }

    if (cards.length > 200) {
      return NextResponse.json({ error: 'Too many cards (max 200)' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const cardKeys = cards.map(c => String(c.card_key).slice(0, 200));

    // Query card_price_mappings joined with shopify_products
    const { data: mappings, error } = await supabase
      .from('card_price_mappings')
      .select(`
        card_key,
        shopify_product_id,
        shopify_products!inner (
          id,
          price,
          raw_json
        )
      `)
      .in('card_key', cardKeys)
      .not('shopify_product_id', 'is', null);

    if (error) {
      console.error('[ytg-cart] DB query failed:', error.message);
      return NextResponse.json({ error: 'Failed to look up cards' }, { status: 500 });
    }

    // Build lookup: card_key -> { shopify_product_id, cached_variant_id, price }
    const cardLookup = new Map<string, {
      shopify_product_id: string;
      cached_variant_id: string;
      price: number;
    }>();

    for (const mapping of (mappings ?? [])) {
      const product = mapping.shopify_products;
      if (!product?.raw_json?.variants?.length) continue;

      const variant = product.raw_json.variants[0];
      if (!variant?.id) continue;

      cardLookup.set(mapping.card_key, {
        shopify_product_id: product.id,
        cached_variant_id: String(variant.id),
        price: parseFloat(product.price) || 0,
      });
    }

    // Real-time inventory check via Shopify Admin API
    const productIds = [...new Set(
      Array.from(cardLookup.values()).map(v => v.shopify_product_id)
    )];

    let liveInventory: Map<string, { variantId: string; inventory: number }> | null = null;
    try {
      const token = await getShopifyAccessToken();
      liveInventory = await fetchProductInventory(token, productIds);
    } catch {
      // If live check fails, fall back to cached data (no filtering)
      console.warn('[ytg-cart] Live inventory check failed, using cached data');
    }

    // Build matched / unmatched / sold-out lists
    const matched: MatchedCard[] = [];
    const unmatched: UnmatchedCard[] = [];
    const cartParts: string[] = [];

    for (const card of cards) {
      const info = cardLookup.get(card.card_key);
      if (!info) {
        unmatched.push({
          card_name: card.card_name,
          card_key: card.card_key,
          quantity: card.quantity,
          reason: 'no_match',
        });
        continue;
      }

      // Check live inventory if available
      if (liveInventory) {
        const live = liveInventory.get(info.shopify_product_id);
        if (live && live.inventory <= 0) {
          unmatched.push({
            card_name: card.card_name,
            card_key: card.card_key,
            quantity: card.quantity,
            reason: 'sold_out',
          });
          continue;
        }
        // Use live variant ID if available (in case it changed)
        if (live) {
          info.cached_variant_id = live.variantId;
        }
      }

      matched.push({
        card_name: card.card_name,
        card_key: card.card_key,
        quantity: card.quantity,
        price: info.price,
      });
      cartParts.push(`${info.cached_variant_id}:${card.quantity}`);
    }

    const cartUrl = cartParts.length > 0
      ? `https://www.yourturngames.biz/cart/${cartParts.join(',')}`
      : null;

    const result: CartResult = {
      cartUrl,
      matched,
      unmatched,
      matchedTotal: matched.reduce((sum, m) => sum + m.quantity, 0),
      unmatchedTotal: unmatched.reduce((sum, u) => sum + u.quantity, 0),
    };

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: 'Failed to build cart' }, { status: 500 });
  }
}
