# YTG Store Admin — Plan Set Overview & Shared Contracts

> **For agentic workers:** This is the umbrella for five workstream plans. Each workstream is executed by its own agent in its own git worktree and lands as its own PR. Execute a workstream with superpowers:executing-plans against its plan file. **Read this file first — it defines the contracts your plan refers to.**

**Spec:** `docs/superpowers/specs/2026-08-03-ytg-store-admin-design.md` (rev 2 — read it in full before your workstream; it is the authority on behavior)

**Goal:** One permission-gated `/admin/ytg` area (Import Sets · Products · Matching · Decks) with deterministic card↔product matching, bulk tag sync, deck-product decklists, and crash-safe deck-sale inventory decrements.

**Tech stack:** Next.js 15 App Router, React 19, TS, Supabase (service-role via `lib/pricing/supabase-admin`), Shopify GraphQL Admin 2026-07 (`lib/shopify/admin-write.ts`) + REST 2024-01 (`lib/pricing/shopify.ts`), Tailwind + shadcn/ui, vitest.

## Plan files

| Plan | Branch | PR gate |
|------|--------|---------|
| `ws0-foundation.md` | `feat/ytg-store-shell` | merges before WS-1/2/3 start |
| `ws1-tag-sync.md` | `feat/ytg-tag-sync` | after WS-0 |
| `ws2-matching.md` | `feat/ytg-matching` | after WS-0 |
| `ws3-deck-wizard.md` | `feat/ytg-deck-wizard` | after WS-0 |
| `ws4-record-sale.md` | continues WS-3's lane, `feat/ytg-record-sale` | after WS-3 merges |

## Global constraints (every task inherits these)

