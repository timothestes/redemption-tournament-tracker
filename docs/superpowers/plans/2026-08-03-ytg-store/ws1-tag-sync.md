# WS-1 Implementation Plan: Products Tab — Tag Sync

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task-by-task with review checkpoints. Before Task 1, read `docs/superpowers/plans/2026-08-03-ytg-store/00-overview.md` (shared contracts — this plan consumes `runAliasedMutations` from `lib/shopify/aliasBatch.ts` and produces `lib/shopify/tagRules.ts` per the exact contract there) and `docs/superpowers/specs/2026-08-03-ytg-store-admin-design.md` §Products tab (WS-1), which is the verbatim authority on behavior.

**Goal:** Keep Andy's store tags in step with card data. Extract the tag rules already inline in `lib/shopify/productFromCard.ts` into `lib/shopify/tagRules.ts` (importer and tag sync can never drift), then build the Products tab: name-collision warning panel, scope picker → product-granularity tag diff → staleness-gated, per-tag-opt-in removal apply via batched aliased `tagsAdd`/`tagsRemove` mutations, with progress, retryable failures, and a clean-diff success state.

**Architecture:** A pure rules module (`tagRules.ts`: `desiredTags` + `MANAGED_TAGS`) and a pure diff module (`tagDiff.ts`: union-over-mappings product diff, testable without Supabase) sit under server actions in `app/admin/ytg/products/actions.ts` that do the Supabase joins, staleness guard, and Shopify writes through WS-0's `runAliasedMutations`. The UI is a client orchestrator (`ProductsTagSync.tsx`) over four leaf components, replacing WS-0's skeleton `app/admin/ytg/products/page.tsx`. Diff granularity is the **product**: desired managed tags = union of `desiredTags(card)` over all confirmed mappings to that product; only managed tags outside the union are ever removal candidates.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript (`strict: false` — use explicit `=== false` / `!== null` comparisons for narrowing), Supabase service-role via `lib/pricing/supabase-admin`, Shopify GraphQL Admin 2026-07 via `lib/shopify/aliasBatch.ts` (WS-0), Tailwind + shadcn/ui, vitest.

**Global Constraints** (inherits overview §Global constraints in full; highlights + WS-1 specifics):

- **Branch:** `feat/ytg-tag-sync`. **Worktree:** `../rtt-ytg-tags` → absolute path `/Users/timestes/projects/rtt-ytg-tags`. Create it yourself (`git fetch origin && git worktree add /Users/timestes/projects/rtt-ytg-tags -b feat/ytg-tag-sync origin/main`), do ALL work inside it with absolute paths, never touch the main checkout, `git add` only your specific files (never `-A`/`.`), PR bases `origin/main`.
- **WS-0 must already be merged.** This plan replaces WS-0's skeleton `app/admin/ytg/products/page.tsx` and consumes `lib/shopify/aliasBatch.ts` and the WS-0 `syncShopifyProducts(): Promise<{ upserted: number; errors: number }>` signature. Task 1 verifies these exist and STOPS if not.
- **Do not edit** `app/admin/ytg/layout.tsx`, `app/admin/ytg/components/*`, or any other workstream's directory. WS-1 touches only the files listed per task.
- **Permission key:** `manage_shopify_imports` only; every server action re-checks it (layout gating does not protect actions). No new permissions.
- **Mock:** `SHOPIFY_WRITE_MOCK=1` short-circuits `applyTagChanges` before any GraphQL write. Never remove this path.
- **No migrations for WS-1.** No new tables — collision acknowledgment is per-session React state + an always-visible collapsed warning panel (design decision locked: warning panel, not hard gate; localStorage is forbidden).
- **Tests:** vitest (`npm test` = `vitest run`). Type gate `npx tsc --noEmit`. Never `next build` while a dev server runs.
- **Design:** `prompt_context/design_system.md` — data-dense, mobile-first, no focus rings (`focus:ring-2` banned), no 1px section borders (background shifts instead), green accent reserved for hover/active/CTAs (the Apply CTA and success state; add-chips use the spec-mandated green tint, remove-chips red).

---

### Task 1: Worktree + `tagRules.ts` extraction with characterization test (TDD)

**Files:**
- Create: `lib/shopify/tagRules.ts`
- Test (create): `lib/shopify/tagRules.test.ts`

**Interfaces:**
- Consumed: `CARDS`, `CardData` from `lib/cards/lookup.ts`; `normalizeBrigadeField` from `app/decklist/card-search/utils.ts`; `GOOD_BRIGADES`, `EVIL_BRIGADES` from `app/decklist/card-search/constants.ts`; OLD `productFromCard` from `lib/shopify/productFromCard.ts` (characterization oracle — unmodified in this task).
- Produced (exact contract from overview): `desiredTags(card: CardData): string[]` (sorted, deduped), `MANAGED_TAGS: ReadonlySet<string>`, plus `computeCardTags(card: CardData): { tags: string[]; warnings: string[] }` (Task 2 needs the warnings for `productFromCard` parity), and re-exported `TYPE_TAGS`/`BRIGADE_TAGS` constants.

**Steps:**

- [ ] Create the worktree and verify WS-0 is merged:
  ```bash
  cd /Users/timestes/projects/redemption-tournament-tracker
  git fetch origin
  git worktree add /Users/timestes/projects/rtt-ytg-tags -b feat/ytg-tag-sync origin/main
  ls /Users/timestes/projects/rtt-ytg-tags/lib/shopify/aliasBatch.ts \
     /Users/timestes/projects/rtt-ytg-tags/app/admin/ytg/products/page.tsx
  ```
  Expected: both paths listed. **If either is missing, STOP — WS-0 has not merged; report and do not proceed.**
- [ ] Install dependencies in the worktree:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags && npm install
  ```
- [ ] Write the failing characterization test at `/Users/timestes/projects/rtt-ytg-tags/lib/shopify/tagRules.test.ts`. It is written **against the OLD `productFromCard` behavior** (still inline at this point) — implementing `tagRules.ts` independently and passing this test proves parity *before* the refactor in Task 2 makes the two share code:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { CARDS } from '@/lib/cards/lookup';
  import { desiredTags, MANAGED_TAGS } from './tagRules';
  import { productFromCard } from './productFromCard';

  // Tag output is independent of price/image/status/abbrev — pass fixed opts and
  // card.set as the abbrev so no warnings-only paths change anything tag-related.
  const BUILD_OPTS = { price: '1.00', imageUrl: null, status: 'DRAFT' as const };

  describe('desiredTags characterization vs productFromCard', () => {
    it('emits IDENTICAL tags to productFromCard for every card in CARDS', () => {
      for (const card of CARDS) {
        const viaProduct = productFromCard(card, card.set, BUILD_OPTS).input.tags;
        expect(
          desiredTags(card),
          `tag mismatch for ${card.name}|${card.set}|${card.imgFile}`,
        ).toEqual(viaProduct);
      }
    });

    it('every tag desiredTags emits is in MANAGED_TAGS (over all of CARDS)', () => {
      for (const card of CARDS) {
        for (const tag of desiredTags(card)) {
          expect(
            MANAGED_TAGS.has(tag),
            `unmanaged tag "${tag}" emitted for ${card.name}|${card.set}|${card.imgFile}`,
          ).toBe(true);
        }
      }
    });

    it('MANAGED_TAGS contains the rule constants and YTG brigade tag names', () => {
      const expected = [
        // TYPE_TAGS values
        'Hero', 'Good Enhancement', 'Evil Enhancement', 'Evil Character', 'Artifact',
        'Lost Soul', 'Dominant', 'Fortress', 'Site', 'City', 'Covenant', 'Curse',
        // brigade tag names (canonical names mapped through BRIGADE_TAGS)
        'Gold', 'Red', 'Silver', 'Teal', 'White', 'Green', 'Purple', 'Blue', 'Clay',
        'Brown', 'Evil Gold', 'Crimson', 'Black', 'Gray', 'Orange', 'Pale Green',
        // rarity / legality / promo / dual
        'Legacy Rare', 'Ultra Rare', 'Rotation Cards', 'Promos', 'Dual Alignment',
        // spot-check officialSet values enumerated from card data
        'Kings', 'Prophecies of Christ', "Israel's Inheritance", 'Promo',
      ];
      for (const tag of expected) {
        expect(MANAGED_TAGS.has(tag), `missing managed tag "${tag}"`).toBe(true);
      }
      // 'Good Gold' is a canonical brigade NAME but never a tag — BRIGADE_TAGS maps it to 'Gold'.
      expect(MANAGED_TAGS.has('Good Gold')).toBe(false);
    });
  });
  ```
