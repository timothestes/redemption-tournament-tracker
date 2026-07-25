# YTG Shopify Set Import — Design

- **Date:** 2026-07-25
- **Status:** Draft (design / brainstorming output)
- **Owner:** landofredemption
- **Related code:** `lib/pricing/shopify.ts`, `app/api/admin/sync-shopify/route.ts`, `lib/cards/lookup.ts`, `supabase/migrations/011_create_price_tables.sql`

## 1. Goal

Let an admin select a Redemption set and create one Shopify product per card in that set inside YTG's live store (`your-turn-games.myshopify.com`), so YTG no longer hand-creates dozens–hundreds of single-card listings when a new set drops. We already hold the card data (names, type, brigade, rarity, set), the card images (public Vercel Blob URLs), and already talk to this exact store for pricing — this feature adds the first *write* path.

Each imported product carries a **card image** and the **price YTG enters inline during import**, so a set can be created complete-in-one-pass ("one shot") rather than needing per-card cleanup in Shopify afterward.

Success = an admin picks a set, sees a preview with each card's image and an editable price, runs it, and the set's cards appear in Shopify with image + price attached; afterward the existing price pipeline picks them up automatically. Products land as **draft** by default (YTG reviews then publishes), with an **Active** toggle for a true one-shot.

## 2. Context (what already exists)

- **Read integration:** `lib/pricing/shopify.ts` authenticates to `your-turn-games.myshopify.com` via a custom-app token (`getShopifyAccessToken()`, env `SHOPFIY_CLIENT_ID` [sic] + `SHOPIFY_CLIENT_SECRET`) and reads products (`fetchAllShopifyProducts`, filtered to `product_type='Single'`). It handles 429/`Retry-After`. Pinned to REST API version `2024-01`.
- **Pricing pipeline (Shopify → app):** cron `app/api/cron/sync-prices` and manual `app/api/admin/sync-shopify` upsert products into Supabase `shopify_products`, then a matcher (`lib/pricing/matching.ts`) resolves each card → product into `card_price_mappings` / `card_prices`, which the deck builder reads.
- **Card data:** generated `lib/cards/generated/cardData.json` via `lib/cards/lookup.ts` (`CARDS`, `findCard`, `CardData`). Fields: `name, set, imgFile, officialSet, type, brigade, strength, toughness, class, identifier, specialAbility, rarity, reference, alignment, legality`. Card key = `` `${name}|${set}|${imgFile}` ``.
- **Set mapping:** Supabase `set_aliases` maps carddata set codes → YTG/Shopify set abbreviations.
- **Real YTG "Single" shape (from `scripts/output/ytg_products.json`, 5,131 products):**
  - `title`: `"He is Risen" (Legacy Rare)`, `"I AM" Has Sent Me (PoC)` — card name + a parenthetical (set abbrev, or a rarity/variant qualifier).
  - `handle`: slug of title · `vendor`: `Your Turn Games` · `product_type`: `Single` · `status`: `active`.
  - `tags` (comma-sep): card type + brigade/color + set name + rarity + grouping, e.g. `Good Enhancement, Gospel of Christ, Legacy Rare, Rotation Cards, White`.
  - `variant`: single default variant, `price` string, **SKU empty, inventory not tracked**.
  - `images`: none — YTG singles are text-only listings.

## 3. Non-goals

- Not importing stock levels. Inventory is not tracked on YTG singles, so we don't touch it. (Prices and images **are** in scope — see §6, §6a, §6b.)
- Not touching the existing read/pricing path beyond consuming its reconcile step.
- Not in scope: Forge custom sets. This targets official Redemption sets YTG sells as singles.
- Not backfilling / de-duplicating YTG's existing 4,868 singles.
- Not hosting/processing images ourselves — we reuse the existing public Blob URLs and hand Shopify the URL; Shopify fetches and stores its own copy.

## 4. Approach

