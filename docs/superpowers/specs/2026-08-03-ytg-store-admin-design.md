# YTG Store Admin — Consolidation, Reconciliation, and Deck Inventory

**Date:** 2026-08-03 (rev 2 — post adversarial review)
**Status:** Approved design, pre-implementation
**Builds on:** YTG Shopify set importer (PR #241, #281 — both merged; `docs/superpowers/specs/2026-07-25-ytg-shopify-set-import-design.md`)

## Problem

Three related needs from YTG (Andy Fish, store owner) and Tim:

1. **Consolidation.** The set importer lives at `/admin/import-set` as a one-off page. More YTG store tooling is coming; it needs one home with tabs, not scattered pages. Meanwhile five pricing endpoints under `/api/admin/` (`sync-shopify`, `run-matching`, `review-queue`, `approve-mapping`, `reject-mapping`) hold a service-role client with **no auth**, and the matcher's `needs_review` queue has no UI at all.
2. **Reconciliation.** Card↔product matching relies on fuzzy title passes. Two deterministic signals go unused: the importer already writes SKU `cardSku(card)` + a `custom.rtt_card_key` metafield on new products (matcher never reads them), and product descriptions carry the card's special-ability text (sync throws `body_html` away). A Shopify products export (`tmp/products_export_1.csv`, 4,874 singles, zero SKUs) serves as a validation corpus.
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
- Replaying `dry_run` sales as real sales after the scope lands (declared non-replayable; the UI says so).

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

- **Gate:** `layout.tsx` is a server component: `hasPermission('manage_shopify_imports')` else `notFound()` (the `/admin/permissions` pattern — upgrade over the importer's client-only redirect; `hasPermission` in `utils/adminUtils.ts` is a plain async server helper, layout-safe). All tabs reuse the same permission; no new permission key, no allowlist migration. **Constraint (recorded on purpose):** granting `manage_shopify_imports` to anyone beyond Tim/Andy requires first splitting a `manage_ytg_inventory` permission out of it — the Decks tab moves stock, not just catalog data.
- **Tabs are route segments**, not client state: deep-linkable, and each subagent workstream owns its directory with near-zero file overlap.
- **Health strip** in the shell header (server-rendered, one query each): sync freshness as `min(last_synced_at)` across the mirror (max lies after a partial sync failure — `syncShopifyProducts` logs batch errors and continues), mirrored product count, matched % of mapped cards, `needs_review` count, `unmatched` count. Each stat links to the tab that acts on it.
- `/admin/import-set` becomes a redirect to `/admin/ytg/import`. `components/top-nav.tsx` entries (desktop + mobile) rename to "YTG Store" → `/admin/ytg` (only top-nav links the old route; redirect covers bookmarks).

## Foundation (WS-0)

1. **Route auth.** Add `hasPermission('manage_shopify_imports')` → 403 to the five naked routes (same shape as `app/api/admin/import-set/route.ts`). No other caller exists (verified: scripts/, Makefile, package.json, vercel.json clean). The cron route keeps its `CRON_SECRET` check.
2. **Sync extension** (`lib/pricing/syncShopifyProducts.ts` + the duplicated route/cron bodies — collapse them onto the shared function while touching this):
   - Fetch product types: `Single`, `Contender Deck`, `Challenger Deck`, `Champion Deck` (one paginated REST fetch per type; the param takes a single value). Per-row upsert on `id` means extra type fetches don't churn singles' `last_synced_at`.
   - Store two new columns on `shopify_products` (migration **088**): `sku TEXT`, `body_html TEXT`. Both are in the default REST payload already fetched (variant[0].sku; product.body_html) — the local `ShopifyAPIProduct` interface gains the fields; backfill happens on first sync run.
3. **Move the importer** page under the shell, delete its self-rendered `<TopNav />` (shell provides chrome), keep the API route where it is.

Note: the matcher already filters `product_type = 'Single'` in both the loader (`matching.ts` `loadShopifyProducts`) and the fuzzy RPC's SQL — deck products in the mirror cannot fuzzy-match as singles today. No WS-0 work needed there; the one place that DOES need a Single filter is WS-2's new "Pick different" product search.

## Products tab (WS-1) — tag sync

**Job:** keep Andy's store tags in step with our card data. The tag rules already exist inline in `lib/shopify/productFromCard.ts` (type→`TYPE_TAGS`, brigade→`BRIGADE_TAGS`, official set, Legacy/Ultra rarity, `legality === 'Rotation'` → `Rotation Cards`, promo sets → `Promos`, dual alignment).

**Changes:**
- Extract the tag computation into `lib/shopify/tagRules.ts`: `desiredTags(card): string[]` plus `MANAGED_TAGS` — the set of tags this system owns (type, brigade, set, rarity, legality, `Promos`, `Dual Alignment`). Diffing only ever adds/removes **managed** tags. When the Limited/Unlimited format restructure lands in card data, the legality rule updates in this one file.
- `productFromCard` consumes `tagRules` so importer and tag-sync can't drift.
- **Diff granularity is the product, not the mapping.** Multiple card_keys can map to one product (promo fallback passes — `shopify_product_id` is not unique in `card_price_mappings`). Desired managed tags for a product = the **union** of `desiredTags(card)` over all its confirmed mappings; remove only managed tags outside that union. Per-mapping diffing oscillates and the post-apply "clean diff" check would never pass.
- **Name-collision reconciliation (one-time, before first apply):** managed-tag names can collide with tags Andy hand-added for merchandising (`Gold`, `Silver` are brigade names). The tab's first-run screen lists every live tag that collides with `MANAGED_TAGS` with product counts; Andy signs off before removals are ever offered.

**Flow:**
1. Scope picker: whole store or one set → **Compute diff** (server action: join confirmed `card_price_mappings` × card data × `shopify_products.tags`, grouped by product; pure read).
2. Diff screen: roll-up summary first ("`− Rotation Cards` on 2,314 · `+ Limited` on 1,876"), then per-product rows with add/remove chips. Additions are bulk-selectable; **removals require per-tag opt-in** (no select-all across removal tags — additive writes are safe, subtractive ones are where hand-added data dies). Filter by tag change.
3. Staleness gate: apply requires a sync run newer than a threshold (e.g. 1 hour); the button offers "Sync now" inline otherwise. Between-sync tag edits by Andy are then bounded by a window he's aware of.
4. Apply: batched GraphQL `tagsAdd`/`tagsRemove` via aliases through `shopifyGraphQL`. **Batch ≤40 products per document** — the single-document cost cap is 1,000 points at ~10/mutation, and the client retries `THROTTLED` but not `MAX_COST_EXCEEDED` (oversize fails whole-document). Per-alias `userErrors` map to a retryable error list. Products cap at 250 total tags (userError past that — surfaced, not pre-checked). Live progress counter.
5. Re-running compute after apply shows a clean diff — that's the verification.

Tag writes are covered by the existing `write_products` scope. `SHOPIFY_WRITE_MOCK=1` short-circuits like the importer.

## Matching tab (WS-2) — deterministic-first reconciliation

**Pass 0 — exact identity.** New first pass in `runMatchingPipeline`: match cards to `shopify_products.sku`, where expected SKU is computed by **calling `cardSku(card)`** (it strips all whitespace — `RoA 3` → `RoA3-...`; do not string-build `${set}-${imgFile}`). `match_method: 'sku'`, confidence 1.0.
- **Pass 0 is exempt from the `loadProtectedKeys` skip.** That protection covers `manual`, `no_price_exists`, and `auto_matched ≥ 0.95` — but nearly every matched card sits at ≥0.95, so a pass 0 gated by it could never correct a confident-but-wrong fuzzy match, defeating its purpose. Pass 0 runs against everything; the `writeResults` filter (which is force-proof and re-fetched per run) still protects `manual`/`no_price_exists` rows at the write layer.
- **Duplicate SKUs → `needs_review`, never auto-pick.** Two products carrying the same SKU is a data bug (see backfill hygiene below); pass 0 must surface it, not guess.
- Known collision: `cardSku` collides for exactly one pair ("Angel of the Lord (G)"/"(H)", both set `10A`, shared imgFile) — inert because `10A` is in `UNSOLD_SETS` → `no_price_exists`. The collision-guard unit test asserts exactly this exception.

**SKU backfill (one-time action, then rarely needed).** For every confirmed mapping (`matched`/`manual`) whose product has no SKU: write `cardSku(card)` via `productVariantsBulkUpdate` and `custom.rtt_card_key` via `metafieldsSet`. Deliberately **not** `productSet` — avoids its price-zeroing and media list-field invariants entirely.
- **Exact mutation shape (2026-07):** `productVariantsBulkUpdate(productId, variants: [{ id: <variantGid>, inventoryItem: { sku } }])` — SKU lives at `inventoryItem.sku` in `ProductVariantsBulkInput`, NOT top-level `sku` (that shape is `productSet`-only; copying `ShopifyProductSetInput` from `productFromCard.ts` is the trap). One call per product (productId is an argument); batch across products via aliases within the cost cap. `metafieldsSet` chunks at **25 metafields/call**.
- Guard: if multiple card_keys map to one product, backfill the **primary** mapping only (highest-confidence exact/normalized); non-primary skips are **permanent by design** — the report labels them so, they are not a to-do list.
- Diff-preview first (count + sample), batched, progress + retryable errors, `write_products` covers it. After one backfill of ~4.8k products, every future sync self-matches through pass 0.

**Re-mapping hygiene.** When the review queue moves a card to a different product:
- "Pick different" approves with the chosen `shopify_product_id` (the existing approve endpoint already takes the product id as a required param — the UI just passes the chosen one) and writes `status='manual'`, which both `writeResults` and pass 0's write layer respect — the human decision can't be silently reverted by the next pipeline run.
- If the **old** product carries this card's SKU/`rtt_card_key`, the same action clears them on the old product (it holds `write_products` already). Stale identity metadata that outlives the mapping is how duplicate SKUs are born.

**Ability-text signal.** `pass3and4Fuzzy` gains a disambiguator: strip `body_html` to text, token-overlap against the card's special ability, and fold into the multi-signal score. Validation: a dev script (`scripts/validate-matching.ts`) runs the pipeline dry-run before/after and reports method/match-rate deltas; `tmp/products_export_1.csv` doubles as an offline spot-check corpus. No threshold changes ship without that report in the PR.

**Review queue UI.** The tab shows:
- Dashboard: counts by `match_method`, needs-review and unmatched totals (the health-strip numbers, expanded).
- Queue: one mapping at a time — card image + card data on the left, proposed product (title, price, tags, ability text from `body_html`) on the right, confidence + method badge. Actions: **Approve / Reject / Pick different** (search `shopify_products` filtered to `product_type = 'Single'` — nothing else enforces that filter on this new path). Keyboard: `A` approve, `R` reject, `/` focus search, arrows to navigate. Progress ("14 of 96") and an end-of-queue state that celebrates finishing.

## Decks tab (WS-3) — contents as decklists

**List view.** Deck products from the mirror (`product_type IN` the three deck types): image, title, price, inventory badge, status: **Linked** (→ decklist) / **Not linked** (→ "Pull contents"). Live products sort first.

**Pull-contents wizard.**
1. Source: the synced `body_html` (refresh = re-sync that product; the storefront `.js` endpoint stays as a documented fallback).
2. Parse: strip HTML to lines; recognize section headers (Dominants, Lost Souls, Heroes, …) as grouping hints; line grammar `[(N) |Nx |xN ]Name[ (SET)]` → qty (default 1), name, YTG set abbrev. **Precedence rule:** a trailing parenthetical is a set only if it resolves via `set_aliases`; otherwise it's part of the name; if both parses resolve, flag ambiguous — never auto-pick.
3. Set resolution: reversed `set_aliases` is **not injective** (live data has 5 ambiguous abbrevs: Promo←{Pmo-P1,Pmo-P2,Pmo-P3}, K Deck←{K,K1P}, L Deck←{L,L1P}, RoA←{RoA,RoA 3}, Wo←{Wo,Wom}). Reverse to a candidate **list**; disambiguate by which candidate set actually contains the parsed name; ties go to the review screen. Name matching reuses `normalize`/`stripEmbeddedSet` from `lib/pricing/helpers.ts` against `CARDS` (`findCard` alone is exact-match only). Expectation: Lost Soul lines will bulk-land in manual resolution (store scripture-paren naming vs carddata brackets) — acceptable, that's what the review screen is for.
4. Review screen: each parsed line shows **the raw source line** beside the matched card thumbnail + qty + confidence; unresolved/ambiguous lines get inline card search; running total vs. expected count. Nothing saves until every line is resolved or explicitly dropped.
5. Create (all inserts via `getSupabaseAdmin()` — RLS has no admin bypass on `decks`/`deck_cards`, and the deck belongs to the YTG user, not the acting admin):
   - `decks`: `user_id` = YTG account (resolved once by email `yourturngamesin@gmail.com`, pinned as a constant like `REDEMPTIONCCG_USER_ID` in `app/tracker/tournaments/actions.ts:14`), `visibility: 'public'`, name = product title with `*New* ` prefix stripped — **on name collision within the YTG account, suffix with the product handle** (the store deliberately sells old/new stock as separate products with near-identical names; `decks` has no unique-name constraint to catch it for us), plus `card_count` (main-zone count — it is app-maintained, not trigger-maintained; a 0 here shows "0 cards" on every public deck surface), `format`, `preview_card_1/2`.
   - `deck_cards`: `zone: 'main'` only, raw carddata `card_img_file`.
   - Link row: **insert the link first, then the deck** (two wizard tabs racing: the loser hits the link PK conflict before orphaning a deck; on conflict, show "product was linked while you worked — view/replace").
6. Source of truth: the deck. The YTG account can edit it in the normal deck builder; **admins edit via the Decks tab** (re-run wizard → replace contents, service-role) — admin edits through the regular deck builder would silently no-op under RLS. Re-running the wizard on a linked product offers replace-contents, not duplicate-deck; replace is **refused while a sale for that product is `pending`/`applying`**.

**Migration 089 (shared with WS-4):**
```sql
ytg_deck_links (
  shopify_product_id TEXT PRIMARY KEY,
  deck_id UUID UNIQUE NOT NULL REFERENCES decks(id) ON DELETE RESTRICT,
  handle TEXT, product_title TEXT,
  created_by UUID, created_at TIMESTAMPTZ DEFAULT now()
)
```
`ON DELETE RESTRICT`, not CASCADE: once linked, the deck is store metadata — deleting it from the deck builder fails with a pointer to the Decks tab (unlink first). RLS enabled, no policies, `REVOKE` anon/authenticated — service-role only, same as `shopify_card_imports`.

## Record sale (WS-4) — inventory decrement with ledger + undo

**Prerequisite (external):** `write_inventory` scope — new app version at dev.shopify.com, then Andy approves the scope prompt **in his store Admin**. Kick this off when WS-0 starts. `write_inventory` implies `read_inventory`, which satisfies the `locations` query — no extra scope needed. Until granted: `YTG_INVENTORY_WRITES` env unset → the whole flow runs dry-run with a visible banner, and a real `ACCESS_DENIED` degrades to the same banner plus a "scope not yet granted" explainer. Dry-run sales are recorded with status `dry_run`, **visually segregated in history** ("recorded before inventory writes were enabled — not applied"), have no undo button, and are non-replayable.

**Shopify API contract (2026-07 — verified against current docs, two 2026-04 breaking changes apply):**
- `inventoryAdjustQuantities` **requires the `@idempotent(key:)` directive** (mandatory since 2026-04). Key = `sale:<sale_id>:batch:<n>` — **reused verbatim on any retry/resume of that batch** so Shopify dedupes server-side; undo batches mint distinct keys (`undo:<sale_id>:batch:<n>`). `inventoryActivate` requires the directive too.
- Every `InventoryChangeInput` **requires `changeFromQuantity`** (mandatory since 2026-04; explicit `null` opts out). We pass the live pre-quantity — a genuine compare-and-swap: if reality moved between preview and apply, that change is rejected and lands in the per-row retry list after re-preview, instead of silently compounding.
- Items imported tracked-at-0 may have **never been activated at the location** → `ITEM_NOT_STOCKED_AT_LOCATION`. Handle per-change: `inventoryActivate(inventoryItemId, locationId, available: 0)`, then retry the change.
- `name: "available"`, `reason: "correction"`, ≤250 changes/call (one ~60-card deck sale fits in one call), `nodes(ids:)` on variant GIDs → `inventoryItem { id }` in one query.
- Location: query `locations(first: 5)`; exactly one active expected → use it; otherwise fail loudly (single-location assumption asserted, not assumed).

**Flow.**
1. On a linked deck product: **Record sale** → qty stepper (default 1).
2. **Preview reads live Shopify inventory** (existing `fetchProductInventory`, `lib/pricing/shopify.ts:107`) for the mapped singles — never the mirror (mirror staleness → oversell; Shopify happily drives `available` negative with no error). Per card × qty: matched single, live quantity, delta, `qty_after`. Flag classes: **unmapped** ("fix in Matching" link), **untracked** (`inventory_management ≠ shopify` — won't be adjusted, own flag, not an error), **would-go-negative** (red, requires explicit acknowledgment). Deck cards are read `zone='main'` only, **summed per card_key**. Admin can proceed partial (flags recorded on ledger) or fix first.
3. **Confirm = snapshot.** Sale + items are written from the previewed data — apply never re-reads `deck_cards` (deck edits between preview and apply otherwise mutate what the admin approved). Preview carries `decks.updated_at`; if it moved by confirm, abort with "deck changed — re-preview". Empty item set blocks confirm.
   - Server-side claim: sale inserts as `pending`, then `UPDATE … SET status='applying' WHERE id=$1 AND status='pending'` — a refresh-and-resume or a second admin loses the CAS and sees "already being applied". Partial unique index `ON ytg_deck_sales(shopify_product_id) WHERE status IN ('pending','applying')` prevents concurrent sales per product, and the confirm screen surfaces any applied sale for the same product in the last 10 minutes ("Andy recorded this sale 2 min ago — record another?").
4. **Apply, crash-safe:** items are pre-written with `qty_before`/`qty_after`; each batch flips its items to `applying` **before** the Shopify call and `applied` after. On resume, `applying` items are UNKNOWN: re-read live quantity — equals `qty_after` → mark `applied`; equals `qty_before` → re-apply (same idempotency key); anything else → `conflict`, human resolves. The idempotency key makes even the re-apply race safe.
5. Sale status is **derived** from items: all applied → `applied`; some → `partial`; none → `failed` (zero applied — undo is offered only on `applied`/`partial`, so `failed` strands nothing).
6. Results screen: per-card outcomes; errors retryable per-row (safe: CAS + idempotency key). Sales history on the tab: date, product, qty, status, who — Andy's receipt trail.
7. **Undo:** claimed via `UPDATE … SET status='undoing' WHERE id=$1 AND status IN ('applied','partial')` (double-click/two-tab safe). Reverses only items with status `applied`, via positive adjustments with `changeFromQuantity = qty_after` — if live quantity moved since the sale (manual correction, real purchase), that item becomes `undo_conflict` with a "review in Shopify" link instead of blindly stacking stock. Terminal: all reversed → `undone`; some → `undo_partial`. Single-shot, no redo.

**Migration 089 (ledger):**
```sql
ytg_deck_sales (
  id UUID PK DEFAULT gen_random_uuid(),
  shopify_product_id TEXT NOT NULL, deck_id UUID NOT NULL,  -- no FK: history outlives links
  qty INT NOT NULL CHECK (qty > 0),
  status TEXT CHECK (status IN ('pending','applying','applied','partial','failed',
                                'dry_run','undoing','undone','undo_partial')),
  created_by UUID, created_at TIMESTAMPTZ DEFAULT now(),
  undone_by UUID, undone_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX ON ytg_deck_sales(shopify_product_id)
  WHERE status IN ('pending','applying');

ytg_deck_sale_items (
  sale_id UUID REFERENCES ytg_deck_sales(id) ON DELETE CASCADE,
  card_key TEXT NOT NULL, card_name TEXT, qty_per_deck INT NOT NULL,
  delta INT NOT NULL,
  qty_before INT, qty_after INT,          -- CAS anchors; also the resume oracle
  single_product_id TEXT, variant_id TEXT, inventory_item_id TEXT,
  status TEXT CHECK (status IN ('pending','applying','applied','skipped_unmapped',
                                'skipped_untracked','error','conflict','undone','undo_conflict')),
  error TEXT,
  PRIMARY KEY (sale_id, card_key)         -- quantities summed across zones pre-insert
);
```
Same RLS posture as `ytg_deck_links`.

## UX principles (all tabs)

- **Diff/preview before every write.** No mutation fires from a button the admin hasn't seen the consequences of — and apply acts on the previewed snapshot, never a re-read.
- **Progress you can watch, errors you can retry.** Long operations stream a counter; failures land in a per-row retry list, never a toast-and-gone.
- **Everything links to where it's fixed.** Unmapped card → Matching queue; stale sync → sync action; health strip → owning tab.
- **Keyboard-first where volume lives** (review queue). Mobile-capable everywhere (Andy may record a sale from his phone at a convention table).
- Follow `prompt_context/design_system.md`; data-dense tables, quiet motion, no decoration.

## Workstreams (subagent split)

| WS | Scope | Depends on | Migration |
|----|-------|------------|-----------|
| 0 | Shell + server gate + importer move + redirect + nav rename; auth on 5 routes; sync types + `sku`/`body_html` columns; collapse sync duplicates | — | 088 |
| 1 | `tagRules.ts` extraction; Products tab: collision reconciliation, scope → product-granularity diff → gated apply | WS-0 | — |
| 2 | Pass 0 (SKU, protection-exempt); SKU backfill (`inventoryItem.sku` shape); re-mapping hygiene; ability-text signal + validation script; Matching tab dashboard + review queue | WS-0 | — |
| 3 | Decks tab list; pull-contents wizard (parse → review → create + link, service-role); YTG account constant | WS-0 | 089 |
| 4 | Record sale: live preview, snapshot confirm, idempotent CAS apply, ledger, undo, dry-run mode, history | WS-3 | (089) |

WS-1/2/3 run in parallel worktrees off `origin/main` after WS-0 merges (per CLAUDE.md worktree rules; absolute paths; PRs base `origin/main`). WS-4 continues in WS-3's lane. Each WS is one PR. Merge order: 0 → (1|2|3) → 4.

**External dependency to start immediately:** the `write_inventory` app version + Andy's in-Admin approval.

## Testing & verification

- **Unit:** tag rules (managed-tag ownership, union-over-mappings diff); pass 0 (via `cardSku()`, duplicate-SKU → needs_review, the known 10A collision asserted); deck-contents parser (committed fixtures of the real Fiery Furnace + one contender description; precedence rule; qty variants; ambiguous-alias candidates); sale apply state machine (resume from `applying` with all three oracle outcomes; undo conflict path) with a mocked Shopify client.
- **Pipeline validation:** `scripts/validate-matching.ts` before/after report attached to WS-2's PR; CSV spot-check.
- **Dry-run e2e:** with `SHOPIFY_WRITE_MOCK=1` / `YTG_INVENTORY_WRITES` unset, every flow completes and writes correct ledger/mapping rows (importer's mock-mode playbook; clean up rows after).
- **Manual (verify skill):** gate behavior for non-permissioned user (404), tab deep-links, review-queue keyboard pass, one real tag-sync on a single set, one real sale + undo after scope grant.

## Risks & mitigations

- **Shopify 2026-04 breaking changes** (`@idempotent`, `changeFromQuantity`) are load-bearing in WS-4's design, not afterthoughts — the CAS + idempotency-key protocol above is built on them.
- **Deck description drift** (Andy edits a product page): the deck, not the description, is the source of truth post-link; re-pull offers replace with a diff.
- **Tag-name collisions with hand-added tags:** one-time reconciliation sign-off + per-tag removal opt-in + staleness gate.
- **Duplicate SKUs:** backfill primary-only guard + re-mapping clears stale SKU/metafield + pass 0 sends duplicates to review.
- **Multi-location surprise:** asserted single location; loud failure, no guess.
- **Unauthenticated routes were public:** gated in WS-0 before any UI links to them.
