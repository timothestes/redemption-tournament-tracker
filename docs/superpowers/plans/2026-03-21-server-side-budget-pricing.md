# Server-Side Budget Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show budget (cheapest-version) deck prices on the community and my-decks pages, precomputed at cron time for zero runtime cost.

**Architecture:** Add a `cheapest_price` column to `card_prices` and compute it during the existing twice-daily cron sync. A new RPC function `get_deck_budget_prices()` sums these cheapest prices per deck. Server actions call both RPCs in parallel and attach `budget_price` alongside `total_price`. The UI shows budget savings inline.

**Tech Stack:** PostgreSQL (Supabase), TypeScript server actions, existing cron sync pipeline.

---

## File Structure

| File | Responsibility |
|------|---------------|
| **Create:** `supabase/migrations/025_add_cheapest_price.sql` | Add `cheapest_price` column + `get_deck_budget_prices()` RPC |
| **Modify:** `lib/pricing/types.ts` | Add `special_ability` to `CardRow` interface |
| **Modify:** `lib/pricing/matching.ts` | Parse `cols[10]` as `special_ability` in `loadCardData()`. Add `computeCheapestPrices()` function. |
| **Modify:** `app/api/cron/sync-prices/route.ts` | Call `computeCheapestPrices()` after `regenerateCardPrices()` |
| **Modify:** `app/decklist/actions.ts` | Fetch budget prices in `loadUserDecksAction()` and `loadPublicDecksAction()` |
| **Modify:** `app/decklist/community/client.tsx` | Display `budget_price` alongside `total_price` |
| **Modify:** `app/decklist/my-decks/client.tsx` | Display `budget_price` alongside `total_price` |

---

### Task 1: Database migration — cheapest_price column + RPC

**Files:**
- Create: `supabase/migrations/025_add_cheapest_price.sql`

Check the latest migration number first — use the next available number.

- [ ] **Step 1: Create migration file**

```sql
-- Add cheapest_price column to card_prices
ALTER TABLE card_prices ADD COLUMN IF NOT EXISTS cheapest_price NUMERIC(10,2);

-- Function to compute budget prices for a batch of decks
-- Uses cheapest_price when available, falls back to price
CREATE OR REPLACE FUNCTION get_deck_budget_prices(deck_ids UUID[])
RETURNS TABLE(deck_id UUID, budget_price NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.deck_id,
    COALESCE(SUM(LEAST(cp.price, COALESCE(cp.cheapest_price, cp.price)) * dc.quantity), 0) AS budget_price
  FROM deck_cards dc
  JOIN card_prices cp
    ON cp.card_key = dc.card_name || '|' || dc.card_set || '|' || dc.card_img_file
  WHERE dc.deck_id = ANY(deck_ids)
  GROUP BY dc.deck_id;
END;
$$ LANGUAGE plpgsql STABLE;
```

Key: `LEAST(cp.price, COALESCE(cp.cheapest_price, cp.price))` — uses cheapest if available, otherwise own price. This is safe before cheapest_price is populated.

- [ ] **Step 2: Apply migration**

Use Supabase MCP or run directly:
```bash
# Via Supabase MCP apply_migration tool
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/025_add_cheapest_price.sql
git commit -m "feat: add cheapest_price column and get_deck_budget_prices RPC"
```

---

### Task 2: Extend server-side pricing to compute cheapest prices

**Files:**
- Modify: `lib/pricing/types.ts:3-12` — Add `special_ability` to `CardRow`
- Modify: `lib/pricing/matching.ts:32-55` — Parse `cols[10]` in `loadCardData()`
- Modify: `lib/pricing/matching.ts` — Add `computeCheapestPrices()` function
- Modify: `app/api/cron/sync-prices/route.ts:52` — Call `computeCheapestPrices()`

- [ ] **Step 1: Add `special_ability` to CardRow**

In `lib/pricing/types.ts`, add to the `CardRow` interface:
```ts
  special_ability: string; // cols[10] from carddata.txt
```

- [ ] **Step 2: Parse special_ability in loadCardData()**

In `lib/pricing/matching.ts`, the `loadCardData()` function (line 32-55) maps columns from carddata.txt. Add:
```ts
special_ability: cols[10]?.trim() ?? '',
```
to the return object (after `rarity`).

- [ ] **Step 3: Create `computeCheapestPrices()` function**

Add to `lib/pricing/matching.ts` (after `regenerateCardPrices()`):

