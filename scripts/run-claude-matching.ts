#!/usr/bin/env npx tsx
/**
 * Claude-assisted matching (Pass 5) for cards that couldn't be auto-matched.
 * Results go to needs_review — nothing goes live without admin approval.
 *
 * Usage:
 *   npx tsx scripts/run-claude-matching.ts
 *   npx tsx scripts/run-claude-matching.ts --limit 100
 *   npx tsx scripts/run-claude-matching.ts --set GoC
 */

import { join } from 'path';
import { config } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

config({ path: join(__dirname, '..', '.env.local') });

import { getSupabaseAdmin } from '../lib/pricing/supabase-admin';

interface CardWithCandidates {
  card_key: string;
  card_name: string;
  set_code: string;
  official_set: string;
  type: string;
  brigade: string;
  candidates: { id: string; title: string; tags: string }[];
}

const systemPrompt = `You are matching trading card names between two datasets for a card game called Redemption CCG.
You will be given a card from the deck builder and a list of candidate products from a Shopify store.
Your job is to identify which candidate (if any) is the same card.

Rules:
- The same card can have slightly different name formatting between datasets
- Set abbreviations differ between datasets (e.g. "Pri" in carddata = "Pi" in Shopify)
- A card name may have an embedded set suffix like "(Pi)" or "[T2C]" that should be ignored when matching
- Prefer no match over a wrong match
- Return ONLY valid JSON, no explanation text outside the JSON

Response format:
{
  "matches": [
    {
      "card_key": "the exact card_key provided",
      "shopify_id": "the shopify product id, or null if no confident match",
      "confidence": 0.0 to 1.0,
      "reasoning": "brief explanation"
    }
  ]
}`;

function buildUserPrompt(cards: CardWithCandidates[]): string {
  return `Match each of these cards to a Shopify product if possible:

${cards.map(c => `
CARD: ${c.card_key}
  Name: ${c.card_name}
  Set code: ${c.set_code}
  Official set: ${c.official_set}
  Type: ${c.type}
  Brigade: ${c.brigade}

  CANDIDATES:
  ${c.candidates.length > 0
    ? c.candidates.map(cand => `  - id: ${cand.id} | title: "${cand.title}" | tags: ${cand.tags}`).join('\n')
    : '  (no candidates found)'}
`).join('\n---\n')}`;
}

async function main() {
  const args = process.argv.slice(2);
  let limit = 50;
  let setFilter: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit') limit = parseInt(args[++i]);
    if (args[i] === '--set') setFilter = args[++i];
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is required');
    process.exit(1);
  }

  const anthropic = new Anthropic({ apiKey });
  const supabase = getSupabaseAdmin();

  // Get unmatched/needs_review cards
  let query = supabase
    .from('card_price_mappings')
    .select('card_key, card_name, set_code')
    .in('status', ['unmatched', 'needs_review'])
    .limit(limit);

  if (setFilter) {
    query = query.eq('set_code', setFilter);
  }

  const { data: unmatchedCards, error } = await query;
  if (error) {
    console.error('Error loading unmatched cards:', error.message);
    process.exit(1);
  }

  if (!unmatchedCards || unmatchedCards.length === 0) {
    console.log('No unmatched cards to process.');
    return;
  }

  console.log(`Processing ${unmatchedCards.length} unmatched cards...`);

  // For each card, get fuzzy candidates from Shopify
  const cardsWithCandidates: CardWithCandidates[] = [];
  for (const card of unmatchedCards) {
    const { data: candidates } = await supabase.rpc('fuzzy_match_shopify_product', {
      search_term: card.card_name,
      min_similarity: 0.3,
      max_results: 3,
    });

    cardsWithCandidates.push({
      card_key: card.card_key,
      card_name: card.card_name,
      set_code: card.set_code,
      official_set: '',
      type: '',
      brigade: '',
      candidates: candidates ?? [],
    });
  }

  // Process in batches of 50
  const batchSize = 50;
  let totalMatched = 0;

  for (let i = 0; i < cardsWithCandidates.length; i += batchSize) {
    const batch = cardsWithCandidates.slice(i, i + batchSize);
    console.log(`\nBatch ${i / batchSize + 1}: ${batch.length} cards`);

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: buildUserPrompt(batch) }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('  No JSON found in response');
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const matches = parsed.matches || [];

      for (const match of matches) {
        if (match.shopify_id && match.confidence >= 0.7) {
          const { error: updateError } = await supabase
            .from('card_price_mappings')
            .update({
              shopify_product_id: match.shopify_id,
              confidence: match.confidence,
              match_method: 'claude',
              status: 'needs_review',
              claude_reasoning: match.reasoning,
              updated_at: new Date().toISOString(),
            })
            .eq('card_key', match.card_key);

          if (!updateError) {
            totalMatched++;
            console.log(`  Matched: ${match.card_key} → ${match.shopify_id} (${match.confidence})`);
          }
        } else {
          console.log(`  No match: ${match.card_key} — ${match.reasoning || 'no confident match'}`);
        }
      }
    } catch (err) {
      console.error(`  Batch error:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nDone! Claude matched ${totalMatched} cards (all set to needs_review).`);
}

main().catch(console.error);
