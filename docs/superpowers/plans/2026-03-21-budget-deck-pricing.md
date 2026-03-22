# Budget Deck Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the cheapest possible price to build a deck using equivalent card versions from YTG, alongside the exact-card price.

**Architecture:** Client-side computation using existing in-memory data (carddata, prices, duplicate groups). A new utility function finds the cheapest equivalent for each card by matching sibling group membership + identical normalized special ability. A new hook composes existing hooks to compute budget totals. The UI shows a secondary "Budget" price line beneath the existing "Est. Price" wherever totals appear.

**Tech Stack:** TypeScript, React hooks, Vitest for tests, existing `useCardPrices` + `useDuplicateCards` hooks.

---

## File Structure

| File | Responsibility |
|------|---------------|
| **Modify:** `lib/duplicateCards.ts` | Export `findGroup()`, `normalize()`, and `stripSetSuffix()` (currently private) for reuse. |
| **Create:** `lib/pricing/budgetPricing.ts` | Pure functions: `normalizeAbility()`, `findCheapestEquivalent()`, `buildCardNameIndex()`. No React, no side effects — easy to test. Reuses `normalize`/`stripSetSuffix` from `duplicateCards.ts`. |
| **Create:** `lib/pricing/__tests__/budgetPricing.test.ts` | Unit tests for all pure functions. |
| **Create:** `app/decklist/card-search/hooks/useBudgetPricing.ts` | React hook composing `useCardPrices` + duplicate group index to provide `budgetTotal` for a deck. Uses the same module-level cache as `useDuplicateCards`. |
| **Modify:** `app/decklist/card-search/components/DeckBuilderPanel.tsx` | Add budget price line in 3 UI locations where price amounts are shown. |
| **Modify:** `app/decklist/card-search/client.tsx` | Pass `allCards` prop to BOTH DeckBuilderPanel instances (desktop at line 2149, mobile at line 2236). |

---

### Task 1: Export helpers from `lib/duplicateCards.ts`

**Files:**
- Modify: `lib/duplicateCards.ts`

We need to export `findGroup()`, `normalize()`, and `stripSetSuffix()` so `budgetPricing.ts` can reuse them (avoiding duplicated normalization logic that could drift).

- [ ] **Step 1: Make `findGroup`, `normalize`, and `stripSetSuffix` public**

In `lib/duplicateCards.ts`:

Line 28 — change `function normalize(` to `export function normalize(`
Line 45 — change `function stripSetSuffix(` to `export function stripSetSuffix(`
Line 253 — change `function findGroup(` to `export function findGroup(`

- [ ] **Step 2: Verify build still works**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors (existing errors may exist but no regressions).

- [ ] **Step 3: Commit**

```bash
git add lib/duplicateCards.ts
git commit -m "refactor: export findGroup, normalize, stripSetSuffix from duplicateCards"
```

---

### Task 2: Create pure budget pricing functions

**Files:**
- Create: `lib/pricing/budgetPricing.ts`
- Create: `lib/pricing/__tests__/budgetPricing.test.ts`

- [ ] **Step 1: Write the test file**