- [ ] Run the test and confirm it fails for the right reason (module missing):
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags && npx vitest run lib/shopify/tagRules.test.ts
  ```
  Expected output: FAIL — `Failed to resolve import "./tagRules"` (or `Cannot find module './tagRules'`).
- [ ] Create `/Users/timestes/projects/rtt-ytg-tags/lib/shopify/tagRules.ts` — the extraction. Logic is copied verbatim from `productFromCard.ts` L36–46 (constants) and L81–116 (tag block) so the characterization passes:

  ```ts
  /**
   * Managed tag rules for YTG Shopify products.
   *
   * Single source of truth for the tags this system OWNS on store products.
   * Extracted from productFromCard.ts so the set importer and the Products-tab
   * tag sync compute tags from the same rules and can never drift.
   *
   * When the Limited/Unlimited format restructure lands in card data, the
   * legality rule updates here and nowhere else.
   *
   * Server-side only by weight: MANAGED_TAGS is built by walking CARDS at
   * module init — do NOT import this module from client components.
   */

  import type { CardData } from '@/lib/cards/lookup';
  import { CARDS } from '@/lib/cards/lookup';
  import { normalizeBrigadeField } from '@/app/decklist/card-search/utils';
  import { GOOD_BRIGADES, EVIL_BRIGADES } from '@/app/decklist/card-search/constants';

  export const TYPE_TAGS: Record<string, string> = {
    'Hero': 'Hero', 'GE': 'Good Enhancement', 'EE': 'Evil Enhancement',
    'Evil Character': 'Evil Character', 'Artifact': 'Artifact', 'Lost Soul': 'Lost Soul',
    'Dominant': 'Dominant', 'Fortress': 'Fortress', 'Site': 'Site', 'City': 'City',
    'Covenant': 'Covenant', 'Curse': 'Curse',
    'Hero Token': 'Hero', 'Evil Character Token': 'Evil Character', 'Lost Soul Token': 'Lost Soul',
  };
  const GOOD_TYPE_PARTS = new Set(['Hero', 'GE']);
  const EVIL_TYPE_PARTS = new Set(['Evil Character', 'EE']);
  // Canonical brigade name -> YTG tag name (identity unless listed)
  export const BRIGADE_TAGS: Record<string, string> = { 'Good Gold': 'Gold' };

  function normalizeRarity(rarity: string): string {
    return rarity === 'Ultra-Rare' ? 'Ultra Rare' : rarity;
  }

  export interface CardTagComputation {
    tags: string[];      // sorted, deduped
    warnings: string[];  // `type-unmapped:<part>` | `brigade-unmapped:<value>`, in emission order
  }

  /**
   * Full tag computation including the warnings productFromCard surfaces at
   * plan time. The importer consumes this; the tag sync consumes desiredTags.
   */
  export function computeCardTags(card: CardData): CardTagComputation {
    const warnings: string[] = [];
    const tags = new Set<string>();

    const typeParts = card.type.split('/').map(p => p.trim()).filter(p => p.length > 0);
    const matchedTypeParts: string[] = [];
    for (const part of typeParts) {
      const tag = TYPE_TAGS[part];
      if (tag) {
        tags.add(tag);
        matchedTypeParts.push(part);
      } else {
        warnings.push(`type-unmapped:${part}`);
      }
    }
    const hasGood = matchedTypeParts.some(p => GOOD_TYPE_PARTS.has(p));
    const hasEvil = matchedTypeParts.some(p => EVIL_TYPE_PARTS.has(p));
    if (hasGood && hasEvil) tags.add('Dual Alignment');

    if (card.brigade) {
      try {
        const canonicalBrigades = normalizeBrigadeField(card.brigade, card.alignment, card.name);
        for (const brigade of canonicalBrigades) {
          tags.add(BRIGADE_TAGS[brigade] ?? brigade);
        }
      } catch {
        warnings.push(`brigade-unmapped:${card.brigade}`);
      }
    }

    if (card.officialSet) tags.add(card.officialSet);

    const normalizedRarity = normalizeRarity(card.rarity);
    if (normalizedRarity === 'Legacy Rare' || normalizedRarity === 'Ultra Rare') tags.add(normalizedRarity);

    if (card.legality === 'Rotation') tags.add('Rotation Cards');
    if (card.officialSet.startsWith('Promo')) tags.add('Promos');

    return { tags: Array.from(tags).sort(), warnings };
  }

  /** The managed tags this card should carry — sorted, deduped. */
  export function desiredTags(card: CardData): string[] {
    return computeCardTags(card).tags;
  }

  /**
   * MANAGED_TAGS = every tag desiredTags can emit. Diffing only ever
   * adds/removes tags in this set — hand-added merchandising tags are invisible
   * to the sync. Rule-derived where the rule is closed (types, brigades, the
   * five constants); data-derived for the open set of official set names
   * (enumerated from CARDS at module init).
   */
  function buildManagedTags(): ReadonlySet<string> {
    const managed = new Set<string>();
    for (const tag of Object.values(TYPE_TAGS)) managed.add(tag);
    for (const brigade of [...GOOD_BRIGADES, ...EVIL_BRIGADES]) {
      managed.add(BRIGADE_TAGS[brigade] ?? brigade);
    }
    for (const card of CARDS) {
      if (card.officialSet) managed.add(card.officialSet);
    }
    for (const tag of ['Legacy Rare', 'Ultra Rare', 'Rotation Cards', 'Promos', 'Dual Alignment']) {
      managed.add(tag);
    }
    return managed;
  }

  export const MANAGED_TAGS: ReadonlySet<string> = buildManagedTags();
  ```
- [ ] Run the test again:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags && npx vitest run lib/shopify/tagRules.test.ts
  ```
  Expected output: `Test Files  1 passed`, `Tests  3 passed`. The first test iterates all 5,691 CARDS comparing `desiredTags` against the still-unmodified `productFromCard` — this is the characterization lock.
- [ ] Commit:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags
  git add lib/shopify/tagRules.ts lib/shopify/tagRules.test.ts
  git commit -m "$(cat <<'EOF'
  feat(ytg): extract managed tag rules into lib/shopify/tagRules.ts

  desiredTags(card) + MANAGED_TAGS per the WS-1 contract in
  docs/superpowers/plans/2026-08-03-ytg-store/00-overview.md. Characterization
  test asserts tag-for-tag parity with the (still-inline) productFromCard
  logic across all of CARDS, plus MANAGED_TAGS coverage of every emitted tag.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: Refactor `productFromCard.ts` to consume `tagRules`

**Files:**
- Modify: `lib/shopify/productFromCard.ts`
- Test (existing, must stay green): `lib/shopify/productFromCard.test.ts`, `lib/shopify/tagRules.test.ts`, `lib/shopify/importSet.test.ts`

