# Card Price Matching System — Implementation Spec

## Overview

Build a system that matches cards from `carddata.txt` (Redemption CCG deck builder) to products in the YTG Shopify store, stores resolved mappings in Supabase, and syncs prices automatically via a weekly Vercel Cron Job.

**Guiding principle:** Accuracy over coverage. A missing price is fine. A wrong price is not.

---

## Repository Context

- **Framework:** Next.js (App Router) deployed on Vercel
- **Database:** Supabase (Postgres)
- **Existing files to be aware of:**
  - `scripts/output/ytg_products.json` — Shopify product dump (~4,868 singles)
  - `app/decklist/card-search/ytgUtils.ts` — existing YTG URL utilities
  - `app/decklist/card-search/hooks/useDeckState.ts` — deck builder card loading
- **Card data source:** Fetched at runtime from `https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/main/sets/carddata.txt` (tab-separated, ~5,333 rows)

---

## Data Shapes

### carddata.txt columns (tab-separated)
```
col 0: name         e.g. "Angel of the Lord", "Aaron (Pi)", "Abed-nego (Azariah) [T2C]"
col 1: set_code     e.g. "Pri", "T2C", "RoJ (AB)", "K1P"
col 2: img_file     e.g. "Angel_of_the_Lord_Pri.jpg"
col 3: official_set e.g. "Priests", "Times to Come"
col 4: type         e.g. "Hero", "Evil Character", "Lost Soul"
col 5: brigade      e.g. "White", "Silver", "Crimson"
col 6: rarity       e.g. "Common", "Rare", "Legacy Rare"
```

The deck builder's internal card key is: `name|set_code|img_file`

### Shopify product (from ytg_products.json)
```typescript
{
  id: string,
  title: string,          // almost always "Card Name (Set Abbreviation)"
  handle: string,         // URL slug, stable
  tags: string,           // comma-separated: "Hero, Silver, Kings, Rotation Cards"
  product_type: string,   // "Single" for individual cards
  variants: [{
    price: string,
    inventory_quantity: number
  }]
}
```

---

## Database Schema

Create these tables in Supabase. Run as a single migration.

```sql
-- Enable fuzzy matching extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Raw Shopify product cache
CREATE TABLE shopify_products (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  handle TEXT NOT NULL,
  tags TEXT,
  product_type TEXT,
  price NUMERIC(10,2),
  inventory_quantity INTEGER,
  raw_json JSONB,
  last_synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shopify_products_title_trgm ON shopify_products USING GIN (title gin_trgm_ops);
CREATE INDEX idx_shopify_products_type ON shopify_products (product_type);

-- Set alias lookup table (replaces hard-coded mapping)
CREATE TABLE set_aliases (
  id SERIAL PRIMARY KEY,
  carddata_code TEXT NOT NULL,   -- e.g. "Pri", "RR", "K1P"
  shopify_abbrev TEXT NOT NULL,  -- e.g. "Pi", "Roots", "K Deck"
  notes TEXT
);

CREATE UNIQUE INDEX idx_set_aliases_carddata ON set_aliases (carddata_code);

-- Resolved card → Shopify product mappings
CREATE TABLE card_price_mappings (
  id SERIAL PRIMARY KEY,
  card_key TEXT NOT NULL UNIQUE,         -- "name|set_code|img_file"
  card_name TEXT NOT NULL,
  set_code TEXT NOT NULL,
  shopify_product_id TEXT REFERENCES shopify_products(id),
  confidence NUMERIC(3,2),               -- 0.00 to 1.00
  match_method TEXT,                     -- 'exact', 'normalized', 'fuzzy', 'multi_signal', 'claude', 'manual'
  status TEXT NOT NULL DEFAULT 'unmatched', -- 'auto_matched', 'manual', 'unmatched', 'no_price_exists', 'needs_review'
  claude_reasoning TEXT,                 -- populated when match_method = 'claude'
  reviewed_by TEXT,                      -- for manual overrides
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_card_price_mappings_status ON card_price_mappings (status);
CREATE INDEX idx_card_price_mappings_set_code ON card_price_mappings (set_code);

-- Final denormalized output (what the deck builder reads)
CREATE TABLE card_prices (
  card_key TEXT PRIMARY KEY,   -- "name|set_code|img_file"
  price NUMERIC(10,2),
  shopify_handle TEXT,
  shopify_title TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Set Alias Seed Data

Insert this after creating the `set_aliases` table:

```sql
INSERT INTO set_aliases (carddata_code, shopify_abbrev, notes) VALUES
  ('Ki', 'Ki', 'Direct match'),
  ('Pri', 'Pi', null),
  ('Pat', 'Pa', null),
  ('RR', 'Roots', null),
  ('T2C', 'TtC', null),
  ('War', 'Wa', null),
  ('Wom', 'Wo', null),
  ('FoOF', 'FooF', null),
  ('TEC', 'EC', null),
  ('TPC', 'PC', null),
  ('Prp', 'Pr', null),
  ('Pmo-P1', 'Promo', null),
  ('Pmo-P2', 'Promo', null),
  ('Pmo-P3', 'Promo', null),
  ('I/J+', 'I & J+', null),
  ('K', 'K Deck', null),
  ('K1P', 'K Deck', null),
  ('L', 'L Deck', null),
  ('L1P', 'L Deck', null),
  ('A', 'A Deck', null),
  ('B', 'B Deck', null),
  ('C', 'C Deck', null),
  ('D', 'D Deck', null),
  ('E', 'E Deck', null),
  ('F', 'F Deck', null),
  ('G', 'G Deck', null),
  ('H', 'H Deck', null),
  ('I', 'I Deck', null),
  ('J', 'J Deck', null),
  ('CoW (AB)', 'CoW AB', null),
  ('RoJ (AB)', 'RoJ AB', null),
  ('Ap', 'Ap', 'Direct match'),
  ('GoC', 'GoC', 'Direct match'),
  ('FoM', 'FoM', 'Direct match'),
  ('LoC', 'LoC', 'Direct match'),
  ('Di', 'Di', 'Direct match'),
  ('Wo', 'Wo', 'Direct match');

