# YTG Shopify Set Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin picks a Redemption set, previews one Shopify product per card (image + editable price), and imports them into YTG's live store as DRAFT (or ACTIVE) via GraphQL `productSet`, with an idempotency ledger and reconcile into the existing pricing pipeline.

**Architecture:** A pure builder (`productFromCard`) maps `CardData` → `ProductSetInput`; a thin GraphQL write client (`admin-write`) owns throttling and a mock mode; an orchestrator (`importSet`) plans and executes per-card upserts against a new `shopify_card_imports` ledger; an admin-gated API route exposes preview/execute; a client admin page renders the preview table. Spec: `docs/superpowers/specs/2026-07-25-ytg-shopify-set-import-design.md`.

**Tech Stack:** Next.js 15 App Router route handlers, TypeScript, Supabase (service-role via `getSupabaseAdmin()`), Shopify GraphQL Admin API 2026-07, Vitest.

## Global Constraints

- **Worktree isolation (repo rule):** all work happens in a dedicated worktree `../rtt-ytg-import` on branch `feat/ytg-set-import` created from `origin/main`. Use **absolute paths** everywhere. Never run `git checkout/reset/stash` in the main checkout; never `git add -A` — always add specific files.
- **Env vars:** `SHOPFIY_CLIENT_ID` (typo is intentional — matches the real Shopify app config), `SHOPIFY_CLIENT_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_BLOB_BASE_URL`. New: `SHOPIFY_WRITE_MOCK` — when `'1'`, `productSetUpsert` returns fabricated IDs and makes no network call.
- **Write API version:** `2026-07` (GraphQL). Do NOT touch the read path in `lib/pricing/shopify.ts` (REST, pinned `2024-01`) other than importing its exported `getShopifyAccessToken`.
- **Constants:** `vendor: "Your Turn Games"`, `productType: "Single"`, default `status: DRAFT`.
- **Card key format:** `` `${card.name}|${card.set}|${card.imgFile}` `` (must match `lib/pricing/matching.ts:45`).
- **Tags:** built as `string[]`, **sorted alphabetically** (YTG convention observed in dump).
- **Single-variant pattern (Shopify requirement, verified):** `productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }]` + `variants: [{ optionValues: [{ optionName: "Title", name: "Default Title" }], price, sku }]`. Exact capitalization `"Title"` / `"Default Title"` is mandatory.
- **File input field is `contentType: "IMAGE"`** (NOT `mediaContentType` — that's the output-side name).
- **Update semantics (verified):** omitting the `variants`/`productOptions`/`files` KEYS entirely leaves existing data unchanged; an empty array is destructive. On re-runs where media was already attached, OMIT `files`.
- **Tests:** Vitest, files named `*.test.ts` beside source, run with `npm test` (one-shot) — no jsdom needed (node env).
- **UI rules (user feedback memories):** no `focus:ring-*` classes on form controls; no green/primary color on text at rest; plain headings.
- **Admin gating:** the new API route MUST check `isRegistrationAdmin()` from `@/utils/adminUtils` (existing pricing routes don't gate — that's a known gap we are not copying for a live-store write path).
- **Commit messages:** end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 0: Worktree setup

**Files:** none (git only)

- [ ] **Step 1: Create the worktree**

```bash
cd /Users/timestes/projects/redemption-tournament-tracker
git fetch origin
git worktree add ../rtt-ytg-import -b feat/ytg-set-import origin/main
```

- [ ] **Step 2: Copy the (untracked) spec + this plan into the worktree so they ship with the PR**

```bash
mkdir -p /Users/timestes/projects/rtt-ytg-import/docs/superpowers/specs /Users/timestes/projects/rtt-ytg-import/docs/superpowers/plans
cp /Users/timestes/projects/redemption-tournament-tracker/docs/superpowers/specs/2026-07-25-ytg-shopify-set-import-design.md /Users/timestes/projects/rtt-ytg-import/docs/superpowers/specs/
cp /Users/timestes/projects/redemption-tournament-tracker/docs/superpowers/plans/2026-07-25-ytg-shopify-set-import.md /Users/timestes/projects/rtt-ytg-import/docs/superpowers/plans/
```

- [ ] **Step 3: Install deps in the worktree**

```bash
cd /Users/timestes/projects/rtt-ytg-import && npm install
```

- [ ] **Step 4: Commit the docs**

```bash
cd /Users/timestes/projects/rtt-ytg-import
git add docs/superpowers/specs/2026-07-25-ytg-shopify-set-import-design.md docs/superpowers/plans/2026-07-25-ytg-shopify-set-import.md
git commit -m "docs: YTG Shopify set import spec + plan

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: Ledger migration (`shopify_card_imports`)

**Files:**
- Create: `supabase/migrations/080_create_shopify_card_imports.sql`

**Interfaces:**
- Produces: table `shopify_card_imports` with columns `card_key text PK`, `set_code text`, `shopify_product_id text`, `shopify_variant_id text`, `handle text`, `status text` (`created|updated|skipped|error`), `media_attached boolean`, `error text`, `created_at`, `updated_at`. Task 4 reads/writes it via the service-role client (RLS blocks anon/authenticated entirely).

- [ ] **Step 1: Write the migration**

```sql
-- 080_create_shopify_card_imports.sql
-- Ledger for the YTG Shopify set importer (docs/superpowers/specs/2026-07-25-ytg-shopify-set-import-design.md §7).
-- One row per card ever imported; keyed by the canonical card_key `${name}|${set}|${imgFile}`.
-- Accessed exclusively via the service-role client — no anon/authenticated policies on purpose.

CREATE TABLE public.shopify_card_imports (
  card_key           TEXT PRIMARY KEY,
  set_code           TEXT NOT NULL,
  shopify_product_id TEXT,
  shopify_variant_id TEXT,
  handle             TEXT,
  status             TEXT NOT NULL CHECK (status IN ('created', 'updated', 'skipped', 'error')),
  media_attached     BOOLEAN NOT NULL DEFAULT false,
  error              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shopify_card_imports_set_code ON public.shopify_card_imports (set_code);

ALTER TABLE public.shopify_card_imports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.shopify_card_imports FROM anon, authenticated;
```

- [ ] **Step 2: Sanity-check the SQL parses (no local supabase needed — just eyeball + optional `psql` dry parse is unavailable; rely on review). Confirm filename doesn't collide:**

Run: `ls /Users/timestes/projects/rtt-ytg-import/supabase/migrations/ | grep '^080'`
Expected: only the new file.

- [ ] **Step 3: Commit**

```bash
cd /Users/timestes/projects/rtt-ytg-import
git add supabase/migrations/080_create_shopify_card_imports.sql
git commit -m "feat(import-set): shopify_card_imports ledger migration

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Note:** applying to prod happens in Task 7 (via Supabase MCP), not here.

---

### Task 2: Pure builder `productFromCard` + unit tests

**Files:**
- Create: `lib/shopify/productFromCard.ts`
- Test: `lib/shopify/productFromCard.test.ts`

**Interfaces:**
- Consumes: `CardData` from `@/lib/cards/generated/cardData`; `normalizeBrigadeField` from `@/app/decklist/card-search/utils` (signature: `normalizeBrigadeField(brigade: string, alignment: string, cardName?: string): string[]` — returns canonical brigade names, THROWS on unknown tokens); `sanitizeImgFile`, `getCardImageUrl` from `@/app/shared/utils/cardImageUrl`.
- Produces (used by Tasks 4–5):

```ts
export interface ShopifyProductSetInput {
  title: string;
  handle: string;
  productType: string;
  vendor: string;
  tags: string[];
  status: 'DRAFT' | 'ACTIVE';
  productOptions?: { name: string; values: { name: string }[] }[];
  variants?: { optionValues: { optionName: string; name: string }[]; price: string; sku: string }[];
  files?: { originalSource: string; contentType: 'IMAGE'; alt: string }[];
  metafields?: { namespace: string; key: string; value: string; type: string }[];
}

export interface ProductBuildOptions {
  price: string | null;        // normalized "1.50"; null => "0.00" + warning "no-price"
  imageUrl: string | null;     // null => no files + warning "no-image"
  status: 'DRAFT' | 'ACTIVE';
  titleOverride?: string;      // admin-entered title replaces the computed one verbatim
  includeMedia?: boolean;      // default true; false => omit files even if imageUrl set (update re-runs)
}

export interface BuiltProduct {
  cardKey: string;
  input: ShopifyProductSetInput;
  warnings: string[];          // 'no-price' | 'no-image' | 'no-set-alias' | `brigade-unmapped:<value>` | `type-unmapped:<value>`
}

export function baseCardName(name: string): string;       // strips ONE trailing " (...)" or " [...]" group
export function slugifyTitle(title: string): string;      // YTG-style handle slug
export function cardSku(card: CardData): string;          // `${set}-${sanitizeImgFile(imgFile)}` with whitespace removed
export function productFromCard(card: CardData, ytgAbbrev: string | null, opts: ProductBuildOptions): BuiltProduct;
```

**Mapping rules (all live here, unit-tested against real dump rows):**
- `title` = `titleOverride` ?? `` `${baseCardName(card.name)} (${ytgAbbrev ?? card.set})` ``; if `ytgAbbrev` is null add warning `no-set-alias`.
- `handle` = `slugifyTitle(title)`: lowercase → strip `['’‘"“”]` → replace runs of `[^a-z0-9]` with `-` → trim leading/trailing `-`. (We do NOT replicate YTG's legacy `risenlegacy` collapse bug.)
- `tags` (alphabetically sorted, deduped):
  - **type**: split `card.type` on `/` (trim each — dump has `"Fortress / Evil Character"`), map via `TYPE_TAGS`: `Hero→Hero, GE→Good Enhancement, EE→Evil Enhancement, Evil Character→Evil Character, Artifact→Artifact, Lost Soul→Lost Soul, Dominant→Dominant, Fortress→Fortress, Site→Site, City→City, Covenant→Covenant, Curse→Curse, Hero Token→Hero, Evil Character Token→Evil Character, Lost Soul Token→Lost Soul`. Unknown part → warning `type-unmapped:<part>`, part skipped. If mapped parts span both alignments (any of {Hero, GE} AND any of {Evil Character, EE}) also add `Dual Alignment`.
  - **colors**: `normalizeBrigadeField(card.brigade, card.alignment, card.name)` in try/catch (skip entirely when `card.brigade` is empty). Map canonical → YTG tag: `Good Gold→Gold`, everything else identity (`Evil Gold` stays `Evil Gold`, `Pale Green` stays, etc.). On throw: warning `brigade-unmapped:<card.brigade>`, no color tags.
  - **set**: `card.officialSet` as-is.
  - **rarity**: only when normalized rarity ∈ {`Legacy Rare`, `Ultra Rare`} (normalize `Ultra-Rare` → `Ultra Rare`).
  - **grouping**: `card.legality === 'Rotation'` → `Rotation Cards`; `card.officialSet.startsWith('Promo')` → `Promos`.
- `variants`/`productOptions`: ALWAYS included (exact Default Title pattern from Global Constraints), `price` = opts.price ?? `"0.00"` (warning `no-price` when null), `sku` = `cardSku(card)`.
- `files`: included only when `opts.imageUrl` is non-null AND `opts.includeMedia !== false`: `[{ originalSource: opts.imageUrl, contentType: 'IMAGE', alt: baseCardName(card.name) }]`. When `imageUrl` is null → warning `no-image`.
- `metafields`: always `[{ namespace: 'custom', key: 'rtt_card_key', value: cardKey, type: 'single_line_text_field' }]`.
- `cardKey` = `` `${card.name}|${card.set}|${card.imgFile}` ``.

- [ ] **Step 1: Extract REAL fixtures.** Pull exact card JSON from generated card data and the matching real YTG product from the dump, to paste into the test:

```bash
cd /Users/timestes/projects/rtt-ytg-import
jq -c '.[] | select(.name == "\"I AM\" Has Sent Me (PoC)" or .name == "Abusive Soldiers (GoC)" or .name == "A Roman Soldier'\''s Faith (Ap)")' lib/cards/generated/cardData.json
jq -c '.[] | select(.title == "\"I AM\" Has Sent Me (PoC)" or .title == "Abusive Soldiers (GoC)" or .title == "A Roman Soldier'\''s Faith (Ap)")' scripts/output/ytg_products.json
```

Use the printed card objects verbatim as test fixtures, and the printed products' `title`/`handle`/`tags` as expected values. Known expected values from the dump (verify against your extraction, trust the extraction if they differ):
- `"I AM" Has Sent Me (PoC)` → handle `i-am-has-sent-me-poc`, tags `Good Enhancement, Green, Prophecies of Christ, Rotation Cards, Teal`
- `A Roman Soldier's Faith (Ap)` → handle `a-roman-soldiers-faith-ap`, tags `Apostles, Good Enhancement, Red` (NO `Rotation Cards` — legality isn't Rotation)

- [ ] **Step 2: Write the failing test** (`lib/shopify/productFromCard.test.ts`). Structure (fill fixtures from Step 1):

```ts
import { describe, it, expect } from 'vitest';
import type { CardData } from '@/lib/cards/generated/cardData';
import { productFromCard, baseCardName, slugifyTitle, cardSku } from './productFromCard';

// Fixtures: EXACT rows from lib/cards/generated/cardData.json (Step 1 extraction)
const I_AM_HAS_SENT_ME: CardData = /* paste */;
const ABUSIVE_SOLDIERS: CardData = /* paste */;
const ROMAN_SOLDIERS_FAITH: CardData = /* paste */;

describe('baseCardName', () => {
  it('strips a trailing set parenthetical', () => {
    expect(baseCardName('Abusive Soldiers (GoC)')).toBe('Abusive Soldiers');
  });
  it('strips a trailing bracket qualifier', () => {
    expect(baseCardName('7 Years of Famine [RR2]')).toBe('7 Years of Famine');
  });
  it('keeps internal quotes/parentheticals', () => {
    expect(baseCardName('"I AM" Has Sent Me (PoC)')).toBe('"I AM" Has Sent Me');
  });
  it('returns names with no qualifier unchanged', () => {
    expect(baseCardName('Son of God')).toBe('Son of God');
  });
});

describe('slugifyTitle', () => {
  it('matches YTG handle for quoted title', () => {
    expect(slugifyTitle('"I AM" Has Sent Me (PoC)')).toBe('i-am-has-sent-me-poc');
  });
  it('collapses apostrophes without a hyphen', () => {
    expect(slugifyTitle("A Roman Soldier's Faith (Ap)")).toBe('a-roman-soldiers-faith-ap');
  });
  it('handles commas and multiple parentheticals', () => {
    expect(slugifyTitle('Abaddon, the Destroyer (AB) (RoJ)')).toBe('abaddon-the-destroyer-ab-roj');
  });
});

describe('productFromCard', () => {
  const opts = { price: '0.75', imageUrl: 'https://blob.example/card-images/x.jpg', status: 'DRAFT' as const };

  it('reproduces the real YTG product shape for "I AM" Has Sent Me (PoC)', () => {
    const built = productFromCard(I_AM_HAS_SENT_ME, 'PoC', opts);
    expect(built.input.title).toBe('"I AM" Has Sent Me (PoC)');
    expect(built.input.handle).toBe('i-am-has-sent-me-poc');
    expect(built.input.tags).toEqual(['Good Enhancement', 'Green', 'Prophecies of Christ', 'Rotation Cards', 'Teal']);
    expect(built.input.productType).toBe('Single');
    expect(built.input.vendor).toBe('Your Turn Games');
    expect(built.input.status).toBe('DRAFT');
    expect(built.input.productOptions).toEqual([{ name: 'Title', values: [{ name: 'Default Title' }] }]);
    expect(built.input.variants).toEqual([{ optionValues: [{ optionName: 'Title', name: 'Default Title' }], price: '0.75', sku: cardSku(I_AM_HAS_SENT_ME) }]);
    expect(built.input.files).toEqual([{ originalSource: opts.imageUrl, contentType: 'IMAGE', alt: '"I AM" Has Sent Me' }]);
    expect(built.warnings).toEqual([]);
  });

  it('maps bare Gold brigade on an evil card to Evil Gold tag', () => {
    const built = productFromCard(ABUSIVE_SOLDIERS, 'GoC', opts);
    expect(built.input.tags).toContain('Evil Gold');
    expect(built.input.tags).not.toContain('Gold');
    expect(built.input.tags).toContain('Evil Character');
    expect(built.input.tags).toContain('Gospel of Christ');
  });

  it('omits Rotation Cards for non-rotation cards', () => {
    const built = productFromCard(ROMAN_SOLDIERS_FAITH, 'Ap', opts);
    expect(built.input.tags).toEqual(['Apostles', 'Good Enhancement', 'Red']);
  });

  it('handles missing price / image / alias with warnings, never throws', () => {
    const built = productFromCard(I_AM_HAS_SENT_ME, null, { price: null, imageUrl: null, status: 'DRAFT' });
    expect(built.input.variants![0].price).toBe('0.00');
    expect(built.input.files).toBeUndefined();
    expect(built.input.title).toBe('"I AM" Has Sent Me (PoC)'); // falls back to card.set
    expect(built.warnings).toEqual(expect.arrayContaining(['no-price', 'no-image', 'no-set-alias']));
  });

  it('omits files when includeMedia is false (update re-run)', () => {
    const built = productFromCard(I_AM_HAS_SENT_ME, 'PoC', { ...opts, includeMedia: false });
    expect(built.input.files).toBeUndefined();
  });

  it('uses titleOverride verbatim and slugs the handle from it', () => {
    const built = productFromCard(I_AM_HAS_SENT_ME, 'PoC', { ...opts, titleOverride: '"I AM" Has Sent Me (Legacy Rare)' });
    expect(built.input.title).toBe('"I AM" Has Sent Me (Legacy Rare)');
    expect(built.input.handle).toBe('i-am-has-sent-me-legacy-rare');
  });

  it('always attaches the rtt_card_key metafield', () => {
    const built = productFromCard(I_AM_HAS_SENT_ME, 'PoC', opts);
    expect(built.input.metafields).toEqual([{ namespace: 'custom', key: 'rtt_card_key', value: built.cardKey, type: 'single_line_text_field' }]);
  });

  it('adds Dual Alignment for cross-alignment compound types', () => {
    const dual: CardData = { ...I_AM_HAS_SENT_ME, type: 'GE/EE' };
    const built = productFromCard(dual, 'PoC', opts);
    expect(built.input.tags).toEqual(expect.arrayContaining(['Good Enhancement', 'Evil Enhancement', 'Dual Alignment']));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-ytg-import && npx vitest run lib/shopify/productFromCard.test.ts`
Expected: FAIL — cannot resolve `./productFromCard`.

- [ ] **Step 4: Implement `lib/shopify/productFromCard.ts`** per the Interfaces/mapping rules above. Full skeleton:

```ts
import type { CardData } from '@/lib/cards/generated/cardData';
import { normalizeBrigadeField } from '@/app/decklist/card-search/utils';
import { sanitizeImgFile } from '@/app/shared/utils/cardImageUrl';

// ... interfaces from the Interfaces block, verbatim ...

const TYPE_TAGS: Record<string, string> = {
  'Hero': 'Hero', 'GE': 'Good Enhancement', 'EE': 'Evil Enhancement',
  'Evil Character': 'Evil Character', 'Artifact': 'Artifact', 'Lost Soul': 'Lost Soul',
  'Dominant': 'Dominant', 'Fortress': 'Fortress', 'Site': 'Site', 'City': 'City',
  'Covenant': 'Covenant', 'Curse': 'Curse',
  'Hero Token': 'Hero', 'Evil Character Token': 'Evil Character', 'Lost Soul Token': 'Lost Soul',
};
const GOOD_TYPE_PARTS = new Set(['Hero', 'GE']);
const EVIL_TYPE_PARTS = new Set(['Evil Character', 'EE']);
// Canonical brigade name -> YTG tag name (identity unless listed)
const BRIGADE_TAGS: Record<string, string> = { 'Good Gold': 'Gold' };

export function baseCardName(name: string): string {
  return name.replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim();
}

export function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/['‘’"“”]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function cardSku(card: CardData): string {
  return `${card.set}-${sanitizeImgFile(card.imgFile)}`.replace(/\s+/g, '');
}

export function productFromCard(card: CardData, ytgAbbrev: string | null, opts: ProductBuildOptions): BuiltProduct {
  const warnings: string[] = [];
  const cardKey = `${card.name}|${card.set}|${card.imgFile}`;
  if (!ytgAbbrev) warnings.push('no-set-alias');
  const title = opts.titleOverride ?? `${baseCardName(card.name)} (${ytgAbbrev ?? card.set})`;
  // tags: type parts + Dual Alignment + brigade colors + officialSet + rarity + grouping,
  // deduped via Set, sorted with .sort()
  // ... per mapping rules ...
  if (opts.price === null) warnings.push('no-price');
  // variants/productOptions always present; files conditional; metafields always
  // ...
  return { cardKey, input, warnings };
}
```

- [ ] **Step 5: Run tests until green**

Run: `cd /Users/timestes/projects/rtt-ytg-import && npx vitest run lib/shopify/productFromCard.test.ts`
Expected: PASS (all). If a tag expectation mismatches the real dump product, trust the dump — adjust the mapping table, not the fixture.

- [ ] **Step 6: Commit**

```bash
cd /Users/timestes/projects/rtt-ytg-import
git add lib/shopify/productFromCard.ts lib/shopify/productFromCard.test.ts
git commit -m "feat(import-set): pure card->ProductSetInput builder with dump-grounded tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: GraphQL write client `admin-write` + tests

**Files:**
- Create: `lib/shopify/admin-write.ts`
- Test: `lib/shopify/admin-write.test.ts`

**Interfaces:**
- Consumes: `getShopifyAccessToken()` from `@/lib/pricing/shopify` (NOT used inside this module's functions — token is passed in); `ShopifyProductSetInput` from `./productFromCard`.
- Produces (used by Task 4):

```ts
export interface ProductSetOutcome {
  productId: string | null;
  variantId: string | null;
  handle: string | null;
  userErrors: { field: string[] | null; message: string; code: string | null }[];
  mock: boolean;
}
export async function shopifyGraphQL<T>(token: string, query: string, variables: Record<string, unknown>, fetchImpl?: typeof fetch): Promise<T>;
export async function productSetUpsert(token: string, input: ShopifyProductSetInput, identifier?: { id: string }, fetchImpl?: typeof fetch): Promise<ProductSetOutcome>;
```

**Behavior:**
- Endpoint `https://your-turn-games.myshopify.com/admin/api/2026-07/graphql.json`, headers `Content-Type: application/json` + `X-Shopify-Access-Token`.
- Retry loop (max 5 attempts): HTTP 429 → wait `Retry-After` seconds (default 2); GraphQL `errors[].extensions.code === 'THROTTLED'` → wait `max(1000, (requestedQueryCost - currentlyAvailable) / restoreRate * 1000)` (fallback 2000ms) and retry. Other `errors` → throw. Non-ok HTTP → throw with body text.
- Pacing: after a successful call, if `extensions.cost.throttleStatus.currentlyAvailable < 100`, sleep `((100 - currentlyAvailable) / restoreRate) * 1000` ms before returning.
- Mock mode: `process.env.SHOPIFY_WRITE_MOCK === '1'` → `productSetUpsert` returns `{ productId: 'gid://shopify/Product/mock-<slug>', variantId: 'gid://shopify/ProductVariant/mock-<slug>', handle: input.handle, userErrors: [], mock: true }` where `<slug>` = `input.handle`. No fetch.
- Mutation (exact):

```graphql
mutation productSetUpsert($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
  productSet(synchronous: true, identifier: $identifier, input: $input) {
    product { id handle variants(first: 1) { nodes { id } } }
    userErrors { field message code }
  }
}
```

- `productSetUpsert` returns `userErrors` verbatim when present (caller decides error handling); `productId`/`variantId`/`handle` come from `data.productSet.product` (null-safe).

- [ ] **Step 1: Write the failing test** (`lib/shopify/admin-write.test.ts`) with a stub `fetchImpl`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { shopifyGraphQL, productSetUpsert } from './admin-write';
import type { ShopifyProductSetInput } from './productFromCard';

const INPUT: ShopifyProductSetInput = {
  title: 'Test Card (XX)', handle: 'test-card-xx', productType: 'Single',
  vendor: 'Your Turn Games', tags: ['Hero'], status: 'DRAFT',
  productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
  variants: [{ optionValues: [{ optionName: 'Title', name: 'Default Title' }], price: '1.00', sku: 'XX-test' }],
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

afterEach(() => { delete process.env.SHOPIFY_WRITE_MOCK; });

describe('shopifyGraphQL', () => {
  it('POSTs query+variables with the access token header and returns data', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: any, init: any) => {
      captured = { url: String(url), init };
      return jsonResponse({ data: { ok: true }, extensions: { cost: { throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 990, restoreRate: 50 } } } });
    }) as typeof fetch;
    const data = await shopifyGraphQL<{ ok: boolean }>('tok', 'query { x }', {}, fetchImpl);
    expect(data).toEqual({ ok: true });
    expect(captured!.url).toBe('https://your-turn-games.myshopify.com/admin/api/2026-07/graphql.json');
    expect((captured!.init.headers as Record<string, string>)['X-Shopify-Access-Token']).toBe('tok');
  });

  it('retries on THROTTLED then succeeds', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) return jsonResponse({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }], extensions: { cost: { requestedQueryCost: 12, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 5, restoreRate: 50 } } } });
      return jsonResponse({ data: { ok: 1 } });
    }) as typeof fetch;
    const data = await shopifyGraphQL<{ ok: number }>('tok', 'q', {}, fetchImpl);
    expect(data).toEqual({ ok: 1 });
    expect(calls).toBe(2);
  }, 15000);

  it('retries on HTTP 429 honoring Retry-After', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) return jsonResponse({}, 429, { 'Retry-After': '0.01' });
      return jsonResponse({ data: { ok: 1 } });
    }) as typeof fetch;
    await shopifyGraphQL('tok', 'q', {}, fetchImpl);
    expect(calls).toBe(2);
  });

  it('throws on non-throttle GraphQL errors', async () => {
    const fetchImpl = (async () => jsonResponse({ errors: [{ message: 'syntax error' }] })) as typeof fetch;
    await expect(shopifyGraphQL('tok', 'q', {}, fetchImpl)).rejects.toThrow(/syntax error/);
  });
});

