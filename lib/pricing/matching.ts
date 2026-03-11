/** Card price matching pipeline — passes 1-4 */

import { getSupabaseAdmin } from './supabase-admin';
import { normalize, stripEmbeddedSet, stripShopifySuffixes, parseShopifyTags, UNSOLD_SETS } from './helpers';
import type { CardRow, SetAlias, ShopifyProductRow, MatchResult, MatchingSummary } from './types';

const CARD_DATA_URL =
  'https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt';

/**
 * Load and parse card data from GitHub.
 */
export async function loadCardData(): Promise<CardRow[]> {
  const res = await fetch(CARD_DATA_URL);
  const text = await res.text();
  const lines = text.split('\n');
  return lines
    .slice(1) // skip header
    .filter(line => line.trim())
    .map(line => {
      const cols = line.split('\t');
      const name = cols[0]?.trim() ?? '';
      const set_code = cols[1]?.trim() ?? '';
      const img_file = cols[2]?.trim() ?? '';
      return {
        name,
        set_code,
        img_file,
        official_set: cols[3]?.trim() ?? '',
        type: cols[4]?.trim() ?? '',
        brigade: cols[5]?.trim() ?? '',
        rarity: cols[6]?.trim() ?? '',
        card_key: `${name}|${set_code}|${img_file}`,
      };
    });
}

/**
 * Load set aliases from Supabase.
 */
async function loadSetAliases(): Promise<Map<string, string>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('set_aliases').select('*');
  if (error) throw new Error(`Failed to load set_aliases: ${error.message}`);

  const map = new Map<string, string>();
  for (const row of data as SetAlias[]) {
    map.set(row.carddata_code, row.shopify_abbrev);
  }
  return map;
}

/**
 * Full set name → shopify abbreviation mapping for tag-based matching.
 * Used when products only have set info in tags (e.g. Legacy Rare items).
 */
const TAG_SET_TO_ABBREV: Record<string, string> = {
  'gospel of christ': 'GoC',
  'lineage of christ': 'LoC',
  'prophecies of christ': 'PoC',
  'fall of man': 'FoM',
  'cloud of witnesses': 'CoW',
  'revelation of john': 'RoJ',
  'rock of ages': 'RoA',
  'apostles': 'Ap',
  'patriarchs': 'Pa',
  'priests': 'Pi',
  'prophets': 'Pr',
  'warriors': 'Wa',
  'women': 'Wo',
  'kings': 'Ki',
  'disciples': 'Di',
  'early church': 'EC',
  'persecuted church': 'PC',
  'thesaurus ex preteritus': 'TxP',
  'angel wars': 'AW',
  "israel's inheritance": 'II',
  "israel's rebellion": 'IR',
  'food of faith': 'FooF',
  'tent of meeting': 'TtC',
  'roots': 'Roots',
};

/**
 * Load Shopify products from Supabase, indexed by normalized title.
 */