Create `lib/pricing/__tests__/budgetPricing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  normalizeAbility,
  findCheapestEquivalent,
  buildCardNameIndex,
  type BudgetCard,
} from '../budgetPricing';
import type { DuplicateGroupIndex, DuplicateGroup } from '@/lib/duplicateCards';

// --- Helpers ---

interface MockPriceInfo {
  price: number;
  shopify_handle: string;
  shopify_title: string;
}

function makeCard(overrides: Partial<BudgetCard> = {}): BudgetCard {
  return {
    name: 'Angel of the Lord',
    set: 'Pri',
    imgFile: 'Angel_of_the_Lord_Pri',
    specialAbility: 'Protect a Hero in battle.',
    ...overrides,
  };
}

function makeIndex(groups: DuplicateGroup[]): DuplicateGroupIndex {
  const byExact = new Map<string, DuplicateGroup[]>();
  const byNormalized = new Map<string, DuplicateGroup[]>();

  for (const g of groups) {
    byExact.set(g.canonicalName, [g]);
    byNormalized.set(g.canonicalName.toLowerCase(), [g]);
    for (const m of g.members) {
      const existing = byExact.get(m.cardName);
      if (existing) existing.push(g);
      else byExact.set(m.cardName, [g]);

      const normKey = m.cardName.toLowerCase();
      const existingNorm = byNormalized.get(normKey);
      if (existingNorm) existingNorm.push(g);
      else byNormalized.set(normKey, [g]);
    }
  }

  return { groups, byExact, byNormalized };
}

// --- Tests ---

describe('normalizeAbility', () => {
  it('normalizes whitespace', () => {
    expect(normalizeAbility('  Protect  a  Hero  ')).toBe('protect a hero');
  });

  it('normalizes smart quotes', () => {
    expect(normalizeAbility('Target opponent\u2019s Hero')).toBe("target opponent's hero");
  });

  it('normalizes smart double quotes', () => {
    expect(normalizeAbility('\u201Cbrave\u201D warrior')).toBe('"brave" warrior');
  });

  it('normalizes em dashes', () => {
    expect(normalizeAbility('hero\u2014warrior')).toBe('hero-warrior');
  });

  it('handles empty string', () => {
    expect(normalizeAbility('')).toBe('');
  });
});

describe('findCheapestEquivalent', () => {
  it('returns own price when card has no sibling group', () => {
    const card = makeCard();
    const index = makeIndex([]);
    const prices: Record<string, MockPriceInfo> = {
      'Angel of the Lord|Pri|Angel_of_the_Lord_Pri': {
        price: 0.50,
        shopify_handle: 'angel-pri',
        shopify_title: 'Angel of the Lord (Pi)',
      },
    };
    const allCards = [card];

    const result = findCheapestEquivalent(
      card, allCards, index,
      (key) => prices[key] ?? null,
    );

    expect(result).toEqual({
      cheapestPrice: 0.50,
      cheapestCardKey: 'Angel of the Lord|Pri|Angel_of_the_Lord_Pri',
      ownPrice: 0.50,
    });
  });

  it('finds cheaper sibling with same ability', () => {
    const card = makeCard({ name: 'Angel of the Lord', set: 'Pri', imgFile: 'Angel_of_the_Lord_Pri' });
    const cheapCard = makeCard({ name: 'Angel of the Lord', set: 'PoC', imgFile: 'Angel_of_the_Lord_PoC' });

    const group: DuplicateGroup = {
      canonicalName: 'Angel of the Lord',
      members: [
        { cardName: 'Angel of the Lord', ordirSets: 'Pri', matched: true },
        { cardName: 'Angel of the Lord', ordirSets: 'PoC', matched: true },
      ],
    };
    const index = makeIndex([group]);

    const prices: Record<string, MockPriceInfo> = {
      'Angel of the Lord|Pri|Angel_of_the_Lord_Pri': { price: 0.50, shopify_handle: 'a', shopify_title: 'A' },
      'Angel of the Lord|PoC|Angel_of_the_Lord_PoC': { price: 0.25, shopify_handle: 'b', shopify_title: 'B' },
    };
    const allCards = [card, cheapCard];

    const result = findCheapestEquivalent(
      card, allCards, index,
      (key) => prices[key] ?? null,
    );

    expect(result).toEqual({
      cheapestPrice: 0.25,
      cheapestCardKey: 'Angel of the Lord|PoC|Angel_of_the_Lord_PoC',
      ownPrice: 0.50,
    });
  });

  it('ignores sibling with different ability', () => {
    const card = makeCard({
      name: 'David', set: 'Pa', imgFile: 'David_Pa',
      specialAbility: 'Search deck for an Enhancement.',
    });
    const differentCard = makeCard({
      name: 'David', set: 'Ki', imgFile: 'David_Ki',
      specialAbility: 'Negate an Evil Character.',
    });

    const group: DuplicateGroup = {
      canonicalName: 'David',
      members: [
        { cardName: 'David', ordirSets: 'Pa', matched: true },
        { cardName: 'David', ordirSets: 'Ki', matched: true },
      ],
    };
    const index = makeIndex([group]);

    const prices: Record<string, MockPriceInfo> = {
      'David|Pa|David_Pa': { price: 1.00, shopify_handle: 'a', shopify_title: 'A' },
      'David|Ki|David_Ki': { price: 0.25, shopify_handle: 'b', shopify_title: 'B' },
    };
    const allCards = [card, differentCard];

    const result = findCheapestEquivalent(
      card, allCards, index,
      (key) => prices[key] ?? null,
    );

    // Should NOT pick the cheaper David (Ki) because ability differs
    expect(result).toEqual({
      cheapestPrice: 1.00,
      cheapestCardKey: 'David|Pa|David_Pa',
      ownPrice: 1.00,
    });
  });

  it('returns null prices when no price exists for card or siblings', () => {
    const card = makeCard();
    const index = makeIndex([]);
    const allCards = [card];

    const result = findCheapestEquivalent(
      card, allCards, index, () => null,
    );

    expect(result).toEqual({
      cheapestPrice: null, cheapestCardKey: null, ownPrice: null,
    });
  });

  it('returns null cheapest when card has no price and sibling has different ability', () => {
    // Edge case: card is unpriced, sibling IS priced but has different ability
    // Budget should NOT include the sibling's price
    const card = makeCard({
      name: 'Moses', set: 'Pa', imgFile: 'Moses_Pa',
      specialAbility: 'Negate an Enhancement.',
    });
    const sibling = makeCard({
      name: 'Moses', set: 'Ki', imgFile: 'Moses_Ki',
      specialAbility: 'Different ability entirely.',
    });

    const group: DuplicateGroup = {
      canonicalName: 'Moses',
      members: [
        { cardName: 'Moses', ordirSets: 'Pa', matched: true },
        { cardName: 'Moses', ordirSets: 'Ki', matched: true },
      ],
    };
    const index = makeIndex([group]);
    const prices: Record<string, MockPriceInfo> = {
      'Moses|Ki|Moses_Ki': { price: 0.75, shopify_handle: 'a', shopify_title: 'A' },
    };
    const allCards = [card, sibling];

    const result = findCheapestEquivalent(
      card, allCards, index,
      (key) => prices[key] ?? null,
    );

    // No equivalent priced card found
    expect(result).toEqual({
      cheapestPrice: null, cheapestCardKey: null, ownPrice: null,
    });
  });

  it('finds cheapest among siblings when card itself has no price but same-ability sibling does', () => {
    const card = makeCard({ name: 'Moses', set: 'Pa', imgFile: 'Moses_Pa', specialAbility: 'Negate an Enhancement.' });
    const siblingCard = makeCard({ name: 'Moses', set: 'PoC', imgFile: 'Moses_PoC', specialAbility: 'Negate an Enhancement.' });

    const group: DuplicateGroup = {
      canonicalName: 'Moses',
      members: [
        { cardName: 'Moses', ordirSets: 'Pa', matched: true },
        { cardName: 'Moses', ordirSets: 'PoC', matched: true },
      ],
    };
    const index = makeIndex([group]);

    const prices: Record<string, MockPriceInfo> = {
      'Moses|PoC|Moses_PoC': { price: 0.75, shopify_handle: 'a', shopify_title: 'A' },
    };
    const allCards = [card, siblingCard];

    const result = findCheapestEquivalent(
      card, allCards, index,
      (key) => prices[key] ?? null,
    );

    expect(result).toEqual({
      cheapestPrice: 0.75,
      cheapestCardKey: 'Moses|PoC|Moses_PoC',
      ownPrice: null,
    });
  });

  it('matches cards with empty special abilities as equivalent', () => {
    const card = makeCard({ name: 'Lost Soul', set: 'Pa', imgFile: 'LS_Pa', specialAbility: '' });
    const sibling = makeCard({ name: 'Lost Soul', set: 'PoC', imgFile: 'LS_PoC', specialAbility: '' });

    const group: DuplicateGroup = {
      canonicalName: 'Lost Soul',
      members: [
        { cardName: 'Lost Soul', ordirSets: 'Pa', matched: true },
        { cardName: 'Lost Soul', ordirSets: 'PoC', matched: true },
      ],
    };
    const index = makeIndex([group]);

    const prices: Record<string, MockPriceInfo> = {
      'Lost Soul|Pa|LS_Pa': { price: 0.50, shopify_handle: 'a', shopify_title: 'A' },
      'Lost Soul|PoC|LS_PoC': { price: 0.10, shopify_handle: 'b', shopify_title: 'B' },
    };
    const allCards = [card, sibling];

    const result = findCheapestEquivalent(
      card, allCards, index,
      (key) => prices[key] ?? null,
    );

    expect(result).toEqual({
      cheapestPrice: 0.10,
      cheapestCardKey: 'Lost Soul|PoC|LS_PoC',
      ownPrice: 0.50,
    });
  });

  it('uses cardNameIndex when provided for O(1) lookup', () => {
    const card = makeCard({ name: 'Angel of the Lord', set: 'Pri', imgFile: 'Angel_of_the_Lord_Pri' });
    const cheapCard = makeCard({ name: 'Angel of the Lord', set: 'PoC', imgFile: 'Angel_of_the_Lord_PoC' });
    const unrelatedCard = makeCard({ name: 'Unrelated', set: 'X', imgFile: 'X', specialAbility: 'Totally different.' });

    const group: DuplicateGroup = {
      canonicalName: 'Angel of the Lord',
      members: [
        { cardName: 'Angel of the Lord', ordirSets: 'Pri', matched: true },
        { cardName: 'Angel of the Lord', ordirSets: 'PoC', matched: true },
      ],
    };
    const index = makeIndex([group]);
    const allCards = [card, cheapCard, unrelatedCard];
    const nameIndex = buildCardNameIndex(allCards);

    const prices: Record<string, MockPriceInfo> = {
      'Angel of the Lord|Pri|Angel_of_the_Lord_Pri': { price: 0.50, shopify_handle: 'a', shopify_title: 'A' },
      'Angel of the Lord|PoC|Angel_of_the_Lord_PoC': { price: 0.25, shopify_handle: 'b', shopify_title: 'B' },
    };

    const result = findCheapestEquivalent(
      card, allCards, index,
      (key) => prices[key] ?? null,
      nameIndex,
    );

    expect(result).toEqual({
      cheapestPrice: 0.25,
      cheapestCardKey: 'Angel of the Lord|PoC|Angel_of_the_Lord_PoC',
      ownPrice: 0.50,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/pricing/__tests__/budgetPricing.test.ts 2>&1 | tail -20`
