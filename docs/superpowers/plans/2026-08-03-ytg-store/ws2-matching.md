# WS-2: Matching Tab — Deterministic-First Reconciliation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task-by-task with review checkpoints. Read `docs/superpowers/plans/2026-08-03-ytg-store/00-overview.md` and `docs/superpowers/specs/2026-08-03-ytg-store-admin-design.md` §Matching tab in full before Task 1. The spec is the verbatim authority on behavior.

**Goal:** Make card↔product matching deterministic-first: a new protection-exempt Pass 0 matches on `shopify_products.sku` via `cardSku()`; a one-time SKU/metafield backfill seeds ~4.8k products so every future sync self-matches; re-mapping clears stale identity off old products; an ability-text signal disambiguates fuzzy passes; and the Matching tab ships a dashboard, backfill panel, and keyboard-driven review queue.

**Architecture:** Pass 0 and the ability-text signal live inside the existing pipeline in `lib/pricing/matching.ts` (restructured so Pass 0 runs before the protected-key skip; `writeResults`' manual/no_price_exists refetch-filter remains the write-layer guard). Shopify writes (variant SKU via `productVariantsBulkUpdate`, `custom.rtt_card_key` via `metafieldsSet`/`metafieldsDelete`) go through `runAliasedMutations` (WS-0's `lib/shopify/aliasBatch.ts`) and `shopifyGraphQL` (2026-07), driven by server actions co-located in `app/admin/ytg/matching/actions.ts`. The UI replaces WS-0's skeleton page and consumes the existing (now WS-0-authed) `/api/admin/*` matching routes.

**Tech Stack:** Next.js 15 App Router, React 19, TS (`strict:false` — use explicit `=== false` comparisons), Supabase service-role via `lib/pricing/supabase-admin`, Shopify GraphQL Admin 2026-07 via `lib/shopify/admin-write.ts`, Tailwind + shadcn/ui (`components/ui/button|input|badge`), lucide-react, vitest.

**Global Constraints** (inherit all of overview §Global constraints, plus):
- Branch `feat/ytg-matching`, worktree `../rtt-ytg-matching` (absolute path `/Users/timestes/projects/rtt-ytg-matching`), created from `origin/main` **after WS-0 has merged** (verify `lib/shopify/aliasBatch.ts` and `app/admin/ytg/matching/page.tsx` exist on `origin/main` before starting; if not, stop and report).
- All work with absolute paths inside the worktree; never touch the main checkout; `git add` only the specific files named per task; PR bases `origin/main`.
- Permission key `manage_shopify_imports` re-checked in every server action (layout gating does not protect actions).
- `SHOPIFY_WRITE_MOCK=1` short-circuits every Shopify write path added here.
- GraphQL pinned 2026-07; never use `productSet` for the backfill; SKU lives at `inventoryItem.sku` in `ProductVariantsBulkInput` — top-level `sku` is a `ShopifyProductSetInput`-only shape (documented trap).
- No `focus:ring-2`; no 1px borders for sectioning (background shifts per `prompt_context/design_system.md`); green accent only for hover/active/CTAs.
- Tests: `npx vitest run <path>`; type gate `npx tsc --noEmit`. Never `next build` while a dev server runs.
- Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Worktree setup and baseline

**Files:** none created (environment only)

**Interfaces:** consumes overview contracts — verify they landed: `lib/shopify/aliasBatch.ts` (`runAliasedMutations(calls, opts?) → Promise<AliasedResult[]>`), `shopify_products.sku` + `body_html` columns (migration 088), skeleton `app/admin/ytg/matching/page.tsx`, `hasPermission` 403s on the five matching routes.

- [ ] Create the worktree:
  ```bash
  cd /Users/timestes/projects/redemption-tournament-tracker
  git fetch origin
  git worktree add /Users/timestes/projects/rtt-ytg-matching -b feat/ytg-matching origin/main
  ```
- [ ] Verify WS-0 landed (all four must exist; stop and report if any is missing):
  ```bash
  ls /Users/timestes/projects/rtt-ytg-matching/lib/shopify/aliasBatch.ts
  ls /Users/timestes/projects/rtt-ytg-matching/app/admin/ytg/matching/page.tsx
  grep -l "sku" /Users/timestes/projects/rtt-ytg-matching/supabase/migrations/088_*.sql
  grep -n "hasPermission" /Users/timestes/projects/rtt-ytg-matching/app/api/admin/review-queue/route.ts
  ```
- [ ] Read the merged `lib/shopify/aliasBatch.ts` in full — confirm the exported signature matches the overview contract and note whether it short-circuits on `SHOPIFY_WRITE_MOCK` internally (Task 7's actions add their own explicit guard either way, mirroring `productSetUpsert`'s pattern at `lib/shopify/admin-write.ts:113`).
- [ ] Install deps and copy env (the validation script and any live poking need it):
  ```bash
  cd /Users/timestes/projects/rtt-ytg-matching && npm install
  cp /Users/timestes/projects/redemption-tournament-tracker/.env.local /Users/timestes/projects/rtt-ytg-matching/.env.local
  ```
- [ ] Baseline gates — expected: both pass on a fresh `origin/main`:
  ```bash
  npx tsc --noEmit
  npx vitest run lib/pricing/__tests__/matching.test.ts lib/shopify/productFromCard.test.ts
  ```
- [ ] No commit for this task.

---

### Task 2: `cardSku` seam widening + collision-guard test

**Files:**
- `lib/shopify/productFromCard.ts` (edit `cardSku`, ~L56–58)
- `lib/shopify/productFromCard.test.ts` (append)

**Interfaces:**
- Produced: `export function cardSku(card: Pick<CardData, 'set' | 'imgFile'>): string` — widened from `CardData` so `lib/pricing/matching.ts` (which holds `CardRow`, not `CardData`) and `skuFromCardKey` can call it without fabricating a full `CardData`. Every existing caller passes a full `CardData`, which satisfies the `Pick` — zero behavior change.
- Import-cycle check (done during planning, re-verify in the worktree): `productFromCard.ts` imports only `lib/cards/generated/cardData` (type), `app/decklist/card-search/utils` (→ only `./constants`), and `app/shared/utils/cardImageUrl` (no imports). None import `lib/pricing/*` at runtime — importing `cardSku` from `lib/pricing/matching.ts` creates **no cycle**, so the `lib/shopify/sku.ts` extraction fallback is not needed. If WS-0/WS-1 merges changed this (re-run the grep below and find a `lib/pricing` import in that chain), instead move `cardSku` to a new `lib/shopify/sku.ts` and re-export it from `productFromCard.ts` (`export { cardSku } from './sku';`) so the old import path keeps working.
  ```bash
  grep -rn "from '@/lib/pricing" /Users/timestes/projects/rtt-ytg-matching/app/decklist/card-search/utils.ts /Users/timestes/projects/rtt-ytg-matching/app/decklist/card-search/constants.ts /Users/timestes/projects/rtt-ytg-matching/app/shared/utils/cardImageUrl.ts
  ```
  Expected: no output.

