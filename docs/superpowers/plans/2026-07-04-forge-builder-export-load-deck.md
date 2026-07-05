# Forge Builder Import/Export + Load Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Import, Copy to Clipboard, Download .txt (both variants), and Load Deck in the Forge deck builder.

**Architecture:** The Forge builder is the shared `CardSearchClient` parameterized by a `DeckBuilderConfig`. Import/export is enabled by flipping the existing `enableImportExport` flag (downstream already handles forge cards via the pool + `forge:<id>` imgFile stamp). Load Deck gets a new injectable `listDecks` seam on `DeckBuilderPersistence`, and a new `onDeckLoaded` config callback lets the Forge rewrite its `/forge/play/decks/<id>` URL via `history.replaceState` after an in-place load.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript (`strict: false` — union narrowing via `=== false`), vitest.

**Spec:** `docs/superpowers/specs/2026-07-04-forge-builder-export-load-deck-design.md`

## Global Constraints

- No `next/image` anywhere under `app/forge/**` (not touched by this plan, but do not add).
- tsconfig has `strict: false` — `if (x.ok)` union narrowing does NOT work; use `=== false` where needed.
- Surgical changes only: do not reformat or "improve" adjacent code.
- Replace Good/Evil modals keep using the public deck list (out of scope).
- Test runner: `npx vitest run <path>`.

---

### Task 1: Builder seams — `DeckListItem`, `listDecks`, `onDeckLoaded`, panel gate

**Files:**
- Modify: `app/decklist/card-search/builderConfig.tsx` (types at lines ~40-114; stale flag comment at lines 70-73)
- Modify: `app/decklist/card-search/components/LoadDeckModal.tsx`
- Modify: `app/decklist/card-search/components/DeckBuilderPanel.tsx:249-252` (gate) and `:3581-3587` (modal props)

**Interfaces:**
- Produces: `DeckListItem` type; `DeckBuilderPersistence.listDecks?: () => Promise<DeckListItem[]>`; `DeckBuilderConfig.onDeckLoaded?: (deckId: string) => void`; `LoadDeckModal` prop `listDecks?: () => Promise<DeckListItem[]>`.
- Consumed by: Task 2 (`config.onDeckLoaded`), Task 3 (forge `listDecks` impl), Task 4 (forge `onDeckLoaded` impl).

- [ ] **Step 1: Add `DeckListItem` + `listDecks` to `DeckBuilderPersistence` in `builderConfig.tsx`**

Insert above the `DeckBuilderPersistence` interface:

```ts
/** Minimal deck summary the Load Deck modal renders. `DeckData` (public) and
 *  the Forge's mapped `ForgeDeckSummary` both satisfy it. */
export type DeckListItem = {
  id: string;
  name: string;
  format?: string;
  card_count?: number;
  updated_at?: string;
};
```

Inside `DeckBuilderPersistence` (after `resolveCard`):

```ts
  /** List the caller's decks for the Load Deck modal. Omitted → the modal uses
   *  the public default (`loadUserDecksAction` over the `decks` table). With a
   *  custom persistence, Load Deck stays hidden unless this is provided (the
   *  Forge lists `forge_decks`). */
  listDecks?: () => Promise<DeckListItem[]>;
```

- [ ] **Step 2: Add `onDeckLoaded` to `DeckBuilderConfig` and refresh the stale flag comment**

Inside `DeckBuilderConfig` (after `features`):

```ts
  /** Called after the Load Deck modal successfully loads a deck in place. The
   *  Forge rewrites /forge/play/decks/<id> via history.replaceState (its deck
   *  id lives in the URL; the public builder's does not). */
  onDeckLoaded?: (deckId: string) => void;
```

