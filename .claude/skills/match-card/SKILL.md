---
name: match-card
description: Match a card to a specific Shopify product by providing the card name and YTG URL. Automatically pulls the price from Shopify.
argument-hint: <card-name> <ytg-url>
allowed-tools: Bash, Read, Grep
---

# Match Card to Shopify Product

Match a card to a specific YTG Shopify product. Unlike `/update-price`, this pulls the price automatically from the Shopify product rather than requiring the user to specify it.

## Arguments

The user will provide:
- **Card name** (and optionally set code)
- **YTG URL** — e.g., `https://www.yourturngames.biz/products/some-product-handle`

## Steps

### 1. Extract the Shopify handle from the URL

The handle is the last path segment of the URL: `https://www.yourturngames.biz/products/HANDLE`

### 2. Look up both the card and the Shopify product

```bash
npx tsx -e "
const { config } = require('dotenv');
config({ path: '.env.local' });
const { getSupabaseAdmin } = require('./lib/pricing/supabase-admin');
const s = getSupabaseAdmin();

async function main() {
  // Find the card
  const { data: mappings } = await s.from('card_price_mappings')
    .select('card_key, card_name, set_code, shopify_product_id, status')
    .ilike('card_name', '%CARD_NAME%');
  console.log('Cards found:', JSON.stringify(mappings, null, 2));

  // Find the Shopify product
  const { data: products } = await s.from('shopify_products')
    .select('id, title, handle, price, inventory_quantity')
    .eq('handle', 'HANDLE');
  console.log('Shopify product:', JSON.stringify(products, null, 2));
}
main();
"
```

### 3. Confirm with the user

Before updating, show:
- Card: name, set, current status
- Will match to: Shopify title, price
- Ask: "Match [card] to [product] at $X.XX?"

If the card name is ambiguous (multiple results), ask the user to clarify which one.

### 4. Apply the match

```bash
npx tsx -e "
const { config } = require('dotenv');
config({ path: '.env.local' });
const { getSupabaseAdmin } = require('./lib/pricing/supabase-admin');
const s = getSupabaseAdmin();

async function main() {
  const cardKey = 'CARD_KEY';
  const productId = 'PRODUCT_ID';
  const price = PRICE;
  const handle = 'HANDLE';
  const title = 'SHOPIFY_TITLE';

  // Update mapping
  const { error: e1 } = await s.from('card_price_mappings').update({
    shopify_product_id: productId,
    confidence: 1.0,
    match_method: 'manual',
    status: 'manual',
    updated_at: new Date().toISOString(),
  }).eq('card_key', cardKey);
  if (e1) console.error('Mapping error:', e1.message);

  // Upsert price
  const { error: e2 } = await s.from('card_prices').upsert({
    card_key: cardKey,
    price,
    shopify_handle: handle,
    shopify_title: title,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'card_key' });
  if (e2) console.error('Price error:', e2.message);

  // Verify
  const { data } = await s.from('card_prices').select('*').eq('card_key', cardKey);
  console.log('Updated:', JSON.stringify(data, null, 2));
}
main();
"
```

### 5. Report the result

- Card name and set
- Matched to: Shopify product title
- Price: $X.XX (from Shopify)
- YTG URL: the provided URL
