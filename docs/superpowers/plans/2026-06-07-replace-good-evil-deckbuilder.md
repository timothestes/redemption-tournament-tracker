# Replace Good / Replace Evil (T2 Deck Builder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Replace Good" / "Replace Evil" menu actions to the T2 deck builder that swap the current deck's good (or evil) half for the corresponding half of another saved deck, in memory.

**Architecture:** A pure, unit-tested helper (`buildReplacedHalf`) computes the new card list from the current deck, a source deck, and a target alignment. A new `replaceHalf` method on the `useDeckState` hook loads the chosen source deck, reconstructs its cards (reusing extracted `dbCardToDeckCard`), runs the helper, and applies the result via `setDeck`. The existing `LoadDeckModal` is reused as the source-deck picker (gaining optional title/subtitle props). Two T2-gated buttons in `DeckBuilderPanel`'s "More options" dropdown open the picker; `client.tsx` wires the picker selection to `replaceHalf` and shows a result toast.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, Vitest for the pure helper.

---

## File Structure

- **Create** `app/decklist/card-search/utils/replaceHalf.ts` — pure helper `buildReplacedHalf`.
- **Create** `app/decklist/card-search/utils/__tests__/replaceHalf.test.ts` — unit tests.
- **Modify** `app/decklist/card-search/hooks/useDeckState.ts` — extract `dbCardToDeckCard`, add `replaceHalf` method, expose it.
- **Modify** `app/decklist/card-search/components/LoadDeckModal.tsx` — optional `title` / `subtitle` props.
- **Modify** `app/decklist/card-search/components/DeckBuilderPanel.tsx` — props, state, two buttons, two modal instances.
- **Modify** `app/decklist/card-search/client.tsx` — destructure `replaceHalf`, add handler, pass props to both `DeckBuilderPanel` render sites.

---

## Task 1: Pure helper `buildReplacedHalf` + tests

**Files:**
- Create: `app/decklist/card-search/utils/replaceHalf.ts`
- Test: `app/decklist/card-search/utils/__tests__/replaceHalf.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/decklist/card-search/utils/__tests__/replaceHalf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildReplacedHalf } from "../replaceHalf";
import type { DeckCard, DeckZone } from "../../types/deck";
import type { Card } from "../../utils";

// Minimal DeckCard fixture — buildReplacedHalf only reads card.alignment, quantity, zone.
function dc(
  alignment: string,
  quantity: number,
  name: string,
  zone: DeckZone = "main"
): DeckCard {
  return { card: { name, alignment } as Card, quantity, zone };
}

describe("buildReplacedHalf", () => {
  it("removes strictly-good cards and adds the source's strictly-good cards", () => {
    const current = [dc("Good", 2, "G1"), dc("Evil", 3, "E1"), dc("Neutral", 1, "N1")];
    const source = [dc("Good", 4, "G2"), dc("Evil", 9, "E2")];

    const result = buildReplacedHalf(current, source, "good");

    expect(result.removed).toBe(2); // the 2x G1 removed
    expect(result.added).toBe(4); // the 4x G2 added
    // Evil and Neutral from current are untouched; source evil is ignored.
    const names = result.cards.map((c) => c.card.name).sort();
    expect(names).toEqual(["E1", "G2", "N1"]);
  });

  it("does not treat dual 'Good/Evil' cards as part of the good half", () => {
    const current = [dc("Good/Evil", 2, "D1"), dc("Good", 1, "G1")];
    const source = [dc("Good/Evil", 5, "D2"), dc("Good", 1, "G2")];

    const result = buildReplacedHalf(current, source, "good");

    expect(result.removed).toBe(1); // only G1
    expect(result.added).toBe(1); // only G2 (D2 ignored)
    const names = result.cards.map((c) => c.card.name).sort();
    expect(names).toEqual(["D1", "G2"]); // current dual D1 stays
  });

  it("preserves zone and quantity of added cards", () => {
    const current = [dc("Evil", 1, "E1", "main")];
    const source = [dc("Good", 7, "G1", "reserve"), dc("Good", 2, "G2", "maybeboard")];

    const result = buildReplacedHalf(current, source, "good");

    const g1 = result.cards.find((c) => c.card.name === "G1")!;
    const g2 = result.cards.find((c) => c.card.name === "G2")!;
    expect(g1.zone).toBe("reserve");
    expect(g1.quantity).toBe(7);
    expect(g2.zone).toBe("maybeboard");
  });

  it("works symmetrically for evil", () => {
    const current = [dc("Good", 2, "G1"), dc("Evil", 3, "E1")];
    const source = [dc("Evil", 5, "E2")];

    const result = buildReplacedHalf(current, source, "evil");

    expect(result.removed).toBe(3);
    expect(result.added).toBe(5);
    const names = result.cards.map((c) => c.card.name).sort();
    expect(names).toEqual(["E2", "G1"]);
  });

  it("reports added=0 when the source has no matching-alignment cards", () => {
    const current = [dc("Good", 2, "G1"), dc("Evil", 1, "E1")];
    const source = [dc("Evil", 5, "E2")];

    const result = buildReplacedHalf(current, source, "good");

    expect(result.added).toBe(0);
    expect(result.removed).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/decklist/card-search/utils/__tests__/replaceHalf.test.ts`