- [ ] **TDD — write the collision-guard test first.** Append to `lib/shopify/productFromCard.test.ts`:
  ```ts
  import { CARDS } from '@/lib/cards/lookup';

  describe('cardSku collision guard', () => {
    it('collides for exactly one known pair: Angel of the Lord (G)/(H), both 10A, shared imgFile', () => {
      // Spec §Matching tab: this collision is inert — 10A is in UNSOLD_SETS → no_price_exists.
      // If card data ever grows a SECOND collision, pass 0 could silently mis-match; this test is the tripwire.
      const bySku = new Map<string, string[]>();
      for (const c of CARDS) {
        const sku = cardSku(c);
        const list = bySku.get(sku) ?? [];
        list.push(`${c.name}|${c.set}|${c.imgFile}`);
        bySku.set(sku, list);
      }
      const collisions = [...bySku.entries()].filter(([, keys]) => keys.length > 1);
      expect(collisions).toHaveLength(1);
      expect(collisions[0][0]).toBe('10A-Angel_of_the_Lord_(G)');
      expect(collisions[0][1].map(k => k.split('|')[0]).sort()).toEqual([
        'Angel of the Lord (G)',
        'Angel of the Lord (H)',
      ]);
    });
  });
  ```
  (Add `cardSku` to the file's existing import from `./productFromCard` if not already imported.)
- [ ] Run: `npx vitest run lib/shopify/productFromCard.test.ts` — expected: the new test **passes already** (collision verified against current card data during planning: exactly one duplicate key, `10A-Angel_of_the_Lord_(G)`). If it fails, card data changed since planning — investigate before proceeding; do not weaken the assertion.
- [ ] Widen the seam in `lib/shopify/productFromCard.ts` (~L56):
  ```ts
  export function cardSku(card: Pick<CardData, 'set' | 'imgFile'>): string {
    return `${card.set}-${sanitizeImgFile(card.imgFile)}`.replace(/\s+/g, '');
  }
  ```
- [ ] Run: `npx vitest run lib/shopify/productFromCard.test.ts && npx tsc --noEmit` — expected: all pass.
- [ ] Commit:
  ```bash
  git add lib/shopify/productFromCard.ts lib/shopify/productFromCard.test.ts
  git commit -m "feat(matching): widen cardSku to Pick<CardData> + collision-guard test

  Exactly one known cardSku collision exists (Angel of the Lord (G)/(H), 10A,
  shared imgFile) — inert because 10A is UNSOLD. Tripwire test locks it.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 3: Pass 0 (SKU identity, protection-exempt) in the pipeline

**Files:**
- `lib/pricing/types.ts` (edit `ShopifyProductRow` L30–40, `MatchingSummary` L82–90)
- `lib/pricing/matching.ts` (edit imports L1–9; `loadShopifyProducts` L98–126; `runMatchingPipeline` L667–708 region; export `writeResults` L870; new `pass0Sku` inserted above `pass1Exact` ~L152)
- `lib/pricing/__tests__/pass0.test.ts` (new)

**Interfaces:**
- Consumed: `cardSku(card: Pick<CardData, 'set'|'imgFile'>): string` from `@/lib/shopify/productFromCard` (Task 2).
- Produced:
  ```ts
  export function cardSkuFromRow(card: CardRow): string;
  export function pass0Sku(cards: CardRow[], bySku: Map<string, ShopifyProductRow[]>): MatchResult[];
  export async function writeResults(results: MatchResult[]): Promise<void>;  // now exported (test seam)
  // runMatchingPipeline options gains nothing here beyond pass id 0; defaults become [0,1,2,3,4]
  ```
- Semantics locked by spec: `match_method: 'sku'`, `confidence: 1.0`, `status: 'auto_matched'` (the pipeline's "matched" status literal — a new `'matched'` literal would break `regenerateCardPrices`' `IN ('auto_matched','manual')` filter at L943). Duplicate SKUs (2+ products, same sku) → `status: 'needs_review'`, `match_method: 'sku_duplicate'`, `confidence: 0`.

- [ ] Update `lib/pricing/types.ts` — add the 088 columns and the dry-run results channel (needed by Task 5's script):
  ```ts
  // in ShopifyProductRow, after raw_json:
    sku: string | null;        // migration 088; written by sync + SKU backfill
    body_html: string | null;  // migration 088; ability text source
  ```
  ```ts
  // in MatchingSummary, after noPriceCards:
    results?: MatchResult[];   // populated only on dryRun — validation tooling reads per-method detail
  ```
- [ ] **TDD — write `lib/pricing/__tests__/pass0.test.ts` first.** It unit-tests `pass0Sku` and drives `runMatchingPipeline` end-to-end through a stubbed `getSupabaseAdmin` (the seam that exists: `matching.ts` reaches Supabase exclusively through `getSupabaseAdmin()` from `./supabase-admin`, so `vi.mock` of that module controls every loader **and** the `writeResults` path):
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest';

  let currentStub: any;
  vi.mock('../supabase-admin', () => ({ getSupabaseAdmin: () => currentStub }));

  import { pass0Sku, cardSkuFromRow, runMatchingPipeline, writeResults } from '../matching';
  import { cardSku } from '@/lib/shopify/productFromCard';
  import { CARDS } from '@/lib/cards/lookup';
  import { UNSOLD_SETS } from '../helpers';
  import type { CardRow, ShopifyProductRow, MatchResult } from '../types';

  function makeProduct(overrides: Partial<ShopifyProductRow>): ShopifyProductRow {
    return {
      id: 'p1', title: 'T', handle: 'h', tags: null, product_type: 'Single',
      price: 1, inventory_quantity: 0, raw_json: null, sku: null, body_html: null,
      last_synced_at: new Date().toISOString(), ...overrides,
    };
  }
  function makeCard(overrides: Partial<CardRow>): CardRow {
    return {
      name: 'N', set_code: 'S', img_file: 'N.jpg', official_set: '', type: '',
      brigade: '', rarity: '', special_ability: '', card_key: 'N|S|N.jpg', ...overrides,
    };
  }
  function bySkuMap(products: ShopifyProductRow[]): Map<string, ShopifyProductRow[]> {
    const m = new Map<string, ShopifyProductRow[]>();
    for (const p of products) {
      const s = (p.sku ?? '').trim();
      if (!s) continue;
      const list = m.get(s);
      if (list) list.push(p); else m.set(s, [p]);
    }
    return m;
  }

  /**
   * Minimal supabase stub covering every chain matching.ts uses:
   *  - from('set_aliases').select('*')                              (awaited select — thenable)
   *  - from('shopify_products').select('*').eq(...).range(...)      (loadShopifyProducts)
   *  - from('card_price_mappings').select(...).or(...).range(...)   (loadProtectedKeys)
   *  - from('card_price_mappings').select(...).in(...).range(...)   (writeResults manual refetch)
   *  - from('card_price_mappings').select(...).in(...).not(...).range(...)  (regenerateCardPrices → return [])
   *  - from('card_price_mappings').upsert(batch, opts)              (captured)
   */
  function makeSupabaseStub(opts: {
    products: ShopifyProductRow[];
    mappings: { card_key: string; status: string; confidence?: number }[];
  }) {
    const upserts: any[][] = [];
    function makeQuery(table: string) {
      const q: any = { _or: false, _in: null as null | { col: string; vals: string[] }, _not: false };
      const resolve = () => {
        if (table === 'set_aliases') return [];
        if (table === 'shopify_products') return opts.products;
        if (table === 'card_price_mappings') {
          if (q._not) return []; // regenerateCardPrices query → early "no confirmed mappings" return
          if (q._or) {
            return opts.mappings
              .filter(m => m.status === 'manual' || m.status === 'no_price_exists'
                || (m.status === 'auto_matched' && (m.confidence ?? 0) >= 0.95))
              .map(m => ({ card_key: m.card_key }));
          }
          if (q._in && q._in.col === 'status') {
            return opts.mappings.filter(m => q._in!.vals.includes(m.status)).map(m => ({ card_key: m.card_key }));
          }
          return [];
        }
        return [];
      };
      q.select = () => q;
      q.eq = () => q;
      q.or = () => { q._or = true; return q; };
      q.in = (col: string, vals: string[]) => { q._in = { col, vals }; return q; };
      q.not = () => { q._not = true; return q; };
      q.order = () => q;
      q.range = (from: number) => Promise.resolve({ data: from > 0 ? [] : resolve(), error: null });
      q.then = (onOk: any) => Promise.resolve({ data: resolve(), error: null }).then(onOk); // awaited-select support
      q.upsert = (batch: any[]) => { upserts.push(batch); return Promise.resolve({ error: null }); };
      q.update = () => ({ eq: () => Promise.resolve({ error: null }), not: () => Promise.resolve({ error: null }) });
      return q;
    }
    return { from: (t: string) => makeQuery(t), rpc: async () => ({ data: [], error: null }), __upserts: upserts };
  }

  // A real, deterministic, sellable card — pass 0 computes its sku from CARDS data.
  const realCard = CARDS.find(c => !UNSOLD_SETS.has(c.set) && !/\bToken\b/.test(c.name))!;
  const realKey = `${realCard.name}|${realCard.set}|${realCard.imgFile}`;
  const realSku = cardSku(realCard);

  describe('pass0Sku (unit)', () => {
    it('matches a card to the product carrying its cardSku: method sku, confidence 1.0, auto_matched', () => {
      const card = makeCard({ name: 'Aaron', set_code: 'RoA 3', img_file: 'Aaron.jpg', card_key: 'Aaron|RoA 3|Aaron.jpg' });
      // cardSku strips ALL whitespace: "RoA 3" → "RoA3-Aaron"
      expect(cardSkuFromRow(card)).toBe('RoA3-Aaron');
      const products = [makeProduct({ id: '111', sku: 'RoA3-Aaron' })];
      const results = pass0Sku([card], bySkuMap(products));
      expect(results).toEqual([{
        card_key: 'Aaron|RoA 3|Aaron.jpg', card_name: 'Aaron', set_code: 'RoA 3',
        shopify_product_id: '111', confidence: 1.0, match_method: 'sku', status: 'auto_matched',
      }]);
    });

    it('duplicate SKU (2+ products) → needs_review / sku_duplicate / confidence 0, never auto-picks', () => {
      const card = makeCard({ name: 'Eve', set_code: 'Pi', img_file: 'Eve.jpg', card_key: 'Eve|Pi|Eve.jpg' });
      const products = [makeProduct({ id: '222', sku: 'Pi-Eve' }), makeProduct({ id: '333', sku: 'Pi-Eve' })];
      const [r] = pass0Sku([card], bySkuMap(products));
      expect(r.status).toBe('needs_review');
      expect(r.match_method).toBe('sku_duplicate');
      expect(r.confidence).toBe(0);
      expect(r.shopify_product_id).toBe('222'); // deterministic: lowest id, a review suggestion only
    });

    it('no sku hit → no result (card falls through to later passes)', () => {
      const card = makeCard({});
      expect(pass0Sku([card], bySkuMap([makeProduct({ id: '1', sku: 'Other-Sku' })]))).toEqual([]);
    });
  });

  describe('runMatchingPipeline pass 0 wiring (stubbed supabase)', () => {
    beforeEach(() => { currentStub = null; });

    it('CORRECTION CASE: pass 0 re-matches a protected auto_matched(≥0.95) card to a different product', async () => {
      currentStub = makeSupabaseStub({
        products: [makeProduct({ id: 'NEW-PRODUCT', sku: realSku })],
        mappings: [{ card_key: realKey, status: 'auto_matched', confidence: 0.96 }], // in loadProtectedKeys' set
      });
      await runMatchingPipeline({ passes: [0], setCodes: [realCard.set] });
      const rows = currentStub.__upserts.flat();
      const row = rows.find((r: any) => r.card_key === realKey);
      expect(row).toBeDefined(); // protection-EXEMPT: pass 0 ran despite auto_matched ≥ 0.95
      expect(row.shopify_product_id).toBe('NEW-PRODUCT');
      expect(row.match_method).toBe('sku');
      expect(row.status).toBe('auto_matched');
    });

    it('MANUAL rows are never overwritten end-to-end (writeResults refetch-filter drops them)', async () => {
      currentStub = makeSupabaseStub({
        products: [makeProduct({ id: 'NEW-PRODUCT', sku: realSku })],
        mappings: [{ card_key: realKey, status: 'manual' }],
      });
      await runMatchingPipeline({ passes: [0], setCodes: [realCard.set] });
      const rows = currentStub.__upserts.flat();
      // pass 0 produced a result for the manual card (exemption), but writeResults filtered it
      expect(rows.find((r: any) => r.card_key === realKey)).toBeUndefined();
    });

    it('writeResults (direct): filters manual + no_price_exists keys, writes the rest', async () => {
      currentStub = makeSupabaseStub({
        products: [],
        mappings: [{ card_key: 'M|S|f', status: 'manual' }, { card_key: 'NP|S|f', status: 'no_price_exists' }],
      });
      const results: MatchResult[] = [
        { card_key: 'M|S|f', card_name: 'M', set_code: 'S', shopify_product_id: '1', confidence: 1, match_method: 'sku', status: 'auto_matched' },
        { card_key: 'NP|S|f', card_name: 'NP', set_code: 'S', shopify_product_id: '2', confidence: 1, match_method: 'sku', status: 'auto_matched' },
        { card_key: 'OK|S|f', card_name: 'OK', set_code: 'S', shopify_product_id: '3', confidence: 1, match_method: 'sku', status: 'auto_matched' },
      ];
      await writeResults(results);
      const rows = currentStub.__upserts.flat();
      expect(rows.map((r: any) => r.card_key)).toEqual(['OK|S|f']);
    });
  });
  ```
- [ ] Run: `npx vitest run lib/pricing/__tests__/pass0.test.ts` — expected: **fails** (`pass0Sku`, `cardSkuFromRow`, `writeResults` not exported; `sku` missing from type).
- [ ] Implement in `lib/pricing/matching.ts`:
  1. Add import (top of file, with the other `@/lib` imports):
     ```ts
     import { cardSku } from '@/lib/shopify/productFromCard';
     ```
  2. Extend `loadShopifyProducts` (L98–126) — keep `select('*')` (it now returns the 088 columns) and the `.eq('product_type', 'Single')` filter; add `bySku` and `byId` to the return:
     ```ts
     async function loadShopifyProducts(): Promise<{
       byNormalizedTitle: Map<string, ShopifyProductRow>;
       bySku: Map<string, ShopifyProductRow[]>;
       byId: Map<string, ShopifyProductRow>;
       all: ShopifyProductRow[];
     }> {
       // ... existing pagination loop unchanged ...
       const byNormalizedTitle = new Map<string, ShopifyProductRow>();
       const bySku = new Map<string, ShopifyProductRow[]>();
       const byId = new Map<string, ShopifyProductRow>();
       for (const p of allProducts) {
         const cleanTitle = stripShopifySuffixes(p.title);
         byNormalizedTitle.set(normalize(cleanTitle), p);
         byId.set(p.id, p);
         const sku = (p.sku ?? '').trim();
         if (sku) {
           const list = bySku.get(sku);
           if (list) list.push(p); else bySku.set(sku, [p]);
         }
       }
       return { byNormalizedTitle, bySku, byId, all: allProducts };
     }
     ```
  3. Add Pass 0 above `pass1Exact` (~L152):
     ```ts
     /** Expected SKU for a pipeline CardRow — always via cardSku() (strips ALL whitespace:
      *  "RoA 3" → "RoA3-..."). Never string-build `${set}-${imgFile}`. */
     export function cardSkuFromRow(card: CardRow): string {
       return cardSku({ set: card.set_code, imgFile: card.img_file });
     }

     /**
      * Pass 0: exact SKU identity. Deterministic — importer/backfill wrote cardSku(card)
      * onto the product's variant; the mirror's sku column round-trips it.
      *
      * PROTECTION-EXEMPT by design (spec §Matching tab): loadProtectedKeys covers
      * auto_matched ≥ 0.95, and nearly every match sits there — a pass 0 gated by it
      * could never correct a confident-but-wrong fuzzy match. writeResults' re-fetched
      * manual/no_price_exists filter remains the write-layer guard.
      *
      * Duplicate SKUs (2+ products): a data bug (see backfill hygiene) — surface as
      * needs_review/sku_duplicate, never auto-pick. The carried product id is the
      * lowest-id duplicate, purely as a review-queue suggestion.
      */
     export function pass0Sku(
       cards: CardRow[],
       bySku: Map<string, ShopifyProductRow[]>
     ): MatchResult[] {
       const out: MatchResult[] = [];
       for (const card of cards) {
         const candidates = bySku.get(cardSkuFromRow(card));
         if (!candidates || candidates.length === 0) continue;
         if (candidates.length > 1) {
           const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
           out.push({
             card_key: card.card_key, card_name: card.name, set_code: card.set_code,
             shopify_product_id: sorted[0].id, confidence: 0,
             match_method: 'sku_duplicate', status: 'needs_review',
           });
           continue;
         }
         out.push({
           card_key: card.card_key, card_name: card.name, set_code: card.set_code,
           shopify_product_id: candidates[0].id, confidence: 1.0,
           match_method: 'sku', status: 'auto_matched',
         });
       }
       return out;
     }
     ```
  4. Restructure `runMatchingPipeline` (L667–708 region):
     - L673: `const passes = options?.passes ?? [0, 1, 2, 3, 4];`
     - After the set-code filter (L692) and summary init, insert Phase 0 **before** the Phase 1 loop:
       ```ts
       // ── Phase 0: SKU identity (runs against ALL cards, INCLUDING protected keys) ──
       const pass0Handled = new Set<string>();
       if (passes.includes(0)) {
         log('Running pass 0 (SKU identity, protection-exempt)...');
         const pass0Results = pass0Sku(filteredCards, shopify.bySku);
         let dupCount = 0;
         for (const r of pass0Results) {
           results.push(r);
           pass0Handled.add(r.card_key);
           if (r.status === 'auto_matched') summary.matched++;
           else { summary.needs_review++; dupCount++; }
         }
         log(`Pass 0 done: ${pass0Results.length} SKU hits (${dupCount} duplicate-SKU → needs_review)`);
       }
       ```
     - Phase 1 loop head (L707–708) becomes:
       ```ts
       for (const card of filteredCards) {
         if (pass0Handled.has(card.card_key)) continue;   // pass 0 already decided this card
         if (protectedKeys.has(card.card_key)) continue;  // protection applies to passes 1-4 only
       ```
     - Immediately before the final `return summary;` (L864): `if (dryRun) summary.results = results;`
  5. Export the write-layer guard as the test seam (L870): `export async function writeResults(...)` — body untouched (its manual/`no_price_exists` refetch-filter is load-bearing and force-proof; do not modify it).
- [ ] Run: `npx vitest run lib/pricing/__tests__/pass0.test.ts` — expected: all 6 tests pass. Then `npx vitest run lib/pricing/__tests__/matching.test.ts && npx tsc --noEmit` — expected: no regressions.
- [ ] Commit:
  ```bash
  git add lib/pricing/types.ts lib/pricing/matching.ts lib/pricing/__tests__/pass0.test.ts
  git commit -m "feat(matching): pass 0 SKU identity — protection-exempt, duplicate SKUs to review

  Runs before loadProtectedKeys' skip so a confident-but-wrong fuzzy match can
  be corrected; writeResults' refetched manual/no_price_exists filter stays the
  write-layer guard (tested end-to-end through a stubbed supabase).

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 4: Ability-text signal in fuzzy disambiguation

**Files:**
- `lib/pricing/abilityText.ts` (new — pure, client-safe)
- `lib/pricing/__tests__/abilityText.test.ts` (new)
- `lib/pricing/matching.ts` (edit `pass3and4Fuzzy` signature + candidate loop L524–610; batch call site L799–804; `runMatchingPipeline` options L667–675)

**Interfaces:**
- Produced (`lib/pricing/abilityText.ts`):
  ```ts
  export function stripHtmlToText(html: string | null | undefined): string;
  export function tokenSet(text: string): Set<string>;
  export function abilityTextScore(cardAbility: string, bodyText: string): number; // Jaccard, 0..1
  ```
- `runMatchingPipeline` options gains `abilityText?: boolean` (default **true**; `false` disables the signal — the validation script's A/B switch).
- `pass3and4Fuzzy` gains params `(card, shopifyAbbrev, productById?: Map<string, ShopifyProductRow>, useAbilityText?: boolean)` — internal function, no external consumers.
- Invariant: the signal is **additive only**. It can never reduce a candidate's score, and when `body_html` is empty/null or the flag is off, scoring is byte-identical to today.

- [ ] **TDD — write `lib/pricing/__tests__/abilityText.test.ts` first:**
  ```ts
  import { describe, it, expect } from 'vitest';
  import { stripHtmlToText, tokenSet, abilityTextScore } from '../abilityText';

  describe('stripHtmlToText', () => {
    it('strips tags and collapses whitespace', () => {
      expect(stripHtmlToText('<p>Negate  Evil\nCharacters.</p>')).toBe('Negate Evil Characters.');
    });
    it('decodes named entities the importer writes (escapeHtml output)', () => {
      // productFromCard.escapeHtml emits &amp; &lt; &gt; &quot; &#39;
      expect(stripHtmlToText('<p>Discard &amp; draw. Don&#39;t negate. &quot;Hold&quot;</p>'))
        .toBe('Discard & draw. Don\'t negate. "Hold"');
    });
    it('decodes smart-quote entities AND passes literal smart quotes through (both occur in real YTG data)', () => {
      // Live YTG bodies carry literal ’/“ (398/118 occurrences in tmp/products_export_1.csv);
      // entity-encoded forms appear in hand-edited descriptions.
      expect(stripHtmlToText('<p>opponents&rsquo; cards</p>')).toBe('opponents\u2019 cards');
      expect(stripHtmlToText('<p>&#8220;He is Risen&#8221;</p>')).toBe('\u201CHe is Risen\u201D');
      expect(stripHtmlToText('<p>opponents’ cards</p>')).toBe('opponents’ cards');
    });
    it('returns empty string for null/undefined/empty', () => {
      expect(stripHtmlToText(null)).toBe('');
      expect(stripHtmlToText(undefined)).toBe('');
      expect(stripHtmlToText('')).toBe('');
    });
  });

  describe('tokenSet', () => {
    it('lowercases, drops stopwords, normalizes smart apostrophes so “opponents’” == "opponents\'"', () => {
      const t = tokenSet('Protect your hand and deck from opponents’ cards.');
      expect(t.has('protect')).toBe(true);
      expect(t.has('opponents\'')).toBe(true);
      expect(t.has('your')).toBe(false); // stopword
      expect(t.has('and')).toBe(false);  // stopword
    });
  });

  describe('abilityTextScore', () => {
    it('identical ability text scores 1', () => {
      const s = 'Negate Evil Characters. If alone, you may choose a human to block.';
      expect(abilityTextScore(s, s)).toBe(1);
    });
    it('disjoint text scores 0; empty either side scores 0', () => {
      expect(abilityTextScore('Discard a Hero', 'Protect deck sites')).toBe(0);
      expect(abilityTextScore('Discard a Hero', '')).toBe(0);
      expect(abilityTextScore('', 'Protect deck')).toBe(0);
    });
    it('partial overlap lands strictly between 0 and 1', () => {
      const s = abilityTextScore('Discard a Hero in a territory', 'Discard a Hero to draw two cards');
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(1);
    });
  });
  ```
- [ ] Run: `npx vitest run lib/pricing/__tests__/abilityText.test.ts` — expected: fails (module missing).
- [ ] Create `lib/pricing/abilityText.ts`:
  ```ts
  /**
   * Pure helpers: strip product body_html to comparable text and score token
   * overlap against a card's special ability. Client-safe (no server deps) —
   * the review-queue UI reuses stripHtmlToText for display.
   */

  const NAMED_ENTITIES: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201D', ldquo: '\u201C',
    ndash: '\u2013', mdash: '\u2014', hellip: '\u2026',
  };

  export function stripHtmlToText(html: string | null | undefined): string {
    if (!html) return '';
    let text = html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    text = text.replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)));
    text = text.replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)));
    text = text.replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
    return text.replace(/\s+/g, ' ').trim();
  }

  // Small, ability-text-tuned stopword list — connective glue that appears in
  // nearly every Redemption ability and carries no discriminating signal.
  const STOPWORDS = new Set([
    'a', 'an', 'the', 'of', 'to', 'in', 'on', 'or', 'and', 'is', 'are', 'be',
    'you', 'your', 'may', 'if', 'it', 'its', 'this', 'that', 'from', 'with',
    'for', 'at', 'by', 'not', 'cannot',
  ]);

  export function tokenSet(text: string): Set<string> {
    const normalized = text.toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"');
    const words = normalized.match(/[a-z0-9']+/g) ?? [];
    const out = new Set<string>();
    for (const w of words) if (!STOPWORDS.has(w)) out.add(w);
    return out;
  }

  /** Jaccard similarity of stopword-filtered token sets. 0 when either side is empty. */
  export function abilityTextScore(cardAbility: string, bodyText: string): number {
    const a = tokenSet(cardAbility);
    const b = tokenSet(bodyText);
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
  }
  ```
- [ ] Run: `npx vitest run lib/pricing/__tests__/abilityText.test.ts` — expected: all pass.
- [ ] Wire into `lib/pricing/matching.ts`:
  1. Import: `import { stripHtmlToText, abilityTextScore } from './abilityText';`
  2. `pass3and4Fuzzy` signature (L524–527):
     ```ts
     async function pass3and4Fuzzy(
       card: CardRow,
       shopifyAbbrev: string | undefined,
       productById?: Map<string, ShopifyProductRow>,
       useAbilityText: boolean = true
     ): Promise<MatchResult | null> {
     ```
  3. In the candidate loop, after the existing brigade/type tag boosts (L599–605) and before the `bestCandidate` comparison (L607) — matching the existing flat additive-boost style (+0.3 set-in-title, +0.2 set-tag, +0.1 brigade, +0.1 type):
     ```ts
     // Ability-text signal: ADDITIVE ONLY. Empty/missing body_html or a disabled
     // flag leaves boostedScore untouched — behavior is byte-identical to the
     // pre-signal pipeline in those cases. Tiered like the tag boosts above.
     if (useAbilityText && card.special_ability && productById) {
       const row = productById.get(candidate.id);
       const bodyText = row && row.body_html ? stripHtmlToText(row.body_html) : '';
       if (bodyText) {
         const overlap = abilityTextScore(card.special_ability, bodyText);
         if (overlap >= 0.6) boostedScore += 0.15;
         else if (overlap >= 0.35) boostedScore += 0.08;
       }
     }
     ```
     (No other scoring/threshold lines change; `match_method: 'multi_signal'` already fires whenever `boostedScore > rawScore`.)
  4. `runMatchingPipeline`: options type gains `abilityText?: boolean;` after `dryRun`; add `const abilityTextEnabled = options?.abilityText !== false;` next to the other option reads (explicit `!== false` per tsconfig `strict:false` convention); batch call site (L802–803) becomes:
     ```ts
     batch.map(({ card, shopifyAbbrev }) =>
       pass3and4Fuzzy(card, shopifyAbbrev, shopify.byId, abilityTextEnabled).then(match => ({ card, match }))
     )
     ```
- [ ] Run: `npx vitest run lib/pricing && npx tsc --noEmit` — expected: all matching/pass0/abilityText tests pass, types clean.
- [ ] Commit:
  ```bash
  git add lib/pricing/abilityText.ts lib/pricing/__tests__/abilityText.test.ts lib/pricing/matching.ts
  git commit -m "feat(matching): ability-text signal in fuzzy disambiguation (additive only)

  body_html stripped/entity-decoded → Jaccard token overlap vs specialAbility,
  folded into pass3and4Fuzzy's additive boost style. options.abilityText=false
  disables it for A/B validation.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 5: Validation script `scripts/validate-matching.ts`

**Files:**
- `scripts/validate-matching.ts` (new)

**Interfaces:**
- Consumed: `runMatchingPipeline({ dryRun: true, abilityText })` + `MatchingSummary.results` (Task 3/4). Reads `.env.local` like `scripts/list-unmatched.ts` does. Optional offline cross-check corpus: `tmp/products_export_1.csv` (present, 2.4 MB; column 1 = `Handle`).
- Produced: a stdout report the executor pastes into the PR body (Task 9). No writes anywhere (`dryRun: true` twice).

- [ ] Create `scripts/validate-matching.ts`:
  ```ts
  #!/usr/bin/env npx tsx
  /**
   * A/B validation for the ability-text signal (spec §Matching tab).
   * Runs the pipeline dry-run twice — signal OFF, then ON — and prints
   * per-method counts plus a sample of card_keys whose outcome changed.
   * No thresholds ship without this report in the PR body.
   *
   * Usage: npx tsx scripts/validate-matching.ts
   */
  import { join } from 'path';
  import { existsSync, readFileSync } from 'fs';
  import { config } from 'dotenv';

  config({ path: join(__dirname, '..', '.env.local') });

  type Result = { card_key: string; shopify_product_id: string | null; match_method: string; status: string; confidence: number };

  function countBy(results: Result[], key: 'match_method' | 'status'): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of results) out[r[key]] = (out[r[key]] ?? 0) + 1;
    return out;
  }

  function printCounts(label: string, counts: Record<string, number>) {
    console.log(`\n${label}`);
    for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(28)} ${String(v).padStart(6)}`);
    }
  }

  async function main() {
    // Deferred import so dotenv runs before supabase-admin reads env
    const { runMatchingPipeline } = await import('../lib/pricing/matching');
    const { getSupabaseAdmin } = await import('../lib/pricing/supabase-admin');

    console.log('=== Run 1: ability-text signal DISABLED ===');
    const before = await runMatchingPipeline({ dryRun: true, abilityText: false });
    console.log('=== Run 2: ability-text signal ENABLED ===');
    const after = await runMatchingPipeline({ dryRun: true, abilityText: true });

    const beforeResults = (before.results ?? []) as Result[];
    const afterResults = (after.results ?? []) as Result[];

    printCounts('Per-method counts (signal OFF):', countBy(beforeResults, 'match_method'));
    printCounts('Per-method counts (signal ON): ', countBy(afterResults, 'match_method'));
    printCounts('Status counts (signal OFF):', countBy(beforeResults, 'status'));
    printCounts('Status counts (signal ON): ', countBy(afterResults, 'status'));

    const beforeByKey = new Map(beforeResults.map(r => [r.card_key, r]));
    const changed = afterResults.filter(r => {
      const b = beforeByKey.get(r.card_key);
      return b && (b.shopify_product_id !== r.shopify_product_id || b.status !== r.status || b.match_method !== r.match_method);
    });
    console.log(`\nChanged outcomes: ${changed.length}`);
    for (const r of changed.slice(0, 40)) {
      const b = beforeByKey.get(r.card_key)!;
      console.log(`  ${r.card_key}`);
      console.log(`    OFF: ${b.match_method}/${b.status} → ${b.shopify_product_id}  (${b.confidence})`);
      console.log(`    ON : ${r.match_method}/${r.status} → ${r.shopify_product_id}  (${r.confidence})`);
    }
    if (changed.length > 40) console.log(`  ... and ${changed.length - 40} more`);

    // Offline spot-check: every changed match should point at a product whose
    // handle exists in the store export (cheap sanity, skipped if CSV absent).
    const csvPath = join(__dirname, '..', 'tmp', 'products_export_1.csv');
    if (existsSync(csvPath) && changed.length > 0) {
      const handles = new Set(
        readFileSync(csvPath, 'utf-8').split('\n').slice(1)
          .map(line => line.split(',')[0]?.replace(/^"|"$/g, '').trim()).filter(Boolean)
      );
      const supabase = getSupabaseAdmin();
      const ids = changed.map(r => r.shopify_product_id).filter(Boolean).slice(0, 200);
      const { data } = await supabase.from('shopify_products').select('id, handle').in('id', ids);
      const handleById = new Map((data ?? []).map((p: any) => [p.id, p.handle]));
      let inCsv = 0, missing = 0;
      for (const r of changed.slice(0, 200)) {
        if (!r.shopify_product_id) continue;
        if (handles.has(handleById.get(r.shopify_product_id) ?? '')) inCsv++; else missing++;
      }
      console.log(`\nCSV spot-check (first 200 changed): ${inCsv} handles present in export, ${missing} not (new since export — expected small)`);
    }

    console.log('\nSummary deltas: matched %+d, needs_review %+d, unmatched %+d'
      .replace('%+d', fmt(after.matched - before.matched))
      .replace('%+d', fmt(after.needs_review - before.needs_review))
      .replace('%+d', fmt(after.unmatched - before.unmatched)));
    function fmt(n: number) { return (n >= 0 ? '+' : '') + n; }
  }

  main().catch(err => { console.error(err); process.exit(1); });
  ```
- [ ] Smoke-run against real data (read-only — both runs are `dryRun: true`):
  ```bash
  npx tsx scripts/validate-matching.ts
  ```
  Expected outcome: completes in a few minutes (fuzzy RPC calls dominate); prints both count tables and a changed-outcomes list. The ability-text signal must only move cards **up** (more `multi_signal`/`auto_matched`, fewer `needs_review`/`unmatched`); if `unmatched` increases, something violated the additive-only invariant — stop and debug via superpowers:systematic-debugging before proceeding. Save the full output — Task 9 pastes it into the PR body.
- [ ] Commit:
  ```bash
  git add scripts/validate-matching.ts
  git commit -m "feat(matching): A/B validation script for the ability-text signal

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 6: SKU backfill planner (pure logic + tests)

