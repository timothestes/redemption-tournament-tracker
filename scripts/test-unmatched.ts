#!/usr/bin/env npx tsx
/**
 * Test suite for unmatched cards. Classifies each card as either:
 *   - no_price_exists: No Shopify product exists for this card (tokens, event promos, etc.)
 *   - solvable: A Shopify product exists and we should be able to match it
 *
 * For solvable cards, asserts the expected Shopify product title and explains
 * what matching improvement is needed.
 *
 * Usage: npx tsx scripts/test-unmatched.ts
 */

import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(__dirname, '..', '.env.local') });

import { getSupabaseAdmin } from '../lib/pricing/supabase-admin';
import { normalize, stripEmbeddedSet, stripShopifySuffixes } from '../lib/pricing/helpers';

// ─── Card classifications ───

interface NoPrice {
  card_name: string;
  set_code: string;
  reason: string;
}

interface Solvable {
  card_name: string;
  set_code: string;
  expected_shopify_title: string;
  fix_category: string;
  fix_description: string;
}

const NO_PRICE_EXISTS: NoPrice[] = [
  // Tokens — not sold as singles by YTG
  { card_name: 'Follower Token', set_code: 'GoC', reason: 'Token — not sold by YTG' },
  { card_name: 'Proselyte Token', set_code: 'GoC', reason: 'Token — not sold by YTG' },
  { card_name: 'Violent Possessor Token', set_code: 'GoC', reason: 'Token — not sold by YTG' },
  { card_name: 'Wicked Spirit Token', set_code: 'GoC', reason: 'Token — not sold by YTG' },
  { card_name: 'Stricken Reminder Token', set_code: 'PoC', reason: 'Token — not sold by YTG' },
  { card_name: 'Lost Soul Token NT (Majestic Heavens)', set_code: 'Pmo-P2', reason: 'Token — not sold by YTG' },
  { card_name: 'Lost Soul Token OT (Majestic Heavens)', set_code: 'Pmo-P2', reason: 'Token — not sold by YTG' },
  { card_name: 'Lost Soul Token OT [2024 - Nationals]', set_code: 'Pmo-P3', reason: 'Token — not sold by YTG' },
  { card_name: 'Lost Soul Token "Lost Souls" [Proverbs 2:16-17]', set_code: 'RR', reason: 'Token — closest match "Lost Soul "Lost Souls" [Proverbs 2:16-17] (Roots)" is the actual card not the token' },

  // Art variants where carddata uses description-based names but Shopify uses numbered variants
  // No way to determine which number maps to which description without manual mapping
  { card_name: 'Pharisees - John 8:3-4', set_code: 'Ap', reason: 'Art variant — carddata uses description, Shopify uses "(Trio)/(Crowd)/(Leader)"' },
  { card_name: 'Pharisees - Orange Background', set_code: 'Ap', reason: 'Art variant — carddata uses description, Shopify uses "(Trio)/(Crowd)/(Leader)"' },
  { card_name: 'Pharisees - Red Background', set_code: 'Ap', reason: 'Art variant — carddata uses description, Shopify uses "(Trio)/(Crowd)/(Leader)"' },
  { card_name: 'Sadducees - Group of 10', set_code: 'Ap', reason: 'Art variant — carddata uses description, Shopify uses "(Ear)/(Trio)/(Crowd)"' },
  { card_name: 'Sadducees - Group of 4', set_code: 'Ap', reason: 'Art variant — carddata uses description, Shopify uses "(Ear)/(Trio)/(Crowd)"' },
  { card_name: 'Sadducees - Group of 6', set_code: 'Ap', reason: 'Art variant — carddata uses description, Shopify uses "(Ear)/(Trio)/(Crowd)"' },
  { card_name: 'Obsidian Minion - Dark Gray Background', set_code: 'AW', reason: 'Art variant — carddata uses description, Shopify uses "(1)/(2)/(3)/(4)/(5)"' },
  { card_name: 'Obsidian Minion - Light Gray Background', set_code: 'AW', reason: 'Art variant — carddata uses description, Shopify uses "(1)/(2)/(3)/(4)/(5)"' },
  { card_name: 'Seraphim - Isaiah 6:2', set_code: 'War', reason: 'Art variant — closest Shopify "Seraphim (Wa) (Band to Blue/Green)" uses different naming' },
  { card_name: 'Seraphim - Isaiah 6:6', set_code: 'War', reason: 'Art variant — closest Shopify "Seraphim (Wa) (Band to Blue/Green)" uses different naming' },

  // Shadow has a "Hand or Storehouse" descriptor not in Shopify
  { card_name: 'Shadow - Hand or Storehouse', set_code: 'AW', reason: 'Art variant — Shopify only has "Shadow (AW)" without variant descriptor' },
];

