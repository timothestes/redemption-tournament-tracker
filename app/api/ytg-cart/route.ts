import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
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
  /** Human-readable explanation of why matching failed */
  debug?: string;
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
  shopify_title: string;
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
  | { found: false; reason: 'no_carddata' | 'no_group' | 'no_equivalents' | 'all_sold_out'; debug: string };

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
    return { found: false, reason: 'no_carddata', debug: `Card key "${cardKey}" not found in card database` };
  }

  // Find the duplicate group
  const group = findGroup(sourceCard.name, dupIndex);
  if (!group) {
    return { found: false, reason: 'no_group', debug: `No duplicate group for "${sourceCard.name}" — only one printing exists, budget substitute not possible` };
  }

  // Collect normalized names of all group members.
  // Use multiple levels of stripping to handle multi-bracket names like
  // Lost Souls: 'Lost Soul "Prosperity" [Deuteronomy 30:15] [2024 - 3rd Place]'
  // → strip once: 'Lost Soul "Prosperity" [Deuteronomy 30:15]'
  // → strip all brackets: 'Lost Soul "Prosperity"'
  const memberNormalized = new Set<string>();
  for (const member of group.members) {
    memberNormalized.add(normalize(member.cardName));
    const stripped = stripSetSuffix(member.cardName);
    memberNormalized.add(normalize(stripped));
    // Also strip ALL trailing brackets/parens for multi-bracket names
    const fullyStripped = stripped.replace(/(\s*\[[^\]]+\]|\s+\([^)]+\))+\s*$/, '').trim();
    if (fullyStripped) memberNormalized.add(normalize(fullyStripped));
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
    // Build detailed debug listing each equivalent and its status
    const equivDetails = equivalents.map(e => {
      const info = cardLookup.get(e.card_key);
      if (!info) return `${e.name}: no price mapping`;
      const live = liveInventory?.get(info.shopify_product_id);
      const stock = live?.tracked ? `${live.inventory} in stock` : 'untracked';
      return `${e.name}: $${info.price.toFixed(2)} (${stock})`;
    }).join('; ');
    const abilityRejected = candidates.length - equivalents.length;
    const debug = hadPricedButSoldOut
      ? `All priced equivalents sold out. Equivalents: [${equivDetails}]`
      : `No priced equivalents. ${abilityRejected > 0 ? `${abilityRejected} candidates rejected (different ability). ` : ''}Equivalents: [${equivDetails}]`;
    return { found: false, reason, debug };
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

    // Check if current user is admin (for debug info)
    let isAdmin = false;
    try {
      const userSupabase = await createClient();
      const { data } = await userSupabase.rpc('check_admin_role');
      isAdmin = !!data;
    } catch { /* not logged in or RPC fails — not admin */ }

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
        shopify_title: product.raw_json?.title || '',
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

        // Collect normalized names of all group members (multi-level stripping
        // for cards with multiple bracket suffixes, e.g. Lost Souls)
        const memberNormalized = new Set<string>();
        for (const member of group.members) {
          memberNormalized.add(normalize(member.cardName));
          const stripped = stripSetSuffix(member.cardName);
          memberNormalized.add(normalize(stripped));
          const fullyStripped = stripped.replace(/(\s*\[[^\]]+\]|\s+\([^)]+\))+\s*$/, '').trim();
          if (fullyStripped) memberNormalized.add(normalize(fullyStripped));
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
            shopify_title: product.raw_json?.title || '',
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
    }

    for (const card of orderedCards) {
      let budgetDebug: string | undefined;

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
            // Guard: never substitute UP to a more expensive version in budget mode.
            // If the original card has a known, non-zero price and the substitute costs more,
            // treat this unit as sold out rather than silently adding an expensive card.
            // Skip the guard when original price is $0 — that means the product is
            // unavailable/delisted, not actually free.
            const originalInfo = cardLookup.get(card.card_key);
            if (originalInfo && originalInfo.price > 0 && substitute.card_key !== card.card_key && substitute.price > originalInfo.price) {
              budgetDebug ??= `Cheapest equivalent is ${substitute.card_name} at $${substitute.price.toFixed(2)}, more expensive than original $${originalInfo.price.toFixed(2)}`;
              soldOutQty += 1;
              continue;
            }

            // Record allocation in usedInventory
            const pid = substitute.shopify_product_id;
            usedInventory.set(pid, (usedInventory.get(pid) ?? 0) + 1);

            const key = substitute.variant_id;
            const existing = allocations.get(key);
            if (existing) {
              existing.quantity += 1;
            } else {
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
            budgetDebug ??= 'debug' in substitute ? substitute.debug : undefined;
            soldOutQty += 1;
          }
        }

        // Emit matched entries from allocations
        for (const alloc of allocations.values()) {
          const { shopify_product_id: _pid, ...matchedCard } = alloc;
          matched.push(matchedCard);
          cartParts.push(`${alloc.variant_id}:${alloc.quantity}`);
        }

        // If we matched at least some units, emit any remaining as sold out and skip
        if (allocations.size > 0) {
          if (soldOutQty > 0) {
            const alt = findCheaperAlternative(card.card_key, cardData, cardNameIndex, dupIndex, nonYtgPrices);
            unmatched.push({
              card_name: card.card_name,
              card_key: card.card_key,
              quantity: soldOutQty,
              reason: 'sold_out',
              debug: budgetDebug,
              ...(alt && { cheaper_alternative: alt }),
            });
          }
          continue;
        }

        // ALL units failed budget substitution. If the card has a direct price mapping,
        // fall through to regular matching — this handles cards without a duplicate group
        // that still have valid Shopify listings.
        if (soldOutQty > 0 && cardLookup.has(card.card_key)) {
          // Don't emit sold-out; let regular matching handle it below
        } else if (soldOutQty > 0) {
          const alt = findCheaperAlternative(card.card_key, cardData, cardNameIndex, dupIndex, nonYtgPrices);
          unmatched.push({
            card_name: card.card_name,
            card_key: card.card_key,
            quantity: soldOutQty,
            reason: 'sold_out',
            debug: budgetDebug,
            ...(alt && { cheaper_alternative: alt }),
          });
          continue;
        }
      }

      // Regular matching (exact mode, or budget mode fallback)
      const budgetFallthrough = useBudget && dupIndex && cardNameIndex;
      const info = cardLookup.get(card.card_key);
      if (!info) {
        const alt = budgetFallthrough
          ? findCheaperAlternative(card.card_key, cardData, cardNameIndex, dupIndex, nonYtgPrices)
          : undefined;
        unmatched.push({
          card_name: card.card_name,
          card_key: card.card_key,
          quantity: card.quantity,
          reason: 'no_match',
          debug: `No price mapping for key "${card.card_key}"`,
          ...(alt && { cheaper_alternative: alt }),
        });
        continue;
      }

      // Check live inventory if available
      if (liveInventory) {
        const live = liveInventory.get(info.shopify_product_id);
        if (live && live.tracked && live.inventory <= 0 && !live.continuesSelling) {
          const prefix = budgetFallthrough ? '[budget had no alternatives] ' : '';
          unmatched.push({
            card_name: card.card_name,
            card_key: card.card_key,
            quantity: card.quantity,
            reason: 'sold_out',
            debug: `${prefix}"${info.shopify_title}" sold out ($${info.price.toFixed(2)}, 0 inventory)${budgetDebug ? `. Budget: ${budgetDebug}` : ''}`,
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

    // Strip debug info for non-admin users
    const sanitizedUnmatched = isAdmin
      ? unmatched
      : unmatched.map(({ debug: _, ...rest }) => rest);

    const result: CartResult = {
      cartUrl,
      matched,
      unmatched: sanitizedUnmatched,
      matchedTotal: matched.reduce((sum, m) => sum + m.quantity, 0),
      unmatchedTotal: unmatched.reduce((sum, u) => sum + u.quantity, 0),
    };

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: 'Failed to build cart' }, { status: 500 });
  }
}
