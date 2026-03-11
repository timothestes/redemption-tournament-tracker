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
  console.log('\n=== Final Summary ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(console.error);