const SOLVABLE: Solvable[] = [
  // ── Lost Souls with bracket notation ──
  // Carddata: Lost Soul "Nickname" [Scripture] or [Scripture - LR]
  // Shopify:  Lost Soul (Scripture) "Nickname" (Set) or Lost Soul "Nickname" (Scripture) (Legacy Rare)
  {
    card_name: 'Lost Soul "6/*" [Deuteronomy 32:15]',
    set_code: 'FoM',
    expected_shopify_title: 'Lost Soul (Deuteronomy 32:15) "6/*" (FoM)',
    fix_category: 'lost_soul_bracket',
    fix_description: 'Convert bracket [Scripture] → (Scripture) and rearrange to Shopify format',
  },
  {
    card_name: 'Lost Soul "Hopper" [II Chronicles 28:13 - LR]',
    set_code: 'FoM',
    expected_shopify_title: 'Lost Soul (II Chronicles 28:13) "Hopper" (Legacy Rare) (FoM)',
    fix_category: 'lost_soul_bracket_lr',
    fix_description: 'Convert [Scripture - LR] → (Scripture) (Legacy Rare) (Set)',
  },
  {
    card_name: 'Lost Soul "Punisher" [Jeremiah 17:9 - LR]',
    set_code: 'FoM',
    expected_shopify_title: 'Lost Soul (Jeremiah 17:9) "Punisher" (Legacy Rare) (FoM)',
    fix_category: 'lost_soul_bracket_lr',
    fix_description: 'Convert [Scripture - LR] → (Scripture) (Legacy Rare) (Set)',
  },
  {
    card_name: 'Lost Soul "Wanderer" [Ezekiel 34:6 - LR]',
    set_code: 'FoM',
    expected_shopify_title: 'Lost Soul (Ezekiel 34:6) "Wanderer" (Legacy Rare) (FoM)',
    fix_category: 'lost_soul_bracket_lr',
    fix_description: 'Convert [Scripture - LR] → (Scripture) (Legacy Rare) (Set)',
  },
  {
    card_name: 'Lost Soul "Remiss" [II Chronicles 24:19]',
    set_code: 'LoC',
    expected_shopify_title: 'Lost Soul "Remiss" (II Chronicles 24:19) (LoC)',
    fix_category: 'lost_soul_bracket',
    fix_description: 'Convert bracket [Scripture] → (Scripture) and rearrange to Shopify format',
  },
  {
    card_name: 'Lost Soul "Shame" [Jeremiah 3:25 - LR]',
    set_code: 'LoC',
    expected_shopify_title: 'Lost Soul (Jeremiah 3:25) "Shame" (Legacy Rare)',
    fix_category: 'lost_soul_bracket_lr',
    fix_description: 'Convert [Scripture - LR] → (Scripture) (Legacy Rare)',
  },
  {
    card_name: 'Lost Soul "Thorns" [II Samuel 23:6 - LR]',
    set_code: 'LoC',
    expected_shopify_title: 'Lost Soul (II Samuel 23:6) "Thorns" (Legacy Rare)',
    fix_category: 'lost_soul_bracket_lr',
    fix_description: 'Convert [Scripture - LR] → (Scripture) (Legacy Rare)',
  },
  {
    card_name: 'Lost Soul "Salty" [Matthew 5:13]',
    set_code: 'GoC',
    expected_shopify_title: 'Lost Soul "Salty" (Matthew 5:13) (GoC) (errata/corrected)',
    fix_category: 'lost_soul_bracket',
    fix_description: 'Convert bracket [Scripture] → (Scripture); also needs errata suffix handling in fuzzy',
  },
  {
    card_name: 'Lost Soul "Shut Door" [Luke 13:25 - LR]',
    set_code: 'GoC',
    expected_shopify_title: 'Lost Soul "Shut Door" (Luke 13:25) (Legacy Rare)',
    fix_category: 'lost_soul_bracket_lr',
    fix_description: 'Convert [Scripture - LR] → (Scripture) (Legacy Rare)',
  },

  // ── Capitalization mismatch ──
  {
    card_name: 'He is Risen (GoC)',
    set_code: 'GoC',
    expected_shopify_title: 'He Is Risen (RoA)',
    fix_category: 'capitalization',
    fix_description: '"He is Risen" vs "He Is Risen" — lowercase "is" in carddata, uppercase "Is" in Shopify. Also different set (RoA vs GoC) but same card.',
  },

  // ── Apostrophe/spelling mismatch ──
  {
    card_name: "Nicolatian's Teaching (RoJ AB)",
    set_code: 'RoJ (AB)',
    expected_shopify_title: "Nicolaitans' Teaching (RoJ)",
    fix_category: 'spelling',
    fix_description: '"Nicolatian\'s" vs "Nicolaitans\'" — different spelling + possessive form',
  },

  // ── Promos with year format mismatch ──
  // Carddata: "Name (YYYY Promo)" → Shopify: "Name (YYYY National - Participant/Topcut) (Promo)"
  {
    card_name: 'Captain of the Host (2016 Promo)',
    set_code: 'Pmo-P2',
    expected_shopify_title: 'Captain of the Host (PoC)',
    fix_category: 'promo_fallback',
    fix_description: 'No promo-specific product exists; fall back to cheapest non-promo version',
  },
  {
    card_name: 'Mayhem (2020 Promo)',
    set_code: 'Pmo-P2',
    expected_shopify_title: 'Mayhem (2020 National - Participant) (Promo)',
    fix_category: 'promo_year',
    fix_description: '"(2020 Promo)" → "(2020 National - Participant) (Promo)" — different event naming',
  },
  {
    card_name: 'Humble Seeker',
    set_code: 'Pmo-P2',
    expected_shopify_title: 'Humble Seeker (2021 National - Participant) (Promo)',
    fix_category: 'promo_no_suffix',
    fix_description: 'Carddata has no promo suffix but Shopify has full event name',
  },
  {
    card_name: 'Moses (Promo)',
    set_code: 'Pmo-P2',
    expected_shopify_title: 'Moses (Pr)',
    fix_category: 'promo_fallback',
    fix_description: 'No promo-specific product; fall back to cheapest non-promo version',
  },
  {
    card_name: 'Paul (Promo)',
    set_code: 'Pmo-P2',
    expected_shopify_title: 'Saul/Paul (Ap)',
    fix_category: 'promo_fallback_name_mismatch',
    fix_description: 'No promo-specific product; different name "Paul" vs "Saul/Paul"',
  },
  {
    card_name: 'Scattered (Promo)',
    set_code: 'Pmo-P2',
    expected_shopify_title: 'Scattered (2021 National - Topcut) (Promo)',
    fix_category: 'promo_no_year',
    fix_description: 'Carddata has "(Promo)" but Shopify has full event naming',
  },
  {
    card_name: 'Shipwreck (Promo)',
    set_code: 'Pmo-P2',
    expected_shopify_title: 'Shipwreck (Ap)',
    fix_category: 'promo_fallback',
    fix_description: 'No promo-specific product; fall back to cheapest non-promo version',
  },
  {
    card_name: 'The Angel of the Winds (Promo)',
    set_code: 'Pmo-P2',
    expected_shopify_title: 'The Angel of the Winds (CoW)',
    fix_category: 'promo_fallback',
    fix_description: 'No promo-specific product; fall back to cheapest non-promo version',
  },
  {
    card_name: 'The Tabernacle (Promo)',
    set_code: 'Pmo-P2',
    expected_shopify_title: 'The Tabernacle (Pi)',
    fix_category: 'promo_fallback',
    fix_description: 'No promo-specific product; fall back to cheapest non-promo version',
  },
  {
    card_name: 'Tribute [2023 - Seasonal]',
    set_code: 'Pmo-P3',
    expected_shopify_title: 'Tribute (Promo)',
    fix_category: 'promo_bracket',
    fix_description: 'Carddata uses [YYYY - Event] bracket format, Shopify uses "(Promo)"',
  },
  {
    card_name: 'I Am Grace [2026 - Regional]',
    set_code: 'Pmo-P3',
    expected_shopify_title: 'I am Grace (AW)',
    fix_category: 'promo_fallback_case',
    fix_description: 'No promo product; "I Am Grace" vs "I am Grace" capitalization + fall back to non-promo',
  },
];