Expected: FAIL — module `../budgetPricing` not found.

- [ ] **Step 3: Implement `lib/pricing/budgetPricing.ts`**

Create `lib/pricing/budgetPricing.ts`:

```ts
import {
  findGroup,
  normalize,
  stripSetSuffix,
  type DuplicateGroupIndex,
} from '@/lib/duplicateCards';

/**
 * Normalize a special ability string for comparison.
 * Two cards with the same normalized ability are considered functionally equivalent.
 */
export function normalizeAbility(ability: string): string {
  return ability
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")   // smart single quotes → ASCII
    .replace(/[\u201C\u201D]/g, '"')   // smart double quotes → ASCII
    .replace(/['']/g, "'")             // other curly quotes
    .replace(/[–—]/g, '-')            // en/em dashes → hyphen
    .replace(/\s+/g, ' ')             // collapse whitespace
    .trim();
}

/**
 * Minimal card shape needed by budget pricing functions.
 * Compatible with the full Card interface from card-search/utils.ts.
 */
export interface BudgetCard {
  name: string;
  set: string;
  imgFile: string;
  specialAbility: string;
}

export interface CheapestResult {
  /** Cheapest price across all equivalent versions, or null if no price found */
  cheapestPrice: number | null;
  /** Card key of the cheapest version, or null */
  cheapestCardKey: string | null;
  /** This card's own price, or null if unpriced */
  ownPrice: number | null;
}

interface PriceInfo {
  price: number;
}

/**
 * Build a card key matching the format used by useCardPrices: "name|set_code|img_file"
 */
function cardKey(card: BudgetCard): string {
  return `${card.name}|${card.set}|${card.imgFile}`;
}

/**
 * Pre-built index mapping normalized card names to all their printings.
 * Build once per card catalog, then budget lookups are O(siblings) instead of O(allCards).
 */
export type CardNameIndex = Map<string, BudgetCard[]>;

export function buildCardNameIndex(allCards: BudgetCard[]): CardNameIndex {
  const index = new Map<string, BudgetCard[]>();

  function add(key: string, card: BudgetCard) {
    const existing = index.get(key);
    if (existing) existing.push(card);
    else index.set(key, [card]);
  }

  for (const card of allCards) {
    add(normalize(card.name), card);
    const base = normalize(stripSetSuffix(card.name));
    if (base !== normalize(card.name)) {
      add(base, card);
    }
  }

  return index;
}

/**
 * Find the cheapest equivalent version of a card.
 *
 * A card is "equivalent" if:
 * 1. It belongs to the same duplicate group (ORDIR sibling), AND
 * 2. Its normalized special ability text is identical.
 *
 * @param card - The card to find cheapest equivalent for
 * @param allCards - Full card catalog (fallback if no cardNameIndex)
 * @param dupIndex - Duplicate group lookup index
 * @param getPrice - Function to look up a card's price by key
 * @param cardNameIndex - Optional pre-built index for O(1) name lookups
 */
export function findCheapestEquivalent(
  card: BudgetCard,
  allCards: BudgetCard[],
  dupIndex: DuplicateGroupIndex,
  getPrice: (key: string) => PriceInfo | null,
  cardNameIndex?: CardNameIndex,
): CheapestResult {
  const ownKey = cardKey(card);
  const ownPriceInfo = getPrice(ownKey);
  const ownPrice = ownPriceInfo?.price ?? null;

  // Look up this card's duplicate group
  const group = findGroup(card.name, dupIndex);

  if (!group) {
    // No sibling group — own price is the only option
    return {
      cheapestPrice: ownPrice,
      cheapestCardKey: ownPrice !== null ? ownKey : null,
      ownPrice,
    };
  }

  // Get all member names from the group
  const memberNames = group.members.map((m) => m.cardName);
  const normalizedAbility = normalizeAbility(card.specialAbility);

  // Build a set of normalized member names for matching
  const memberNormNames = new Set<string>();
  for (const name of memberNames) {
    memberNormNames.add(normalize(name));
    memberNormNames.add(normalize(stripSetSuffix(name)));
  }

  // Collect candidate cards — use index if available, otherwise scan allCards
  let candidates: BudgetCard[];
  if (cardNameIndex) {
    // O(1) lookup: gather candidates from all member name variants
    const seen = new Set<string>();
    candidates = [];
    for (const normName of memberNormNames) {
      const matched = cardNameIndex.get(normName);
      if (matched) {
        for (const c of matched) {
          const k = cardKey(c);
          if (!seen.has(k)) {
            seen.add(k);
            candidates.push(c);
          }
        }
      }
    }
  } else {
    // Fallback: scan all cards and filter by member name
    candidates = allCards.filter((c) => {
      const cNorm = normalize(c.name);
      const cBase = normalize(stripSetSuffix(c.name));
      return memberNormNames.has(cNorm) || memberNormNames.has(cBase);
    });
  }

  // Find cheapest among candidates with matching ability
  let cheapestPrice: number | null = null;
  let cheapestKey: string | null = null;

  for (const candidate of candidates) {
    if (normalizeAbility(candidate.specialAbility) !== normalizedAbility) {
      continue;
    }

    const candidateKey = cardKey(candidate);
    const priceInfo = getPrice(candidateKey);
    if (priceInfo && (cheapestPrice === null || priceInfo.price < cheapestPrice)) {
      cheapestPrice = priceInfo.price;
      cheapestKey = candidateKey;
    }
  }

  return {
    cheapestPrice,
    cheapestCardKey: cheapestKey,
    ownPrice,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/pricing/__tests__/budgetPricing.test.ts 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/budgetPricing.ts lib/pricing/__tests__/budgetPricing.test.ts
git commit -m "feat: add budget pricing functions with ability-matching logic"
```