-- These sets are not stocked by YTG — mark them so we never attempt to match
-- Main, Main UL, 1E, 1EU, 2E, 2ER, 3E, 10A, Fund
-- Handle in application logic: if set_code has no alias entry, treat as 'no_price_exists'
```

---

## Matching Pipeline

Build this as a script at `scripts/build-price-mappings.ts`. It should be runnable manually via `npx tsx scripts/build-price-mappings.ts` and also callable from an API route.

### Step 0: Helpers

```typescript
// Normalize a string for comparison
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/['']/g, "'")       // normalize smart quotes
    .replace(/[""]/g, '"')        // normalize smart quotes
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract the "clean" card name by stripping embedded set suffixes.
// carddata sometimes bakes the set into the name: "Aaron (Pi)", "Abel (CoW)", "Item [T2C]"
// This strips trailing (...) and [...] tokens that look like set codes.
function stripEmbeddedSet(name: string): string {
  // Remove trailing bracket notation: "Abed-nego (Azariah) [T2C]" → "Abed-nego (Azariah)"
  let cleaned = name.replace(/\s*\[[A-Z][A-Za-z0-9 &+()]*\]\s*$/, '').trim();
  // Remove trailing paren that looks like a short set code (2-5 chars, mostly uppercase)
  // but NOT things like "Lost Soul (Luke 13:25)" — those are scripture refs
  cleaned = cleaned.replace(/\s*\(([A-Z][A-Za-z0-9]{0,4})\)\s*$/, (match, inner) => {
    // Heuristic: if it's all uppercase letters/numbers and ≤5 chars, it's a set code
    if (/^[A-Z][A-Z0-9]{0,4}$/.test(inner)) return '';
    return match; // keep it
  });
  // Remove "1st Print" variant suffixes
  cleaned = cleaned.replace(/\s*\(1st Print[^)]*\)\s*$/, '').trim();
  return cleaned.trim();
}