Replace the `enableImportExport` doc comment (lines 70-73, which claims forge lists can't round-trip) with:

```ts
  /** Deck text import/export (menu items, Ctrl+I/E, empty-state import button).
   *  On for the Forge too: forge cards sit in the pool under their real names,
   *  so exported lists round-trip (import re-resolves them to `forge:<id>`
   *  pool entries). Exports do put forge card names in plain text — accepted. */
```

- [ ] **Step 3: `LoadDeckModal` — optional `listDecks` prop**

In `app/decklist/card-search/components/LoadDeckModal.tsx`:

Add to imports: `import type { DeckListItem } from "../builderConfig";`

Add to `LoadDeckModalProps`:

```ts
  /** Override the deck list source (defaults to the public `loadUserDecksAction`). */
  listDecks?: () => Promise<DeckListItem[]>;
```

Destructure `listDecks` in the component signature. Change the state line to:

```ts
  const [decks, setDecks] = useState<DeckListItem[]>([]);
```

Replace the body of `loadDecks()` inside the `useEffect` with:

```ts
      try {
        setLoading(true);
        if (listDecks) {
          const items = await listDecks();
          const sorted = [...items].sort((a, b) =>
            new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
          );
          setDecks(sorted);
        } else {
          const result = await loadUserDecksAction();
          if (result.success && result.decks) {
            const sorted = [...result.decks].sort((a, b) =>
              new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
            );
            setDecks(sorted as DeckListItem[]);
          } else {
            setError(result.error || "Failed to load decks");
          }
        }
      } catch (err) {
        setError("Failed to load decks");
        console.error(err);
      } finally {
        setLoading(false);
      }
```

Change the effect dep array from `[]` to `[listDecks]`.

(`DeckData.id`/`updated_at` are optional but `strict: false` makes the cast to `DeckListItem[]` safe; runtime rows always carry both.)

- [ ] **Step 4: `DeckBuilderPanel` — widen the gate, pass the lister**

At lines 249-252 replace:

```ts
  // LoadDeckModal lists the public `decks` table, so it only makes sense when
  // the builder runs on the default persistence (a Forge override loads from
  // forge_decks — its deck list page is the switcher there).
  const canLoadDeckList = !builderConfig.persistence;
```

with:

```ts
  // LoadDeckModal lists the public `decks` table by default, so a custom
  // persistence hides Load Deck unless it supplies its own `listDecks`
  // (the Forge lists forge_decks).
  const canLoadDeckList = !builderConfig.persistence || !!builderConfig.persistence.listDecks;
```

At the main Load Deck modal (lines ~3582-3587) add the prop:

```tsx
      {showLoadDeckModal && onLoadDeck && (
        <LoadDeckModal
          onLoadDeck={onLoadDeck}
          onClose={() => setShowLoadDeckModal(false)}
          listDecks={builderConfig.persistence?.listDecks}
        />
      )}
```

Do NOT touch the Replace Good/Evil modals below it.

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no NEW errors (baseline the pre-existing error count first with `git stash && npx tsc --noEmit; git stash pop` if any appear).

- [ ] **Step 6: Commit**

```bash
git add app/decklist/card-search/builderConfig.tsx app/decklist/card-search/components/LoadDeckModal.tsx app/decklist/card-search/components/DeckBuilderPanel.tsx
git commit -m "feat(builder): injectable listDecks + onDeckLoaded seams for Load Deck"
```

---

### Task 2: Successful-load signal — `loadDeckFromCloud` returns boolean, client fires `onDeckLoaded`

**Files:**
- Modify: `app/decklist/card-search/hooks/useDeckState.ts:164-220`
- Modify: `app/decklist/card-search/client.tsx` (handler near `handleDownloadDeck` ~line 1480; both `onLoadDeck={loadDeckFromCloud}` sites at lines 2744 and 2845)

**Interfaces:**
- Consumes: `DeckBuilderConfig.onDeckLoaded` (Task 1).
- Produces: `loadDeckFromCloud(deckId: string): Promise<boolean>` (true only when the deck loaded and state was set).

- [ ] **Step 1: Return a success boolean from `loadDeckFromCloud`**

In `useDeckState.ts`, in the `loadDeckFromCloud` callback: add `return true;` at the end of the `if (result.success && result.deck)` branch (after the final `setSyncStatus({...})`), add `return false;` at the end of the `else` branch, and `return false;` at the end of the `catch` block. Callers that ignore the value are unaffected.

- [ ] **Step 2: Wrap the Load Deck handler in `client.tsx`**

Next to `handleDownloadDeckBySet` (~line 1484) add:

```ts
  // Load a deck picked from the Load Deck modal; on success let the active
  // config sync external state (the Forge rewrites /forge/play/decks/<id>).
  async function handleLoadDeckById(deckId: string) {
    const ok = await loadDeckFromCloud(deckId);
    if (ok) config.onDeckLoaded?.(deckId);
  }
```

Replace `onLoadDeck={loadDeckFromCloud}` with `onLoadDeck={handleLoadDeckById}` at BOTH DeckBuilderPanel sites (desktop ~line 2744, mobile ~line 2845).

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/decklist/card-search/hooks/useDeckState.ts app/decklist/card-search/client.tsx
git commit -m "feat(builder): fire config.onDeckLoaded after a successful Load Deck"
```

---

### Task 3: Forge config — enable import/export, implement `listDecks` (TDD)

**Files:**
- Modify: `app/forge/play/decks/[deckId]/forgeBuilderConfig.tsx` (imports ~line 33; persistence return ~line 197; features block lines 198-209; header comment lines 3-7)
- Test: `app/forge/play/decks/[deckId]/__tests__/forgeBuilderConfig.test.ts`

**Interfaces:**
- Consumes: `DeckBuilderPersistence.listDecks` type (Task 1); `listForgeDecks(): Promise<ForgeDeckSummary[]>` from `app/forge/lib/forgeDecks.ts` (`ForgeDeckSummary = { id; name; format; cardCount; updatedAt }`).
- Produces: forge config with `features.enableImportExport === true` and `persistence.listDecks` mapping `cardCount → card_count`, `updatedAt → updated_at`.

- [ ] **Step 1: Write the failing tests**

In `forgeBuilderConfig.test.ts`:

(a) Add a module mock near the top (after imports, before `describe`). `vi.mock` is hoisted, and the existing tests never call save/load, so mocking the whole module is safe:

```ts
import { vi } from "vitest";

vi.mock("@/app/forge/lib/forgeDecks", () => ({
  saveForgeDeck: vi.fn(),
  getForgeDeck: vi.fn(),
  listForgeDecks: vi.fn(async () => [
    { id: "d1", name: "Alpha", format: "Type 1", cardCount: 50, updatedAt: "2026-07-01T00:00:00.000Z" },
  ]),
}));
```

(b) In the existing `hard-disables every public-only feature` test, change the expectation to `enableImportExport: true` (rename the test to `feature gates: public-only features off, import/export on`):

```ts
  it("feature gates: public-only features off, import/export on", () => {
    expect(config.features).toEqual({
      localStoragePersist: false,
      syncFiltersToUrl: false,
      enableSharing: false,
      enableDeckDelete: false,
      enableImportExport: true,
      enablePrintExports: false,
      enableShopping: false,
      enableDetailsTab: false,
      serverDeckCheck: false,
      enableLegalityChecks: false,
    });
  });
```

(c) New tests at the end of the file:

```ts
describe("forge persistence.listDecks", () => {
  it("maps ForgeDeckSummary to the modal's DeckListItem shape", async () => {
    const config = makeForgeBuilderConfig([]);
    const items = await config.persistence!.listDecks!();
    expect(items).toEqual([
      { id: "d1", name: "Alpha", format: "Type 1", card_count: 50, updated_at: "2026-07-01T00:00:00.000Z" },
    ]);
  });
});

describe("forge text export/import round-trip", () => {
  it("a forge card survives generateDeckText → parseDeckText against the pool", () => {
    const config = makeForgeBuilderConfig([grantedCard("abc-123", "My Forge Hero")]);
    const forgeCard = config.pool[0];
    const deck = {
      name: "T",
      cards: [{ card: forgeCard, quantity: 2, zone: "main" as const }],
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const text = generateDeckText(deck);
    expect(text).toBe("2\tMy Forge Hero");
    const result = parseDeckText(text, config.pool);
    expect(result.errors).toEqual([]);
    expect(result.deck!.cards[0].card.imgFile).toBe("forge:abc-123");
    expect(result.deck!.cards[0].quantity).toBe(2);
    expect(result.deck!.cards[0].zone).toBe("main");
  });
});
```

Add to the test file's imports:

```ts
import { generateDeckText, parseDeckText } from "@/app/decklist/card-search/utils/deckImportExport";
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run "app/forge/play/decks/[deckId]/__tests__/forgeBuilderConfig.test.ts"`
Expected: FAIL — features equality mismatch (`enableImportExport` still `false`) and `listDecks` undefined. The round-trip test may already PASS (export/import are pure pool operations) — that's fine.

- [ ] **Step 3: Implement in `forgeBuilderConfig.tsx`**

(a) Extend the forgeDecks import (line 33):

```ts
import { saveForgeDeck, getForgeDeck, listForgeDecks } from "@/app/forge/lib/forgeDecks";
```

(b) After the `resolveCard` definition (~line 191), add:

```ts
  // Load Deck modal source: the member's forge_decks, mapped to the modal's shape.
  const listDecks: NonNullable<DeckBuilderPersistence["listDecks"]> = async () => {
    const summaries = await listForgeDecks();
    return summaries.map((s) => ({
      id: s.id,
      name: s.name,
      format: s.format,
      card_count: s.cardCount,
      updated_at: s.updatedAt,
    }));
  };
```

(c) In the returned config, change the persistence line to:

```ts
    persistence: { save, loadById, resolveCard, listDecks },
```

and flip the flag:

```ts
      enableImportExport: true,
```

(d) Update the file header comment (lines 3-7): change "and the public-only features hard-disabled" to "and the public-only features hard-disabled (text import/export stays on — forge cards round-trip by name through the pool)".

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run "app/forge/play/decks/[deckId]/__tests__/forgeBuilderConfig.test.ts"`
Expected: PASS (all tests, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add "app/forge/play/decks/[deckId]/forgeBuilderConfig.tsx" "app/forge/play/decks/[deckId]/__tests__/forgeBuilderConfig.test.ts"
git commit -m "feat(forge): builder import/export + Load Deck list from forge_decks"
```

---

### Task 4: Forge URL sync after in-place load

**Files:**
- Modify: `app/forge/play/decks/[deckId]/DeckBuilder.tsx:22`

**Interfaces:**
- Consumes: `DeckBuilderConfig.onDeckLoaded` (Task 1), fired by client.tsx (Task 2).

- [ ] **Step 1: Attach `onDeckLoaded` to the memoized config**

Replace line 22:

```ts
  const config = useMemo(() => makeForgeBuilderConfig(granted), [granted]);
```

with:

```ts
  const config = useMemo(
    () => ({
      ...makeForgeBuilderConfig(granted),
      // Load Deck loads in place; keep /forge/play/decks/<id> honest so
      // refresh and back land on the deck actually shown.
      onDeckLoaded: (id: string) => window.history.replaceState(null, "", `/forge/play/decks/${id}`),
    }),
    [granted]
  );
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "app/forge/play/decks/[deckId]/DeckBuilder.tsx"
git commit -m "feat(forge): sync deck URL after Load Deck via history.replaceState"
```

---

### Task 5: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: all green (same pass count as `main` plus the new tests; no new failures).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors vs. baseline.

- [ ] **Step 3: Manual browser pass (dev server + a forge deck)**

Start `npm run dev`, open an existing forge deck at `/forge/play/decks/<id>`, and verify:
1. Kebab menu now shows Import, Copy to Clipboard, Download .txt, Download .txt (by set), Load Deck.
2. Copy to Clipboard puts `qty\tname` lines (forge card names included) on the clipboard.
3. Download .txt downloads; Download .txt (by set) groups forge cards under the forge set's name.
4. Import: paste a copied list into the import modal → forge cards resolve (composite art renders), deck auto-saves, reload shows the imported deck.
5. Load Deck lists forge decks (name/format/count/date), selecting one switches the builder in place AND the address bar updates to the selected deck's id; browser refresh reloads that same deck.
6. Public builder regression: `/decklist/card-search` Load Deck still lists public decks and loads one.
