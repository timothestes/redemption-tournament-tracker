# Format Restructure (Limited / Unlimited / T2 / Paragon) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the T1/T2/Paragon string-matched format model with a canonical four-format registry (Limited / Unlimited / T2 / Paragon), new rules (T1 50–70; T2 100–140, reserve 20, flat 2-copy), and first-ever card-pool validation.

**Architecture:** A registry module (`lib/formats.ts`) is the single source of truth for format ids, sizes, pools, ban-list structure, and labels. The `utils/deckcheck` validator dispatches on canonical `FormatId` by rule family; ~30 scattered `.includes()`/exact-match sites are converted to `normalizeFormat()`. A DB backfill lands strictly LAST, after all code conversion.

**Tech Stack:** Next.js 15 / TypeScript / vitest / Supabase migrations. Spec: `docs/superpowers/specs/2026-07-25-format-restructure-design.md` (rev 2 — the authority on every rule detail).

## Global Constraints

- **Worktree isolation:** all work in `/Users/timestes/projects/rtt-format-impl` on branch `feat/format-restructure` off `origin/main`. Absolute paths only. Never touch `/Users/timestes/projects/redemption-tournament-tracker`. `git add` only your specific files — never `-A`/`.`.
- **Canonical stored values:** `'Limited' | 'Unlimited' | 'T2' | 'Paragon'`. Badges `L / U / T2 / P`.
- **Card-data values `'Rotation'` / `'Banned'` and forge `'Classic'` comparisons are data, not labels — never rename them.** Only UI mode labels rename (Rotation→Limited, Classic→Unlimited).
- **Ordering:** Task 9 (backfill migration) must not be applied to any database until Tasks 1–8 are merged and deployed. Creating the SQL file is in scope; applying it is a deploy-time step with the user.
- **Verification commands:** `npx tsc --noEmit` for type gate (never `next build` — a dev server may be running); `npx vitest run <path>` for tests.
- **tsconfig has `strict: false`:** union narrowing via `if (x.ok)` does not narrow — use explicit `=== false` / `=== true` comparisons.
- **Type 2 test fixtures:** T2 decks need exact good/evil balance and exact LS counts (14 @ 100–105) to isolate the rule under test; reuse the fixture-builder helpers already present in `utils/deckcheck/__tests__/rules-t2.test.ts`.

---

### Task 1: Format registry (`lib/formats.ts`)

**Files:**
- Create: `lib/formats.ts`
- Create: `lib/__tests__/formats.test.ts`
- Modify: `app/decklist/card-search/client.tsx` (only to note: the 27-set Paragon list at ~line 1023 is the source to copy verbatim; the client.tsx edit itself happens in Task 6)

**Interfaces:**
- Consumes: nothing (foundation).
- Produces (exact — every later task imports from `lib/formats`):
  - `type FormatId = 'Limited' | 'Unlimited' | 'T2' | 'Paragon'`
  - `type PoolId = 'rotation' | 'all' | 'paragon'`
  - `interface BannedCardDef { name: string; set?: string; reference?: string; note: string }`
  - `interface FormatDef { id: FormatId; label: string; badge: string; family: 'T1'|'T2'|'Paragon'; main: {min: number; max: number}; reserveMax: number; pool: PoolId; banList: BannedCardDef[] }`
  - `const FORMATS: Record<FormatId, FormatDef>`
  - `const FORMAT_IDS: FormatId[]` (display order: Limited, Unlimited, T2, Paragon)
  - `function normalizeFormat(s: string | null | undefined): FormatId`
  - `function getFormatDef(s: string | null | undefined): FormatDef`
  - `function normalizeTournamentFormat(s: string | null | undefined): FormatId | 'Other' | null`
  - `const PARAGON_EXCLUDED_SETS: ReadonlySet<string>`

- [ ] **Step 1: Write failing tests** in `lib/__tests__/formats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeFormat, normalizeTournamentFormat, FORMATS, PARAGON_EXCLUDED_SETS } from '../formats';

describe('normalizeFormat', () => {
  it.each([
    ['Type 1', 'Limited'], ['T1', 'Limited'], ['type 1', 'Limited'],
    [null, 'Limited'], [undefined, 'Limited'], ['', 'Limited'], ['Limited', 'Limited'],
    ['Type 2', 'T2'], ['t2', 'T2'], ['T2', 'T2'], ['Type 2 - 2 Player', 'T2'], ['type2_2player', 'T2'],
    ['Unlimited', 'Unlimited'], ['Type 1 Unlimited', 'Unlimited'], ['Classic', 'Unlimited'], ['classic', 'Unlimited'],
    ['Paragon', 'Paragon'], ['Paragon Type 1', 'Paragon'], ['paragon', 'Paragon'],
    ['Type 1 Limited', 'Limited'], ['Single', 'Limited'],
  ])('maps %j to %s', (input, expected) => {
    expect(normalizeFormat(input as string | null | undefined)).toBe(expected);
  });
});

describe('normalizeTournamentFormat', () => {
  it.each([
    [null, null], ['', null], ['Other', 'Other'],
    ['Booster Draft (GoC x3)', 'Other'], ['Sealed Deck', 'Other'],
    ['T1', 'Limited'], ['Type 1', 'Limited'], ['Type 1 Unlimited', 'Unlimited'],
    ['T2', 'T2'], ['Type 2', 'T2'], ['Paragon', 'Paragon'],
  ])('maps %j to %j', (input, expected) => {
    expect(normalizeTournamentFormat(input as string | null | undefined)).toBe(expected);
  });
});

describe('FORMATS registry', () => {
  it('has the spec sizes', () => {
    expect(FORMATS.Limited.main).toEqual({ min: 50, max: 70 });
    expect(FORMATS.Unlimited.main).toEqual({ min: 50, max: 70 });
    expect(FORMATS.T2.main).toEqual({ min: 100, max: 140 });
    expect(FORMATS.T2.reserveMax).toBe(20);
    expect(FORMATS.Paragon.main).toEqual({ min: 40, max: 40 });
    expect(FORMATS.Limited.reserveMax).toBe(10);
    expect(FORMATS.Unlimited.pool).toBe('all');
  });
  it('all ban lists start empty', () => {
    for (const def of Object.values(FORMATS)) expect(def.banList).toEqual([]);
  });
  it('paragon excluded sets carried over', () => {
    expect(PARAGON_EXCLUDED_SETS.has('Cloud of Witnesses')).toBe(true);
    expect(PARAGON_EXCLUDED_SETS.has('Roots 2')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure:** `npx vitest run lib/__tests__/formats.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `lib/formats.ts`:**

