# Budget Buy Flow — Design Spec

## Goal

Let users buy the cheapest version of a deck from YTG with one click. Add a budget/exact toggle to the existing BuyDeckModal and wire it into both the deck builder and community deck detail page.

## Surfaces

1. **Deck builder** (`/decklist/card-search`) — already has BuyDeckModal + budget total
2. **Community deck detail** (`/decklist/[deckId]`) — already has BuyDeckModal, needs budget total + budget-mode entry point

## Design

### 1. BuyDeckModal Budget Toggle

Add a pill toggle to the BuyDeckModal header: **"Exact Cards"** / **"Budget Versions"**.

- Sits alongside the existing scope selector (All/Main/Reserve)
- Defaults to "Exact Cards" (current behavior, unchanged)
- Accepts an optional `initialMode?: "exact" | "budget"` prop to open pre-set to budget mode
- When "Budget Versions" is selected:
  - The modal sends `useBudget: true` to `/api/ytg-cart`
  - Cards with cheaper equivalents show the substitute name with a subtle indicator: card name, plus a small muted line like `"Originally: Angel of the Lord (Pri) · save $0.25"`
  - Cards with no cheaper alternative show normally
  - Total reflects budget prices
  - Cart URL uses the cheaper variant IDs
- The existing edit/exclude functionality works in both modes — users can still deselect individual cards
- Switching between Exact/Budget re-fetches the cart AND resets `excludedKeys` (same as switching scope does today via `handleScopeChange`)

### 2. Community Deck Detail Page (`/decklist/[deckId]`)

This page already has `useCardPrices()`, `totalDeckPrice`, and `BuyDeckModal`.

Changes:
- **Budget total display:** Compute budget total using the same approach as the deck builder. The page already loads the full card catalog from `CARD_DATA_URL` (in the parent `card-search/client.tsx` when editing, but NOT in the read-only `[deckId]` view). Since this page only has `enrichedCards` (the deck's cards, not all cards), we compute the budget total **server-side** — the `loadPublicDeckAction()` server action already returns `total_price`, and we've already added `budget_price` from the `get_deck_budget_prices` RPC in the previous work. So this page just needs to display the `budget_price` field that's already being returned.
- Show "Budget: $X.XX (save $Y.YY)" beneath existing price displays
- Make the budget price line clickable — opens BuyDeckModal with `initialMode="budget"`
- The existing exact price continues to open the modal in exact mode (default)

### 3. `/api/ytg-cart` Budget Mode

When the endpoint receives `useBudget: true` in the request body:

#### Data loading (with caching)

Server-side data needed for budget mode:
- **Carddata** — loaded via `loadCardData()` from `lib/pricing/matching.ts` (fetches from GitHub). Cache at module level with a 1-hour TTL to avoid re-fetching from GitHub on every request.
- **Duplicate groups** — loaded via `buildDuplicateGroupIndex()` from `lib/pricing/matching.ts` (queries Supabase with admin client `getSupabaseAdmin()`). Cache at module level with same TTL. **Important:** Do NOT use `fetchDuplicateGroups()` from `lib/duplicateCards.ts` — that uses the browser Supabase client and will fail in a server route.

#### Substitution logic

For each requested card when `useBudget: true`:

1. Find its duplicate group via `findGroup(card_name, dupIndex)`
2. If no group → use the card as-is (no substitution possible)
3. Get all group members, build their card_keys (`name|set|imgFile`)
4. **Batch query** `card_price_mappings` for ALL member card_keys in one query (not per-card) to find their Shopify product IDs
5. Filter to members with matching `normalizeAbility()` text (using carddata)
6. Among ability-matched members that have Shopify mappings, check live inventory and pick the cheapest **in-stock** variant
7. **Fallback chain:** cheapest in-stock equivalent → next-cheapest in-stock → original card if in stock → unmatched (sold out). If the cheapest equivalent is sold out, fall through to the next option. If ALL equivalents (including the original) are sold out, the card goes to `unmatched` with `reason: 'sold_out'`.
8. If live inventory check fails entirely (Shopify API down), fall back to cached price data — same as the existing exact mode does today.

#### Extended response shape

Backward-compatible — new fields are optional:

```ts
interface MatchedCard {
  card_name: string;        // Card being purchased (may be the cheaper version)
  card_key: string;         // Card key of the version being purchased
  quantity: number;
  price: number;
  variant_id: string;
  // Present only when a cheaper version was substituted:
  original_card_name?: string;   // What the deck originally specified
  original_card_key?: string;    // Original card key for identity tracking
  original_price?: number;       // What the original version costs
}
```

When `useBudget` is false or absent, behavior is identical to today — no substitution logic runs.

## What We're NOT Building

- No per-card swap controls (pick-your-own-version per card) — the toggle is all-or-nothing for simplicity
- No budget buy from the community listing page — only from the deck detail view
- No new database tables or columns — budget cart building uses existing `card_price_mappings` + `duplicate_card_groups` + carddata in real-time
- No changes to the existing cron sync or `cheapest_price` column — the cart endpoint does its own lookup because it needs live inventory checking (a card might be cheapest but sold out)
- No offline budget fallback — if Shopify inventory check fails, budget mode falls back to cached data (same as exact mode)

## Data Flow

```
User clicks "Budget Versions" toggle (or budget price button opens modal in budget mode)
  → BuyDeckModal re-fetches POST /api/ytg-cart { cards, useBudget: true }
    → Endpoint loads carddata + duplicate groups (cached, server-side admin client)
    → Batch-queries card_price_mappings for all group member card_keys
    → For each card, finds cheapest in-stock equivalent with matching ability
    → Returns matched[] with substitution info + cart URL
  → Modal displays cards with swap indicators
  → "Open YTG Cart" links to Shopify with budget variant IDs
```

## Files Affected

| File | Change |
|------|--------|
| `app/api/ytg-cart/route.ts` | Add budget mode: cached carddata + dup groups (admin client), batch Shopify lookup for siblings, fallback chain |
| `app/decklist/card-search/components/BuyDeckModal.tsx` | Add `initialMode` prop, exact/budget pill toggle, substitution display, reset excludes on mode switch |
| `app/decklist/[deckId]/client.tsx` | Display `budget_price` from server data, budget-mode modal entry point |