```ts
/**
 * Compute the cheapest equivalent price for each card in card_prices.
 * A card's cheapest equivalent is found by:
 * 1. Looking up its duplicate group (same canonical identity)
 * 2. Finding all group members with the same special ability text
 * 3. Taking the minimum price among them
 *
 * Called during cron sync after regenerateCardPrices().
 */
export async function computeCheapestPrices(): Promise<void> {
  const supabase = getSupabaseAdmin();

  // Load all the data we need
  const [allCards, dupIndex, cardPricesData] = await Promise.all([
    loadCardData(),
    fetchDuplicateGroupsServer(),
    loadAllCardPrices(),
  ]);

  // Build lookup maps
  const priceByKey = new Map<string, number>();
  for (const cp of cardPricesData) {
    priceByKey.set(cp.card_key, cp.price);
  }

  // Build card name → cards index for efficient lookups
  const cardsByNormName = new Map<string, CardRow[]>();
  for (const card of allCards) {
    const normName = normalize(card.name);
    const base = normalize(stripSetSuffix(card.name));
    for (const key of [normName, base]) {
      const existing = cardsByNormName.get(key);
      if (existing) existing.push(card);
      else cardsByNormName.set(key, [card]);
    }
  }

  // For each card_key in card_prices, compute cheapest equivalent
  const updates: { card_key: string; cheapest_price: number }[] = [];

  for (const cp of cardPricesData) {
    // Find the card in carddata
    const [name] = cp.card_key.split('|');
    const group = findGroup(name, dupIndex);

    if (!group) continue; // No siblings, cheapest = own price (no update needed)

    // Get all member names and their normalized variants
    const memberNormNames = new Set<string>();
    for (const member of group.members) {
      memberNormNames.add(normalize(member.cardName));
      memberNormNames.add(normalize(stripSetSuffix(member.cardName)));
    }

    // Find the source card's special ability
    const sourceCard = allCards.find(c => c.card_key === cp.card_key);
    if (!sourceCard) continue;

    const targetAbility = normalizeAbility(sourceCard.special_ability);

    // Gather all candidate cards from the group
    const candidates: CardRow[] = [];
    const seen = new Set<string>();
    for (const normName of memberNormNames) {
      const bucket = cardsByNormName.get(normName);
      if (bucket) {
        for (const c of bucket) {
          if (!seen.has(c.card_key)) {
            seen.add(c.card_key);
            candidates.push(c);
          }
        }
      }
    }

    // Find cheapest among ability-matched candidates
    let cheapest: number | null = null;
    for (const candidate of candidates) {
      if (normalizeAbility(candidate.special_ability) !== targetAbility) continue;
      const price = priceByKey.get(candidate.card_key);
      if (price != null && (cheapest === null || price < cheapest)) {
        cheapest = price;
      }
    }

    // Only store if cheaper than own price
    if (cheapest !== null && cheapest < cp.price) {
      updates.push({ card_key: cp.card_key, cheapest_price: cheapest });
    }
  }

  if (updates.length === 0) {
    log('No cheapest price updates needed');
    return;
  }

  // Batch update card_prices with cheapest_price
  const batchSize = 500;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    for (const update of batch) {
      await supabase
        .from('card_prices')
        .update({ cheapest_price: update.cheapest_price })
        .eq('card_key', update.card_key);
    }
  }

  log(`Updated cheapest_price for ${updates.length} cards`);
}
```

This function needs these imports/helpers that already exist in matching.ts:
- `findGroup`, `normalize`, `stripSetSuffix` from `@/lib/duplicateCards`
- `normalizeAbility` from `@/lib/pricing/budgetPricing`
- `getSupabaseAdmin` from `./supabase-admin`
- `loadCardData()` already in matching.ts

It also needs two new helper functions:

```ts
/** Load duplicate groups using admin client (server-side). */
async function fetchDuplicateGroupsServer(): Promise<DuplicateGroupIndex> {
  const supabase = getSupabaseAdmin();
  // Same logic as fetchDuplicateGroups() in lib/duplicateCards.ts but using admin client
  const PAGE = 1000;
  const allData: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('duplicate_card_group_members')
      .select(`
        card_name,
        ordir_sets,
        matched,
        group:duplicate_card_groups!inner(id, canonical_name)
      `)
      .range(offset, offset + PAGE - 1)
      .order('id', { ascending: true });
    if (error || !data || data.length === 0) break;
    allData.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  // Build index using same logic as fetchDuplicateGroups()
  // (import the index-building logic or duplicate it — prefer importing if possible)
  return buildDuplicateGroupIndex(allData);
}

/** Load all card_prices rows. */
async function loadAllCardPrices(): Promise<{ card_key: string; price: number }[]> {
  const supabase = getSupabaseAdmin();
  const allData: any[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('card_prices')
      .select('card_key, price')
      .range(offset, offset + PAGE - 1);
    if (error || !data || data.length === 0) break;
    allData.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return allData;
}
```