**Files:**
- `lib/shopify/skuBackfill.ts` (new)
- `lib/shopify/skuBackfill.test.ts` (new)

**Interfaces:**
- Consumed: `cardSku` (Task 2 `Pick` signature).
- Produced:
  ```ts
  export interface BackfillMappingRow {
    card_key: string; shopify_product_id: string;
    confidence: number | null; match_method: string | null; status: string;
  }
  export interface BackfillProductLite {
    id: string; sku: string | null;
    raw_json: { variants?: { id: number | string }[] } | null;
  }
  export interface BackfillRow {
    productId: string;    // mirror id (numeric string)
    productGid: string;   // gid://shopify/Product/<id>
    variantGid: string;   // gid://shopify/ProductVariant/<variants[0].id>
    cardKey: string; sku: string;
  }
  export interface BackfillSkip { productId: string; cardKey: string; reason: string; }
  export function skuFromCardKey(cardKey: string): string | null;
  export function planBackfillRows(
    mappings: BackfillMappingRow[],
    productsById: Map<string, BackfillProductLite>,
    existingSkuOwners: Map<string, string>,   // sku → product id, for products that ALREADY carry a sku
  ): { toWrite: BackfillRow[]; skippedPermanent: BackfillSkip[]; blocked: BackfillSkip[] };
  ```
