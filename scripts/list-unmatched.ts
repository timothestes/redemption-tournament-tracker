#!/usr/bin/env npx tsx
/**
 * List all unmatched and needs_review cards from card_price_mappings.
 * Usage: npx tsx scripts/list-unmatched.ts
 */

import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(__dirname, '..', '.env.local') });

import { getSupabaseAdmin } from '../lib/pricing/supabase-admin';

async function main() {
  const supabase = getSupabaseAdmin();

  // Get counts by status
  const { data: statusCounts, error: countError } = await supabase
    .from('card_price_mappings')
    .select('status');

  if (countError) {
    console.error('Error:', countError.message);
    process.exit(1);
  }

  const counts: Record<string, number> = {};
  for (const row of statusCounts ?? []) {
    counts[row.status] = (counts[row.status] || 0) + 1;
  }
  console.log('\n=== Status Counts ===');
  for (const [status, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`);
  }

  // Get all unmatched cards
  const allUnmatched: any[] = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('card_price_mappings')
      .select('card_key, card_name, set_code, match_method, confidence, status')
      .in('status', ['unmatched', 'needs_review'])
      .order('set_code')
      .order('card_name')
      .range(offset, offset + pageSize - 1);
    if (error) {
      console.error('Error:', error.message);
      break;
    }
    allUnmatched.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }

  // Group by set
  const bySet: Record<string, any[]> = {};
  for (const card of allUnmatched) {
    const set = card.set_code;
    if (!bySet[set]) bySet[set] = [];
    bySet[set].push(card);
  }

  console.log(`\n=== Unmatched/Needs Review: ${allUnmatched.length} cards ===\n`);

  for (const [set, cards] of Object.entries(bySet).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`--- ${set} (${cards.length} cards) ---`);
    for (const c of cards) {
      const status = c.status === 'needs_review' ? ' [REVIEW]' : '';
      const conf = c.confidence > 0 ? ` (conf: ${c.confidence})` : '';
      console.log(`  ${c.card_name}${status}${conf}`);
    }
    console.log('');
  }

  // Also get some sample Shopify titles for context
  console.log('\n=== Sample Shopify Products (for reference) ===');
  const unmatchedSets = Object.keys(bySet);
  for (const setCode of unmatchedSets.slice(0, 5)) {
    // Try to find shopify products that might match
    const sampleCards = bySet[setCode].slice(0, 3);
    for (const card of sampleCards) {
      const cleanName = card.card_name.replace(/\s*\([^)]*\)\s*$/, '');
      const { data: fuzzyResults } = await supabase.rpc('fuzzy_match_shopify_product', {
        search_term: cleanName,
        min_similarity: 0.3,
        max_results: 3,
      });
      if (fuzzyResults?.length) {
        console.log(`  "${card.card_name}" (${setCode}) → closest Shopify:`);
        for (const r of fuzzyResults) {
          console.log(`    "${r.title}" (score: ${r.score.toFixed(3)})`);
        }
      }
    }
  }
}

main().catch(console.error);