**Note:** The `buildDuplicateGroupIndex()` function should be extracted from `fetchDuplicateGroups()` in `lib/duplicateCards.ts` so both client and server code can reuse the index-building logic. Alternatively, the implementer can inline the index construction from the raw Supabase rows.

- [ ] **Step 4: Wire into cron sync**

In `app/api/cron/sync-prices/route.ts`, after line 52 (`await regenerateCardPrices();`), add:
```ts
    console.log('[cron] Computing cheapest prices...');
    await computeCheapestPrices();
```

And add the import at the top:
```ts
import { runMatchingPipeline, regenerateCardPrices, computeCheapestPrices } from '@/lib/pricing/matching';
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/pricing/types.ts lib/pricing/matching.ts app/api/cron/sync-prices/route.ts
git commit -m "feat: compute cheapest equivalent prices during cron sync"
```

---

### Task 3: Update server actions to fetch budget prices

**Files:**
- Modify: `app/decklist/actions.ts` — Two functions: `loadUserDecksAction()` (~line 326) and `loadPublicDecksAction()` (~line 1325)

Both follow the same pattern. For each, add a parallel RPC call for budget prices.

- [ ] **Step 1: Update `loadUserDecksAction()`**

Find the price-fetching block (around line 326-340). Change to fetch both in parallel:

```ts
    // Batch-fetch total prices and budget prices for all returned decks
    let priceMap = new Map<string, number>();
    let budgetPriceMap = new Map<string, number>();
    if (deckIds.length > 0) {
      const [priceResult, budgetResult] = await Promise.all([
        supabase.rpc("get_deck_total_prices", { deck_ids: deckIds }),
        supabase.rpc("get_deck_budget_prices", { deck_ids: deckIds }),
      ]);

      if (priceResult.error) {
        console.error("Error fetching deck prices:", priceResult.error);
      }
      for (const row of (priceResult.data || []) as any[]) {
        if (row.total_price > 0) {
          priceMap.set(row.deck_id, parseFloat(row.total_price));
        }
      }

      if (budgetResult.error) {
        console.error("Error fetching budget prices:", budgetResult.error);
      }
      for (const row of (budgetResult.data || []) as any[]) {
        if (row.budget_price > 0) {
          budgetPriceMap.set(row.deck_id, parseFloat(row.budget_price));
        }
      }
    }
```

Then in the deck mapping (around line 352), add `budget_price`:
```ts
        total_price: priceMap.get(deck.id) || null,
        budget_price: budgetPriceMap.get(deck.id) || null,
```

- [ ] **Step 2: Update `loadPublicDecksAction()`**

Same pattern at around line 1325-1339. Replace the single RPC call with parallel calls and add `budget_price` to the deck mapping.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add app/decklist/actions.ts
git commit -m "feat: fetch budget prices alongside total prices in server actions"
```

---

### Task 4: Update community and my-decks UI

**Files:**
- Modify: `app/decklist/community/client.tsx`
- Modify: `app/decklist/my-decks/client.tsx`

- [ ] **Step 1: Update community page types and UI**

In `app/decklist/community/client.tsx`:

Add to the `CommunityDeck` interface (near `total_price`):
```ts
  budget_price?: number | null;
```

Find where `total_price` is displayed (around line 710-712):
```tsx
{deck.total_price != null && deck.total_price > 0 && (
  <span className="text-green-600 dark:text-green-400">${deck.total_price.toFixed(2)}</span>
)}
```

After that block, add:
```tsx
{deck.budget_price != null && deck.total_price != null && deck.budget_price < deck.total_price - 0.005 && (
  <span className="text-xs text-muted-foreground" title={`Save $${(deck.total_price - deck.budget_price).toFixed(2)} with budget alternatives`}>
    Budget: <span className="text-green-600 dark:text-green-400">${deck.budget_price.toFixed(2)}</span>
  </span>
)}
```

- [ ] **Step 2: Update my-decks page types and UI**

In `app/decklist/my-decks/client.tsx`:

Find the deck type/interface and add `budget_price?: number | null`.

The my-decks page shows `total_price` in 3 locations (lines ~1126, ~1217, ~1238). After each, add the budget line (same JSX as above).

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 4: Visual verification**

Run `npm run dev`, check:
- `/decklist/community` — budget prices show alongside total prices
- `/decklist/my-decks` — same

Note: Budget prices will only appear after the cron sync runs (or after manually triggering the sync endpoint). For testing, you may need to run the sync first.

- [ ] **Step 5: Commit**

```bash
git add app/decklist/community/client.tsx app/decklist/my-decks/client.tsx
git commit -m "feat: show budget prices on community and my-decks pages"
```