**Interfaces:**
- Consumed: `computeCardTags` from `lib/shopify/tagRules.ts`.
- Produced: `productFromCard` unchanged signature; its emitted `input.tags` and `warnings` are byte-identical before/after (locked by Task 1's characterization + the existing `productFromCard.test.ts` fixtures, e.g. `['Good Enhancement', 'Green', 'Prophecies of Christ', 'Rotation Cards', 'Teal']` and the Evil Gold brigade assertions).

**Steps:**

- [ ] Replace the entire contents of `/Users/timestes/projects/rtt-ytg-tags/lib/shopify/productFromCard.ts` with the refactored version. Deleted: `TYPE_TAGS`, `GOOD_TYPE_PARTS`, `EVIL_TYPE_PARTS`, `BRIGADE_TAGS`, `normalizeRarity`, the `normalizeBrigadeField` import, and the inline `--- tags ---` block (old L36–46, L81–116); the tag set now comes from `computeCardTags`, warnings appended in the same order (`no-set-alias` first, then type/brigade warnings, then `no-price`/`no-image` exactly as before):

  ```ts
  import type { CardData } from '@/lib/cards/generated/cardData';
  import { sanitizeImgFile } from '@/app/shared/utils/cardImageUrl';
  import { computeCardTags } from './tagRules';

  export interface ShopifyProductSetInput {
    title: string;
    handle: string;
    productType: string;
    vendor: string;
    tags: string[];
    status: 'DRAFT' | 'ACTIVE';
    descriptionHtml?: string;
    productOptions?: { name: string; values: { name: string }[] }[];
    variants?: { optionValues: { optionName: string; name: string }[]; price: string; sku: string; inventoryItem?: { tracked: boolean } }[];
    files?: { originalSource: string; contentType: 'IMAGE'; alt: string }[];
    metafields?: { namespace: string; key: string; value: string; type: string }[];
  }

  export interface ProductBuildOptions {
    price: string | null;        // normalized "1.50"; null => "0.00" + warning "no-price"
    imageUrl: string | null;     // null => no files + warning "no-image"
    status: 'DRAFT' | 'ACTIVE';
    titleOverride?: string;      // admin-entered title replaces the computed one verbatim
    includeMedia?: boolean;      // default true; false => omit files even if imageUrl set (update re-runs)
    includeVariants?: boolean;   // default true; false => omit variants + productOptions (blank-price updates leave live variant data untouched)
    includeDescription?: boolean; // default true; false => omit descriptionHtml even if specialAbility set (updates don't clobber store edits)
    trackInventory?: boolean;    // default true; false on update re-runs — never toggle tracking on live products
  }

  export interface BuiltProduct {
    cardKey: string;
    input: ShopifyProductSetInput;
    warnings: string[];          // 'no-price' | 'no-image' | 'no-set-alias' | `brigade-unmapped:<value>` | `type-unmapped:<value>`
  }

  export function baseCardName(name: string): string {
    return name.replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim();
  }

  export function slugifyTitle(title: string): string {
    return title.toLowerCase().replace(/['‘’"“”]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  export function cardSku(card: CardData): string {
    return `${card.set}-${sanitizeImgFile(card.imgFile)}`.replace(/\s+/g, '');
  }

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  export function productFromCard(card: CardData, ytgAbbrev: string | null, opts: ProductBuildOptions): BuiltProduct {
    const warnings: string[] = [];
    const cardKey = `${card.name}|${card.set}|${card.imgFile}`;

    if (!ytgAbbrev) warnings.push('no-set-alias');
    const title = opts.titleOverride ?? `${baseCardName(card.name)} (${ytgAbbrev ?? card.set})`;
    const handle = slugifyTitle(title);

    // --- tags (shared rules with the Products-tab tag sync — see tagRules.ts) ---
    const tagResult = computeCardTags(card);
    warnings.push(...tagResult.warnings);

    // --- variants / price ---
    const includeVariants = opts.includeVariants !== false;
    if (includeVariants && opts.price === null) warnings.push('no-price');
    const price = opts.price ?? '0.00';
    const trackInventory = opts.trackInventory !== false;

    // --- files / image ---
    if (opts.imageUrl === null) warnings.push('no-image');
    const files = opts.imageUrl !== null && opts.includeMedia !== false
      ? [{ originalSource: opts.imageUrl, contentType: 'IMAGE' as const, alt: baseCardName(card.name) }]
      : undefined;

    // --- description ---
    const trimmedAbility = card.specialAbility.trim();
    const descriptionHtml = opts.includeDescription !== false && trimmedAbility.length > 0
      ? `<p>${escapeHtml(trimmedAbility)}</p>`
      : undefined;

    const input: ShopifyProductSetInput = {
      title,
      handle,
      productType: 'Single',
      vendor: 'Your Turn Games',
      tags: tagResult.tags,
      status: opts.status,
      ...(descriptionHtml ? { descriptionHtml } : {}),
      ...(includeVariants ? {
        productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
        variants: [{
          optionValues: [{ optionName: 'Title', name: 'Default Title' }],
          price,
          sku: cardSku(card),
          ...(trackInventory ? { inventoryItem: { tracked: true } } : {}),
        }],
      } : {}),
      ...(files ? { files } : {}),
      metafields: [{ namespace: 'custom', key: 'rtt_card_key', value: cardKey, type: 'single_line_text_field' }],
    };

    return { cardKey, input, warnings };
  }
  ```
- [ ] Run the full shopify test set — characterization, product fixtures, and importer must all stay green:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags && npx vitest run lib/shopify/
  ```
  Expected output: all test files pass (`tagRules.test.ts`, `productFromCard.test.ts`, `importSet.test.ts`, `admin-write.test.ts`), 0 failures.
- [ ] Type check:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags && npx tsc --noEmit
  ```
  Expected: exit 0, no output.
- [ ] Commit:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags
  git add lib/shopify/productFromCard.ts
  git commit -m "$(cat <<'EOF'
  refactor(ytg): productFromCard consumes tagRules — importer and tag sync cannot drift

  Tag output is byte-identical before/after, locked by the tagRules
  characterization test over all of CARDS and the existing productFromCard
  fixtures. Warnings order preserved (no-set-alias, type/brigade, no-price,
  no-image).

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: Pure product-granularity diff — `lib/shopify/tagDiff.ts` (TDD)

**Files:**
- Create: `lib/shopify/tagDiff.ts`
- Test (create): `lib/shopify/tagDiff.test.ts`

**Interfaces:**
- Consumed: `desiredTags`, `MANAGED_TAGS` from `lib/shopify/tagRules.ts`; `CardData` type from `lib/cards/lookup.ts`.
- Produced:
  - `computeProductTagDiff(products: { id: string; title: string; handle: string; tags: string | null }[], mappingsByProduct: Map<string, CardData[]>): TagDiffRow[]`
  - `rollupTagChanges(rows: TagDiffRow[]): TagRollupEntry[]`
  - `splitTags(tags: string | null): string[]`
  - `STALENESS_LIMIT_MS = 3_600_000`
  - types `TagDiffRow { productId; title; handle; add; remove }`, `TagRollupEntry { tag; addCount; removeCount }`

**Steps:**

- [ ] Write the failing test at `/Users/timestes/projects/rtt-ytg-tags/lib/shopify/tagDiff.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import type { CardData } from '@/lib/cards/lookup';
  import { computeProductTagDiff, rollupTagChanges, splitTags } from './tagDiff';

  function makeCard(overrides: Partial<CardData>): CardData {
    return {
      name: 'Test Card',
      set: 'Ki',
      imgFile: 'test-card',
      officialSet: 'Kings',
      type: 'Hero',
      brigade: '',
      strength: '',
      toughness: '',
      class: '',
      identifier: '',
      specialAbility: '',
      rarity: 'Common',
      reference: '',
      alignment: 'Good',
      legality: '',
      ...overrides,
    };
  }
  // makeCard({}) => desiredTags = ['Hero', 'Kings']

  function product(id: string, title: string, tags: string | null) {
    return { id, title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), tags };
  }

  describe('computeProductTagDiff', () => {
    it('single mapping: adds missing desired tags, removes stale managed tags', () => {
      const rows = computeProductTagDiff(
        [product('1', 'Test Card (Ki)', 'Hero, Rotation Cards')],
        new Map([['1', [makeCard({})]]]),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].productId).toBe('1');
      expect(rows[0].add).toEqual(['Kings']);
      expect(rows[0].remove).toEqual(['Rotation Cards']);
    });

    it("spec promo_fallback scenario: union over multi-mapped product keeps BOTH 'Promos' and the original set tag", () => {
      // Card X (promo print) and card Y (original print) both map to product P
      // (promo fallback pass — shopify_product_id is not unique in card_price_mappings).
      const promoCard = makeCard({ name: 'Angel Food', officialSet: 'Promo', type: 'GE' });
      // desiredTags(promoCard) = ['Good Enhancement', 'Promo', 'Promos']
      const originalCard = makeCard({ name: 'Angel Food', officialSet: 'Kings', type: 'GE' });
      // desiredTags(originalCard) = ['Good Enhancement', 'Kings']
      const rows = computeProductTagDiff(
        [product('7', 'Angel Food (Ki)', 'Good Enhancement, Kings, Promos, Rotation Cards')],
        new Map([['7', [promoCard, originalCard]]]),
      );
      expect(rows).toHaveLength(1);
      // Desired = UNION of both prints — neither 'Promos' nor 'Kings' may be removed.
      expect(rows[0].remove).toEqual(['Rotation Cards']);
      expect(rows[0].remove).not.toContain('Promos');
      expect(rows[0].remove).not.toContain('Kings');
      expect(rows[0].add).toEqual(['Promo']);
    });

    it('never removes non-managed store tags', () => {
      const rows = computeProductTagDiff(
        [product('2', 'Test Card (Ki)', 'Hero, Kings, Staff Pick, Best Sellers, Rotation Cards')],
        new Map([['2', [makeCard({})]]]),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].remove).toEqual(['Rotation Cards']); // Staff Pick / Best Sellers untouched
      expect(rows[0].add).toEqual([]);
    });

    it('removes a managed (collision-name) tag when it is outside the union', () => {
      // 'Gold' is a managed brigade tag name Andy also hand-uses for merchandising.
      // On a MAPPED product carrying it outside the union, the diff proposes removal —
      // the per-tag removal opt-in in the UI is what protects hand-added uses.
      const rows = computeProductTagDiff(
        [product('3', 'Test Card (Ki)', 'Hero, Kings, Gold')],
        new Map([['3', [makeCard({})]]]),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].remove).toEqual(['Gold']);
      expect(rows[0].add).toEqual([]);
    });

    it('excludes clean products and products with no mapped cards', () => {
      const rows = computeProductTagDiff(
        [
          product('4', 'Clean Product', 'Hero, Kings'),          // matches desired exactly
          product('5', 'Unmapped Product', 'Rotation Cards'),    // no confirmed mapping → skipped
        ],
        new Map([['4', [makeCard({})]]]),
      );
      expect(rows).toEqual([]);
    });

    it('sorts rows by title and add/remove lists alphabetically', () => {
      const dominant = makeCard({ name: 'Dom', type: 'Dominant', officialSet: 'Apostles', legality: 'Rotation' });
      const rows = computeProductTagDiff(
        [product('11', 'Zeta Card', ''), product('10', 'Alpha Card', '')],
        new Map([
          ['11', [makeCard({})]],
          ['10', [dominant]],
        ]),
      );
      expect(rows.map(r => r.title)).toEqual(['Alpha Card', 'Zeta Card']);
      expect(rows[0].add).toEqual(['Apostles', 'Dominant', 'Rotation Cards']);
      expect(rows[1].add).toEqual(['Hero', 'Kings']);
    });
  });

  describe('rollupTagChanges', () => {
    it('counts adds and removes per tag, sorted by total desc then name', () => {
      const rollup = rollupTagChanges([
        { productId: '1', title: 'A', handle: 'a', add: ['Limited'], remove: ['Rotation Cards'] },
        { productId: '2', title: 'B', handle: 'b', add: ['Limited', 'Kings'], remove: [] },
        { productId: '3', title: 'C', handle: 'c', add: [], remove: ['Rotation Cards'] },
      ]);
      expect(rollup).toEqual([
        { tag: 'Limited', addCount: 2, removeCount: 0 },
        { tag: 'Rotation Cards', addCount: 0, removeCount: 2 },
        { tag: 'Kings', addCount: 1, removeCount: 0 },
      ]);
    });
  });

  describe('splitTags', () => {
    it('splits comma-separated tags and trims whitespace', () => {
      expect(splitTags('Hero, Kings ,  Rotation Cards')).toEqual(['Hero', 'Kings', 'Rotation Cards']);
    });
    it('returns [] for null, empty, and separator-only strings', () => {
      expect(splitTags(null)).toEqual([]);
      expect(splitTags('')).toEqual([]);
      expect(splitTags(' , ,')).toEqual([]);
    });
  });
  ```
- [ ] Run and confirm failure for the right reason:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags && npx vitest run lib/shopify/tagDiff.test.ts
  ```
  Expected output: FAIL — `Failed to resolve import "./tagDiff"`.
- [ ] Create `/Users/timestes/projects/rtt-ytg-tags/lib/shopify/tagDiff.ts`:

  ```ts
  /**
   * Pure product-granularity tag diff for the YTG Products tab.
   *
   * Kept free of Supabase/Shopify so the union-over-mappings rule is unit
   * testable. Server actions (app/admin/ytg/products/actions.ts) do the data
   * loading and feed this module.
   *
   * Diff granularity is the PRODUCT, not the mapping: multiple card_keys can
   * map to one product (promo fallback passes), so the desired managed tag set
   * is the UNION of desiredTags(card) over all confirmed mappings. Per-mapping
   * diffing oscillates and the post-apply "clean diff" check would never pass.
   *
   * Server-side only by weight (imports tagRules, whose init walks CARDS).
   * Client components may `import type` from here, never values.
   */

  import type { CardData } from '@/lib/cards/lookup';
  import { desiredTags, MANAGED_TAGS } from './tagRules';

  /** Apply is refused when the oldest involved mirror row is older than this. */
  export const STALENESS_LIMIT_MS = 60 * 60 * 1000; // 1 hour, per spec §Products tab

  export interface TagDiffRow {
    productId: string;
    title: string;
    handle: string;
    add: string[];     // desired ∖ current, sorted
    remove: string[];  // (current ∩ MANAGED_TAGS) ∖ desired, sorted
  }

  export interface TagRollupEntry {
    tag: string;
    addCount: number;
    removeCount: number;
  }

  /** Mirror `tags` column is Shopify's comma-separated string. */
  export function splitTags(tags: string | null): string[] {
    if (!tags) return [];
    return tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
  }

  export function computeProductTagDiff(
    products: { id: string; title: string; handle: string; tags: string | null }[],
    mappingsByProduct: Map<string, CardData[]>,
  ): TagDiffRow[] {
    const rows: TagDiffRow[] = [];

    for (const product of products) {
      const cards = mappingsByProduct.get(product.id);
      // No confirmed mapping ⇒ no union to diff against ⇒ never touch the
      // product (hand-tagged non-card products are the collision report's job).
      if (!cards || cards.length === 0) continue;

      const desired = new Set<string>();
      for (const card of cards) {
        for (const tag of desiredTags(card)) desired.add(tag);
      }

      const current = splitTags(product.tags);
      const currentSet = new Set(current);
      const currentManaged = new Set(current.filter(t => MANAGED_TAGS.has(t)));

      const add = Array.from(desired).filter(t => !currentSet.has(t)).sort();
      const remove = Array.from(currentManaged).filter(t => !desired.has(t)).sort();

      if (add.length === 0 && remove.length === 0) continue;
      rows.push({ productId: product.id, title: product.title, handle: product.handle, add, remove });
    }

    rows.sort((a, b) => a.title.localeCompare(b.title));
    return rows;
  }

  export function rollupTagChanges(rows: TagDiffRow[]): TagRollupEntry[] {
    const byTag = new Map<string, TagRollupEntry>();
    const entryFor = (tag: string): TagRollupEntry => {
      let entry = byTag.get(tag);
      if (!entry) {
        entry = { tag, addCount: 0, removeCount: 0 };
        byTag.set(tag, entry);
      }
      return entry;
    };
    for (const row of rows) {
      for (const tag of row.add) entryFor(tag).addCount++;
      for (const tag of row.remove) entryFor(tag).removeCount++;
    }
    return Array.from(byTag.values()).sort(
      (a, b) =>
        (b.addCount + b.removeCount) - (a.addCount + a.removeCount)
        || a.tag.localeCompare(b.tag),
    );
  }
  ```
- [ ] Run:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags && npx vitest run lib/shopify/tagDiff.test.ts
  ```
  Expected output: `Test Files  1 passed`, `Tests  9 passed`.
- [ ] Commit:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags
  git add lib/shopify/tagDiff.ts lib/shopify/tagDiff.test.ts
  git commit -m "$(cat <<'EOF'
  feat(ytg): pure product-granularity tag diff with union-over-mappings tests

  computeProductTagDiff + rollupTagChanges + splitTags + STALENESS_LIMIT_MS.
  Tests cover the spec's promo_fallback union scenario (Promos AND the
  original set tag both survive), managed-only removals, collision-name
  removal when outside the union, and unmapped/clean product exclusion.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: Server actions — diff, collisions, gated apply, sync

