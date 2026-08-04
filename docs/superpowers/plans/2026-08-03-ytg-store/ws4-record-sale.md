# WS-4: Record Sale — Crash-Safe Deck-Sale Inventory Decrements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task-by-task with review checkpoints. Read `docs/superpowers/plans/2026-08-03-ytg-store/00-overview.md` first (shared contracts), then the spec `docs/superpowers/specs/2026-08-03-ytg-store-admin-design.md` §Record sale **plus the Addendum 2026-08-04** — they are the behavioral authority for everything below.

**Goal:** "Record sale" on a linked deck product: live-inventory preview of every mapped single (deck zones `main`+`reserve` summed per card_key), snapshot confirm into the `ytg_deck_sales`/`ytg_deck_sale_items` ledger, a crash-safe apply loop built on Shopify 2026-04's mandatory `@idempotent(key:)` directive + `changeFromQuantity` compare-and-swap, a resume oracle for interrupted applies, per-row retry, single-shot undo, and a sales-history section. Fully buildable and testable in dry-run (`YTG_INVENTORY_WRITES` unset) before the `write_inventory` scope exists.

**Architecture:** A gate-aware Shopify inventory client (`lib/shopify/inventory.ts`, pinned 2026-07 mutation strings) and a PURE state machine + apply/undo planner (`lib/ytg/saleStateMachine.ts`) carry all the correctness logic under exhaustive unit tests; permission-checked server actions in `app/admin/ytg/decks/saleActions.ts` are thin executors that read/write the ledger and call the client. UI extends WS-3's Decks tab least-invasively: a `/admin/ytg/decks/[productId]/sale` route page (mirroring the wizard's route-page structure), one "Record sale" link on linked rows, and a history section under the product list.

**Tech stack:** Next.js 15 App Router, React 19, TS (`strict:false` — narrow unions with explicit `=== false`), Supabase service-role via `lib/pricing/supabase-admin`, Shopify GraphQL Admin **2026-07** via `lib/shopify/admin-write.ts` `shopifyGraphQL` + REST **2024-01** reads via `lib/pricing/shopify.ts`, Tailwind + shadcn/ui, vitest.

## Global constraints

All of overview §Global constraints, plus:

- **Branch:** `feat/ytg-record-sale`. **Worktree:** `/Users/timestes/projects/rtt-ytg-sale` — create it yourself, do ALL work inside it with absolute paths, `git add` only your specific files, PR bases `origin/main`.
- **MIGRATIONS ALREADY APPLIED — never run DDL.** Migrations 088 AND 089 are applied to prod; `ytg_deck_links`/`ytg_deck_sales`/`ytg_deck_sale_items` exist with exactly the shapes in `supabase/migrations/089_ytg_deck_links_and_sales.sql`. This workstream ships **zero** migration files and runs **no** `apply_migration`/`execute_sql` DDL. (Read-only SQL inspection belongs to the primary session's manual checklist, Task 10.)
- **`YTG_INVENTORY_WRITES` stays UNSET in all dev/test.** Real inventory writes happen only via the post-scope-grant manual checklist (Task 10), from the deployed environment, after Andy approves the `write_inventory` app version. `SHOPIFY_WRITE_MOCK=1` additionally short-circuits (existing convention). Reads (`fetchProductInventory`, `locations`, `nodes`) are **never** gated — preview always shows real numbers.
- **#287-merged assumption:** this plan assumes PR #287 (`feat/ytg-deck-reserve-zone` — `ResolvedEntry.zone`, `lib/ytg/deckZones.ts`, main-only `card_count`) **is merged to main**. Task 1 verifies it; if it has not merged yet, pause and report — the executor rebases after it lands. Nothing in WS-4 modifies #287's files; the dependency is behavioral (reserve rows exist in `deck_cards`, and preview must read `zone IN ('main','reserve')`).
- **2026-04 breaking changes are law:** every inventory mutation carries `@idempotent(key:)` (placed after the field arguments, before the selection set — verified against shopify.dev 2026-07 docs during planning; final strings pinned in Task 3); every `InventoryChangeInput` carries `changeFromQuantity` (we always pass the live pre-quantity; `null` opt-out exists in the type but the sale path never uses it).
- **WS-3 compatibility is a hard contract:** the replace-guard reads `ytg_deck_sales WHERE status IN ('pending','applying')` and errors with `"a sale is being recorded for this product"` — confirm/claim must keep every in-flight sale inside those two statuses and every settled sale outside them.
- **Do not touch** `app/admin/ytg/layout.tsx`, `app/admin/ytg/components/*`, other tabs' directories, `lib/ytg/deckLinkOps.ts`, `lib/ytg/deckZones.ts`, `lib/ytg/deckContentsParser.ts`, or `app/admin/ytg/decks/actions.ts`. WS-4 owns only the files listed in tasks below (the only shared-file edits are the two-line `matching.ts` helper extraction, one link in `DeckProductList.tsx`, and the history section in `decks/page.tsx`).
- **Permission key** `manage_shopify_imports` re-checked inside every server action.
- Tests: `npx vitest run <path>`; full run `npm test`. Type gate: `npx tsc --noEmit` — **baseline has 7 pre-existing errors** confined to `__tests__/forge-anon-leak.test.ts` and `app/forge/lib/__tests__/playDecksAuthorize.test.ts`; the gate is **zero NEW errors** (Task 11 shows the exact filter command). Never `next build` while a dev server runs.
- Design: `prompt_context/design_system.md` — data-dense, mobile-first, no `focus:ring-2`, green accent reserved for live/CTA states. No emojis in UI copy.

## Interfaces consumed (verified on main)

- `shopifyGraphQL<T>(token: string, query: string, variables: Record<string, unknown>, fetchImpl?: typeof fetch): Promise<T>` — `lib/shopify/admin-write.ts` (THROTTLED retries built in; GraphQL `errors` become thrown `Error` with joined messages — this is how `ACCESS_DENIED` surfaces).
- `getShopifyAccessToken(): Promise<string>` and `fetchProductInventory(token: string, productIds: string[]): Promise<Map<string, { variantId: string; inventory: number; tracked: boolean; continuesSelling: boolean }>>` — `lib/pricing/shopify.ts` (~L107; keys are REST numeric product-id strings; `tracked` = `inventory_management === 'shopify'`).
- `getSupabaseAdmin(): any` — `lib/pricing/supabase-admin.ts`; `hasPermission(permission: string): Promise<boolean>` — `utils/adminUtils.ts`; `createClient()` — `utils/supabase/server` (acting-admin id for `created_by`/`undone_by`).
- `getCardImageUrl(imgFile: string)` — `app/shared/utils/cardImageUrl.ts`.
- Ledger tables per `supabase/migrations/089_ytg_deck_links_and_sales.sql` (verbatim shapes; items PK `(sale_id, card_key)`; partial unique index `idx_ytg_deck_sales_active_per_product`).
- Confirmed-mapping statuses are exactly `('auto_matched','manual')` — **no `'matched'` status exists** in `card_price_mappings`.
- card_key construction: `` `${name}|${set}|${imgFile}` `` — built inline at `lib/pricing/matching.ts:47` (`loadCardData`); **no importable helper exists**, so Task 2 extracts one there and re-uses it (per-instruction: extract only because none is importable).
- `deck_cards`: `card_name, card_set, card_img_file, quantity, zone` with `zone IN ('main','reserve','maybeboard')`, UNIQUE `(deck_id, card_name, card_set, zone)`. `decks.updated_at` maintained by BEFORE UPDATE trigger (001).
- `profiles(id, username)` — history "who" display.

## Interfaces produced

- `lib/pricing/matching.ts`: `export function buildCardKey(name: string, set: string, imgFile: string): string`.
- `lib/shopify/inventory.ts` and `lib/ytg/saleStateMachine.ts`: exact signatures in Tasks 3–5.
- `app/admin/ytg/decks/saleActions.ts`: exact signatures in Tasks 6–7.

## Shopify API contract (verified 2026-08-04 against shopify.dev, API 2026-07)

- `@idempotent(key: String!)` is **required** on `inventoryAdjustQuantities` and `inventoryActivate` since 2026-04, placed **after the field's arguments, before the selection set**: `inventoryAdjustQuantities(input: $input) @idempotent(key: $key) { … }`.
- `InventoryAdjustQuantitiesInput`: `reason`, `name`, `changes: [{ inventoryItemId, locationId, delta, changeFromQuantity }]`. Relevant `InventoryAdjustQuantitiesUserErrorCode` values (confirmed in the enum): `ITEM_NOT_STOCKED_AT_LOCATION`, `CHANGE_FROM_QUANTITY_STALE`, `IDEMPOTENCY_KEY_PARAMETER_MISMATCH`, `IDEMPOTENCY_PREVIOUS_ATTEMPT_FAILED`, `IDEMPOTENCY_CONCURRENT_REQUEST`.
- **Key protocol consequence:** Shopify rejects reusing a key with a *different* payload (`IDEMPOTENCY_KEY_PARAMETER_MISMATCH`). The spec's base keys (`sale:<id>:batch:<n>`, `undo:<id>:batch:<n>`, `sale:<id>:activate:<itemId>`) therefore get a deterministic **payload fingerprint suffix** appended by `idempotencyKey(base, changes)`: identical payload ⇒ identical key (crash-resume/two-tab dedup, exactly the spec's "reused verbatim on any retry/resume of that batch" intent), pruned-after-known-failure payload ⇒ new key (which is *required*, since the mutation is atomic and a pruned retry is a different request). This is an implementation detail of the spec's protocol, not a departure from it; `changeFromQuantity` CAS remains the correctness backstop in every degraded path.
- The mutation is atomic: any change-level userError fails the whole call — the executor prunes offending changes and re-runs the remainder (new fingerprint ⇒ new key), bounded passes.

---

### Task 1: Worktree setup + preconditions

**Files:** none created — environment only.

- [ ] Create the worktree and install deps:
  ```bash
  cd /Users/timestes/projects/redemption-tournament-tracker
  git fetch origin
  git worktree add ../rtt-ytg-sale -b feat/ytg-record-sale origin/main
  cd /Users/timestes/projects/rtt-ytg-sale
  npm install
  ```
- [ ] Verify WS-3 artifacts exist (hard prerequisite):
  ```bash
  ls /Users/timestes/projects/rtt-ytg-sale/app/admin/ytg/decks/actions.ts
  ls /Users/timestes/projects/rtt-ytg-sale/lib/ytg/deckLinkOps.ts
  grep -n "YTG_ACCOUNT_USER_ID" /Users/timestes/projects/rtt-ytg-sale/lib/ytg/constants.ts
  grep -n "a sale is being recorded for this product" /Users/timestes/projects/rtt-ytg-sale/lib/ytg/deckLinkOps.ts
  ls /Users/timestes/projects/rtt-ytg-sale/supabase/migrations/089_ytg_deck_links_and_sales.sql
  ```
  All five must succeed. **If any fails, STOP and report.**
- [ ] Verify the **#287-merged assumption**:
  ```bash
  git -C /Users/timestes/projects/rtt-ytg-sale log --oneline origin/main | grep -i "zone='reserve'"
  ls /Users/timestes/projects/rtt-ytg-sale/lib/ytg/deckZones.ts
  ```
  Expect the commit `feat(ytg): import Reserve-section lines as zone='reserve' in the deck-contents wizard` and the file. **If absent, PR #287 has not merged: STOP and report so the primary session merges it first, then re-create the worktree from fresh `origin/main`.**
- [ ] Confirm the env posture: `YTG_INVENTORY_WRITES` must NOT appear in `.env.local`:
  ```bash
  grep -c "YTG_INVENTORY_WRITES" /Users/timestes/projects/rtt-ytg-sale/.env.local || echo "OK: unset"
  ```
- [ ] Baseline: `npm test` passes; record the tsc baseline (expect exactly 7 errors, only in the two known files):
  ```bash
  npx tsc --noEmit 2>&1 | grep "error TS" | sed 's/(.*//' | sort | uniq -c
  ```

---

### Task 2: Extract the card_key builder

**Files:**
- Modify: `lib/pricing/matching.ts` (two-line change)

**Interfaces produced:** `buildCardKey(name, set, imgFile): string`.

The sale preview must construct card_keys byte-identically to the matcher (`` `${c.name}|${c.set}|${c.imgFile}` ``, `matching.ts:47`). No importable helper exists, so extract one and make `loadCardData` consume it — importer/matcher/sale can no longer drift.

- [ ] In `lib/pricing/matching.ts`, directly above `loadCardData` (around line 32), add:
  ```ts
  /**
   * Canonical card_key used across card_price_mappings, card_prices, and the
   * WS-4 sale ledger. Single source of truth — do not string-build elsewhere.
   */
  export function buildCardKey(name: string, set: string, imgFile: string): string {
    return `${name}|${set}|${imgFile}`;
  }
  ```
- [ ] Change line 47 from `card_key: \`${c.name}|${c.set}|${c.imgFile}\`,` to:
  ```ts
    card_key: buildCardKey(c.name, c.set, c.imgFile),
  ```
- [ ] Verify nothing regressed:
  ```bash
  npx vitest run lib/pricing
  npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "forge-anon-leak.test.ts" | grep -v "playDecksAuthorize.test.ts" ; echo "exit=$? (1 means clean)"
  ```