async function loadShopifyProducts(): Promise<{
  byNormalizedTitle: Map<string, ShopifyProductRow>;
  all: ShopifyProductRow[];
}> {
  const supabase = getSupabaseAdmin();
  const allProducts: ShopifyProductRow[] = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('shopify_products')
      .select('*')
      .eq('product_type', 'Single')
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Failed to load shopify_products: ${error.message}`);
    allProducts.push(...(data as ShopifyProductRow[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  const byNormalizedTitle = new Map<string, ShopifyProductRow>();
  for (const p of allProducts) {
    const cleanTitle = stripShopifySuffixes(p.title);
    byNormalizedTitle.set(normalize(cleanTitle), p);
  }

  return { byNormalizedTitle, all: allProducts };
}

/**
 * Load existing mappings that should not be overwritten.
 */
async function loadProtectedKeys(): Promise<Set<string>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('card_price_mappings')
    .select('card_key, status, confidence')
    .or('status.eq.manual,and(status.eq.auto_matched,confidence.gte.0.95)');
  if (error) throw new Error(`Failed to load protected mappings: ${error.message}`);

  return new Set((data ?? []).map((r: { card_key: string }) => r.card_key));
}

/**
 * Pass 1: Exact match — construct "cleanName (shopifyAbbrev)" and compare.
 */
function pass1Exact(
  card: CardRow,
  shopifyAbbrev: string,
  byTitle: Map<string, ShopifyProductRow>
): MatchResult | null {
  const candidate = `${card.name} (${shopifyAbbrev})`;
  const product = byTitle.get(normalize(candidate));
  if (product) {
    return {
      card_key: card.card_key,
      card_name: card.name,
      set_code: card.set_code,
      shopify_product_id: product.id,
      confidence: 1.0,
      match_method: 'exact',
      status: 'auto_matched',
    };
  }
  return null;
}

/**
 * Pass 2: Normalized match — strip embedded set from card name, then retry exact.
 * Also tries variant patterns like "Name (Legacy Rare) (Set)".
 */
function pass2Normalized(
  card: CardRow,
  shopifyAbbrev: string,
  byTitle: Map<string, ShopifyProductRow>
): MatchResult | null {
  const cleanName = stripEmbeddedSet(card.name);

  // Try cleaned name + set abbreviation
  if (cleanName !== card.name) {
    const candidate = `${cleanName} (${shopifyAbbrev})`;
    const product = byTitle.get(normalize(candidate));
    if (product) {
      return {
        card_key: card.card_key,
        card_name: card.name,
        set_code: card.set_code,
        shopify_product_id: product.id,
        confidence: 0.95,
        match_method: 'normalized',
        status: 'auto_matched',
      };
    }
  }

  // Try variant patterns: "Name (Legacy Rare) (Set)", "Name (Borderless) (Set)"
  const baseName = cleanName !== card.name ? cleanName : card.name;
  const variantQualifiers = ['Legacy Rare', 'Borderless', 'UR+', 'Foil'];
  for (const qual of variantQualifiers) {
    const candidate = `${baseName} (${qual}) (${shopifyAbbrev})`;
    const product = byTitle.get(normalize(candidate));
    if (product) {
      return {
        card_key: card.card_key,
        card_name: card.name,
        set_code: card.set_code,
        shopify_product_id: product.id,
        confidence: 0.93,
        match_method: 'normalized_variant',
        status: 'auto_matched',
      };
    }
  }

  // Try "Name (Legacy Rare)" products that only have set info in tags
  // e.g. "The Gates of Hell (Legacy Rare)" with tag "Gospel of Christ" → GoC
  const legacyCandidate = `${baseName} (Legacy Rare)`;
  const legacyProduct = byTitle.get(normalize(legacyCandidate));
  if (legacyProduct && legacyProduct.tags) {
    const tagList = legacyProduct.tags.split(',').map(t => t.trim().toLowerCase());
    for (const tag of tagList) {
      const tagAbbrev = TAG_SET_TO_ABBREV[tag];
      if (tagAbbrev && tagAbbrev === shopifyAbbrev) {
        return {
          card_key: card.card_key,
          card_name: card.name,
          set_code: card.set_code,
          shopify_product_id: legacyProduct.id,
          confidence: 0.92,
          match_method: 'normalized_legacy_rare',
          status: 'auto_matched',
        };
      }
    }
  }

  // For AB variants (e.g. "CoW AB"), fall back to base set ("CoW")
  // since YTG sells AB cards under the same product as non-AB
  if (shopifyAbbrev.includes(' ')) {
    const baseAbbrev = shopifyAbbrev.split(' ')[0];
    const abCandidate = `${baseName} (${baseAbbrev})`;
    const abProduct = byTitle.get(normalize(abCandidate));
    if (abProduct) {
      return {
        card_key: card.card_key,
        card_name: card.name,
        set_code: card.set_code,
        shopify_product_id: abProduct.id,
        confidence: 0.90,
        match_method: 'normalized_ab_fallback',
        status: 'auto_matched',
      };
    }
  }

  return null;
}

let fuzzyErrorLogged = false;
let fuzzyDebugCount = 0;

/**
 * Passes 3+4 combined: Fuzzy trigram match with multi-signal disambiguation.
 * Runs a single RPC call per card, then applies metadata scoring.
 */
async function pass3and4Fuzzy(
  card: CardRow,
  shopifyAbbrev: string | undefined
): Promise<MatchResult | null> {
  const supabase = getSupabaseAdmin();
  const cleanName = stripEmbeddedSet(card.name);
  const searchTerm = shopifyAbbrev
    ? `${cleanName} (${shopifyAbbrev})`
    : cleanName;

  const { data, error } = await supabase.rpc('fuzzy_match_shopify_product', {
    search_term: searchTerm,
    min_similarity: 0.5,
    max_results: 5,
  });

  if (error) {
    if (!fuzzyErrorLogged) {
      console.error('Fuzzy RPC error:', error.message, '| search_term:', searchTerm);
      fuzzyErrorLogged = true;
    }
    return null;
  }
  if (!data || data.length === 0) {
    if (fuzzyDebugCount < 5) {
      console.log(`  [fuzzy debug] No results for: "${searchTerm}"`);
      fuzzyDebugCount++;
    }
    return null;
  }
  if (fuzzyDebugCount < 10) {
    const topTitles = data.slice(0, 3).map((d: any) => `"${d.title}" (${d.score})`).join(', ');
    console.log(`  [fuzzy debug] "${searchTerm}" → ${topTitles}`);
    fuzzyDebugCount++;
  }

  // Apply multi-signal scoring to all candidates
  let bestCandidate: { id: string; rawScore: number; boostedScore: number; title: string } | null = null;

  for (const candidate of data) {
    const rawScore = candidate.score as number;
    let boostedScore = rawScore;
    const candidateTitle = (candidate.title as string) || '';

    // Strong boost for matching set abbreviation in the title
    // This is critical for multi-version cards like "Urim and Thummim (PoC)" vs "(Pi)"
    if (shopifyAbbrev) {
      const setPattern = `(${shopifyAbbrev})`;
      if (candidateTitle.includes(setPattern)) {
        boostedScore += 0.3;
      }
    }

    if (candidate.tags) {
      const parsed = parseShopifyTags(candidate.tags);

      // Boost for matching set via tags (e.g. tag "Lineage of Christ" → LoC)
      // Handles products where set info is only in tags, not title
      if (shopifyAbbrev) {
        const tagList = (candidate.tags as string).split(',').map((t: string) => t.trim().toLowerCase());
        for (const tag of tagList) {
          const tagAbbrev = TAG_SET_TO_ABBREV[tag];
          if (tagAbbrev && tagAbbrev === shopifyAbbrev) {
            boostedScore += 0.2;
            break;
          }
        }
      }

      if (card.brigade && parsed.brigade.some((b: string) =>
        b === card.brigade.toLowerCase() ||
        card.brigade.toLowerCase().includes(b)
      )) {
        boostedScore += 0.1;
      }
      if (card.type && parsed.type.some((t: string) =>
        t === card.type.toLowerCase() ||
        card.type.toLowerCase().includes(t)
      )) {
        boostedScore += 0.1;
      }
    }

    if (!bestCandidate || boostedScore > bestCandidate.boostedScore) {
      bestCandidate = { id: candidate.id, rawScore, boostedScore, title: candidateTitle };
    }
  }

  if (!bestCandidate) return null;

  const { id, rawScore, boostedScore } = bestCandidate;
  const confidence = Math.min(Math.round(boostedScore * 100) / 100, 0.99);

  // High confidence: auto-match
  if (boostedScore >= 0.9) {
    return {
      card_key: card.card_key,
      card_name: card.name,
      set_code: card.set_code,
      shopify_product_id: id,
      confidence,
      match_method: boostedScore > rawScore ? 'multi_signal' : 'fuzzy',
      status: 'auto_matched',
    };
  }

  // Strong fuzzy match with clear top result: auto-match
  if (rawScore > 0.85 && (data.length === 1 || rawScore - data[1].score > 0.05)) {
    return {
      card_key: card.card_key,
      card_name: card.name,
      set_code: card.set_code,
      shopify_product_id: id,
      confidence: Math.round(rawScore * 100) / 100,
      match_method: 'fuzzy',
      status: 'auto_matched',
    };
  }

  // Moderate fuzzy match: needs review
  if (rawScore >= 0.7) {
    return {
      card_key: card.card_key,
      card_name: card.name,
      set_code: card.set_code,
      shopify_product_id: id,
      confidence: Math.round(rawScore * 100) / 100,
      match_method: 'fuzzy',
      status: 'needs_review',
    };
  }

  return null;
}

function log(msg: string) {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`[${timestamp}] ${msg}`);
}

/**
 * Run the full matching pipeline (passes 1-4) for all cards.
 */
export async function runMatchingPipeline(options?: {
  passes?: number[];
  setCodes?: string[];
  force?: boolean;
  dryRun?: boolean;
}): Promise<MatchingSummary> {
  const passes = options?.passes ?? [1, 2, 3, 4];
  const force = options?.force ?? false;
  const dryRun = options?.dryRun ?? false;

  log('Loading data...');
  const [cards, aliases, shopify, protectedKeys] = await Promise.all([
    loadCardData(),
    loadSetAliases(),
    loadShopifyProducts(),
    force ? Promise.resolve(new Set<string>()) : loadProtectedKeys(),
  ]);

  log(`Loaded ${cards.length} cards, ${aliases.size} aliases, ${shopify.all.length} Shopify products, ${protectedKeys.size} protected`);

  // Filter by set codes if specified
  let filteredCards = cards;
  if (options?.setCodes?.length) {
    const setFilter = new Set(options.setCodes);
    filteredCards = cards.filter(c => setFilter.has(c.set_code));
  }

  const results: MatchResult[] = [];
  const summary: MatchingSummary = {
    total: filteredCards.length,
    matched: 0,
    needs_review: 0,
    no_price_exists: 0,
    unmatched: 0,
  };

  // ── Phase 1: In-memory passes (instant) ──
  log('Running passes 1 & 2 (exact + normalized)...');
  const needsFuzzy: { card: CardRow; shopifyAbbrev: string | undefined }[] = [];

  for (const card of filteredCards) {
    if (protectedKeys.has(card.card_key)) continue;

    // Unsold sets
    if (UNSOLD_SETS.has(card.set_code)) {
      results.push({
        card_key: card.card_key,
        card_name: card.name,
        set_code: card.set_code,
        shopify_product_id: null,
        confidence: 0,
        match_method: 'none',
        status: 'no_price_exists',
      });
      summary.no_price_exists++;
      continue;
    }

    const shopifyAbbrev = aliases.get(card.set_code);

    // No alias → no price exists
    if (!shopifyAbbrev) {
      results.push({
        card_key: card.card_key,
        card_name: card.name,
        set_code: card.set_code,
        shopify_product_id: null,
        confidence: 0,
        match_method: 'none',
        status: 'no_price_exists',
      });
      summary.no_price_exists++;
      continue;
    }

    let match: MatchResult | null = null;

    if (passes.includes(1)) {
      match = pass1Exact(card, shopifyAbbrev, shopify.byNormalizedTitle);
    }
    if (!match && passes.includes(2)) {
      match = pass2Normalized(card, shopifyAbbrev, shopify.byNormalizedTitle);
    }

    if (match) {
      results.push(match);
      summary.matched++;
    } else {
      needsFuzzy.push({ card, shopifyAbbrev });
    }
  }

  log(`Passes 1 & 2 done: ${summary.matched} matched, ${summary.no_price_exists} no_price_exists, ${needsFuzzy.length} need fuzzy matching`);

  // ── Phase 2: Fuzzy passes (requires RPC calls) ──
  if ((passes.includes(3) || passes.includes(4)) && needsFuzzy.length > 0) {
    log(`Running fuzzy matching on ${needsFuzzy.length} cards...`);
    const concurrency = 10; // parallel RPC calls
    let processed = 0;
    let fuzzyMatched = 0;
    let fuzzyReview = 0;

    // Process in concurrent batches
    for (let i = 0; i < needsFuzzy.length; i += concurrency) {
      const batch = needsFuzzy.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(({ card, shopifyAbbrev }) =>
          pass3and4Fuzzy(card, shopifyAbbrev).then(match => ({ card, match }))
        )
      );

      for (const { card, match } of batchResults) {
        if (match) {
          results.push(match);
          if (match.status === 'auto_matched') {
            summary.matched++;
            fuzzyMatched++;
          } else if (match.status === 'needs_review') {
            summary.needs_review++;
            fuzzyReview++;
          }
        } else {
          results.push({
            card_key: card.card_key,
            card_name: card.name,
            set_code: card.set_code,
            shopify_product_id: null,
            confidence: 0,
            match_method: 'none',
            status: 'unmatched',
          });
          summary.unmatched++;
        }
      }

      processed += batch.length;
      if (processed % 100 === 0 || processed === needsFuzzy.length) {
        log(`  Fuzzy progress: ${processed}/${needsFuzzy.length} (${fuzzyMatched} matched, ${fuzzyReview} review)`);
      }
    }
  } else {
    // No fuzzy passes — mark remaining as unmatched
    for (const { card } of needsFuzzy) {
      results.push({
        card_key: card.card_key,
        card_name: card.name,
        set_code: card.set_code,
        shopify_product_id: null,
        confidence: 0,
        match_method: 'none',
        status: 'unmatched',
      });
      summary.unmatched++;
    }
  }

  // ── Phase 3: Write results ──
  if (!dryRun) {
    log(`Writing ${results.length} results to card_price_mappings...`);
    await writeResults(results);
    log('Regenerating card_prices...');
    await regenerateCardPrices();
  }

  log(`Done! matched=${summary.matched} review=${summary.needs_review} no_price=${summary.no_price_exists} unmatched=${summary.unmatched}`);
  return summary;
}

/**
 * Write match results to card_price_mappings (upsert, never overwrite manual).
 */
async function writeResults(results: MatchResult[]): Promise<void> {
  const supabase = getSupabaseAdmin();
  const batchSize = 500;

  for (let i = 0; i < results.length; i += batchSize) {
    const batch = results.slice(i, i + batchSize).map(r => ({
      card_key: r.card_key,
      card_name: r.card_name,
      set_code: r.set_code,
      shopify_product_id: r.shopify_product_id,
      confidence: r.confidence,
      match_method: r.match_method,
      status: r.status,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('card_price_mappings')
      .upsert(batch, {
        onConflict: 'card_key',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`Error writing batch ${i / batchSize + 1}:`, error.message);
    } else {
      log(`  Wrote batch ${i / batchSize + 1}/${Math.ceil(results.length / batchSize)}`);
    }
  }
}

/**
 * Regenerate the card_prices denormalized table from confirmed mappings.
 */
export async function regenerateCardPrices(): Promise<void> {
  const supabase = getSupabaseAdmin();

  // Paginate to get all confirmed mappings
  const allData: any[] = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('card_price_mappings')
      .select(`
        card_key,
        shopify_product_id,
        shopify_products!inner (
          price,
          handle,
          title
        )
      `)
      .in('status', ['auto_matched', 'manual'])
      .not('shopify_product_id', 'is', null)
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Error fetching mappings for card_prices:', error.message);
      return;
    }
    allData.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }

  if (allData.length === 0) {
    log('No confirmed mappings to write to card_prices');
    return;
  }

  const rows = allData.map((row: any) => ({
    card_key: row.card_key,
    price: row.shopify_products.price,
    shopify_handle: row.shopify_products.handle,
    shopify_title: row.shopify_products.title,
    updated_at: new Date().toISOString(),
  }));

  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error: upsertError } = await supabase
      .from('card_prices')
      .upsert(batch, { onConflict: 'card_key' });

    if (upsertError) {
      console.error(`Error upserting card_prices batch ${i / batchSize + 1}:`, upsertError.message);
    }
  }

  log(`Regenerated card_prices: ${rows.length} rows`);
}