describe('productSetUpsert', () => {
  it('parses product + variant ids and userErrors', async () => {
    const fetchImpl = (async () => jsonResponse({
      data: { productSet: { product: { id: 'gid://shopify/Product/1', handle: 'test-card-xx', variants: { nodes: [{ id: 'gid://shopify/ProductVariant/2' }] } }, userErrors: [] } },
    })) as typeof fetch;
    const out = await productSetUpsert('tok', INPUT, undefined, fetchImpl);
    expect(out).toEqual({ productId: 'gid://shopify/Product/1', variantId: 'gid://shopify/ProductVariant/2', handle: 'test-card-xx', userErrors: [], mock: false });
  });

  it('returns userErrors without throwing', async () => {
    const fetchImpl = (async () => jsonResponse({
      data: { productSet: { product: null, userErrors: [{ field: ['input', 'title'], message: 'bad', code: 'INVALID' }] } },
    })) as typeof fetch;
    const out = await productSetUpsert('tok', INPUT, undefined, fetchImpl);
    expect(out.productId).toBeNull();
    expect(out.userErrors[0].code).toBe('INVALID');
  });

  it('mock mode fabricates ids and never calls fetch', async () => {
    process.env.SHOPIFY_WRITE_MOCK = '1';
    const fetchImpl = (async () => { throw new Error('should not fetch'); }) as typeof fetch;
    const out = await productSetUpsert('tok', INPUT, undefined, fetchImpl);
    expect(out.mock).toBe(true);
    expect(out.productId).toBe('gid://shopify/Product/mock-test-card-xx');
    expect(out.handle).toBe('test-card-xx');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-ytg-import && npx vitest run lib/shopify/admin-write.test.ts`
Expected: FAIL — cannot resolve `./admin-write`.

- [ ] **Step 3: Implement `lib/shopify/admin-write.ts`** per Behavior above (single retry loop; `const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));`; identifier passed straight through as GraphQL variable, `{ input, identifier }`).

- [ ] **Step 4: Run tests to verify pass**

Run: `cd /Users/timestes/projects/rtt-ytg-import && npx vitest run lib/shopify/admin-write.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-ytg-import
git add lib/shopify/admin-write.ts lib/shopify/admin-write.test.ts
git commit -m "feat(import-set): productSet GraphQL client with throttling + mock mode

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Orchestrator `importSet` + sync helper + tests

**Files:**
- Create: `lib/shopify/importSet.ts`
- Create: `lib/pricing/syncShopifyProducts.ts`
- Modify: `lib/pricing/matching.ts` (ONE word: make `loadSetAliases` exported — `async function loadSetAliases` → `export async function loadSetAliases`. Touch nothing else.)
- Test: `lib/shopify/importSet.test.ts`

**Interfaces:**
- Consumes: `productFromCard`, `cardSku`, `slugifyTitle`, `baseCardName`, types from `./productFromCard`; `productSetUpsert`, `ProductSetOutcome` from `./admin-write`; `getShopifyAccessToken` from `@/lib/pricing/shopify`; `getSupabaseAdmin` from `@/lib/pricing/supabase-admin`; `loadSetAliases`, `runMatchingPipeline`, `computeCheapestPrices` from `@/lib/pricing/matching`; `CARDS` from `@/lib/cards/generated/cardData`; `getCardImageUrl` from `@/app/shared/utils/cardImageUrl`.
- Produces (used by Task 5):

```ts
export interface CardPlan {
  cardKey: string;
  cardName: string;
  title: string;
  handle: string;
  sku: string;
  tags: string[];
  imageUrl: string | null;      // '' from getCardImageUrl is normalized to null
  plannedAction: 'create' | 'update' | 'skip-existing';
  warnings: string[];
}
export interface LedgerRow {
  card_key: string; set_code: string; shopify_product_id: string | null;
  shopify_variant_id: string | null; handle: string | null; status: string;
  media_attached: boolean; error: string | null;
}
export interface PlanContext {
  aliasMap: Map<string, string>;
  ledger: Map<string, LedgerRow>;
  existingHandles: Set<string>;
  existingTitles: Set<string>;
}
export function planCard(card: CardData, ctx: PlanContext): CardPlan;                    // pure
export async function planSetImport(setCode: string): Promise<CardPlan[]>;               // loads ctx, maps planCard
export function listImportableSets(): { code: string; name: string; count: number }[];   // distinct card.set, sorted by name

export interface ImportCardSpec { cardKey: string; price: string | null; include: boolean; titleOverride?: string }
export interface ImportRequest { setCode: string; status: 'DRAFT' | 'ACTIVE'; cards: ImportCardSpec[] }
export interface ImportResultRow { cardKey: string; action: 'created' | 'updated' | 'skipped' | 'error'; productId: string | null; error: string | null; mock: boolean }
export interface ImportSummary { created: number; updated: number; skipped: number; errors: number; reconciled: boolean; mock: boolean }
export async function executeImport(req: ImportRequest): Promise<{ results: ImportResultRow[]; summary: ImportSummary }>;
```

**Behavior:**
- `planCard`: build via `productFromCard(card, ctx.aliasMap.get(card.set) ?? null, { price: null, imageUrl, status: 'DRAFT' })` where `imageUrl = getCardImageUrl(card.imgFile) || null`. plannedAction: ledger hit with non-null `shopify_product_id` → `update`; else computed handle ∈ existingHandles OR computed title ∈ existingTitles → `skip-existing`; else `create`. Suppress `no-price` warning at plan time (prices come from the admin later); keep the others.
- `planSetImport(setCode)`: cards = `CARDS.filter(c => c.set === setCode)`; ctx loads: `loadSetAliases()`, ledger rows `.from('shopify_card_imports').select('*').eq('set_code', setCode)`, and existing handles/titles from `shopify_products` (paginate: `.select('handle, title').range(from, from + 999)` until short page — mirror has ~5k rows).
- `executeImport`:
  1. Recompute the plan context once. For each spec with `include` (skip rest): find card by cardKey from `CARDS` (build a Map first); missing card → result `error` "unknown card_key".
  2. Card's ledger row decides `identifier` (`{ id: row.shopify_product_id }` when present) and `includeMedia` (`!row?.media_attached`). Cards planned `skip-existing` WITHOUT a ledger row → result `skipped` and ledger upsert `status: 'skipped'`, no Shopify call.
  3. Validate price: `/^\d+(\.\d{1,2})?$/` after trim; invalid non-null price → result `error`, no call. Normalize with `Number(p).toFixed(2)`; null stays null (builder emits `0.00` + warning).
  4. Build with `productFromCard(card, alias, { price, imageUrl, status: req.status, titleOverride, includeMedia })`; call `productSetUpsert(token, built.input, identifier)`. Token: `await getShopifyAccessToken()` once up front — in mock mode (`SHOPIFY_WRITE_MOCK === '1'`) skip token fetch and pass `'mock'`.
  5. `userErrors.length > 0` → action `error` (join messages). Else action `created` (no identifier) / `updated` (identifier). Upsert ledger row after EVERY card (onConflict `card_key`): status, ids, handle, `media_attached: previous || files were included`, error, `updated_at: new Date().toISOString()`.
  6. Per-card try/catch: a throw records `error` result + ledger row and CONTINUES the batch.
  7. Sequential loop (no concurrency — pacing lives in the client; ~2-4 cards/s is fine for ≤350-card sets).
  8. Reconcile at the end ONLY if at least one `created`/`updated` AND not mock: `await syncShopifyProducts(); await runMatchingPipeline({ setCodes: [req.setCode] }); await computeCheapestPrices();` — wrap in try/catch, set `summary.reconciled` accordingly (a reconcile failure must not fail the import response).
- `lib/pricing/syncShopifyProducts.ts`: extract of the sync body already duplicated in `app/api/admin/sync-shopify/route.ts:5-40` and the cron — `getShopifyAccessToken()` → `fetchAllShopifyProducts(token, 'Single')` → map to rows (same fields incl. `raw_json`, `last_synced_at`) → upsert `shopify_products` in batches of 500, `onConflict: 'id'`. Returns count synced. DO NOT modify the two existing call sites (surgical-changes rule).

- [ ] **Step 1: Write the failing test** for the pure/deterministic parts (`lib/shopify/importSet.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { planCard, listImportableSets, type PlanContext, type LedgerRow } from './importSet';
import { CARDS } from '@/lib/cards/generated/cardData';

const rr2Card = CARDS.find(c => c.set === 'RR2')!; // any Roots 2 card

function ctx(overrides: Partial<PlanContext> = {}): PlanContext {
  return { aliasMap: new Map([['RR2', 'Roots 2']]), ledger: new Map(), existingHandles: new Set(), existingTitles: new Set(), ...overrides };
}

describe('planCard', () => {
  it('plans create for an unknown card', () => {
    const plan = planCard(rr2Card, ctx());
    expect(plan.plannedAction).toBe('create');
    expect(plan.cardKey).toBe(`${rr2Card.name}|${rr2Card.set}|${rr2Card.imgFile}`);
    expect(plan.title.endsWith('(Roots 2)')).toBe(true);
    expect(plan.warnings).not.toContain('no-price'); // suppressed at plan time
  });

  it('plans update when the ledger has a product id', () => {
    const key = `${rr2Card.name}|${rr2Card.set}|${rr2Card.imgFile}`;
    const row: LedgerRow = { card_key: key, set_code: 'RR2', shopify_product_id: 'gid://shopify/Product/9', shopify_variant_id: null, handle: 'x', status: 'created', media_attached: true, error: null };
    const plan = planCard(rr2Card, ctx({ ledger: new Map([[key, row]]) }));
    expect(plan.plannedAction).toBe('update');
  });

  it('plans skip-existing on handle collision with the store mirror', () => {
    const first = planCard(rr2Card, ctx());
    const plan = planCard(rr2Card, ctx({ existingHandles: new Set([first.handle]) }));
    expect(plan.plannedAction).toBe('skip-existing');
  });
});

describe('listImportableSets', () => {
  it('includes RR2 with its official name and a plausible count', () => {
    const sets = listImportableSets();
    const rr2 = sets.find(s => s.code === 'RR2');
    expect(rr2).toBeDefined();
    expect(rr2!.name).toBe('Roots 2');
    expect(rr2!.count).toBeGreaterThan(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-ytg-import && npx vitest run lib/shopify/importSet.test.ts`
Expected: FAIL — cannot resolve `./importSet`.

- [ ] **Step 3: Make `loadSetAliases` exported in `lib/pricing/matching.ts`** (add the `export` keyword at its definition, ~line 52 — nothing else).

- [ ] **Step 4: Implement `lib/pricing/syncShopifyProducts.ts` and `lib/shopify/importSet.ts`** per Behavior above.

- [ ] **Step 5: Run the new test + the whole suite**

Run: `cd /Users/timestes/projects/rtt-ytg-import && npx vitest run lib/shopify/ && npm test`
Expected: new tests PASS; full suite has no NEW failures (note any pre-existing failures and leave them).

- [ ] **Step 6: Commit**

```bash
cd /Users/timestes/projects/rtt-ytg-import
git add lib/shopify/importSet.ts lib/shopify/importSet.test.ts lib/pricing/syncShopifyProducts.ts lib/pricing/matching.ts
git commit -m "feat(import-set): set import orchestrator, ledger writes, reconcile hook

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: API route `app/api/admin/import-set/route.ts`

**Files:**
- Create: `app/api/admin/import-set/route.ts`

**Interfaces:**
- Consumes: `planSetImport`, `executeImport`, `listImportableSets`, `ImportRequest` from `@/lib/shopify/importSet`; `isRegistrationAdmin` from `@/utils/adminUtils`; `NextRequest`/`NextResponse` from `next/server`.
- Produces (consumed by Task 6 UI):
  - `GET /api/admin/import-set` → `200 { sets: { code, name, count }[] }`
  - `GET /api/admin/import-set?set=RR2` → `200 { setCode: 'RR2', plans: CardPlan[] }`
  - `POST` body `{ setCode: string; status: 'DRAFT'|'ACTIVE'; dryRun?: boolean; cards: { cardKey: string; price: string|null; include: boolean; titleOverride?: string }[] }`
    - `dryRun: true` → `200 { plans: CardPlan[] }` (same as GET preview — no writes)
    - else → `200 { results: ImportResultRow[], summary: ImportSummary }`
  - Unauthed → `403 { error: 'Admin access required' }`. Bad input → `400 { error }`. Failure → `500 { error }`.

- [ ] **Step 1: Implement the route** (no unit test — route is thin glue; verified via curl + UI):

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isRegistrationAdmin } from '@/utils/adminUtils';
import { planSetImport, executeImport, listImportableSets, type ImportRequest } from '@/lib/shopify/importSet';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!(await isRegistrationAdmin())) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  try {
    const setCode = request.nextUrl.searchParams.get('set');
    if (!setCode) return NextResponse.json({ sets: listImportableSets() });
    const plans = await planSetImport(setCode);
    if (plans.length === 0) return NextResponse.json({ error: `Unknown set: ${setCode}` }, { status: 400 });
    return NextResponse.json({ setCode, plans });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await isRegistrationAdmin())) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const { setCode, status, dryRun, cards } = body as ImportRequest & { dryRun?: boolean };
    if (!setCode || (status !== 'DRAFT' && status !== 'ACTIVE') || !Array.isArray(cards)) {
      return NextResponse.json({ error: 'setCode, status (DRAFT|ACTIVE) and cards[] are required' }, { status: 400 });
    }
    if (dryRun) return NextResponse.json({ plans: await planSetImport(setCode) });
    const { results, summary } = await executeImport({ setCode, status, cards });
    return NextResponse.json({ results, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/timestes/projects/rtt-ytg-import && npx tsc --noEmit`
Expected: no NEW errors (compare against `git stash`-free baseline by running once before Task 2 if unsure; repo compiles clean on main).

- [ ] **Step 3: Commit**

```bash
cd /Users/timestes/projects/rtt-ytg-import
git add app/api/admin/import-set/route.ts
git commit -m "feat(import-set): admin-gated preview/execute API route

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Admin UI `app/admin/import-set/page.tsx`

**Files:**
- Create: `app/admin/import-set/page.tsx` (single `"use client"` file, follows `app/admin/registrations/page.tsx` conventions: `useIsAdmin()` gate, `components/ui` primitives, Tailwind tokens, hand-rolled layout)

**Interfaces:**
- Consumes: the Task 5 route (`fetch('/api/admin/import-set…')`); `useIsAdmin` from `@/hooks/useIsAdmin`; `Button`, `Input`, `Label` from `@/components/ui/*`; `TopNav` if the registrations page uses it (mirror its import).
- Produces: page at `/admin/import-set`.

**Required UI behavior (spec §5, §6b, §10):**
1. **Gate:** `useIsAdmin()`; while loading show nothing; if not admin, `router.replace('/')`.
2. **Set picker:** on mount `GET /api/admin/import-set` → `<select>` of `sets` as `Roots 2 (RR2) — 224 cards`; choosing one fetches `?set=CODE` and stores `plans` in state alongside per-row UI state: `{ include: plannedAction === 'create', price: '', titleOverride: '' }` (rows planned `update` default include=false too — re-runs are opt-in; `skip-existing` rows default include=false and show a "exists in store" badge).
3. **Preview table** (wrap in `overflow-x-auto`): columns — include checkbox · thumbnail (`<img src={imageUrl} className="h-14 w-10 object-contain" loading="lazy">`, gray "no image" box + amber warning when null) · card name · computed title (small text; editable via a per-row title-override input shown when the row has warnings or on a per-row "edit" toggle — keep simple: always render a text input prefilled empty with placeholder = computed title) · tags (small, comma-joined) · planned action badge (`create` neutral, `update` blue, `skip-existing` amber) · warnings (amber text, comma-joined) · price `<Input inputMode="decimal">`.
4. **Bulk price helpers** above the table: default-price input + "Apply to blank rows" button; "Set ALL prices to X" button (both operate on included rows only). Show count: "N included · M with blank price".
5. **Draft/Active toggle:** a labeled checkbox "Publish as ACTIVE immediately (default: DRAFT)". Unchecked = DRAFT.
6. **Buttons:** "Dry run" → POST with `dryRun: true`, re-renders plans (confirms server agrees) and shows a green-free confirmation line "Dry run OK — N cards planned, no writes". "Import N cards" → `window.confirm` summarizing (N cards, X blank prices, DRAFT/ACTIVE) then POST for real; disable while running with progress text.
7. **Results panel:** table of `results` rows (cardKey → action badge / productId / error text), plus summary line "created X · updated Y · skipped Z · errors W" and, when `summary.mock`, a violet "MOCK MODE — no real Shopify writes" banner. When `summary.reconciled` show "Price pipeline reconciled".
8. **Validation:** price inputs validate `/^\d*\.?\d{0,2}$/` on change (reject other keystrokes); blank allowed (flagged amber in the row).
9. Styling: `bg-card border rounded-lg`, `bg-muted` header row, `divide-y` body, `text-muted-foreground` secondary text — copy the registrations page's table classes. NO `focus:ring` classes, NO green accents at rest.

- [ ] **Step 1: Implement the page** per the behavior list. Keep it one file, ~350-450 lines. State shape:

```ts
type RowState = { include: boolean; price: string; titleOverride: string };
const [sets, setSets] = useState<{ code: string; name: string; count: number }[]>([]);
const [setCode, setSetCode] = useState('');
const [plans, setPlans] = useState<CardPlan[]>([]);          // CardPlan type inlined locally (mirror lib/shopify/importSet.ts CardPlan)
const [rows, setRows] = useState<Record<string, RowState>>({}); // keyed by cardKey
const [active, setActive] = useState(false);
const [defaultPrice, setDefaultPrice] = useState('');
const [running, setRunning] = useState(false);
const [results, setResults] = useState<ImportResultRow[] | null>(null);
const [summary, setSummary] = useState<ImportSummary | null>(null);
const [dryRunMsg, setDryRunMsg] = useState('');
const [error, setError] = useState('');
```

POST body construction: `cards: plans.map(p => ({ cardKey: p.cardKey, price: rows[p.cardKey].price.trim() || (defaultPrice.trim() || null), include: rows[p.cardKey].include, titleOverride: rows[p.cardKey].titleOverride.trim() || undefined }))`.

- [ ] **Step 2: Type-check + lint pass**

Run: `cd /Users/timestes/projects/rtt-ytg-import && npx tsc --noEmit`
Expected: clean (no new errors).

- [ ] **Step 3: Smoke-run in dev with mock mode** (only if a dev server can be started cleanly; otherwise skip — Task 7 covers verification):

```bash
cd /Users/timestes/projects/rtt-ytg-import && SHOPIFY_WRITE_MOCK=1 npm run dev
```

Load `/admin/import-set` logged in as an admin, pick a small set, eyeball the table. (The `verify` skill documents minting admin sessions if needed.)

- [ ] **Step 4: Commit**

```bash
cd /Users/timestes/projects/rtt-ytg-import
git add app/admin/import-set/page.tsx
git commit -m "feat(import-set): admin preview/import UI with editable prices

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Verification, migration apply, PR

**Files:** none new

- [ ] **Step 1: Full test suite**

Run: `cd /Users/timestes/projects/rtt-ytg-import && npm test`
Expected: all new tests pass; zero NEW failures vs main.

- [ ] **Step 2: Type gate**

Run: `cd /Users/timestes/projects/rtt-ytg-import && npx tsc --noEmit`
Expected: clean. (Skip full `next build` per standing user preference; if run anyway, use `NEXT_DIST_DIR=.next-build` to avoid clobbering a live dev server.)

- [ ] **Step 3: Mock end-to-end sanity** — exercise `executeImport` directly against a tiny slice with `SHOPIFY_WRITE_MOCK=1` using a scratch script (NOT committed) that imports 2 cards of a small set with fake prices and prints results; confirm ledger rows land in Supabase (needs `SUPABASE_SERVICE_ROLE_KEY` in env — if unavailable, note it and rely on unit tests).

- [ ] **Step 4: Apply migration 080 to prod via Supabase MCP** (`mcp__supabase__apply_migration`, name `080_create_shopify_card_imports`) — additive, empty table, zero-risk. If MCP unavailable, note in PR that migration needs applying.

- [ ] **Step 5: Push + PR**

```bash
cd /Users/timestes/projects/rtt-ytg-import
git push -u origin feat/ytg-set-import
gh pr create --base main --title "feat: YTG Shopify set importer (draft-first, productSet)" --body "$(cat <<'EOF'
## Summary
- Admin page + API to create one Shopify product per card of a set in YTG's store (spec: docs/superpowers/specs/2026-07-25-ytg-shopify-set-import-design.md)
- Pure `productFromCard` builder grounded in real YTG dump conventions (title/handle/tags), unit-tested
- GraphQL `productSet` write client (API 2026-07) with cost-based throttling, THROTTLED/429 retry, and `SHOPIFY_WRITE_MOCK=1` mode
- `shopify_card_imports` ledger (migration 080) for idempotent re-runs; reconciles into the existing pricing pipeline post-import
- Draft-first with explicit ACTIVE toggle; per-card editable prices with bulk helpers; dry-run preview

## Blocked on YTG
- `write_products` scope on the custom app — until granted, real imports will 403; mock mode + dry-run fully work

## Test plan
- [x] `npm test` (builder + client + planner units, dump-grounded fixtures)
- [x] `tsc --noEmit`
- [ ] Live small-set draft import once scope is granted (spec §11.4)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Clean up worktree** (AFTER PR is open; keep it if follow-ups are expected):

```bash
git -C /Users/timestes/projects/redemption-tournament-tracker worktree remove ../rtt-ytg-import
```

---

## Self-review notes (spec → task coverage)

- §5 architecture units → Tasks 2 (builder), 3 (admin-write), 4 (importSet + ledger use), 5 (route), 6 (page), 1 (migration). CSV adapter (§4 fallback, phase 5 "optional") — deliberately NOT included; spec marks it optional.
- §6 field mapping + §6a images + §6b prices → Task 2 rules + Task 6 UI helpers.
- §7 idempotency (ledger, identifier, handle pre-check, sku, metafield) → Tasks 2 (sku/metafield), 4 (ledger/identifier/pre-check via mirror).
- §8 API details → Task 3 (endpoint/version/mutation/throttle), scope limitation handled via mock mode + PR note.
- §9 reconcile → Task 4 step 8.
- §10 safety → draft default (Tasks 2/5/6), dry-run (5/6), validation (4/6), per-card isolation (4), admin gate (5).
- §11 testing → dump-grounded unit tests (2), dry-run (6), live trial deferred to post-scope-grant (PR note).
- Handle pre-check uses the local `shopify_products` mirror, not a live Shopify query — documented tradeoff (mirror refreshes nightly + at each import's reconcile).