Expected: FAIL — cannot find module `../replaceHalf`.

- [ ] **Step 3: Write the minimal implementation**

Create `app/decklist/card-search/utils/replaceHalf.ts`:

```ts
import type { DeckCard } from "../types/deck";

export type ReplaceAlignment = "good" | "evil";

export interface ReplaceHalfResult {
  /** New card list: current cards minus the replaced half, plus the source's matching half. */
  cards: DeckCard[];
  /** Total quantity of strictly-aligned cards removed from the current deck. */
  removed: number;
  /** Total quantity of strictly-aligned cards added from the source deck. */
  added: number;
}

/** True only for strictly "Good" or strictly "Evil" (dual "Good/Evil" and neutral excluded). */
function isStrictlyAligned(card: DeckCard["card"], alignment: ReplaceAlignment): boolean {
  return (card.alignment ?? "").toLowerCase() === alignment;
}

/**
 * Replace the current deck's good (or evil) half with the source deck's good (or evil) half.
 * Cards that are neutral, dual-aligned, or of the opposite alignment are left untouched.
 * Zones and quantities of the added cards are preserved as-is.
 */
export function buildReplacedHalf(
  currentCards: DeckCard[],
  sourceCards: DeckCard[],
  alignment: ReplaceAlignment
): ReplaceHalfResult {
  const removed = currentCards
    .filter((dc) => isStrictlyAligned(dc.card, alignment))
    .reduce((sum, dc) => sum + dc.quantity, 0);

  const kept = currentCards.filter((dc) => !isStrictlyAligned(dc.card, alignment));

  const toAdd = sourceCards.filter((dc) => isStrictlyAligned(dc.card, alignment));
  const added = toAdd.reduce((sum, dc) => sum + dc.quantity, 0);

  return { cards: [...kept, ...toAdd], removed, added };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/decklist/card-search/utils/__tests__/replaceHalf.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/decklist/card-search/utils/replaceHalf.ts app/decklist/card-search/utils/__tests__/replaceHalf.test.ts
git commit -m "feat: add buildReplacedHalf helper for T2 good/evil replacement"
```

---

## Task 2: Extract `dbCardToDeckCard` and add `replaceHalf` to `useDeckState`

**Files:**
- Modify: `app/decklist/card-search/hooks/useDeckState.ts`

`DeckCard`, `sanitizeImgFile`, `CARD_BY_FULL_KEY`, and `loadDeckByIdAction` are already imported in this file. The DB→`DeckCard` mapping currently lives inline inside `loadDeckFromCloud` (the `.map` at ~lines 164-204). We extract it to a module function so `replaceHalf` can reuse it.

- [ ] **Step 1: Add the module-level `dbCardToDeckCard` function**

Add this function near the bottom of the file, next to the existing `loadDeckFromStorage` helper (module scope, NOT inside the hook):