- [ ] Commit:
  ```bash
  git add lib/pricing/matching.ts
  git commit -m "refactor(pricing): extract buildCardKey — single source for the card_key format

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 3: Shopify inventory client (TDD)

**Files:**
- Create: `lib/shopify/inventory.ts`
- Test: `lib/shopify/inventory.test.ts` (co-located, same as `admin-write.test.ts`)

**Interfaces produced:**
```ts
export interface InventoryUserError { field: string[] | null; message: string; code: string | null }
export interface InventoryChange { inventoryItemId: string; delta: number; changeFromQuantity: number | null }
export interface AdjustOutcome { mock: boolean; userErrors: InventoryUserError[] }
export function inventoryWritesEnabled(): boolean
export function payloadFingerprint(changes: InventoryChange[]): string
export function idempotencyKey(base: string, changes: InventoryChange[]): string
export async function getSingleLocationId(token: string): Promise<string>
export async function getInventoryItemIds(token: string, variantGids: string[]): Promise<Map<string, string>>
export async function adjustAvailable(token: string, args: { idempotencyKey: string; locationId: string; changes: InventoryChange[] }): Promise<AdjustOutcome>
export async function activateItem(token: string, args: { idempotencyKey: string; inventoryItemId: string; locationId: string }): Promise<AdjustOutcome>
export function isNotStockedError(e: InventoryUserError): boolean
export function isStaleCasError(e: InventoryUserError): boolean
export function changeIndexOf(e: InventoryUserError): number | null
export const ADJUST_MUTATION: string
export const ACTIVATE_MUTATION: string
```

**Interfaces consumed:** `shopifyGraphQL` (`./admin-write`).

- [ ] Write the failing test `lib/shopify/inventory.test.ts`:
  ```ts
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

  const { shopifyGraphQLMock } = vi.hoisted(() => ({ shopifyGraphQLMock: vi.fn() }));
  vi.mock('./admin-write', () => ({ shopifyGraphQL: shopifyGraphQLMock }));

  import {
    inventoryWritesEnabled, payloadFingerprint, idempotencyKey,
    getSingleLocationId, getInventoryItemIds, adjustAvailable, activateItem,
    isNotStockedError, isStaleCasError, changeIndexOf,
    type InventoryChange,
  } from './inventory';

  const CH = (item: string, delta: number, from: number | null): InventoryChange =>
    ({ inventoryItemId: item, delta, changeFromQuantity: from });

  beforeEach(() => {
    shopifyGraphQLMock.mockReset();
    vi.stubEnv('YTG_INVENTORY_WRITES', '1');
    vi.stubEnv('SHOPIFY_WRITE_MOCK', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  describe('write gating', () => {
    it('is disabled when YTG_INVENTORY_WRITES is not "1"', () => {
      vi.stubEnv('YTG_INVENTORY_WRITES', '');
      expect(inventoryWritesEnabled()).toBe(false);
    });
    it('is disabled when SHOPIFY_WRITE_MOCK=1 even with writes on', () => {
      vi.stubEnv('SHOPIFY_WRITE_MOCK', '1');
      expect(inventoryWritesEnabled()).toBe(false);
    });
    it('mutations short-circuit to fabricated mock success without calling Shopify', async () => {
      vi.stubEnv('YTG_INVENTORY_WRITES', '');
      const out = await adjustAvailable('tok', {
        idempotencyKey: 'sale:S:batch:0:abc', locationId: 'gid://shopify/Location/1',
        changes: [CH('gid://shopify/InventoryItem/1', -3, 10)],
      });
      expect(out).toEqual({ mock: true, userErrors: [] });
      const act = await activateItem('tok', {
        idempotencyKey: 'sale:S:activate:1', inventoryItemId: 'gid://shopify/InventoryItem/1',
        locationId: 'gid://shopify/Location/1',
      });
      expect(act).toEqual({ mock: true, userErrors: [] });
      expect(shopifyGraphQLMock).not.toHaveBeenCalled();
    });
    it('reads are never gated', async () => {
      vi.stubEnv('YTG_INVENTORY_WRITES', '');
      shopifyGraphQLMock.mockResolvedValue({
        locations: { nodes: [{ id: 'gid://shopify/Location/1', name: 'HQ', isActive: true }] },
      });
      expect(await getSingleLocationId('tok')).toBe('gid://shopify/Location/1');
      expect(shopifyGraphQLMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('idempotency keys', () => {
    it('fingerprint is order-independent and payload-sensitive', () => {
      const a = [CH('i1', -2, 5), CH('i2', -1, 3)];
      const b = [CH('i2', -1, 3), CH('i1', -2, 5)];
      expect(payloadFingerprint(a)).toBe(payloadFingerprint(b));
      expect(payloadFingerprint([CH('i1', -2, 5)])).not.toBe(payloadFingerprint(a));
      expect(payloadFingerprint([CH('i1', -2, 6)])).not.toBe(payloadFingerprint([CH('i1', -2, 5)]));
    });
    it('key = spec base + 8-hex fingerprint', () => {
      const key = idempotencyKey('sale:S1:batch:0', [CH('i1', -2, 5)]);
      expect(key).toMatch(/^sale:S1:batch:0:[0-9a-f]{8}$/);
      expect(idempotencyKey('sale:S1:batch:0', [CH('i1', -2, 5)])).toBe(key); // deterministic
    });
  });

  describe('getSingleLocationId', () => {
    it('returns the single active location', async () => {
      shopifyGraphQLMock.mockResolvedValue({
        locations: { nodes: [
          { id: 'gid://shopify/Location/9', name: 'Old', isActive: false },
          { id: 'gid://shopify/Location/1', name: 'HQ', isActive: true },
        ] },
      });
      expect(await getSingleLocationId('tok')).toBe('gid://shopify/Location/1');
      expect(shopifyGraphQLMock.mock.calls[0][1]).toContain('locations(first: 5)');
    });
    it('throws loudly on zero or multiple active locations', async () => {
      shopifyGraphQLMock.mockResolvedValue({ locations: { nodes: [
        { id: 'a', name: 'A', isActive: true }, { id: 'b', name: 'B', isActive: true },
      ] } });
      await expect(getSingleLocationId('tok')).rejects.toThrow(/exactly one active/);
      shopifyGraphQLMock.mockResolvedValue({ locations: { nodes: [] } });
      await expect(getSingleLocationId('tok')).rejects.toThrow(/exactly one active/);
    });
  });

  describe('getInventoryItemIds', () => {
    it('maps variant gid → inventoryItem gid, skipping null nodes', async () => {
      shopifyGraphQLMock.mockResolvedValue({ nodes: [
        { id: 'gid://shopify/ProductVariant/1', inventoryItem: { id: 'gid://shopify/InventoryItem/11' } },
        null,
        { id: 'gid://shopify/ProductVariant/2', inventoryItem: null },
      ] });
      const map = await getInventoryItemIds('tok', ['gid://shopify/ProductVariant/1', 'gid://shopify/ProductVariant/2', 'gid://shopify/ProductVariant/3']);
      expect(map.get('gid://shopify/ProductVariant/1')).toBe('gid://shopify/InventoryItem/11');
      expect(map.size).toBe(1);
    });
    it('chunks at 250 ids per query', async () => {
      shopifyGraphQLMock.mockResolvedValue({ nodes: [] });
      await getInventoryItemIds('tok', Array.from({ length: 501 }, (_, i) => `gid://shopify/ProductVariant/${i}`));
      expect(shopifyGraphQLMock).toHaveBeenCalledTimes(3);
      expect((shopifyGraphQLMock.mock.calls[0][2] as { ids: string[] }).ids).toHaveLength(250);
      expect((shopifyGraphQLMock.mock.calls[2][2] as { ids: string[] }).ids).toHaveLength(1);
    });
  });

  describe('adjustAvailable mutation construction', () => {
    it('carries the @idempotent directive after the field args, CAS numbers, and explicit null opt-outs', async () => {
      shopifyGraphQLMock.mockResolvedValue({
        inventoryAdjustQuantities: { inventoryAdjustmentGroup: { reason: 'correction' }, userErrors: [] },
      });
      const out = await adjustAvailable('tok', {
        idempotencyKey: 'sale:S1:batch:0:deadbeef',
        locationId: 'gid://shopify/Location/1',
        changes: [CH('gid://shopify/InventoryItem/11', -3, 10), CH('gid://shopify/InventoryItem/12', -1, null)],
      });
      expect(out.mock).toBe(false);
      expect(out.userErrors).toEqual([]);
      const [, query, vars] = shopifyGraphQLMock.mock.calls[0];
      expect(query).toContain('inventoryAdjustQuantities(input: $input) @idempotent(key: $key)');
      expect(query).toContain('userErrors { field message code }');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input = (vars as any).input;
      expect((vars as { key: string }).key).toBe('sale:S1:batch:0:deadbeef');
      expect(input.reason).toBe('correction');
      expect(input.name).toBe('available');
      expect(input.changes[0]).toEqual({
        inventoryItemId: 'gid://shopify/InventoryItem/11',
        locationId: 'gid://shopify/Location/1', delta: -3, changeFromQuantity: 10,
      });
      // 2026-04: changeFromQuantity must be PRESENT even when opting out (explicit null)
      expect(Object.prototype.hasOwnProperty.call(input.changes[1], 'changeFromQuantity')).toBe(true);
      expect(input.changes[1].changeFromQuantity).toBeNull();
    });
    it('returns userErrors verbatim', async () => {
      shopifyGraphQLMock.mockResolvedValue({
        inventoryAdjustQuantities: { inventoryAdjustmentGroup: null, userErrors: [
          { field: ['input', 'changes', '0', 'changeFromQuantity'], message: 'stale', code: 'CHANGE_FROM_QUANTITY_STALE' },
        ] },
      });
      const out = await adjustAvailable('tok', {
        idempotencyKey: 'k', locationId: 'l', changes: [CH('i', -1, 4)],
      });
      expect(out.userErrors[0].code).toBe('CHANGE_FROM_QUANTITY_STALE');
    });
  });

  describe('activateItem mutation construction', () => {
    it('activates with available: 0 and the @idempotent directive', async () => {
      shopifyGraphQLMock.mockResolvedValue({
        inventoryActivate: { inventoryLevel: { id: 'gid://shopify/InventoryLevel/1' }, userErrors: [] },
      });
      const out = await activateItem('tok', {
        idempotencyKey: 'sale:S1:activate:gid://shopify/InventoryItem/11',
        inventoryItemId: 'gid://shopify/InventoryItem/11', locationId: 'gid://shopify/Location/1',
      });
      expect(out.mock).toBe(false);
      const [, query, vars] = shopifyGraphQLMock.mock.calls[0];
      expect(query).toContain('inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) @idempotent(key: $key)');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((vars as any).available).toBe(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((vars as any).key).toBe('sale:S1:activate:gid://shopify/InventoryItem/11');
    });
  });

  describe('error classifiers', () => {
    it('isNotStockedError by code and by message', () => {
      expect(isNotStockedError({ field: null, message: 'x', code: 'ITEM_NOT_STOCKED_AT_LOCATION' })).toBe(true);
      expect(isNotStockedError({ field: null, message: 'The inventory item is not stocked at the location', code: null })).toBe(true);
      expect(isNotStockedError({ field: null, message: 'other', code: 'INVALID_REASON' })).toBe(false);
    });
    it('isStaleCasError by code and by message', () => {
      expect(isStaleCasError({ field: null, message: 'x', code: 'CHANGE_FROM_QUANTITY_STALE' })).toBe(true);
      expect(isStaleCasError({ field: null, message: 'The changeFromQuantity argument no longer matches', code: null })).toBe(true);
      expect(isStaleCasError({ field: null, message: 'other', code: null })).toBe(false);
    });
    it('changeIndexOf parses the numeric path segment', () => {
      expect(changeIndexOf({ field: ['input', 'changes', '3', 'delta'], message: '', code: null })).toBe(3);
      expect(changeIndexOf({ field: ['input', 'reason'], message: '', code: null })).toBeNull();
      expect(changeIndexOf({ field: null, message: '', code: null })).toBeNull();
    });
  });
  ```
- [ ] Run and watch it fail: `npx vitest run lib/shopify/inventory.test.ts` — expected FAIL (module does not exist).
- [ ] Create `lib/shopify/inventory.ts`:
  ```ts
  /**
   * Shopify inventory client for WS-4 record-sale (GraphQL Admin 2026-07 via
   * shopifyGraphQL — THROTTLED retries inherited).
   *
   * 2026-04 breaking changes (overview §Global constraints) are load-bearing:
   * - every inventory mutation carries @idempotent(key:), placed after the
   *   field arguments, before the selection set (verified on shopify.dev);
   * - every InventoryChangeInput carries changeFromQuantity — the sale path
   *   always passes the live pre-quantity as a compare-and-swap anchor
   *   (explicit null opt-out exists in the type; never used by sales).
   *
   * Write gating (spec §Record sale prerequisite): mutations short-circuit to
   * fabricated success tagged { mock: true } unless YTG_INVENTORY_WRITES=1 AND
   * SHOPIFY_WRITE_MOCK≠1. Reads are never gated.
   */
  import { shopifyGraphQL } from './admin-write';

  export interface InventoryUserError {
    field: string[] | null;
    message: string;
    code: string | null;
  }

  export interface InventoryChange {
    inventoryItemId: string;           // gid://shopify/InventoryItem/…
    delta: number;
    changeFromQuantity: number | null; // null = CAS opt-out (sale path never opts out)
  }

  export interface AdjustOutcome {
    mock: boolean;
    userErrors: InventoryUserError[];
  }

  export function inventoryWritesEnabled(): boolean {
    return process.env.YTG_INVENTORY_WRITES === '1' && process.env.SHOPIFY_WRITE_MOCK !== '1';
  }

  /** FNV-1a 32-bit over the canonicalized change list — order-independent. */
  export function payloadFingerprint(changes: InventoryChange[]): string {
    const canon = changes
      .map((c) => `${c.inventoryItemId}:${c.delta}:${c.changeFromQuantity}`)
      .sort()
      .join('|');
    let h = 0x811c9dc5;
    for (let i = 0; i < canon.length; i++) {
      h ^= canon.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  /**
   * Spec base key (`sale:<id>:batch:<n>` / `undo:<id>:batch:<n>`) + payload
   * fingerprint. Identical payload ⇒ identical key, so crash-resume and
   * two-tab races dedupe server-side (the spec's intent); a pruned/changed
   * payload ⇒ new key, which Shopify requires (reusing a key with different
   * parameters is IDEMPOTENCY_KEY_PARAMETER_MISMATCH).
   */
  export function idempotencyKey(base: string, changes: InventoryChange[]): string {
    return `${base}:${payloadFingerprint(changes)}`;
  }

  const LOCATIONS_QUERY = `
  query ytgLocations {
    locations(first: 5) {
      nodes { id name isActive }
    }
  }
  `;

  /** Single-location assumption is asserted, never assumed (spec §API contract). */
  export async function getSingleLocationId(token: string): Promise<string> {
    const data = await shopifyGraphQL<{
      locations: { nodes: { id: string; name: string; isActive: boolean }[] };
    }>(token, LOCATIONS_QUERY, {});
    const active = (data.locations?.nodes ?? []).filter((n) => n.isActive);
    if (active.length !== 1) {
      throw new Error(
        `expected exactly one active Shopify location, found ${active.length}`
        + ` (${active.map((n) => n.name).join(', ') || 'none'}) — refusing to guess`,
      );
    }
    return active[0].id;
  }

  const VARIANT_ITEMS_QUERY = `
  query ytgVariantItems($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant { id inventoryItem { id } }
    }
  }
  `;

  /** variant GID → inventoryItem GID, chunked ≤250 ids/query. Missing/null nodes are simply absent. */
  export async function getInventoryItemIds(
    token: string,
    variantGids: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < variantGids.length; i += 250) {
      const chunk = variantGids.slice(i, i + 250);
      const data = await shopifyGraphQL<{
        nodes: ({ id: string; inventoryItem: { id: string } | null } | null)[];
      }>(token, VARIANT_ITEMS_QUERY, { ids: chunk });
      for (const node of data.nodes ?? []) {
        if (node && node.inventoryItem) out.set(node.id, node.inventoryItem.id);
      }
    }
    return out;
  }

  // Pinned mutation strings — directive placement verified against shopify.dev
  // (2026-07): after the field arguments, before the selection set.
  export const ADJUST_MUTATION = `
  mutation ytgInventoryAdjust($input: InventoryAdjustQuantitiesInput!, $key: String!) {
    inventoryAdjustQuantities(input: $input) @idempotent(key: $key) {
      inventoryAdjustmentGroup { reason }
      userErrors { field message code }
    }
  }
  `;

  export const ACTIVATE_MUTATION = `
  mutation ytgInventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int, $key: String!) {
    inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) @idempotent(key: $key) {
      inventoryLevel { id }
      userErrors { field message }
    }
  }
  `;

  export async function adjustAvailable(
    token: string,
    args: { idempotencyKey: string; locationId: string; changes: InventoryChange[] },
  ): Promise<AdjustOutcome> {
    if (!inventoryWritesEnabled()) return { mock: true, userErrors: [] };
    const data = await shopifyGraphQL<{
      inventoryAdjustQuantities: {
        inventoryAdjustmentGroup: { reason: string } | null;
        userErrors: InventoryUserError[];
      };
    }>(token, ADJUST_MUTATION, {
      key: args.idempotencyKey,
      input: {
        reason: 'correction',
        name: 'available',
        changes: args.changes.map((c) => ({
          inventoryItemId: c.inventoryItemId,
          locationId: args.locationId,
          delta: c.delta,
          changeFromQuantity: c.changeFromQuantity,
        })),
      },
    });
    return { mock: false, userErrors: data.inventoryAdjustQuantities?.userErrors ?? [] };
  }

  /** ITEM_NOT_STOCKED_AT_LOCATION remedy — activate tracked-at-zero (spec §API contract). */
  export async function activateItem(
    token: string,
    args: { idempotencyKey: string; inventoryItemId: string; locationId: string },
  ): Promise<AdjustOutcome> {
    if (!inventoryWritesEnabled()) return { mock: true, userErrors: [] };
    const data = await shopifyGraphQL<{
      inventoryActivate: {
        inventoryLevel: { id: string } | null;
        userErrors: { field: string[] | null; message: string }[];
      };
    }>(token, ACTIVATE_MUTATION, {
      key: args.idempotencyKey,
      inventoryItemId: args.inventoryItemId,
      locationId: args.locationId,
      available: 0,
    });
    return {
      mock: false,
      userErrors: (data.inventoryActivate?.userErrors ?? []).map((e) => ({
        field: e.field, message: e.message, code: null,
      })),
    };
  }

  export function isNotStockedError(e: InventoryUserError): boolean {
    return e.code === 'ITEM_NOT_STOCKED_AT_LOCATION'
      || /not stocked at the location/i.test(e.message);
  }

  export function isStaleCasError(e: InventoryUserError): boolean {
    return e.code === 'CHANGE_FROM_QUANTITY_STALE'
      || /changeFromQuantity/i.test(e.message);
  }

  /** userError field path → change index (['input','changes','3',…] → 3), else null. */
  export function changeIndexOf(e: InventoryUserError): number | null {
    for (const part of e.field ?? []) {
      if (/^\d+$/.test(part)) return Number(part);
    }
    return null;
  }
  ```
- [ ] `npx vitest run lib/shopify/inventory.test.ts` — expected PASS (all tests).
- [ ] `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "forge-anon-leak.test.ts" | grep -v "playDecksAuthorize.test.ts"` — expect no output.
- [ ] Commit:
  ```bash
  git add lib/shopify/inventory.ts lib/shopify/inventory.test.ts
  git commit -m "feat(ytg): Shopify inventory client — idempotent CAS adjust/activate, single-location assert (WS-4)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 4: Sale state machine — classify, derive, oracle (TDD, exhaustive)

**Files:**
- Create: `lib/ytg/saleStateMachine.ts`
- Test: `lib/ytg/__tests__/saleStateMachine.test.ts`

**Interfaces produced:**
```ts
export type SaleStatus = 'pending'|'applying'|'applied'|'partial'|'failed'|'dry_run'|'undoing'|'undone'|'undo_partial'
export type ItemStatus = 'pending'|'applying'|'applied'|'skipped_unmapped'|'skipped_untracked'|'error'|'conflict'|'undone'|'undo_conflict'
export type PreviewFlag = 'ok'|'unmapped'|'untracked'|'would_go_negative'
export function classifyPreviewRow(row: { mapped: boolean; tracked: boolean; qtyAfter: number | null }): PreviewFlag
export function adjustableItems<T extends { status: ItemStatus }>(items: T[]): T[]
export function deriveSaleStatus(items: { status: ItemStatus }[]): 'applied'|'partial'|'failed'
export function deriveUndoStatus(items: { status: ItemStatus }[]): 'undone'|'undo_partial'
export type ResumeVerdict = 'applied'|'reapply'|'conflict'
export function resumeOracle(item: { qtyBefore: number | null; qtyAfter: number | null }, liveQty: number): ResumeVerdict
```

- [ ] Write the failing test `lib/ytg/__tests__/saleStateMachine.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import {
    classifyPreviewRow, adjustableItems, deriveSaleStatus, deriveUndoStatus,
    resumeOracle, type ItemStatus,
  } from "../saleStateMachine";

  const item = (status: ItemStatus) => ({ status });

  describe("classifyPreviewRow — every branch", () => {
    it("unmapped beats everything", () => {
      expect(classifyPreviewRow({ mapped: false, tracked: false, qtyAfter: null })).toBe("unmapped");
      expect(classifyPreviewRow({ mapped: false, tracked: true, qtyAfter: -1 })).toBe("unmapped");
    });
    it("untracked when mapped but inventory_management ≠ shopify", () => {
      expect(classifyPreviewRow({ mapped: true, tracked: false, qtyAfter: null })).toBe("untracked");
    });
    it("would_go_negative when qtyAfter < 0", () => {
      expect(classifyPreviewRow({ mapped: true, tracked: true, qtyAfter: -1 })).toBe("would_go_negative");
    });
    it("ok at exactly zero and above", () => {
      expect(classifyPreviewRow({ mapped: true, tracked: true, qtyAfter: 0 })).toBe("ok");
      expect(classifyPreviewRow({ mapped: true, tracked: true, qtyAfter: 7 })).toBe("ok");
    });
    it("ok when qtyAfter unknown (null) but mapped+tracked", () => {
      expect(classifyPreviewRow({ mapped: true, tracked: true, qtyAfter: null })).toBe("ok");
    });
  });

  describe("adjustableItems", () => {
    it("excludes exactly the snapshot skips", () => {
      const all: ItemStatus[] = ["pending","applying","applied","skipped_unmapped","skipped_untracked","error","conflict","undone","undo_conflict"];
      const kept = adjustableItems(all.map(item)).map((i) => i.status);
      expect(kept).toEqual(["pending","applying","applied","error","conflict","undone","undo_conflict"]);
    });
  });

  describe("deriveSaleStatus — every branch (spec pt. 5)", () => {
    it("all adjustable applied → applied (skips don't count against it)", () => {
      expect(deriveSaleStatus([item("applied"), item("applied"), item("skipped_unmapped"), item("skipped_untracked")])).toBe("applied");
    });
    it("some applied → partial", () => {
      expect(deriveSaleStatus([item("applied"), item("error")])).toBe("partial");
      expect(deriveSaleStatus([item("applied"), item("conflict")])).toBe("partial");
      expect(deriveSaleStatus([item("applied"), item("pending")])).toBe("partial");
    });
    it("none applied → failed (undo offered only on applied/partial, so failed strands nothing)", () => {
      expect(deriveSaleStatus([item("error"), item("conflict")])).toBe("failed");
      expect(deriveSaleStatus([item("skipped_unmapped")])).toBe("failed");
      expect(deriveSaleStatus([])).toBe("failed");
    });
  });

  describe("deriveUndoStatus — every branch (spec pt. 7)", () => {
    it("all reversed → undone", () => {
      expect(deriveUndoStatus([item("undone"), item("undone"), item("skipped_untracked")])).toBe("undone");
    });
    it("any undo_conflict → undo_partial", () => {
      expect(deriveUndoStatus([item("undone"), item("undo_conflict")])).toBe("undo_partial");
    });
    it("any still-applied leftover → undo_partial", () => {
      expect(deriveUndoStatus([item("undone"), item("applied")])).toBe("undo_partial");
    });
  });

  describe("resumeOracle — every branch (spec pt. 4)", () => {
    const anchors = { qtyBefore: 10, qtyAfter: 7 };
    it("live == qty_after → applied (ack-then-crash: never re-adjust)", () => {
      expect(resumeOracle(anchors, 7)).toBe("applied");
    });
    it("live == qty_before → reapply (crash before the call landed)", () => {
      expect(resumeOracle(anchors, 10)).toBe("reapply");
    });
    it("anything else → conflict (third party moved stock)", () => {
      expect(resumeOracle(anchors, 8)).toBe("conflict");
      expect(resumeOracle(anchors, 0)).toBe("conflict");
    });
    it("null anchors can never claim applied/reapply", () => {
      expect(resumeOracle({ qtyBefore: null, qtyAfter: null }, 5)).toBe("conflict");
    });
    it("qty_after checked FIRST (delta is never 0, but ordering is pinned)", () => {
      expect(resumeOracle({ qtyBefore: 7, qtyAfter: 7 }, 7)).toBe("applied");
    });
  });
  ```
- [ ] `npx vitest run lib/ytg/__tests__/saleStateMachine.test.ts` — expected FAIL (module missing).
- [ ] Create `lib/ytg/saleStateMachine.ts`:
  ```ts
  /**
   * PURE sale state machine + apply/undo planner for WS-4 (spec §Record sale).
   * No I/O anywhere in this module — every branch is unit-tested, and the
   * server actions in app/admin/ytg/decks/saleActions.ts are thin executors.
   *
   * Status enums mirror migration 089 exactly.
   */

  export const SALE_STATUSES = [
    "pending", "applying", "applied", "partial", "failed",
    "dry_run", "undoing", "undone", "undo_partial",
  ] as const;
  export type SaleStatus = (typeof SALE_STATUSES)[number];

  export const ITEM_STATUSES = [
    "pending", "applying", "applied", "skipped_unmapped",
    "skipped_untracked", "error", "conflict", "undone", "undo_conflict",
  ] as const;
  export type ItemStatus = (typeof ITEM_STATUSES)[number];

  export type PreviewFlag = "ok" | "unmapped" | "untracked" | "would_go_negative";

  /** Preview flag classes (spec pt. 2). unmapped ≻ untracked ≻ would_go_negative ≻ ok. */
  export function classifyPreviewRow(row: {
    mapped: boolean;    // confirmed mapping (auto_matched|manual) AND product present in the live read
    tracked: boolean;   // variant inventory_management === 'shopify'
    qtyAfter: number | null;
  }): PreviewFlag {
    if (!row.mapped) return "unmapped";
    if (!row.tracked) return "untracked";
    if (row.qtyAfter !== null && row.qtyAfter < 0) return "would_go_negative";
    return "ok";
  }

  /** Items the apply/undo loops may touch — snapshot skips never adjust. */
  export function adjustableItems<T extends { status: ItemStatus }>(items: T[]): T[] {
    return items.filter(
      (i) => i.status !== "skipped_unmapped" && i.status !== "skipped_untracked",
    );
  }

  /** Sale status is DERIVED from items (spec pt. 5). */
  export function deriveSaleStatus(
    items: { status: ItemStatus }[],
  ): "applied" | "partial" | "failed" {
    const adj = adjustableItems(items);
    const applied = adj.filter((i) => i.status === "applied").length;
    if (adj.length > 0 && applied === adj.length) return "applied";
    if (applied > 0) return "partial";
    return "failed";
  }

  /** Undo terminal status (spec pt. 7): all reversed → undone, else undo_partial. */
  export function deriveUndoStatus(
    items: { status: ItemStatus }[],
  ): "undone" | "undo_partial" {
    const touched = adjustableItems(items).filter(
      (i) => i.status === "undone" || i.status === "undo_conflict" || i.status === "applied",
    );
    const undone = touched.filter((i) => i.status === "undone").length;
    return touched.length > 0 && undone === touched.length ? "undone" : "undo_partial";
  }

  export type ResumeVerdict = "applied" | "reapply" | "conflict";

  /**
   * Resume oracle for an item stranded in 'applying' (spec pt. 4):
   *   live == qty_after  → the adjustment landed; mark applied, never re-adjust
   *   live == qty_before → it never landed; re-apply (same payload ⇒ same key)
   *   anything else      → third party moved stock; human resolves.
   */
  export function resumeOracle(
    item: { qtyBefore: number | null; qtyAfter: number | null },
    liveQty: number,
  ): ResumeVerdict {
    if (item.qtyAfter !== null && liveQty === item.qtyAfter) return "applied";
    if (item.qtyBefore !== null && liveQty === item.qtyBefore) return "reapply";
    return "conflict";
  }
  ```
- [ ] `npx vitest run lib/ytg/__tests__/saleStateMachine.test.ts` — expected PASS.
- [ ] Commit:
  ```bash
  git add lib/ytg/saleStateMachine.ts lib/ytg/__tests__/saleStateMachine.test.ts
  git commit -m "feat(ytg): pure sale state machine — preview flags, derived statuses, resume oracle (WS-4)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 5: Apply/undo planner + crash-scenario tests (TDD)

**Files:**
- Modify: `lib/ytg/saleStateMachine.ts` (append planner section)
- Test: `lib/ytg/__tests__/saleApply.test.ts`

**Interfaces produced (appended to `saleStateMachine.ts`):**
```ts
export const MAX_CHANGES_PER_CALL = 250
export interface SaleItemState { cardKey: string; status: ItemStatus; delta: number; qtyBefore: number | null; qtyAfter: number | null; inventoryItemId: string | null }
export interface PlannedChange { cardKey: string; inventoryItemId: string; delta: number; changeFromQuantity: number }
export interface PlannedBatch { n: number; baseKey: string; changes: PlannedChange[] }
export interface ApplyPlan { batches: PlannedBatch[]; unresolvable: string[] }
export function planApply(saleId: string, items: SaleItemState[]): ApplyPlan
export interface ResumePlan { markApplied: string[]; conflicts: string[]; reapply: PlannedBatch[] }
export function planResume(saleId: string, items: SaleItemState[], liveQtyByCardKey: Map<string, number>): ResumePlan
export interface UndoPlan { batches: PlannedBatch[]; unresolvable: string[] }
export function planUndo(saleId: string, items: SaleItemState[]): UndoPlan
```

Design invariant the tests must prove: **batch ordinals are computed from the immutable full adjustable set** (sorted by card_key, first-fit chunked at 250 with duplicate `inventoryItemId`s pushed to later batches), so a resume recomputes identical ordinals from DB state alone, and a full-batch reapply produces the identical payload — hence (via `idempotencyKey`) the identical key.

- [ ] Write the failing test `lib/ytg/__tests__/saleApply.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import {
    planApply, planResume, planUndo, MAX_CHANGES_PER_CALL,
    type SaleItemState, type ItemStatus,
  } from "../saleStateMachine";
  import { idempotencyKey } from "../../shopify/inventory";

  const it_ = (cardKey: string, status: ItemStatus, over: Partial<SaleItemState> = {}): SaleItemState => ({
    cardKey, status, delta: -2, qtyBefore: 10, qtyAfter: 8,
    inventoryItemId: `gid://shopify/InventoryItem/${cardKey}`, ...over,
  });

  describe("planApply", () => {
    it("orders by card_key, includes only pending items, baseKey pinned to spec format", () => {
      const items = [
        it_("b|S|b.jpg", "pending"),
        it_("a|S|a.jpg", "pending"),
        it_("c|S|c.jpg", "skipped_unmapped"),
        it_("d|S|d.jpg", "applied"),
      ];
      const plan = planApply("S1", items);
      expect(plan.unresolvable).toEqual([]);
      expect(plan.batches).toHaveLength(1);
      expect(plan.batches[0].n).toBe(0);
      expect(plan.batches[0].baseKey).toBe("sale:S1:batch:0");
      expect(plan.batches[0].changes.map((c) => c.cardKey)).toEqual(["a|S|a.jpg", "b|S|b.jpg"]);
      expect(plan.batches[0].changes[0]).toEqual({
        cardKey: "a|S|a.jpg", inventoryItemId: "gid://shopify/InventoryItem/a|S|a.jpg",
        delta: -2, changeFromQuantity: 10,
      });
    });
    it("chunks at 250 with stable ordinals", () => {
      const items = Array.from({ length: 501 }, (_, i) =>
        it_(`k${String(i).padStart(4, "0")}|S|x.jpg`, "pending"));
      const plan = planApply("S1", items);
      expect(plan.batches.map((b) => b.n)).toEqual([0, 1, 2]);
      expect(plan.batches[0].changes).toHaveLength(MAX_CHANGES_PER_CALL);
      expect(plan.batches[2].changes).toHaveLength(1);
    });
    it("splits duplicate inventoryItemIds across batches (one change per item per call; sequential CAS anchors)", () => {
      const shared = "gid://shopify/InventoryItem/promo";
      const items = [
        it_("a|S|a.jpg", "pending", { inventoryItemId: shared, qtyBefore: 10, qtyAfter: 8 }),
        it_("b|S|b.jpg", "pending", { inventoryItemId: shared, qtyBefore: 8, qtyAfter: 6 }),
      ];
      const plan = planApply("S1", items);
      expect(plan.batches).toHaveLength(2);
      expect(plan.batches[0].changes.map((c) => c.cardKey)).toEqual(["a|S|a.jpg"]);
      expect(plan.batches[1].changes.map((c) => c.cardKey)).toEqual(["b|S|b.jpg"]);
      expect(plan.batches[1].n).toBe(1);
    });
    it("pending items missing ids/anchors are unresolvable, not silently dropped", () => {
      const plan = planApply("S1", [
        it_("a|S|a.jpg", "pending", { inventoryItemId: null }),
        it_("b|S|b.jpg", "pending", { qtyBefore: null }),
        it_("c|S|c.jpg", "pending"),
      ]);
      expect(plan.unresolvable.sort()).toEqual(["a|S|a.jpg", "b|S|b.jpg"]);
      expect(plan.batches[0].changes.map((c) => c.cardKey)).toEqual(["c|S|c.jpg"]);
    });
  });

  describe("planResume — the three crash scenarios (spec pt. 4)", () => {
    it("ack-then-crash: live == qty_after → marked applied, NO re-adjustment planned", () => {
      const items = [it_("a|S|a.jpg", "applying"), it_("b|S|b.jpg", "applying")];
      const live = new Map([["a|S|a.jpg", 8], ["b|S|b.jpg", 8]]);
      const plan = planResume("S1", items, live);
      expect(plan.markApplied.sort()).toEqual(["a|S|a.jpg", "b|S|b.jpg"]);
      expect(plan.conflicts).toEqual([]);
      expect(plan.reapply).toEqual([]);
    });
    it("crash-before-call: live == qty_before → reapply with the IDENTICAL payload, hence the SAME idempotency key", () => {
      const items = [it_("a|S|a.jpg", "applying"), it_("b|S|b.jpg", "applying")];
      const original = planApply("S1", items.map((i) => ({ ...i, status: "pending" as ItemStatus })));
      const live = new Map([["a|S|a.jpg", 10], ["b|S|b.jpg", 10]]);
      const plan = planResume("S1", items, live);
      expect(plan.markApplied).toEqual([]);
      expect(plan.reapply).toHaveLength(1);
      expect(plan.reapply[0].n).toBe(0);
      // Shopify dedupes because base + fingerprint reproduce byte-identically:
      expect(idempotencyKey(plan.reapply[0].baseKey, plan.reapply[0].changes))
        .toBe(idempotencyKey(original.batches[0].baseKey, original.batches[0].changes));
    });
    it("third-party moved stock: live matches neither anchor → conflict, human resolves", () => {
      const plan = planResume("S1", [it_("a|S|a.jpg", "applying")], new Map([["a|S|a.jpg", 9]]));
      expect(plan.conflicts).toEqual(["a|S|a.jpg"]);
      expect(plan.reapply).toEqual([]);
    });
    it("mixed batch: applied+reapply+conflict+missing-live all classified; reapply subset gets a NEW key (payload differs)", () => {
      const items = [
        it_("a|S|a.jpg", "applying"), // landed
        it_("b|S|b.jpg", "applying"), // not landed
        it_("c|S|c.jpg", "applying"), // moved
        it_("d|S|d.jpg", "applying"), // vanished from live read
        it_("e|S|e.jpg", "pending"),  // untouched by resume
      ];
      const live = new Map([["a|S|a.jpg", 8], ["b|S|b.jpg", 10], ["c|S|c.jpg", 3]]);
      const plan = planResume("S1", items, live);
      expect(plan.markApplied).toEqual(["a|S|a.jpg"]);
      expect(plan.conflicts.sort()).toEqual(["c|S|c.jpg", "d|S|d.jpg"]);
      expect(plan.reapply[0].changes.map((c) => c.cardKey)).toEqual(["b|S|b.jpg"]);
      const original = planApply("S1", items.map((i) => ({ ...i, status: "pending" as ItemStatus })));
      expect(idempotencyKey(plan.reapply[0].baseKey, plan.reapply[0].changes))
        .not.toBe(idempotencyKey(original.batches[0].baseKey, original.batches[0].changes));
    });
  });

  describe("planUndo (spec pt. 7)", () => {
    it("reverses ONLY applied items: +|delta| with changeFromQuantity = qty_after, undo base key", () => {
      const items = [
        it_("a|S|a.jpg", "applied"),
        it_("b|S|b.jpg", "error"),
        it_("c|S|c.jpg", "skipped_untracked"),
        it_("d|S|d.jpg", "conflict"),
      ];
      const plan = planUndo("S9", items);
      expect(plan.batches).toHaveLength(1);
      expect(plan.batches[0].baseKey).toBe("undo:S9:batch:0");
      expect(plan.batches[0].changes).toEqual([{
        cardKey: "a|S|a.jpg", inventoryItemId: "gid://shopify/InventoryItem/a|S|a.jpg",
        delta: 2, changeFromQuantity: 8,
      }]);
    });
    it("ordinals stay stable when earlier items are already undone (crash-resume of undo)", () => {
      const mk = (i: number, status: ItemStatus) =>
        it_(`k${String(i).padStart(4, "0")}|S|x.jpg`, status);
      const items = Array.from({ length: 251 }, (_, i) => mk(i, i < 250 ? "undone" : "applied"));
      const plan = planUndo("S9", items);
      expect(plan.batches).toHaveLength(1);
      expect(plan.batches[0].n).toBe(1); // batch 0 fully undone → skipped, ordinal preserved
      expect(plan.batches[0].changes).toHaveLength(1);
    });
  });
  ```
- [ ] `npx vitest run lib/ytg/__tests__/saleApply.test.ts` — expected FAIL (planner functions missing).
- [ ] Append to `lib/ytg/saleStateMachine.ts`:
  ```ts
  // ─── Apply/undo planner ─────────────────────────────────────────────────────
  // Batch ordinals derive from the IMMUTABLE full adjustable set (sorted by
  // card_key, first-fit chunked, duplicate inventoryItemIds pushed to later
  // batches — one change per item per call, and sequential CAS anchors need
  // ordering). A resume recomputes identical ordinals from DB state alone, so
  // an unchanged payload re-fingerprints to the SAME idempotency key.

  export const MAX_CHANGES_PER_CALL = 250;

  export interface SaleItemState {
    cardKey: string;
    status: ItemStatus;
    delta: number;               // negative on a sale
    qtyBefore: number | null;    // CAS anchors; also the resume oracle
    qtyAfter: number | null;
    inventoryItemId: string | null;
  }

  export interface PlannedChange {
    cardKey: string;
    inventoryItemId: string;
    delta: number;
    changeFromQuantity: number;
  }

  export interface PlannedBatch {
    n: number;        // stable ordinal over the full adjustable set
    baseKey: string;  // spec format; executor appends the payload fingerprint
    changes: PlannedChange[];
  }

  function batchLayout(items: SaleItemState[]): SaleItemState[][] {
    const sorted = adjustableItems(items).slice().sort((a, b) =>
      a.cardKey < b.cardKey ? -1 : a.cardKey > b.cardKey ? 1 : 0);
    const batches: SaleItemState[][] = [];
    for (const item of sorted) {
      let placed = false;
      for (const b of batches) {
        const dup = item.inventoryItemId !== null
          && b.some((x) => x.inventoryItemId === item.inventoryItemId);
        if (b.length < MAX_CHANGES_PER_CALL && !dup) {
          b.push(item);
          placed = true;
          break;
        }
      }
      if (!placed) batches.push([item]);
    }
    return batches;
  }

  export interface ApplyPlan {
    batches: PlannedBatch[];
    unresolvable: string[]; // pending card_keys missing inventoryItemId/anchors
  }

  export function planApply(saleId: string, items: SaleItemState[]): ApplyPlan {
    const batches: PlannedBatch[] = [];
    const unresolvable: string[] = [];
    batchLayout(items).forEach((members, n) => {
      const changes: PlannedChange[] = [];
      for (const m of members) {
        if (m.status !== "pending") continue;
        if (m.inventoryItemId === null || m.qtyBefore === null || m.qtyAfter === null) {
          unresolvable.push(m.cardKey);
          continue;
        }
        changes.push({
          cardKey: m.cardKey, inventoryItemId: m.inventoryItemId,
          delta: m.delta, changeFromQuantity: m.qtyBefore,
        });
      }
      if (changes.length > 0) batches.push({ n, baseKey: `sale:${saleId}:batch:${n}`, changes });
    });
    return { batches, unresolvable };
  }

  export interface ResumePlan {
    markApplied: string[];   // landed — flip to applied, never re-adjust
    conflicts: string[];     // live matches neither anchor (or item unreadable)
    reapply: PlannedBatch[]; // identical payload ⇒ identical key ⇒ server-side dedupe
  }

  export function planResume(
    saleId: string,
    items: SaleItemState[],
    liveQtyByCardKey: Map<string, number>,
  ): ResumePlan {
    const markApplied: string[] = [];
    const conflicts: string[] = [];
    const reapply: PlannedBatch[] = [];
    batchLayout(items).forEach((members, n) => {
      const changes: PlannedChange[] = [];
      for (const m of members) {
        if (m.status !== "applying") continue;
        const live = liveQtyByCardKey.get(m.cardKey);
        if (live === undefined || m.inventoryItemId === null) {
          conflicts.push(m.cardKey);
          continue;
        }
        const verdict = resumeOracle({ qtyBefore: m.qtyBefore, qtyAfter: m.qtyAfter }, live);
        if (verdict === "applied") markApplied.push(m.cardKey);
        else if (verdict === "conflict") conflicts.push(m.cardKey);
        else changes.push({
          cardKey: m.cardKey, inventoryItemId: m.inventoryItemId,
          delta: m.delta, changeFromQuantity: m.qtyBefore as number,
        });
      }
      if (changes.length > 0) reapply.push({ n, baseKey: `sale:${saleId}:batch:${n}`, changes });
    });
    return { markApplied, conflicts, reapply };
  }

  export interface UndoPlan {
    batches: PlannedBatch[];
    unresolvable: string[];
  }

  /** Positive adjustments with changeFromQuantity = qty_after — never blindly stacks stock. */
  export function planUndo(saleId: string, items: SaleItemState[]): UndoPlan {
    const batches: PlannedBatch[] = [];
    const unresolvable: string[] = [];
    batchLayout(items).forEach((members, n) => {
      const changes: PlannedChange[] = [];
      for (const m of members) {
        if (m.status !== "applied") continue;
        if (m.inventoryItemId === null || m.qtyAfter === null) {
          unresolvable.push(m.cardKey);
          continue;
        }
        changes.push({
          cardKey: m.cardKey, inventoryItemId: m.inventoryItemId,
          delta: Math.abs(m.delta), changeFromQuantity: m.qtyAfter,
        });
      }
      if (changes.length > 0) batches.push({ n, baseKey: `undo:${saleId}:batch:${n}`, changes });
    });
    return { batches, unresolvable };
  }
  ```
- [ ] `npx vitest run lib/ytg/__tests__/saleApply.test.ts lib/ytg/__tests__/saleStateMachine.test.ts` — expected PASS.
- [ ] Commit:
  ```bash
  git add lib/ytg/saleStateMachine.ts lib/ytg/__tests__/saleApply.test.ts
  git commit -m "feat(ytg): deterministic apply/undo planner — stable batch ordinals, crash-scenario proofs (WS-4)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 6: Server actions — preview, confirm, getSale, listSales

**Files:**
- Create: `app/admin/ytg/decks/saleActions.ts`

**Interfaces produced (part 1 — Task 7 appends the executors to this same file):**
```ts
export interface SalePreviewRow { cardKey: string; cardName: string; qtyPerDeck: number; delta: number; qtyBefore: number | null; qtyAfter: number | null; singleProductId: string | null; variantId: string | null; flag: PreviewFlag }
export interface SalePreview { product: { productId: string; title: string; handle: string; imageUrl: string | null }; deckId: string; deckUpdatedAt: string; qty: number; rows: SalePreviewRow[]; recentSale: { id: string; qty: number; createdAt: string; createdByName: string | null } | null; activeSale: { id: string; status: string; createdAt: string; createdByName: string | null } | null; writesEnabled: boolean }
export async function previewSale(productId: string, qty: number): Promise<{ success: true; preview: SalePreview } | { success: false; error: string }>
export interface ConfirmInput { productId: string; qty: number; deckId: string; deckUpdatedAt: string; rows: SalePreviewRow[]; ackNegative: boolean }
export type ConfirmResult = { success: true; saleId: string; dryRun: boolean } | { success: false; code: 'deck_changed' | 'needs_ack' | 'sale_in_progress' | 'empty' | 'error'; error: string; inProgress?: { createdAt: string; createdByName: string | null } }
export async function confirmSale(input: ConfirmInput): Promise<ConfirmResult>
export interface SaleItemView { cardKey: string; cardName: string | null; qtyPerDeck: number; delta: number; qtyBefore: number | null; qtyAfter: number | null; singleProductId: string | null; status: string; error: string | null }
export interface SaleView { id: string; productId: string; productTitle: string | null; qty: number; status: string; createdAt: string; undoneAt: string | null; items: SaleItemView[]; writesEnabled: boolean; degraded: 'scope_missing' | null }
export async function getSale(saleId: string): Promise<{ success: true; sale: SaleView } | { success: false; error: string }>
export interface SaleHistoryRow { id: string; productId: string; productTitle: string; qty: number; status: string; createdAt: string; createdByName: string | null; undoneAt: string | null; undoneByName: string | null; appliedCount: number; skippedCount: number; troubleCount: number; totalItems: number }
export async function listSales(): Promise<{ success: true; sales: SaleHistoryRow[]; writesEnabled: boolean } | { success: false; error: string }>
```

- [ ] Create `app/admin/ytg/decks/saleActions.ts` with the file header, shared helpers, and the four actions:
  ```ts
  "use server";

  /**
   * WS-4 Record-sale server actions (spec §Record sale + Addendum 2026-08-04).
   * Thin executors over the pure planner in lib/ytg/saleStateMachine.ts and
   * the gated Shopify client in lib/shopify/inventory.ts. Every action
   * re-checks hasPermission (layout gating does not protect actions) and uses
   * the service-role client — the ledger tables revoke anon/authenticated.
   */

  import { hasPermission } from "@/utils/adminUtils";
  import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
  import { createClient } from "@/utils/supabase/server";
  import { getShopifyAccessToken, fetchProductInventory } from "@/lib/pricing/shopify";
  import { buildCardKey } from "@/lib/pricing/matching";
  import {
    getSingleLocationId, getInventoryItemIds, adjustAvailable, activateItem,
    idempotencyKey, inventoryWritesEnabled, isNotStockedError, isStaleCasError,
    changeIndexOf, type InventoryChange, type InventoryUserError,
  } from "@/lib/shopify/inventory";
  import {
    classifyPreviewRow, deriveSaleStatus, deriveUndoStatus, planApply,
    planResume, planUndo, type PlannedBatch, type PreviewFlag,
    type SaleItemState, type ItemStatus,
  } from "@/lib/ytg/saleStateMachine";

  const PERM = "manage_shopify_imports";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function usernamesById(admin: any, ids: (string | null)[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (unique.length === 0) return out;
    const { data } = await admin.from("profiles").select("id, username").in("id", unique);
    for (const p of data ?? []) if (p.username) out.set(p.id, p.username);
    return out;
  }

  async function actingUserId(): Promise<string | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  }

  export interface SalePreviewRow {
    cardKey: string;
    cardName: string;
    qtyPerDeck: number;            // zone IN ('main','reserve'), summed per card_key
    delta: number;                 // -(qtyPerDeck × saleQty)
    qtyBefore: number | null;      // LIVE quantity (never the mirror)
    qtyAfter: number | null;
    singleProductId: string | null;
    variantId: string | null;
    flag: PreviewFlag;
  }

  export interface SalePreview {
    product: { productId: string; title: string; handle: string; imageUrl: string | null };
    deckId: string;
    deckUpdatedAt: string;
    qty: number;
    rows: SalePreviewRow[];
    recentSale: { id: string; qty: number; createdAt: string; createdByName: string | null } | null;
    activeSale: { id: string; status: string; createdAt: string; createdByName: string | null } | null;
    writesEnabled: boolean;
  }

  export type PreviewResult =
    | { success: true; preview: SalePreview }
    | { success: false; error: string };

  export async function previewSale(productId: string, qty: number): Promise<PreviewResult> {
    if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      return { success: false, error: "qty must be an integer between 1 and 99" };
    }
    const admin = getSupabaseAdmin();

    const { data: link, error: linkErr } = await admin
      .from("ytg_deck_links").select("deck_id")
      .eq("shopify_product_id", productId).maybeSingle();
    if (linkErr) return { success: false, error: linkErr.message };
    if (!link) return { success: false, error: "product is not linked to a deck — pull contents first" };

    const { data: p, error: prodErr } = await admin
      .from("shopify_products").select("id, title, handle, raw_json")
      .eq("id", productId).maybeSingle();
    if (prodErr) return { success: false, error: prodErr.message };
    if (!p) return { success: false, error: "product not found in the mirror" };

    const { data: deck, error: deckErr } = await admin
      .from("decks").select("updated_at").eq("id", link.deck_id).maybeSingle();
    if (deckErr) return { success: false, error: deckErr.message };
    if (!deck) return { success: false, error: "linked deck no longer exists" };

    // Addendum 2026-08-04: the box physically includes the Reserve —
    // decrement reads zone IN ('main','reserve'), SUMMED per card_key.
    const { data: cards, error: cardsErr } = await admin
      .from("deck_cards")
      .select("card_name, card_set, card_img_file, quantity, zone")
      .eq("deck_id", link.deck_id)
      .in("zone", ["main", "reserve"]);
    if (cardsErr) return { success: false, error: cardsErr.message };

    const perKey = new Map<string, { cardName: string; qtyPerDeck: number }>();
    for (const c of cards ?? []) {
      const key = buildCardKey(c.card_name, c.card_set, c.card_img_file);
      const prev = perKey.get(key);
      if (prev) prev.qtyPerDeck += c.quantity ?? 0;
      else perKey.set(key, { cardName: c.card_name, qtyPerDeck: c.quantity ?? 0 });
    }
    if (perKey.size === 0) return { success: false, error: "linked deck has no main/reserve cards" };

    // Confirmed mappings are exactly auto_matched|manual (no 'matched' status exists).
    const { data: mappings, error: mapErr } = await admin
      .from("card_price_mappings")
      .select("card_key, shopify_product_id")
      .in("card_key", [...perKey.keys()])
      .in("status", ["auto_matched", "manual"]);
    if (mapErr) return { success: false, error: mapErr.message };

    const productByKey = new Map<string, string>();
    for (const m of mappings ?? []) {
      if (m.shopify_product_id) productByKey.set(m.card_key, String(m.shopify_product_id));
    }

    // LIVE inventory — never the mirror (mirror staleness → oversell; Shopify
    // happily drives available negative with no error).
    const token = await getShopifyAccessToken();
    const live = await fetchProductInventory(token, [...new Set(productByKey.values())]);

    // Sequential CAS anchors when several card_keys share one single product
    // (promo-fallback mappings): row 2's qtyBefore = row 1's qtyAfter.
    const runningQty = new Map<string, number>();
    const rows: SalePreviewRow[] = [...perKey.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([cardKey, v]) => {
        const singleProductId = productByKey.get(cardKey) ?? null;
        const inv = singleProductId !== null ? live.get(singleProductId) : undefined;
        const delta = -(v.qtyPerDeck * qty);
        const tracked = inv !== undefined && inv.tracked === true;
        let qtyBefore: number | null = null;
        let qtyAfter: number | null = null;
        if (singleProductId !== null && inv !== undefined && tracked) {
          const start = runningQty.get(singleProductId);
          qtyBefore = start === undefined ? inv.inventory : start;
          qtyAfter = qtyBefore + delta;
          runningQty.set(singleProductId, qtyAfter);
        }
        return {
          cardKey,
          cardName: v.cardName,
          qtyPerDeck: v.qtyPerDeck,
          delta,
          qtyBefore,
          qtyAfter,
          singleProductId,
          variantId: inv !== undefined ? inv.variantId : null,
          flag: classifyPreviewRow({
            mapped: singleProductId !== null && inv !== undefined,
            tracked,
            qtyAfter,
          }),
        };
      });

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recent } = await admin
      .from("ytg_deck_sales").select("id, qty, created_at, created_by")
      .eq("shopify_product_id", productId)
      .in("status", ["applied", "partial"])
      .gte("created_at", tenMinAgo)
      .order("created_at", { ascending: false }).limit(1);
    const { data: active } = await admin
      .from("ytg_deck_sales").select("id, status, created_at, created_by")
      .eq("shopify_product_id", productId)
      .in("status", ["pending", "applying"]).limit(1);

    const names = await usernamesById(admin, [
      ...(recent ?? []).map((r: { created_by: string | null }) => r.created_by),
      ...(active ?? []).map((r: { created_by: string | null }) => r.created_by),
    ]);
    const r0 = (recent ?? [])[0];
    const a0 = (active ?? [])[0];

    return {
      success: true,
      preview: {
        product: {
          productId: p.id,
          title: p.title,
          handle: p.handle,
          imageUrl: p.raw_json?.images?.[0]?.src ?? p.raw_json?.image?.src ?? null,
        },
        deckId: link.deck_id,
        deckUpdatedAt: deck.updated_at,
        qty,
        rows,
        recentSale: r0
          ? { id: r0.id, qty: r0.qty, createdAt: r0.created_at, createdByName: names.get(r0.created_by) ?? null }
          : null,
        activeSale: a0
          ? { id: a0.id, status: a0.status, createdAt: a0.created_at, createdByName: names.get(a0.created_by) ?? null }
          : null,
        writesEnabled: inventoryWritesEnabled(),
      },
    };
  }

  export interface ConfirmInput {
    productId: string;
    qty: number;
    deckId: string;
    deckUpdatedAt: string;   // snapshot-integrity check (spec pt. 3)
    rows: SalePreviewRow[];  // the previewed (possibly row-dropped) snapshot
    ackNegative: boolean;
  }

  export type ConfirmResult =
    | { success: true; saleId: string; dryRun: boolean }
    | {
        success: false;
        code: "deck_changed" | "needs_ack" | "sale_in_progress" | "empty" | "error";
        error: string;
        inProgress?: { createdAt: string; createdByName: string | null };
      };

  export async function confirmSale(input: ConfirmInput): Promise<ConfirmResult> {
    if (!(await hasPermission(PERM))) return { success: false, code: "error", error: "forbidden" };
    const admin = getSupabaseAdmin();
    const { productId, qty, deckId, deckUpdatedAt, rows, ackNegative } = input;

    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      return { success: false, code: "error", error: "qty must be an integer between 1 and 99" };
    }
    const adjustable = (rows ?? []).filter(
      (r) => r.flag === "ok" || r.flag === "would_go_negative",
    );
    if (!rows || rows.length === 0 || adjustable.length === 0) {
      return { success: false, code: "empty", error: "nothing to apply — every row is unmapped/untracked or dropped" };
    }
    if (rows.some((r) => r.flag === "would_go_negative") && ackNegative !== true) {
      return { success: false, code: "needs_ack", error: "some rows would go negative — acknowledge to proceed" };
    }

    // Deck-changed check: apply acts on the previewed snapshot, never a re-read.
    const { data: deck, error: deckErr } = await admin
      .from("decks").select("updated_at").eq("id", deckId).maybeSingle();
    if (deckErr) return { success: false, code: "error", error: deckErr.message };
    if (!deck || deck.updated_at !== deckUpdatedAt) {
      return { success: false, code: "deck_changed", error: "deck changed since preview — re-preview before recording" };
    }

    const createdBy = await actingUserId();
    const { data: inserted, error: insErr } = await admin
      .from("ytg_deck_sales")
      .insert({ shopify_product_id: productId, deck_id: deckId, qty, status: "pending", created_by: createdBy })
      .select("id");
    if (insErr) {
      if (insErr.code === "23505") {
        // Partial unique index: one active sale per product (WS-3 guard reads the same rows).
        const { data: who } = await admin
          .from("ytg_deck_sales").select("created_at, created_by")
          .eq("shopify_product_id", productId)
          .in("status", ["pending", "applying"]).limit(1);
        const w = (who ?? [])[0];
        const names = await usernamesById(admin, [w?.created_by ?? null]);
        return {
          success: false, code: "sale_in_progress",
          error: "a sale is already being recorded for this product",
          inProgress: w
            ? { createdAt: w.created_at, createdByName: names.get(w.created_by) ?? null }
            : undefined,
        };
      }
      return { success: false, code: "error", error: insErr.message };
    }
    const saleId: string = inserted[0].id;

    // Snapshot items — quantities already summed per card_key (items PK).
    const itemRows = rows.map((r) => ({
      sale_id: saleId,
      card_key: r.cardKey,
      card_name: r.cardName,
      qty_per_deck: r.qtyPerDeck,
      delta: r.delta,
      qty_before: r.qtyBefore,
      qty_after: r.qtyAfter,
      single_product_id: r.singleProductId,
      variant_id: r.variantId,
      inventory_item_id: null,
      status:
        r.flag === "unmapped" ? "skipped_unmapped"
        : r.flag === "untracked" ? "skipped_untracked"
        : "pending",
      error: null,
    }));
    const { error: itemsErr } = await admin.from("ytg_deck_sale_items").insert(itemRows);
    if (itemsErr) {
      await admin.from("ytg_deck_sales").delete().eq("id", saleId); // items cascade
      return { success: false, code: "error", error: `snapshot failed: ${itemsErr.message}` };
    }

    // Dry-run short-circuit: recorded, visibly segregated, never applied, non-replayable.
    if (inventoryWritesEnabled() === false) {
      const { error: dryErr } = await admin
        .from("ytg_deck_sales").update({ status: "dry_run" }).eq("id", saleId);
      if (dryErr) return { success: false, code: "error", error: dryErr.message };
      return { success: true, saleId, dryRun: true };
    }

    // Server-side claim: CAS pending→applying. A refresh-and-resume or a
    // second admin loses this and sees "already being applied".
    const { data: claimed, error: claimErr } = await admin
      .from("ytg_deck_sales").update({ status: "applying" })
      .eq("id", saleId).eq("status", "pending").select("id");
    if (claimErr) return { success: false, code: "error", error: claimErr.message };
    if (!claimed || claimed.length === 0) {
      return { success: false, code: "sale_in_progress", error: "sale is already being applied" };
    }
    return { success: true, saleId, dryRun: false };
  }

  export interface SaleItemView {
    cardKey: string;
    cardName: string | null;
    qtyPerDeck: number;
    delta: number;
    qtyBefore: number | null;
    qtyAfter: number | null;
    singleProductId: string | null;
    status: string;
    error: string | null;
  }

  export interface SaleView {
    id: string;
    productId: string;
    productTitle: string | null;
    qty: number;
    status: string;
    createdAt: string;
    undoneAt: string | null;
    items: SaleItemView[];
    writesEnabled: boolean;
    degraded: "scope_missing" | null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function loadSaleView(admin: any, saleId: string, degraded: "scope_missing" | null = null): Promise<
    { success: true; sale: SaleView } | { success: false; error: string }
  > {
    const { data: sale, error: saleErr } = await admin
      .from("ytg_deck_sales")
      .select("id, shopify_product_id, qty, status, created_at, undone_at")
      .eq("id", saleId).maybeSingle();
    if (saleErr) return { success: false, error: saleErr.message };
    if (!sale) return { success: false, error: "sale not found" };
    const { data: items, error: itemsErr } = await admin
      .from("ytg_deck_sale_items")
      .select("card_key, card_name, qty_per_deck, delta, qty_before, qty_after, single_product_id, status, error")
      .eq("sale_id", saleId).order("card_key");
    if (itemsErr) return { success: false, error: itemsErr.message };
    const { data: prod } = await admin
      .from("shopify_products").select("title").eq("id", sale.shopify_product_id).maybeSingle();
    return {
      success: true,
      sale: {
        id: sale.id,
        productId: sale.shopify_product_id,
        productTitle: prod ? prod.title : null,
        qty: sale.qty,
        status: sale.status,
        createdAt: sale.created_at,
        undoneAt: sale.undone_at,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items: (items ?? []).map((i: any) => ({
          cardKey: i.card_key, cardName: i.card_name, qtyPerDeck: i.qty_per_deck,
          delta: i.delta, qtyBefore: i.qty_before, qtyAfter: i.qty_after,
          singleProductId: i.single_product_id, status: i.status, error: i.error,
        })),
        writesEnabled: inventoryWritesEnabled(),
        degraded,
      },
    };
  }

  export type SaleResult = { success: true; sale: SaleView } | { success: false; error: string };

  export async function getSale(saleId: string): Promise<SaleResult> {
    if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
    return loadSaleView(getSupabaseAdmin(), saleId);
  }

  export interface SaleHistoryRow {
    id: string;
    productId: string;
    productTitle: string;
    qty: number;
    status: string;
    createdAt: string;
    createdByName: string | null;
    undoneAt: string | null;
    undoneByName: string | null;
    appliedCount: number;
    skippedCount: number;
    troubleCount: number;   // error|conflict|undo_conflict
    totalItems: number;
  }

  export async function listSales(): Promise<
    { success: true; sales: SaleHistoryRow[]; writesEnabled: boolean } | { success: false; error: string }
  > {
    if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
    const admin = getSupabaseAdmin();
    const { data: sales, error } = await admin
      .from("ytg_deck_sales")
      .select("id, shopify_product_id, qty, status, created_at, created_by, undone_at, undone_by")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return { success: false, error: error.message };
    const rows = sales ?? [];
    if (rows.length === 0) return { success: true, sales: [], writesEnabled: inventoryWritesEnabled() };

    const { data: items } = await admin
      .from("ytg_deck_sale_items").select("sale_id, status")
      .in("sale_id", rows.map((s: { id: string }) => s.id));
    const counts = new Map<string, { applied: number; skipped: number; trouble: number; total: number }>();
    for (const it of items ?? []) {
      const c = counts.get(it.sale_id) ?? { applied: 0, skipped: 0, trouble: 0, total: 0 };
      c.total += 1;
      if (it.status === "applied" || it.status === "undone") c.applied += 1;
      if (it.status === "skipped_unmapped" || it.status === "skipped_untracked") c.skipped += 1;
      if (it.status === "error" || it.status === "conflict" || it.status === "undo_conflict") c.trouble += 1;
      counts.set(it.sale_id, c);
    }

    const { data: prods } = await admin
      .from("shopify_products").select("id, title")
      .in("id", [...new Set(rows.map((s: { shopify_product_id: string }) => s.shopify_product_id))]);
    const titleById = new Map<string, string>();
    for (const pr of prods ?? []) titleById.set(String(pr.id), pr.title);

    const names = await usernamesById(admin, [
      ...rows.map((s: { created_by: string | null }) => s.created_by),
      ...rows.map((s: { undone_by: string | null }) => s.undone_by),
    ]);

    return {
      success: true,
      writesEnabled: inventoryWritesEnabled(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sales: rows.map((s: any) => {
        const c = counts.get(s.id) ?? { applied: 0, skipped: 0, trouble: 0, total: 0 };
        return {
          id: s.id,
          productId: s.shopify_product_id,
          productTitle: titleById.get(s.shopify_product_id) ?? s.shopify_product_id,
          qty: s.qty,
          status: s.status,
          createdAt: s.created_at,
          createdByName: s.created_by ? (names.get(s.created_by) ?? null) : null,
          undoneAt: s.undone_at,
          undoneByName: s.undone_by ? (names.get(s.undone_by) ?? null) : null,
          appliedCount: c.applied,
          skippedCount: c.skipped,
          troubleCount: c.trouble,
          totalItems: c.total,
        };
      }),
    };
  }
  ```
- [ ] Type-check (only gate available for actions — behavior is covered by the Task 10 dry-run checklist per the spec's testing section):
  ```bash
  npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "forge-anon-leak.test.ts" | grep -v "playDecksAuthorize.test.ts"
  ```
  Expect no output. (The unused imports for Task 7 — `getSingleLocationId`, `planApply`, etc. — do not error under `strict:false`; they are consumed in the next task.)
- [ ] Commit:
  ```bash
  git add app/admin/ytg/decks/saleActions.ts
  git commit -m "feat(ytg): sale actions — live preview (main+reserve summed), snapshot confirm with CAS claim, history reads (WS-4)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 7: Server actions — apply, resume, retry, undo (thin executors)

**Files:**
- Modify: `app/admin/ytg/decks/saleActions.ts` (append)

**Interfaces produced:**
```ts
export async function applySale(saleId: string): Promise<SaleResult>
export async function resumeSale(saleId: string): Promise<SaleResult>
export async function retrySaleItem(saleId: string, cardKey: string, ackNegative: boolean): Promise<SaleResult | { success: false; error: string; needsAck: true; qtyBefore: number; qtyAfter: number }>
export async function undoSale(saleId: string): Promise<SaleResult>
```

- [ ] Append to `app/admin/ytg/decks/saleActions.ts`:
  ```ts
  // ─── Apply / resume / retry / undo executors ────────────────────────────────

  const CONFLICT_MSG =
    "live quantity moved between preview and apply (compare-and-swap rejected) — verify in Shopify, then retry";
  const RESUME_CONFLICT_MSG =
    "live quantity matches neither anchor — a third party moved stock; resolve in Shopify";
  const UNDO_CONFLICT_MSG =
    "live quantity moved since the sale — undo refused to stack stock; review in Shopify";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function setItems(admin: any, saleId: string, cardKeys: string[], patch: Record<string, unknown>) {
    if (cardKeys.length === 0) return;
    await admin.from("ytg_deck_sale_items").update(patch)
      .eq("sale_id", saleId).in("card_key", cardKeys);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function loadItemStates(admin: any, saleId: string): Promise<
    { success: true; items: (SaleItemState & { variantId: string | null; singleProductId: string | null })[] }
    | { success: false; error: string }
  > {
    const { data, error } = await admin
      .from("ytg_deck_sale_items")
      .select("card_key, status, delta, qty_before, qty_after, inventory_item_id, variant_id, single_product_id")
      .eq("sale_id", saleId);
    if (error) return { success: false, error: error.message };
    return {
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: (data ?? []).map((i: any) => ({
        cardKey: i.card_key,
        status: i.status as ItemStatus,
        delta: i.delta,
        qtyBefore: i.qty_before,
        qtyAfter: i.qty_after,
        inventoryItemId: i.inventory_item_id,
        variantId: i.variant_id,
        singleProductId: i.single_product_id,
      })),
    };
  }

  /**
   * Resolve inventory_item_ids for adjustable items that still lack them and
   * persist onto the rows (idempotent; resume re-runs this harmlessly).
   * Items whose variant has no inventory item become 'error'.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function resolveInventoryItemIds(admin: any, token: string, saleId: string): Promise<void> {
    const loaded = await loadItemStates(admin, saleId);
    if (loaded.success === false) return;
    const need = loaded.items.filter(
      (i) => (i.status === "pending" || i.status === "applying")
        && i.inventoryItemId === null && i.variantId !== null,
    );
    if (need.length === 0) return;
    const gidOf = (variantId: string) => `gid://shopify/ProductVariant/${variantId}`;
    const map = await getInventoryItemIds(token, need.map((i) => gidOf(i.variantId as string)));
    for (const i of need) {
      const itemGid = map.get(gidOf(i.variantId as string));
      if (itemGid) {
        await admin.from("ytg_deck_sale_items")
          .update({ inventory_item_id: itemGid })
          .eq("sale_id", saleId).eq("card_key", i.cardKey);
      } else {
        await setItems(admin, saleId, [i.cardKey], {
          status: "error", error: "variant has no inventory item in Shopify",
        });
      }
    }
  }

  /**
   * Execute one planned batch. The mutation is atomic — on userErrors, mark
   * the offending changes (stale → conflict, not-stocked → activate then
   * retry, other → error) and re-run the pruned remainder under its new
   * (payload-derived) key. Bounded passes; leftovers become 'error'.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function runBatch(
    admin: any, token: string, locationId: string, saleId: string, batch: PlannedBatch,
  ): Promise<void> {
    let changes = batch.changes.slice();
    for (let pass = 0; pass < 4 && changes.length > 0; pass++) {
      const invChanges: InventoryChange[] = changes.map((c) => ({
        inventoryItemId: c.inventoryItemId, delta: c.delta, changeFromQuantity: c.changeFromQuantity,
      }));
      const key = idempotencyKey(batch.baseKey, invChanges);
      const outcome = await adjustAvailable(token, {
        idempotencyKey: key, locationId, changes: invChanges,
      });

      if (outcome.userErrors.length === 0) {
        await setItems(admin, saleId, changes.map((c) => c.cardKey), { status: "applied", error: null });
        return;
      }

      // Whole-mutation idempotency signals (no change index):
      const concurrent = outcome.userErrors.some((e) => e.code === "IDEMPOTENCY_CONCURRENT_REQUEST");
      if (concurrent) return; // another tab is applying this exact payload — leave 'applying', Resume reconciles
      const prevFailed = outcome.userErrors.some(
        (e) => e.code === "IDEMPOTENCY_PREVIOUS_ATTEMPT_FAILED" || e.code === "IDEMPOTENCY_KEY_PARAMETER_MISMATCH",
      );
      if (prevFailed) {
        // The key is burned but nothing applied (previous attempt failed).
        // changeFromQuantity remains the true guard — retry under a salted key.
        const salted = `${batch.baseKey}:retry:${pass + 1}`;
        const retry = await adjustAvailable(token, {
          idempotencyKey: idempotencyKey(salted, invChanges), locationId, changes: invChanges,
        });
        if (retry.userErrors.length === 0) {
          await setItems(admin, saleId, changes.map((c) => c.cardKey), { status: "applied", error: null });
          return;
        }
        outcome.userErrors = retry.userErrors;
      }

      const failedIdx = new Set<number>();
      const activations: { idx: number; inventoryItemId: string }[] = [];
      let unattributed: InventoryUserError | null = null;
      for (const e of outcome.userErrors) {
        const idx = changeIndexOf(e);
        if (idx === null || idx >= changes.length) { unattributed = e; continue; }
        failedIdx.add(idx);
        if (isNotStockedError(e)) {
          activations.push({ idx, inventoryItemId: changes[idx].inventoryItemId });
        } else if (isStaleCasError(e)) {
          await setItems(admin, saleId, [changes[idx].cardKey], { status: "conflict", error: CONFLICT_MSG });
        } else {
          await setItems(admin, saleId, [changes[idx].cardKey], {
            status: "error", error: `${e.code ?? "SHOPIFY_ERROR"}: ${e.message}`,
          });
        }
      }
      if (unattributed !== null && failedIdx.size === 0) {
        await setItems(admin, saleId, changes.map((c) => c.cardKey), {
          status: "error", error: `${unattributed.code ?? "SHOPIFY_ERROR"}: ${unattributed.message}`,
        });
        return;
      }

      // Never-activated items: inventoryActivate(available: 0) with the
      // spec-pinned key, then the change goes back into the retry payload.
      const reactivated = new Set<number>();
      for (const a of activations) {
        const act = await activateItem(token, {
          idempotencyKey: `sale:${saleId}:activate:${a.inventoryItemId}`,
          inventoryItemId: a.inventoryItemId, locationId,
        });
        if (act.userErrors.length === 0) reactivated.add(a.idx);
        else await setItems(admin, saleId, [changes[a.idx].cardKey], {
          status: "error", error: `activate failed: ${act.userErrors.map((e) => e.message).join("; ")}`,
        });
      }

      // Atomicity: non-failing changes were NOT applied — re-run them, plus
      // any freshly-activated ones. Pruned payload ⇒ new fingerprint ⇒ new key.
      changes = changes.filter((c, idx) => !failedIdx.has(idx) || reactivated.has(idx));
    }
    if (changes.length > 0) {
      await setItems(admin, saleId, changes.map((c) => c.cardKey), {
        status: "error", error: "retry passes exhausted — use per-row Retry",
      });
    }
  }

  function isAccessDenied(e: unknown): boolean {
    return e instanceof Error && /ACCESS_DENIED|access denied/i.test(e.message);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function degradeToDryRun(admin: any, saleId: string): Promise<void> {
    // Scope not granted after all: revert in-flight items, park the sale as
    // dry_run (visibly segregated, never applied, non-replayable — spec).
    const { data: inflight } = await admin
      .from("ytg_deck_sale_items").select("card_key")
      .eq("sale_id", saleId).eq("status", "applying");
    await setItems(admin, saleId, (inflight ?? []).map((i: { card_key: string }) => i.card_key), {
      status: "pending", error: null,
    });
    await admin.from("ytg_deck_sales").update({ status: "dry_run" }).eq("id", saleId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function finishApplyPass(admin: any, token: string, locationId: string, saleId: string): Promise<void> {
    const loaded = await loadItemStates(admin, saleId);
    if (loaded.success === false) return;
    const plan = planApply(saleId, loaded.items);
    await setItems(admin, saleId, plan.unresolvable, {
      status: "error", error: "missing inventory item id or CAS anchors",
    });
    for (const batch of plan.batches) {
      // CAS the batch's items pending→applying BEFORE the Shopify call —
      // losing rows here means another tab owns them; skip those.
      const { data: flipped } = await admin
        .from("ytg_deck_sale_items").update({ status: "applying" })
        .eq("sale_id", saleId)
        .in("card_key", batch.changes.map((c) => c.cardKey))
        .eq("status", "pending")
        .select("card_key");
      const owned = new Set((flipped ?? []).map((f: { card_key: string }) => f.card_key));
      const ownedChanges = batch.changes.filter((c) => owned.has(c.cardKey));
      if (ownedChanges.length === 0) continue;
      await runBatch(admin, token, locationId, saleId, { ...batch, changes: ownedChanges });
    }
    // Sale status is DERIVED from items.
    const after = await loadItemStates(admin, saleId);
    if (after.success === false) return;
    if (after.items.some((i) => i.status === "applying")) return; // concurrent tab still in flight
    await admin.from("ytg_deck_sales")
      .update({ status: deriveSaleStatus(after.items) })
      .eq("id", saleId).eq("status", "applying");
  }

  export async function applySale(saleId: string): Promise<SaleResult> {
    if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
    const admin = getSupabaseAdmin();
    const { data: sale, error: saleErr } = await admin
      .from("ytg_deck_sales").select("id, status").eq("id", saleId).maybeSingle();
    if (saleErr) return { success: false, error: saleErr.message };
    if (!sale) return { success: false, error: "sale not found" };
    if (sale.status === "pending") {
      // Crash between confirm-insert and claim: re-claim.
      const { data: claimed } = await admin
        .from("ytg_deck_sales").update({ status: "applying" })
        .eq("id", saleId).eq("status", "pending").select("id");
      if (!claimed || claimed.length === 0) return loadSaleView(admin, saleId);
    } else if (sale.status !== "applying") {
      return loadSaleView(admin, saleId); // terminal — just show it
    }
    if (inventoryWritesEnabled() === false) {
      await degradeToDryRun(admin, saleId);
      return loadSaleView(admin, saleId, "scope_missing");
    }
    try {
      const token = await getShopifyAccessToken();
      const locationId = await getSingleLocationId(token);
      await resolveInventoryItemIds(admin, token, saleId);
      await finishApplyPass(admin, token, locationId, saleId);
    } catch (e) {
      if (isAccessDenied(e)) {
        await degradeToDryRun(admin, saleId);
        return loadSaleView(admin, saleId, "scope_missing");
      }
      return { success: false, error: e instanceof Error ? e.message : "apply failed" };
    }
    return loadSaleView(admin, saleId);
  }

  export async function resumeSale(saleId: string): Promise<SaleResult> {
    if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
    const admin = getSupabaseAdmin();
    const { data: sale, error: saleErr } = await admin
      .from("ytg_deck_sales").select("id, status").eq("id", saleId).maybeSingle();
    if (saleErr) return { success: false, error: saleErr.message };
    if (!sale) return { success: false, error: "sale not found" };
    if (sale.status === "pending") return applySale(saleId);
    if (sale.status !== "applying") return loadSaleView(admin, saleId);
    if (inventoryWritesEnabled() === false) {
      await degradeToDryRun(admin, saleId);
      return loadSaleView(admin, saleId, "scope_missing");
    }
    try {
      const token = await getShopifyAccessToken();
      const locationId = await getSingleLocationId(token);
      await resolveInventoryItemIds(admin, token, saleId);

      // Oracle phase: 'applying' items are UNKNOWN — re-read live quantities.
      const loaded = await loadItemStates(admin, saleId);
      if (loaded.success === false) return { success: false, error: loaded.error };
      const stranded = loaded.items.filter((i) => i.status === "applying");
      if (stranded.length > 0) {
        const live = await fetchProductInventory(
          token,
          [...new Set(stranded.map((i) => i.singleProductId).filter((x): x is string => Boolean(x)))],
        );
        const liveByCardKey = new Map<string, number>();
        for (const i of stranded) {
          const inv = i.singleProductId !== null ? live.get(i.singleProductId) : undefined;
          if (inv !== undefined) liveByCardKey.set(i.cardKey, inv.inventory);
        }
        const plan = planResume(saleId, loaded.items, liveByCardKey);
        await setItems(admin, saleId, plan.markApplied, { status: "applied", error: null });
        await setItems(admin, saleId, plan.conflicts, { status: "conflict", error: RESUME_CONFLICT_MSG });
        for (const batch of plan.reapply) {
          // Same payload ⇒ same key ⇒ Shopify dedupes even if the original
          // call arrived late (spec: "makes even the re-apply race safe").
          await runBatch(admin, token, locationId, saleId, batch);
        }
      }
      await finishApplyPass(admin, token, locationId, saleId);
    } catch (e) {
      if (isAccessDenied(e)) {
        await degradeToDryRun(admin, saleId);
        return loadSaleView(admin, saleId, "scope_missing");
      }
      return { success: false, error: e instanceof Error ? e.message : "resume failed" };
    }
    return loadSaleView(admin, saleId);
  }

  export type RetryResult =
    | SaleResult
    | { success: false; error: string; needsAck: true; qtyBefore: number; qtyAfter: number };

  /**
   * Per-row retry for 'error'/'conflict' items: re-read live quantity (the
   * spec's "after re-preview"), refresh the CAS anchors on the row, then a
   * single-change adjust under a payload-derived key. Undo stays correct
   * because qty_after is refreshed too.
   */
  export async function retrySaleItem(
    saleId: string, cardKey: string, ackNegative: boolean,
  ): Promise<RetryResult> {
    if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
    const admin = getSupabaseAdmin();
    if (inventoryWritesEnabled() === false) {
      return { success: false, error: "inventory writes are not enabled — retry is unavailable in dry-run" };
    }
    const { data: item, error: itemErr } = await admin
      .from("ytg_deck_sale_items")
      .select("card_key, status, delta, single_product_id, variant_id, inventory_item_id")
      .eq("sale_id", saleId).eq("card_key", cardKey).maybeSingle();
    if (itemErr) return { success: false, error: itemErr.message };
    if (!item) return { success: false, error: "sale item not found" };
    if (item.status !== "error" && item.status !== "conflict") {
      return loadSaleView(admin, saleId);
    }
    if (!item.single_product_id) return { success: false, error: "item has no mapped product" };
    try {
      const token = await getShopifyAccessToken();
      const locationId = await getSingleLocationId(token);
      await resolveInventoryItemIds(admin, token, saleId);
      const live = await fetchProductInventory(token, [item.single_product_id]);
      const inv = live.get(item.single_product_id);
      if (inv === undefined || inv.tracked === false) {
        return { success: false, error: "product is gone or untracked in Shopify — fix in Matching/Shopify first" };
      }
      const qtyBefore = inv.inventory;
      const qtyAfter = qtyBefore + item.delta;
      if (qtyAfter < 0 && ackNegative !== true) {
        return { success: false, error: "would go negative — acknowledge to proceed", needsAck: true, qtyBefore, qtyAfter };
      }
      const { data: fresh } = await admin
        .from("ytg_deck_sale_items").select("inventory_item_id")
        .eq("sale_id", saleId).eq("card_key", cardKey).maybeSingle();
      const inventoryItemId: string | null = fresh ? fresh.inventory_item_id : null;
      if (inventoryItemId === null) return { success: false, error: "no inventory item id for this variant" };
      // CAS claim + refreshed anchors (the resume oracle keys off these).
      const { data: claimed } = await admin
        .from("ytg_deck_sale_items")
        .update({ status: "applying", qty_before: qtyBefore, qty_after: qtyAfter, error: null })
        .eq("sale_id", saleId).eq("card_key", cardKey)
        .in("status", ["error", "conflict"]).select("card_key");
      if (!claimed || claimed.length === 0) return loadSaleView(admin, saleId);
      await runBatch(admin, token, locationId, saleId, {
        n: 0,
        baseKey: `sale:${saleId}:item:${inventoryItemId}`,
        changes: [{ cardKey, inventoryItemId, delta: item.delta, changeFromQuantity: qtyBefore }],
      });
      const after = await loadItemStates(admin, saleId);
      if (after.success === true && !after.items.some((i) => i.status === "applying")) {
        await admin.from("ytg_deck_sales")
          .update({ status: deriveSaleStatus(after.items) })
          .eq("id", saleId).in("status", ["applied", "partial", "failed", "applying"]);
      }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "retry failed" };
    }
    return loadSaleView(admin, saleId);
  }

  export async function undoSale(saleId: string): Promise<SaleResult> {
    if (!(await hasPermission(PERM))) return { success: false, error: "forbidden" };
    const admin = getSupabaseAdmin();
    if (inventoryWritesEnabled() === false) {
      return { success: false, error: "inventory writes are not enabled — undo is unavailable" };
    }
    // Double-click/two-tab safe claim; a sale stranded in 'undoing' (crash)
    // may re-enter — payload-derived keys make the re-run dedupe-safe.
    const { data: claimed, error: claimErr } = await admin
      .from("ytg_deck_sales").update({ status: "undoing" })
      .eq("id", saleId).in("status", ["applied", "partial"]).select("id");
    if (claimErr) return { success: false, error: claimErr.message };
    if (!claimed || claimed.length === 0) {
      const { data: cur } = await admin
        .from("ytg_deck_sales").select("status").eq("id", saleId).maybeSingle();
      if (!cur || cur.status !== "undoing") {
        return { success: false, error: "sale is not undoable (only applied/partial sales can be undone, once)" };
      }
    }
    try {
      const token = await getShopifyAccessToken();
      const locationId = await getSingleLocationId(token);
      const loaded = await loadItemStates(admin, saleId);
      if (loaded.success === false) return { success: false, error: loaded.error };
      const plan = planUndo(saleId, loaded.items);
      for (const batch of plan.batches) {
        let changes = batch.changes.slice();
        for (let pass = 0; pass < 3 && changes.length > 0; pass++) {
          const invChanges: InventoryChange[] = changes.map((c) => ({
            inventoryItemId: c.inventoryItemId, delta: c.delta, changeFromQuantity: c.changeFromQuantity,
          }));
          const outcome = await adjustAvailable(token, {
            idempotencyKey: idempotencyKey(batch.baseKey, invChanges), locationId, changes: invChanges,
          });
          if (outcome.userErrors.length === 0) {
            await setItems(admin, saleId, changes.map((c) => c.cardKey), { status: "undone", error: null });
            changes = [];
            break;
          }
          const failedIdx = new Set<number>();
          for (const e of outcome.userErrors) {
            const idx = changeIndexOf(e);
            if (idx === null || idx >= changes.length) continue;
            failedIdx.add(idx);
            await setItems(admin, saleId, [changes[idx].cardKey], {
              status: "undo_conflict",
              error: isStaleCasError(e) ? UNDO_CONFLICT_MSG : `${e.code ?? "SHOPIFY_ERROR"}: ${e.message}`,
            });
          }
          if (failedIdx.size === 0) {
            // Whole-mutation failure (idempotency signal etc.) — leave items
            // 'applied'; deriveUndoStatus lands on undo_partial below.
            break;
          }
          changes = changes.filter((_, idx) => !failedIdx.has(idx));
        }
      }
      const after = await loadItemStates(admin, saleId);
      if (after.success === false) return { success: false, error: after.error };
      await admin.from("ytg_deck_sales").update({
        status: deriveUndoStatus(after.items),
        undone_by: await actingUserId(),
        undone_at: new Date().toISOString(),
      }).eq("id", saleId).eq("status", "undoing");
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "undo failed" };
    }
    return loadSaleView(admin, saleId);
  }
  ```
- [ ] Full test + type gate (planner/client tests still green; no new tsc errors):
  ```bash
  npx vitest run lib/ytg lib/shopify
  npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "forge-anon-leak.test.ts" | grep -v "playDecksAuthorize.test.ts"
  ```
- [ ] Commit:
  ```bash
  git add app/admin/ytg/decks/saleActions.ts
  git commit -m "feat(ytg): crash-safe apply/resume/retry/undo executors — CAS claims, idempotent batches, ACCESS_DENIED degrade (WS-4)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 8: Sale UI — route page, SaleFlow, Record-sale entry point

**Files:**
- Create: `app/admin/ytg/decks/[productId]/sale/page.tsx`
- Create: `app/admin/ytg/decks/[productId]/sale/SaleFlow.tsx`
- Modify: `app/admin/ytg/decks/DeckProductList.tsx` (one link added; nothing else touched)

- [ ] Create `app/admin/ytg/decks/[productId]/sale/page.tsx` (mirrors the wizard's route-page structure):
  ```tsx
  import { notFound } from "next/navigation";
  import { previewSale } from "../../saleActions";
  import SaleFlow from "./SaleFlow";

  export const dynamic = "force-dynamic";

  export default async function RecordSalePage({
    params,
  }: {
    params: Promise<{ productId: string }>;
  }) {
    const { productId } = await params;
    const res = await previewSale(productId, 1);
    if (res.success === false) {
      if (res.error === "forbidden") notFound();
      return (
        <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
          {res.error}
        </div>
      );
    }
    return <SaleFlow initialPreview={res.preview} />;
  }
  ```
- [ ] Create `app/admin/ytg/decks/[productId]/sale/SaleFlow.tsx`:
  ```tsx
  "use client";

  import { useState, useTransition } from "react";
  import Link from "next/link";
  import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
  import { Button } from "@/components/ui/button";
  import {
    previewSale, confirmSale, applySale, resumeSale, retrySaleItem, undoSale,
  } from "../../saleActions";
  import type { SalePreview, SalePreviewRow, SaleView } from "../../saleActions";

  const imgOf = (cardKey: string) => cardKey.split("|")[2] ?? "";
  const fmtWhen = (iso: string) => new Date(iso).toLocaleString();

  const FLAG_BADGE: Record<string, { label: string; cls: string }> = {
    ok: { label: "ok", cls: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
    unmapped: { label: "unmapped", cls: "bg-destructive/10 text-destructive" },
    untracked: { label: "untracked", cls: "bg-muted text-muted-foreground" },
    would_go_negative: { label: "would go negative", cls: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  };

  const ITEM_EXPLAIN: Record<string, string> = {
    applied: "Inventory decremented in Shopify.",
    pending: "Not applied yet.",
    applying: "Was in flight when this loaded — use Resume to reconcile against live inventory.",
    skipped_unmapped: "No confirmed card-product mapping; nothing was adjusted.",
    skipped_untracked: "Variant does not track inventory; nothing was adjusted.",
    error: "Shopify rejected this change.",
    conflict: "Live quantity moved between preview and apply — the compare-and-swap refused it. Verify in Shopify, then Retry with fresh numbers.",
    undone: "Reversed by undo.",
    undo_conflict: "Live quantity moved since the sale — undo refused to stack stock. Review in Shopify.",
  };

  export default function SaleFlow({ initialPreview }: { initialPreview: SalePreview }) {
    const [preview, setPreview] = useState<SalePreview>(initialPreview);
    const [dropped, setDropped] = useState<Set<string>>(new Set());
    const [ack, setAck] = useState(false);
    const [error, setError] = useState("");
    const [inProgress, setInProgress] = useState<{ createdAt: string; createdByName: string | null } | null>(null);
    const [deckChanged, setDeckChanged] = useState(false);
    const [dryRunDone, setDryRunDone] = useState<string | null>(null); // saleId
    const [sale, setSale] = useState<SaleView | null>(null);
    const [undoArmed, setUndoArmed] = useState(false);
    const [pending, startTransition] = useTransition();

    const productId = preview.product.productId;
    const activeRows = preview.rows.filter((r) => !dropped.has(r.cardKey));
    const negatives = activeRows.filter((r) => r.flag === "would_go_negative");
    const adjustable = activeRows.filter((r) => r.flag === "ok" || r.flag === "would_go_negative");
    const flagged = activeRows.filter((r) => r.flag !== "ok");

    const reload = (qty: number) => {
      startTransition(async () => {
        setError("");
        setDeckChanged(false);
        const res = await previewSale(productId, qty);
        if (res.success === false) { setError(res.error); return; }
        setPreview(res.preview);
        setAck(false);
      });
    };

    const toggleDrop = (cardKey: string) => {
      setDropped((prev) => {
        const next = new Set(prev);
        if (next.has(cardKey)) next.delete(cardKey);
        else next.add(cardKey);
        return next;
      });
    };

    const confirm = () => {
      startTransition(async () => {
        setError("");
        setInProgress(null);
        const rows: SalePreviewRow[] = activeRows;
        const res = await confirmSale({
          productId,
          qty: preview.qty,
          deckId: preview.deckId,
          deckUpdatedAt: preview.deckUpdatedAt,
          rows,
          ackNegative: ack,
        });
        if (res.success === false) {
          if (res.code === "deck_changed") setDeckChanged(true);
          else if (res.code === "sale_in_progress") setInProgress(res.inProgress ?? { createdAt: "", createdByName: null });
          else setError(res.error);
          return;
        }
        if (res.dryRun === true) { setDryRunDone(res.saleId); return; }
        const applied = await applySale(res.saleId);
        if (applied.success === false) { setError(applied.error); return; }
        setSale(applied.sale);
      });
    };

    const resume = (saleId: string) => {
      startTransition(async () => {
        setError("");
        const res = await resumeSale(saleId);
        if (res.success === false) { setError(res.error); return; }
        setSale(res.sale);
      });
    };

    const retry = (cardKey: string, ackNeg: boolean) => {
      if (sale === null) return;
      startTransition(async () => {
        setError("");
        const res = await retrySaleItem(sale.id, cardKey, ackNeg);
        if (res.success === false) {
          if ("needsAck" in res && res.needsAck === true) {
            setError(`Retry for this row would go negative (${res.qtyBefore} to ${res.qtyAfter}). Click Retry again to acknowledge.`);
            return;
          }
          setError(res.error);
          return;
        }
        setSale(res.sale);
      });
    };

    const doUndo = () => {
      if (sale === null) return;
      startTransition(async () => {
        setError("");
        const res = await undoSale(sale.id);
        if (res.success === false) { setError(res.error); return; }
        setSale(res.sale);
        setUndoArmed(false);
      });
    };

    // ── Dry-run recorded ────────────────────────────────────────────────────
    if (dryRunDone !== null) {
      return (
        <div className="max-w-xl space-y-4">
          <h2 className="text-lg font-semibold">Dry-run sale recorded</h2>
          <div className="px-4 py-2 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-sm">
            Inventory writes are not enabled yet — this sale was recorded before inventory
            writes were enabled and was <strong>not applied</strong>. It cannot be replayed later.
          </div>
          <div className="flex gap-3">
            <Link href="/admin/ytg/decks"><Button>Back to deck products</Button></Link>
          </div>
        </div>
      );
    }

    // ── Results screen ──────────────────────────────────────────────────────
    if (sale !== null) {
      const troubled = sale.items.filter((i) => i.status === "error" || i.status === "conflict");
      const canUndo = sale.status === "applied" || sale.status === "partial";
      const isDryRun = sale.status === "dry_run";
      return (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            Sale result — {preview.product.title} × {sale.qty}
          </h2>
          <div className="text-sm">
            Status: <span className="font-medium">{sale.status}</span>
            {" "}· recorded {fmtWhen(sale.createdAt)}
          </div>
          {sale.degraded === "scope_missing" && (
            <div className="px-4 py-2 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-sm">
              Shopify refused the inventory write: the <code>write_inventory</code> scope is not
              yet granted. The sale was parked as a dry-run and was not applied.
            </div>
          )}
          {error !== "" && (
            <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
          )}
          {sale.status === "applying" && (
            <div className="px-4 py-2 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 text-sm flex items-center gap-3">
              <span>Some items were in flight — reconcile against live inventory.</span>
              <Button size="sm" disabled={pending} onClick={() => resume(sale.id)}>Resume</Button>
            </div>
          )}
          <div className="rounded-lg bg-muted/30 divide-y divide-background">
            {sale.items.map((i) => (
              <div key={i.cardKey} className="px-3 py-2 flex items-center gap-3">
                <img src={getCardImageUrl(imgOf(i.cardKey))} alt="" className="w-7 h-10 rounded-sm object-cover shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{i.cardName ?? i.cardKey}</div>
                  <div className="text-xs text-muted-foreground">
                    {i.qtyPerDeck} per deck · delta {i.delta}
                    {i.qtyBefore !== null && i.qtyAfter !== null && (
                      <span> · {i.qtyBefore} to {i.qtyAfter}</span>
                    )}
                  </div>
                  {(i.status === "conflict" || i.status === "error" || i.status === "undo_conflict") && (
                    <div className="text-xs text-destructive mt-0.5">
                      {ITEM_EXPLAIN[i.status]}{i.error ? ` (${i.error})` : ""}
                    </div>
                  )}
                </div>
                <span className={`px-1.5 py-0.5 rounded text-xs shrink-0 ${
                  i.status === "applied" || i.status === "undone"
                    ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                    : i.status === "skipped_unmapped" || i.status === "skipped_untracked" || i.status === "pending"
                      ? "bg-muted text-muted-foreground"
                      : "bg-destructive/10 text-destructive"
                }`}>
                  {i.status.replace(/_/g, " ")}
                </span>
                {(i.status === "error" || i.status === "conflict") && (
                  <Button size="sm" variant="outline" disabled={pending}
                    onClick={() => retry(i.cardKey, error.includes("acknowledge"))}>
                    Retry
                  </Button>
                )}
              </div>
            ))}
          </div>
          {troubled.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Retries are safe: each retry re-reads live inventory and uses a fresh
              compare-and-swap anchor plus an idempotency key.
            </p>
          )}
          <div className="flex items-center gap-3">
            {/* Undo is ABSENT (not disabled) on dry_run sales. */}
            {!isDryRun && canUndo && (
              undoArmed ? (
                <>
                  <Button variant="destructive" disabled={pending} onClick={doUndo}>
                    Confirm undo — restore {sale.items.filter((i) => i.status === "applied").length} item quantities
                  </Button>
                  <Button variant="ghost" disabled={pending} onClick={() => setUndoArmed(false)}>Cancel</Button>
                </>
              ) : (
                <Button variant="outline" disabled={pending} onClick={() => setUndoArmed(true)}>
                  Undo sale
                </Button>
              )
            )}
            <Link href="/admin/ytg/decks" className="ml-auto text-sm text-muted-foreground hover:underline">
              Back to deck products
            </Link>
          </div>
        </div>
      );
    }

    // ── Preview screen ──────────────────────────────────────────────────────
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {preview.product.imageUrl && (
            <img src={preview.product.imageUrl} alt="" className="w-12 h-12 rounded object-cover" />
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold truncate">Record sale — {preview.product.title}</h2>
            <p className="text-sm text-muted-foreground">
              Preview reads live Shopify inventory (main + reserve zones, summed per card).
            </p>
          </div>
          <div className="ml-auto flex items-center rounded bg-muted shrink-0">
            <button type="button" className="px-3 py-1 text-sm" disabled={pending || preview.qty <= 1}
              onClick={() => reload(preview.qty - 1)}>−</button>
            <span className="px-2 text-sm tabular-nums">{preview.qty}</span>
            <button type="button" className="px-3 py-1 text-sm" disabled={pending}
              onClick={() => reload(preview.qty + 1)}>+</button>
          </div>
        </div>

        {preview.writesEnabled === false && (
          <div className="px-4 py-2 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-sm">
            Dry-run mode: the <code>write_inventory</code> scope is not enabled
            (<code>YTG_INVENTORY_WRITES</code> unset). Confirming records the sale in the
            ledger as a dry-run — no inventory moves, and dry-runs cannot be replayed later.
          </div>
        )}
        {preview.activeSale !== null && (
          <div className="px-4 py-2 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 text-sm flex items-center gap-3">
            <span>
              A sale for this product is {preview.activeSale.status}
              {preview.activeSale.createdByName ? ` (by ${preview.activeSale.createdByName})` : ""} since {fmtWhen(preview.activeSale.createdAt)}.
            </span>
            <Button size="sm" disabled={pending} onClick={() => resume(preview.activeSale!.id)}>
              Resume it
            </Button>
          </div>
        )}
        {preview.recentSale !== null && (
          <div className="px-4 py-2 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-sm">
            {preview.recentSale.createdByName ?? "Someone"} recorded a sale of this product
            {" "}{fmtWhen(preview.recentSale.createdAt)} (qty {preview.recentSale.qty}) — record another?
          </div>
        )}
        {inProgress !== null && (
          <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
            A sale is already being recorded for this product
            {inProgress.createdByName ? ` by ${inProgress.createdByName}` : ""}
            {inProgress.createdAt ? ` (started ${fmtWhen(inProgress.createdAt)})` : ""}.
            Wait for it to finish, or reload to resume it.
          </div>
        )}
        {deckChanged && (
          <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-3">
            <span>The deck changed since this preview — re-preview before recording.</span>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => reload(preview.qty)}>
              Re-preview
            </Button>
          </div>
        )}
        {error !== "" && (
          <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
        )}

        {flagged.length > 0 && (
          <div className="px-4 py-2 rounded-md bg-muted/50 text-sm space-y-1">
            <div className="font-medium">{flagged.length} flagged row{flagged.length === 1 ? "" : "s"}</div>
            {flagged.some((r) => r.flag === "unmapped") && (
              <div>
                Unmapped cards will be recorded as skipped.{" "}
                <Link className="underline" href="/admin/ytg/matching">Fix in Matching</Link>
              </div>
            )}
            {flagged.some((r) => r.flag === "untracked") && (
              <div>Untracked variants will be recorded as skipped (Shopify does not track their inventory).</div>
            )}
            {negatives.length > 0 && (
              <div className="text-destructive">
                {negatives.length} row{negatives.length === 1 ? "" : "s"} would drive inventory negative.
              </div>
            )}
          </div>
        )}

        <div className="rounded-lg bg-muted/30 divide-y divide-background">
          {preview.rows.map((r) => {
            const isDropped = dropped.has(r.cardKey);
            const badge = FLAG_BADGE[r.flag];
            return (
              <div key={r.cardKey} className={`px-3 py-2 flex items-center gap-3 ${isDropped ? "opacity-40" : ""}`}>
                <img src={getCardImageUrl(imgOf(r.cardKey))} alt="" className="w-7 h-10 rounded-sm object-cover shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{r.cardName}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.qtyPerDeck} per deck · delta {r.delta}
                    {r.qtyBefore !== null && r.qtyAfter !== null && (
                      <span> · {r.qtyBefore} to <span className={r.qtyAfter < 0 ? "text-destructive font-medium" : ""}>{r.qtyAfter}</span></span>
                    )}
                  </div>
                </div>
                <span className={`px-1.5 py-0.5 rounded text-xs shrink-0 ${badge.cls}`}>{badge.label}</span>
                <button type="button" className="text-xs text-muted-foreground underline shrink-0"
                  onClick={() => toggleDrop(r.cardKey)}>
                  {isDropped ? "restore" : "drop"}
                </button>
              </div>
            );
          })}
        </div>

        {negatives.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            I understand {negatives.length} row{negatives.length === 1 ? "" : "s"} will drive
            available inventory negative in Shopify.
          </label>
        )}

        <div className="flex items-center gap-3">
          <Button
            disabled={pending || adjustable.length === 0 || (negatives.length > 0 && !ack) || preview.activeSale !== null}
            onClick={confirm}
          >
            {pending
              ? "Working…"
              : preview.writesEnabled === false
                ? `Record dry-run sale (${adjustable.length} adjustable rows)`
                : `Confirm sale — decrement ${adjustable.length} singles`}
          </Button>
          {adjustable.length === 0 && (
            <span className="text-sm text-muted-foreground">Nothing adjustable — every row is flagged or dropped.</span>
          )}
          <Link href="/admin/ytg/decks" className="ml-auto text-sm text-muted-foreground hover:underline">
            Cancel
          </Link>
        </div>
      </div>
    );
  }
  ```
- [ ] In `app/admin/ytg/decks/DeckProductList.tsx`, inside the `p.linkedDeckId ? (…)` block, directly after the `View deck` link and before the `Replace contents` link, add:
  ```tsx
                  <Link className="text-sm hover:underline" href={`/admin/ytg/decks/${p.productId}/sale`}>
                    Record sale
                  </Link>
  ```
- [ ] Type gate:
  ```bash
  npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "forge-anon-leak.test.ts" | grep -v "playDecksAuthorize.test.ts"
  ```
- [ ] Commit:
  ```bash
  git add "app/admin/ytg/decks/[productId]/sale/page.tsx" "app/admin/ytg/decks/[productId]/sale/SaleFlow.tsx" app/admin/ytg/decks/DeckProductList.tsx
  git commit -m "feat(ytg): Record-sale UI — live preview with flags/ack, confirm, results with per-row retry and undo (WS-4)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 9: Sales history section on the Decks tab

**Files:**
- Create: `app/admin/ytg/decks/SalesHistory.tsx`
- Modify: `app/admin/ytg/decks/page.tsx`

- [ ] Create `app/admin/ytg/decks/SalesHistory.tsx`:
  ```tsx
  "use client";

  import { useState, useTransition } from "react";
  import Link from "next/link";
  import { useRouter } from "next/navigation";
  import { Button } from "@/components/ui/button";
  import { undoSale } from "./saleActions";
  import type { SaleHistoryRow } from "./saleActions";

  const fmtWhen = (iso: string) => new Date(iso).toLocaleString();

  const STATUS_CLS: Record<string, string> = {
    applied: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
    partial: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    failed: "bg-destructive/10 text-destructive",
    pending: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
    applying: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
    undoing: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
    undone: "bg-muted text-muted-foreground",
    undo_partial: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    dry_run: "bg-muted text-muted-foreground",
  };

  function Row({ s, onUndo, pending }: { s: SaleHistoryRow; onUndo: ((id: string) => void) | null; pending: boolean }) {
    const [armed, setArmed] = useState(false);
    const stuck = s.status === "pending" || s.status === "applying";
    return (
      <div className="px-3 py-2 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm truncate">
            {s.productTitle} <span className="text-muted-foreground">× {s.qty}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {fmtWhen(s.createdAt)}{s.createdByName ? ` · by ${s.createdByName}` : ""}
            {" "}· {s.appliedCount}/{s.totalItems} items applied
            {s.skippedCount > 0 ? `, ${s.skippedCount} skipped` : ""}
            {s.troubleCount > 0 ? `, ${s.troubleCount} need attention` : ""}
            {s.undoneAt ? ` · undone ${fmtWhen(s.undoneAt)}${s.undoneByName ? ` by ${s.undoneByName}` : ""}` : ""}
          </div>
        </div>
        <span className={`px-1.5 py-0.5 rounded text-xs shrink-0 ${STATUS_CLS[s.status] ?? "bg-muted"}`}>
          {s.status.replace(/_/g, " ")}
        </span>
        {stuck && (
          <Link className="text-sm hover:underline shrink-0" href={`/admin/ytg/decks/${s.productId}/sale`}>
            Resume
          </Link>
        )}
        {/* Undo appears only where eligible; it is ABSENT on dry_run rows. */}
        {onUndo !== null && (s.status === "applied" || s.status === "partial") && (
          armed ? (
            <>
              <Button size="sm" variant="destructive" disabled={pending} onClick={() => onUndo(s.id)}>
                Confirm undo
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setArmed(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setArmed(true)}>
              Undo
            </Button>
          )
        )}
      </div>
    );
  }

  export default function SalesHistory({
    sales, writesEnabled, loadError,
  }: {
    sales: SaleHistoryRow[]; writesEnabled: boolean; loadError: string;
  }) {
    const [error, setError] = useState("");
    const [pending, startTransition] = useTransition();
    const router = useRouter();

    const doUndo = (saleId: string) => {
      startTransition(async () => {
        const res = await undoSale(saleId);
        if (res.success === false) setError(res.error);
        else { setError(""); router.refresh(); }
      });
    };

    const dryRuns = sales.filter((s) => s.status === "dry_run");
    const real = sales.filter((s) => s.status !== "dry_run");

    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Sales history</h2>
        {loadError !== "" && (
          <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">{loadError}</div>
        )}
        {error !== "" && (
          <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
        )}
        {sales.length === 0 && loadError === "" && (
          <p className="text-sm text-muted-foreground">
            No sales recorded yet. Record one from a linked deck product above.
          </p>
        )}
        {real.length > 0 && (
          <div className="rounded-lg bg-muted/30 divide-y divide-background">
            {real.map((s) => (
              <Row key={s.id} s={s} pending={pending} onUndo={writesEnabled ? doUndo : null} />
            ))}
          </div>
        )}
        {dryRuns.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Dry runs — recorded before inventory writes were enabled — not applied
            </div>
            <div className="rounded-lg bg-muted/20 divide-y divide-background opacity-75">
              {dryRuns.map((s) => (
                <Row key={s.id} s={s} pending={pending} onUndo={null} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
  ```
- [ ] Replace `app/admin/ytg/decks/page.tsx` with:
  ```tsx
  import { listDeckProducts } from "./actions";
  import { listSales } from "./saleActions";
  import DeckProductList from "./DeckProductList";
  import SalesHistory from "./SalesHistory";

  export const dynamic = "force-dynamic";

  export default async function DecksPage() {
    const [res, salesRes] = await Promise.all([listDeckProducts(), listSales()]);
    if (res.success === false) {
      return (
        <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
          {res.error}
        </div>
      );
    }
    return (
      <div className="space-y-8">
        <DeckProductList products={res.products} />
        <SalesHistory
          sales={salesRes.success === false ? [] : salesRes.sales}
          writesEnabled={salesRes.success === false ? false : salesRes.writesEnabled}
          loadError={salesRes.success === false ? salesRes.error : ""}
        />
      </div>
    );
  }
  ```
- [ ] Type gate:
  ```bash
  npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "forge-anon-leak.test.ts" | grep -v "playDecksAuthorize.test.ts"
  ```
- [ ] Commit:
  ```bash
  git add app/admin/ytg/decks/SalesHistory.tsx app/admin/ytg/decks/page.tsx
  git commit -m "feat(ytg): sales history on the Decks tab — undo where eligible, dry-runs visually segregated (WS-4)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 10: Manual verification checklists (documentation for the primary session)

**Files:** none — these checklists live in this plan and in the PR body. The executor performs the **dry-run e2e** now (it needs only real *read* credentials and the applied migrations); the **post-scope-grant** list is for Tim/Andy after `write_inventory` is approved.

**A. Dry-run e2e (now; `YTG_INVENTORY_WRITES` unset — reads real, writes mocked):**

- [ ] `npm run dev` in the worktree; sign in as an admin holding `manage_shopify_imports`.
- [ ] `/admin/ytg/decks` → a **linked** product shows the new "Record sale" link; an unlinked one does not.
- [ ] Open Record sale: dry-run banner visible; rows show live quantities; row count equals the deck's main+reserve distinct card_keys (spot-check one card that appears in both zones — its `qtyPerDeck` is the sum).
- [ ] Qty stepper → 2: every delta doubles, `qtyAfter` updates, negative rows turn red and demand the ack checkbox.
- [ ] Unmapped row (if any) shows "Fix in Matching" linking `/admin/ytg/matching`.
- [ ] Confirm → "Dry-run sale recorded" screen; **no undo button anywhere** for it.
- [ ] Ledger inspection (primary session, Supabase MCP, SELECT only — never DDL):
  ```sql
  SELECT id, status, qty, created_by FROM ytg_deck_sales ORDER BY created_at DESC LIMIT 3;
  SELECT card_key, status, delta, qty_before, qty_after, single_product_id
  FROM ytg_deck_sale_items WHERE sale_id = '<id-from-above>' ORDER BY card_key;
  ```
  Expect: sale `dry_run`; ok-rows `pending` with numeric `qty_before`/`qty_after`; flagged rows `skipped_unmapped`/`skipped_untracked` with nulls.
- [ ] History section: the dry-run row sits in the segregated block labeled "recorded before inventory writes were enabled — not applied", with no Undo.
- [ ] **WS-3 replace-guard interplay** (primary session): `INSERT INTO ytg_deck_sales (shopify_product_id, deck_id, qty, status) VALUES ('<productId>', '<deckId>', 1, 'pending');` → the wizard's Replace contents refuses with the friendly rendering of "a sale is being recorded for this product"; the sale page's confirm shows the sale-in-progress banner. Then `DELETE FROM ytg_deck_sales WHERE status='pending' AND shopify_product_id='<productId>';`
- [ ] **Two-tab race:** open Record sale in two tabs, confirm in both quickly — exactly one records; the loser shows the sale_in_progress banner with who/when.
- [ ] Cleanup: `DELETE FROM ytg_deck_sales WHERE status='dry_run' AND created_at > '<test-session-start>';` (items cascade).

**B. Post-scope-grant (Tim + Andy; the ONLY place real writes happen):**

- [ ] Confirm the new app version with `write_inventory` is approved in Andy's store Admin.
- [ ] Set `YTG_INVENTORY_WRITES=1` in the deployed (Vercel) environment only — never locally.
- [ ] Pick one low-value, low-stock deck product. Record a **qty-1** sale; preview numbers match Shopify admin.
- [ ] Confirm → results screen: all rows `applied` (any `ITEM_NOT_STOCKED_AT_LOCATION` should auto-activate and still land `applied`); ledger sale `applied`.
- [ ] Shopify admin: spot-check 3 singles — available decreased by exactly `qty_per_deck`; adjustment history shows reason "Correction".
- [ ] Undo (confirm dialog) → all items `undone`, sale `undone` with `undone_by`/`undone_at`; Shopify quantities restored exactly.
- [ ] If any row conflicts at any point: verify the explanation names the compare-and-swap and links the human to Shopify rather than stacking stock.

---

### Task 11: Final gate — full tests, tsc baseline, push, PR

**Files:** none.

- [ ] Full suite from the worktree root:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-sale
  npm test
  ```
  Expected: all suites pass (including the pre-existing parser/deckLinkOps/aliasBatch suites).
- [ ] Type gate — zero NEW errors vs the 7-error baseline:
  ```bash
  npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "forge-anon-leak.test.ts" | grep -v "playDecksAuthorize.test.ts"
  ```
  Expected: **no output**. (The baseline's 7 errors live only in `__tests__/forge-anon-leak.test.ts` and `app/forge/lib/__tests__/playDecksAuthorize.test.ts`.)
- [ ] Confirm only WS-4 files changed:
  ```bash
  git status --short
  git log --oneline origin/main..HEAD
  ```
- [ ] Push and open the PR:
  ```bash
  git push -u origin feat/ytg-record-sale
  gh pr create --base main --title "feat(ytg): Record sale — crash-safe deck-sale inventory decrements (WS-4)" --body "$(cat <<'EOF'
  ## Summary

  WS-4 of the YTG Store plan set (spec §Record sale + Addendum 2026-08-04). Selling a deck product now decrements the mapped singles' inventory with a full safety protocol:

  - **Live preview** (`previewSale`): deck contents read `zone IN ('main','reserve')` summed per card_key; confirmed mappings (`auto_matched`/`manual`); quantities from live Shopify (`fetchProductInventory`), never the mirror. Flags: unmapped (Fix in Matching link), untracked, would-go-negative (explicit ack required).
  - **Snapshot confirm** (`confirmSale`): deck-changed check via `decks.updated_at`; sale inserted `pending` (partial unique index → "sale in progress" with who/when); items snapshotted with `qty_before`/`qty_after` CAS anchors incl. skipped rows; dry-run short-circuit when `YTG_INVENTORY_WRITES` is unset; CAS `pending→applying` claim.
  - **Crash-safe apply** (`applySale`/`resumeSale`): items flip to `applying` BEFORE each Shopify call; `inventoryAdjustQuantities` carries the mandatory `@idempotent(key:)` directive (2026-07-verified placement) and mandatory `changeFromQuantity` CAS; `ITEM_NOT_STOCKED_AT_LOCATION` → `inventoryActivate(available: 0)` then retry; single-active-location asserted. Resume oracle: live == qty_after → applied, == qty_before → re-apply (identical payload ⇒ identical key ⇒ server-side dedupe), else conflict. Keys are the spec's `sale:<id>:batch:<n>` / `undo:<id>:batch:<n>` bases plus a deterministic payload fingerprint (Shopify rejects key reuse with different parameters).
  - **Derived statuses**, per-row retry with fresh anchors, **single-shot undo** (`undoSale`, `applied|partial→undoing` CAS, `+|delta|` with `changeFromQuantity = qty_after`, conflicts never stack stock), history with dry-runs segregated ("recorded before inventory writes were enabled — not applied") and undo absent on dry-runs.
  - UI extends the Decks tab least-invasively: `Record sale` link on linked rows, `/admin/ytg/decks/[productId]/sale` route, history section.
  - `buildCardKey` extracted from `lib/pricing/matching.ts` so the ledger and matcher can never drift.

  Migrations 088/089 were already applied — this PR ships no DDL. `YTG_INVENTORY_WRITES` remains unset everywhere until the `write_inventory` scope is granted; every mutation short-circuits to mock success until then.

  ## Test plan

  - `npm test` — new suites: `lib/shopify/inventory.test.ts` (mutation-string construction: directive placement, key format, `changeFromQuantity` null-vs-number; write gating; location assertion; 250-chunking), `lib/ytg/__tests__/saleStateMachine.test.ts` (every enum branch of classify/derive/oracle), `lib/ytg/__tests__/saleApply.test.ts` (planner crash scenarios: ack-then-crash resumes without re-adjusting; crash-before-call re-applies under the byte-identical key; third-party movement conflicts; undo ordinal stability).
  - `npx tsc --noEmit` — zero new errors vs the 7-error baseline.
  - Dry-run e2e checklist executed (ledger rows inspected, WS-3 replace-guard interplay, two-tab race); post-scope-grant checklist documented in `docs/superpowers/plans/2026-08-03-ytg-store/ws4-record-sale.md` Task 10 for the first real sale + undo.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```
- [ ] Report the PR URL and stop. Do not merge; do not touch `YTG_INVENTORY_WRITES` anywhere.

---

### Critical Files for Implementation

- /Users/timestes/projects/redemption-tournament-tracker/docs/superpowers/specs/2026-08-03-ytg-store-admin-design.md (§Record sale + Addendum — behavioral authority)
- /Users/timestes/projects/redemption-tournament-tracker/supabase/migrations/089_ytg_deck_links_and_sales.sql (applied ledger shapes this plan writes to)
- /Users/timestes/projects/redemption-tournament-tracker/lib/shopify/admin-write.ts (`shopifyGraphQL` transport the new inventory client rides)
- /Users/timestes/projects/redemption-tournament-tracker/lib/pricing/shopify.ts (`fetchProductInventory` live reads + `getShopifyAccessToken`)
- /Users/timestes/projects/redemption-tournament-tracker/app/admin/ytg/decks/actions.ts (WS-3 patterns and the replace-guard contract the sale schema must keep true)