- Primary-selection rule (spec §SKU backfill): per product with multiple confirmed mappings, primary = best by method preference `sku > exact > normalized > everything else`, ties broken by highest confidence. Non-primary mappings are `skippedPermanent` — **permanent by design, not a to-do list**. `blocked` (retryable after fixing data): missing variant in `raw_json`, malformed card_key, or the target sku already lives on a *different* product (writing it would manufacture the duplicate-SKU bug pass 0 exists to catch).

- [ ] **TDD — write `lib/shopify/skuBackfill.test.ts` first:**
  ```ts
  import { describe, it, expect } from 'vitest';
  import { planBackfillRows, skuFromCardKey } from './skuBackfill';
  import type { BackfillMappingRow, BackfillProductLite } from './skuBackfill';

  const product = (id: string, variantId: number | string | null = 900): BackfillProductLite => ({
    id, sku: null,
    raw_json: variantId == null ? { variants: [] } : { variants: [{ id: variantId }] },
  });
  const mapping = (over: Partial<BackfillMappingRow>): BackfillMappingRow => ({
    card_key: 'Aaron|Pi|Aaron.jpg', shopify_product_id: '1',
    confidence: 1, match_method: 'exact', status: 'auto_matched', ...over,
  });

  describe('skuFromCardKey', () => {
    it('computes cardSku from the key parts, stripping whitespace ("RoA 3" → "RoA3-")', () => {
      expect(skuFromCardKey('Aaron|RoA 3|Aaron.jpg')).toBe('RoA3-Aaron');
    });
    it('rejects malformed keys', () => {
      expect(skuFromCardKey('not-a-key')).toBe(null);
    });
  });

  describe('planBackfillRows', () => {
    it('builds gids and sku for a simple confirmed mapping', () => {
      const { toWrite, skippedPermanent, blocked } = planBackfillRows(
        [mapping({})], new Map([['1', product('1', 456)]]), new Map(),
      );
      expect(blocked).toEqual([]);
      expect(skippedPermanent).toEqual([]);
      expect(toWrite).toEqual([{
        productId: '1', productGid: 'gid://shopify/Product/1',
        variantGid: 'gid://shopify/ProductVariant/456',
        cardKey: 'Aaron|Pi|Aaron.jpg', sku: 'Pi-Aaron',
      }]);
    });

    it('multi-mapping product: exact beats normalized regardless of confidence; rest skippedPermanent', () => {
      const { toWrite, skippedPermanent } = planBackfillRows([
        mapping({ card_key: 'A|Pi|A.jpg', match_method: 'normalized', confidence: 0.99 }),
        mapping({ card_key: 'B|Pi|B.jpg', match_method: 'exact', confidence: 0.9 }),
        mapping({ card_key: 'C|Pi|C.jpg', match_method: 'promo_fallback', confidence: 1.0 }),
      ], new Map([['1', product('1')]]), new Map());
      expect(toWrite).toHaveLength(1);
      expect(toWrite[0].cardKey).toBe('B|Pi|B.jpg');
      expect(skippedPermanent.map(s => s.cardKey).sort()).toEqual(['A|Pi|A.jpg', 'C|Pi|C.jpg']);
      expect(skippedPermanent[0].reason).toContain('permanent by design');
    });

    it('ties on method rank break by highest confidence', () => {
      const { toWrite } = planBackfillRows([
        mapping({ card_key: 'A|Pi|A.jpg', match_method: 'normalized', confidence: 0.90 }),
        mapping({ card_key: 'B|Pi|B.jpg', match_method: 'normalized', confidence: 0.95 }),
      ], new Map([['1', product('1')]]), new Map());
      expect(toWrite[0].cardKey).toBe('B|Pi|B.jpg');
    });

    it('missing variant in raw_json → blocked with re-sync hint', () => {
      const { toWrite, blocked } = planBackfillRows([mapping({})], new Map([['1', product('1', null)]]), new Map());
      expect(toWrite).toEqual([]);
      expect(blocked[0].reason).toContain('re-sync');
    });

    it('target sku already owned by ANOTHER product → blocked (would manufacture duplicate SKU)', () => {
      const { toWrite, blocked } = planBackfillRows(
        [mapping({})], new Map([['1', product('1')]]), new Map([['Pi-Aaron', '999']]),
      );
      expect(toWrite).toEqual([]);
      expect(blocked[0].reason).toContain('999');
    });

    it('product missing from the mirror map is ignored (mapping references a ghost)', () => {
      const { toWrite, blocked } = planBackfillRows([mapping({})], new Map(), new Map());
      expect(toWrite).toEqual([]);
      expect(blocked).toEqual([]);
    });
  });
  ```
