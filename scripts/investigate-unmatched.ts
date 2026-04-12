#!/usr/bin/env npx tsx
/**
 * Investigate each unmatched card — find closest Shopify products and classify.
 */

import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(__dirname, '..', '.env.local') });

import { getSupabaseAdmin } from '../lib/pricing/supabase-admin';
import { stripEmbeddedSet } from '../lib/pricing/helpers';

const UNMATCHED = [
  // Pmo-P2
  { name: 'Captain of the Host (2016 Promo)', set: 'Pmo-P2' },
  { name: 'Humble Seeker', set: 'Pmo-P2' },
  { name: 'Lost Soul Token NT (Majestic Heavens)', set: 'Pmo-P2' },
  { name: 'Lost Soul Token OT (Majestic Heavens)', set: 'Pmo-P2' },
  { name: 'Mayhem (2020 Promo)', set: 'Pmo-P2' },
  { name: 'Moses (Promo)', set: 'Pmo-P2' },
  { name: 'Paul (Promo)', set: 'Pmo-P2' },
  { name: 'Scattered (Promo)', set: 'Pmo-P2' },
  { name: 'Shipwreck (Promo)', set: 'Pmo-P2' },
  { name: 'The Angel of the Winds (Promo)', set: 'Pmo-P2' },
  { name: 'The Tabernacle (Promo)', set: 'Pmo-P2' },
  // GoC
  { name: 'Follower Token', set: 'GoC' },
  { name: 'He is Risen (GoC)', set: 'GoC' },
  { name: 'Lost Soul "Salty" [Matthew 5:13]', set: 'GoC' },
  { name: 'Lost Soul "Shut Door" [Luke 13:25 - LR]', set: 'GoC' },
  { name: 'Proselyte Token', set: 'GoC' },
  { name: 'Violent Possessor Token', set: 'GoC' },
  { name: 'Wicked Spirit Token', set: 'GoC' },
  // Ap
  { name: 'Pharisees - John 8:3-4', set: 'Ap' },
  { name: 'Pharisees - Orange Background', set: 'Ap' },
  { name: 'Pharisees - Red Background', set: 'Ap' },
  { name: 'Sadducees - Group of 10', set: 'Ap' },
  { name: 'Sadducees - Group of 4', set: 'Ap' },
  { name: 'Sadducees - Group of 6', set: 'Ap' },
  // FoM
  { name: 'Lost Soul "6/*" [Deuteronomy 32:15]', set: 'FoM' },
  { name: 'Lost Soul "Hopper" [II Chronicles 28:13 - LR]', set: 'FoM' },
  { name: 'Lost Soul "Punisher" [Jeremiah 17:9 - LR]', set: 'FoM' },
  { name: 'Lost Soul "Wanderer" [Ezekiel 34:6 - LR]', set: 'FoM' },
  // LoC
  { name: 'Lost Soul "Remiss" [II Chronicles 24:19]', set: 'LoC' },
  { name: 'Lost Soul "Shame" [Jeremiah 3:25 - LR]', set: 'LoC' },
  { name: 'Lost Soul "Thorns" [II Samuel 23:6 - LR]', set: 'LoC' },
  // AW
  { name: 'Obsidian Minion - Dark Gray Background', set: 'AW' },
  { name: 'Obsidian Minion - Light Gray Background', set: 'AW' },
  { name: 'Shadow - Hand or Storehouse', set: 'AW' },
  // Pmo-P3
  { name: 'Tribute [2023 - Seasonal]', set: 'Pmo-P3' },
  { name: 'Lost Soul Token OT [2024 - Nationals]', set: 'Pmo-P3' },
  { name: 'I Am Grace [2026 - Regional]', set: 'Pmo-P3' },
  // War
  { name: 'Seraphim - Isaiah 6:2', set: 'War' },
  { name: 'Seraphim - Isaiah 6:6', set: 'War' },
  // RR
  { name: 'Lost Soul Token "Lost Souls" [Proverbs 2:16-17]', set: 'RR' },
  // RoJ (AB)
  { name: "Nicolatian's Teaching (RoJ AB)", set: 'RoJ (AB)' },
  // PoC
  { name: 'Stricken Reminder Token', set: 'PoC' },
];

async function main() {
  const supabase = getSupabaseAdmin();

  for (const card of UNMATCHED) {
    const cleanName = stripEmbeddedSet(card.name);
    // Try multiple search terms
    const searchTerms = [card.name, cleanName];
    // Also try base name (before any dash descriptor)
    const dashBase = card.name.split(' - ')[0].trim();
    if (dashBase !== card.name) searchTerms.push(dashBase);
    // Strip bracket notation
    const bracketStripped = card.name.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
    if (bracketStripped !== card.name) searchTerms.push(bracketStripped);

    const seen = new Set<string>();
    const allResults: { title: string; score: number; id: string }[] = [];

    for (const term of [...new Set(searchTerms)]) {
      const { data } = await supabase.rpc('fuzzy_match_shopify_product', {
        search_term: term,
        min_similarity: 0.25,
        max_results: 5,
      });
      for (const r of data ?? []) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          allResults.push({ title: r.title, score: r.score, id: r.id });
        }
      }
    }

    allResults.sort((a, b) => b.score - a.score);

    console.log(`\n"${card.name}" (${card.set}) → stripped: "${cleanName}"`);
    if (allResults.length === 0) {
      console.log('  NO MATCHES FOUND');
    } else {
      for (const r of allResults.slice(0, 5)) {
        console.log(`  ${r.score.toFixed(3)} | "${r.title}"`);
      }
    }
  }
}

main().catch(console.error);