// Parse brigade/type from Shopify tags string
function parseShopifyTags(tags: string): { brigade: string[], type: string[], sets: string[] } {
  const tagList = tags.split(',').map(t => t.trim().toLowerCase());
  const brigadeColors = ['white', 'silver', 'gold', 'crimson', 'green', 'blue', 'purple', 'gray', 'brown', 'orange', 'multi'];
  const cardTypes = ['hero', 'evil character', 'good enhancement', 'evil enhancement', 'lost soul', 'artifact', 'dominant', 'covenant', 'site', 'fortress'];
  return {
    brigade: tagList.filter(t => brigadeColors.includes(t)),
    type: tagList.filter(t => cardTypes.includes(t)),
    sets: tagList.filter(t => !brigadeColors.includes(t) && !cardTypes.includes(t))
  };
}
```

### Step 1: Load data

```typescript
async function loadCardData(): Promise<CardRow[]> {
  const res = await fetch('https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/main/sets/carddata.txt');
  const text = await res.text();
  return text.split('\n')
    .filter(line => line.trim())
    .map(line => {
      const cols = line.split('\t');
      return {
        name: cols[0]?.trim() ?? '',
        set_code: cols[1]?.trim() ?? '',
        img_file: cols[2]?.trim() ?? '',
        official_set: cols[3]?.trim() ?? '',
        type: cols[4]?.trim() ?? '',
        brigade: cols[5]?.trim() ?? '',
        rarity: cols[6]?.trim() ?? '',
        card_key: `${cols[0]?.trim()}|${cols[1]?.trim()}|${cols[2]?.trim()}`
      };
    });
}

async function loadShopifyProducts(): Promise<ShopifyProduct[]> {
  // Read from local file OR from shopify_products table in Supabase
  // Prefer Supabase if table is populated (post first sync)
  // ...
}
```

### Step 2: Run matching passes in order

For each card, attempt these passes and stop at the first match above the confidence threshold:

**Pass 1 — Exact match (confidence: 1.0)**
- Look up `set_aliases` for the card's `set_code`
- If no alias found → mark `no_price_exists`, skip
- Construct candidate title: `cleanName + " (" + shopifyAbbrev + ")"`
- Compare `normalize(candidateTitle) === normalize(shopifyProduct.title)`

**Pass 2 — Normalized match with cleaned name (confidence: 0.95)**
- Run `stripEmbeddedSet(card.name)` to get the base name
- Retry Pass 1 logic with the cleaned name
- This handles: `"Aaron (Pi)"` in set `Pri` → clean to `"Aaron"` → `"Aaron (Pi)"`

**Pass 3 — Fuzzy trigram match (confidence: varies)**
- Use Supabase RPC to run a `pg_trgm` similarity query:
  ```sql
  SELECT id, title, similarity(title, $1) as score
  FROM shopify_products
  WHERE product_type = 'Single'
    AND similarity(title, $1) > 0.7
  ORDER BY score DESC
  LIMIT 5;
  ```
- If top result score > 0.85 AND it's unambiguously the top result → auto-match
- If score 0.70–0.85 → flag as `needs_review`

**Pass 4 — Multi-signal disambiguation**
- When Pass 3 returns multiple candidates above threshold, use metadata to break the tie:
  - Compare `card.brigade` against Shopify product tags
  - Compare `card.type` against Shopify product tags
  - Each signal match adds 0.1 to confidence score
- Proceed to auto-match if combined score crosses 0.9

**Pass 5 — Claude-assisted resolution**
- Collect all cards still `unmatched` or `needs_review` after passes 1-4
- Batch in groups of 50 (to stay within context limits)
- For each card, provide top 3 Shopify candidates from the trigram search
- See prompt template below
- Parse Claude's structured JSON response, insert with `match_method: 'claude'`
- All Claude suggestions go to `needs_review` status by default — require human approval

### Step 3: Write results to `card_price_mappings`

Use upsert. Never overwrite a row with `status = 'manual'`.

### Step 4: Regenerate `card_prices`

```sql
INSERT INTO card_prices (card_key, price, shopify_handle, shopify_title, updated_at)
SELECT
  m.card_key,
  s.price,
  s.handle,
  s.title,
  NOW()
FROM card_price_mappings m
JOIN shopify_products s ON s.id = m.shopify_product_id
WHERE m.status IN ('auto_matched', 'manual')
ON CONFLICT (card_key) DO UPDATE
  SET price = EXCLUDED.price,
      shopify_handle = EXCLUDED.shopify_handle,
      shopify_title = EXCLUDED.shopify_title,
      updated_at = EXCLUDED.updated_at;
