import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import { getShopifyAccessToken, fetchProductInventory } from '@/lib/pricing/shopify';
import { loadCardData, buildDuplicateGroupIndex } from '@/lib/pricing/matching';
import { findGroup, normalize, stripSetSuffix } from '@/lib/duplicateCards';
import type { DuplicateGroupIndex } from '@/lib/duplicateCards';
import { normalizeAbility } from '@/lib/pricing/budgetPricing';
import type { CardRow } from '@/lib/pricing/types';

// ---------------------------------------------------------------------------
// Module-level cache (1-hour TTL)
// ---------------------------------------------------------------------------

let cachedCardData: CardRow[] | null = null;
let cachedDupIndex: DuplicateGroupIndex | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getCachedData(): Promise<{ cardData: CardRow[]; dupIndex: DuplicateGroupIndex }> {
  const now = Date.now();
  if (cachedCardData && cachedDupIndex && (now - cacheTimestamp) < CACHE_TTL) {
    return { cardData: cachedCardData, dupIndex: cachedDupIndex };
  }

  const [cardData, dupIndex] = await Promise.all([
    loadCardData(),
    buildDuplicateGroupIndex(),
  ]);

  cachedCardData = cardData;
  cachedDupIndex = dupIndex;
  cacheTimestamp = now;

  return { cardData, dupIndex };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  variant_id: string;
  original_card_name?: string;
  original_card_key?: string;
  original_price?: number;
  /** When a cheaper version exists on another store (e.g. Fundraiser) */
  cheaper_alternative?: {
    card_name: string;
    price: number;
    source: string;
  };
}

interface UnmatchedCard {
  card_name: string;
  card_key: string;
  quantity: number;
  reason: 'no_match' | 'sold_out';
  /** When a cheaper version exists on another store (e.g. Fundraiser) */
  cheaper_alternative?: {
    card_name: string;
    price: number;
    source: string; // e.g. "Fundraiser"
  };
}

interface CartResult {
  cartUrl: string | null;
  matched: MatchedCard[];
  unmatched: UnmatchedCard[];
  matchedTotal: number;
  unmatchedTotal: number;
}

type CardLookupEntry = {
  shopify_product_id: string;
  cached_variant_id: string;
  price: number;
};

// ---------------------------------------------------------------------------
// Budget substitute helper
// ---------------------------------------------------------------------------

/**
 * Build a card name index from CardRow[] for O(1) lookups by normalized name.
 */
function buildCardRowNameIndex(cardData: CardRow[]): Map<string, CardRow[]> {
  const index = new Map<string, CardRow[]>();
  for (const row of cardData) {
    const baseKey = normalize(stripSetSuffix(row.name));
    const bucket = index.get(baseKey);
    if (bucket) {
      bucket.push(row);
    } else {
      index.set(baseKey, [row]);
    }
    // Also index by full normalized name
    const fullKey = normalize(row.name);
    if (fullKey !== baseKey) {
      const fullBucket = index.get(fullKey);
      if (fullBucket) {
        fullBucket.push(row);
      } else {
        index.set(fullKey, [row]);
      }
    }
  }
  return index;
}

type BudgetSubstituteResult =
  | { found: true; card_key: string; card_name: string; price: number; variant_id: string; shopify_product_id: string }
  | { found: false; reason: 'no_carddata' | 'no_group' | 'no_equivalents' | 'all_sold_out' };

/**
 * Find the cheapest in-stock equivalent for a card from its duplicate group.
 * `usedInventory` tracks how many units of each shopify_product_id have already
 * been allocated in this cart build, so we don't over-allocate beyond stock.
 */