**Chosen: in-app API importer, draft-first, via GraphQL `productSet`.**

An admin page + API route builds a Shopify product per card and upserts it with the GraphQL Admin API's `productSet` mutation, as `DRAFT`, then reconciles into the pricing pipeline.

Why `productSet` over REST or `productCreate`:
- Shopify's **REST Admin API is legacy (as of 2024-10-01)**; its product endpoints are maintenance-mode with no new features. A new write path should be GraphQL.
- Shopify explicitly recommends **`productSet`** for apps that "sync product data from an external source." It sets product fields + the single variant's price/SKU in **one call**, supports an **`identifier`** argument for idempotent upsert, and requires only `write_products`.
- `productCreate` would need a second `productVariantsBulkUpdate` call to set the variant price — two round-trips per card for no benefit here.

**Rejected alternatives:**
- **REST `POST /products.json`** — matches existing code style but is on the deprecated path; avoid for new writes.
- **CSV export + Shopify's native importer** — zero write-scope and zero live-store risk, but a manual step for YTG, no idempotency, no round-trip. Kept as a near-free fallback: the core builder emits a normalized product object, and a CSV serializer is a thin adapter over it.
- **GraphQL bulk operations (`bulkOperationRunMutation` + JSONL)** — built for thousands of items; overkill for set-sized batches (~150–350 cards). Revisit only if we ever import the whole catalog at once.

## 5. Architecture (small, testable units)

- **`lib/shopify/productFromCard.ts`** — pure function `(CardData, setAlias, { price, imageUrl }) → ProductSetInput`. No I/O; price and image URL are passed in. This is where every mapping/naming decision lives, so it's unit-testable against real dump examples.
- **`lib/shopify/admin-write.ts`** — GraphQL client + write calls: `shopifyGraphQL(query, variables)` (reuses `getShopifyAccessToken()`), `productSetUpsert(input, identifier?)`. Owns cost-based throttling and THROTTLED retry.
- **`lib/shopify/importSet.ts`** — orchestrator: gather the set's cards from `cardData.json` → consult the import ledger → build inputs → upsert with concurrency/pacing → collect per-card results (`created | updated | skipped | error`) → write ledger rows.
- **`app/api/admin/import-set/route.ts`** — admin-gated. `GET`/preview builds the per-card plan (planned action, built title/tags, resolved image URL, image-available flag). `POST { setCode, status, cards: [{ cardKey, price, include }] }` executes with the prices the admin entered. A `dryRun` flag returns the plan without writing.
- **`app/admin/import-set/` page** — pick a set → preview table with an **image thumbnail**, built title/tags, an **editable price** per row, and planned action (create / already-exists / needs-attention) → **Draft/Active** toggle + bulk price helpers → **Dry-run** then **Execute** → results with per-card status and errors.
- **Migration: `shopify_card_imports`** (new) — ledger keyed by `card_key`: `shopify_product_id`, `variant_id`, `handle`, `status`, `error`, `created_at`, `updated_at`. Makes re-runs safe and gives an audit trail.

Data flow: `cardData` (+ `set_aliases`) → `productFromCard` → `importSet` → `productSet` (Shopify) → ledger → existing `sync-shopify` reconcile → `shopify_products` / matcher → deck-builder prices.

## 6. Field mapping (grounded in the real dump)

