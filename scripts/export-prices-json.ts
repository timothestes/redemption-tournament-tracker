#!/usr/bin/env npx tsx
/**
 * Export card_prices table to public/prices.json as a static file fallback.
 *
 * Usage: npx tsx scripts/export-prices-json.ts
 */

import { join } from 'path';
import { writeFileSync } from 'fs';
import { config } from 'dotenv';

config({ path: join(__dirname, '..', '.env.local') });

import { getSupabaseAdmin } from '../lib/pricing/supabase-admin';
import type { PricesResponse } from '../lib/pricing/types';

async function main() {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('card_prices')
    .select('card_key, price, shopify_handle, shopify_title, updated_at');

  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  const prices: PricesResponse['prices'] = {};
  let latestUpdate = '';

  for (const row of data ?? []) {
    prices[row.card_key] = {
      price: parseFloat(row.price),
      shopify_handle: row.shopify_handle,
      shopify_title: row.shopify_title,
    };
    if (row.updated_at > latestUpdate) latestUpdate = row.updated_at;
  }

  const output: PricesResponse = {
    updated_at: latestUpdate || new Date().toISOString(),
    prices,
  };

  const outPath = join(__dirname, '..', 'public', 'prices.json');
  writeFileSync(outPath, JSON.stringify(output));
  console.log(`Exported ${Object.keys(prices).length} prices to ${outPath}`);
}

main().catch(console.error);