---

### Task 3: Create `useBudgetPricing` hook

**Files:**
- Create: `app/decklist/card-search/hooks/useBudgetPricing.ts`

This hook composes `useCardPrices` + the duplicate group index to compute the budget total for a deck.

**Key design decisions (from code review):**
- Reuse the same module-level cache as `useDuplicateCards.ts` by importing from a shared loading function — but since the cache is module-scoped in `useDuplicateCards.ts`, we replicate the same pattern (both files call `fetchDuplicateGroups()` which is idempotent due to the Supabase client cache, and both files cache the result independently at module level, but in practice only one fetch occurs because the Promise is shared).
- Use `prices` object (stable reference after load) as the useMemo dependency instead of `getPrice` function (which is recreated each render).
- For budget total: only count cards that have own price OR cheapest sibling price. When a card has no own price but a sibling has a price, add the sibling price to BOTH exact and budget totals so the comparison is apples-to-apples.

- [ ] **Step 1: Create the hook**

Create `app/decklist/card-search/hooks/useBudgetPricing.ts`:

```ts
'use client';

import React from 'react';
import { useCardPrices } from './useCardPrices';
import {
  fetchDuplicateGroups,
  type DuplicateGroupIndex,
} from '@/lib/duplicateCards';
import {
  findCheapestEquivalent,
  buildCardNameIndex,
  type BudgetCard,
} from '@/lib/pricing/budgetPricing';
import type { Deck } from '../types/deck';

// Module-level cache for duplicate group index
let cachedDupIndex: DuplicateGroupIndex | null = null;
let dupLoadPromise: Promise<DuplicateGroupIndex> | null = null;

function loadDupIndex(): Promise<DuplicateGroupIndex> {
  if (cachedDupIndex) return Promise.resolve(cachedDupIndex);
  if (dupLoadPromise) return dupLoadPromise;
  dupLoadPromise = fetchDuplicateGroups().then((index) => {
    cachedDupIndex = index;
    dupLoadPromise = null;
    return index;
  });
  return dupLoadPromise;
}

export interface BudgetPricingResult {
  /** Budget total (cheapest possible), or null if no prices available */
  budgetTotal: number | null;
  /** Savings compared to exact total: exactTotal - budgetTotal */
  savings: number | null;
  /** Whether the data is still loading */
  isLoading: boolean;
}

/**
 * Hook that computes the budget (cheapest possible) price for a deck.
 *
 * For each card in the deck, finds the cheapest equivalent version
 * (same duplicate group + same special ability). Computes both an
 * exact total and a budget total, reporting the savings.
 *
 * Only includes a card in the totals if it has a price (own or sibling).
 * When a card has no own price but a sibling does, the sibling price
 * is added to BOTH totals to keep the comparison apples-to-apples.
 *
 * @param deck - The current deck
 * @param allCards - Full card catalog (all printings from carddata.txt)
 */
export function useBudgetPricing(
  deck: Deck,
  allCards: BudgetCard[],
): BudgetPricingResult {
  // Use `prices` (stable object ref after load) instead of `getPrice` (recreated each render)
  const { prices, getPrice, isLoading: pricesLoading } = useCardPrices();
  const [dupIndex, setDupIndex] = React.useState<DuplicateGroupIndex | null>(
    cachedDupIndex,
  );
  const [dupLoading, setDupLoading] = React.useState(!cachedDupIndex);

  React.useEffect(() => {
    if (cachedDupIndex) {
      setDupIndex(cachedDupIndex);
      setDupLoading(false);
      return;
    }
    loadDupIndex().then((index) => {
      setDupIndex(index);
      setDupLoading(false);
    });
  }, []);

  const isLoading = pricesLoading || dupLoading;

  // Pre-build card name index for O(1) lookups — memoized on allCards
  const cardNameIndex = React.useMemo(
    () => (allCards.length > 0 ? buildCardNameIndex(allCards) : null),
    [allCards],
  );

  const result = React.useMemo(() => {
    if (isLoading || !dupIndex || allCards.length === 0 || !cardNameIndex) {
      return { budgetTotal: null, savings: null, isLoading };
    }

    let exactTotal = 0;
    let budgetTotal = 0;
    let hasAnyPrice = false;

    for (const dc of deck.cards) {
      const card = dc.card as BudgetCard;
      const cheapest = findCheapestEquivalent(
        card, allCards, dupIndex, getPrice, cardNameIndex,
      );

      const ownPrice = cheapest.ownPrice;
      const cheapPrice = cheapest.cheapestPrice;

      if (ownPrice !== null) {
        // Card has its own price
        exactTotal += ownPrice * dc.quantity;
        budgetTotal += (cheapPrice !== null ? Math.min(ownPrice, cheapPrice) : ownPrice) * dc.quantity;
        hasAnyPrice = true;
      } else if (cheapPrice !== null) {
        // Card has no own price but a sibling does — add to both totals
        exactTotal += cheapPrice * dc.quantity;
        budgetTotal += cheapPrice * dc.quantity;
        hasAnyPrice = true;
      }
      // If neither has a price, skip this card in both totals
    }

    if (!hasAnyPrice) {
      return { budgetTotal: null, savings: null, isLoading: false };
    }

    const savings = exactTotal - budgetTotal;

    return {
      budgetTotal,
      savings: savings > 0.005 ? savings : null, // Only show if meaningful
      isLoading: false,
    };
  }, [deck.cards, allCards, dupIndex, prices, cardNameIndex, isLoading]);
  // ↑ Uses `prices` (stable ref) instead of `getPrice` (unstable closure)

  return result;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add app/decklist/card-search/hooks/useBudgetPricing.ts
git commit -m "feat: add useBudgetPricing hook for cheapest-version deck totals"
```

