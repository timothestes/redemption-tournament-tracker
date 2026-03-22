/** Card price matching pipeline — passes 1-4 */

import { getSupabaseAdmin } from './supabase-admin';
import { normalize, stripEmbeddedSet, stripShopifySuffixes, parseShopifyTags, UNSOLD_SETS } from './helpers';
import { normalize as normalizeDup, stripSetSuffix, findGroup } from '@/lib/duplicateCards';
import type { DuplicateGroupIndex, DuplicateGroup, DuplicateSibling } from '@/lib/duplicateCards';
import { normalizeAbility } from '@/lib/pricing/budgetPricing';
import type { CardRow, SetAlias, ShopifyProductRow, MatchResult, MatchingSummary } from './types';

const CARD_DATA_URL =
  'https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt';

/**
 * Manual name aliases for cards where carddata and Shopify names differ.
 * Key: normalized carddata name, Value: Shopify name to search for.
 */
const NAME_ALIASES: Record<string, string> = {
  "nicolatian's teaching": "Nicolaitans' Teaching",
};

/**
 * Art variant cards that use description-based naming in carddata
 * but numbered/named variants in Shopify. Cannot be auto-matched.
 */
const ART_VARIANT_PATTERNS = [
  /^(Pharisees|Sadducees)\s*-\s*/,
  /^Obsidian Minion\s*-\s*/,
  /^Seraphim\s*-\s*/,
  /^Shadow\s*-\s*/,
];

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
      // Strip .jpg/.jpeg extension to match the UI's sanitizeImgFile behavior
      const img_file = (cols[2]?.trim() ?? '').replace(/\.jpe?g$/i, '');
      return {
        name,
        set_code,
        img_file,
        official_set: cols[3]?.trim() ?? '',
        type: cols[4]?.trim() ?? '',
        brigade: cols[5]?.trim() ?? '',
        rarity: cols[6]?.trim() ?? '',
        special_ability: cols[10]?.trim() ?? '',
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

  // Try name aliases (for cards where carddata and Shopify names differ)
  const baseName = cleanName !== card.name ? cleanName : card.name;
  const aliasName = NAME_ALIASES[normalize(baseName)];
  if (aliasName) {
    const aliasCandidate = `${aliasName} (${shopifyAbbrev})`;
    const aliasProduct = byTitle.get(normalize(aliasCandidate));
    if (aliasProduct) {
      return {
        card_key: card.card_key,
        card_name: card.name,
        set_code: card.set_code,
        shopify_product_id: aliasProduct.id,
        confidence: 0.90,
        match_method: 'name_alias',
        status: 'auto_matched',
      };
    }
  }

  // Try variant patterns: "Name (Legacy Rare) (Set)", "Name (Borderless) (Set)"
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
  // Also try quoted name: '"He is Risen" (Legacy Rare)'
  const legacyCandidates = [
    `${baseName} (Legacy Rare)`,
    `"${baseName}" (Legacy Rare)`,
  ];
  if (aliasName) {
    legacyCandidates.push(`${aliasName} (Legacy Rare)`);
    legacyCandidates.push(`"${aliasName}" (Legacy Rare)`);
  }
  const legacyProduct = legacyCandidates
    .map(c => byTitle.get(normalize(c)))
    .find(p => p != null) ?? null;
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
    // Try both original name and alias
    const abNames = [baseName];
    if (aliasName) abNames.push(aliasName);
    const abProduct = abNames
      .map(n => byTitle.get(normalize(`${n} (${baseAbbrev})`)))
      .find(p => p != null) ?? null;
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

/**
 * Pass 2a-ban: Banned/errata card matching.
 * Cards from "[Ban]" sets may exist in Shopify with suffixes like:
 *   "Name (Set) *Banned from official play*"
 *   "Name (errata/corrected) (Set)"
 *   "Name (Set) *Errata received*"
 */
function pass2aBanned(
  card: CardRow,
  shopifyAbbrev: string,
  byTitle: Map<string, ShopifyProductRow>,
  isBannedSet: boolean
): MatchResult | null {
  if (!isBannedSet) return null;

  const baseName = stripEmbeddedSet(card.name);
  const nameToUse = baseName !== card.name ? baseName : card.name;

  // Also strip "(Banned)" suffix from carddata names like "Endless Treasures (Banned)"
  const cleanedName = nameToUse.replace(/\s*\(Banned\)\s*$/, '').trim();

  // Try various banned/errata Shopify title patterns
  const candidates = [
    `${cleanedName} (${shopifyAbbrev}) *Banned from official play*`,
    `${cleanedName} (errata/corrected) (${shopifyAbbrev})`,
    `${cleanedName} (${shopifyAbbrev}) *Errata received*`,
    `${cleanedName} (${shopifyAbbrev}) *Out of Print*`,
  ];

  for (const candidate of candidates) {
    // stripShopifySuffixes + normalize is what the byTitle map uses as keys,
    // so we need to match against that
    const product = byTitle.get(normalize(stripShopifySuffixes(candidate)));
    if (product) {
      return {
        card_key: card.card_key,
        card_name: card.name,
        set_code: card.set_code,
        shopify_product_id: product.id,
        confidence: 0.92,
        match_method: 'banned_set_match',
        status: 'auto_matched',
      };
    }
  }

  return null;
}

/**
 * Pass 2b: Lost Soul bracket notation.
 * Carddata:  Lost Soul "Nickname" [Scripture] or [Scripture - LR]
 * Shopify:   Lost Soul (Scripture) "Nickname" (Set) or Lost Soul "Nickname" (Scripture) (Legacy Rare)
 *
 * Tries multiple candidate patterns since Shopify ordering varies.
 */
function pass2bLostSoulBracket(
  card: CardRow,
  shopifyAbbrev: string,
  byTitle: Map<string, ShopifyProductRow>
): MatchResult | null {
  // Only applies to Lost Soul cards with bracket notation
  if (!card.name.startsWith('Lost Soul') || !card.name.includes('[')) return null;

  // Match: Lost Soul [Token] "Nickname" [Scripture - LR]
  const lrMatch = card.name.match(/^(Lost Soul(?:\s+Token)?\s+[\u201C""]([^"\u201D]+)[\u201D""])\s*\[([^\]]+)\s*-\s*LR\]$/);
  // Match: Lost Soul [Token] "Nickname" [Scripture]
  const plainMatch = card.name.match(/^(Lost Soul(?:\s+Token)?\s+[\u201C""]([^"\u201D]+)[\u201D""])\s*\[([^\]]+)\]$/);

  const match = lrMatch || plainMatch;
  if (!match) return null;

  const isLR = !!lrMatch;
  const nickname = match[2].trim();
  const scripture = match[3].trim();

  const candidates: string[] = [];

  if (isLR) {
    // Try Legacy Rare patterns (with and without set)
    candidates.push(`Lost Soul "${nickname}" (${scripture}) (Legacy Rare) (${shopifyAbbrev})`);
    candidates.push(`Lost Soul (${scripture}) "${nickname}" (Legacy Rare) (${shopifyAbbrev})`);
    candidates.push(`Lost Soul "${nickname}" (${scripture}) (Legacy Rare)`);
    candidates.push(`Lost Soul (${scripture}) "${nickname}" (Legacy Rare)`);
  } else {
    // Try standard patterns (paren and bracket notation for scripture)
    candidates.push(`Lost Soul "${nickname}" (${scripture}) (${shopifyAbbrev})`);
    candidates.push(`Lost Soul (${scripture}) "${nickname}" (${shopifyAbbrev})`);
    candidates.push(`Lost Soul "${nickname}" [${scripture}] (${shopifyAbbrev})`);
  }

  for (const candidate of candidates) {
    const product = byTitle.get(normalize(candidate));
    if (product) {
      return {
        card_key: card.card_key,
        card_name: card.name,
        set_code: card.set_code,
        shopify_product_id: product.id,
        confidence: isLR ? 0.93 : 0.95,
        match_method: 'lost_soul_bracket',
        status: 'auto_matched',
      };
    }
  }

  return null;
}

/**
 * Pass 2c: Promo fallback.
 * For promo cards that don't match their specific promo product,
 * try matching to any non-promo version of the same card.
 */
export function pass2cPromoFallback(
  card: CardRow,
  shopifyAbbrev: string,
  byTitle: Map<string, ShopifyProductRow>,
  allProducts: ShopifyProductRow[]
): MatchResult | null {
  // Only for promo sets
  if (!shopifyAbbrev.includes('Promo') && shopifyAbbrev !== 'Promo') return null;

  // Extract bracket content before stripping (e.g., "2023 - 1st Place" from "[2023 - 1st Place]")
  const bracketMatch = card.name.match(/\[([^\]]+)\]\s*$/);
  const bracketContent = bracketMatch?.[1] ?? '';

  // Strip promo-related suffixes from card name
  let baseName = card.name
    .replace(/\s*\(\d{4}\s+Promo\)\s*$/, '')    // "(2016 Promo)"
    .replace(/\s*\(Promo\)\s*$/, '')              // "(Promo)"
    .replace(/\s*\[\d{4}\s*-\s*[^\]]+\]\s*$/, '') // "[2023 - Seasonal]"
    .trim();
  baseName = stripEmbeddedSet(baseName);

  // First try: if we had bracket content with distinguishing info (e.g., "2023 - 1st Place"),
  // search for a Shopify product whose title contains both the base name AND the bracket keywords.
  if (bracketContent) {
    const bracketKeywords = bracketContent.split(/[\s\-,]+/).filter(w => w.length > 1);
    const normalizedBase = normalize(baseName);
    const specificMatches = allProducts.filter(p => {
      const normTitle = normalize(p.title);
      if (!normTitle.includes(normalizedBase)) return false;
      // Require all bracket keywords to appear in the Shopify title
      return bracketKeywords.every(kw => normTitle.includes(normalize(kw)));
    });
    if (specificMatches.length === 1) {
      return {
        card_key: card.card_key,
        card_name: card.name,
        set_code: card.set_code,
        shopify_product_id: specificMatches[0].id,
        confidence: 0.92,
        match_method: 'promo_bracket_match',
        status: 'auto_matched',
      };
    }
    if (specificMatches.length > 1) {
      // Multiple matches — pick the cheapest
      const best = specificMatches.reduce((a, b) =>
        (a.price ?? Infinity) < (b.price ?? Infinity) ? a : b
      );
      return {
        card_key: card.card_key,
        card_name: card.name,
        set_code: card.set_code,
        shopify_product_id: best.id,
        confidence: 0.90,
        match_method: 'promo_bracket_match',
        status: 'auto_matched',
      };
    }
  }

  // Second try: find any Shopify product matching "baseName (Promo)"
  const promoCandidate = `${baseName} (Promo)`;
  const promoProduct = byTitle.get(normalize(promoCandidate));
  if (promoProduct) {
    return {
      card_key: card.card_key,
      card_name: card.name,
      set_code: card.set_code,
      shopify_product_id: promoProduct.id,
      confidence: 0.88,
      match_method: 'promo_fallback',
      status: 'auto_matched',
    };
  }

  // Second try: find any non-promo version — pick cheapest
  // Extract card name by stripping everything after the LAST paren group
  const normalizedBase = normalize(baseName);
  const matches = allProducts.filter(p => {
    const cleanTitle = stripShopifySuffixes(p.title);
    const normTitle = normalize(cleanTitle);
    // Strip all trailing paren groups to get base name
    const cardNamePart = normTitle.replace(/(\s*\([^)]+\))+\s*$/, '').trim();
    return cardNamePart === normalizedBase;
  });

  if (matches.length > 0) {
    // Pick cheapest available product
    const cheapest = matches.reduce((best, p) =>
      (p.price ?? Infinity) < (best.price ?? Infinity) ? p : best
    );
    return {
      card_key: card.card_key,
      card_name: card.name,
      set_code: card.set_code,
      shopify_product_id: cheapest.id,
      confidence: 0.85,
      match_method: 'promo_fallback_cheapest',
      status: 'auto_matched',
    };
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

    // Resolve set alias — for banned sets like "PoC [Ban]", strip suffix and use base set
    const isBannedSet = card.set_code.includes('[Ban]');
    const baseSetCode = isBannedSet ? card.set_code.replace(/\s*\[Ban\]$/, '').trim() : card.set_code;
    const shopifyAbbrev = aliases.get(card.set_code) ?? aliases.get(baseSetCode);

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

    // Detect tokens and art variants — not sold by YTG as distinct products
    // Exclude cards with scripture references (e.g. Lost Soul Token "Lost Souls" [Proverbs 2:16-17])
    const isToken = /\bToken\b/.test(card.name) && !/\[\w+\s+\d+:\d+/.test(card.name);
    if (isToken || ART_VARIANT_PATTERNS.some(p => p.test(card.name))) {
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
    if (!match && passes.includes(2)) {
      match = pass2aBanned(card, shopifyAbbrev, shopify.byNormalizedTitle, isBannedSet);
    }
    if (!match && passes.includes(2)) {
      match = pass2bLostSoulBracket(card, shopifyAbbrev, shopify.byNormalizedTitle);
    }
    if (!match && passes.includes(2)) {
      match = pass2cPromoFallback(card, shopifyAbbrev, shopify.byNormalizedTitle, shopify.all);
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

  summary.unmatchedCards = results.filter(r => r.status === 'unmatched');
  summary.noPriceCards = results.filter(r => r.status === 'no_price_exists');

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

/**
 * Build a DuplicateGroupIndex from Supabase using the admin client.
 * Server-side equivalent of fetchDuplicateGroups() in lib/duplicateCards.ts.
 */
export async function buildDuplicateGroupIndex(): Promise<DuplicateGroupIndex> {
  const supabase = getSupabaseAdmin();

  const PAGE = 1000;
  const allData: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('duplicate_card_group_members')
      .select(`
        card_name,
        ordir_sets,
        matched,
        group:duplicate_card_groups!inner(id, canonical_name)
      `)
      .range(offset, offset + PAGE - 1)
      .order('id', { ascending: true });

    if (error || !data || data.length === 0) {
      if (error) console.error('Failed to fetch duplicate groups:', error);
      break;
    }
    allData.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const empty: DuplicateGroupIndex = {
    groups: [],
    byExact: new Map(),
    byNormalized: new Map(),
  };

  if (allData.length === 0) return empty;

  // Group by group id
  const groupsById = new Map<number, { canonicalName: string; members: DuplicateSibling[] }>();

  for (const row of allData as any[]) {
    const groupId = row.group.id as number;
    const canonicalName = row.group.canonical_name as string;

    if (!groupsById.has(groupId)) {
      groupsById.set(groupId, { canonicalName, members: [] });
    }
    groupsById.get(groupId)!.members.push({
      cardName: row.card_name,
      ordirSets: row.ordir_sets || '',
      matched: row.matched,
    });
  }

  // Build lookup indices
  const byExact = new Map<string, DuplicateGroup[]>();
  const byNormalized = new Map<string, DuplicateGroup[]>();
  const groups: DuplicateGroup[] = [];

  function addToMultiMap(map: Map<string, DuplicateGroup[]>, key: string, value: DuplicateGroup) {
    const existing = map.get(key);
    if (existing) {
      if (!existing.includes(value)) existing.push(value);
    } else {
      map.set(key, [value]);
    }
  }

  for (const group of groupsById.values()) {
    groups.push(group);

    addToMultiMap(byExact, group.canonicalName, group);
    addToMultiMap(byNormalized, normalizeDup(group.canonicalName), group);

    for (const member of group.members) {
      addToMultiMap(byExact, member.cardName, group);
      addToMultiMap(byNormalized, normalizeDup(member.cardName), group);
    }
  }

  return { groups, byExact, byNormalized };
}

/**
 * Compute cheapest equivalent prices for all cards in card_prices.
 * For each card that belongs to a duplicate group, finds the cheapest
 * sibling with the same special ability text and writes it to cheapest_price.
 */
export async function computeCheapestPrices(): Promise<void> {
  const supabase = getSupabaseAdmin();

  // Load all data in parallel
  const [carddata, dupIndex, cardPrices] = await Promise.all([
    loadCardData(),
    buildDuplicateGroupIndex(),
    (async () => {
      const allPrices: { card_key: string; price: number }[] = [];
      const pageSize = 1000;
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from('card_prices')
          .select('card_key, price')
          .range(offset, offset + pageSize - 1);
        if (error) {
          console.error('Error fetching card_prices:', error.message);
          break;
        }
        allPrices.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
        offset += pageSize;
      }
      return allPrices;
    })(),
  ]);

  log(`Computing cheapest prices: ${carddata.length} cards, ${dupIndex.groups.length} dup groups, ${cardPrices.length} priced cards`);

  // Build price-by-key map
  const priceByKey = new Map<string, number>();
  for (const cp of cardPrices) {
    priceByKey.set(cp.card_key, cp.price);
  }

  // Build carddata-by-normalized-base-name map (for gathering candidates)
  const cardsByNormName = new Map<string, CardRow[]>();
  for (const card of carddata) {
    const baseKey = normalizeDup(stripSetSuffix(card.name));
    const existing = cardsByNormName.get(baseKey);
    if (existing) {
      existing.push(card);
    } else {
      cardsByNormName.set(baseKey, [card]);
    }

    // Also index by full normalized name
    const fullKey = normalizeDup(card.name);
    if (fullKey !== baseKey) {
      const existingFull = cardsByNormName.get(fullKey);
      if (existingFull) {
        existingFull.push(card);
      } else {
        cardsByNormName.set(fullKey, [card]);
      }
    }
  }

  // Build a carddata lookup by card_key for quick ability lookups
  const carddataByKey = new Map<string, CardRow>();
  for (const card of carddata) {
    carddataByKey.set(card.card_key, card);
  }

  // For each card in card_prices, find cheapest equivalent
  const updates: { card_key: string; cheapest_price: number }[] = [];
  let skippedNoGroup = 0;
  let skippedNoSource = 0;
  let cheaperFound = 0;

  for (const cp of cardPrices) {
    const sourceCard = carddataByKey.get(cp.card_key);
    if (!sourceCard) {
      skippedNoSource++;
      continue;
    }

    // Find duplicate group
    const group = findGroup(sourceCard.name, dupIndex);
    if (!group) {
      skippedNoGroup++;
      continue;
    }

    // Gather normalized member names from the group
    const memberNormNames = new Set<string>();
    for (const member of group.members) {
      memberNormNames.add(normalizeDup(member.cardName));
      memberNormNames.add(normalizeDup(stripSetSuffix(member.cardName)));
    }

    // Gather candidate cards from carddata via the index
    const seen = new Set<string>();
    const candidates: CardRow[] = [];
    for (const normName of memberNormNames) {
      const bucket = cardsByNormName.get(normName);
      if (bucket) {
        for (const c of bucket) {
          if (!seen.has(c.card_key)) {
            seen.add(c.card_key);
            candidates.push(c);
          }
        }
      }
    }

    // Filter to same-ability candidates
    const targetAbility = normalizeAbility(sourceCard.special_ability);
    const equivalents = candidates.filter(
      c => normalizeAbility(c.special_ability) === targetAbility
    );

    // Find cheapest price among equivalents
    let cheapestPrice: number | null = null;
    for (const equiv of equivalents) {
      const price = priceByKey.get(equiv.card_key);
      if (price != null && price > 0 && (cheapestPrice === null || price < cheapestPrice)) {
        cheapestPrice = price;
      }
    }

    // Record update if we found a cheaper (or equal) price from a sibling
    if (cheapestPrice !== null) {
      if (cheapestPrice < cp.price) {
        cheaperFound++;
      }
      updates.push({ card_key: cp.card_key, cheapest_price: cheapestPrice });
    }
  }

  log(`Cheapest price analysis: ${updates.length} cards to update, ${cheaperFound} have cheaper equivalents, ${skippedNoGroup} no group, ${skippedNoSource} no source card`);

  // Batch update cheapest_price in card_prices
  if (updates.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize).map(u => ({
        card_key: u.card_key,
        cheapest_price: u.cheapest_price,
      }));

      const { error } = await supabase
        .from('card_prices')
        .upsert(batch, { onConflict: 'card_key' });

      if (error) {
        console.error(`Error updating cheapest_price batch ${i / batchSize + 1}:`, error.message);
      }
    }
    log(`Updated cheapest_price for ${updates.length} cards`);
  }
}