```

---

## Claude Prompt Template (Pass 5)

```typescript
const systemPrompt = `You are matching trading card names between two datasets for a card game called Redemption CCG.
You will be given a card from the deck builder and a list of candidate products from a Shopify store.
Your job is to identify which candidate (if any) is the same card.

Rules:
- The same card can have slightly different name formatting between datasets
- Set abbreviations differ between datasets (e.g. "Pri" in carddata = "Pi" in Shopify)  
- A card name may have an embedded set suffix like "(Pi)" or "[T2C]" that should be ignored when matching
- Prefer no match over a wrong match
- Return ONLY valid JSON, no explanation text outside the JSON

Response format:
{
  "matches": [
    {
      "card_key": "the exact card_key provided",
      "shopify_id": "the shopify product id, or null if no confident match",
      "confidence": 0.0 to 1.0,
      "reasoning": "brief explanation"
    }
  ]
}`;

const userPrompt = (cards: CardWithCandidates[]) => `
Match each of these cards to a Shopify product if possible:

${cards.map(c => `
CARD: ${c.card_key}
  Name: ${c.name}
  Set code: ${c.set_code}  
  Official set: ${c.official_set}
  Type: ${c.type}
  Brigade: ${c.brigade}
  
  CANDIDATES:
  ${c.candidates.map(cand => `  - id: ${cand.id} | title: "${cand.title}" | tags: ${cand.tags}`).join('\n')}
`).join('\n---\n')}
`;
```

---

## API Routes

### `POST /api/admin/sync-shopify`
Fetches all Single products from Shopify Admin API, upserts into `shopify_products` table.

```typescript
// Shopify Admin API endpoint (use existing credentials from environment)
// GET /admin/api/2024-01/products.json?product_type=Single&limit=250
// Paginate through all pages using Link header
// Upsert each product into shopify_products table
```

**Shopify Authentication:** The Shopify API uses a `client_credentials` OAuth grant — you POST `client_id` + `client_secret` to `/admin/oauth/access_token` and receive a short-lived bearer token. This means every API call session must first exchange credentials for a token. See `scripts/fetch_shopify_products.py` for the working implementation.

Required env vars: `SHOPFIY_CLIENT_ID` (note: typo is in the actual Shopify app config, keep as-is), `SHOPIFY_READONLY_TOKEN` (the client secret)

### `POST /api/admin/run-matching`
Runs the full matching pipeline (passes 1-4 only, not Claude pass). 
- Should be idempotent — skip cards that already have `status = 'manual'` or `status = 'auto_matched'` with `confidence >= 0.95`
- Return a summary: `{ total, matched, needs_review, no_price_exists, unmatched }`

### `GET /api/prices`
Returns the full `card_prices` table as JSON, suitable for the deck builder to consume.

Response shape:
```json
{
  "updated_at": "2025-01-01T00:00:00Z",
  "prices": {
    "Angel of the Lord|Pri|Angel_of_the_Lord_Pri.jpg": {
      "price": 0.25,
      "shopify_handle": "angel-of-the-lord-pi",
      "shopify_title": "Angel of the Lord (Pi)"
    }
  }
}
```

Cache this response aggressively (revalidate weekly, or on demand after price sync).

### `GET /api/admin/review-queue`
Returns all mappings with `status = 'needs_review'`, joined with Shopify product data.

### `POST /api/admin/approve-mapping`
Body: `{ card_key, shopify_product_id }` — sets `status = 'manual'`, `reviewed_by`, regenerates `card_prices`.

### `POST /api/admin/reject-mapping`
Body: `{ card_key }` — sets `status = 'unmatched'`, clears `shopify_product_id`.

---

## Vercel Cron Job

File: `app/api/cron/sync-prices/route.ts`

```typescript
export async function GET(request: Request) {
  // Verify this is a legitimate Vercel cron call
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 1. Sync Shopify products → shopify_products table
  // 2. Re-run matching passes 1-4 for any NEW Shopify products not yet in mappings
  // 3. Regenerate card_prices from existing confirmed mappings
  // 4. Log summary to console (visible in Vercel logs)
}
```

`vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/sync-prices",
      "schedule": "0 6 * * 1"
    }
  ]
}
```

Add `CRON_SECRET` to Vercel environment variables.

---

## Deck Builder Integration

Update `app/decklist/card-search/ytgUtils.ts` (or `useDeckState.ts`) to:

1. Fetch prices from `/api/prices` once on mount, store in state
2. For each card in the deck, look up `card_key` (`name|set_code|img_file`) in the prices map
3. If found: display price
4. If not found: display existing "Search on YTG" link fallback (no change to existing behavior)

The prices response should be cached in memory for the session — no need to refetch per card.

---

## Scripts

### `scripts/build-price-mappings.ts`
The full offline matching pipeline. Run this once to bootstrap, then the cron job handles incremental updates.

```bash
npx tsx scripts/build-price-mappings.ts
# Options:
#   --passes 1,2,3,4     run only specified passes (default: all)
#   --set Ki,Pri          only process cards from these set codes
#   --force               re-run even for already-matched cards
#   --dry-run             print results without writing to DB
```

### `scripts/run-claude-matching.ts`
Separate script for the Claude-assisted pass (Pass 5). Requires `ANTHROPIC_API_KEY`.
Writes results to DB with `status = 'needs_review'` — nothing goes live without approval.

```bash
npx tsx scripts/run-claude-matching.ts
# Options:
#   --limit 100     only process N unmatched cards (useful for testing)
#   --set GoC       only process a specific problematic set
```

### `scripts/export-prices-json.ts`
Exports `card_prices` table to `public/prices.json` as a static file fallback.

---

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=    # needed for server-side writes

# Shopify (client_credentials OAuth flow)
# Auth flow: POST client_id + client_secret to /admin/oauth/access_token
# to receive a short-lived bearer token for subsequent API calls.
# The store domain is hard-coded as "your-turn-games" (myshopify subdomain).
SHOPIFY_CLIENT_ID=            # Shopify app client ID (note: typo matches actual app config)
SHOPIFY_CLIENT_SECRET=       # Shopify app client secret (used as client_secret in OAuth exchange)

# Anthropic (for Claude matching pass)
ANTHROPIC_API_KEY=

# Vercel Cron
CRON_SECRET=                  # random string, add to Vercel env vars
```

