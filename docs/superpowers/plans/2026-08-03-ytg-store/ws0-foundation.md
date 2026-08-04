# WS-0: YTG Store Foundation — Shell, Gate, Sync Extension, Shared Contracts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task-by-task with review checkpoints. Steps use checkbox (`- [ ]`) syntax — check them off as you complete them.

**Goal**

Land the permission-gated `/admin/ytg` shell (layout gate + health strip + tab nav + moved importer + skeleton tabs), put `hasPermission('manage_shopify_imports')` auth on the five naked pricing routes, extend the Shopify sync to mirror `sku`/`body_html` across singles + deck product types (collapsing the three duplicated sync bodies onto one function), and ship the shared contracts the parallel workstreams consume: migration 088, `lib/ytg/constants.ts` (`DECK_PRODUCT_TYPES`), and `lib/shopify/aliasBatch.ts` (`runAliasedMutations`).

**Architecture**

`app/admin/ytg/layout.tsx` is a server component that gates the whole area with `hasPermission('manage_shopify_imports')` → `notFound()` (the `/admin/permissions` precedent, upgrading the importer's client-only redirect), and renders the shared chrome — `<TopNav/>`, header, server-rendered `<HealthStrip/>`, client `<YtgTabs/>` — around `{children}`. Tabs are route segments (`import`/`products`/`matching`/`decks`) so WS-1/2/3 each own exactly one directory; WS-0 ships skeletons for the three future tabs so no parallel workstream ever touches a shared file. Sync consolidation moves all mirror writes through `syncShopifyProducts()` in `lib/pricing/syncShopifyProducts.ts`.

**Tech Stack**

- Next.js 15 App Router, React 19, TypeScript (`strict: false` — see constraints)
- Supabase service-role reads/writes via `lib/pricing/supabase-admin.ts`; auth-session permission checks via `utils/adminUtils.ts` `hasPermission`
- Shopify REST 2024-01 reads (`lib/pricing/shopify.ts`), GraphQL Admin 2026-07 writes (`lib/shopify/admin-write.ts` `shopifyGraphQL`)
- Tailwind + shadcn/ui (`@/components/ui/*`), vitest (`npm test` = `vitest run`)

**Global Constraints**

Inherit `docs/superpowers/plans/2026-08-03-ytg-store/00-overview.md` §Global constraints. WS-0-specific additions:

- **Branch:** `feat/ytg-store-shell`. **Worktree:** `../rtt-ytg-shell` → absolute path `/Users/timestes/projects/rtt-ytg-shell`. All commands below run from that worktree root; never touch `/Users/timestes/projects/redemption-tournament-tracker`.
- **Migration 088 is committed only, never applied.** The primary session applies it via Supabase MCP at merge time. The PR body must state that 088 must be applied before (or immediately with) the deploy — the new sync upsert includes `sku`/`body_html` columns and every upsert batch fails (logged + counted in `errors`) until the columns exist.
- **Importer move is a minimal diff.** The 687-line `app/admin/import-set/page.tsx` moves via `git mv` and receives ONLY the edits in Task 8 (remove `<TopNav/>`, remove the client gate, neutralize the chrome wrappers, demote its `h1`). Do NOT reformat, rename, reorder, or otherwise refactor anything else in that file.
- **Do not touch WS-1/2/3 surfaces:** `lib/pricing/matching.ts`, `lib/shopify/productFromCard.ts`, `lib/shopify/importSet.ts` are all read-only for WS-0 (verified: `importSet.ts:391` discards `syncShopifyProducts()`'s return value, so the signature change needs no edit there).
- **Status vocabulary (verified against code, not the spec's shorthand):** `card_price_mappings.status` values are `auto_matched`, `manual`, `needs_review`, `unmatched`, `no_price_exists` (see `lib/pricing/matching.ts:169,652,825,719` and `:943` where "confirmed" = `.in('status', ['auto_matched','manual'])`). The design doc's "matched" status is `auto_matched` in the DB — the health strip must query `['auto_matched','manual']`, never a literal `'matched'`.
- Design: no `focus:ring-2` anywhere; sectioning via background shifts (`bg-card`, `bg-muted`) per `prompt_context/design_system.md`; no new 1px borders in new components.

---

### Task 1: Create isolated worktree

**Files:** none (environment setup only)

**Interfaces:** none

- [ ] From the main checkout, create the worktree and branch:
  ```bash
  cd /Users/timestes/projects/redemption-tournament-tracker
  git fetch origin
  git worktree add ../rtt-ytg-shell -b feat/ytg-store-shell origin/main
  ```
- [ ] Install dependencies in the worktree (required for `tsc`/`vitest` there):
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell
  npm install
  ```
- [ ] Baseline gates — both must pass before any edits (if they don't, stop and report; do not fix pre-existing failures):
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell && npx tsc --noEmit
  cd /Users/timestes/projects/rtt-ytg-shell && npm test
  ```

---

### Task 2: Migration 088 + `lib/ytg/constants.ts`

**Files:**
- Create: `supabase/migrations/088_shopify_products_sku_body_html.sql`
- Create: `lib/ytg/constants.ts`

**Interfaces:**
- Produces: `DECK_PRODUCT_TYPES: readonly ["Contender Deck", "Challenger Deck", "Champion Deck"]` — consumed by Task 4's sync and later by WS-3.
- Produces: `shopify_products.sku TEXT`, `shopify_products.body_html TEXT`, partial index `idx_shopify_products_sku` — consumed by Task 4's upsert and WS-2's pass 0.

- [ ] Create `supabase/migrations/088_shopify_products_sku_body_html.sql` with exactly this content (DDL is verbatim from the overview's shared contract):
  ```sql
  -- WS-0 (YTG Store): mirror deterministic identity + description text on the
  -- Shopify product cache. `sku` feeds matching pass 0 (WS-2); `body_html`
  -- feeds the ability-text disambiguator (WS-2) and the deck-contents wizard
  -- (WS-3). Both fields are already present in the REST payload the sync
  -- fetches — backfill happens on the first sync run after deploy.
  -- Applied to prod by the primary session via Supabase MCP only; this file
  -- ships in the WS-0 PR unapplied.

  ALTER TABLE shopify_products ADD COLUMN IF NOT EXISTS sku TEXT;
  ALTER TABLE shopify_products ADD COLUMN IF NOT EXISTS body_html TEXT;
  CREATE INDEX IF NOT EXISTS idx_shopify_products_sku ON shopify_products(sku) WHERE sku IS NOT NULL;
  ```
- [ ] Create `lib/ytg/constants.ts` with exactly this content (shape from the overview §Constants; WS-0 ships `DECK_PRODUCT_TYPES` only — WS-3 adds `YTG_ACCOUNT_USER_ID` to this same file later):
  ```ts
  // Shared YTG store constants. WS-3 adds YTG_ACCOUNT_USER_ID here — see
  // docs/superpowers/plans/2026-08-03-ytg-store/00-overview.md §Constants.

  export const DECK_PRODUCT_TYPES = ["Contender Deck", "Challenger Deck", "Champion Deck"] as const;
  ```
- [ ] Verify: `cd /Users/timestes/projects/rtt-ytg-shell && npx tsc --noEmit`
- [ ] Commit:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell
  git add supabase/migrations/088_shopify_products_sku_body_html.sql lib/ytg/constants.ts
  git commit -m "$(cat <<'EOF'
  Add migration 088 (shopify_products sku/body_html) and YTG deck-type constants

  Shared WS-0 contracts: sku + body_html columns with a partial sku index
  (committed only — applied by the primary session at merge), and
  DECK_PRODUCT_TYPES for the multi-type sync. WS-3 later adds
  YTG_ACCOUNT_USER_ID to lib/ytg/constants.ts.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: `lib/shopify/aliasBatch.ts` — `runAliasedMutations` (test-first)

**Files:**
- Test: `lib/shopify/aliasBatch.test.ts` (create FIRST)
- Create: `lib/shopify/aliasBatch.ts`

**Interfaces:**
- Consumes: `shopifyGraphQL<T>(token: string, query: string, variables: Record<string, unknown>, fetchImpl?: typeof fetch): Promise<T>` from `lib/shopify/admin-write.ts:28` (THROTTLED/429 retries live there and are inherited); `getShopifyAccessToken(): Promise<string>` from `lib/pricing/shopify.ts:10`.
- Produces (exact overview contract):
  ```ts
  export interface AliasedMutation { alias: string; mutation: string; selection: string; }
  export interface AliasedResult { alias: string; data: unknown | null; userErrors: { field?: string[] | null; message: string }[]; }
  export async function runAliasedMutations(calls: AliasedMutation[], opts?: { batchSize?: number }): Promise<AliasedResult[]>;
  ```

- [ ] Create `lib/shopify/aliasBatch.test.ts` with exactly this content:
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest';

  const { shopifyGraphQLMock } = vi.hoisted(() => ({ shopifyGraphQLMock: vi.fn() }));

  vi.mock('./admin-write', () => ({ shopifyGraphQL: shopifyGraphQLMock }));
  vi.mock('@/lib/pricing/shopify', () => ({ getShopifyAccessToken: vi.fn(async () => 'tok') }));

  import { runAliasedMutations, type AliasedMutation } from './aliasBatch';

  function call(n: number): AliasedMutation {
    return {
      alias: `m${n}`,
      mutation: `tagsAdd(id: "gid://shopify/Product/${n}", tags: ["X"])`,
      selection: '{ userErrors { field message } }',
    };
  }

  // Builds a success payload for every alias found in the submitted document.
  function echoAliases(query: string): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const alias of query.match(/\bm\d+(?=:)/g) ?? []) data[alias] = { userErrors: [] };
    return data;
  }

  beforeEach(() => {
    shopifyGraphQLMock.mockReset();
  });

  describe('runAliasedMutations', () => {
    it('returns [] for empty input without calling Shopify', async () => {
      const out = await runAliasedMutations([]);
      expect(out).toEqual([]);
      expect(shopifyGraphQLMock).not.toHaveBeenCalled();
    });

    it('chunks calls at batchSize into separate documents, preserving order', async () => {
      shopifyGraphQLMock.mockImplementation(async (_token: string, query: string) => echoAliases(query));
      const calls = Array.from({ length: 5 }, (_, i) => call(i));

      const out = await runAliasedMutations(calls, { batchSize: 2 });

      expect(shopifyGraphQLMock).toHaveBeenCalledTimes(3); // 2 + 2 + 1
      expect(shopifyGraphQLMock.mock.calls[0][0]).toBe('tok');
      const firstDoc = shopifyGraphQLMock.mock.calls[0][1] as string;
      expect(firstDoc).toContain('m0: tagsAdd(id: "gid://shopify/Product/0", tags: ["X"]) { userErrors { field message } }');
      expect(firstDoc).toContain('m1: tagsAdd');
      expect(firstDoc).not.toContain('m2:');
      expect(out).toHaveLength(5);
      expect(out.map((r) => r.alias)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
    });

    it('maps per-alias userErrors from each payload and returns the payload as data', async () => {
      shopifyGraphQLMock.mockResolvedValue({
        m0: { userErrors: [] },
        m1: { userErrors: [{ field: ['tags'], message: 'too many tags' }] },
      });

      const out = await runAliasedMutations([call(0), call(1)]);

      expect(out[0].userErrors).toEqual([]);
      expect(out[0].data).toEqual({ userErrors: [] });
      expect(out[1].userErrors).toEqual([{ field: ['tags'], message: 'too many tags' }]);
      expect(out[1].data).toEqual({ userErrors: [{ field: ['tags'], message: 'too many tags' }] });
    });

    it('a missing alias in the response yields data: null with no userErrors', async () => {
      shopifyGraphQLMock.mockResolvedValue({ m0: { userErrors: [] } });
      const out = await runAliasedMutations([call(0), call(1)]);
      expect(out[1]).toEqual({ alias: 'm1', data: null, userErrors: [] });
    });

    it('a rejected chunk produces synthetic userErrors for only that chunk, other chunks unaffected', async () => {
      shopifyGraphQLMock
        .mockResolvedValueOnce({ m0: { userErrors: [] }, m1: { userErrors: [] } })
        .mockRejectedValueOnce(new Error('MAX_COST_EXCEEDED'))
        .mockResolvedValueOnce({ m4: { userErrors: [] } });
      const calls = Array.from({ length: 5 }, (_, i) => call(i));

      const out = await runAliasedMutations(calls, { batchSize: 2 });

      expect(out).toHaveLength(5); // one AliasedResult per input, always
      expect(out[0].userErrors).toEqual([]);
      expect(out[1].userErrors).toEqual([]);
      expect(out[2].data).toBeNull();
      expect(out[2].userErrors).toHaveLength(1);
      expect(out[2].userErrors[0].message).toMatch(/MAX_COST_EXCEEDED/);
      expect(out[3].data).toBeNull();
      expect(out[3].userErrors[0].message).toMatch(/MAX_COST_EXCEEDED/);
      expect(out[4].userErrors).toEqual([]);
    });
  });
  ```
- [ ] Run the test and watch it FAIL (module `./aliasBatch` does not exist yet):
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell && npx vitest run lib/shopify/aliasBatch.test.ts
  ```
- [ ] Create `lib/shopify/aliasBatch.ts` with exactly this content:
  ```ts
  /**
   * Batched aliased GraphQL mutations against the Shopify Admin API.
   *
   * Chunks calls ≤batchSize per document (default 40 — the single-document
   * cost cap is 1,000 points at ~10/mutation) and sends each chunk through
   * shopifyGraphQL, inheriting its THROTTLED/429 retry behavior. Per-alias
   * userErrors are mapped back onto each call. A thrown transport or
   * MAX_COST_EXCEEDED error rejects only that chunk's calls, returned as
   * synthetic userErrors — callers ALWAYS get exactly one AliasedResult per
   * input mutation, in input order.
   *
   * Mock/dry-run (SHOPIFY_WRITE_MOCK) is deliberately NOT handled here:
   * callers (WS-1 tag sync, WS-2 SKU backfill) own what a mocked apply looks
   * like and must short-circuit before calling this.
   */

  import { shopifyGraphQL } from './admin-write';
  import { getShopifyAccessToken } from '@/lib/pricing/shopify';

  export interface AliasedMutation {
    alias: string;              // unique per call site, e.g. "m0", "m1"
    mutation: string;           // field with args, e.g. `tagsAdd(id: "gid://...", tags: ["X"])`
    selection: string;          // e.g. `{ userErrors { field message } }`
  }

  export interface AliasedResult {
    alias: string;
    data: unknown | null;       // the alias's payload, null on absent
    userErrors: { field?: string[] | null; message: string }[];
  }

  const DEFAULT_BATCH_SIZE = 40;

  export async function runAliasedMutations(
    calls: AliasedMutation[],
    opts?: { batchSize?: number },
  ): Promise<AliasedResult[]> {
    if (calls.length === 0) return [];

    const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;
    const token = await getShopifyAccessToken();
    const results: AliasedResult[] = [];

    for (let i = 0; i < calls.length; i += batchSize) {
      const chunk = calls.slice(i, i + batchSize);
      const document = `mutation {\n${chunk
        .map((c) => `${c.alias}: ${c.mutation} ${c.selection}`)
        .join('\n')}\n}`;

      try {
        const data = await shopifyGraphQL<Record<string, unknown>>(token, document, {});
        for (const c of chunk) {
          const payload = (data ? data[c.alias] : null) as
            | { userErrors?: { field?: string[] | null; message: string }[] }
            | null
            | undefined;
          results.push({
            alias: c.alias,
            data: payload ?? null,
            userErrors: payload && Array.isArray(payload.userErrors) ? payload.userErrors : [],
          });
        }
      } catch (err) {
        // Whole-document failure (transport error, MAX_COST_EXCEEDED, retry
        // exhaustion). Only THIS chunk's calls fail; later chunks still run.
        const message = err instanceof Error ? err.message : 'Unknown error';
        for (const c of chunk) {
          results.push({
            alias: c.alias,
            data: null,
            userErrors: [{ message: `Batch request failed: ${message}` }],
          });
        }
      }
    }

    return results;
  }
  ```
- [ ] Run the test and watch it PASS:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell && npx vitest run lib/shopify/aliasBatch.test.ts
  ```
- [ ] Verify no type or suite regressions:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell && npx tsc --noEmit && npm test
  ```
- [ ] Commit:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell
  git add lib/shopify/aliasBatch.ts lib/shopify/aliasBatch.test.ts
  git commit -m "$(cat <<'EOF'
  Add runAliasedMutations: chunked aliased Shopify mutations with per-alias errors

  WS-0 shared contract consumed by WS-1 (tag sync) and WS-2 (SKU backfill).
  Chunks at 40 mutations/document, inherits shopifyGraphQL's throttle
  retries, and converts a rejected document into synthetic userErrors for
  only that chunk — callers always get one AliasedResult per input.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: Sync extension — sku/body_html, deck types, collapse the duplicated bodies

**Files:**
- Modify: `lib/pricing/shopify.ts` (the `ShopifyAPIProduct` interface, lines 38–51)
- Modify: `lib/pricing/syncShopifyProducts.ts` (full rewrite of the 49-line file)
- Modify: `app/api/admin/sync-shopify/route.ts` (full rewrite of the 47-line file — includes its `hasPermission` 403 gate)
- Modify: `app/api/cron/sync-prices/route.ts` (imports lines 1–4, sync section lines 17–45, response line 60)

**Interfaces:**
- Consumes: `fetchAllShopifyProducts(token: string, productType?: string): Promise<ShopifyAPIProduct[]>` (`lib/pricing/shopify.ts:56` — takes ONE type per call, hence one REST pass per type); `DECK_PRODUCT_TYPES` from Task 2; `getSupabaseAdmin(): any` (`lib/pricing/supabase-admin.ts:13`); `hasPermission(permission: string): Promise<boolean>` (`utils/adminUtils.ts:33`).
- Produces: `syncShopifyProducts(): Promise<{ upserted: number; errors: number }>` (overview §Sync signature after WS-0). Sole existing caller `lib/shopify/importSet.ts:391` awaits and discards the result — no change there.

- [ ] In `lib/pricing/shopify.ts`, extend the local `ShopifyAPIProduct` interface (currently lines 38–51) by adding `body_html` (variants already carry `sku`). The interface becomes exactly:
  ```ts
  interface ShopifyAPIProduct {
    id: number | string;
    title: string;
    handle: string;
    tags: string;
    product_type: string;
    body_html: string | null;
    variants: {
      id: number | string;
      title: string;
      price: string;
      sku: string;
      inventory_quantity: number;
    }[];
  }
  ```
  Touch nothing else in this file (the REST default payload already includes `body_html` and `variants[].sku` — no fetch changes needed).
- [ ] Replace the entire content of `lib/pricing/syncShopifyProducts.ts` with:
  ```ts
  /**
   * Sync Shopify products into the `shopify_products` mirror table.
   *
   * The single shared sync implementation. Callers:
   *  - app/api/admin/sync-shopify/route.ts  (manual admin trigger)
   *  - app/api/cron/sync-prices/route.ts    (nightly cron)
   *  - lib/shopify/importSet.ts             (post-import reconcile)
   *
   * Fetches singles plus the three deck product types — one paginated REST
   * pass per type, because fetchAllShopifyProducts takes a single
   * product_type value — and mirrors `sku` (variants[0].sku) + `body_html`
   * for the matching pass 0 and deck tooling (migration 088 columns).
   * Per-row upsert on `id` means the extra type passes never churn singles'
   * last_synced_at.
   */

  import { getSupabaseAdmin } from './supabase-admin';
  import { getShopifyAccessToken, fetchAllShopifyProducts } from './shopify';
  import { DECK_PRODUCT_TYPES } from '@/lib/ytg/constants';

  const SYNCED_PRODUCT_TYPES: string[] = ['Single', ...DECK_PRODUCT_TYPES];

  export async function syncShopifyProducts(): Promise<{ upserted: number; errors: number }> {
    const token = await getShopifyAccessToken();
    const supabase = getSupabaseAdmin();

    let upserted = 0;
    let errors = 0;

    for (const productType of SYNCED_PRODUCT_TYPES) {
      const products = await fetchAllShopifyProducts(token, productType);

      const rows = products.map(p => {
        const price = Math.min(...p.variants.map(v => parseFloat(v.price)));
        const inventory = p.variants.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0);
        return {
          id: String(p.id),
          title: p.title,
          handle: p.handle,
          tags: p.tags || null,
          product_type: p.product_type,
          price,
          inventory_quantity: inventory,
          sku: p.variants[0]?.sku ?? null,
          body_html: p.body_html ?? null,
          raw_json: p,
          last_synced_at: new Date().toISOString(),
        };
      });

      const batchSize = 500;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const { error } = await supabase
          .from('shopify_products')
          .upsert(batch, { onConflict: 'id' });
        if (error) {
          // Log and continue — a partial failure must not abort the run.
          // (This is why the health strip reads MIN(last_synced_at), not MAX.)
          console.error(`Sync batch error (${productType}):`, error.message);
          errors += batch.length;
        } else {
          upserted += batch.length;
        }
      }
    }

    return { upserted, errors };
  }
  ```
- [ ] Replace the entire content of `app/api/admin/sync-shopify/route.ts` with (auth block copied verbatim from `app/api/admin/import-set/route.ts`'s shape; the inline sync body is gone):
  ```ts
  import { NextResponse } from 'next/server';
  import { hasPermission } from '@/utils/adminUtils';
  import { syncShopifyProducts } from '@/lib/pricing/syncShopifyProducts';

  // The multi-type sync (singles + three deck types) is several paginated
  // REST passes with rate-limit pauses — give it the same budget as the cron.
  export const maxDuration = 300;

  export async function POST() {
    if (!(await hasPermission('manage_shopify_imports'))) {
      return NextResponse.json({ error: 'Shopify import permission required' }, { status: 403 });
    }
    try {
      const { upserted, errors } = await syncShopifyProducts();
      return NextResponse.json({ synced: upserted, errors });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
  ```
  (Response field `synced` is kept; the old `total` field is dropped — verified no caller reads this route anywhere in the repo.)
- [ ] In `app/api/cron/sync-prices/route.ts`, collapse the inline sync (keep the `CRON_SECRET` check untouched). Replace the import block (lines 1–4) with:
  ```ts
  import { NextRequest, NextResponse } from 'next/server';
  import { syncShopifyProducts } from '@/lib/pricing/syncShopifyProducts';
  import { runMatchingPipeline, regenerateCardPrices, computeCheapestPrices } from '@/lib/pricing/matching';
  import { sendCronAlert } from '@/lib/cron/alerts';
  ```
  Replace the sync section (current lines 17–44, from `// 1. Sync Shopify products` through `console.log(\`[cron] Synced ...\`)`) with:
  ```ts
      // 1. Sync Shopify products (singles + deck types; sku/body_html mirrored)
      console.log('[cron] Syncing Shopify products...');
      const { upserted, errors: syncErrors } = await syncShopifyProducts();
      console.log(`[cron] Synced ${upserted} Shopify products (${syncErrors} upsert errors)`);
  ```
  And change the success response (current line 60) to:
  ```ts
      return NextResponse.json({ success: true, shopify_synced: upserted, matching: summary });
  ```
  Steps 2–4 of the cron (matching pipeline, regenerate, cheapest prices) and the catch block stay byte-for-byte unchanged.
- [ ] Verify:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell && npx tsc --noEmit && npm test
  ```
- [ ] Commit:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell
  git add lib/pricing/shopify.ts lib/pricing/syncShopifyProducts.ts app/api/admin/sync-shopify/route.ts app/api/cron/sync-prices/route.ts
  git commit -m "$(cat <<'EOF'
  Extend Shopify sync to deck types + sku/body_html; collapse duplicated sync bodies

  syncShopifyProducts() now fetches ['Single', ...DECK_PRODUCT_TYPES] (one
  REST pass per type), mirrors variants[0].sku and body_html (migration 088
  columns), and returns { upserted, errors }. The admin route (now gated by
  manage_shopify_imports) and the nightly cron delegate to it instead of
  inlining their own copies.

  NOTE: requires migration 088 applied before deploy — every upsert batch
  errors until the columns exist.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: Auth on the four remaining naked routes

**Files:**
- Modify: `app/api/admin/run-matching/route.ts` (12 lines — imports line 1–2, gate at top of `POST`)
- Modify: `app/api/admin/review-queue/route.ts` (28 lines — imports line 1–2, gate at top of `GET`)
- Modify: `app/api/admin/approve-mapping/route.ts` (40 lines — imports line 1–3, gate at top of `POST`)
- Modify: `app/api/admin/reject-mapping/route.ts` (31 lines — imports line 1–2, gate at top of `POST`)

**Interfaces:**
- Consumes: `hasPermission(permission: string): Promise<boolean>` from `utils/adminUtils.ts:33`. The 403 block is copied exactly from `app/api/admin/import-set/route.ts:12-14`. Verified before this plan was written: nothing in `app/`, `lib/`, `components/`, `scripts/`, `Makefile`, `package.json`, or `vercel.json` calls these four routes — the WS-2 UI will be their first caller.

- [ ] Replace the entire content of `app/api/admin/run-matching/route.ts` with:
  ```ts
  import { NextResponse } from 'next/server';
  import { hasPermission } from '@/utils/adminUtils';
  import { runMatchingPipeline } from '@/lib/pricing/matching';

  export async function POST() {
    if (!(await hasPermission('manage_shopify_imports'))) {
      return NextResponse.json({ error: 'Shopify import permission required' }, { status: 403 });
    }
    try {
      const summary = await runMatchingPipeline();
      return NextResponse.json(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
  ```
- [ ] Replace the entire content of `app/api/admin/review-queue/route.ts` with:
  ```ts
  import { NextResponse } from 'next/server';
  import { hasPermission } from '@/utils/adminUtils';
  import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';

  export async function GET() {
    if (!(await hasPermission('manage_shopify_imports'))) {
      return NextResponse.json({ error: 'Shopify import permission required' }, { status: 403 });
    }
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('card_price_mappings')
      .select(`
        *,
        shopify_products (
          id,
          title,
          handle,
          tags,
          price,
          inventory_quantity
        )
      `)
      .eq('status', 'needs_review')
      .order('updated_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [] });
  }
  ```
- [ ] Replace the entire content of `app/api/admin/approve-mapping/route.ts` with:
  ```ts
  import { NextRequest, NextResponse } from 'next/server';
  import { hasPermission } from '@/utils/adminUtils';
  import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
  import { regenerateCardPrices } from '@/lib/pricing/matching';

  export async function POST(request: NextRequest) {
    if (!(await hasPermission('manage_shopify_imports'))) {
      return NextResponse.json({ error: 'Shopify import permission required' }, { status: 403 });
    }
    try {
      const { card_key, shopify_product_id } = await request.json();
      if (!card_key || !shopify_product_id) {
        return NextResponse.json(
          { error: 'card_key and shopify_product_id are required' },
          { status: 400 }
        );
      }

      const supabase = getSupabaseAdmin();

      const { error } = await supabase
        .from('card_price_mappings')
        .update({
          shopify_product_id,
          status: 'manual',
          reviewed_by: 'admin',
          match_method: 'manual',
          updated_at: new Date().toISOString(),
        })
        .eq('card_key', card_key);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // Regenerate the card_prices table
      await regenerateCardPrices();

      return NextResponse.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
  ```
- [ ] Replace the entire content of `app/api/admin/reject-mapping/route.ts` with:
  ```ts
  import { NextRequest, NextResponse } from 'next/server';
  import { hasPermission } from '@/utils/adminUtils';
  import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';

  export async function POST(request: NextRequest) {
    if (!(await hasPermission('manage_shopify_imports'))) {
      return NextResponse.json({ error: 'Shopify import permission required' }, { status: 403 });
    }
    try {
      const { card_key } = await request.json();
      if (!card_key) {
        return NextResponse.json({ error: 'card_key is required' }, { status: 400 });
      }

      const supabase = getSupabaseAdmin();

      const { error } = await supabase
        .from('card_price_mappings')
        .update({
          shopify_product_id: null,
          status: 'unmatched',
          updated_at: new Date().toISOString(),
        })
        .eq('card_key', card_key);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
  ```
- [ ] Verify: `cd /Users/timestes/projects/rtt-ytg-shell && npx tsc --noEmit` (curl 403 checks happen in Task 10 with the dev server up).
- [ ] Commit:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell
  git add app/api/admin/run-matching/route.ts app/api/admin/review-queue/route.ts app/api/admin/approve-mapping/route.ts app/api/admin/reject-mapping/route.ts
  git commit -m "$(cat <<'EOF'
  Gate run-matching, review-queue, approve-mapping, reject-mapping behind manage_shopify_imports

  These four service-role routes (plus sync-shopify, gated in the previous
  commit) were publicly callable. Same 403 shape as the import-set route.
  Verified no existing caller anywhere in the repo — WS-2's UI will be the
  first.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: `/admin/ytg` shell — layout gate, index redirect, tabs, health strip

**Files:**
- Create: `app/admin/ytg/layout.tsx`
- Create: `app/admin/ytg/page.tsx`
- Create: `app/admin/ytg/components/YtgTabs.tsx`
- Create: `app/admin/ytg/components/HealthStrip.tsx`

**Interfaces:**
- Consumes: `hasPermission(permission: string): Promise<boolean>` (`utils/adminUtils.ts:33` — plain async server helper reading Supabase auth; layout-safe, no special mock/dev handling needed); `getSupabaseAdmin(): any` (`lib/pricing/supabase-admin.ts:13`); `TopNav` default export (`components/top-nav.tsx`).
- Produces: the shell contract from overview §Shell. **After WS-0 merges, no workstream may edit `layout.tsx` or `YtgTabs.tsx`.**

- [ ] Create `app/admin/ytg/layout.tsx`:
  ```tsx
  import { notFound } from "next/navigation";
  import TopNav from "@/components/top-nav";
  import { hasPermission } from "@/utils/adminUtils";
  import HealthStrip from "./components/HealthStrip";
  import YtgTabs from "./components/YtgTabs";

  export const metadata = { title: "YTG Store" };
  export const dynamic = "force-dynamic";

  // Shared shell for every /admin/ytg tab. Per the WS plan set: WS-1/2/3 own
  // ONLY their tab directory — this file, YtgTabs, and HealthStrip belong to
  // WS-0 and are not edited by other workstreams. Layout gating does NOT
  // protect server actions or API routes: every action/route re-checks
  // hasPermission itself.
  export default async function YtgLayout({
    children,
  }: {
    children: React.ReactNode;
  }) {
    // Server gate, /admin/permissions precedent: 404 (not 403) keeps the
    // area invisible to anyone without manage_shopify_imports.
    if (!(await hasPermission("manage_shopify_imports"))) notFound();

    return (
      <div className="flex flex-col min-h-screen">
        <TopNav />
        <div className="flex-1 w-full overflow-auto px-5">
          <div className="max-w-7xl mx-auto py-8">
            <h1 className="text-3xl font-bold mb-1">YTG Store</h1>
            <p className="text-muted-foreground mb-4">
              Import, reconcile, and manage the Your Turn Games Shopify store.
            </p>
            <HealthStrip />
            <YtgTabs />
            {children}
          </div>
        </div>
      </div>
    );
  }
  ```
- [ ] Create `app/admin/ytg/page.tsx`:
  ```tsx
  import { redirect } from "next/navigation";

  export default function YtgIndexPage() {
    redirect("/admin/ytg/import");
  }
  ```
- [ ] Create `app/admin/ytg/components/YtgTabs.tsx`:
  ```tsx
  "use client";

  import Link from "next/link";
  import { usePathname } from "next/navigation";

  const TABS = [
    { label: "Import Sets", href: "/admin/ytg/import" },
    { label: "Products", href: "/admin/ytg/products" },
    { label: "Matching", href: "/admin/ytg/matching" },
    { label: "Decks", href: "/admin/ytg/decks" },
  ];

  export default function YtgTabs() {
    const pathname = usePathname();

    return (
      <nav aria-label="YTG Store sections" className="flex gap-1 mb-6 overflow-x-auto rounded-md bg-card p-1">
        {TABS.map((tab) => {
          const active = pathname?.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                active
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    );
  }
  ```
- [ ] Create `app/admin/ytg/components/HealthStrip.tsx`. Status values verified against `lib/pricing/matching.ts:943` (confirmed = `['auto_matched','manual']`) and migration `011_create_price_tables.sql` — do NOT use a literal `'matched'`:
  ```tsx
  import Link from "next/link";
  import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";

  // Freshness uses MIN(last_synced_at), not MAX: syncShopifyProducts logs
  // batch errors and continues, so after a partial failure MAX lies while
  // MIN shows the oldest un-refreshed row.
  function timeAgo(iso: string | null): string {
    if (!iso) return "never";
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  export default async function HealthStrip() {
    const supabase = getSupabaseAdmin();

    const [freshness, productCount, totalMappings, confirmedMappings, needsReview, unmatched] =
      await Promise.all([
        supabase
          .from("shopify_products")
          .select("last_synced_at")
          .not("last_synced_at", "is", null)
          .order("last_synced_at", { ascending: true })
          .limit(1),
        supabase.from("shopify_products").select("*", { count: "exact", head: true }),
        supabase.from("card_price_mappings").select("*", { count: "exact", head: true }),
        supabase
          .from("card_price_mappings")
          .select("*", { count: "exact", head: true })
          .in("status", ["auto_matched", "manual"]),
        supabase
          .from("card_price_mappings")
          .select("*", { count: "exact", head: true })
          .eq("status", "needs_review"),
        supabase
          .from("card_price_mappings")
          .select("*", { count: "exact", head: true })
          .eq("status", "unmatched"),
      ]);

    const oldestSync: string | null = freshness.data?.[0]?.last_synced_at ?? null;
    const total = totalMappings.count ?? 0;
    const confirmed = confirmedMappings.count ?? 0;
    const matchedPct = total > 0 ? Math.round((confirmed / total) * 1000) / 10 : 0;

    // Each stat links to the tab that acts on it.
    const stats = [
      { label: "Synced", value: timeAgo(oldestSync), href: "/admin/ytg/matching" },
      { label: "Products", value: (productCount.count ?? 0).toLocaleString(), href: "/admin/ytg/products" },
      { label: "Matched", value: `${matchedPct}%`, href: "/admin/ytg/matching" },
      { label: "Needs review", value: (needsReview.count ?? 0).toLocaleString(), href: "/admin/ytg/matching" },
      { label: "Unmatched", value: (unmatched.count ?? 0).toLocaleString(), href: "/admin/ytg/matching" },
    ];

    return (
      <div className="flex flex-wrap gap-2 mb-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-md bg-card px-3 py-1.5 transition-colors hover:bg-muted"
          >
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
              {s.label}
            </span>
            <span className="text-sm font-semibold">{s.value}</span>
          </Link>
        ))}
      </div>
    );
  }
  ```
- [ ] Verify: `cd /Users/timestes/projects/rtt-ytg-shell && npx tsc --noEmit` (tab targets 404 until Tasks 7–8; full manual sweep is Task 10).
- [ ] Commit:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell
  git add app/admin/ytg/layout.tsx app/admin/ytg/page.tsx app/admin/ytg/components/YtgTabs.tsx app/admin/ytg/components/HealthStrip.tsx
  git commit -m "$(cat <<'EOF'
  Add /admin/ytg shell: server-gated layout, health strip, tab nav, index redirect

  Layout gates the whole area with hasPermission('manage_shopify_imports')
  -> notFound() (server-side, /admin/permissions precedent). Health strip is
  server-rendered: MIN(last_synced_at) freshness, mirror count, confirmed
  match % (auto_matched+manual), needs_review and unmatched counts, each
  linking to its tab. Tabs are route segments so WS-1/2/3 own one directory
  apiece.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 7: Skeleton pages for Products, Matching, Decks

**Files:**
- Create: `app/admin/ytg/products/page.tsx`
- Create: `app/admin/ytg/matching/page.tsx`
- Create: `app/admin/ytg/decks/page.tsx`

**Interfaces:**
- Produces: three standalone empty-state pages. WS-1 replaces `products/page.tsx`, WS-2 replaces `matching/page.tsx`, WS-3 replaces `decks/page.tsx` — each workstream touches only its own file, which is the entire reason these exist.

- [ ] Create `app/admin/ytg/products/page.tsx`:
  ```tsx
  export const metadata = { title: "YTG Store — Products" };

  // WS-0 skeleton. WS-1 (tag sync) replaces this file wholesale — nothing
  // else in the shell needs to change when it does.
  export default function ProductsPage() {
    return (
      <div className="rounded-lg bg-card px-6 py-16 text-center">
        <h2 className="text-lg font-semibold mb-1">Products</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Bulk tag sync is coming soon. Card data will be diffed against live
          store tags, with additions and per-tag removal opt-ins applied in
          batches.
        </p>
      </div>
    );
  }
  ```
- [ ] Create `app/admin/ytg/matching/page.tsx`:
  ```tsx
  export const metadata = { title: "YTG Store — Matching" };

  // WS-0 skeleton. WS-2 (deterministic matching + review queue) replaces
  // this file wholesale — nothing else in the shell needs to change.
  export default function MatchingPage() {
    return (
      <div className="rounded-lg bg-card px-6 py-16 text-center">
        <h2 className="text-lg font-semibold mb-1">Matching</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          The matching dashboard and keyboard-driven review queue are coming
          soon. Cards will match to store products by SKU first, with fuzzy
          passes as fallback.
        </p>
      </div>
    );
  }
  ```
- [ ] Create `app/admin/ytg/decks/page.tsx`:
  ```tsx
  export const metadata = { title: "YTG Store — Decks" };

  // WS-0 skeleton. WS-3 (deck products + pull-contents wizard) replaces
  // this file wholesale — nothing else in the shell needs to change.
  export default function DecksPage() {
    return (
      <div className="rounded-lg bg-card px-6 py-16 text-center">
        <h2 className="text-lg font-semibold mb-1">Decks</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Deck product tooling is coming soon. Preconstructed deck contents
          will link to real decklists, with per-card inventory decrements on
          sale.
        </p>
      </div>
    );
  }
  ```
- [ ] Verify: `cd /Users/timestes/projects/rtt-ytg-shell && npx tsc --noEmit`
- [ ] Commit:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell
  git add app/admin/ytg/products/page.tsx app/admin/ytg/matching/page.tsx app/admin/ytg/decks/page.tsx
  git commit -m "$(cat <<'EOF'
  Add skeleton pages for Products, Matching, Decks tabs

  Empty-state placeholders so WS-1/2/3 each replace exactly one file in
  their own directory and never touch a shared shell file.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 8: Move the importer under the shell; legacy route becomes a server redirect

**Files:**
- Move: `app/admin/import-set/page.tsx` → `app/admin/ytg/import/page.tsx` (via `git mv`, then the exact edits below — line numbers refer to the file as it exists today)
- Create: `app/admin/import-set/page.tsx` (new 7-line redirect file)

**Interfaces:**
- Consumes: the shell gate from Task 6 (which is WHY the client gate can go); `/api/admin/import-set` route stays where it is, untouched.
- Produces: `/admin/ytg/import` (working importer) and `/admin/import-set` → server `redirect('/admin/ytg/import')` for bookmarks.

**WARNING — minimal diff only.** This is a 687-line working page. Apply ONLY edits A–E below. Do not reformat, do not extract components, do not rename state, do not touch the table/modal/dry-run logic, do not "improve" anything. The whole point of `git mv` + surgical edits is a reviewable diff.

- [ ] Move the file preserving history:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell
  git mv app/admin/import-set/page.tsx app/admin/ytg/import/page.tsx
  ```
- [ ] **Edit A — imports (lines 1–9).** Remove the `useRouter`, `TopNav`, and `useIsAdmin` imports. Before:
  ```tsx
  "use client";

  import { useEffect, useMemo, useRef, useState } from "react";
  import { useRouter } from "next/navigation";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import TopNav from "@/components/top-nav";
  import { useIsAdmin } from "@/hooks/useIsAdmin";
  ```
  After:
  ```tsx
  "use client";

  import { useEffect, useMemo, useRef, useState } from "react";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  ```
- [ ] **Edit B — component head (lines 118–121).** Remove the router/permission hooks (the shell layout now gates server-side). Before:
  ```tsx
  export default function AdminImportSetPage() {
    const router = useRouter();
    const { isAdmin, permissions, loading: adminLoading } = useIsAdmin();
    const canImport = isAdmin && permissions.includes("manage_shopify_imports");
  ```
  After:
  ```tsx
  export default function AdminImportSetPage() {
  ```
- [ ] **Edit C — client redirect gate + loadSets gate (lines 146–168).** Delete the redirect effect entirely and un-gate the sets loader. Before:
  ```tsx
    useEffect(() => {
      if (!adminLoading && !canImport) {
        router.replace("/");
      }
    }, [adminLoading, canImport, router]);

    useEffect(() => {
      if (!canImport) return;
      const loadSets = async () => {
  ```
  After:
  ```tsx
    useEffect(() => {
      const loadSets = async () => {
  ```
  And the loader effect's closing line (currently line 168) changes from:
  ```tsx
    }, [canImport]);
  ```
  to:
  ```tsx
    }, []);
  ```
- [ ] **Edit D — render guard + chrome (lines 385–393).** Remove the loading guard, the `<TopNav/>`, and neutralize the three chrome wrappers (the shell layout now provides `min-h-screen`, `px-5`, `max-w-7xl mx-auto py-8`); keep all three `<div>`s so the closing tags at lines 647–648/685 stay balanced. Demote the page `h1` (the shell owns the page-level `h1`). Before:
  ```tsx
    if (adminLoading || !canImport) return null;

    return (
      <div className="flex flex-col min-h-screen">
        <TopNav />

        <div className="flex-1 w-full overflow-auto px-5">
          <div className="max-w-7xl mx-auto py-8">
            <h1 className="text-3xl font-bold mb-2">Import Set to Shopify</h1>
  ```
  After:
  ```tsx
    return (
      <div>
        <div>
          <div>
            <h2 className="text-xl font-semibold mb-2">Import Set to Shopify</h2>
  ```
- [ ] **Edit E — nothing else.** Every other line of the file (the closing `</div>`s included) stays exactly as moved.
- [ ] Create the new `app/admin/import-set/page.tsx`:
  ```tsx
  import { redirect } from "next/navigation";

  // The importer moved into the YTG Store shell (/admin/ytg/import). This
  // server redirect covers old bookmarks; top-nav links /admin/ytg directly.
  export default function LegacyImportSetPage() {
    redirect("/admin/ytg/import");
  }
  ```
- [ ] Verify: `cd /Users/timestes/projects/rtt-ytg-shell && npx tsc --noEmit` — this catches any leftover reference to `router`, `canImport`, `adminLoading`, or `TopNav` if an edit was missed.
- [ ] Commit:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell
  git add app/admin/ytg/import/page.tsx app/admin/import-set/page.tsx
  git commit -m "$(cat <<'EOF'
  Move set importer to /admin/ytg/import; /admin/import-set becomes a redirect

  git mv with a minimal diff: drop the page's own <TopNav/> and client-side
  permission redirect (the ytg layout now gates server-side), neutralize the
  chrome wrappers the shell provides, demote its h1. All importer logic is
  untouched; the /api/admin/import-set route stays where it is.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 9: Rename top-nav entries to "YTG Store" → `/admin/ytg`

**Files:**
- Modify: `components/top-nav.tsx` — desktop entry lines 306–315 and mobile entry lines 740–749. **Touch only these two blocks; nothing else in this 1,026-line file.**

**Interfaces:** none (pure link/label change; the `permissions.includes('manage_shopify_imports')` guards stay as-is).

- [ ] **Desktop block (lines 306–315).** Before:
  ```tsx
                        {permissions.includes('manage_shopify_imports') && (
                          <Link
                            href="/admin/import-set"
                            onClick={() => setIsAdminOpen(false)}
                            className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                          >
                            <HiShoppingCart className="w-4 h-4" />
                            YTG Imports
                          </Link>
                        )}
  ```
  After (only `href` and label change):
  ```tsx
                        {permissions.includes('manage_shopify_imports') && (
                          <Link
                            href="/admin/ytg"
                            onClick={() => setIsAdminOpen(false)}
                            className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                          >
                            <HiShoppingCart className="w-4 h-4" />
                            YTG Store
                          </Link>
                        )}
  ```
- [ ] **Mobile block (lines 740–749).** Before:
  ```tsx
                      {permissions.includes('manage_shopify_imports') && (
                        <Link
                          href="/admin/import-set"
                          onClick={closeMobileMenu}
                          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                        >
                          <HiShoppingCart className="w-4 h-4" />
                          YTG Imports
                        </Link>
                      )}
  ```
  After:
  ```tsx
                      {permissions.includes('manage_shopify_imports') && (
                        <Link
                          href="/admin/ytg"
                          onClick={closeMobileMenu}
                          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                        >
                          <HiShoppingCart className="w-4 h-4" />
                          YTG Store
                        </Link>
                      )}
  ```
- [ ] Confirm no other reference to the old route remains outside the redirect file:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell && grep -rn "admin/import-set" app components lib --include="*.ts" --include="*.tsx" | grep -v "api/admin/import-set"
  ```
  Expected: only `app/admin/import-set/page.tsx` (the redirect) and `app/admin/ytg/import/page.tsx`'s fetches of `/api/admin/import-set` (the API route, which stays).
- [ ] Verify: `cd /Users/timestes/projects/rtt-ytg-shell && npx tsc --noEmit`
- [ ] Commit:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell
  git add components/top-nav.tsx
  git commit -m "$(cat <<'EOF'
  Rename top-nav "YTG Imports" to "YTG Store" pointing at /admin/ytg

  Desktop + mobile admin dropdown entries only. Old /admin/import-set
  bookmarks are covered by the server redirect.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 10: Full verification sweep (types, tests, dev server)

**Files:** none (verification only; fix-up commits allowed if something fails)

**Interfaces:** none

- [ ] Type + unit gates:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell && npx tsc --noEmit
  cd /Users/timestes/projects/rtt-ytg-shell && npm test
  ```
- [ ] Start the dev server in the worktree (do NOT run `next build` while it runs):
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell && npm run dev
  ```
- [ ] **Unauthenticated API gate checks** (no session cookie → `hasPermission` false → 403 on all five):
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/admin/sync-shopify      # expect 403
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/admin/run-matching      # expect 403
  curl -s -o /dev/null -w "%{http_code}\n"        http://localhost:3000/api/admin/review-queue       # expect 403
  curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' http://localhost:3000/api/admin/approve-mapping  # expect 403
  curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' http://localhost:3000/api/admin/reject-mapping   # expect 403
  ```
  All five must print `403` (not `200`, and not `500`).
- [ ] **Gate check, signed out:** open `http://localhost:3000/admin/ytg` in a private/incognito window (no session). Expected: the app's 404 page — not a redirect, not the shell. Same for `http://localhost:3000/admin/ytg/import`.
- [ ] **Shell checks, signed in** as a user holding `manage_shopify_imports` (use the project `verify` skill's session-minting flow if a browser session isn't at hand):
  - `http://localhost:3000/admin/ytg` → lands on `/admin/ytg/import`.
  - `/admin/ytg/import` → exactly ONE TopNav; "YTG Store" h1; five health-strip stats with plausible values (Synced shows a relative time or "never"; Products ≈ mirror count; Matched a %; Needs review / Unmatched integers); four tabs with **Import Sets** highlighted; the importer's set picker below loads sets and a chosen set renders its plan table (proves the API + un-gated `loadSets` effect still work).
  - `/admin/ytg/products` → "Products / Bulk tag sync is coming soon…" card, **Products** tab active.
  - `/admin/ytg/matching` → matching skeleton, **Matching** tab active.
  - `/admin/ytg/decks` → decks skeleton, **Decks** tab active.
  - `http://localhost:3000/admin/import-set` → redirects to `/admin/ytg/import`.
  - Top-nav Admin dropdown (desktop width AND a narrow/mobile viewport) shows **YTG Store** linking to `/admin/ytg`; no "YTG Imports" entry remains.
- [ ] Do NOT click "Import" against the real store during verification; "Dry run" is safe. Do not trigger `/api/admin/sync-shopify` with a permissioned session yet — migration 088 is not applied, so the new upsert columns would error every batch (expected pre-migration behavior, but noise).
- [ ] Stop the dev server.

---

### Task 11: Push branch and open the PR

**Files:** none

**Interfaces:** PR bases `origin/main` per the overview; WS-1/2/3 dispatch only after this merges and the primary session applies migration 088.

- [ ] Confirm a clean tree and the expected commit list:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell && git status && git log --oneline origin/main..HEAD
  ```
  Expected: 8 commits (Tasks 2–9), nothing unstaged.
- [ ] Push:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell && git push -u origin feat/ytg-store-shell
  ```
- [ ] Open the PR:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-shell
  gh pr create --base main --title "YTG Store WS-0: /admin/ytg shell, route auth, sync sku/body_html, shared contracts" --body "$(cat <<'EOF'
  ## Summary

  Foundation workstream (WS-0) of the YTG Store admin plan set
  (`docs/superpowers/plans/2026-08-03-ytg-store/00-overview.md`; spec
  `docs/superpowers/specs/2026-08-03-ytg-store-admin-design.md`).

  - **`/admin/ytg` shell**: server-gated `layout.tsx`
    (`hasPermission('manage_shopify_imports')` else `notFound()`,
    force-dynamic) rendering TopNav + header + server HealthStrip
    (MIN(last_synced_at) freshness, mirror count, confirmed-match %
    over `auto_matched`+`manual`, needs_review, unmatched — each linking
    to its tab) + client tab nav. Index redirects to `./import`.
  - **Importer moved** to `/admin/ytg/import` via `git mv` with a minimal
    diff (dropped its own TopNav + client-side redirect gate; shell gates
    server-side). `/admin/import-set` is now a server redirect; top-nav
    entries (desktop + mobile) renamed to "YTG Store" → `/admin/ytg`.
  - **Skeleton pages** for Products / Matching / Decks so WS-1/2/3 each
    replace exactly one file.
  - **Route auth**: `manage_shopify_imports` 403 gate (import-set route's
    shape) added to the five previously-public service-role routes:
    sync-shopify, run-matching, review-queue, approve-mapping,
    reject-mapping. Verified no existing callers. Cron keeps CRON_SECRET.
  - **Sync extension**: `syncShopifyProducts()` now fetches
    `['Single', ...DECK_PRODUCT_TYPES]` (one REST pass per type), mirrors
    `sku` (`variants[0].sku ?? null`) + `body_html`, returns
    `{ upserted, errors }`; the admin route and nightly cron now delegate
    to it (duplicated inline bodies removed).
  - **Shared contracts shipped**: migration 088 (sku/body_html + partial
    sku index — file only, NOT applied), `lib/ytg/constants.ts`
    (`DECK_PRODUCT_TYPES`), `lib/shopify/aliasBatch.ts`
    (`runAliasedMutations` with vitest coverage: chunking at batchSize,
    per-alias userErrors mapping, rejected-chunk synthetic errors).

  ## Merge-time requirement

  **Apply `supabase/migrations/088_shopify_products_sku_body_html.sql` via
  Supabase MCP (primary session) before or immediately with this deploy.**
  The sync upsert now writes `sku`/`body_html`; until the columns exist,
  every sync batch fails (logged + counted, non-fatal, but the mirror
  stops refreshing). Backfill is automatic on the first sync after that.

  ## Verification

  - `npx tsc --noEmit` clean; `npm test` green (includes new aliasBatch suite)
  - All five gated routes return 403 unauthenticated (curl)
  - Signed-out `/admin/ytg` → 404; signed-in: index → import tab, importer
    dry-run works inside the shell, skeletons render, health strip values
    sane, `/admin/import-set` redirects, top-nav renamed in both layouts

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```
- [ ] Report the PR URL. Leave the worktree in place until the PR merges (WS-1/2/3 use their own worktrees off `origin/main` afterward).

---

### Critical Files for Implementation

- /Users/timestes/projects/redemption-tournament-tracker/docs/superpowers/plans/2026-08-03-ytg-store/00-overview.md
- /Users/timestes/projects/redemption-tournament-tracker/app/admin/import-set/page.tsx
- /Users/timestes/projects/redemption-tournament-tracker/lib/pricing/syncShopifyProducts.ts
- /Users/timestes/projects/redemption-tournament-tracker/lib/shopify/admin-write.ts
- /Users/timestes/projects/redemption-tournament-tracker/utils/adminUtils.ts