```ts
/**
 * Reconstruct a full in-memory DeckCard from a database card row, using the card
 * catalog lookup so alignment and other fields are populated. Falls back to a
 * minimal card object if the card is not found in the catalog.
 */
function dbCardToDeckCard(dbCard: any): DeckCard {
  const key = `${dbCard.card_name}|${dbCard.card_set}|${sanitizeImgFile(dbCard.card_img_file)}`;
  const fullCard = CARD_BY_FULL_KEY.get(key);

  if (fullCard) {
    return {
      card: fullCard,
      quantity: dbCard.quantity,
      zone: dbCard.zone as DeckZone,
    };
  }

  console.warn(`Card not found in database: ${dbCard.card_name} (${dbCard.card_set})`);
  return {
    card: {
      dataLine: "",
      name: dbCard.card_name,
      set: dbCard.card_set,
      imgFile: sanitizeImgFile(dbCard.card_img_file),
      officialSet: "",
      type: "Unknown",
      brigade: "",
      strength: "",
      toughness: "",
      class: "",
      identifier: "",
      specialAbility: "",
      rarity: "",
      reference: "",
      alignment: "",
      legality: "",
      testament: "",
      isGospel: false,
    } as Card,
    quantity: dbCard.quantity,
    zone: dbCard.zone as DeckZone,
  };
}
```

- [ ] **Step 2: Refactor `loadDeckFromCloud` to use the extracted function**

In `loadDeckFromCloud`, replace the inline `cards:` mapping (the `cloudDeck.cards.map((dbCard: any) => { ... })` block, ~lines 164-204) with:

```ts
          cards: cloudDeck.cards.map(dbCardToDeckCard),
```

Leave the rest of `loadDeckFromCloud` (id/name/visibility handling, snapshot baseline, `setDeck`, sync status) unchanged.

- [ ] **Step 3: Add the `import` for the pure helper**

Near the top of the file, add:

```ts
import { buildReplacedHalf, type ReplaceAlignment } from "../utils/replaceHalf";
```

- [ ] **Step 4: Add the `replaceHalf` method inside the hook**

Add this `useCallback` inside the hook body, after `loadDeckFromCloud` is defined and before the `return` object:

```ts
  /**
   * Replace the current deck's good (or evil) half with the matching half of another
   * saved deck (in memory only — the user saves manually). Returns counts for a toast,
   * or an error string. Makes no change when the source has no matching-alignment cards.
   */
  const replaceHalf = useCallback(
    async (
      alignment: ReplaceAlignment,
      sourceDeckId: string
    ): Promise<{
      success: boolean;
      removed?: number;
      added?: number;
      sourceName?: string;
      error?: string;
    }> => {
      try {
        const result = await loadDeckByIdAction(sourceDeckId);
        if (!result.success || !result.deck) {
          return { success: false, error: result.error || "Failed to load source deck" };
        }

        const sourceName = result.deck.name;
        const sourceCards = result.deck.cards.map(dbCardToDeckCard);
        const { cards, removed, added } = buildReplacedHalf(deck.cards, sourceCards, alignment);

        if (added === 0) {
          return {
            success: false,
            error: `"${sourceName}" has no ${alignment}-aligned cards.`,
          };
        }

        setDeck({ ...deck, cards, updatedAt: new Date() });
        return { success: true, removed, added, sourceName };
      } catch (error) {
        console.error("Error replacing deck half:", error);
        return { success: false, error: "Failed to replace deck half" };
      }
    },
    [deck]
  );
```

- [ ] **Step 5: Expose `replaceHalf` from the hook**

In the hook's `return { ... }` object (the one listing `loadDeck`, `loadDeckFromCloud`, `saveDeckToCloud`, ...), add `replaceHalf,` after `loadDeckFromCloud,`.

- [ ] **Step 6: Verify type-check / build passes**

Run: `npx tsc --noEmit`
Expected: no new errors in `useDeckState.ts` or `replaceHalf.ts`.

- [ ] **Step 7: Commit**

```bash
git add app/decklist/card-search/hooks/useDeckState.ts
git commit -m "feat: add replaceHalf method and extract dbCardToDeckCard in useDeckState"
```

---

## Task 3: Optional title/subtitle props on `LoadDeckModal`

**Files:**
- Modify: `app/decklist/card-search/components/LoadDeckModal.tsx`

- [ ] **Step 1: Add optional props to the interface**

Change the `LoadDeckModalProps` interface (currently lines 33-36) to:

```ts
interface LoadDeckModalProps {
  onLoadDeck: (deckId: string) => void;
  onClose: () => void;
  /** Heading text (defaults to "Load Deck"). */
  title?: string;
  /** Sub-heading text (defaults to "Select a deck to load into the builder"). */
  subtitle?: string;
}
```

