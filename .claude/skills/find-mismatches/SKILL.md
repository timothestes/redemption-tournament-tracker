---
name: find-mismatches
description: Scan for potential price mismatches — cards where the auto-matched Shopify product looks wrong. Finds promos matched to generic versions, year-specific cards matched to wrong years, and suspiciously high/low prices.
argument-hint: [set-code|category]
allowed-tools: Bash, Read, Grep
---

# Find Price Mismatches

Scan the database for cards that are likely matched to the wrong Shopify product.

## Arguments (optional)

- **Set code** — limit scan to a specific set (e.g., "Pmo-P2", "RR")
- **Category** — "promos", "expensive", "cheap", "low-confidence", or "all"

Default: scan all categories.

## Mismatch Detection Queries

Run the following checks and report findings:

### 1. Promo cards matched to generic versions

Cards with year/event info in brackets that lost specificity during matching:

```bash
npx tsx -e "
const { config } = require('dotenv');
config({ path: '.env.local' });
const { getSupabaseAdmin } = require('./lib/pricing/supabase-admin');
const s = getSupabaseAdmin();

async function main() {
  // Find promo cards with bracket suffixes matched via fallback
  const { data } = await s.from('card_price_mappings')
    .select('card_key, card_name, set_code, shopify_product_id, match_method, confidence')
    .in('match_method', ['promo_fallback', 'promo_fallback_cheapest'])
    .like('card_name', '%[%]%');

  if (!data?.length) { console.log('No bracket-promo fallbacks found'); return; }

  // For each, check if there's a more specific Shopify product
  for (const m of data) {
    const { data: product } = await s.from('shopify_products')
      .select('title, price').eq('id', m.shopify_product_id);
    const prodTitle = product?.[0]?.title ?? 'unknown';
    const prodPrice = product?.[0]?.price ?? '?';
    console.log('POSSIBLE MISMATCH:');
    console.log('  Card: ' + m.card_name + ' (' + m.set_code + ')');
    console.log('  Matched to: ' + prodTitle + ' (\$' + prodPrice + ')');
    console.log('  Method: ' + m.match_method + ' (confidence: ' + m.confidence + ')');
    console.log();
  }
}
main();
"
```

### 2. Low confidence matches

```bash
npx tsx -e "
const { config } = require('dotenv');
config({ path: '.env.local' });
const { getSupabaseAdmin } = require('./lib/pricing/supabase-admin');
const s = getSupabaseAdmin();

async function main() {
  const { data } = await s.from('card_price_mappings')
    .select('card_key, card_name, set_code, match_method, confidence')
    .lt('confidence', 0.85)
    .gt('confidence', 0)
    .order('confidence', { ascending: true })
    .limit(20);

  console.log('=== Low Confidence Matches (< 0.85) ===');
  for (const m of data || []) {
    console.log('  ' + m.confidence.toFixed(2) + ' | ' + m.card_name + ' (' + m.set_code + ') via ' + m.match_method);
  }
}
main();
"
```

### 3. Price outliers — suspiciously expensive

```bash
npx tsx -e "
const { config } = require('dotenv');
config({ path: '.env.local' });
const { getSupabaseAdmin } = require('./lib/pricing/supabase-admin');
const s = getSupabaseAdmin();

async function main() {
  const { data } = await s.from('card_prices')
    .select('card_key, price, shopify_title')
    .gte('price', 50)
    .order('price', { ascending: false })
    .limit(20);

  console.log('=== Cards Priced >= \$50 (verify these are correct) ===');
  for (const p of data || []) {
    const name = p.card_key.split('|')[0];
    const set = p.card_key.split('|')[1];
    console.log('  \$' + p.price + ' | ' + name + ' (' + set + ') -> ' + p.shopify_title);
  }
}
main();
"
```

### 4. Cards where Shopify product name doesn't contain the card name

