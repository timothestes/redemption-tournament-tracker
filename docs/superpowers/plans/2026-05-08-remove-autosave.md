# Remove Deck Autosave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove background deck autosave so deck rows are only written on explicit user save actions, while keeping the "Unsaved Changes" indicator and manual-save dedup intact.

**Architecture:** Surgical removal of the autosave `useEffect` and its supporting bits (constant, option, ref) from `useDeckState`, plus dropping the `{ autosaveEnabled: !!user }` argument at the single call site. All state used by the dirty-flag indicator and manual saves is preserved. No tests exist for autosave, so verification is type-check + manual smoke.

**Tech Stack:** TypeScript, React (hooks), Next.js App Router. No test framework configured for this hook.

**Spec:** [docs/superpowers/specs/2026-05-08-remove-autosave-design.md](../specs/2026-05-08-remove-autosave-design.md)

---

### Task 1: Remove autosave from useDeckState and update the call site

**Files:**
- Modify: `app/decklist/card-search/hooks/useDeckState.ts`
- Modify: `app/decklist/card-search/client.tsx`

The edits are split across both files; the type-checker is only happy when both are done together, so commit them as one atomic change.

#### Order matters

Do the call-site edit (Step 1) **before** removing the option from the hook signature (Step 4). The hook's `options` parameter is currently optional, so dropping the argument from the call site first keeps the intermediate state compilable.

---

- [ ] **Step 1: Drop `{ autosaveEnabled: !!user }` from the call site**

In `app/decklist/card-search/client.tsx`, change line 380.

Old:
```ts
  } = useDeckState(deckIdFromUrl, folderIdFromUrl, isNewDeck, { autosaveEnabled: !!user });
```

New:
```ts
  } = useDeckState(deckIdFromUrl, folderIdFromUrl, isNewDeck);
```

---

- [ ] **Step 2: Remove the autosave `useEffect` block in useDeckState.ts**

In `app/decklist/card-search/hooks/useDeckState.ts`, delete this entire block (currently lines 357–387, immediately after the `saveDeckToCloud` `useCallback`):

```ts
  // Autosave: 1.5s after the last edit, push the deck to the cloud.
  // Skips when not authenticated, while still hydrating, or when nothing has changed.
  useEffect(() => {
    if (!autosaveEnabled) return;
    if (isInitializing) return;
    if (isInitialMount.current) return;

    // For never-saved decks, require at least 40 cards before creating a DB row.
    // Once a deck has an id, keep syncing every change unconditionally so edits
    // to an existing saved deck never get dropped.
    if (!deck.id) {
      const totalCards = deck.cards.reduce((sum, c) => sum + c.quantity, 0);
      if (totalCards < 40) return;
    }

    if (snapshotDeck(deck) === lastSavedSnapshotRef.current) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      // Errors surface via syncStatus; nothing to do here
      saveDeckToCloud().catch(() => { /* noop */ });
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [deck, autosaveEnabled, isInitializing, saveDeckToCloud]);
```