- **Worktrees:** create your own: `git fetch origin && git worktree add ../rtt-<ws-name> -b <branch> origin/main`, do ALL work inside it with absolute paths, never touch the main checkout, `git add` only your specific files, PR bases `origin/main`. (CLAUDE.md rules.)
- **Permission key:** `manage_shopify_imports` — the only gate for all of `/admin/ytg` and its APIs. Do not create new permissions.
- **Mock/dry-run:** `SHOPIFY_WRITE_MOCK=1` short-circuits GraphQL writes (existing behavior in `admin-write.ts`); `YTG_INVENTORY_WRITES` unset ⇒ WS-4 runs dry-run. Never remove these paths.
- **Shopify API versions:** GraphQL writes pinned `2026-07`; REST reads pinned `2024-01`. Do not bump either.
- **2026-04 breaking changes are law for inventory mutations:** `@idempotent(key:)` directive mandatory; `changeFromQuantity` required on every `InventoryChangeInput`.
- **productSet invariants (do not regress, from PR #241/#281):** on updates omit `files` when `media_attached`; omit `variants`+`productOptions` when price blank; never set `media_attached=true` on error paths.
- **Tests:** vitest (`npm test` = `vitest run`). Type gate: `npx tsc --noEmit`. Never `next build` while dev server runs (use `NEXT_DIST_DIR=.next-build` if a build is truly needed). tsconfig has `strict:false` — union narrowing via `if (x.ok)` misbehaves; use explicit `=== false` comparisons.
- **Migrations:** numeric prefix, `supabase/migrations/`. **088 belongs to WS-0, 089 to WS-3.** Apply to prod via Supabase MCP only from the primary session, never from a workstream agent — workstream PRs include the SQL file only.
- **Design:** `prompt_context/design_system.md`; data-dense, mobile-first, no focus rings (`focus:ring-2` banned per user), green accent reserved for hover/active/CTAs.

## Shared contracts (cross-workstream interfaces — exact shapes)

### Migration 088 (WS-0 authors)
```sql
ALTER TABLE shopify_products ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE shopify_products ADD COLUMN IF NOT EXISTS body_html TEXT;
CREATE INDEX IF NOT EXISTS idx_shopify_products_sku ON shopify_products(sku) WHERE sku IS NOT NULL;
```

### Migration 089 (WS-3 authors; WS-4 consumes) — verbatim from spec §Record sale
`ytg_deck_links` (PK `shopify_product_id`, `deck_id UUID UNIQUE NOT NULL REFERENCES decks(id) ON DELETE RESTRICT`, `handle`, `product_title`, `created_by`, `created_at`), `ytg_deck_sales`, `ytg_deck_sale_items` with the exact status enums and `qty_before`/`qty_after` columns in the spec, partial unique index `ON ytg_deck_sales(shopify_product_id) WHERE status IN ('pending','applying')`. RLS enabled, no policies, `REVOKE ALL FROM anon, authenticated`.

### Constants
- `lib/ytg/constants.ts` (WS-3 creates):
  ```ts
  // yourturngamesin@gmail.com — Andy Fish's account; decks the store tooling creates live here
  export const YTG_ACCOUNT_USER_ID = "81b987d2-f030-4559-aad1-e5cf7405e74a";
  export const DECK_PRODUCT_TYPES = ["Contender Deck", "Challenger Deck", "Champion Deck"] as const;
  ```
  WS-0 needs `DECK_PRODUCT_TYPES` for the sync before WS-3 exists → **WS-0 creates `lib/ytg/constants.ts` with `DECK_PRODUCT_TYPES` only**; WS-3 adds `YTG_ACCOUNT_USER_ID`.

### `lib/shopify/aliasBatch.ts` (WS-0 creates; WS-1 + WS-2 consume)
```ts
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
// Chunks calls ≤batchSize per document (default 40 — 1,000-point doc cost cap at ~10/mutation),
// sends via shopifyGraphQL (THROTTLED retries inherited), maps per-alias userErrors.
// A thrown transport/MAX_COST_EXCEEDED error rejects only that chunk's calls, returned as
// synthetic userErrors — callers always get one AliasedResult per input mutation.
export async function runAliasedMutations(
  calls: AliasedMutation[],
  opts?: { batchSize?: number }
): Promise<AliasedResult[]>;
```

### `lib/shopify/tagRules.ts` (WS-1 creates by extraction from `productFromCard.ts`)
```ts
export const MANAGED_TAGS: ReadonlySet<string>;           // every tag desiredTags can emit
export function desiredTags(card: CardData): string[];    // sorted, deduped
```
`productFromCard.ts` must consume `desiredTags` after extraction (importer and tag sync cannot drift). `CardData` is from `lib/cards/lookup.ts`.

### Shell (WS-0 creates; WS-1/2/3 fill their own directory ONLY)
```
app/admin/ytg/layout.tsx                 server gate: hasPermission('manage_shopify_imports') else notFound(); renders <TopNav/>, header, <HealthStrip/>, <YtgTabs/>
app/admin/ytg/page.tsx                   redirect('/admin/ytg/import')
app/admin/ytg/components/YtgTabs.tsx     client; tabs Import Sets|Products|Matching|Decks via usePathname
app/admin/ytg/components/HealthStrip.tsx server; stats defined in WS-0 plan
app/admin/ytg/import/page.tsx            moved importer
app/admin/ytg/products/page.tsx          WS-0 ships skeleton (empty-state card); WS-1 replaces
app/admin/ytg/matching/page.tsx          WS-0 ships skeleton; WS-2 replaces
app/admin/ytg/decks/page.tsx             WS-0 ships skeleton; WS-3 replaces
```
Skeletons exist so parallel workstreams never touch a shared file. **No workstream edits `layout.tsx`, `YtgTabs.tsx`, or another workstream's directory.** API routes: keep existing `app/api/admin/*` locations; new server logic prefers server actions co-located in the workstream's directory (`actions.ts` with `"use server"`), each action re-checking `hasPermission` (layout gating does not protect actions).

### Sync signature after WS-0
`syncShopifyProducts(): Promise<{ upserted: number; errors: number }>` in `lib/pricing/syncShopifyProducts.ts` fetches product types `['Single', ...DECK_PRODUCT_TYPES]` (one REST pass per type) and upserts `sku` (= `variants[0].sku ?? null`) and `body_html` columns. Route + cron delegate to it (duplicate bodies collapsed).

## Sequencing & external dependency

1. WS-0 lands → primary session applies migration 088 → dispatch WS-1/2/3 in parallel worktrees.
2. WS-3 lands → primary session applies migration 089 → dispatch WS-4.
3. **Immediately (no code dependency):** Tim requests the `write_inventory` app version at dev.shopify.com; Andy approves in his store Admin. WS-4 is fully buildable/testable in dry-run before approval.