function findBudgetSubstitute(
  cardKey: string,
  cardData: CardRow[],
  cardNameIndex: Map<string, CardRow[]>,
  dupIndex: DuplicateGroupIndex,
  cardLookup: Map<string, CardLookupEntry>,
  liveInventory: Map<string, { variantId: string; inventory: number; tracked: boolean; continuesSelling: boolean }> | null,
  usedInventory: Map<string, number>,
  quantity: number = 1,
): BudgetSubstituteResult {
  // Find the source card in carddata to get its special ability
  const sourceCard = cardData.find(c => c.card_key === cardKey);
  if (!sourceCard) {
    console.warn(`[ytg-cart] Budget: no carddata match for key "${cardKey}"`);
    return { found: false, reason: 'no_carddata' };
  }

  // Find the duplicate group
  const group = findGroup(sourceCard.name, dupIndex);
  if (!group) {
    console.warn(`[ytg-cart] Budget: no duplicate group for "${sourceCard.name}"`);
    return { found: false, reason: 'no_group' };
  }

  // Collect normalized names of all group members
  const memberNormalized = new Set<string>();
  for (const member of group.members) {
    memberNormalized.add(normalize(member.cardName));
    memberNormalized.add(normalize(stripSetSuffix(member.cardName)));
  }

  // Gather candidate CardRows from the name index
  const seen = new Set<string>();
  const candidates: CardRow[] = [];
  for (const normName of memberNormalized) {
    const bucket = cardNameIndex.get(normName);
    if (bucket) {
      for (const c of bucket) {
        if (!seen.has(c.card_key)) {
          seen.add(c.card_key);
          candidates.push(c);
        }
      }
    }
  }

  // Filter to candidates with matching ability text
  const targetAbility = normalizeAbility(sourceCard.special_ability);
  const equivalents = candidates.filter(
    c => normalizeAbility(c.special_ability) === targetAbility
  );

  // Build a list of priced, in-stock equivalents sorted by price ascending
  const pricedEquivalents: { card_key: string; card_name: string; price: number; variant_id: string; shopify_product_id: string; remainingStock: number }[] = [];
  let hadPricedButSoldOut = false;

  for (const equiv of equivalents) {
    const info = cardLookup.get(equiv.card_key);
    if (!info || info.price <= 0) continue;

    // Determine variant_id (prefer live if available)
    let variantId = info.cached_variant_id;
    let remainingStock = Infinity; // assume unlimited if not tracked
    if (liveInventory) {
      const live = liveInventory.get(info.shopify_product_id);
      if (live) {
        variantId = live.variantId;
        if (live.tracked && !live.continuesSelling) {
          const used = usedInventory.get(info.shopify_product_id) ?? 0;
          remainingStock = live.inventory - used;
          if (remainingStock <= 0) {
            hadPricedButSoldOut = true;
            continue;
          }
        }
      }
    }

    pricedEquivalents.push({
      card_key: equiv.card_key,
      card_name: equiv.name,
      price: info.price,
      variant_id: variantId,
      shopify_product_id: info.shopify_product_id,
      remainingStock,
    });
  }

  if (pricedEquivalents.length === 0) {
    const reason = hadPricedButSoldOut ? 'all_sold_out' : 'no_equivalents';
    console.warn(`[ytg-cart] Budget: ${reason} for "${cardKey}" (candidates: ${candidates.length}, ability-matched: ${equivalents.length}, in cardLookup: ${equivalents.filter(e => cardLookup.has(e.card_key)).length})`);
    return { found: false, reason };
  }

  // Sort by price ascending, return cheapest
  pricedEquivalents.sort((a, b) => a.price - b.price);
  const best = pricedEquivalents[0];
  return {
    found: true,
    card_key: best.card_key,
    card_name: best.card_name,
    price: best.price,
    variant_id: best.variant_id,
    shopify_product_id: best.shopify_product_id,
  };
}

/**
 * Find the cheapest non-YTG alternative (e.g. Fundraiser) for a card.
 */