**Files:**
- Create: `app/admin/ytg/products/actions.ts`

**Interfaces:**
- Consumed: `hasPermission` from `utils/adminUtils.ts` (plain async server helper); `getSupabaseAdmin` from `lib/pricing/supabase-admin.ts`; `syncShopifyProducts(): Promise<{ upserted: number; errors: number }>` from `lib/pricing/syncShopifyProducts.ts` (post-WS-0 signature); `runAliasedMutations` + `AliasedMutation` from `lib/shopify/aliasBatch.ts` (WS-0 contract: chunks ≤40/document, per-alias userErrors, transport failures returned as synthetic userErrors); `CARDS`/`CardData` from `lib/cards/lookup.ts`; `MANAGED_TAGS` from `lib/shopify/tagRules.ts`; Task 3's `tagDiff` exports.
- Produced (server actions, each re-checks permission): `listMappedSets()`, `computeTagDiff(scope)`, `getCollisionReport()`, `applyTagChanges(changes)`, `syncNow()` and their `export interface` result types (type exports are erased, so they are legal in a `"use server"` file; all runtime exports are async functions).

**Steps:**

- [ ] Create `/Users/timestes/projects/rtt-ytg-tags/app/admin/ytg/products/actions.ts`:

  ```ts
  "use server";

  import { hasPermission } from "@/utils/adminUtils";
  import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
  import { syncShopifyProducts } from "@/lib/pricing/syncShopifyProducts";
  import { runAliasedMutations, type AliasedMutation } from "@/lib/shopify/aliasBatch";
  import { CARDS, type CardData } from "@/lib/cards/lookup";
  import { MANAGED_TAGS } from "@/lib/shopify/tagRules";
  import {
    computeProductTagDiff,
    rollupTagChanges,
    splitTags,
    STALENESS_LIMIT_MS,
    type TagDiffRow,
    type TagRollupEntry,
  } from "@/lib/shopify/tagDiff";

  // ---------- module-private plumbing ----------

  const CARD_BY_KEY = new Map<string, CardData>();
  for (const card of CARDS) {
    CARD_BY_KEY.set(`${card.name}|${card.set}|${card.imgFile}`, card);
  }

  // Layout gating does not protect server actions — every action re-checks.
  async function requireTagPermission(): Promise<void> {
    const ok = await hasPermission("manage_shopify_imports");
    if (!ok) throw new Error("Unauthorized: manage_shopify_imports permission required");
  }

  interface ConfirmedMapping {
    card_key: string;
    set_code: string;
    shopify_product_id: string;
  }

  /**
   * All confirmed mappings. Spec's "matched/manual" = DB statuses
   * 'auto_matched'/'manual' (see CardPriceMapping in lib/pricing/types.ts).
   */
  async function loadConfirmedMappings(): Promise<ConfirmedMapping[]> {
    const supabase = getSupabaseAdmin();
    const rows: ConfirmedMapping[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from("card_price_mappings")
        .select("card_key, set_code, shopify_product_id")
        .in("status", ["auto_matched", "manual"])
        .not("shopify_product_id", "is", null)
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(`Failed to load card_price_mappings: ${error.message}`);
      rows.push(...((data ?? []) as ConfirmedMapping[]));
      if (!data || data.length < pageSize) break;
    }
    return rows;
  }

  interface MirrorProduct {
    id: string;
    title: string;
    handle: string;
    tags: string | null;
    last_synced_at: string | null;
  }

  async function loadProductsByIds(ids: string[]): Promise<MirrorProduct[]> {
    const supabase = getSupabaseAdmin();
    const products: MirrorProduct[] = [];
    const chunkSize = 500;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from("shopify_products")
        .select("id, title, handle, tags, last_synced_at")
        .in("id", chunk);
      if (error) throw new Error(`Failed to load shopify_products: ${error.message}`);
      products.push(...((data ?? []) as MirrorProduct[]));
    }
    return products;
  }

  /** MIN(last_synced_at); null when empty or any row has never synced (maximally stale). */
  function oldestSync(products: { last_synced_at: string | null }[]): string | null {
    let oldest: string | null = null;
    for (const p of products) {
      if (p.last_synced_at === null) return null;
      if (oldest === null || p.last_synced_at < oldest) oldest = p.last_synced_at;
    }
    return oldest;
  }

  // ---------- actions ----------

  export interface MappedSet {
    setCode: string;
    count: number;
  }

  /** Set codes present in confirmed mappings, for the scope picker. */
  export async function listMappedSets(): Promise<MappedSet[]> {
    await requireTagPermission();
    const mappings = await loadConfirmedMappings();
    const counts = new Map<string, number>();
    for (const m of mappings) counts.set(m.set_code, (counts.get(m.set_code) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([setCode, count]) => ({ setCode, count }))
      .sort((a, b) => a.setCode.localeCompare(b.setCode));
  }

  export interface TagDiffResult {
    rows: TagDiffRow[];              // products with changes only
    rollup: TagRollupEntry[];        // per-tag add/remove counts
    oldestSyncAt: string | null;     // MIN last_synced_at of involved mirror rows
    productCount: number;            // mapped products scanned in scope
  }

  export async function computeTagDiff(scope: { setCode?: string }): Promise<TagDiffResult> {
    await requireTagPermission();
    const mappings = await loadConfirmedMappings();

    // 1) Scope selects PRODUCTS: any product with a confirmed mapping in the set.
    const inScope = new Set<string>();
    for (const m of mappings) {
      if (scope.setCode !== undefined && scope.setCode !== "" && m.set_code !== scope.setCode) continue;
      inScope.add(m.shopify_product_id);
    }

    // 2) The desired-tag union is over ALL confirmed mappings of those products —
    // never scope the union itself: a set-scoped union on a shared product
    // (promo print + original print) would mark the other print's tags for removal.
    const mappingsByProduct = new Map<string, CardData[]>();
    for (const m of mappings) {
      if (!inScope.has(m.shopify_product_id)) continue;
      const card = CARD_BY_KEY.get(m.card_key);
      if (!card) continue; // mapping predates a carddata regen — skip (fail-closed: no diff row)
      const list = mappingsByProduct.get(m.shopify_product_id);
      if (list) {
        list.push(card);
      } else {
        mappingsByProduct.set(m.shopify_product_id, [card]);
      }
    }

    const products = await loadProductsByIds(Array.from(inScope));
    const rows = computeProductTagDiff(products, mappingsByProduct);
    return {
      rows,
      rollup: rollupTagChanges(rows),
      oldestSyncAt: oldestSync(products),
      productCount: products.length,
    };
  }

  export interface CollisionEntry {
    tag: string;
    productCount: number;
    sampleTitles: string[];
  }

  /**
   * One-time reconciliation data: every live tag name across ALL mirror products
   * that is in MANAGED_TAGS but appears on products with NO confirmed mapping —
   * i.e. hand-tagged non-card products whose tag names collide with ours
   * ('Gold'/'Silver' are brigade names). The sync never edits those products;
   * this report is the sign-off context for per-tag removal opt-ins.
   */
  export async function getCollisionReport(): Promise<CollisionEntry[]> {
    await requireTagPermission();
    const supabase = getSupabaseAdmin();
    const mappedIds = new Set((await loadConfirmedMappings()).map((m) => m.shopify_product_id));

    const byTag = new Map<string, { productCount: number; sampleTitles: string[] }>();
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from("shopify_products")
        .select("id, title, tags")
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(`Failed to load shopify_products: ${error.message}`);
      for (const p of (data ?? []) as { id: string; title: string; tags: string | null }[]) {
        if (mappedIds.has(p.id)) continue;
        for (const tag of splitTags(p.tags)) {
          if (!MANAGED_TAGS.has(tag)) continue;
          let entry = byTag.get(tag);
          if (!entry) {
            entry = { productCount: 0, sampleTitles: [] };
            byTag.set(tag, entry);
          }
          entry.productCount++;
          if (entry.sampleTitles.length < 3) entry.sampleTitles.push(p.title);
        }
      }
      if (!data || data.length < pageSize) break;
    }

    return Array.from(byTag.entries())
      .map(([tag, e]) => ({ tag, productCount: e.productCount, sampleTitles: e.sampleTitles }))
      .sort((a, b) => b.productCount - a.productCount || a.tag.localeCompare(b.tag));
  }

  export interface TagChange {
    productId: string;
    add: string[];
    remove: string[];
  }

  export interface ApplyFailure {
    productId: string;
    add: string[];
    remove: string[];
    errors: string[];
  }

  export interface ApplyResult {
    applied: number;
    failed: ApplyFailure[];
    error: string | null; // non-null ⇒ nothing was attempted (e.g. staleness guard)
  }

  export async function applyTagChanges(changes: TagChange[]): Promise<ApplyResult> {
    await requireTagPermission();
    const active = changes.filter((c) => c.add.length > 0 || c.remove.length > 0);
    if (active.length === 0) return { applied: 0, failed: [], error: null };

    // Staleness guard: refuse when any targeted mirror row is >1h old (or
    // missing/never synced) — between-sync tag edits by Andy must stay bounded
    // by a window he's aware of.
    const targeted = await loadProductsByIds(active.map((c) => c.productId));
    const oldest = oldestSync(targeted);
    const oldestMs = oldest === null ? null : new Date(oldest).getTime();
    if (targeted.length < active.length || oldestMs === null || Date.now() - oldestMs > STALENESS_LIMIT_MS) {
      return {
        applied: 0,
        failed: [],
        error:
          `Product mirror is stale (oldest sync: ${oldest ?? "never"}). ` +
          `Use "Sync now" and recompute the diff before applying.`,
      };
    }

    // Mock mode short-circuits before any GraphQL write, like the importer.
    if (process.env.SHOPIFY_WRITE_MOCK === "1") {
      return { applied: active.length, failed: [], error: null };
    }

    // Build aliased tagsAdd/tagsRemove calls. JSON.stringify escapes quotes in
    // tag values (officialSet names contain apostrophes) into valid GraphQL
    // string/list literals. aliasBatch chunks ≤40 mutations per document and
    // returns one AliasedResult per input call, including synthetic userErrors
    // for rejected chunks.
    const calls: AliasedMutation[] = [];
    const aliasToProduct = new Map<string, string>();
    active.forEach((change, i) => {
      const gid = JSON.stringify(`gid://shopify/Product/${change.productId}`);
      if (change.add.length > 0) {
        const alias = `add${i}`;
        calls.push({
          alias,
          mutation: `tagsAdd(id: ${gid}, tags: ${JSON.stringify(change.add)})`,
          selection: `{ userErrors { field message } }`,
        });
        aliasToProduct.set(alias, change.productId);
      }
      if (change.remove.length > 0) {
        const alias = `rem${i}`;
        calls.push({
          alias,
          mutation: `tagsRemove(id: ${gid}, tags: ${JSON.stringify(change.remove)})`,
          selection: `{ userErrors { field message } }`,
        });
        aliasToProduct.set(alias, change.productId);
      }
    });

    const results = await runAliasedMutations(calls);

    const errorsByProduct = new Map<string, string[]>();
    for (const result of results) {
      if (result.userErrors.length === 0) continue;
      const productId = aliasToProduct.get(result.alias);
      if (productId === undefined) continue;
      const existing = errorsByProduct.get(productId) ?? [];
      for (const err of result.userErrors) existing.push(err.message);
      errorsByProduct.set(productId, existing);
    }

    const failed: ApplyFailure[] = [];
    for (const change of active) {
      const errors = errorsByProduct.get(change.productId);
      if (errors === undefined) continue;
      failed.push({ productId: change.productId, add: change.add, remove: change.remove, errors });
    }
    return { applied: active.length - failed.length, failed, error: null };
  }

  /** Inline staleness fix: refresh the mirror, then the client recomputes. */
  export async function syncNow(): Promise<{ upserted: number; errors: number }> {
    await requireTagPermission();
    return syncShopifyProducts();
  }
  ```
- [ ] Type check (this proves the WS-0 contracts line up — `aliasBatch` exports, `syncShopifyProducts` return shape):
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags && npx tsc --noEmit
  ```
  Expected: exit 0.