- [ ] Run: `npx vitest run lib/shopify/skuBackfill.test.ts` — expected: fails (module missing).
- [ ] Create `lib/shopify/skuBackfill.ts`:
  ```ts
  /**
   * Pure planning logic for the one-time SKU/metafield backfill (spec §SKU backfill).
   * IO lives in app/admin/ytg/matching/actions.ts; this module is fully unit-testable.
   */
  import { cardSku } from './productFromCard';

  export interface BackfillMappingRow {
    card_key: string;
    shopify_product_id: string;
    confidence: number | null;
    match_method: string | null;
    status: string;
  }
  export interface BackfillProductLite {
    id: string;
    sku: string | null;
    raw_json: { variants?: { id: number | string }[] } | null;
  }
  export interface BackfillRow {
    productId: string;
    productGid: string;
    variantGid: string;
    cardKey: string;
    sku: string;
  }
  export interface BackfillSkip { productId: string; cardKey: string; reason: string; }

  // Primary-mapping preference: deterministic methods first, then confidence.
  const METHOD_RANK: Record<string, number> = { sku: 0, exact: 1, normalized: 2 };
  const rank = (m: string | null) => {
    const r = METHOD_RANK[m ?? ''];
    return r === undefined ? 3 : r;
  };

  export function skuFromCardKey(cardKey: string): string | null {
    const parts = cardKey.split('|');
    if (parts.length !== 3 || parts[1] === '' || parts[2] === '') return null;
    return cardSku({ set: parts[1], imgFile: parts[2] });
  }

  export function planBackfillRows(
    mappings: BackfillMappingRow[],
    productsById: Map<string, BackfillProductLite>,
    existingSkuOwners: Map<string, string>,
  ): { toWrite: BackfillRow[]; skippedPermanent: BackfillSkip[]; blocked: BackfillSkip[] } {
    const byProduct = new Map<string, BackfillMappingRow[]>();
    for (const m of mappings) {
      const list = byProduct.get(m.shopify_product_id);
      if (list) list.push(m); else byProduct.set(m.shopify_product_id, [m]);
    }

    const toWrite: BackfillRow[] = [];
    const skippedPermanent: BackfillSkip[] = [];
    const blocked: BackfillSkip[] = [];

    for (const [productId, group] of byProduct) {
      const product = productsById.get(productId);
      if (!product) continue;                                   // ghost mapping — not ours to fix here
      if ((product.sku ?? '').trim() !== '') continue;          // already has a SKU

      const sorted = [...group].sort(
        (a, b) => rank(a.match_method) - rank(b.match_method) || (b.confidence ?? 0) - (a.confidence ?? 0),
      );
      const primary = sorted[0];
      for (const other of sorted.slice(1)) {
        skippedPermanent.push({
          productId, cardKey: other.card_key,
          reason: 'non-primary mapping on a multi-mapped product — permanent by design, not a to-do',
        });
      }

      const sku = skuFromCardKey(primary.card_key);
      if (sku === null) {
        blocked.push({ productId, cardKey: primary.card_key, reason: 'malformed card_key' });
        continue;
      }
      const owner = existingSkuOwners.get(sku);
      if (owner !== undefined && owner !== productId) {
        blocked.push({ productId, cardKey: primary.card_key, reason: `sku already on product ${owner} — resolve that mapping first (duplicate-SKU guard)` });
        continue;
      }
      const variantId = product.raw_json?.variants?.[0]?.id;
      if (variantId === undefined || variantId === null) {
        blocked.push({ productId, cardKey: primary.card_key, reason: 'no variant in raw_json — re-sync products, then re-plan' });
        continue;
      }
      toWrite.push({
        productId,
        productGid: `gid://shopify/Product/${productId}`,
        variantGid: `gid://shopify/ProductVariant/${variantId}`,
        cardKey: primary.card_key,
        sku,
      });
    }
    return { toWrite, skippedPermanent, blocked };
  }
  ```
- [ ] Run: `npx vitest run lib/shopify/skuBackfill.test.ts && npx tsc --noEmit` — expected: all pass.
- [ ] Commit:
  ```bash
  git add lib/shopify/skuBackfill.ts lib/shopify/skuBackfill.test.ts
  git commit -m "feat(matching): pure SKU-backfill planner — primary-only guard, duplicate-SKU block

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 7: Server actions (backfill execute, stale-identity clear, product search) + review-queue payload