function findCheaperAlternative(
  cardKey: string,
  cardData: CardRow[],
  cardNameIndex: Map<string, CardRow[]>,
  dupIndex: DuplicateGroupIndex,
  nonYtgPrices: Map<string, { price: number; source: string }>,
): UnmatchedCard['cheaper_alternative'] | undefined {
  const sourceCard = cardData.find(c => c.card_key === cardKey);
  if (!sourceCard) return undefined;

  const group = findGroup(sourceCard.name, dupIndex);
  if (!group) return undefined;

  const targetAbility = normalizeAbility(sourceCard.special_ability);
  const memberNormalized = new Set<string>();
  for (const member of group.members) {
    memberNormalized.add(normalize(member.cardName));
    memberNormalized.add(normalize(stripSetSuffix(member.cardName)));
  }

  // Find ability-matched candidates
  const seen = new Set<string>();
  let cheapest: { card_name: string; price: number; source: string } | undefined;

  for (const normName of memberNormalized) {
    const bucket = cardNameIndex.get(normName);
    if (!bucket) continue;
    for (const c of bucket) {
      if (seen.has(c.card_key)) continue;
      seen.add(c.card_key);
      if (normalizeAbility(c.special_ability) !== targetAbility) continue;

      const alt = nonYtgPrices.get(c.card_key);
      if (alt && (!cheapest || alt.price < cheapest.price)) {
        cheapest = { card_name: c.name, price: alt.price, source: alt.source };
      }
    }
  }

  return cheapest;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const cards: CartItem[] = body.cards;
    const useBudget: boolean = body.useBudget === true;

    if (!cards || !Array.isArray(cards) || cards.length === 0) {
      return NextResponse.json({ error: 'No cards provided' }, { status: 400 });
    }

    if (cards.length > 200) {
      return NextResponse.json({ error: 'Too many cards (max 200)' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Normalize card_keys: strip .jpg/.jpeg extension from the img_file segment.
    // Decks created before img_file normalization may store keys like "...|017-Lost-Soul-Hopper.jpg"
    // while carddata and card_price_mappings use "...|017-Lost-Soul-Hopper".
    for (const card of cards) {
      card.card_key = card.card_key.replace(/\.jpe?g$/i, '');
    }

    const cardKeys = cards.map(c => String(c.card_key).slice(0, 200));

    // Step 1: Query card_price_mappings for the requested card_keys
    // PostgREST's .in() breaks on values containing double quotes (e.g. Lost Soul "Orphans"),
    // so we split: keys without quotes go through batched .in(), keys with quotes use individual .eq()
    const MAPPING_SELECT = `card_key, shopify_product_id, shopify_products!inner (id, price, raw_json)`;
    const safeKeys = cardKeys.filter(k => !k.includes('"'));
    const quotedKeys = cardKeys.filter(k => k.includes('"'));

    const allMappings: any[] = [];

    // Batch query for safe keys (no double quotes)
    const CHUNK_SIZE = 40;
    for (let i = 0; i < safeKeys.length; i += CHUNK_SIZE) {
      const chunk = safeKeys.slice(i, i + CHUNK_SIZE);
      const { data, error } = await supabase
        .from('card_price_mappings')
        .select(MAPPING_SELECT)
        .in('card_key', chunk)
        .not('shopify_product_id', 'is', null);

      if (error) {
        console.error('[ytg-cart] DB query failed:', error.message);
        return NextResponse.json({ error: 'Failed to look up cards' }, { status: 500 });
      }
      allMappings.push(...(data ?? []));
    }

    // Individual .eq() queries for keys containing double quotes
    // (PostgREST .in() mangles double quotes in URL encoding)
    if (quotedKeys.length > 0) {
      const results = await Promise.all(
        quotedKeys.map(key =>
          supabase
            .from('card_price_mappings')
            .select(MAPPING_SELECT)
            .eq('card_key', key)
            .not('shopify_product_id', 'is', null)
            .maybeSingle()
        )
      );
      for (const { data } of results) {
        if (data) allMappings.push(data);
      }
    }

    // Build lookup: card_key -> { shopify_product_id, cached_variant_id, price }
    const cardLookup = new Map<string, CardLookupEntry>();

    for (const mapping of allMappings) {
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

    // Step 2: If budget mode, expand cardLookup with sibling card_keys
    let cardData: CardRow[] = [];
    let dupIndex: DuplicateGroupIndex | null = null;
    let cardNameIndex: Map<string, CardRow[]> | null = null;

    // Non-YTG prices (e.g. Fundraiser cards) — loaded for budget mode to show cheaper alternatives
    let nonYtgPrices = new Map<string, { price: number; source: string }>();

    if (useBudget) {
      const cached = await getCachedData();
      cardData = cached.cardData;
      dupIndex = cached.dupIndex;
      cardNameIndex = buildCardRowNameIndex(cardData);

      // Load card_prices entries that have no shopify_handle (Fundraiser, etc.)
      const { data: nonYtgRows } = await supabase
        .from('card_prices')
        .select('card_key, price, shopify_title')
        .is('shopify_handle', null);
      for (const row of (nonYtgRows ?? [])) {
        nonYtgPrices.set(row.card_key, {
          price: parseFloat(row.price),
          source: row.shopify_title || 'Other Store',
        });
      }

      // For each requested card, find its duplicate group and collect all sibling card_keys
      const siblingCardKeys = new Set<string>();

      for (const card of cards) {
        // Find the source card in carddata
        const sourceCard = cardData.find(c => c.card_key === card.card_key);
        if (!sourceCard) continue;

        const group = findGroup(sourceCard.name, dupIndex);
        if (!group) continue;

        // Collect normalized names of all group members
        const memberNormalized = new Set<string>();
        for (const member of group.members) {
          memberNormalized.add(normalize(member.cardName));
          memberNormalized.add(normalize(stripSetSuffix(member.cardName)));
        }

        // Find all CardRows matching those names
        for (const normName of memberNormalized) {
          const bucket = cardNameIndex.get(normName);
          if (bucket) {
            for (const c of bucket) {
              if (!cardLookup.has(c.card_key)) {
                siblingCardKeys.add(c.card_key);
              }
            }
          }
        }
      }

      // Batch-query card_price_mappings for all sibling card_keys
      if (siblingCardKeys.size > 0) {
        const siblingKeysArr = [...siblingCardKeys];
        const safeSiblings = siblingKeysArr.filter(k => !k.includes('"'));
        const quotedSiblings = siblingKeysArr.filter(k => k.includes('"'));

        // Batch .in() for safe keys
        for (let i = 0; i < safeSiblings.length; i += 500) {
          const chunk = safeSiblings.slice(i, i + 500);
          const { data: siblingMappings, error: sibErr } = await supabase
            .from('card_price_mappings')
            .select(MAPPING_SELECT)
            .in('card_key', chunk)
            .not('shopify_product_id', 'is', null);

          if (sibErr) {
            console.warn('[ytg-cart] Sibling query failed:', sibErr.message);
            continue;
          }
          allMappings.push(...(siblingMappings ?? []));
        }

        // Individual .eq() for quoted keys
        if (quotedSiblings.length > 0) {
          const results = await Promise.all(
            quotedSiblings.map(key =>
              supabase
                .from('card_price_mappings')
                .select(MAPPING_SELECT)
                .eq('card_key', key)
                .not('shopify_product_id', 'is', null)
                .maybeSingle()
            )
          );
          for (const { data } of results) {
            if (data) allMappings.push(data);
          }
        }

        // Process all sibling mappings into cardLookup
        for (const mapping of allMappings.filter(m => siblingCardKeys.has(m.card_key))) {
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
      }
    }

    // Step 3: Collect productIds from the FULL cardLookup (original + siblings)
    const productIds = [...new Set(
      Array.from(cardLookup.values()).map(v => v.shopify_product_id)
    )];

    // Step 4: Real-time inventory check via Shopify Admin API
    let liveInventory: Map<string, { variantId: string; inventory: number; tracked: boolean; continuesSelling: boolean }> | null = null;
    try {
      const token = await getShopifyAccessToken();
      liveInventory = await fetchProductInventory(token, productIds);
    } catch {
      // If live check fails, fall back to cached data (no filtering)
      console.warn('[ytg-cart] Live inventory check failed, using cached data');
    }

    // Step 5: Build matched / unmatched / sold-out lists
    const matched: MatchedCard[] = [];
    const unmatched: UnmatchedCard[] = [];
    const cartParts: string[] = [];
    // Track how many units of each Shopify product we've allocated to the cart,
    // so we don't over-allocate beyond available inventory.
    const usedInventory = new Map<string, number>();

    // In budget mode, sort cards so those with an exact YTG match come first.
    // This prevents substitute-only cards (e.g. Fundraiser with no Shopify mapping)
    // from consuming inventory that should go to cards with a direct match.
    const orderedCards = useBudget
      ? [...cards].sort((a, b) => {
          const aHas = cardLookup.has(a.card_key) ? 0 : 1;
          const bHas = cardLookup.has(b.card_key) ? 0 : 1;
          return aHas - bHas;
        })
      : cards;

    if (useBudget) {
      console.log(`[ytg-cart] Budget order: ${orderedCards.map(c => `${c.card_name} (inLookup=${cardLookup.has(c.card_key)})`).join(' → ')}`);
    }

    for (const card of orderedCards) {
      // Budget mode: allocate unit-by-unit to respect per-product inventory limits.
      // For a card with quantity N, we call findBudgetSubstitute N times, each time
      // picking the cheapest in-stock equivalent that still has remaining inventory.
      if (useBudget && dupIndex && cardNameIndex) {
        // Accumulate allocations: variant_id → { ...details, qty }
        const allocations = new Map<string, MatchedCard & { shopify_product_id: string }>();
        let soldOutQty = 0;

        for (let i = 0; i < card.quantity; i++) {
          const substitute = findBudgetSubstitute(
            card.card_key,
            cardData,
            cardNameIndex,
            dupIndex,
            cardLookup,
            liveInventory,
            usedInventory,
          );

          if (substitute.found) {
            // Record allocation in usedInventory
            const pid = substitute.shopify_product_id;
            usedInventory.set(pid, (usedInventory.get(pid) ?? 0) + 1);

            const key = substitute.variant_id;
            const existing = allocations.get(key);
            if (existing) {
              existing.quantity += 1;
            } else {
              const originalInfo = cardLookup.get(card.card_key);
              const isSubstitution = substitute.card_key !== card.card_key;

              const matchedCard: MatchedCard & { shopify_product_id: string } = {
                card_name: substitute.card_name,
                card_key: substitute.card_key,
                quantity: 1,
                price: substitute.price,
                variant_id: substitute.variant_id,
                shopify_product_id: pid,
              };

              // Show substitution info: either with savings amount (when we know original price)
              // or just the original name (for cards without a YTG listing, like Fundraiser)
              if (isSubstitution) {
                matchedCard.original_card_name = card.card_name;
                matchedCard.original_card_key = card.card_key;
                if (originalInfo && substitute.price < originalInfo.price) {
                  matchedCard.original_price = originalInfo.price;
                }
              }

              // Check if there's an even cheaper non-YTG alternative (e.g. Fundraiser)
              const alt = findCheaperAlternative(card.card_key, cardData, cardNameIndex, dupIndex, nonYtgPrices);
              if (alt && alt.price < substitute.price) {
                matchedCard.cheaper_alternative = alt;
              }

              allocations.set(key, matchedCard);
            }
          } else {
            soldOutQty += 1;
          }
        }

        // Emit matched entries from allocations
        for (const alloc of allocations.values()) {
          const { shopify_product_id: _pid, ...matchedCard } = alloc;
          matched.push(matchedCard);
          cartParts.push(`${alloc.variant_id}:${alloc.quantity}`);
        }

        // Emit unmatched for any units that couldn't be allocated
        if (soldOutQty > 0) {
          const alt = findCheaperAlternative(card.card_key, cardData, cardNameIndex, dupIndex, nonYtgPrices);
          unmatched.push({
            card_name: card.card_name,
            card_key: card.card_key,
            quantity: soldOutQty,
            reason: 'sold_out',
            ...(alt && { cheaper_alternative: alt }),
          });
        }

        // If we matched at least some units (or all were sold out), skip regular matching
        if (allocations.size > 0 || soldOutQty > 0) continue;
        // Otherwise fall through to regular matching below
      }

      // Regular matching (exact mode, or budget mode fallback)
      const info = cardLookup.get(card.card_key);
      if (!info) {
        const alt = useBudget && dupIndex && cardNameIndex
          ? findCheaperAlternative(card.card_key, cardData, cardNameIndex, dupIndex, nonYtgPrices)
          : undefined;
        unmatched.push({
          card_name: card.card_name,
          card_key: card.card_key,
          quantity: card.quantity,
          reason: 'no_match',
          ...(alt && { cheaper_alternative: alt }),
        });
        continue;
      }

      // Check live inventory if available
      if (liveInventory) {
        const live = liveInventory.get(info.shopify_product_id);
        if (live && live.tracked && live.inventory <= 0 && !live.continuesSelling) {
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
        variant_id: info.cached_variant_id,
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
