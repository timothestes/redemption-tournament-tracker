---
name: check-price
description: Look up a card's current price, mapping status, and Shopify match. Use when the user wants to check what price a card has, whether it's matched correctly, or debug a pricing issue.
argument-hint: <card-name> [set-code]
allowed-tools: Bash, Read, Grep
---

# Check Card Price

Look up a card's current pricing state across all relevant tables without modifying anything.

## Arguments

The user will provide:
- **Card name** (full or partial, e.g., "Son of God", "Abeyance")
- **Set code** (optional, e.g., "Pmo-P2", "RR", "GoC")

## Steps

### 1. Query all relevant tables in one script

```bash
npx tsx -e "
const { config } = require('dotenv');
config({ path: '.env.local' });
const { getSupabaseAdmin } = require('./lib/pricing/supabase-admin');
const s = getSupabaseAdmin();

async function main() {
  const pattern = '%CARD_NAME_PATTERN%';

  // Mapping
  let q = s.from('card_price_mappings')
    .select('card_key, card_name, set_code, shopify_product_id, confidence, match_method, status, updated_at')
    .ilike('card_name', pattern);
  // Add .eq('set_code', 'SET') if set provided
  const { data: mappings } = await q;
  console.log('=== Mappings ===');
  console.log(JSON.stringify(mappings, null, 2));

  // Prices
  const { data: prices } = await s.from('card_prices')
    .select('*')
    .ilike('card_key', pattern);
  console.log('\n=== Prices ===');
  console.log(JSON.stringify(prices, null, 2));

  // If there's a shopify_product_id, look up the product
  const productIds = [...new Set((mappings || []).map(m => m.shopify_product_id).filter(Boolean))];
  if (productIds.length > 0) {
    const { data: products } = await s.from('shopify_products')
      .select('id, title, handle, price, inventory_quantity')
      .in('id', productIds);
    console.log('\n=== Matched Shopify Products ===');
    console.log(JSON.stringify(products, null, 2));
  }

  // Also search Shopify for other potential matches
  const { data: shopify } = await s.from('shopify_products')
    .select('id, title, handle, price')
    .ilike('title', pattern)
    .limit(10);
  console.log('\n=== All Shopify Products Matching Name ===');
  console.log(JSON.stringify(shopify, null, 2));
}
main();
"
```

### 2. Present a clear summary

Format the results as:
- **Card**: name, set, card_key
- **Status**: matched/unmatched/no_price_exists/manual
- **Match method**: exact/normalized/promo_fallback/manual/etc.
- **Current price**: $X.XX or "no price"
- **Matched to**: Shopify product title + handle
- **Other Shopify options**: list any other products with similar names that might be better matches
- **YTG URL**: `https://www.yourturngames.biz/products/{handle}` if matched

If there are multiple cards matching the query (e.g., same name across sets), list all of them.

### 3. Check budget substitution eligibility (if multiple printings exist)

When a card has multiple printings, the "Cheapest Versions" feature in the buy modal relies on two things:
1. **Duplicate group membership** — both printings must be in the same group in `duplicate_card_groups`/`duplicate_card_group_members`
2. **Ability text match** — `normalizeAbility()` in `lib/pricing/budgetPricing.ts` must produce identical output for both printings

Promos often have reworded ability text (e.g., "Search X for Y" → "Take Y from X", "card name" → "this card"). If the abilities differ, add an override to `ABILITY_OVERRIDES` in `lib/pricing/budgetPricing.ts`.

Run this to check:

```bash
npx tsx -e "
const { config } = require('dotenv');
config({ path: '.env.local' });
const { loadCardData, buildDuplicateGroupIndex } = require('./lib/pricing/matching');
const { normalizeAbility } = require('./lib/pricing/budgetPricing');
const { findGroup } = require('./lib/duplicateCards');

async function main() {
  const cardData = await loadCardData();
  const dupIndex = await buildDuplicateGroupIndex();
  const cards = cardData.filter(c => c.name.toLowerCase().includes('CARD_NAME_LOWER'));

  // Check group membership
  for (const c of cards) {
    const group = findGroup(c.name, dupIndex);
    console.log(c.name, '→ group:', group?.canonicalName ?? 'NONE', '| members:', group?.members?.length ?? 0);
  }

  // Check ability match
  if (cards.length >= 2) {
    const abilities = cards.map(c => normalizeAbility(c.special_ability));
    const allMatch = abilities.every(a => a === abilities[0]);
    console.log('\nAbilities match?', allMatch);
    if (!allMatch) {
      console.log('⚠️  MISMATCH — needs ABILITY_OVERRIDES entry in lib/pricing/budgetPricing.ts');
      for (const c of cards) {
        console.log('  ' + c.name + ': ' + normalizeAbility(c.special_ability).substring(0, 80) + '...');
      }
    }
  }
}
main();
"
```

If abilities don't match, the fix is to add an entry to `ABILITY_OVERRIDES` in `lib/pricing/budgetPricing.ts` mapping the variant wording to the canonical form (see existing entries for Lost Soul "Humble", "Darkness", and Foreign Wives as examples).