```ts
/**
 * Canonical deck/tournament format model. Single source of truth for format
 * ids, rules constants, card pools, ban lists, and display names.
 * Spec: docs/superpowers/specs/2026-07-25-format-restructure-design.md
 */

export type FormatId = 'Limited' | 'Unlimited' | 'T2' | 'Paragon';
export type PoolId = 'rotation' | 'all' | 'paragon';

export interface BannedCardDef {
  name: string;
  set?: string;       // TSV set code (e.g. "CoW [Ban]"), NOT the full set name
  reference?: string; // scripture reference match (all printings)
  note: string;
}

export interface FormatDef {
  id: FormatId;
  label: string;
  badge: string;
  family: 'T1' | 'T2' | 'Paragon';
  main: { min: number; max: number };
  reserveMax: number;
  pool: PoolId;
  banList: BannedCardDef[];
}

// All four ban lists launch empty by design (Unlimited deliberately so — see
// spec §1). Baseline exclusion is data-driven: legality !== 'Rotation' fails
// the Limited/T2 pool test; Paragon's excluded sets cover the rest.
export const FORMATS: Record<FormatId, FormatDef> = {
  Limited:   { id: 'Limited',   label: 'Limited',   badge: 'L',  family: 'T1',      main: { min: 50,  max: 70 },  reserveMax: 10, pool: 'rotation', banList: [] },
  Unlimited: { id: 'Unlimited', label: 'Unlimited', badge: 'U',  family: 'T1',      main: { min: 50,  max: 70 },  reserveMax: 10, pool: 'all',      banList: [] },
  T2:        { id: 'T2',        label: 'T2',        badge: 'T2', family: 'T2',      main: { min: 100, max: 140 }, reserveMax: 20, pool: 'rotation', banList: [] },
  Paragon:   { id: 'Paragon',   label: 'Paragon',   badge: 'P',  family: 'Paragon', main: { min: 40,  max: 40 },  reserveMax: 10, pool: 'paragon',  banList: [] },
};

export const FORMAT_IDS: FormatId[] = ['Limited', 'Unlimited', 'T2', 'Paragon'];

/**
 * Map any historical or current format string to a canonical FormatId.
 * Precedence is load-bearing: paragon → type 2 → unlimited/classic → Limited.
 * ('Classic' was the old name for the all-cards pool.) Unlike the matchmaking
 * normalizer in lib/deck-format.ts (untouched), this does NOT treat 'multi'
 * as T2 — no stored value needs it and it would misclassify "Type 1 Multiplayer".
 */
export function normalizeFormat(s: string | null | undefined): FormatId {
  const fmt = (s ?? '').toLowerCase();
  if (fmt.includes('paragon')) return 'Paragon';
  if (fmt.includes('type 2') || fmt.includes('type2') || fmt === 't2') return 'T2';
  if (fmt.includes('unlimited') || fmt.includes('classic')) return 'Unlimited';
  return 'Limited';
}

export function getFormatDef(s: string | null | undefined): FormatDef {
  return FORMATS[normalizeFormat(s)];
}

/**
 * Tournament-side normalization. Unlike decks, tournaments may legitimately
 * have no constructed format: null stays null and 'Other'/draft/sealed stay
 * 'Other' — both mean "do not gate deck attachment" (spec §6).
 */
export function normalizeTournamentFormat(
  s: string | null | undefined
): FormatId | 'Other' | null {
  if (s == null || s.trim() === '') return null;
  const fmt = s.toLowerCase();
  if (fmt === 'other' || fmt.includes('draft') || fmt.includes('sealed')) return 'Other';
  return normalizeFormat(s);
}

// Paragon card pool: sets NOT legal in Paragon, matched against
// CardData.officialSet. Moved verbatim from app/decklist/card-search/client.tsx
// (~line 1023); that file and its two duplicates import from here (Task 6).
export const PARAGON_EXCLUDED_SETS: ReadonlySet<string> = new Set([
  '10th Anniversary',
  '1st Edition',
  '1st Edition Unlimited',
  '2nd Edition',
  '2nd Edition Revised',
  '3rd Edition',
  'Angel Wars',
  'Apostles',
  'Cloud of Witnesses',
  'Cloud of Witnesses (Alternate Border)',
  'Disciples',
  'Early Church',
  'Faith of Our Fathers',
  'Fall of Man',
  'Fundraiser',
  'Gospel of Christ',
  'Gospel of Christ Token',
  'Kings',
  'Lineage of Christ',
  'Main',
  'Main Unlimited',
  'Patriarchs',
  'Persecuted Church',
  'Priests',
  'Promo',
  'Promo Token',
  'Prophecies of Christ',
  'Prophecies of Christ Token',
  'Prophets',
  'Revelation of John',
  'Revelation of John (Alternate Border)',
  'Rock of Ages',
  'Thesaurus ex Preteritus',
  'Warriors',
  'Women',
]);
```

