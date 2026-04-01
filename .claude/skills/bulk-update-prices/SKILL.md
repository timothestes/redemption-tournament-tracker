---
name: bulk-update-prices
description: Update prices for multiple cards at once. Use when the user has a batch of cards to update, like a set of promos, fundraiser cards, or corrections from a spreadsheet.
argument-hint: <list of cards with prices>
allowed-tools: Bash, Read, Grep
---

# Bulk Update Prices

Update prices for multiple cards in a single operation.

## Arguments

The user will provide a list of cards with prices in any format. Common formats:
- Card name → $price
- Card name (Set) = $price
- A table/list of cards and prices
- "Set all [set] cards to no_price_exists"

## Steps

### 1. Parse the user's input

Extract card names, set codes (if provided), and target prices from whatever format the user gives.

### 2. Look up all cards in one query

```bash
npx tsx -e "
const { config } = require('dotenv');
config({ path: '.env.local' });
const { getSupabaseAdmin } = require('./lib/pricing/supabase-admin');
const s = getSupabaseAdmin();

async function main() {
  const cards = [
    { name: 'CARD1', set: 'SET1', price: PRICE1 },
    { name: 'CARD2', set: 'SET2', price: PRICE2 },
    // ... add all cards
  ];

  for (const c of cards) {
    let q = s.from('card_price_mappings')
      .select('card_key, card_name, set_code')
      .ilike('card_name', '%' + c.name + '%');
    if (c.set) q = q.eq('set_code', c.set);
    const { data } = await q;

    if (!data?.length) {
      console.log('NOT FOUND: ' + c.name + (c.set ? ' (' + c.set + ')' : ''));
      continue;
    }
    if (data.length > 1) {
      console.log('AMBIGUOUS: ' + c.name + ' — ' + data.length + ' matches:');
      data.forEach(d => console.log('  ' + d.card_key));
      continue;
    }
    console.log('FOUND: ' + data[0].card_key + ' -> \$' + c.price);
  }
}
main();
"
```

### 3. Show the user what will be changed

Present a table:
| Card | Set | Current Price | New Price | Status |
Before applying, ask: "Apply these N updates?"

### 4. Apply all updates

```bash
npx tsx -e "
const { config } = require('dotenv');
config({ path: '.env.local' });
const { getSupabaseAdmin } = require('./lib/pricing/supabase-admin');
const s = getSupabaseAdmin();

async function main() {
  const updates = [
    // { cardKey: '...', price: N, handle: '...', title: '...' }
    // OR for removals:
    // { cardKey: '...', remove: true }
  ];

  let success = 0;
  let errors = 0;

  for (const u of updates) {
    if (u.remove) {
      // Remove price
      await s.from('card_price_mappings').update({
        shopify_product_id: null, confidence: 0,
        match_method: 'none', status: 'no_price_exists',
        updated_at: new Date().toISOString(),
      }).eq('card_key', u.cardKey);
      await s.from('card_prices').delete().eq('card_key', u.cardKey);
      console.log('Removed: ' + u.cardKey.split('|')[0]);
    } else {
      // Set price
      const { error: e1 } = await s.from('card_price_mappings').update({
        confidence: 1.0, match_method: 'manual', status: 'manual',
        updated_at: new Date().toISOString(),
      }).eq('card_key', u.cardKey);

      const { error: e2 } = await s.from('card_prices').upsert({
        card_key: u.cardKey, price: u.price,
        shopify_handle: u.handle || 'manual',
        shopify_title: u.title || u.cardKey.split('|')[0],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'card_key' });

      if (e1 || e2) {
        console.log('ERROR: ' + u.cardKey.split('|')[0]);
        errors++;
      } else {
        console.log('Updated: ' + u.cardKey.split('|')[0] + ' -> \$' + u.price);
        success++;
      }
    }
  }

  console.log('\nDone: ' + success + ' updated, ' + errors + ' errors');
}
main();
"
```

### 5. Report results

- Number of cards updated successfully
- Any errors or cards not found
- Suggest running `/price-stats` to verify overall state
