---
name: price-stats
description: Show a summary dashboard of the card pricing system — total matched, unmatched, breakdown by method, and potential issues.
allowed-tools: Bash, Read, Grep
---

# Price Stats Dashboard

Show an overview of the card pricing system's current state.

## Run this query

```bash
npx tsx -e "
const { config } = require('dotenv');
config({ path: '.env.local' });
const { getSupabaseAdmin } = require('./lib/pricing/supabase-admin');
const s = getSupabaseAdmin();

async function main() {
  // Total mappings
  const { count: total } = await s.from('card_price_mappings').select('*', { count: 'exact', head: true });

  // By status
  const statuses = ['auto_matched', 'manual', 'no_price_exists', 'unmatched', 'needs_review'];
  const statusCounts = {};
  for (const st of statuses) {
    const { count } = await s.from('card_price_mappings').select('*', { count: 'exact', head: true }).eq('status', st);
    statusCounts[st] = count;
  }

  // By match method
  const { data: methods } = await s.rpc('get_match_method_counts') ?? { data: null };
  // Fallback: manual query
  let methodCounts = {};
  if (!methods) {
    const { data: allMappings } = await s.from('card_price_mappings').select('match_method');
    if (allMappings) {
      for (const m of allMappings) {
        const method = m.match_method || 'none';
        methodCounts[method] = (methodCounts[method] || 0) + 1;
      }
    }
  }

  // Total prices
  const { count: priceCount } = await s.from('card_prices').select('*', { count: 'exact', head: true });

  // Price range stats
  const { data: priceStats } = await s.from('card_prices').select('price').order('price', { ascending: false }).limit(10);
  const { data: cheapest } = await s.from('card_prices').select('card_key, price').order('price', { ascending: true }).limit(5);

  // Recently updated
  const { data: recent } = await s.from('card_prices').select('card_key, price, updated_at').order('updated_at', { ascending: false }).limit(5);

  // Shopify product count
  const { count: shopifyCount } = await s.from('shopify_products').select('*', { count: 'exact', head: true }).eq('product_type', 'Single');

  console.log('=== PRICE SYSTEM DASHBOARD ===');
  console.log();
  console.log('Total card mappings:', total);
  console.log('Total prices in card_prices:', priceCount);
  console.log('Shopify products (Singles):', shopifyCount);
  console.log();
  console.log('--- By Status ---');
  for (const [k, v] of Object.entries(statusCounts)) {
    console.log('  ' + k + ':', v);
  }
  console.log();
  console.log('--- By Match Method ---');
  for (const [k, v] of Object.entries(methodCounts).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + k + ':', v);
  }
  console.log();
  console.log('--- Most Expensive ---');
  if (priceStats) {
    for (const p of priceStats.slice(0, 10)) {
      console.log('  $' + p.price);
    }
  }
  console.log();
  console.log('--- Cheapest ---');
  if (cheapest) {
    for (const p of cheapest) {
      console.log('  $' + p.price + ' — ' + p.card_key.split('|')[0]);
    }
  }
  console.log();
  console.log('--- Recently Updated ---');
  if (recent) {
    for (const r of recent) {
      console.log('  $' + r.price + ' — ' + r.card_key.split('|')[0] + ' (' + r.updated_at + ')');
    }
  }
}
main();
"
```

## Present the results

Format as a clean dashboard with sections:
- **Overview**: total cards, matched count, price count, Shopify product count
- **By Status**: table of status counts
- **By Match Method**: table of method counts (sorted by frequency)
- **Most Expensive Cards**: top 10
- **Recently Updated**: last 5 price changes
- **Potential Issues**: highlight if unmatched > 0, needs_review > 0, or price count != matched count