- [ ] **Step 2: Use the props in the component signature and header**

Change the component signature (line 38) to destructure the new props with defaults:

```ts
export default function LoadDeckModal({
  onLoadDeck,
  onClose,
  title = "Load Deck",
  subtitle = "Select a deck to load into the builder",
}: LoadDeckModalProps) {
```

Then in the header JSX, replace the hard-coded heading/sub-heading (currently lines 101-106):

```tsx
                <h3 className="text-lg font-semibold text-foreground">
                  Load Deck
                </h3>
                <p className="text-sm text-muted-foreground">
                  Select a deck to load into the builder
                </p>
```

with:

```tsx
                <h3 className="text-lg font-semibold text-foreground">
                  {title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {subtitle}
                </p>
```

- [ ] **Step 3: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: no new errors. Existing `LoadDeckModal` usage (no title/subtitle) still compiles because the props are optional.

- [ ] **Step 4: Commit**

```bash
git add app/decklist/card-search/components/LoadDeckModal.tsx
git commit -m "feat: add optional title/subtitle props to LoadDeckModal"
```

---

## Task 4: Buttons + modals in `DeckBuilderPanel`

**Files:**
- Modify: `app/decklist/card-search/components/DeckBuilderPanel.tsx`

- [ ] **Step 1: Add the two callback props to `DeckBuilderPanelProps`**

In the `DeckBuilderPanelProps` interface, right after the `onLoadDeck` prop (line 144), add:

```ts
  /** Replace the current deck's good half with another deck's good half (T2 only). */
  onReplaceGood?: (sourceDeckId: string) => void;
  /** Replace the current deck's evil half with another deck's evil half (T2 only). */
  onReplaceEvil?: (sourceDeckId: string) => void;
```

- [ ] **Step 2: Destructure the new props**

In the component's destructured props list (the `export default function DeckBuilderPanel({ ... })` block starting at line 178), add `onReplaceGood,` and `onReplaceEvil,` near `onLoadDeck,`.

- [ ] **Step 3: Add modal-visibility state**

Next to the existing `const [showLoadDeckModal, setShowLoadDeckModal] = useState(false);` (line 222), add:

```ts
  const [showReplaceGoodModal, setShowReplaceGoodModal] = useState(false);
  const [showReplaceEvilModal, setShowReplaceEvilModal] = useState(false);
```

- [ ] **Step 4: Add the two T2-gated buttons in the "More options" dropdown**

Immediately after the "Load Deck" button block (which ends at line 1229, `)}` closing the `{onLoadDeck && isAuthenticated && ( ... )}`), insert:

```tsx
                  {onReplaceGood && isAuthenticated && deck.format?.toLowerCase().includes("type 2") && (
                    <button
                      onClick={() => { setShowReplaceGoodModal(true); setShowMenu(false); }}
                      className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                    >
                      <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Replace Good…
                    </button>
                  )}
                  {onReplaceEvil && isAuthenticated && deck.format?.toLowerCase().includes("type 2") && (
                    <button
                      onClick={() => { setShowReplaceEvilModal(true); setShowMenu(false); }}
                      className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                    >
                      <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Replace Evil…
                    </button>
                  )}
```

- [ ] **Step 5: Render the two source-deck picker modals**

Immediately after the existing `LoadDeckModal` render block (lines 3423-3428, the `{showLoadDeckModal && onLoadDeck && ( ... )}` block), insert:

```tsx
      {showReplaceGoodModal && onReplaceGood && (
        <LoadDeckModal
          title="Replace Good"
          subtitle="Choose a deck to copy its good cards from"
          onLoadDeck={(sourceDeckId) => onReplaceGood(sourceDeckId)}
          onClose={() => setShowReplaceGoodModal(false)}
        />
      )}

      {showReplaceEvilModal && onReplaceEvil && (
        <LoadDeckModal
          title="Replace Evil"
          subtitle="Choose a deck to copy its evil cards from"
          onLoadDeck={(sourceDeckId) => onReplaceEvil(sourceDeckId)}
          onClose={() => setShowReplaceEvilModal(false)}
        />
      )}
```

