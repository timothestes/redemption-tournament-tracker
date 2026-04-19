---
name: update-price
description: Manually update or remove a card's price in the Supabase database. Use when the user wants to set a specific price, fix a mismatch, or remove a price for a card.
argument-hint: <card-name> <price|remove> [ytg-url]
allowed-tools: Bash, Read, Grep
---

# Update Card Price

Manually update a card's price in the `card_prices` and `card_price_mappings` Supabase tables.

## Arguments

The user will provide:
- **Card name** and/or set info (e.g., "Son of God (2019) (Promo)", set "Pmo-P2")
- **Price** to set (a dollar amount), OR "remove"/"0" to remove the price entirely
- **YTG URL** (optional) — the Shopify product URL for the correct match

## Steps

### 1. Find the card in the database

Run a Supabase query to find the card's `card_key` from `card_price_mappings`:

```bash
npx tsx -e "
const { config } = require('dotenv');
config({ path: '.env.local' });
const { getSupabaseAdmin } = require('./lib/pricing/supabase-admin');
const s = getSupabaseAdmin();
async function main() {
  const { data } = await s.from('card_price_mappings')
    .select('card_key, card_name, set_code, shopify_product_id, match_method, status')
    .ilike('card_name', '%CARD_NAME_PATTERN%');
  console.log(JSON.stringify(data, null, 2));
}
main();
"
```

If the user provided a set code, add `.eq('set_code', 'SET_CODE')` to narrow results.

### 2. If a YTG URL is provided, find the Shopify product

Extract the handle from the URL (the last path segment) and look it up:

```bash
npx tsx -e "
const { config } = require('dotenv');
config({ path: '.env.local' });
const { getSupabaseAdmin } = require('./lib/pricing/supabase-admin');
const s = getSupabaseAdmin();
async function main() {
  const { data } = await s.from('shopify_products')
    .select('id, title, handle, price')
    .eq('handle', 'HANDLE_HERE');
  console.log(JSON.stringify(data, null, 2));
}
main();
"
```

### 3. Update the records

#### To set a specific price:

Update both `card_price_mappings` and `card_prices`:

```bash
npx tsx -e "
const { config } = require('dotenv');
config({ path: '.env.local' });
const { getSupabaseAdmin } = require('./lib/pricing/supabase-admin');
const s = getSupabaseAdmin();
async function main() {
  const cardKey = 'CARD_KEY';

  // Update mapping
  await s.from('card_price_mappings').update({
    shopify_product_id: 'PRODUCT_ID_OR_NULL',
    confidence: 1.0,
    match_method: 'manual',
    status: 'manual',
    updated_at: new Date().toISOString(),
  }).eq('card_key', cardKey);

  // Upsert price
  await s.from('card_prices').upsert({
    card_key: cardKey,
    price: PRICE,
    shopify_handle: 'HANDLE',
    shopify_title: 'TITLE',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'card_key' });

  // Verify
  const { data } = await s.from('card_prices').select('*').eq('card_key', cardKey);
  console.log(JSON.stringify(data, null, 2));
}
main();
"
```

#### To remove a price (set to 0 / not for sale):

```bash
npx tsx -e "
const { config } = require('dotenv');
config({ path: '.env.local' });
const { getSupabaseAdmin } = require('./lib/pricing/supabase-admin');
const s = getSupabaseAdmin();
async function main() {
  const cardKey = 'CARD_KEY';

  // Set mapping to no_price_exists
  await s.from('card_price_mappings').update({
    shopify_product_id: null,
    confidence: 0,
    match_method: 'none',
    status: 'no_price_exists',
    updated_at: new Date().toISOString(),
  }).eq('card_key', cardKey);

  // Remove from card_prices
  await s.from('card_prices').delete().eq('card_key', cardKey);

  console.log('Removed price for:', cardKey);
}
main();
"
```

### 4. Confirm the result

Always verify the update by querying the final state and reporting back to the user:
- Card name and key
- New price (or "removed")
- Shopify product title (if applicable)

## Important notes

- The `card_key` format is `name|set_code|img_file`
- When the user says "set to 0" or "not for sale", remove the price entirely (delete from `card_prices`, set `no_price_exists` in mappings)
- When the user provides a YTG URL, extract the handle and look up the product to get the correct `shopify_product_id`
- Always set `match_method: 'manual'` and `status: 'manual'` for user-specified prices
- If a card maps to a bundle (e.g., "half of this product"), set the price to the user-specified amount, not the product's full price