- [ ] **Step 4: Verify pass:** `npx vitest run lib/__tests__/formats.test.ts` → PASS. Then `npx tsc --noEmit`.
- [ ] **Step 5: Commit:** `git add lib/formats.ts lib/__tests__/formats.test.ts && git commit -m "feat(formats): canonical format registry — Limited/Unlimited/T2/Paragon"`

---

### Task 2: Validator dispatch, pool-legality rule, T1 sizes, ban retirement

**Files:**
- Modify: `utils/deckcheck/types.ts` (ResolvedCard gains `legality`, `officialSet`)
- Modify: `utils/deckcheck/index.ts` (resolveCard plumbing; format dispatch via `getFormatDef`)
- Modify: `utils/deckcheck/rules.ts` (checkDeckSize 50–70; new `checkPoolLegality`; DELETE `BANNED_CARDS`, `matchesBannedCard`, `checkBannedCards` and their calls; export `isSpecialExceptionCard`)
- Modify: `utils/deckcheck/__tests__/rules.test.ts` (size expectations; banned-card tests replaced by pool tests)
- Check first: `utils/deckcheck/cardDatabase.ts` — confirm `findCard` returns objects that include `legality` and `officialSet` (they come from `lib/cards` CardData; if the local type re-declares fields, add both).

**Interfaces:**
- Consumes: `getFormatDef`, `FormatDef`, `PARAGON_EXCLUDED_SETS` from `lib/formats` (Task 1).
- Produces:
  - `ResolvedCard` now has `legality: string` and `officialSet: string` (empty string on card-not-found stub).
  - `checkPoolLegality(def: FormatDef, mainDeckCards: ResolvedCard[], reserveCards: ResolvedCard[]): DeckCheckIssue[]` — rule id `pool-legality`.
  - `validateT1Rules(def: FormatDef, mainDeckCards, reserveCards, cardGroups)` — signature gains leading `def`; `checkDeckSize(mainDeckCards, min, max)` parameterized.
  - `isSpecialExceptionCard(card: ResolvedCard): boolean` exported (Task 3 needs it).
  - `checkDeck(cards, reserve, format?)` unchanged signature; `result.format` is now the canonical id string.