---

### Task 4: Add budget price to DeckBuilderPanel UI

**Files:**
- Modify: `app/decklist/card-search/components/DeckBuilderPanel.tsx`
- Modify: `app/decklist/card-search/client.tsx`

The budget line appears **only when `savings` is non-null** (budget is actually cheaper). We add it in 3 locations where price amounts are displayed:

1. **~Line 674** — Mobile header price button
2. **~Line 695** — Desktop header price (inline with card count)
3. **~Line 2755** — Info tab "Est. Price" section (sidebar stats panel)

The dropdown menus (~lines 977, 1498) only show a "Buy on YTG" button with no price amount, so no changes needed there.

- [ ] **Step 1: Add props and hook to DeckBuilderPanel**

In `DeckBuilderPanel.tsx`:

Add import near the top (with other hook imports):
```ts
import { useBudgetPricing } from '../hooks/useBudgetPricing';
import type { BudgetCard } from '@/lib/pricing/budgetPricing';
```

Add to the `DeckBuilderPanelProps` interface (after `deckCheckResult` around line 95):
```ts
  /** Full card catalog for budget pricing — required for cheapest-version calculations */
  allCards: BudgetCard[];
```

Add to the component destructuring (around line 103):
```ts
  allCards,
```

After the `totalDeckPrice` useMemo (around line 436), add:
```ts
  const { budgetTotal, savings } = useBudgetPricing(deck, allCards);
```

