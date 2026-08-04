# YTG Store Admin — Consolidation, Reconciliation, and Deck Inventory

**Date:** 2026-08-03
**Status:** Approved design, pre-implementation
**Builds on:** YTG Shopify set importer (PR #241, #281 — both merged; `docs/superpowers/specs/2026-07-25-ytg-shopify-set-import-design.md`)

## Problem

Three related needs from YTG (Andy Fish, store owner) and Tim:

1. **Consolidation.** The set importer lives at `/admin/import-set` as a one-off page. More YTG store tooling is coming; it needs one home with tabs, not scattered pages. Meanwhile five pricing endpoints under `/api/admin/` (`sync-shopify`, `run-matching`, `review-queue`, `approve-mapping`, `reject-mapping`) hold a service-role client with **no auth**, and the matcher's `needs_review` queue has no UI at all.
2. **Reconciliation.** Card↔product matching relies on fuzzy title passes. Two deterministic signals go unused: the importer already writes SKU `${set}-${imgFile}` + a `custom.rtt_card_key` metafield on new products (matcher never reads them), and product descriptions carry the card's special-ability text (sync throws `body_html` away). A Shopify products export (`tmp/products_export_1.csv`, 4,874 singles, zero SKUs) serves as a validation corpus.
3. **Deck inventory.** YTG sells preconstructed decks (57 Contender, 32 Challenger, 11 Champion products; 9 contenders live). When one sells, Shopify decrements only the deck product — Andy hand-subtracts inventory for each of ~60 singles inside. Deck contents exist only as HTML in live product descriptions (verified: Fiery Furnace and Daniel contender pages list full contents, sectioned by type, `(3)` qty prefixes, YTG set abbreviations).

## Goals

- One permission-gated admin area, `/admin/ytg` ("YTG Store"), tabs: **Import Sets · Products · Matching · Decks**.
- Deterministic-first matching (SKU/metafield pass + one-time backfill), ability-text as a fuzzy disambiguator, and a keyboard-driven review queue UI.
- Bulk tag sync from card data to the store (first concrete use: replacing outdated `Rotation Cards` labels when Limited/Unlimited lands).
- Deck products linked to real, public decklists under the YTG account as source of truth; "Record sale" subtracts per-card inventory with preview, ledger, and undo.
- All Shopify-mutating flows work in dry-run/mock before scopes/approval exist.

## Non-goals

- Shopify order webhooks (auto-decrement on sale) — future increment; the ledger schema doesn't preclude it.
- Full product editor (Shopify admin already does this well). Single-product card-vs-Shopify fixups (description/image/price push) are a later increment on the Products tab, not v1.
- Ghost pruning after store-side deletions (known backlog, unchanged).
- Bumping the REST read path from `2024-01` (known separate task).
- Creating/deleting deck *products* in Shopify.

## Architecture

```
app/admin/ytg/
  layout.tsx        server gate + shell: header, health strip, tab nav
  page.tsx          redirect → ./import
  import/page.tsx   WS-0: moved importer (current /admin/import-set content)
  products/page.tsx WS-1: tag sync
  matching/page.tsx WS-2: dashboard + review queue
  decks/page.tsx    WS-3/4: deck products, contents wizard, sales
```

- **Gate:** `layout.tsx` is a server component: `hasPermission('manage_shopify_imports')` else `notFound()` (the `/admin/permissions` pattern — upgrade over the importer's client-only redirect). All tabs reuse the same permission; no new permission key, no allowlist migration.
- **Tabs are route segments**, not client state: deep-linkable, and each subagent workstream owns its directory with near-zero file overlap.
- **Health strip** in the shell header (server-rendered, one query each): last `shopify_products.last_synced_at` max, mirrored product count, matched % of mapped cards, `needs_review` count, `unmatched` count. Each stat links to the tab that acts on it.
- `/admin/import-set` becomes a redirect to `/admin/ytg/import`. `components/top-nav.tsx` entries (desktop + mobile) rename to "YTG Store" → `/admin/ytg`.

## Foundation (WS-0)

1. **Route auth.** Add `hasPermission('manage_shopify_imports')` → 403 to the five naked routes (same shape as `app/api/admin/import-set/route.ts`). The cron route keeps its `CRON_SECRET` check.
2. **Sync extension** (`lib/pricing/syncShopifyProducts.ts` + the duplicated route/cron bodies — collapse them onto the shared function while touching this):
   - Fetch product types: `Single`, `Contender Deck`, `Challenger Deck`, `Champion Deck` (one paginated fetch per type; REST param takes a single value).
   - Store two new columns on `shopify_products` (migration **088**): `sku TEXT`, `body_html TEXT`. Values come from the REST payload already fetched (variant[0].sku; product.body_html). Backfill on first sync run — no data migration needed.
3. **Matcher guard.** `loadShopifyProducts` in `lib/pricing/matching.ts` filters `product_type = 'Single'` so deck products can never match as singles.
4. **Move the importer** page under the shell, delete its self-rendered `<TopNav />` (shell provides chrome), keep the API route where it is.

## Products tab (WS-1) — tag sync

**Job:** keep Andy's store tags in step with our card data. The tag rules already exist inline in `lib/shopify/productFromCard.ts` (type→`TYPE_TAGS`, brigade→`BRIGADE_TAGS`, official set, Legacy/Ultra rarity, `legality === 'Rotation'` → `Rotation Cards`, promo sets → `Promos`, dual alignment).

**Changes:**
- Extract the tag computation into `lib/shopify/tagRules.ts`: `desiredTags(card): string[]` plus `MANAGED_TAGS` — the set of tags this system owns (type, brigade, set, rarity, legality, `Promos`, `Dual Alignment`). Diffing only ever adds/removes **managed** tags; Andy's hand-added tags (e.g. merchandising collections) are untouchable by construction. When the Limited/Unlimited format restructure lands in card data, the legality rule updates in this one file.
- `productFromCard` consumes `tagRules` so importer and tag-sync can't drift.

**Flow:**
1. Scope picker: whole store or one set → **Compute diff** (server action: join `card_price_mappings` (status `matched`/`manual`) × card data × `shopify_products.tags`; pure read).
2. Diff screen: roll-up summary first ("`− Rotation Cards` on 2,314 · `+ Limited` on 1,876"), then per-product rows with add/remove chips. Filter by tag change; select all / subset. Nothing writes without this screen.
3. Apply: batched GraphQL `tagsAdd`/`tagsRemove` (existing `shopifyGraphQL` client with its throttle handling; ~2 mutations per product, batchable via aliases). Live progress counter; failures collect into a retryable error list. Re-running compute after apply shows a clean diff — that's the verification.

Tag writes are covered by the existing `write_products` scope. `manage_tags`-style dry-run env is unnecessary — the diff screen *is* the safety, plus `SHOPIFY_WRITE_MOCK=1` short-circuits like the importer.

## Matching tab (WS-2) — deterministic-first reconciliation

**Pass 0 — exact identity.** New first pass in `runMatchingPipeline`: match `card_key` to `shopify_products.sku` (SKU format `${set}-${sanitizeImgFile(imgFile)}` = `cardSku()`), `match_method: 'sku'`, confidence 1.0. Skips rows already `manual`/`no_price_exists` (same protection as today's `writeResults`).

**SKU backfill (one-time action, then rarely needed).** For every confirmed mapping (`matched`/`manual`) whose product has no SKU: write `cardSku(card)` to the variant via `productVariantsBulkUpdate` and `custom.rtt_card_key` via `metafieldsSet`. Deliberately **not** `productSet` — avoids its price-zeroing and media list-field invariants entirely. Diff-preview first (count + sample), batched, progress + retryable errors, `write_products` covers it. After one backfill of ~4.8k products, every future sync self-matches through pass 0 and the fuzzy passes only handle genuinely new/odd products.
- Guard: if two card_keys map to the same product (promo fallbacks do this), backfill the **primary** (highest-confidence exact/normalized) mapping only; skip and report the rest.

**Ability-text signal.** `pass3and4Fuzzy` gains a disambiguator: strip `body_html` to text, token-overlap against the card's special ability, and fold into the multi-signal score. Validation: a dev script (`scripts/validate-matching.ts`) runs the pipeline dry-run before/after and reports method/match-rate deltas; `tmp/products_export_1.csv` doubles as an offline spot-check corpus. No threshold changes ship without that report in the PR.

**Review queue UI.** The tab shows:
- Dashboard: counts by `match_method`, needs-review and unmatched totals (the health-strip numbers, expanded).
- Queue: one mapping at a time — card image + card data on the left, proposed product (title, price, tags, ability text from `body_html`) on the right, confidence + method badge. Actions: **Approve** (existing endpoint), **Reject**, **Pick different** (search `shopify_products` by title; approve-mapping endpoint gains an optional `shopify_product_id` override). Keyboard: `A` approve, `R` reject, `/` focus search, arrows to navigate. Progress ("14 of 96") and an end-of-queue state that celebrates finishing.

## Decks tab (WS-3) — contents as decklists

**List view.** Deck products from the mirror (`product_type IN` the three deck types): image, title, price, inventory badge, status: **Linked** (→ decklist) / **Not linked** (→ "Pull contents"). Live products sort first.

**Pull-contents wizard.**
1. Source: the synced `body_html` (refresh = re-sync that product; no separate scraper — the storefront `.js` endpoint stays as a documented fallback).
2. Parse: strip HTML to lines; recognize section headers (Dominants, Lost Souls, Heroes, …) as grouping hints; line grammar `[(N) ]Name[ (SET)]` → qty (default 1), name, YTG set abbrev. Resolve set via reversed `set_aliases`; resolve card via carddata name normalization (reuse the matcher's normalization helpers, target `CARDS`, not Shopify).
3. Review screen: each parsed line → matched card thumbnail + qty + confidence; unresolved lines flagged with inline card search (existing card search components); running total vs. expected count. Nothing saves until every line is resolved or explicitly dropped.
4. Create: insert deck (`user_id` = YTG account, resolved once by email `yourturngamesin@gmail.com` and pinned as a constant like `REDEMPTIONCCG_USER_ID` in `app/tracker/tournaments/actions.ts:14`), `visibility: 'public'`, name = product title with `*New* ` prefix stripped, then `deck_cards` rows; write the link row.
5. Source of truth: the deck. Edits in the normal deck builder (YTG account or admin) are automatically what "Record sale" uses. Re-running the wizard on a linked product offers replace-contents, not duplicate-deck.

**Migration 089 (shared with WS-4):**
```sql
ytg_deck_links (
  shopify_product_id TEXT PRIMARY KEY,
  deck_id UUID UNIQUE NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  handle TEXT, product_title TEXT,
  created_by UUID, created_at TIMESTAMPTZ DEFAULT now()
)
```
RLS enabled, no policies, `REVOKE` anon/authenticated — service-role only, same as `shopify_card_imports`.

## Record sale (WS-4) — inventory decrement with ledger + undo

**Prerequisite (external):** `write_inventory` scope — new app version at dev.shopify.com + Andy's approval. The 2026-07-25 spec explicitly skipped it ("inventory untracked"); inventory is now tracked-at-0 for imports, and this feature needs writes. Kick off the approval when WS-0 starts so it isn't the long pole. Until granted: `YTG_INVENTORY_WRITES` env unset → the whole flow runs dry-run with a visible banner ("Dry run — no inventory will change"), and a real `ACCESS_DENIED` from Shopify degrades to the same banner plus a "scope not yet granted" explainer.

**Flow.**
1. On a linked deck product: **Record sale** → qty stepper (default 1).
2. Preview (server action, read-only): every deck card × qty with its matched single (via `card_price_mappings`, status `matched`/`manual`), current mirror inventory, and the delta. Cards with no mapping are **flagged, not silently skipped** — "3 cards won't be adjusted — fix in Matching" links to the queue. Admin can proceed partial (flags recorded on the ledger) or fix first.
3. Confirm → execute:
   - Resolve variant IDs from `shopify_products.raw_json`; fetch `inventoryItem.id`s via one GraphQL `nodes` query on variant GIDs.
   - Location: query `locations(first: 5)`; exactly one active location expected → use it; otherwise fail loudly with a config error (single-location store assumption, asserted not assumed).
   - `inventoryAdjustQuantities` (`name: "available"`, `reason: "correction"`, negative deltas), batched ≤250 changes/call through the existing throttled client.
4. Ledger — written before adjusting (status `pending`), finalized after:
```sql
ytg_deck_sales (
  id UUID PK DEFAULT gen_random_uuid(),
  shopify_product_id TEXT NOT NULL, deck_id UUID NOT NULL,
  qty INT NOT NULL CHECK (qty > 0),
  status TEXT CHECK (status IN ('pending','applied','partial','failed','dry_run','undone')),
  created_by UUID, created_at TIMESTAMPTZ DEFAULT now(),
  undone_by UUID, undone_at TIMESTAMPTZ
)
ytg_deck_sale_items (
  sale_id UUID REFERENCES ytg_deck_sales(id) ON DELETE CASCADE,
  card_key TEXT NOT NULL, card_name TEXT, qty_per_deck INT NOT NULL,
  delta INT NOT NULL,
  single_product_id TEXT, variant_id TEXT, inventory_item_id TEXT,
  status TEXT CHECK (status IN ('applied','skipped_unmapped','error')),
  error TEXT,
  PRIMARY KEY (sale_id, card_key)
)
```
   Same RLS posture as `ytg_deck_links`. Idempotency: the confirm button disables on submit; the sale row is created first, so a retry after failure resumes/marks that sale rather than creating a sibling.
5. Results screen: per-card outcomes; errors retryable per-row. **Undo** on any `applied`/`partial` sale reverses the applied deltas (positive adjustment, same ledger items), sets `undone`. Undo is single-shot (no redo).
6. Sales history list on the tab: date, product, qty, status, who — with undo buttons. This is Andy's receipt trail.

## UX principles (all tabs)

- **Diff/preview before every write.** No mutation fires from a button the admin hasn't seen the consequences of.
- **Progress you can watch, errors you can retry.** Long operations stream a counter; failures land in a per-row retry list, never a toast-and-gone.
- **Everything links to where it's fixed.** Unmapped card → Matching queue; stale sync → sync action; health strip → owning tab.
- **Keyboard-first where volume lives** (review queue). Mobile-capable everywhere (Andy may record a sale from his phone at a convention table).
- Follow `prompt_context/design_system.md`; data-dense tables, quiet motion, no decoration.

## Workstreams (subagent split)

| WS | Scope | Depends on | Migration |
|----|-------|------------|-----------|
| 0 | Shell + server gate + importer move + redirect + nav rename; auth on 5 routes; sync types + `sku`/`body_html` columns; matcher Single-filter; collapse sync duplicates | — | 088 |
| 1 | `tagRules.ts` extraction; Products tab: scope → diff → apply | WS-0 | — |
| 2 | Pass 0 (SKU); SKU backfill; ability-text signal + validation script; Matching tab dashboard + review queue; approve-endpoint override param | WS-0 | — |
| 3 | Decks tab list; pull-contents wizard (parse → review → create + link); YTG account constant | WS-0 | 089 |
| 4 | Record sale: preview, inventory adjust, ledger, undo, dry-run mode, sales history | WS-3 | (089) |

WS-1/2/3 run in parallel worktrees off `origin/main` after WS-0 merges (per CLAUDE.md worktree rules; absolute paths; PRs base `origin/main`). WS-4 continues in WS-3's lane. Each WS is one PR. Suggested order of merges: 0 → (1|2|3) → 4.

**External dependency to start immediately:** Andy's approval of the `write_inventory` app version.

## Testing & verification

- **Unit:** tag rules (managed-tag ownership; rotation→limited swap); pass 0 matching; deck-contents parser against a committed fixture of the real Fiery Furnace description (and one contender deck); `cardSku` collision guard.
- **Pipeline validation:** `scripts/validate-matching.ts` before/after report attached to WS-2's PR; CSV spot-check.
- **Dry-run e2e:** with `SHOPIFY_WRITE_MOCK=1` / `YTG_INVENTORY_WRITES` unset, every flow completes and writes correct ledger/mapping rows (the importer's mock-mode playbook; clean up rows after).
- **Manual (verify skill):** gate behavior for non-permissioned user (404), tab deep-links, review-queue keyboard pass, one real tag-sync on a single set, one real sale + undo after scope grant.

## Risks & mitigations

- **Deck description drift** (Andy edits a product page): the deck, not the description, is the source of truth post-link; re-pull offers replace with a diff.
- **Duplicate mappings → SKU collisions:** primary-mapping guard in backfill; report skips.
- **Multi-location surprise:** asserted single location; loud failure, no guess.
- **Sync now mirrors non-singles:** matcher filter added in the same PR (WS-0) so no window where decks can fuzzy-match as singles.
- **Unauthenticated routes were public:** gated in WS-0 before any UI links to them.