- [ ] **Step 1: Write failing tests** (append to `utils/deckcheck/__tests__/rules.test.ts`, using that file's existing card-fixture helpers):

```ts
describe('pool legality', () => {
  it('rejects a non-Rotation card in a rotation pool', () => {
    const card = makeCard({ name: 'Old Card', legality: '', officialSet: 'Kings' });
    const issues = checkPoolLegality(FORMATS.Limited, [card], []);
    expect(issues.some((i) => i.rule === 'pool-legality')).toBe(true);
  });
  it('accepts everything in the all pool (incl. Banned-flagged cards)', () => {
    const card = makeCard({ name: 'Daniel (CoW)', legality: 'Banned', officialSet: 'Cloud of Witnesses' });
    expect(checkPoolLegality(FORMATS.Unlimited, [card], [])).toEqual([]);
  });
  it('rejects excluded sets in the paragon pool', () => {
    const card = makeCard({ name: 'Old Hero', legality: 'Rotation', officialSet: 'Kings' });
    expect(checkPoolLegality(FORMATS.Paragon, [card], []).length).toBe(1);
  });
  it('skips card-not-found stubs', () => {
    const stub = makeCard({ name: 'Mystery', type: '', legality: '', officialSet: '' });
    expect(checkPoolLegality(FORMATS.Limited, [stub], [])).toEqual([]);
  });
});

describe('T1 deck size (new 50-70)', () => {
  it('rejects 71+', () => {
    // build a legal-except-size 71-card deck with the fixture helper
    const issues = checkDeckSize(cards71, 50, 70);
    expect(issues.some((i) => i.rule === 't1-deck-size')).toBe(true);
  });
});
```

Also DELETE the existing `checkBannedCards` describe block (the rule is retired).

- [ ] **Step 2: Run to verify failure:** `npx vitest run utils/deckcheck` → new tests FAIL.
- [ ] **Step 3: Implement.**

`types.ts` — add to `ResolvedCard`: `legality: string;` and `officialSet: string;`

`index.ts` `resolveCard` — in the found branch add `legality: cardData.legality, officialSet: cardData.officialSet,`; in the stub branch add `legality: "", officialSet: "",`.

`index.ts` `checkDeck` step 4 — replace the fuzzy dispatch:

```ts
import { getFormatDef } from "@/lib/formats";
// ...
const def = getFormatDef(format);
const ruleIssues =
  def.family === "Paragon"
    ? validateParagonRules(def, mainDeckCards, reserveCards, cardGroups)
    : def.family === "T2"
      ? validateT2Rules(def, mainDeckCards, reserveCards, cardGroups)
      : validateT1Rules(def, mainDeckCards, reserveCards, cardGroups);
issues.push(...ruleIssues);
// result.format: use def.id; requiredLostSouls picks the T2 chart when def.family === "T2"
```

`rules.ts` — new rule (place near the other shared rules):

```ts
import { FormatDef, PARAGON_EXCLUDED_SETS } from "@/lib/formats";

/**
 * Rule: pool-legality — every card must belong to the format's card pool.
 * First-ever pool enforcement (previously search-filter only, spec §4).
 */
export function checkPoolLegality(
  def: FormatDef,
  mainDeckCards: ResolvedCard[],
  reserveCards: ResolvedCard[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  if (def.pool === "all") return issues;
  for (const card of [...mainDeckCards, ...reserveCards]) {
    if (card.quantity === 0) continue;
    if (card.type === "") continue; // card-not-found stub — card-not-found warning already fired
    if (def.pool === "rotation" && card.legality !== "Rotation") {
      issues.push({
        type: "error",
        rule: "pool-legality",
        message: `"${card.name}" (${card.set}) is not in the ${def.label} card pool.`,
        cards: [card.name],
      });
    } else if (def.pool === "paragon" && PARAGON_EXCLUDED_SETS.has(card.officialSet)) {
      issues.push({
        type: "error",
        rule: "pool-legality",
        message: `"${card.name}" (${card.set}) is from a set that is not Paragon legal.`,
        cards: [card.name],
      });
    }
  }
  return issues;
}
```

`rules.ts` — `checkDeckSize(mainDeckCards, min = 50, max = 70)`: replace hardcoded 50/154 with params (messages use the params). `validateT1Rules(def, …)` / `validateParagonRules(def, …)` gain leading `def`, call `checkDeckSize(mainDeckCards, def.main.min, def.main.max)`, `checkReserveSize(reserveCards, def.reserveMax)` (same parameterization, default 10), and append `checkPoolLegality(def, mainDeckCards, reserveCards)`. Delete `BANNED_CARDS`, `matchesBannedCard`, `checkBannedCards`, and every `checkBannedCards(...)` call (3 sites). Export `isSpecialExceptionCard`. Paragon keeps its exact-40 via `checkParagonDeckSize` (already 40/40 — leave, or fold into checkDeckSize with def values; either is fine, keep messages).

- [ ] **Step 4: Verify:** `npx vitest run utils/deckcheck` → PASS (fix any pre-existing tests asserting 154 max / banned cards). `npx tsc --noEmit`.
- [ ] **Step 5: Commit:** `git add utils/deckcheck lib/formats.ts && git commit -m "feat(deckcheck): registry dispatch, pool-legality rule, T1 50-70, retire dead ban matcher"`

---

### Task 3: New T2 validator (flat 2-copy)

**Files:**
- Modify: `utils/deckcheck/rules.ts`
- Modify: `utils/deckcheck/__tests__/rules-t2.test.ts` (rewrite quantity sections)

**Interfaces:**
- Consumes: `isSpecialExceptionCard` (exported in Task 2), `FormatDef` param convention from Task 2.
- Produces:
  - `checkT2CopyLimit(cardGroups: CardGroup[]): DeckCheckIssue[]` — rule id `t2-copy-limit`.
  - `checkLostSoulAbilityLimit(main, reserve, groups, maxCopies = 1, rule = "t1-quantity-ls-ability")` — gains two defaulted params; T2 calls with `(…, 1, "t2-ls-ability")`.
  - `validateT2Rules(def: FormatDef, main, reserve, cardGroups)` — new composition below.
  - KEPT as thin functions with updated constants: `checkT2DeckSize` (100–140, rule id `t2-deck-size`), `checkT2ReserveSize` (max 20, rule id `t2-reserve-size`).
  - DELETED: `checkT2QuantityLimits`, `getT2CardCopyLimit`.

- [ ] **Step 1: Write failing tests** (rules-t2.test.ts; use its fixture builders; keep balance/LS-count fixtures legal so only the rule under test fires):

```ts
describe('t2-copy-limit (flat 2)', () => {
  it('rejects 3 copies of any ordinary card', () => { /* 3x single-brigade Hero → expect t2-copy-limit */ });
  it('allows 2 copies of a 3-brigade card (old tier capped at 1)', () => { /* 2x 3-brigade card → no t2-copy-limit */ });
  it('skips dominants (own rule)', () => { /* 2x same Dominant → t1-dominant-unique fires, t2-copy-limit does not */ });
  it('skips special exception cards', () => { /* 8x Locust from the Pit (RoJ) at 100 cards → no t2-copy-limit, no t1-special-card (limit 10) */ });
});
describe('t2-ls-ability (max 1)', () => {
  it('rejects 2 copies of an ability soul', () => { /* expect rule 't2-ls-ability' */ });
  it('allows multiple no-ability souls', () => { /* 4x generic LS → no copy issues */ });
});
describe('t2 sizes', () => {
  it('rejects 141+ main', () => { /* expect t2-deck-size */ });
  it('rejects 21 reserve', () => { /* expect t2-reserve-size */ });
  it('accepts reserve of 20', () => { /* no t2-reserve-size */ });
});
```

Also DELETE the describe blocks for all eight retired tier rules (`t2-quantity-3plus-brigade`, `t2-quantity-2-brigade`, `t2-quantity-sa-site-city`, `t2-quantity-2-brigade-site`, `t2-quantity-artifact-fortress`, `t2-quantity-character-enhancement`, `t2-quantity-vanilla-site`, `t2-quantity-same-card-combined`).

- [ ] **Step 2:** `npx vitest run utils/deckcheck/__tests__/rules-t2.test.ts` → FAIL.
- [ ] **Step 3: Implement** in `rules.ts`:

```ts
/**
 * Rule: t2-copy-limit — flat max 2 copies per card (same-card groups).
 * Skips Dominants (checkDominantUnique), ALL Lost Souls (t2-ls-ability /
 * exempt generics), and special exception cards (checkSpecialCards) — each
 * governed by its own rule. NOTE (spec §4): the exception carve-out is a
 * deliberate fix — the old tiers only excluded exceptions from the
 * 3+-brigade tier, capping Locust at 4 and Faithful Witness at 2 in
 * contradiction of checkSpecialCards. Do not copy the old tier exclusions.
 */
export function checkT2CopyLimit(cardGroups: CardGroup[]): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  for (const group of cardGroups) {
    const capped = group.cards.filter(
      (c) => !isDominant(c) && !isLostSoul(c) && !isSpecialExceptionCard(c)
    );
    if (capped.length === 0) continue;
    const totalQty = capped.reduce((sum, c) => sum + c.quantity, 0);
    if (totalQty > 2) {
      issues.push({
        type: "error",
        rule: "t2-copy-limit",
        message: `"${group.canonicalName}" — max 2 copies per card in T2, found ${totalQty}.`,
        cards: [...new Set(capped.map((c) => c.name))],
      });
    }
  }
  return issues;
}
```

Generalize `checkLostSoulAbilityLimit(main, reserve, _groups, maxCopies = 1, rule = "t1-quantity-ls-ability")` — the group-total comparison becomes `> maxCopies` and the issue uses `rule` + `max ${maxCopies}` in the message. T1/Paragon call sites unchanged (defaults preserve behavior).

New `validateT2Rules(def, mainDeckCards, reserveCards, cardGroups)` composition — exactly:

```ts
checkT2DeckSize(mainDeckCards)                                     // 100-140
checkT2LostSoulCount(mainDeckCards)                                // unchanged chart
checkT2ReserveSize(reserveCards)                                   // max 20
checkT2CopyLimit(cardGroups)                                       // NEW
checkLostSoulAbilityLimit(mainDeckCards, reserveCards, cardGroups, 1, "t2-ls-ability")  // NEW max 1
checkGoodEvilBalance(mainDeckCards, reserveCards)                  // unchanged
checkReserveContents(reserveCards)
checkDominantLimit(mainDeckCards, reserveCards)
checkDominantUnique(mainDeckCards, reserveCards, cardGroups)
checkMutualExclusion(mainDeckCards, reserveCards)
checkSitesCitiesLimit(mainDeckCards, reserveCards)                 // provisional, kept (spec §10)
checkSpecialCards(mainDeckCards, reserveCards, cardGroups)         // exceptions keep allowances
checkPoolLegality(def, mainDeckCards, reserveCards)                // NEW
checkCharacterAliasLimit(mainDeckCards, reserveCards, cardGroups)
```

Delete `checkT2QuantityLimits` and `getT2CardCopyLimit` entirely.

- [ ] **Step 4: Verify:** `npx vitest run utils/deckcheck` → PASS; `npx tsc --noEmit`.
- [ ] **Step 5: Commit:** `git commit -m "feat(deckcheck): new T2 rules — 100-140, reserve 20, flat 2-copy, ability souls max 1"` (add only the two files).

---

### Task 4: Client fallback validator + legality checklist component

**Files:**
- Modify: `app/decklist/card-search/utils/deckValidation.ts`
- Modify: `app/decklist/card-search/components/DeckLegalityChecklist.tsx`
- Test: `npx vitest run app/decklist/card-search/utils/__tests__/deckValidation.maybeboard.test.ts`

**Interfaces:**
- Consumes: `getFormatDef`, `normalizeFormat` from `lib/formats`.
- Produces: no new exports — behavior updates only.

- [ ] **Step 1:** In `deckValidation.ts`: replace `getMinimumDeckSize`/`getMaximumDeckSize`/`getMaximumReserveSize` bodies with `getFormatDef(format).main.min` / `.main.max` / `.reserveMax`. Replace every `format?.toLowerCase().includes("type 2")` / `includes("paragon")` with `normalizeFormat(deck.format) === 'T2'` / `=== 'Paragon'` (fixes canonical `'T2'` falling into the T1 branch). Change the Type 2 Lost-Soul copy cap from 2 to 1 (message: "maximum 1"). T1 branch unchanged.
- [ ] **Step 2:** In `DeckLegalityChecklist.tsx` (~lines 54–101, and the `includes('type 2')` at ~155): remove the eight deleted `t2-quantity-*` rule ids from the category lists; add `pool-legality` (category: format/pool), `t2-copy-limit` and `t2-ls-ability` (category: quantity); remove `t1-banned-card`; switch the format branch to `normalizeFormat`.
- [ ] **Step 2b (spec §5 blast radius):** when the checklist is rendering one or more `pool-legality` errors AND `normalizeFormat(deck.format) === 'Limited'`, show a one-line hint under that section: `These cards are outside the Limited pool — switch this deck to Unlimited to keep them.` with a small button that calls the existing `onDeckFormatChange?.('Unlimited')` pathway (thread the callback down from `DeckBuilderPanel` if the checklist doesn't already receive it).
- [ ] **Step 3: Verify:** the maybeboard test passes; `npx tsc --noEmit`.
- [ ] **Step 4: Commit:** `git commit -m "feat(decklist): fallback validator + legality checklist on the format registry"`

---

### Task 5: Deck builder — four-way format toggle

**Files:**
- Modify: `app/decklist/card-search/components/DeckBuilderPanel.tsx` (state ~567–587, handler ~617–624, toggle UI ~1044 and ~1449, T2-only branches at ~1263, 1274, 1793, 1804, 2054, 3268)
- Modify: `app/decklist/card-search/client.tsx` (`handleDeckFormatChange` ~1395)
- Modify: `app/decklist/card-search/hooks/useDeckCheck.ts` (only if it branches on format strings — check; it likely just passes `deck.format` through, which now round-trips canonically)

**Interfaces:**
- Consumes: `FormatId`, `FORMAT_IDS`, `FORMATS`, `normalizeFormat` from `lib/formats`.
- Produces: `deck.format` is written as canonical `'Limited' | 'Unlimited' | 'T2' | 'Paragon'` from now on; `onDeckFormatChange` receives those exact strings.

- [ ] **Step 1:** Replace the `deckType` state type `'T1' | 'T2' | 'Paragon'` with `FormatId`; initializer and the sync `useEffect` become `normalizeFormat(deck.format)`. `handleDeckTypeChange(newType: FormatId)` now calls `onDeckFormatChange?.(newType)` directly (canonical id IS the stored value — delete the Type 1/Type 2 translation).
- [ ] **Step 2:** Toggle UI (both mobile ~1044 and desktop ~1449 blocks): render four buttons from `FORMAT_IDS.map(id => FORMATS[id])` showing `def.badge` (L / U / T2 / P) with `title={def.label}`; active state compares `deckType === def.id`. Follow the existing button styling exactly.
- [ ] **Step 3:** Convert the six T2-only conditionals (`deckType === 'T2'` already canonical — verify each still compares against `'T2'` and that none compare against removed `'T1'`; T1-family checks become `FORMATS[deckType].family === 'T1'`).
- [ ] **Step 4:** `client.tsx` `handleDeckFormatChange`: switch on `normalizeFormat(format)` — `'Paragon'` → `setLegalityMode('Paragon')`; `'Unlimited'` → `'Classic'` mode; else → `'Rotation'` mode. (Mode identifiers rename in Task 6 — this task keeps the current mode strings so the app stays green; Task 6 flips them.)
- [ ] **Step 5: Verify:** `npx tsc --noEmit`; `npx vitest run app/decklist`; manual smoke via dev server is deferred to Task 11.
- [ ] **Step 6: Commit:** `git commit -m "feat(deckbuilder): four-way L/U/T2/P format toggle writing canonical ids"`

---

### Task 6: Pool filter modes + Paragon-list centralization

**Files:**
- Modify: `app/decklist/card-search/components/FilterGrid.tsx` (mode union + list ~8–9, ~192)
- Modify: `app/decklist/card-search/client.tsx` (filter body ~1013–1063, default state, pill ~2048, Task 5's `handleDeckFormatChange` mode strings)
- Modify: `app/decklist/card-search/components/DuplicateCards.tsx` (`passesLegalityFilter`)
- Modify: `app/collection/client.tsx` (its own FormatMode UI ~26–48 + its copy of the excluded-sets list)

**Interfaces:**
- Consumes: `PARAGON_EXCLUDED_SETS` from `lib/formats`.
- Produces: legality mode union is `'Limited' | 'Unlimited' | 'Banned' | 'Scrolls' | 'Paragon'` everywhere (`'Limited'` is the default, replacing `'Rotation'`).

- [ ] **Step 1:** New filter semantics in every copy (explicit mapping — the old `c.legality === legalityMode` shortcut dies because mode names no longer equal data values):

```ts
if (legalityMode === 'Unlimited') return true;                       // was 'Classic'
if (legalityMode === 'Limited') return c.legality === 'Rotation';    // was fallthrough
if (legalityMode === 'Banned') return c.legality === 'Banned';
if (legalityMode === 'Scrolls') return c.legality !== 'Rotation' && c.legality !== 'Banned';
if (legalityMode === 'Paragon') { /* unchanged Lost-Soul exclusion */ return !PARAGON_EXCLUDED_SETS.has(c.officialSet); }
```

Delete all three inline excluded-sets arrays; import from `lib/formats`.
- [ ] **Step 2:** Update the mode union type, the button list (`['Limited','Unlimited','Banned','Scrolls','Paragon']`), the default `useState('Limited')`, the pill reset (`setLegalityMode('Limited')`), and Task 5's auto-select strings (`'Unlimited'` / `'Limited'`). Grep the two client files for any remaining `'Rotation'` / `'Classic'` **mode** literals (data comparisons `c.legality === 'Rotation'` stay).
- [ ] **Step 3: Verify:** `npx tsc --noEmit` (the union type change surfaces every missed site as a type error — that is the point); `npx vitest run app`.
- [ ] **Step 4: Commit:** `git commit -m "feat(search): pool modes renamed Limited/Unlimited, paragon set list centralized"`

---

### Task 7: Exact-match consumers, APIs, exports

**Files:**
- Modify: `app/threshingfloor/api/data/route.ts` (~31–32) — and its test `app/threshingfloor/api/__tests__/data-route.test.ts`
- Modify: `lib/api/cache.ts` (~172–176 and ~206–209)
- Modify: `app/decklist/actions.ts` (community filter ~1375–1381)
- Modify: `app/decklist/community/client.tsx` (`<option>` values ~389–391, `?format=` param handling)
- Modify: `app/decklist/card-search/components/GeneratePDFModal.tsx` (~21–25) and `GenerateDeckImageModal.tsx` (~20–24)
- Modify: `app/api/deckcheck/route.ts` (~125)
- Modify: `app/forge/lib/forgeDecks.ts` (~151), `app/play/utils/convertToGoldfishDeck.ts` (format branch, if any), `app/tracker/tournaments/page.tsx` (`deckFormatLabel`/`typePillClasses` ~217–243)

**Interfaces:**
- Consumes: `normalizeFormat`, `getFormatDef`, `FORMATS` from `lib/formats`.
- Produces: v1 API accepts both legacy and canonical `format` params; sister-API `deck_type` mapping is `family === 'T1' → 'type_1'`, `'T2' → 'type_2'`, `'Paragon' → 'paragon'`.

- [ ] **Step 1 (threshingfloor):** replace the exact-match line with:

```ts
const norm = normalizeFormat(deck.format);           // null → 'Limited'
const format = norm === 'T2' ? 'T2' : norm === 'Paragon' ? '' : 'T1'; // preserve legacy output contract
```

Update its test with cases: `'Limited'→'T1'`, `'T2'→'T2'`, `null→'T1'`, `'Type 2'→'T2'`.
- [ ] **Step 2 (v1 API + community filter):** both query sites use dual-vocabulary `.in()` lists so they work before AND after the backfill:

```ts
const norm = normalizeFormat(params.format);
if (norm === 'Limited')  q = q.or("format.is.null,format.in.(\"Type 1\",\"Limited\")");
else if (norm === 'T2')  q = q.in("format", ["Type 2", "T2"]);
else if (norm === 'Unlimited') q = q.in("format", ["Unlimited", "Classic"]);
else q = q.eq("format", "Paragon");
```

(Adapt to each site's query-builder idiom; `app/decklist/actions.ts` mirrors the same four branches.) Community `<option>` values become `Limited/Unlimited/T2/Paragon`; incoming `?format=` runs through `normalizeFormat` so old bookmarked URLs (`?format=Type+2`) keep working.
- [ ] **Step 3 (PDF/image modals):** `deck_type` from the registry: `const fam = getFormatDef(deck.format).family; const deckType = fam === 'T2' ? 'type_2' : fam === 'Paragon' ? 'paragon' : 'type_1';`
- [ ] **Step 4 (deckcheck API):** `const fmt = decklist_type === 'type_2' ? 'T2' : decklist_type === 'type_1' ? 'Limited' : (decklist_type || format || 'Limited');` then `checkDeck(main, reserve, fmt)` — `normalizeFormat` inside `checkDeck` accepts `limited`/`unlimited`/`t2`/`paragon` verbatim.
- [ ] **Step 5 (stragglers):** forgeDecks.ts, convertToGoldfishDeck.ts, tracker page label/pill maps — route each through `normalizeFormat`; label map gains `Limited`/`Unlimited` entries (pill styling: reuse the current T1 style for both, distinct text).
- [ ] **Step 6: Verify:** `npx vitest run app/threshingfloor lib` → PASS; `npx tsc --noEmit`.
- [ ] **Step 7: Commit:** `git commit -m "feat(formats): convert exact-match consumers — APIs, exports, tracker labels"`

---

### Task 8: Tournament categories + attachment gating

**Files:**
- Modify: `utils/tournament/categoryDefaults.ts`
- Modify: `components/ui/AttachDeckDialog.tsx` (badge fn ~23–33; add gate)
- Modify: `components/ui/PublishDecklistsSection.tsx` (`<option>` list ~130–134)
- Test: create `utils/tournament/__tests__/categoryDefaults.test.ts`

**Interfaces:**
- Consumes: `FormatId`, `normalizeFormat`, `normalizeTournamentFormat`, `FORMATS` from `lib/formats`.
- Produces: `CategoryDefaults.deck_format: FormatId | 'Other'`; `STANDARD_CATEGORIES` = `["Type 1 Limited", "Type 1 Unlimited", "Type 2", "Booster Draft", "Sealed Deck", "Teams", "Type A", "Paragon"]`.

- [ ] **Step 1: Failing test:**

```ts
import { categoryDefaults, STANDARD_CATEGORIES } from '../categoryDefaults';
it.each([
  ['Type 1 Limited', 'Limited'], ['Type 1 Unlimited', 'Unlimited'],
  ['Type 2', 'T2'], ['Teams', 'Limited'], ['Paragon', 'Paragon'],
  ['Booster Draft (GoC x3)', 'Other'], ['Type A 2-Player', 'Limited'],
])('%s → %s', (cat, fmt) => expect(categoryDefaults(cat).deck_format).toBe(fmt));
it('lists both T1 categories', () =>
  expect(STANDARD_CATEGORIES).toContain('Type 1 Unlimited'));
```

- [ ] **Step 2:** Run → FAIL. Implement: mapping order **paragon → teams → type 2 → draft/sealed → unlimited → default Limited** (teams before type 2 exactly as today; unlimited before the default). `deck_format` values become canonical ids; `max_score`/`round_length` defaults unchanged (Unlimited copies Limited's: 5 souls / 45 min).
- [ ] **Step 3 (attach gate):** In `AttachDeckDialog`, compute `const tf = normalizeTournamentFormat(tournament.deck_format)`. If `tf === null || tf === 'Other'` → no gate (today's behavior, spec §6: 250 of 271 prod tournaments are null). Otherwise a deck is attachable when `normalizeFormat(deck.format) === tf` **or** (`tf === 'Unlimited'` and `normalizeFormat(deck.format) === 'Limited'`). Non-attachable decks: keep visible but disabled with the reason ("This event is T2 — this deck is Limited"). Replace the local `formatDeckType` badge logic with `FORMATS[normalizeFormat(deck.format)].badge`.
- [ ] **Step 4:** `PublishDecklistsSection` options become `Limited / Unlimited / T2 / Paragon / Other` (values = those exact strings).
- [ ] **Step 5: Verify:** `npx vitest run utils/tournament` → PASS; `npx tsc --noEmit`.
- [ ] **Step 6: Commit:** `git commit -m "feat(tournaments): L/U categories, canonical deck_format, attach gate with null/Other escape"`

---

### Task 9: Backfill migration + legality recompute (LAST — do not apply until deploy)

**Files:**
- Create: `supabase/migrations/<next-number>_backfill_deck_format_canonical.sql` (run `ls /Users/timestes/projects/rtt-format-impl/supabase/migrations | sort | tail -3` and use max+1)
- Read first: `scripts/backfill-deck-legality.ts` header for its invocation flags.

**Interfaces:** consumes nothing from code; produces the deploy-time runbook.

- [ ] **Step 1: Write the migration:**

```sql
-- Canonicalize decks.format (spec §7). MUST deploy AFTER all code conversion
-- (canonical 'T2' does not match legacy .includes('type 2') checks).
-- NULL rows are intentionally left NULL: read-time normalizeFormat buckets
-- them as Limited; they may predate format selection entirely.
update decks set format = 'Limited'   where format in ('Type 1', 'T1');
update decks set format = 'T2'        where format = 'Type 2';
update decks set format = 'Unlimited' where format = 'Classic';
update decks set format = 'Paragon'   where format ilike '%paragon%' and format <> 'Paragon';
```

- [ ] **Step 2:** Append a **Deploy runbook** comment at the top of the migration: 1) merge + Vercel deploy of Tasks 1–8; 2) apply this migration via Supabase MCP; 3) run `scripts/backfill-deck-legality.ts` with its all-decks flag (verify exact flag from the script header) to refresh stored `is_legal`/`deckcheck_issues` (they contain retired rule ids).
- [ ] **Step 3: Commit:** `git commit -m "feat(db): canonical deck format backfill migration (apply post-deploy)"`

---

### Task 10: Sister repo — T2 reserve 20 (independent; parallel-safe)

**Files (repo `/Users/timestes/projects/redemption-tournament-api`, own worktree `/Users/timestes/projects/rta-t2-reserve` off its `origin/main`):**
- Modify: `src/utilities/decklist.py` (~57: `reserve_size > 15` → `> 20`, message "20 or less")
- Inspect: `src/utilities/text_to_pdf.py` (`T2_SECTION_LIMITS`, reserve section ~400–430) and `src/utilities/text_to_webp.py` — confirm a 20-card reserve renders without overflow; adjust the section limit constant if it hardcodes 15.
- Test: repo has `tests/` — run its suite (`make test` or `pytest`, check the makefile) and add/extend a reserve-size case at 20 (pass) and 21 (fail).

- [ ] **Step 1:** Create the worktree; read `decklist.py` and both renderers' reserve handling.
- [ ] **Step 2:** Failing test for reserve=20 accepted / 21 rejected → implement → pass.
- [ ] **Step 3:** Commit, push, open PR titled `feat(decklist): raise Type 2 reserve cap to 20`. Note in the PR body: pairs with tracker format restructure; `deck_type` API values unchanged.

---

### Task 11: Full-sweep verification + PR

**Files:** none new — verification and stragglers only, in `/Users/timestes/projects/rtt-format-impl`.

- [ ] **Step 1: Grep checklist** (each hit must be either converted, in `lib/deck-format.ts`/`spacetimedb` (untouched by design), a data comparison (`c.legality === 'Rotation'`, forge `'Classic'` frames), or in tests/docs):

```bash
grep -rn "includes('type 2')\|includes(\"type 2\")" app components lib utils --include='*.ts*'
grep -rn "=== 'Type 1'\|=== \"Type 1\"\|=== 'Type 2'\|=== \"Type 2\"" app components lib utils --include='*.ts*'
grep -rn "'Rotation'\|'Classic'" app components --include='*.tsx' | grep -v legality
```

- [ ] **Step 2:** `npx tsc --noEmit` clean; `npx vitest run` full suite green.
- [ ] **Step 3:** Fix stragglers found in Step 1 (route through `normalizeFormat`), commit each with a scoped message.
- [ ] **Step 4:** Push `feat/format-restructure`; open PR to `main` titled `feat(formats): Limited/Unlimited/T2/Paragon restructure` with the spec link and the §7 deploy-ordering warning in the body.