Replace with nothing (remove the block, leave a single blank line of separation between `saveDeckToCloud`'s closing `}, []);` and the next comment block `/**` for `addCard`).

---

- [ ] **Step 3: Remove `autosaveTimerRef`**

In `app/decklist/card-search/hooks/useDeckState.ts`, delete these two lines (currently lines 73–74):

```ts
  // Pending autosave debounce timer
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

---

- [ ] **Step 4: Remove `UseDeckStateOptions`, the `options` parameter, and the `autosaveEnabled` derivation**

In `app/decklist/card-search/hooks/useDeckState.ts`:

(a) Delete the interface (currently lines 40–43):

```ts
export interface UseDeckStateOptions {
  /** Whether to auto-save deck changes to the cloud (debounced). Requires the user to be authenticated. */
  autosaveEnabled?: boolean;
}
```

(b) Change the hook signature (currently lines 47–54).

Old:
```ts
/**
 * Custom hook for managing deck state with localStorage persistence and cloud sync
 */
export function useDeckState(
  initialDeckId?: string,
  initialFolderId?: string | null,
  isNewDeck?: boolean,
  options?: UseDeckStateOptions
) {
  const autosaveEnabled = options?.autosaveEnabled ?? false;
```

New:
```ts
/**
 * Custom hook for managing deck state with localStorage persistence and cloud sync
 */
export function useDeckState(
  initialDeckId?: string,
  initialFolderId?: string | null,
  isNewDeck?: boolean
) {
```

---

- [ ] **Step 5: Remove the `AUTOSAVE_DEBOUNCE_MS` constant**

In `app/decklist/card-search/hooks/useDeckState.ts`, delete line 8:

```ts
const AUTOSAVE_DEBOUNCE_MS = 1500;
```

The line above (`const STORAGE_KEY = ...`) stays. The blank line that followed `AUTOSAVE_DEBOUNCE_MS` should be removed too — collapse `STORAGE_KEY` directly into the comment block above `snapshotDeck`.

---

- [ ] **Step 6: Reword the dedup comment in `saveDeckToCloud`**

In `app/decklist/card-search/hooks/useDeckState.ts`, change the comment on the dedup branch inside `saveDeckToCloud` (currently around line 262).

Old:
```ts
        // Autosave path: skip if nothing has changed since the last successful save
        if (!isExplicitCall && snapshotDeck(targetDeck) === lastSavedSnapshotRef.current) {
          return { success: true, deckCheckResult: null, skipped: true } as const;
        }
```

New:
```ts
        // Skip if nothing has changed since the last successful save
        if (!isExplicitCall && snapshotDeck(targetDeck) === lastSavedSnapshotRef.current) {
          return { success: true, deckCheckResult: null, skipped: true } as const;
        }
```

(Body of the branch is unchanged — it still applies to manual saves invoked with no `overrideName`/`overrideDeck` args.)

---

- [ ] **Step 7: Also update the comment on `lastSavedSnapshotRef`**

In `app/decklist/card-search/hooks/useDeckState.ts`, the comment on `lastSavedSnapshotRef` mentions autosaves (currently around line 69). Update it.

Old:
```ts
  // Snapshot of the most recently saved (or just-loaded) deck — used to dedup autosaves
  const lastSavedSnapshotRef = useRef<string | null>(null);
  // Serializes saves so a manual + debounced autosave can't race
  const savePromiseRef = useRef<Promise<unknown> | null>(null);
```

New:
```ts
  // Snapshot of the most recently saved (or just-loaded) deck — drives the dirty flag and skips no-op saves
  const lastSavedSnapshotRef = useRef<string | null>(null);
  // Serializes saves so two saves can't race
  const savePromiseRef = useRef<Promise<unknown> | null>(null);
```

Also update the comment on `snapshotDeck` itself (currently around line 11).

Old:
```ts
// Stable serialization of the persisted parts of a deck for change detection.
// Used to skip redundant autosaves and to drive the "in-flight changes" indicator.
function snapshotDeck(d: Deck): string {
```

New:
```ts
// Stable serialization of the persisted parts of a deck for change detection.
// Drives the "Unsaved Changes" indicator and skips no-op saves.
function snapshotDeck(d: Deck): string {
```

Also update the comment on the load-baseline assignment (currently around line 217).

Old:
```ts
        // Mark the loaded deck as the baseline so autosave doesn't immediately re-save it
        lastSavedSnapshotRef.current = snapshotDeck(loadedDeck);
```

New:
```ts
        // Set the saved-snapshot baseline so the dirty flag starts clean
        lastSavedSnapshotRef.current = snapshotDeck(loadedDeck);
```

Also update the comment on the post-save snapshot (currently around line 308).

Old:
```ts
          // Snapshot the saved state (with its potentially-new id) so subsequent
          // autosaves correctly recognize there's nothing to do.
          lastSavedSnapshotRef.current = snapshotDeck({ ...targetDeck, id: savedId });
```

New:
```ts
          // Snapshot the saved state (with its potentially-new id) so subsequent
          // saves dedup and the dirty flag goes clean.
          lastSavedSnapshotRef.current = snapshotDeck({ ...targetDeck, id: savedId });
```

---

- [ ] **Step 8: Verify no leftover references to autosave symbols**

Run:
```bash
grep -nE 'autosave|AUTOSAVE|UseDeckStateOptions|autosaveTimerRef|autosaveEnabled' app/decklist/card-search/hooks/useDeckState.ts app/decklist/card-search/client.tsx
```

Expected: no output. Any output indicates a missed reference — go fix it before the type-check.

---

- [ ] **Step 9: Type-check the project**

Run:
```bash
npx tsc --noEmit
```

Expected: exits 0 with no output. If there are errors in unrelated files that pre-exist on `main`, that's fine — but no new errors should reference `useDeckState.ts` or `card-search/client.tsx`.

If you see errors in either of those two files, the most likely cause is a missed reference from Step 4 (forgot to delete `autosaveEnabled` somewhere) or a stale import. Re-run Step 8's grep to find it.

---

- [ ] **Step 10: Manual smoke test (optional but recommended)**

Start the dev server in a separate terminal:
```bash
npm run dev
```

Then in a browser at `http://localhost:3000`:
1. Sign in.
2. Open an existing deck. Edit a card quantity. The save button should show "Unsaved Changes" and stay enabled. **No DB write should happen yet.** Click Save. Indicator clears. Reload — change persisted.
3. Create a brand-new deck (the "+" / new deck flow). Add a few cards (well under 40). The save button should still show "Unsaved Changes". **No DB row created in `decks` table yet.** Click Save explicitly to create it.
4. Try the deck import flow. It should still save the imported deck immediately (because `client.tsx:1320` calls `saveDeckToCloud(undefined, importedDeck)` explicitly).

If anything misbehaves, especially #2 silently writing without a Save click, the autosave `useEffect` was not fully removed.

---

- [ ] **Step 11: Commit**

```bash
git add app/decklist/card-search/hooks/useDeckState.ts app/decklist/card-search/client.tsx
git commit -m "$(cat <<'EOF'
remove deck autosave

Strip the debounced autosave loop from useDeckState. Decks now persist
only on explicit user action (Save button, Save As, deck import). The
dirty-flag indicator and snapshot-based dedup remain — they still serve
manual saves and the "Unsaved Changes" UI.

EOF
)"
```

---

## Self-Review

**Spec coverage:**
- "Remove `AUTOSAVE_DEBOUNCE_MS` constant" → Step 5 ✅
- "Remove `UseDeckStateOptions` interface" → Step 4(a) ✅
- "Remove `options` parameter on `useDeckState`" → Step 4(b) ✅
- "Remove `autosaveEnabled` derivation" → Step 4(b) ✅
- "Remove `autosaveTimerRef`" → Step 3 ✅
- "Remove the autosave `useEffect` block" → Step 2 ✅
- "Reword the dedup branch comment" → Step 6 ✅ (and Step 7 sweeps the other autosave-mentioning comments for consistency)
- "Drop `autosaveEnabled` argument at call site" → Step 1 ✅
- "Out of scope: PR #100's other changes, migrations 025/026, localStorage persistence" → not touched ✅
- Verification (TypeScript compile, manual smoke for new-deck/edit-deck/import flows) → Steps 9, 10 ✅

**Placeholder scan:** No TBDs, TODOs, or vague directions. Each edit shows old → new with full code. The grep + type-check steps have explicit expected output.

**Type consistency:** Symbol names (`autosaveEnabled`, `autosaveTimerRef`, `AUTOSAVE_DEBOUNCE_MS`, `UseDeckStateOptions`, `lastSavedSnapshotRef`, `savePromiseRef`, `snapshotDeck`) match the actual file. Step 1's call signature `useDeckState(deckIdFromUrl, folderIdFromUrl, isNewDeck)` matches Step 4's new signature.
