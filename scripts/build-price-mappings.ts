#!/usr/bin/env npx tsx
/**
 * Full offline matching pipeline. Run to bootstrap price mappings.
 *
 * Usage:
 *   npx tsx scripts/build-price-mappings.ts
 *   npx tsx scripts/build-price-mappings.ts --passes 1,2
 *   npx tsx scripts/build-price-mappings.ts --set Ki,Pri
 *   npx tsx scripts/build-price-mappings.ts --force
 *   npx tsx scripts/build-price-mappings.ts --dry-run
 */

import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { config } from 'dotenv';

// Load env from .env.local
config({ path: join(__dirname, '..', '.env.local') });

import { runMatchingPipeline } from '../lib/pricing/matching';

function parseArgs() {
  const args = process.argv.slice(2);
  const options: {
    passes?: number[];
    setCodes?: string[];
    force?: boolean;
    dryRun?: boolean;
  } = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--passes':
        options.passes = args[++i].split(',').map(Number);
        break;
      case '--set':
        options.setCodes = args[++i].split(',');
        break;
      case '--force':
        options.force = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();
  console.log('Running matching pipeline with options:', options);
  const summary = await runMatchingPipeline(options);

  const { unmatchedCards, noPriceCards, ...counts } = summary;
  console.log('\n=== Final Summary ===');
  console.log(JSON.stringify(counts, null, 2));

  const outDir = join(__dirname, 'output');
  mkdirSync(outDir, { recursive: true });

  // Helper to group cards by set and write to file
  function writeCardList(cards: typeof unmatchedCards, filename: string, label: string) {
    if (!cards?.length) return;
    const bySet: Record<string, { card_name: string; card_key: string }[]> = {};
    for (const c of cards) {
      if (!bySet[c.set_code]) bySet[c.set_code] = [];
      bySet[c.set_code].push({ card_name: c.card_name, card_key: c.card_key });
    }

    const outPath = join(outDir, filename);
    writeFileSync(outPath, JSON.stringify(bySet, null, 2));
    console.log(`\n${cards.length} ${label} cards written to ${outPath}`);

    console.log(`\n=== ${label} ===`);
    for (const [set, setCards] of Object.entries(bySet).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${set} (${setCards.length}):`);
      for (const c of setCards) {
        console.log(`    ${c.card_name}`);
      }
    }
  }

  writeCardList(unmatchedCards, 'unmatched-cards.json', 'Unmatched');
  writeCardList(noPriceCards, 'no-price-exists.json', 'No Price Exists');
}

main().catch(console.error);