// ─── Test runner ───

async function main() {
  const supabase = getSupabaseAdmin();
  let passed = 0;
  let failed = 0;
  let total = 0;

  // Load Shopify products for verification
  const allProducts: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('shopify_products')
      .select('id, title')
      .eq('product_type', 'Single')
      .range(offset, offset + 999);
    if (error) throw error;
    allProducts.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  const titleToId = new Map(allProducts.map(p => [normalize(stripShopifySuffixes(p.title)), p.id]));
  const titleToRaw = new Map(allProducts.map(p => [normalize(stripShopifySuffixes(p.title)), p.title]));

  console.log(`Loaded ${allProducts.length} Shopify products\n`);

  // ── Test no_price_exists cards ──
  console.log('=== NO PRICE EXISTS (should remain unmatched) ===\n');
  for (const card of NO_PRICE_EXISTS) {
    total++;
    // Verify these don't have obvious Shopify matches
    const { data } = await supabase.rpc('fuzzy_match_shopify_product', {
      search_term: card.card_name,
      min_similarity: 0.85,
      max_results: 1,
    });
    const hasHighMatch = data?.length > 0;
    if (hasHighMatch) {
      console.log(`  WARN "${card.card_name}" — has high-confidence Shopify match: "${data[0].title}" (${data[0].score.toFixed(3)})`);
      console.log(`        Reason given: ${card.reason}`);
      failed++;
    } else {
      console.log(`  OK   "${card.card_name}" — ${card.reason}`);
      passed++;
    }
  }

  // ── Test solvable cards ──
  console.log('\n=== SOLVABLE (should be matchable with improvements) ===\n');

  // Group by fix category for summary
  const fixCategories: Record<string, { total: number; verified: number; cards: string[] }> = {};

  for (const card of SOLVABLE) {
    total++;
    if (!fixCategories[card.fix_category]) {
      fixCategories[card.fix_category] = { total: 0, verified: 0, cards: [] };
    }
    fixCategories[card.fix_category].total++;

    // Verify the expected Shopify product actually exists (exact or fuzzy 0.95+)
    const expectedNorm = normalize(stripShopifySuffixes(card.expected_shopify_title));
    let productId = titleToId.get(expectedNorm);
    let matchedTitle = card.expected_shopify_title;

    // Fallback: fuzzy match handles curly quotes and other Unicode differences
    if (!productId) {
      const { data } = await supabase.rpc('fuzzy_match_shopify_product', {
        search_term: card.expected_shopify_title,
        min_similarity: 0.95,
        max_results: 1,
      });
      if (data?.length) {
        productId = data[0].id;
        matchedTitle = data[0].title;
      }
    }

    if (productId) {
      console.log(`  OK   "${card.card_name}" → "${matchedTitle}"`);
      console.log(`        Fix: [${card.fix_category}] ${card.fix_description}`);
      fixCategories[card.fix_category].verified++;
      fixCategories[card.fix_category].cards.push(card.card_name);
      passed++;
    } else {
      // Try broader fuzzy to show what's available
      const { data } = await supabase.rpc('fuzzy_match_shopify_product', {
        search_term: card.expected_shopify_title,
        min_similarity: 0.5,
        max_results: 3,
      });
      console.log(`  FAIL "${card.card_name}" — expected product not found: "${card.expected_shopify_title}"`);
      if (data?.length) {
        console.log(`        Closest matches:`);
        for (const r of data) {
          console.log(`          ${r.score.toFixed(3)} | "${r.title}"`);
        }
      }
      failed++;
    }
  }

  // ── Summary ──
  console.log('\n' + '='.repeat(60));
  console.log(`RESULTS: ${passed}/${total} passed, ${failed} failed`);
  console.log(`  No-price cards: ${NO_PRICE_EXISTS.length}`);
  console.log(`  Solvable cards: ${SOLVABLE.length}`);
  console.log(`  Total unmatched accounted for: ${NO_PRICE_EXISTS.length + SOLVABLE.length}/42`);

  console.log('\n=== Fix Categories (solvable cards) ===\n');
  for (const [cat, info] of Object.entries(fixCategories).sort((a, b) => b[1].total - a[1].total)) {
    const status = info.verified === info.total ? 'VERIFIED' : `${info.verified}/${info.total} verified`;
    console.log(`  [${cat}] ${info.total} cards — ${status}`);
    for (const name of info.cards) {
      console.log(`    - ${name}`);
    }
  }

  console.log('\n=== Implementation Priority ===\n');
  console.log('  1. lost_soul_bracket + lost_soul_bracket_lr (9 cards)');
  console.log('     → Add Pass 2.5: Convert bracket notation to paren format');
  console.log('  2. promo_fallback (5 cards)');
  console.log('     → Strip "(Promo)" and match to cheapest non-promo version');
  console.log('  3. promo_year + promo_no_year + promo_no_suffix (4 cards)');
  console.log('     → Expand "(YYYY Promo)" to "(YYYY National - *) (Promo)" patterns');
  console.log('  4. spelling + capitalization (2 cards)');
  console.log('     → Case-insensitive matching or manual mapping');
  console.log('  5. promo_bracket + promo_fallback_case + promo_fallback_name_mismatch (3 cards)');
  console.log('     → Edge cases requiring special handling');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