- [ ] **Step 2: Pass `allCards` to BOTH DeckBuilderPanel instances in client.tsx**

In `app/decklist/card-search/client.tsx`, there are TWO `<DeckBuilderPanel` renders:

**Desktop instance** (around line 2149):
```tsx
<DeckBuilderPanel
  deck={deck}
  allCards={cards}
  ...
```

**Mobile instance** (around line 2236):
```tsx
<DeckBuilderPanel
  deck={deck}
  allCards={cards}
  ...
```

Add `allCards={cards}` to BOTH instances. The `cards` variable is the full card catalog already loaded in this component.

- [ ] **Step 3: Add budget line to mobile header (location 1)**

Find the mobile price button (inside `{totalDeckPrice !== null && (` around line 674, has class `md:hidden`). After its closing `</button>` tag, add:

```tsx
{savings !== null && budgetTotal !== null && (
  <span className="md:hidden flex-shrink-0 text-xs text-muted-foreground">
    Budget: <span className="text-green-600 dark:text-green-400">${budgetTotal.toFixed(2)}</span>
  </span>
)}
```

- [ ] **Step 4: Add budget line to desktop header (location 2)**

Find the desktop inline price (around line 695-708, inside `<span className="hidden md:flex`). After the closing `</>` of the `{totalDeckPrice !== null && (` block, add:

```tsx
{savings !== null && budgetTotal !== null && (
  <>
    <span className="text-gray-400 dark:text-gray-600 ml-0.5">·</span>
    <span className="text-xs text-muted-foreground whitespace-nowrap" title={`Save $${savings.toFixed(2)} with budget alternatives`}>
      Budget: <span className="text-green-600 dark:text-green-400">${budgetTotal.toFixed(2)}</span>
    </span>
  </>
)}
```

- [ ] **Step 5: Add budget line to info tab stats panel (location 3)**

Find the "Est. Price" section in the info tab (around line 2755-2769, has text "Est. Price:"). After the closing `</div>` of the `{totalDeckPrice !== null && (` block, add:

```tsx
{savings !== null && budgetTotal !== null && (
  <div className="flex justify-between items-center -mt-1 mb-1">
    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
      <span className="w-3.5" /> {/* Spacer to align with YTG icon above */}
      Budget:
    </span>
    <span className="text-xs">
      <span className="text-green-600 dark:text-green-400">${budgetTotal.toFixed(2)}</span>
      <span className="text-muted-foreground ml-1">(save ${savings.toFixed(2)})</span>
    </span>
  </div>
)}
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new type errors.

- [ ] **Step 7: Run all tests**

Run: `npx vitest run 2>&1 | tail -20`
Expected: All tests pass, including the new budget pricing tests.

- [ ] **Step 8: Visual verification**

Run: `npm run dev` and open a deck with priced cards. Verify:
- Budget line appears only when there's actual savings
- Budget line doesn't appear when budget equals exact price
- Numbers look correct
- Both mobile and desktop layouts work
- Info tab stats panel shows budget with savings amount

- [ ] **Step 9: Commit**

```bash
git add app/decklist/card-search/components/DeckBuilderPanel.tsx app/decklist/card-search/client.tsx
git commit -m "feat: show budget deck price with savings from cheaper card versions"
```