```bash
npx tsx -e "
const { config } = require('dotenv');
config({ path: '.env.local' });
const { getSupabaseAdmin } = require('./lib/pricing/supabase-admin');
const s = getSupabaseAdmin();

async function main() {
  const { data } = await s.from('card_prices').select('card_key, shopify_title, price');
  let mismatches = 0;
  for (const p of data || []) {
    const cardName = p.card_key.split('|')[0]
      .replace(/\s*\([^)]*\)\s*/g, '')
      .replace(/\s*\[[^\]]*\]\s*/g, '')
      .trim()
      .toLowerCase();
    const shopTitle = (p.shopify_title || '').toLowerCase();
    // Check if the base card name appears in the Shopify title
    if (cardName.length > 3 && !shopTitle.includes(cardName)) {
      mismatches++;
      if (mismatches <= 15) {
        console.log('NAME MISMATCH:');
        console.log('  Card: ' + p.card_key.split('|')[0] + ' -> base: \"' + cardName + '\"');
        console.log('  Shopify: ' + p.shopify_title + ' (\$' + p.price + ')');
        console.log();
      }
    }
  }
  console.log('Total name mismatches: ' + mismatches);
}
main();
"
```

### 5. Budget substitution blockers — ability text mismatches within duplicate groups

Cards in the same duplicate group but with different ability wording won't substitute for each other in "Cheapest Versions" mode. This is the most common reason a cheap printing isn't suggested as a substitute for an expensive promo.

```bash
npx tsx -e "
const { config } = require('dotenv');
config({ path: '.env.local' });
const { loadCardData, buildDuplicateGroupIndex } = require('./lib/pricing/matching');
const { normalizeAbility } = require('./lib/pricing/budgetPricing');
const { findGroup, normalize, stripSetSuffix } = require('./lib/duplicateCards');

async function main() {
  const cardData = await loadCardData();
  const dupIndex = await buildDuplicateGroupIndex();

  // Build name index
  const nameIndex = new Map();
  for (const c of cardData) {
    const key = normalize(stripSetSuffix(c.name));
    if (!nameIndex.has(key)) nameIndex.set(key, []);
    nameIndex.get(key).push(c);
  }

  let mismatches = 0;
  const seen = new Set();

  for (const group of dupIndex.groups) {
    if (seen.has(group.canonicalName)) continue;
    seen.add(group.canonicalName);

    // Collect all carddata rows in this group
    const memberNames = new Set();
    for (const m of group.members) {
      memberNames.add(normalize(m.cardName));
      memberNames.add(normalize(stripSetSuffix(m.cardName)));
    }

    const rows = [];
    for (const n of memberNames) {
      for (const c of (nameIndex.get(n) || [])) {
        if (!rows.find(r => r.card_key === c.card_key)) rows.push(c);
      }
    }

    if (rows.length < 2) continue;

    // Check if all abilities match
    const abilities = rows.map(r => normalizeAbility(r.special_ability));
    const groups = new Map();
    rows.forEach((r, i) => {
      const a = abilities[i];
      if (!groups.has(a)) groups.set(a, []);
      groups.get(a).push(r.name);
    });

    if (groups.size > 1) {
      mismatches++;
      console.log('ABILITY MISMATCH in group \"' + group.canonicalName + '\":');
      for (const [ability, names] of groups) {
        console.log('  ' + names.join(', '));
        console.log('    → ' + ability.substring(0, 100) + (ability.length > 100 ? '...' : ''));
      }
      console.log();
    }
  }

  console.log('Total groups with ability mismatches: ' + mismatches);
  if (mismatches > 0) {
    console.log('Fix: add entries to ABILITY_OVERRIDES in lib/pricing/budgetPricing.ts');
  }
}
main();
"
```

## Present results

Group findings by category and severity:
- **Likely wrong**: name mismatches, promo fallbacks with bracket info
- **Budget blockers**: ability text mismatches within duplicate groups (prevents cheapest version substitution)
- **Worth checking**: low confidence, price outliers
- **Summary**: total issues found per category

For each issue, suggest the fix:
- Name/promo mismatches: "use `/match-card` to fix"
- Price issues: "use `/update-price` to remove"
- Ability mismatches: "add an `ABILITY_OVERRIDES` entry in `lib/pricing/budgetPricing.ts`"