(`LoadDeckModal` calls `onLoadDeck(deckId)` then `onClose()` internally, so the modal closes itself on selection.)

- [ ] **Step 6: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add app/decklist/card-search/components/DeckBuilderPanel.tsx
git commit -m "feat: add Replace Good/Evil buttons and source-deck pickers to deck builder"
```

---

## Task 5: Wire `replaceHalf` through `client.tsx`

**Files:**
- Modify: `app/decklist/card-search/client.tsx`

- [ ] **Step 1: Destructure `replaceHalf` from `useDeckState`**

In the `useDeckState(...)` destructure (lines 435-457), add `replaceHalf,` after `loadDeckFromCloud,`.

- [ ] **Step 2: Add a shared handler**

Add this handler in the component body (near other deck handlers such as `handleDeleteDeck`; `replaceHalf`, `setNotification` are in scope):

```ts
  const handleReplaceHalf = useCallback(
    async (alignment: "good" | "evil", sourceDeckId: string) => {
      const result = await replaceHalf(alignment, sourceDeckId);
      if (result.success) {
        setNotification({
          message: `Replaced ${alignment} half: removed ${result.removed}, added ${result.added} from "${result.sourceName}".`,
          type: "success",
        });
      } else {
        setNotification({
          message: result.error || "Failed to replace deck half",
          type: "error",
        });
      }
      setTimeout(() => setNotification(null), 3000);
    },
    [replaceHalf]
  );
```

(If `useCallback` is not already imported from React in this file, add it to the existing React import.)

- [ ] **Step 3: Pass the props to BOTH `DeckBuilderPanel` render sites**

At the first render site (line ~2607), add after `onLoadDeck={loadDeckFromCloud}`:

```tsx
            onReplaceGood={(sourceDeckId) => handleReplaceHalf("good", sourceDeckId)}
            onReplaceEvil={(sourceDeckId) => handleReplaceHalf("evil", sourceDeckId)}
```

At the second render site (line ~2704, the mobile drawer panel), add after its `onLoadDeck={loadDeckFromCloud}`:

```tsx
              onReplaceGood={(sourceDeckId) => handleReplaceHalf("good", sourceDeckId)}
              onReplaceEvil={(sourceDeckId) => handleReplaceHalf("evil", sourceDeckId)}
```

- [ ] **Step 4: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add app/decklist/card-search/client.tsx
git commit -m "feat: wire Replace Good/Evil handlers into deck builder"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run the full unit test suite**

Run: `npm test`
Expected: all tests pass, including the new `replaceHalf` tests.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: Manual smoke test**

Run `npm run dev`, sign in, open a **T2** deck in the card-search deck builder, and verify in the "More options" (⋯) menu:

1. **Replace Good…** and **Replace Evil…** appear (and do NOT appear on a T1 deck).
2. Clicking **Replace Good…** opens the deck picker titled "Replace Good". Choosing a source deck:
   - removes all strictly-Good cards from the current deck (all zones),
   - adds the source deck's strictly-Good cards (correct zones/quantities),
   - leaves the current deck's evil, neutral, and dual cards untouched,
   - shows a success toast with removed/added counts and the source name,
   - marks the deck as having unsaved changes (Save button enabled).
3. Picking a source deck with no good cards leaves the deck unchanged and shows the warning toast.
4. Reloading the deck from cloud (without saving) restores the original deck.

- [ ] **Step 4: Final commit (if any manual-fix tweaks were needed)**

```bash
git add -A
git commit -m "test: verify Replace Good/Evil end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** source = another saved deck (Task 1/2/4 picker), strictly Good/Evil all zones (Task 1 helper), T2-gated buttons (Task 4), any saved deck allowed as source (picker lists all decks), in-memory only (Task 2 `setDeck`, no save), no rebalancing (helper only swaps the targeted alignment), edge case of empty source (Task 2 guard + Task 6 smoke). All covered.
- **Type consistency:** `ReplaceAlignment` = `"good" | "evil"` used consistently across `replaceHalf.ts`, `useDeckState.replaceHalf`, and `client.handleReplaceHalf`. `buildReplacedHalf(current, source, alignment)` signature matches all call sites. `dbCardToDeckCard` returns `DeckCard` and is used by both `loadDeckFromCloud` and `replaceHalf`.