**Files:**
- `app/admin/ytg/matching/actions.ts` (new, `"use server"`)
- `app/api/admin/review-queue/route.ts` (edit select L7–21 only — keep WS-0's `hasPermission` block untouched)

**Interfaces:**
- Consumed: `runAliasedMutations` (WS-0 contract), `shopifyGraphQL` + `getShopifyAccessToken`, `getSupabaseAdmin`, `hasPermission('manage_shopify_imports')`, `planBackfillRows`/`skuFromCardKey` (Task 6).
- Produced (every action re-checks permission — layout gating does not protect actions):
  ```ts
  export async function planSkuBackfill(): Promise<{
    toWrite: BackfillRow[]; skippedPermanent: BackfillSkip[]; blocked: BackfillSkip[]; count: number;
  }>;
  export async function executeSkuBackfill(rows: BackfillRow[]): Promise<BackfillExecRow[]>;
  // BackfillExecRow = BackfillRow & { variantOk: boolean; metafieldOk: boolean; mirrorOk: boolean; mock: boolean; error: string | null }
  export async function clearStaleIdentity(oldProductId: string, cardKey: string): Promise<{
    clearedSku: boolean; clearedMetafield: boolean; mock: boolean;
  }>;
  export async function searchSingleProducts(q: string): Promise<{
    id: string; title: string; handle: string; price: number | null; tags: string | null; sku: string | null;
  }[]>;
  ```
- **Mutation shapes are law (2026-07):** `productVariantsBulkUpdate(productId, variants: [{ id: <variantGid>, inventoryItem: { sku } }])` — SKU at `inventoryItem.sku`, NOT top-level (top-level `sku` is a `productSet`-only shape; copying `ShopifyProductSetInput` from `productFromCard.ts` is the documented trap). `metafieldsSet` ≤25 metafields/call. `metafieldsDelete(metafields: [{ ownerId, namespace, key }])` — if the executor is unsure this is still the 2026-07 delete shape, verify at shopify.dev before wiring (the singular by-id `metafieldDelete` is the removed legacy form).

- [ ] Create `app/admin/ytg/matching/actions.ts`:
  ```ts
  "use server";

  import { hasPermission } from '@/utils/adminUtils';
  import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
  import { getShopifyAccessToken } from '@/lib/pricing/shopify';
  import { shopifyGraphQL } from '@/lib/shopify/admin-write';
  import { runAliasedMutations, type AliasedMutation } from '@/lib/shopify/aliasBatch';
  import {
    planBackfillRows, skuFromCardKey,
    type BackfillRow, type BackfillSkip, type BackfillMappingRow, type BackfillProductLite,
  } from '@/lib/shopify/skuBackfill';

  async function requireYtgPermission(): Promise<void> {
    if (!(await hasPermission('manage_shopify_imports'))) {
      throw new Error('Forbidden: manage_shopify_imports permission required');
    }
  }

  export interface BackfillExecRow extends BackfillRow {
    variantOk: boolean;
    metafieldOk: boolean;
    mirrorOk: boolean;
    mock: boolean;
    error: string | null;
  }

  export async function planSkuBackfill(): Promise<{
    toWrite: BackfillRow[]; skippedPermanent: BackfillSkip[]; blocked: BackfillSkip[]; count: number;
  }> {
    await requireYtgPermission();
    const supabase = getSupabaseAdmin();
    const pageSize = 1000;

    // Confirmed mappings whose product is a Single with no SKU yet (!inner join
    // makes the embedded filters constrain the parent rows).
    const mappings: (BackfillMappingRow & { shopify_products: BackfillProductLite })[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from('card_price_mappings')
        .select('card_key, shopify_product_id, confidence, match_method, status, shopify_products!inner(id, sku, product_type, raw_json)')
        .in('status', ['auto_matched', 'manual'])
        .not('shopify_product_id', 'is', null)
        .eq('shopify_products.product_type', 'Single')
        .is('shopify_products.sku', null)
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(`planSkuBackfill mappings: ${error.message}`);
      mappings.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }

    // Existing SKU owners (duplicate-SKU guard input)
    const existingSkuOwners = new Map<string, string>();
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from('shopify_products')
        .select('id, sku')
        .not('sku', 'is', null)
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(`planSkuBackfill skus: ${error.message}`);
      for (const p of data ?? []) existingSkuOwners.set(p.sku, p.id);
      if (!data || data.length < pageSize) break;
    }

    const productsById = new Map<string, BackfillProductLite>();
    for (const m of mappings) productsById.set(m.shopify_products.id, m.shopify_products);

    const plan = planBackfillRows(
      mappings.map(m => ({
        card_key: m.card_key, shopify_product_id: m.shopify_product_id,
        confidence: m.confidence, match_method: m.match_method, status: m.status,
      })),
      productsById,
      existingSkuOwners,
    );
    return { ...plan, count: plan.toWrite.length };
  }

  const METAFIELDS_SET_MUTATION = `
  mutation setCardKeys($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key }
      userErrors { field message code }
    }
  }`;

  export async function executeSkuBackfill(rows: BackfillRow[]): Promise<BackfillExecRow[]> {
    await requireYtgPermission();
    if (rows.length === 0) return [];
    if (rows.length > 40) throw new Error('executeSkuBackfill: send at most 40 rows per call (client chunks)');

    // Mock short-circuit, same pattern as productSetUpsert (admin-write.ts:113).
    // Do NOT touch the mirror in mock mode — a mirror sku the store doesn't have
    // would poison pass 0.
    if (process.env.SHOPIFY_WRITE_MOCK === '1') {
      return rows.map(r => ({ ...r, variantOk: true, metafieldOk: true, mirrorOk: false, mock: true, error: null }));
    }

    // 1) Variant SKU writes — one aliased productVariantsBulkUpdate per product.
    //    EXACT 2026-07 shape: sku lives at inventoryItem.sku in ProductVariantsBulkInput.
    const calls: AliasedMutation[] = rows.map((r, i) => ({
      alias: `v${i}`,
      mutation: `productVariantsBulkUpdate(productId: ${JSON.stringify(r.productGid)}, variants: [{ id: ${JSON.stringify(r.variantGid)}, inventoryItem: { sku: ${JSON.stringify(r.sku)} } }])`,
      selection: `{ productVariants { id } userErrors { field message } }`,
    }));
    const aliasResults = await runAliasedMutations(calls);
    const byAlias = new Map(aliasResults.map(r => [r.alias, r]));

    const out: BackfillExecRow[] = rows.map((r, i) => {
      const res = byAlias.get(`v${i}`);
      const errs = res ? res.userErrors : [{ message: 'no result returned for alias' }];
      return {
        ...r,
        variantOk: errs.length === 0,
        metafieldOk: false,
        mirrorOk: false,
        mock: false,
        error: errs.length > 0 ? errs.map(e => e.message).join('; ') : null,
      };
    });

    // 2) rtt_card_key metafields for variant-OK rows, chunks of 25 (metafieldsSet cap).
    const okRows = out.filter(r => r.variantOk);
    if (okRows.length > 0) {
      const token = await getShopifyAccessToken();
      for (let i = 0; i < okRows.length; i += 25) {
        const chunk = okRows.slice(i, i + 25);
        try {
          const data = await shopifyGraphQL<{ metafieldsSet: { userErrors: { field?: string[] | null; message: string }[] } }>(
            token, METAFIELDS_SET_MUTATION,
            { metafields: chunk.map(r => ({ ownerId: r.productGid, namespace: 'custom', key: 'rtt_card_key', type: 'single_line_text_field', value: r.cardKey })) },
          );
          const errs = data.metafieldsSet.userErrors;
          if (errs.length === 0) {
            for (const r of chunk) r.metafieldOk = true;
          } else {
            // userError field paths look like ["metafields","3","value"] — map back per index when possible
            const badIdx = new Set(errs.map(e => Number(e.field?.[1])).filter(n => Number.isInteger(n)));
            chunk.forEach((r, idx) => {
              const bad = badIdx.size > 0 ? badIdx.has(idx) : true;
              r.metafieldOk = bad === false;
              if (bad) r.error = [r.error, `metafield: ${errs.map(e => e.message).join('; ')}`].filter(Boolean).join(' | ');
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'metafieldsSet failed';
          for (const r of chunk) r.error = [r.error, `metafield: ${msg}`].filter(Boolean).join(' | ');
        }
      }
    }

    // 3) Mirror update so pass 0 sees the new SKUs without waiting for a sync.
    const supabase = getSupabaseAdmin();
    for (const r of out) {
      if (r.variantOk === false) continue;
      const { error } = await supabase.from('shopify_products').update({ sku: r.sku }).eq('id', r.productId);
      r.mirrorOk = !error;
      if (error) r.error = [r.error, `mirror: ${error.message}`].filter(Boolean).join(' | ');
    }
    return out;
  }

  const STALE_IDENTITY_QUERY = `
  query staleIdentity($id: ID!) {
    product(id: $id) {
      id
      metafield(namespace: "custom", key: "rtt_card_key") { id value }
      variants(first: 1) { nodes { id inventoryItem { sku } } }
    }
  }`;

  const VARIANT_SKU_CLEAR_MUTATION = `
  mutation clearVariantSku($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }`;

  const METAFIELDS_DELETE_MUTATION = `
  mutation deleteCardKey($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields { key namespace ownerId }
      userErrors { field message }
    }
  }`;

  /**
   * Re-mapping hygiene (spec): when the review queue moves a card OFF a product,
   * clear the old product's identity metadata IF it belongs to this card —
   * stale SKU/rtt_card_key that outlives a mapping is how duplicate SKUs are born.
   * Reads live Shopify state (mirror may be stale), then clears + updates mirror.
   */
  export async function clearStaleIdentity(oldProductId: string, cardKey: string): Promise<{
    clearedSku: boolean; clearedMetafield: boolean; mock: boolean;
  }> {
    await requireYtgPermission();
    const productGid = `gid://shopify/Product/${oldProductId}`;
    const expectedSku = skuFromCardKey(cardKey);

    if (process.env.SHOPIFY_WRITE_MOCK === '1') {
      return { clearedSku: false, clearedMetafield: false, mock: true };
    }

    const token = await getShopifyAccessToken();
    const data = await shopifyGraphQL<{
      product: {
        id: string;
        metafield: { id: string; value: string } | null;
        variants: { nodes: { id: string; inventoryItem: { sku: string | null } | null }[] };
      } | null;
    }>(token, STALE_IDENTITY_QUERY, { id: productGid });

    const product = data.product;
    if (!product) return { clearedSku: false, clearedMetafield: false, mock: false };

    let clearedSku = false;
    let clearedMetafield = false;

    const variant = product.variants.nodes[0];
    if (expectedSku !== null && variant && variant.inventoryItem && variant.inventoryItem.sku === expectedSku) {
      // 2026-07: InventoryItemInput.sku is a nullable String — null is the documented
      // "clear" value. If Shopify rejects null with a userError, fall back to "":
      // an empty-string SKU renders as no SKU in Admin and can never collide with a
      // cardSku (those always contain "<set>-"). Decision recorded here on purpose.
      let result = await shopifyGraphQL<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(
        token, VARIANT_SKU_CLEAR_MUTATION,
        { productId: productGid, variants: [{ id: variant.id, inventoryItem: { sku: null } }] },
      );
      if (result.productVariantsBulkUpdate.userErrors.length > 0) {
        result = await shopifyGraphQL<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(
          token, VARIANT_SKU_CLEAR_MUTATION,
          { productId: productGid, variants: [{ id: variant.id, inventoryItem: { sku: '' } }] },
        );
      }
      clearedSku = result.productVariantsBulkUpdate.userErrors.length === 0;
      if (clearedSku) {
        await getSupabaseAdmin().from('shopify_products').update({ sku: null }).eq('id', oldProductId);
      }
    }

    if (product.metafield && product.metafield.value === cardKey) {
      const del = await shopifyGraphQL<{ metafieldsDelete: { userErrors: { message: string }[] } }>(
        token, METAFIELDS_DELETE_MUTATION,
        { metafields: [{ ownerId: productGid, namespace: 'custom', key: 'rtt_card_key' }] },
      );
      clearedMetafield = del.metafieldsDelete.userErrors.length === 0;
    }

    return { clearedSku, clearedMetafield, mock: false };
  }

  export async function searchSingleProducts(q: string): Promise<{
    id: string; title: string; handle: string; price: number | null; tags: string | null; sku: string | null;
  }[]> {
    await requireYtgPermission();
    const term = q.trim().replace(/[%_]/g, ' ');
    if (term.length < 2) return [];
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('shopify_products')
      .select('id, title, handle, price, tags, sku')
      // REQUIRED: nothing else enforces the Single filter on this new path —
      // without it "Pick different" could map a card to a deck product.
      .eq('product_type', 'Single')
      .ilike('title', `%${term}%`)
      .order('title')
      .limit(20);
    if (error) throw new Error(`searchSingleProducts: ${error.message}`);
    return data ?? [];
  }
  ```
- [ ] Extend `app/api/admin/review-queue/route.ts`'s join select so the queue UI can show ability text and the current SKU — change only the embedded column list (L11–18), leaving WS-0's permission check and everything else untouched:
  ```ts
      shopify_products (
        id,
        title,
        handle,
        tags,
        price,
        inventory_quantity,
        body_html,
        sku
      )
  ```
- [ ] Gate: `npx tsc --noEmit` — expected: clean (actions are exercised live in Task 8's verification and by the mock-mode e2e in Task 9).
- [ ] Commit:
  ```bash
  git add app/admin/ytg/matching/actions.ts app/api/admin/review-queue/route.ts
  git commit -m "feat(matching): backfill/clear-stale/search server actions (2026-07 shapes)

  productVariantsBulkUpdate with inventoryItem.sku (NOT productSet's top-level
  sku), metafieldsSet in 25-chunks, metafieldsDelete by identifier, mirror
  sync-back, SHOPIFY_WRITE_MOCK short-circuit, hasPermission on every action.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 8: Matching tab UI — dashboard, backfill panel, review queue

**Files:**
- `app/admin/ytg/matching/page.tsx` (replace WS-0 skeleton — server component)
- `app/admin/ytg/matching/components/MatchingDashboard.tsx` (new, client)
- `app/admin/ytg/matching/components/BackfillPanel.tsx` (new, client)
- `app/admin/ytg/matching/components/ReviewQueue.tsx` (new, client)

