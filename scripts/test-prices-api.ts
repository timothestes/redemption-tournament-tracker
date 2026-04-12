#!/usr/bin/env npx tsx
/**
 * Integration test for the /api/prices endpoint.
 * Verifies that:
 *   1. The API returns all prices (not truncated by Supabase's 1000-row limit)
 *   2. Specific known cards have prices
 *   3. Price values are valid numbers
 *
 * Usage: npx tsx scripts/test-prices-api.ts [base-url]
 *   base-url defaults to http://localhost:3000
 */

import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(__dirname, '..', '.env.local') });

import { getSupabaseAdmin } from '../lib/pricing/supabase-admin';
import type { PricesResponse } from '../lib/pricing/types';

// Cards that should definitely have prices (spread across the alphabet to catch pagination issues)
const SPOT_CHECK_CARDS = [
  'Angel of the Lord',
  'Christian Martyr',
  'Grapes of Wrath',
  'King David',
  'New Jerusalem',
  'Son of God',
  'The Second Coming',
  'Zaccheus',
];

async function main() {
  const baseUrl = process.argv[2] || 'http://localhost:3000';
  let passed = 0;
  let failed = 0;

  function pass(msg: string) {
    console.log(`  OK   ${msg}`);
    passed++;
  }

  function fail(msg: string) {
    console.log(`  FAIL ${msg}`);
    failed++;
  }

  // ── Get expected count from DB ──
  const supabase = getSupabaseAdmin();
  const { count: dbCount } = await supabase
    .from('card_prices')
    .select('*', { count: 'exact', head: true });

  console.log(`DB has ${dbCount} card_prices rows\n`);

  // ── Fetch from API ──
  console.log(`Fetching ${baseUrl}/api/prices ...\n`);
  const res = await fetch(`${baseUrl}/api/prices`);

  if (!res.ok) {
    fail(`API returned ${res.status}: ${res.statusText}`);
    process.exit(1);
  }

  const data: PricesResponse = await res.json();
  const priceCount = Object.keys(data.prices).length;

  console.log('=== Row Count ===\n');

  // Test 1: All rows returned (not truncated at 1000)
  if (priceCount === dbCount) {
    pass(`API returned all ${priceCount} prices (matches DB count)`);
  } else {
    fail(`API returned ${priceCount} prices but DB has ${dbCount} (${dbCount! - priceCount} missing)`);
  }

  // Test 2: More than 1000 rows (catches the pagination bug)
  if (priceCount > 1000) {
    pass(`Returns ${priceCount} rows (above Supabase's 1000 default limit)`);
  } else if (dbCount! > 1000) {
    fail(`Only ${priceCount} rows returned — likely missing pagination (DB has ${dbCount})`);
  } else {
    pass(`DB only has ${dbCount} rows, pagination not needed yet`);
  }

  // ── Spot check specific cards ──
  console.log('\n=== Spot Check Cards ===\n');

  for (const cardName of SPOT_CHECK_CARDS) {
    const match = Object.entries(data.prices).find(([key]) =>
      key.toLowerCase().startsWith(cardName.toLowerCase() + ' (') ||
      key.toLowerCase().startsWith(cardName.toLowerCase() + '|')
    );

    if (match) {
      const [key, info] = match;
      if (typeof info.price === 'number' && info.price > 0) {
        pass(`"${cardName}" → $${info.price.toFixed(2)}`);
      } else {
        fail(`"${cardName}" found but invalid price: ${info.price}`);
      }
    } else {
      fail(`"${cardName}" not found in API response`);
    }
  }

  // ── Validate price values ──
  console.log('\n=== Price Validation ===\n');

  let invalidPrices = 0;
  let missingHandles = 0;
  for (const [key, info] of Object.entries(data.prices)) {
    if (typeof info.price !== 'number' || isNaN(info.price) || info.price <= 0) {
      invalidPrices++;
      if (invalidPrices <= 3) console.log(`    Invalid price for "${key}": ${info.price}`);
    }
    if (!info.shopify_handle) {
      missingHandles++;
    }
  }

  if (invalidPrices === 0) {
    pass('All prices are valid positive numbers');
  } else {
    fail(`${invalidPrices} cards have invalid prices`);
  }

  if (missingHandles === 0) {
    pass('All cards have Shopify handles');
  } else {
    fail(`${missingHandles} cards missing Shopify handles`);
  }

  // ── Updated timestamp ──
  if (data.updated_at) {
    const age = Date.now() - new Date(data.updated_at).getTime();
    const ageHours = Math.round(age / 3600000);
    if (ageHours < 24 * 7) {
      pass(`Last updated ${ageHours}h ago`);
    } else {
      fail(`Prices are ${ageHours}h old (> 1 week)`);
    }
  }

  // ── Summary ──
  console.log('\n' + '='.repeat(50));
  console.log(`RESULTS: ${passed}/${passed + failed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