- [ ] Run the whole unit suite to confirm nothing regressed:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags && npm test
  ```
  Expected: all test files pass.
- [ ] Commit:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags
  git add app/admin/ytg/products/actions.ts
  git commit -m "$(cat <<'EOF'
  feat(ytg): products tab server actions — diff, collision report, gated apply, sync

  computeTagDiff scopes by PRODUCT but unions desired tags over ALL confirmed
  mappings of in-scope products (promo+original shared products stay intact).
  applyTagChanges guards on MIN(last_synced_at) > 1h, honors
  SHOPIFY_WRITE_MOCK=1, and maps per-alias userErrors back to productIds via
  runAliasedMutations. Every action re-checks manage_shopify_imports.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: UI leaf components — collision panel + scope picker

**Files:**
- Create: `app/admin/ytg/products/CollisionPanel.tsx`
- Create: `app/admin/ytg/products/ScopePicker.tsx`

**Interfaces:**
- Consumed: `import type { CollisionEntry, MappedSet } from "./actions"` (type-only imports from a `"use server"` module are erased — no server code reaches the client bundle); `Input` from `components/ui/input`.
- Produced: `<CollisionPanel collisions />` (always-visible collapsed warning panel — the locked design decision: warning panel, NOT a hard gate; expand/collapse is per-session React state, no localStorage, no tables) and `<ScopePicker sets value onChange disabled />` (searchable select; `""` = all sets).

**Steps:**

- [ ] Create `/Users/timestes/projects/rtt-ytg-tags/app/admin/ytg/products/CollisionPanel.tsx`:

  ```tsx
  "use client";

  import { useState } from "react";
  import type { CollisionEntry } from "./actions";

  /**
   * First-run reconciliation surface, shown as a collapsed warning panel above
   * the diff whenever collisions exist (locked design decision: panel, not a
   * hard gate — acknowledgment is this session's expand/collapse state only).
   * Removals of these tag names are per-tag opt-in in the rollup anyway, and
   * the sync never edits products without confirmed mappings.
   */
  export default function CollisionPanel({ collisions }: { collisions: CollisionEntry[] }) {
    const [open, setOpen] = useState(false);
    if (collisions.length === 0) return null;
    const total = collisions.reduce((sum, c) => sum + c.productCount, 0);

    return (
      <div className="rounded-lg bg-amber-50 p-4 dark:bg-amber-950/40">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between gap-2 text-left outline-none"
        >
          <span className="text-sm font-medium text-amber-900 dark:text-amber-200">
            {collisions.length} managed tag name{collisions.length === 1 ? "" : "s"} also appear
            {collisions.length === 1 ? "s" : ""} on {total.toLocaleString()} non-card product
            {total === 1 ? "" : "s"}
          </span>
          <span className="shrink-0 text-xs text-amber-700 dark:text-amber-300">
            {open ? "Hide" : "Details"}
          </span>
        </button>
        {open && (
          <div className="mt-3 space-y-3">
            <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
              These tag names collide with tags hand-added for merchandising on products that have
              no confirmed card mapping (e.g. brigade names like Gold or Silver used as product
              labels). This sync never edits those products — it only touches products with
              confirmed card mappings — and removing any of these tag names from mapped products
              is per-tag opt-in below. Leave a colliding tag unchecked to leave it alone everywhere.
            </p>
            <ul className="space-y-1.5 text-xs text-amber-900 dark:text-amber-200">
              {collisions.map((c) => (
                <li key={c.tag} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{c.tag}</span>
                  <span>
                    on {c.productCount.toLocaleString()} unmapped product{c.productCount === 1 ? "" : "s"}
                  </span>
                  <span className="text-amber-700 dark:text-amber-400">
                    e.g. {c.sampleTitles.join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  ```
- [ ] Create `/Users/timestes/projects/rtt-ytg-tags/app/admin/ytg/products/ScopePicker.tsx`:

  ```tsx
  "use client";

  import { useEffect, useMemo, useRef, useState } from "react";
  import { Input } from "@/components/ui/input";
  import type { MappedSet } from "./actions";

  interface ScopePickerProps {
    sets: MappedSet[];
    value: string; // "" = all sets
    onChange: (setCode: string) => void;
    disabled: boolean;
  }

  /** Searchable select of set codes present in confirmed mappings. */
  export default function ScopePicker({ sets, value, onChange, disabled }: ScopePickerProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      function onMouseDown(e: MouseEvent) {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setOpen(false);
        }
      }
      document.addEventListener("mousedown", onMouseDown);
      return () => document.removeEventListener("mousedown", onMouseDown);
    }, []);

    const filtered = useMemo(() => {
      const q = search.trim().toLowerCase();
      if (q === "") return sets;
      return sets.filter((s) => s.setCode.toLowerCase().includes(q));
    }, [sets, search]);

    function pick(setCode: string) {
      onChange(setCode);
      setOpen(false);
      setSearch("");
    }

    return (
      <div ref={containerRef} className="relative w-full sm:w-64">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between rounded-md bg-muted px-3 py-2 text-left text-sm outline-none hover:bg-muted/80 disabled:opacity-50"
        >
          <span>{value === "" ? "All sets" : value}</span>
          <span className="text-muted-foreground">▾</span>
        </button>
        {open && (
          <div className="absolute z-20 mt-1 w-full rounded-md bg-popover p-2 shadow-lg">
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search set codes…"
              className="mb-2 h-8"
            />
            <ul className="max-h-64 overflow-y-auto text-sm">
              <li>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => pick("")}
                >
                  All sets
                </button>
              </li>
              {filtered.map((s) => (
                <li key={s.setCode}>
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1.5 text-left hover:bg-muted"
                    onClick={() => pick(s.setCode)}
                  >
                    {s.setCode}
                    <span className="ml-2 text-xs text-muted-foreground">{s.count} mapped</span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-2 py-1.5 text-muted-foreground">No sets match</li>
              )}
            </ul>
          </div>
        )}
      </div>
    );
  }
  ```
- [ ] Type check:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags && npx tsc --noEmit
  ```
  Expected: exit 0.
- [ ] Commit:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags
  git add app/admin/ytg/products/CollisionPanel.tsx app/admin/ytg/products/ScopePicker.tsx
  git commit -m "$(cat <<'EOF'
  feat(ytg): products tab collision warning panel + searchable scope picker

  Collision panel is a collapsed warning above the diff (locked decision:
  panel, not hard gate; per-session state only, no localStorage/tables).

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: UI leaf components — rollup controls + diff table

**Files:**
- Create: `app/admin/ytg/products/RollupControls.tsx`
- Create: `app/admin/ytg/products/DiffTable.tsx`

**Interfaces:**
- Consumed: `import type { TagRollupEntry, TagDiffRow } from "@/lib/shopify/tagDiff"` (type-only — never value-import `tagDiff`/`tagRules` from client code; their module init walks CARDS and would drag the card database into the client bundle); `Checkbox` from `components/ui/checkbox` (Radix API: `checked` + `onCheckedChange`).
- Produced: `<RollupControls />` (additions: bulk-selectable with select-all/none; removals: per-tag opt-in, NO select-all) and `<DiffTable />` (rows with row-level exclude checkbox, green add chips, red remove chips, deselected tags rendered struck-through, incremental rendering for large diffs).

**Steps:**

- [ ] Create `/Users/timestes/projects/rtt-ytg-tags/app/admin/ytg/products/RollupControls.tsx`:

  ```tsx
  "use client";

  import { Checkbox } from "@/components/ui/checkbox";
  import type { TagRollupEntry } from "@/lib/shopify/tagDiff";

  interface RollupControlsProps {
    rollup: TagRollupEntry[];
    selectedAddTags: Set<string>;
    selectedRemoveTags: Set<string>;
    onToggleAdd: (tag: string) => void;
    onToggleRemove: (tag: string) => void;
    onSelectAllAdds: () => void;
    onClearAdds: () => void;
    disabled: boolean;
  }

  /**
   * Roll-up summary + selection controls. Additive writes are safe → additions
   * get select-all. Subtractive writes are where hand-added data dies → each
   * removal tag is an individual opt-in with NO select-all (spec-locked).
   */
  export default function RollupControls({
    rollup,
    selectedAddTags,
    selectedRemoveTags,
    onToggleAdd,
    onToggleRemove,
    onSelectAllAdds,
    onClearAdds,
    disabled,
  }: RollupControlsProps) {
    const adds = rollup.filter((r) => r.addCount > 0);
    const removes = rollup.filter((r) => r.removeCount > 0);

    return (
      <div className="space-y-3">
        {adds.length > 0 && (
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Additions
              </h3>
              <div className="flex gap-3 text-xs">
                <button
                  type="button"
                  onClick={onSelectAllAdds}
                  disabled={disabled}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={onClearAdds}
                  disabled={disabled}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  None
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {adds.map((r) => (
                <label
                  key={`add-${r.tag}`}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                >
                  <Checkbox
                    checked={selectedAddTags.has(r.tag)}
                    onCheckedChange={() => onToggleAdd(r.tag)}
                    disabled={disabled}
                    className="h-3.5 w-3.5"
                  />
                  + {r.tag} on {r.addCount.toLocaleString()}
                </label>
              ))}
            </div>
          </div>
        )}
        {removes.length > 0 && (
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Removals — opt in per tag
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Unchecked tags are excluded from every product. There is no select-all for removals.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {removes.map((r) => (
                <label
                  key={`rem-${r.tag}`}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs text-red-900 dark:bg-red-950 dark:text-red-200"
                >
                  <Checkbox
                    checked={selectedRemoveTags.has(r.tag)}
                    onCheckedChange={() => onToggleRemove(r.tag)}
                    disabled={disabled}
                    className="h-3.5 w-3.5"
                  />
                  − {r.tag} on {r.removeCount.toLocaleString()}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
  ```
- [ ] Create `/Users/timestes/projects/rtt-ytg-tags/app/admin/ytg/products/DiffTable.tsx`:

  ```tsx
  "use client";

  import { useState } from "react";
  import { Checkbox } from "@/components/ui/checkbox";
  import type { TagDiffRow } from "@/lib/shopify/tagDiff";

  const PAGE = 250; // incremental rendering — an all-store diff can exceed 2,000 rows

  interface DiffTableProps {
    rows: TagDiffRow[];
    selectedAddTags: Set<string>;
    selectedRemoveTags: Set<string>;
    excludedRows: Set<string>;
    onToggleRow: (productId: string) => void;
    disabled: boolean;
  }

  export default function DiffTable({
    rows,
    selectedAddTags,
    selectedRemoveTags,
    excludedRows,
    onToggleRow,
    disabled,
  }: DiffTableProps) {
    const [visible, setVisible] = useState(PAGE);
    const shown = rows.slice(0, visible);

    return (
      <div>
        <div className="space-y-px">
          {shown.map((row) => {
            const included = !excludedRows.has(row.productId);
            return (
              <div
                key={row.productId}
                className={`flex flex-col gap-2 rounded-md bg-card px-3 py-2 sm:flex-row sm:items-center ${included ? "" : "opacity-40"}`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Checkbox
                    checked={included}
                    onCheckedChange={() => onToggleRow(row.productId)}
                    disabled={disabled}
                    aria-label={`Include ${row.title}`}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm">{row.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{row.handle}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 sm:max-w-[55%] sm:justify-end">
                  {row.add.map((tag) => (
                    <span
                      key={`a-${tag}`}
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        selectedAddTags.has(tag)
                          ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                          : "bg-muted text-muted-foreground line-through"
                      }`}
                    >
                      +{tag}
                    </span>
                  ))}
                  {row.remove.map((tag) => (
                    <span
                      key={`r-${tag}`}
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        selectedRemoveTags.has(tag)
                          ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
                          : "bg-muted text-muted-foreground line-through"
                      }`}
                    >
                      −{tag}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {rows.length > visible && (
          <button
            type="button"
            onClick={() => setVisible(visible + PAGE)}
            className="mt-2 w-full rounded-md bg-muted py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Show {Math.min(PAGE, rows.length - visible).toLocaleString()} more (
            {(rows.length - visible).toLocaleString()} remaining)
          </button>
        )}
      </div>
    );
  }
  ```
- [ ] Type check:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags && npx tsc --noEmit
  ```
  Expected: exit 0.
- [ ] Commit:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags
  git add app/admin/ytg/products/RollupControls.tsx app/admin/ytg/products/DiffTable.tsx
  git commit -m "$(cat <<'EOF'
  feat(ytg): tag-diff rollup controls (per-tag removal opt-in) + diff table

  Additions get select-all; removal tags are individually opted in with no
  select-all (spec-locked). Rows carry an exclude checkbox; deselected tag
  chips render struck-through so the admin sees exactly what will apply.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 7: Orchestrator + page replacement — compute → review → gated apply → clean-diff verification

**Files:**
- Create: `app/admin/ytg/products/ProductsTagSync.tsx`
- Modify (replace WS-0 skeleton): `app/admin/ytg/products/page.tsx`

**Interfaces:**
- Consumed: all five server actions + their types from `./actions`; `CollisionPanel`, `ScopePicker`, `RollupControls`, `DiffTable`; `Button` from `components/ui/button`. `STALENESS_LIMIT_MS` is **inlined** (not imported — a value import of `tagDiff` pulls CARDS into the client bundle; same house pattern as the inlined interfaces in `app/admin/import-set/page.tsx`).
- Produced: the Products tab UI. Apply iterates chunks of 40 products per `applyTagChanges` call for a live progress counter; failures land in a retryable list; after apply the diff auto-recomputes and an empty diff renders the success state.

**Steps:**

- [ ] Create `/Users/timestes/projects/rtt-ytg-tags/app/admin/ytg/products/ProductsTagSync.tsx`:

  ```tsx
  "use client";

  import { useEffect, useMemo, useState } from "react";
  import { Button } from "@/components/ui/button";
  import {
    applyTagChanges,
    computeTagDiff,
    getCollisionReport,
    listMappedSets,
    syncNow,
  } from "./actions";
  import type {
    ApplyFailure,
    CollisionEntry,
    MappedSet,
    TagChange,
    TagDiffResult,
  } from "./actions";
  import CollisionPanel from "./CollisionPanel";
  import ScopePicker from "./ScopePicker";
  import RollupControls from "./RollupControls";
  import DiffTable from "./DiffTable";

  // Mirrors STALENESS_LIMIT_MS in lib/shopify/tagDiff.ts. Inlined (not imported)
  // because that module's init walks CARDS — a value import would pull the card
  // database into the client bundle (same pattern as app/admin/import-set/page.tsx).
  const STALENESS_LIMIT_MS = 60 * 60 * 1000;

  // Products per applyTagChanges call — matches aliasBatch's ≤40-mutations-per-
  // document budget and gives the progress counter chunk-level granularity.
  const CHUNK_SIZE = 40;

  export default function ProductsTagSync() {
    const [sets, setSets] = useState<MappedSet[]>([]);
    const [collisions, setCollisions] = useState<CollisionEntry[]>([]);
    const [loadError, setLoadError] = useState("");
    const [scopeSet, setScopeSet] = useState(""); // "" = all sets

    const [diff, setDiff] = useState<TagDiffResult | null>(null);
    const [computedAt, setComputedAt] = useState(0);
    const [computing, setComputing] = useState(false);

    const [selectedAddTags, setSelectedAddTags] = useState<Set<string>>(new Set());
    const [selectedRemoveTags, setSelectedRemoveTags] = useState<Set<string>>(new Set());
    const [excludedRows, setExcludedRows] = useState<Set<string>>(new Set());

    const [applying, setApplying] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [failures, setFailures] = useState<ApplyFailure[]>([]);
    const [lastApplied, setLastApplied] = useState<number | null>(null);
    const [actionError, setActionError] = useState("");

    const [syncing, setSyncing] = useState(false);

    useEffect(() => {
      let cancelled = false;
      Promise.all([listMappedSets(), getCollisionReport()])
        .then(([mappedSets, collisionReport]) => {
          if (cancelled) return;
          setSets(mappedSets);
          setCollisions(collisionReport);
        })
        .catch((err) => {
          if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
        });
      return () => {
        cancelled = true;
      };
    }, []);

    async function runComputeDiff(setCode: string) {
      setComputing(true);
      setActionError("");
      try {
        const result = await computeTagDiff(setCode === "" ? {} : { setCode });
        setDiff(result);
        setComputedAt(Date.now());
        // Additions default to all-selected (additive writes are safe);
        // removals default to none — per-tag opt-in, locked by the spec.
        const addTags = new Set<string>();
        for (const entry of result.rollup) {
          if (entry.addCount > 0) addTags.add(entry.tag);
        }
        setSelectedAddTags(addTags);
        setSelectedRemoveTags(new Set());
        setExcludedRows(new Set());
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setComputing(false);
      }
    }

    const isStale = useMemo(() => {
      if (diff === null) return false;
      if (diff.oldestSyncAt === null) return true;
      return computedAt - new Date(diff.oldestSyncAt).getTime() > STALENESS_LIMIT_MS;
    }, [diff, computedAt]);

    const effectiveChanges = useMemo<TagChange[]>(() => {
      if (diff === null) return [];
      const changes: TagChange[] = [];
      for (const row of diff.rows) {
        if (excludedRows.has(row.productId)) continue;
        const add = row.add.filter((t) => selectedAddTags.has(t));
        const remove = row.remove.filter((t) => selectedRemoveTags.has(t));
        if (add.length === 0 && remove.length === 0) continue;
        changes.push({ productId: row.productId, add, remove });
      }
      return changes;
    }, [diff, selectedAddTags, selectedRemoveTags, excludedRows]);

    async function runApply(changes: TagChange[]) {
      setApplying(true);
      setActionError("");
      setFailures([]);
      setProgress({ done: 0, total: changes.length });
      let applied = 0;
      const allFailed: ApplyFailure[] = [];
      try {
        for (let i = 0; i < changes.length; i += CHUNK_SIZE) {
          const chunk = changes.slice(i, i + CHUNK_SIZE);
          const result = await applyTagChanges(chunk);
          if (result.error !== null) {
            setActionError(result.error);
            setFailures(allFailed);
            return;
          }
          applied += result.applied;
          allFailed.push(...result.failed);
          setProgress({ done: Math.min(i + CHUNK_SIZE, changes.length), total: changes.length });
        }
        setLastApplied(applied);
        setFailures(allFailed);
        // Verification: recompute — a clean diff IS the success state.
        await runComputeDiff(scopeSet);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setApplying(false);
      }
    }

    async function runSyncNow() {
      setSyncing(true);
      setActionError("");
      try {
        await syncNow();
        await runComputeDiff(scopeSet);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setSyncing(false);
      }
    }

    function toggled(current: Set<string>, tag: string): Set<string> {
      const next = new Set(current);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    }

    const busy = computing || applying || syncing;

    return (
      <div className="mx-auto max-w-5xl space-y-4 pb-24">
        <div>
          <h2 className="text-lg font-semibold">Tag sync</h2>
          <p className="text-sm text-muted-foreground">
            Keep store tags in step with card data. Compute a diff, review it, then apply.
            Removals are opt-in per tag.
          </p>
        </div>

        {loadError !== "" && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{loadError}</div>
        )}

        <CollisionPanel collisions={collisions} />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ScopePicker sets={sets} value={scopeSet} onChange={setScopeSet} disabled={busy} />
          <Button onClick={() => runComputeDiff(scopeSet)} disabled={busy}>
            {computing ? "Computing…" : "Compute diff"}
          </Button>
        </div>

        {actionError !== "" && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{actionError}</div>
        )}

        {failures.length > 0 && (
          <div className="rounded-md bg-destructive/10 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-destructive">
                {failures.length} product{failures.length === 1 ? "" : "s"} failed to apply
              </p>
              <Button
                variant="outline"
                onClick={() =>
                  runApply(failures.map((f) => ({ productId: f.productId, add: f.add, remove: f.remove })))
                }
                disabled={busy}
              >
                Retry failed
              </Button>
            </div>
            <ul className="space-y-1 text-xs text-destructive">
              {failures.map((f) => (
                <li key={f.productId}>
                  Product {f.productId}: {f.errors.join("; ")}
                </li>
              ))}
            </ul>
          </div>
        )}

        {diff !== null && diff.rows.length === 0 && (
          <div className="rounded-lg bg-emerald-50 p-6 text-center dark:bg-emerald-950/40">
            <p className="text-base font-medium text-emerald-800 dark:text-emerald-200">
              Store tags match card data ✓
            </p>
            {lastApplied !== null && (
              <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
                Applied changes to {lastApplied.toLocaleString()} product{lastApplied === 1 ? "" : "s"}.
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {diff.productCount.toLocaleString()} mapped products scanned
              {scopeSet === "" ? " across all sets" : ` in ${scopeSet}`}.
            </p>
          </div>
        )}

        {diff !== null && diff.rows.length > 0 && (
          <>
            {isStale && (
              <div className="flex flex-col gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Mirror data is over an hour old (oldest sync:{" "}
                  {diff.oldestSyncAt === null ? "never" : new Date(diff.oldestSyncAt).toLocaleString()}
                  ). Sync before applying so tag edits made in Shopify aren&apos;t clobbered.
                </span>
                <Button variant="outline" onClick={runSyncNow} disabled={busy}>
                  {syncing ? "Syncing…" : "Sync now"}
                </Button>
              </div>
            )}

            <RollupControls
              rollup={diff.rollup}
              selectedAddTags={selectedAddTags}
              selectedRemoveTags={selectedRemoveTags}
              onToggleAdd={(tag) => setSelectedAddTags(toggled(selectedAddTags, tag))}
              onToggleRemove={(tag) => setSelectedRemoveTags(toggled(selectedRemoveTags, tag))}
              onSelectAllAdds={() => {
                const all = new Set<string>();
                for (const entry of diff.rollup) {
                  if (entry.addCount > 0) all.add(entry.tag);
                }
                setSelectedAddTags(all);
              }}
              onClearAdds={() => setSelectedAddTags(new Set())}
              disabled={applying}
            />

            <p className="text-xs text-muted-foreground">
              {diff.rows.length.toLocaleString()} products with changes (of{" "}
              {diff.productCount.toLocaleString()} mapped products scanned).
            </p>

            <DiffTable
              rows={diff.rows}
              selectedAddTags={selectedAddTags}
              selectedRemoveTags={selectedRemoveTags}
              excludedRows={excludedRows}
              onToggleRow={(id) => {
                const next = new Set(excludedRows);
                if (next.has(id)) {
                  next.delete(id);
                } else {
                  next.add(id);
                }
                setExcludedRows(next);
              }}
              disabled={applying}
            />

            <div className="sticky bottom-0 -mx-3 flex items-center justify-between gap-3 bg-background/80 p-3 backdrop-blur sm:mx-0 sm:rounded-lg">
              <span className="text-sm text-muted-foreground">
                {applying
                  ? `Applying… ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} products`
                  : `${effectiveChanges.length.toLocaleString()} product${effectiveChanges.length === 1 ? "" : "s"} selected`}
              </span>
              <Button
                onClick={() => runApply(effectiveChanges)}
                disabled={busy || isStale || effectiveChanges.length === 0}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {applying ? "Applying…" : `Apply to ${effectiveChanges.length.toLocaleString()} product${effectiveChanges.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }
  ```
- [ ] Replace the WS-0 skeleton at `/Users/timestes/projects/rtt-ytg-tags/app/admin/ytg/products/page.tsx` (permission gating lives in WS-0's `layout.tsx`; every server action re-checks independently):

  ```tsx
  import ProductsTagSync from "./ProductsTagSync";

  export const metadata = { title: "YTG Store — Products" };

  export default function ProductsPage() {
    return <ProductsTagSync />;
  }
  ```
- [ ] Type check and full unit suite:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags && npx tsc --noEmit && npm test
  ```
  Expected: tsc exits 0; all vitest files pass (including `tagRules.test.ts` 3 tests, `tagDiff.test.ts` 9 tests, and all pre-existing suites).
- [ ] Commit:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags
  git add app/admin/ytg/products/ProductsTagSync.tsx app/admin/ytg/products/page.tsx
  git commit -m "$(cat <<'EOF'
  feat(ytg): products tab UI — scope → diff → staleness-gated apply with clean-diff verification

  Replaces the WS-0 skeleton page. Chunked apply (40 products/call) with live
  progress, retryable failure list, inline Sync-now on stale mirror (Apply
  disabled while stale), and auto-recompute after apply — an empty diff is
  the success state. Mobile-capable, no focus rings, bg-shift sectioning.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 8: Final verification, push, PR

**Files:**
- No new files. Verifies and ships everything above.

**Interfaces:**
- Consumed: full test suite, `tsc`, `gh` CLI.
- Produced: PR `feat/ytg-tag-sync` → `main`.

**Steps:**

- [ ] Full gates (verification before completion — run these and confirm the output before claiming success):
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags
  npm test
  npx tsc --noEmit
  git status
  ```
  Expected: vitest all green; tsc exits 0 with no output; `git status` clean with only this plan's six commits on `feat/ytg-tag-sync` (verify with `git log --oneline origin/main..HEAD` — 6 commits, only files from this plan's Files lists).
- [ ] Optional manual smoke (dry-run, no Shopify writes): with `SHOPIFY_WRITE_MOCK=1` in `.env.local`, run `npm run dev` on a spare port (`PORT=3001 npm run dev`) in the worktree, sign in as a `manage_shopify_imports` admin, visit `/admin/ytg/products`, compute a single-set diff, opt into one removal tag, apply — mock mode reports success without touching the store; recompute still shows the diff (mirror unchanged), which is correct for mock mode.
- [ ] Push and open the PR:
  ```bash
  cd /Users/timestes/projects/rtt-ytg-tags
  git push -u origin feat/ytg-tag-sync
  gh pr create --base main --head feat/ytg-tag-sync \
    --title "feat(ytg): Products tab — tag sync (WS-1)" \
    --body "$(cat <<'EOF'
  ## Summary

  WS-1 of the YTG Store admin plan set (spec: docs/superpowers/specs/2026-08-03-ytg-store-admin-design.md §Products tab; overview: docs/superpowers/plans/2026-08-03-ytg-store/00-overview.md).

  - **`lib/shopify/tagRules.ts`** — tag rules extracted from `productFromCard.ts` per the shared contract: `desiredTags(card)` (sorted, deduped) + `MANAGED_TAGS` (all TYPE_TAGS values, all brigade tag names via BRIGADE_TAGS, all officialSet values enumerated from CARDS at module init, Legacy Rare / Ultra Rare / Rotation Cards / Promos / Dual Alignment). `productFromCard` now consumes it — importer and tag sync cannot drift. A characterization test asserts tag-for-tag parity across all 5,691 CARDS, written against the OLD inline behavior before the refactor.
  - **`lib/shopify/tagDiff.ts`** — pure product-granularity diff: desired = UNION of desiredTags over all confirmed mappings per product; only managed tags outside the union are removal candidates. Unit-tested without Supabase, including the spec's promo_fallback scenario (promo + original mapped to one product ⇒ both 'Promos' and the original set tag survive) and managed-only removals.
  - **Server actions** (`app/admin/ytg/products/actions.ts`, each re-checks `manage_shopify_imports`): `computeTagDiff` (scope selects products; union spans ALL their confirmed mappings; returns changed rows + per-tag rollup + MIN(last_synced_at) staleness), `getCollisionReport` (managed tag names on products with no confirmed mapping — the one-time reconciliation data), `applyTagChanges` (1-hour staleness guard, `SHOPIFY_WRITE_MOCK=1` short-circuit, aliased `tagsAdd`/`tagsRemove` via `runAliasedMutations`, per-alias userErrors mapped back to productIds), `syncNow`, `listMappedSets`.
  - **UI** replacing the WS-0 skeleton: collapsed collision warning panel (panel, not hard gate — per-session state, no localStorage/tables), searchable scope picker, rollup chips ("− Rotation Cards on 2,314"), additions bulk-selectable with select-all, removals per-tag opt-in with NO select-all, row-level exclude, staleness gate with inline Sync now (Apply disabled while stale), chunked apply (40 products/call) with progress counter and retryable failure list, auto-recompute after apply — clean diff renders "Store tags match card data ✓".

  ## Testing

  - `npm test` — all green, including new `lib/shopify/tagRules.test.ts` (characterization vs old productFromCard over all CARDS + MANAGED_TAGS coverage) and `lib/shopify/tagDiff.test.ts` (union-over-mappings, promo_fallback survival, managed-only removals, collision-name removal, rollup, splitTags).
  - `npx tsc --noEmit` — clean.
  - Dry-run smoke with `SHOPIFY_WRITE_MOCK=1`: compute → opt-in → apply completes without store writes.

  ## Notes for reviewers

  - No migrations, no new permissions, no edits to `layout.tsx`/`YtgTabs`/other workstreams' directories.
  - `tagRules`/`tagDiff` are server-side-only by weight (module init walks CARDS); client components use `import type` only and inline the staleness constant, per the import-set page's house pattern.
  - First real apply should be one small set with only additions selected, then the Rotation Cards removal after Andy reviews the collision panel.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```
  Expected: PR URL printed. Report the URL and stop — merge is the primary session's call. Clean up with `git worktree remove /Users/timestes/projects/rtt-ytg-tags` only after the PR merges (or leave for the finishing skill).

---

### Critical Files for Implementation

- /Users/timestes/projects/rtt-ytg-tags/lib/shopify/tagRules.ts (create — shared contract; extraction source is lib/shopify/productFromCard.ts L36–46 + L81–116)
- /Users/timestes/projects/rtt-ytg-tags/lib/shopify/productFromCard.ts (modify — must consume tagRules with byte-identical tag output)
- /Users/timestes/projects/rtt-ytg-tags/lib/shopify/tagDiff.ts (create — pure union-over-mappings diff, the correctness core)
- /Users/timestes/projects/rtt-ytg-tags/app/admin/ytg/products/actions.ts (create — permissioned data joins, staleness guard, aliased Shopify writes)
- /Users/timestes/projects/rtt-ytg-tags/app/admin/ytg/products/ProductsTagSync.tsx (create — orchestrator replacing WS-0's skeleton page)