**Interfaces:**
- Consumed: Task 7 actions; authed routes `POST /api/admin/sync-shopify`, `POST /api/admin/run-matching`, `GET /api/admin/review-queue`, `POST /api/admin/approve-mapping` (`{card_key, shopify_product_id}` → sets `status:'manual'`, `match_method:'manual'` — verified at `app/api/admin/approve-mapping/route.ts:17-26`; reused as-is for both Approve and Pick different), `POST /api/admin/reject-mapping` (`{card_key}`); `getCardImageUrl` from `@/app/shared/utils/cardImageUrl` (the repo's canonical card-image helper); `findCard`/`CARDS` from `@/lib/cards/lookup` (client-safe — precedent: `app/play/components/MultiplayerCanvas.tsx`, `app/goldfish/*`); `stripHtmlToText` from `@/lib/pricing/abilityText` (pure, client-safe); shadcn `Button`, `Input`, `Badge`; lucide icons.
- WS-0's `layout.tsx` provides the gate + shell; this page renders content only. Do not edit `layout.tsx` or `YtgTabs.tsx`.

- [ ] Replace `app/admin/ytg/matching/page.tsx`:
  ```tsx
  import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
  import MatchingDashboard from './components/MatchingDashboard';
  import BackfillPanel from './components/BackfillPanel';
  import ReviewQueue from './components/ReviewQueue';

  export const dynamic = 'force-dynamic';

  async function loadDashboardCounts(): Promise<{ byMethod: Record<string, number>; byStatus: Record<string, number> }> {
    const supabase = getSupabaseAdmin();
    const byMethod: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from('card_price_mappings')
        .select('match_method, status')
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        const m = row.match_method ?? 'none';
        byMethod[m] = (byMethod[m] ?? 0) + 1;
        byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      }
      if (!data || data.length < pageSize) break;
    }
    return { byMethod, byStatus };
  }

  export default async function MatchingPage() {
    const counts = await loadDashboardCounts();
    return (
      <div className="space-y-6">
        <MatchingDashboard byMethod={counts.byMethod} byStatus={counts.byStatus} />
        <BackfillPanel />
        <ReviewQueue />
      </div>
    );
  }
  ```
- [ ] Create `app/admin/ytg/matching/components/MatchingDashboard.tsx`:
  ```tsx
  "use client";

  import { useState } from 'react';
  import { useRouter } from 'next/navigation';
  import { Button } from '@/components/ui/button';
  import { RefreshCw, Play } from 'lucide-react';

  export default function MatchingDashboard({ byMethod, byStatus }: {
    byMethod: Record<string, number>;
    byStatus: Record<string, number>;
  }) {
    const router = useRouter();
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function run(label: string, url: string) {
      setBusy(label);
      setError(null);
      try {
        const res = await fetch(url, { method: 'POST' });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `${label} failed (${res.status})`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : `${label} failed`);
      } finally {
        setBusy(null);
      }
    }

    const methods = Object.entries(byMethod).sort((a, b) => b[1] - a[1]);
    const needsReview = byStatus['needs_review'] ?? 0;
    const unmatched = byStatus['unmatched'] ?? 0;

    return (
      <section className="rounded-lg bg-muted/40 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Matching</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={busy !== null}
              onClick={() => run('Sync', '/api/admin/sync-shopify')}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy === 'Sync' ? 'animate-spin' : ''}`} />
              {busy === 'Sync' ? 'Syncing…' : 'Sync products'}
            </Button>
            <Button size="sm" disabled={busy !== null}
              onClick={() => run('Matching', '/api/admin/run-matching')}>
              <Play className="mr-1.5 h-3.5 w-3.5" />
              {busy === 'Matching' ? 'Matching…' : 'Run matching'}
            </Button>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md bg-background p-3">
            <div className="text-2xl font-semibold tabular-nums">{needsReview}</div>
            <div className="text-xs text-muted-foreground">needs review</div>
          </div>
          <div className="rounded-md bg-background p-3">
            <div className="text-2xl font-semibold tabular-nums">{unmatched}</div>
            <div className="text-xs text-muted-foreground">unmatched</div>
          </div>
          <div className="rounded-md bg-background p-3 col-span-2">
            <div className="text-xs text-muted-foreground mb-1.5">by match method</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {methods.map(([m, n]) => (
                <span key={m} className="text-xs tabular-nums">
                  <span className="text-muted-foreground">{m}</span> {n}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }
  ```
- [ ] Create `app/admin/ytg/matching/components/BackfillPanel.tsx`:
  ```tsx
  "use client";

  import { useState } from 'react';
  import { Button } from '@/components/ui/button';
  import { planSkuBackfill, executeSkuBackfill, type BackfillExecRow } from '../actions';
  import type { BackfillRow, BackfillSkip } from '@/lib/shopify/skuBackfill';

  type Plan = { toWrite: BackfillRow[]; skippedPermanent: BackfillSkip[]; blocked: BackfillSkip[]; count: number };
  const CHUNK = 40; // matches aliasBatch's default per-document cost-cap sizing

  export default function BackfillPanel() {
    const [plan, setPlan] = useState<Plan | null>(null);
    const [planning, setPlanning] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [done, setDone] = useState(0);
    const [failures, setFailures] = useState<BackfillExecRow[]>([]);
    const [succeeded, setSucceeded] = useState(0);
    const [error, setError] = useState<string | null>(null);

    async function doPlan() {
      setPlanning(true); setError(null); setFailures([]); setSucceeded(0); setDone(0);
      try { setPlan(await planSkuBackfill()); }
      catch (err) { setError(err instanceof Error ? err.message : 'Plan failed'); }
      finally { setPlanning(false); }
    }

    async function execute(rows: BackfillRow[]) {
      setExecuting(true); setError(null); setDone(0); setFailures([]);
      let ok = 0;
      const failed: BackfillExecRow[] = [];
      try {
        for (let i = 0; i < rows.length; i += CHUNK) {
          const results = await executeSkuBackfill(rows.slice(i, i + CHUNK));
          for (const r of results) {
            if (r.variantOk === true && r.metafieldOk === true) ok++;
            else failed.push(r);
          }
          setDone(Math.min(i + CHUNK, rows.length));
          setSucceeded(ok);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Execute failed');
      } finally {
        setFailures(failed);
        setExecuting(false);
      }
    }

    return (
      <section className="rounded-lg bg-muted/40 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">SKU backfill</h2>
            <p className="text-xs text-muted-foreground">
              Writes cardSku + rtt_card_key onto confirmed-mapped products missing a SKU. One-time; pass 0 self-matches afterward.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={doPlan} disabled={planning || executing}>
            {planning ? 'Planning…' : 'Plan SKU backfill'}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {plan && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-sm">
              <span><span className="font-semibold tabular-nums">{plan.count}</span> products to write</span>
              <span className="text-muted-foreground">
                {plan.skippedPermanent.length} non-primary mappings skipped — permanent by design
              </span>
              {plan.blocked.length > 0 && (
                <span className="text-amber-600 dark:text-amber-400">{plan.blocked.length} blocked (fix + re-plan)</span>
              )}
            </div>
            {plan.toWrite.length > 0 && (
              <div className="overflow-x-auto rounded-md bg-background">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="p-2">SKU</th><th className="p-2">Card key</th><th className="p-2">Product</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.toWrite.slice(0, 20).map(r => (
                      <tr key={r.productId} className="odd:bg-muted/30">
                        <td className="p-2 font-mono">{r.sku}</td>
                        <td className="p-2">{r.cardKey}</td>
                        <td className="p-2 tabular-nums">{r.productId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {plan.toWrite.length > 20 && (
                  <p className="p-2 text-xs text-muted-foreground">…and {plan.toWrite.length - 20} more</p>
                )}
              </div>
            )}
            {plan.blocked.length > 0 && (
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {plan.blocked.slice(0, 10).map(b => (
                  <li key={`${b.productId}-${b.cardKey}`}>{b.cardKey}: {b.reason}</li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-3">
              <Button size="sm" disabled={executing || plan.toWrite.length === 0}
                onClick={() => execute(plan.toWrite)}>
                {executing ? `Writing ${done}/${plan.toWrite.length}…` : `Execute (${plan.toWrite.length})`}
              </Button>
              {(succeeded > 0 || failures.length > 0) && !executing && (
                <span className="text-sm tabular-nums">
                  {succeeded} ok{failures.length > 0 ? `, ${failures.length} failed` : ''}
                </span>
              )}
              {failures.length > 0 && !executing && (
                <Button variant="outline" size="sm" onClick={() => execute(failures)}>
                  Retry {failures.length} failed
                </Button>
              )}
            </div>
            {failures.length > 0 && (
              <ul className="text-xs text-destructive space-y-0.5">
                {failures.slice(0, 15).map(f => <li key={f.productId}>{f.sku}: {f.error}</li>)}
              </ul>
            )}
          </div>
        )}
      </section>
    );
  }
  ```
- [ ] Create `app/admin/ytg/matching/components/ReviewQueue.tsx`:
  ```tsx
  "use client";

  import { useCallback, useEffect, useRef, useState } from 'react';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import { Badge } from '@/components/ui/badge';
  import { CheckCircle2 } from 'lucide-react';
  import { findCard } from '@/lib/cards/lookup';
  import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
  import { stripHtmlToText } from '@/lib/pricing/abilityText';
  import { searchSingleProducts, clearStaleIdentity } from '../actions';

  interface QueueProduct {
    id: string; title: string; handle: string; tags: string | null;
    price: number | null; inventory_quantity: number | null;
    body_html: string | null; sku: string | null;
  }
  interface QueueItem {
    card_key: string; card_name: string; set_code: string;
    confidence: number | null; match_method: string | null;
    shopify_product_id: string | null;
    shopify_products: QueueProduct | null;
  }
  type SearchHit = { id: string; title: string; handle: string; price: number | null; tags: string | null; sku: string | null };

  function parseCardKey(cardKey: string): { name: string; set: string; imgFile: string } {
    const [name, set, imgFile] = cardKey.split('|');
    return { name: name ?? '', set: set ?? '', imgFile: imgFile ?? '' };
  }

  export default function ReviewQueue() {
    const [items, setItems] = useState<QueueItem[] | null>(null);
    const [total, setTotal] = useState(0);
    const [index, setIndex] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [hits, setHits] = useState<SearchHit[]>([]);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      fetch('/api/admin/review-queue')
        .then(async res => {
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? `review-queue failed (${res.status})`);
          setItems(body.items ?? []);
          setTotal((body.items ?? []).length);
        })
        .catch(err => setError(err instanceof Error ? err.message : 'Failed to load queue'));
    }, []);

    const current = items && items.length > 0 ? items[Math.min(index, items.length - 1)] : null;

    const removeCurrent = useCallback(() => {
      if (!items || !current) return;
      const next = items.filter(i => i.card_key !== current.card_key);
      setItems(next);
      setIndex(i => Math.min(i, Math.max(0, next.length - 1)));
      setSearchOpen(false); setQuery(''); setHits([]);
    }, [items, current]);

    const approve = useCallback(async (productId: string) => {
      if (!current || busy) return;
      setBusy(true); setError(null);
      const oldProductId = current.shopify_product_id;
      try {
        const res = await fetch('/api/admin/approve-mapping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ card_key: current.card_key, shopify_product_id: productId }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? 'Approve failed');
        // Re-mapping hygiene: if the card moved OFF a product that carries this
        // card's SKU/rtt_card_key, clear the stale identity so duplicate SKUs
        // are never born.
        if (oldProductId !== null && oldProductId !== productId) {
          await clearStaleIdentity(oldProductId, current.card_key);
        }
        removeCurrent();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Approve failed');
      } finally {
        setBusy(false);
      }
    }, [current, busy, removeCurrent]);

    const reject = useCallback(async () => {
      if (!current || busy) return;
      setBusy(true); setError(null);
      try {
        const res = await fetch('/api/admin/reject-mapping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ card_key: current.card_key }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? 'Reject failed');
        removeCurrent();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Reject failed');
      } finally {
        setBusy(false);
      }
    }, [current, busy, removeCurrent]);

    // Keyboard: A approve, R reject, / focus search, ←/→ navigate
    useEffect(() => {
      function onKey(e: KeyboardEvent) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
        if (!current) return;
        if (e.key === 'a' || e.key === 'A') {
          if (current.shopify_products) { e.preventDefault(); approve(current.shopify_products.id); }
        } else if (e.key === 'r' || e.key === 'R') {
          e.preventDefault(); reject();
        } else if (e.key === '/') {
          e.preventDefault(); setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 0);
        } else if (e.key === 'ArrowRight' && items) {
          e.preventDefault(); setIndex(i => Math.min(i + 1, items.length - 1));
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault(); setIndex(i => Math.max(i - 1, 0));
        }
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [current, items, approve, reject]);

    useEffect(() => {
      if (!searchOpen || query.trim().length < 2) { setHits([]); return; }
      const t = setTimeout(() => {
        searchSingleProducts(query).then(setHits).catch(() => setHits([]));
      }, 250);
      return () => clearTimeout(t);
    }, [query, searchOpen]);

    if (error && items === null) return <section className="rounded-lg bg-muted/40 p-4 text-sm text-destructive">{error}</section>;
    if (items === null) return <section className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">Loading review queue…</section>;

    if (items.length === 0) {
      return (
        <section className="rounded-lg bg-muted/40 p-10 flex flex-col items-center gap-2 text-center">
          <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-500" />
          <p className="font-semibold">Review queue clear</p>
          <p className="text-sm text-muted-foreground">
            {total > 0 ? `All ${total} mappings reviewed. Nice work.` : 'Nothing needs review right now.'}
          </p>
        </section>
      );
    }

    const item = current!;
    const card = parseCardKey(item.card_key);
    const cardData = findCard(card.name, card.set, card.imgFile);
    const product = item.shopify_products;
    const done = total - items.length;

    return (
      <section className="rounded-lg bg-muted/40 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Review queue</h2>
          <span className="text-sm tabular-nums text-muted-foreground">{Math.min(done + 1, total)} of {total}</span>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="grid gap-4 md:grid-cols-2">
          {/* Card side */}
          <div className="rounded-md bg-background p-3 space-y-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Card</div>
            <div className="flex gap-3">
              {card.imgFile && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={getCardImageUrl(card.imgFile)} alt={card.name} className="h-40 w-auto rounded-sm" />
              )}
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{card.name}</p>
                <p className="text-xs text-muted-foreground">{card.set}{cardData ? ` · ${cardData.officialSet}` : ''}</p>
                {cardData && cardData.specialAbility && (
                  <p className="text-xs leading-relaxed">{cardData.specialAbility}</p>
                )}
              </div>
            </div>
          </div>

          {/* Proposed product side */}
          <div className="rounded-md bg-background p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Proposed product</div>
              <div className="flex gap-1.5">
                <Badge variant="secondary">{item.match_method ?? 'unknown'}</Badge>
                <Badge variant="outline">{((item.confidence ?? 0) * 100).toFixed(0)}%</Badge>
              </div>
            </div>
            {product ? (
              <div className="space-y-1.5">
                <p className="font-medium">{product.title}</p>
                <p className="text-sm tabular-nums">${product.price ?? '—'} · stock {product.inventory_quantity ?? '—'}{product.sku ? ` · SKU ${product.sku}` : ''}</p>
                {product.tags && (
                  <div className="flex flex-wrap gap-1">
                    {product.tags.split(',').slice(0, 8).map(t => (
                      <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{t.trim()}</span>
                    ))}
                  </div>
                )}
                {product.body_html && (
                  <p className="text-xs leading-relaxed text-muted-foreground">{stripHtmlToText(product.body_html)}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No product attached — use Pick different.</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy || !product} onClick={() => product && approve(product.id)}>
            Approve <kbd className="ml-1.5 text-[10px] opacity-70">A</kbd>
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={reject}>
            Reject <kbd className="ml-1.5 text-[10px] opacity-70">R</kbd>
          </Button>
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => { setSearchOpen(v => !v); setTimeout(() => searchRef.current?.focus(), 0); }}>
            Pick different <kbd className="ml-1.5 text-[10px] opacity-70">/</kbd>
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">←/→ navigate</span>
        </div>

        {searchOpen && (
          <div className="rounded-md bg-background p-3 space-y-2">
            <Input ref={searchRef} value={query} placeholder="Search Single products by title…"
              onChange={e => setQuery(e.target.value)} />
            <ul className="max-h-64 overflow-y-auto divide-y-0">
              {hits.map(h => (
                <li key={h.id}>
                  <button type="button" disabled={busy}
                    className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => approve(h.id)}>
                    <span className="font-medium">{h.title}</span>
                    <span className="ml-2 text-xs text-muted-foreground tabular-nums">${h.price ?? '—'}{h.sku ? ` · ${h.sku}` : ''}</span>
                  </button>
                </li>
              ))}
              {query.trim().length >= 2 && hits.length === 0 && (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">No Single products match.</li>
              )}
            </ul>
          </div>
        )}
      </section>
    );
  }
  ```
- [ ] Gate: `npx tsc --noEmit` — expected: clean.
- [ ] Manual verification in mock mode (crash-safe — no Shopify writes):
  ```bash
  cd /Users/timestes/projects/rtt-ytg-matching && SHOPIFY_WRITE_MOCK=1 npm run dev
  ```
  Visit `http://localhost:3000/admin/ytg/matching` as a permissioned user (use the `verify` skill's session-minting approach if driving with Playwright). Expected: dashboard counts render; Plan SKU backfill returns a plan with count + ≤20 sample rows + "permanent by design" label; Execute in mock mode reports all-ok with no store mutations; review queue loads, `A`/`R`/`/`/arrows work, Pick different search returns only Singles, end-of-queue state shows the check icon. Stop the dev server when done.
- [ ] Commit:
  ```bash
  git add app/admin/ytg/matching/page.tsx app/admin/ytg/matching/components/MatchingDashboard.tsx app/admin/ytg/matching/components/BackfillPanel.tsx app/admin/ytg/matching/components/ReviewQueue.tsx
  git commit -m "feat(matching): Matching tab UI — dashboard, backfill panel, keyboard review queue

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 9: Full gate, validation report, push, PR

**Files:** none new

- [ ] Full verification (superpowers:verification-before-completion — run, read output, only then claim):
  ```bash
  cd /Users/timestes/projects/rtt-ytg-matching
  npx tsc --noEmit
  npx vitest run
  ```
  Expected: type-check clean; entire suite green including `pass0.test.ts` (6), `abilityText.test.ts` (8), `skuBackfill.test.ts` (7), collision guard (1), and all pre-existing tests.
- [ ] Produce the final validation report against live data (read-only):
  ```bash
  npx tsx scripts/validate-matching.ts | tee /tmp/validate-matching-report.txt
  ```
  Expected: same shape as Task 5's smoke run. This exact output goes in the PR body below.
- [ ] Push and open the PR:
  ```bash
  git push -u origin feat/ytg-matching
  gh pr create --base main --title "feat(ytg): Matching tab — deterministic-first reconciliation (WS-2)" --body-file /tmp/ws2-pr-body.md
  ```
  Write `/tmp/ws2-pr-body.md` with this content — **the two fenced report sections are instructions to the executor: replace them with the real captured output before creating the PR; do not ship the placeholder text**:
  ```markdown
  ## WS-2: Matching tab — deterministic-first reconciliation

  Implements spec §Matching tab (docs/superpowers/specs/2026-08-03-ytg-store-admin-design.md):

  - **Pass 0** (SKU identity): protection-exempt, runs before the loadProtectedKeys skip so it can
    correct confident-but-wrong fuzzy matches; writeResults' manual/no_price_exists refetch-filter
    remains the write-layer guard. Duplicate SKUs → needs_review/sku_duplicate, never auto-picked.
  - **SKU backfill**: productVariantsBulkUpdate with `inventoryItem.sku` (2026-07 shape) +
    metafieldsSet (custom.rtt_card_key, 25/chunk) via runAliasedMutations; primary-mapping-only
    guard (non-primary skips are permanent by design); mirror sync-back; SHOPIFY_WRITE_MOCK honored.
  - **Re-mapping hygiene**: Pick different approves via the existing manual-status endpoint, then
    clearStaleIdentity strips the old product's matching SKU/rtt_card_key (duplicate-SKU prevention).
  - **Ability-text signal**: body_html → text → Jaccard overlap vs specialAbility, additive-only
    boost in pass3and4Fuzzy; A/B-validated below.
  - **Matching tab UI**: dashboard counts, backfill plan/execute/retry, keyboard review queue
    (A/R//, arrows, 14-of-96 progress, end-of-queue state).

  ## Validation report (scripts/validate-matching.ts — real output, required before merge)

  ```
  <EXECUTOR: paste the full contents of /tmp/validate-matching-report.txt here — per-method
  counts OFF/ON, status counts OFF/ON, changed card_keys with before/after, CSV spot-check,
  and summary deltas. The spec forbids shipping threshold changes without this report.>
  ```

  ## Test evidence

  ```
  <EXECUTOR: paste the final `npx vitest run` summary line(s) and `npx tsc --noEmit` (no output = clean) here.>
  ```

  ## Notes for reviewer

  - `writeResults` is now exported (test seam only; body unchanged).
  - `cardSku` widened to `Pick<CardData, 'set'|'imgFile'>` — no import cycle (verified: productFromCard's
    import chain never touches lib/pricing), so the lib/shopify/sku.ts fallback was unnecessary.
  - Variant-SKU clearing uses `inventoryItem: { sku: null }` with an in-code documented `""` fallback.
  - review-queue route: join select extended with body_html + sku only; WS-0 auth untouched.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```
- [ ] After PR creation, confirm CI/checks status with `gh pr checks --watch` and report the PR URL. Do not merge; merge order is owned by the primary session.

---

### Critical Files for Implementation

- /Users/timestes/projects/redemption-tournament-tracker/lib/pricing/matching.ts (Pass 0, pipeline restructure at L667–708, ability-text wiring in pass3and4Fuzzy L524–657, writeResults export L870)
- /Users/timestes/projects/redemption-tournament-tracker/lib/shopify/productFromCard.ts (cardSku seam L56–58; the ShopifyProductSetInput top-level-sku trap to avoid)
- /Users/timestes/projects/redemption-tournament-tracker/app/admin/ytg/matching/page.tsx (WS-0 skeleton replaced by the tab UI + actions.ts + components/)
- /Users/timestes/projects/redemption-tournament-tracker/lib/pricing/types.ts (ShopifyProductRow sku/body_html, MatchingSummary.results)
- /Users/timestes/projects/redemption-tournament-tracker/app/api/admin/review-queue/route.ts (join select gains body_html + sku; approve-mapping route reused as-is)