| Shopify field | Source / rule |
|---|---|
| `title` | `card.name` + ` (` + set abbrev from `set_aliases` + `)`. For the common case (importing one new set) every card gets that set's abbrev. Cards needing a rarity/variant qualifier (e.g. `(Legacy Rare)`) are flagged in preview for manual title override. |
| `handle` | deterministic slug of the title (mirrors YTG's scheme). |
| `productType` | `"Single"` (so the existing `product_type=Single` sync filter picks it up). |
| `vendor` | `"Your Turn Games"`. |
| `tags` | assembled: `card.type` + brigade→color name(s) + set name + `card.rarity` + rotation/grouping tag. Needs a brigade-code→color-name map (reuse/derive from the deck-builder brigade colors). |
| `variant.price` | the price YTG enters per card in the preview (see §6b). No hard-coded placeholder in the mapping. |
| `variant.sku` | canonical SKU we assign (e.g. `<setAbbrev>-<identifier>`), giving future idempotency YTG's own SKU-less singles lack. |
| `status` | `DRAFT` by default; `ACTIVE` if the admin flips the per-import toggle. |
| media (image) | one image per product from the card's public Blob URL (see §6a). |

Tag construction and the parenthetical convention are the two spots with per-set nuance; both live in `productFromCard` and are validated against dump examples, so tuning is localized. `productFromCard` stays pure — the price and image URL are passed *into* it (from the preview edits and the image resolver), not fetched inside it.

### 6a. Card images

- **Source:** `getCardImageUrl(card.imgFile)` from `app/shared/utils/cardImageUrl.ts` → `${NEXT_PUBLIC_BLOB_BASE_URL}/card-images/<imgFile>.jpg`. This is already a **public** Vercel Blob URL (the deck builder serves card art from it), so Shopify can fetch it directly — no upload/staging pipeline.
- **Mechanism:** attach in the same `productSet` call via the media/`files` field: `{ originalSource: <blobUrl>, mediaContentType: IMAGE, alt: <card name> }`. Shopify downloads and stores its own copy; media processing is **asynchronous** on Shopify's side (status goes `PROCESSING` → `READY`), so we don't block on it — the product is usable immediately and the image lands shortly after.
- **Missing images:** some cards may resolve to no Blob asset (e.g. a `forge:` ref or an un-synced image). These are **flagged in the preview** ("no image") and the product is still created without media rather than blocking the batch.
- **Idempotency:** the ledger records whether media was attached. On an update/re-run we omit the media field so Shopify doesn't append a duplicate image.

### 6b. Per-card price entry ("one shot")

- The preview table has an **editable price column**, one input per card, so YTG sets every price in this one screen instead of editing each product in Shopify afterward.
- **Bulk helpers:** a "set all prices to $X" action and an "apply to blank only" variant, plus an optional set-level default so a whole common-rarity set can be filled in one action.
- **Validation:** price is a non-negative decimal (2 places). Rows left blank fall back to the set-level default; any still-blank are flagged (not blocked) so the admin can decide.
- The entered price becomes `variant.price` in the `productSet` input. Combined with images and the `ACTIVE` toggle, a set can be imported publish-ready in a single pass.

## 7. Idempotency

Primary mechanism is our own **ledger** (`shopify_card_imports`), fully under our control:

1. For each card, look up `card_key` in the ledger.
2. **Miss** → `productSet` create; record `shopify_product_id` + `variant_id`.
3. **Hit** → `productSet(identifier: { id })` update (no duplicate).
4. Before first-time create, also pre-check Shopify by deterministic `handle` to avoid colliding with a pre-existing YTG listing; if found, record it as `skipped` (needs-attention) rather than creating a second one.

We additionally set a stable `sku` and (optionally) a `custom.rtt_card_key` metafield so products remain traceable to their card even outside the ledger.

## 8. Shopify API details

- **Auth:** reuse `getShopifyAccessToken()` + `X-Shopify-Access-Token` header. No new auth mechanism.
- **Endpoint:** GraphQL Admin `POST /admin/api/<version>/graphql.json`.
- **Version:** target a current stable version (2026-07 at time of writing) for the write path; `productSet` requires ≥ 2024-04. (Aside: the read path is still pinned to `2024-01`, now past its support window — worth bumping separately, but out of scope here.)
- **Mutation:** `productSet(synchronous: true, identifier: …, input: ProductSetInput)`. `synchronous: true` is fine for single-variant products; switch to async + `productOperation` polling only if we hit timeouts on large sets.
- **Media:** image attached in the same `productSet` input via the media/`files` field (`originalSource` = public Blob URL, `mediaContentType: IMAGE`). Shopify fetches and stores its own copy; processing is async (`PROCESSING` → `READY`) and does not block the mutation response.
- **Scope:** `write_products` must be added to YTG's custom app (currently read-only). This scope also covers product media. `write_inventory` not needed (inventory untracked).
- **Env:** `NEXT_PUBLIC_BLOB_BASE_URL` must be present in the environment running the import (used to build image URLs).
- **Rate limits:** cost-based — 1,000-point bucket, 50 pts/s restore, ~10 pts/mutation ⇒ ~5 upserts/s sustained. Pace off `extensions.cost.throttleStatus`; back off on `THROTTLED`. A 300-card set ≈ ~60–70s.

## 9. Round-trip / reconciliation

After a successful import, trigger the existing `sync-shopify` → `shopify_products` → matcher pipeline (or a set-scoped variant of it) so newly-created cards flow into `card_price_mappings` / `card_prices` and start showing prices in the deck builder with no extra wiring. Ledger `card_key` = the matcher's join key, so mappings land cleanly.

## 10. Safety & operations

- **Draft by default** — nothing is shopper-visible until YTG publishes; `ACTIVE` is an explicit opt-in toggle for a one-shot import.
- **Dry-run preview** — required first look; shows planned action, built payload, resolved image, and the entered price per card, no writes.
- **Price validation** — non-negative decimal (2 places); blank falls back to the set-level default and is flagged. No accidental $0 unless the admin leaves it so.
- **Per-card error isolation** — one bad card (bad price, missing image, API error) is reported and the batch continues.
- **Idempotent re-runs** — ledger + `identifier` upsert; safe to re-run a partially-imported set.
- **Admin-gated** — same admin auth as existing `app/api/admin/*` routes.
- **Preview grounded in real data** — the builder's output is diffable against `scripts/output/ytg_products.json` examples before we ever write.

## 11. Testing & verification

1. **Unit:** `productFromCard` against real card→product pairs extracted from the YTG dump (given card X + a price + an image URL, produce YTG's actual title/tags/handle shape with the media + price fields set).
2. **Dry-run** a real set; eyeball the preview table end to end — image thumbnails resolve, prices editable, planned actions correct.
3. **Dev store** (optional but recommended): run a small set as drafts against a Shopify development store before touching production — confirm images process to `READY` and prices attach.
4. **Live small-set trial:** import one small set as drafts → verify in Shopify admin that each product has the right image + entered price → reconcile → confirm prices appear in the deck builder.

## 12. Dependencies / open questions

- **`write_products` scope** on YTG's custom app (config change on YTG's side); also covers product media.
- **Brigade→color-name map** for tags (source it from existing deck-builder brigade colors, or define once).
- **Card image coverage** — a new set's images must be synced to Blob (`/api/sync-card-images`) before/at import; the preview flags any card with no resolvable image. Confirm timing so a fresh set's art is present when YTG imports.
- **Title parenthetical per set** — default to set abbrev; confirm which sets need rarity/variant qualifiers (reverse-engineer from the dump; flag exceptions in preview).
- **Rotation/grouping tags** — confirm which grouping tags (e.g. `Rotation Cards`) YTG wants on a new set.
- **Default price** — optional set-level default used for blank rows; confirm whether YTG wants one (e.g. by common rarity) or prefers to fill every price explicitly.

## 13. Phasing

1. Ledger migration + `productFromCard` builder (price + image params) + unit tests (no network).
2. `admin-write.ts` (`productSet` with media + throttling) + `importSet` orchestrator + dry-run/preview API.
3. Admin UI: preview table with image thumbnails, editable prices + bulk helpers, Draft/Active toggle → execute → results.
4. Reconcile hook + live small-set trial (verify image + price landed).
5. Optional: CSV export adapter.