> **Note on Shopify auth:** Unlike a static Admin API token, this setup uses the `client_credentials` grant type. Every session must first exchange the client ID + secret for an ephemeral access token before making API calls. The working implementation is in `scripts/fetch_shopify_products.py` — the `get_access_token()` function. The Vercel cron job and API routes must replicate this flow.

---

## Implementation Order

1. **DB migration** — create all tables and indexes, seed `set_aliases`
2. **Shopify sync script** — populate `shopify_products` from `ytg_products.json` as a one-time seed, then wire up the Admin API sync route
3. **Matching passes 1 & 2** — normalized + name-cleaned exact matching
4. **Matching pass 3** — `pg_trgm` fuzzy matching via Supabase RPC
5. **Matching pass 4** — multi-signal disambiguation
6. **`/api/prices` route** — serve `card_prices` table
7. **Deck builder integration** — consume `/api/prices`
8. **Vercel cron** — weekly sync
9. **Claude matching script (Pass 5)** — batch resolve hard cases
10. **Admin review UI** — minimal page to approve/reject `needs_review` queue

---

## Known Edge Cases to Handle

- **Cards with no alias in `set_aliases`** (old sets: `Main`, `1E`, `2E`, `3E`, `10A`, `Fund`) → set `status = 'no_price_exists'` immediately, skip matching entirely
- **16 Shopify products with `*Banned*` / `*Out of Print*` suffixes** → strip these suffixes before matching
- **Multi-variant Shopify products** → use `MIN(price)` across variants (show cheapest printing)
- **Cards where `stripEmbeddedSet` over-strips** (e.g. `"Lost Soul (Luke 13:25)"`) → write unit tests for the helper, ensure scripture refs are preserved
- **Duplicate Shopify titles** — rare but possible; pick the one with `inventory_quantity > 0` first