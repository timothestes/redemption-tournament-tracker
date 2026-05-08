# Remove Deck Autosave

**Status:** Approved, ready for implementation
**Date:** 2026-05-08

## Goal

Remove background deck autosave from the deck builder. Deck rows should only be written to the database when the user takes an explicit save action (Save button, Save As / rename, deck import). The "Unsaved Changes" indicator stays so users can see when they have pending edits.

## Background

Autosave was introduced in commit `602bb1d` (PR #99 "Feat/konva drag perf") despite the misleading PR title — the squash bundled in the autosave hook. Commit `26fba73` (PR #100 "try out autosave") only tweaked the threshold (don't create a DB row for a brand-new deck until it has 40 cards) and bundled several unrelated changes (UI polish, "All" sort + new `last_active_at` column, Lost Soul handling, SpacetimeDB tweaks).

Wholesale revert of either commit would discard substantial unrelated work and produce conflicts (~25 commits later on main). Surgical removal is cleaner.

## Scope

### In scope

Two files:

1. `app/decklist/card-search/hooks/useDeckState.ts` — strip the autosave loop
2. `app/decklist/card-search/client.tsx` — drop the `autosaveEnabled` option from the hook call

### Out of scope (intentionally untouched)

- PR #100's other changes: UI polish in community/my-decks, deck picker "All" sort, `last_active_at` column (`supabase/migrations/025_*.sql`), follow-up trigger fix (migration 026), Lost Soul `DeckPeekModal` handling, GameLobby/DeckPicker styling, SpacetimeDB Lost Soul + meek tweaks. None of these are autosave.
- The `last_active_at` column stays — it powers the deck picker's "All" sort, not autosave.
- localStorage draft persistence (`STORAGE_KEY`). Separate feature; users rely on it as a tab-close safety net.

## Design

### Code removed from `useDeckState.ts`

- `AUTOSAVE_DEBOUNCE_MS` constant (line 8)
- `UseDeckStateOptions` interface (lines 40–43)
- `options` parameter on `useDeckState` (line 52) and the `autosaveEnabled` derivation (line 54)
- `autosaveTimerRef` (line 74)
- The autosave `useEffect` block (lines 357–387) — the threshold-gated debounced save

### Code reworded in `useDeckState.ts`

The dedup branch inside `saveDeckToCloud` (line 262):

```ts
// Autosave path: skip if nothing has changed since the last successful save
if (!isExplicitCall && snapshotDeck(targetDeck) === lastSavedSnapshotRef.current) {
  return { success: true, deckCheckResult: null, skipped: true } as const;
}
```

stays functionally identical, but the comment is reworded since the branch now applies to manual saves invoked with no override args (the no-arg manual callers at `client.tsx:722`, `1364`, `2583`):

```ts
// Skip if nothing has changed since the last successful save
if (!isExplicitCall && snapshotDeck(targetDeck) === lastSavedSnapshotRef.current) {
  return { success: true, deckCheckResult: null, skipped: true } as const;
}
```

### Code retained (intentionally)

- `snapshotDeck` function — drives the dirty-flag effect (line 120) and the dedup inside `saveDeckToCloud`
- `lastSavedSnapshotRef` — baseline for the dirty flag, set on load (line 218) and on successful save (line 310)
- `deckRef` — captures latest deck for `saveDeckToCloud`'s no-override callers
- `savePromiseRef` — serializes saves so a double-click can't race
- `hasUnsavedChanges` state — heavily consumed in `client.tsx`, `DeckBuilderPanel.tsx`, `MobileBottomNav.tsx`

### Change in `card-search/client.tsx`

Line 380:

```ts
} = useDeckState(deckIdFromUrl, folderIdFromUrl, isNewDeck, { autosaveEnabled: !!user });
```

becomes:

```ts
} = useDeckState(deckIdFromUrl, folderIdFromUrl, isNewDeck);
```

## Verification

- Edit an existing saved deck → "Unsaved Changes" shows → no DB write occurs until Save is clicked.
- Brand-new deck (no `id`) → adding cards does not silently create a DB row in the background. User must hit Save to materialize.
- Import deck flow (`client.tsx:1320`) — still calls `saveDeckToCloud(undefined, importedDeck)` explicitly. Behaves identically.
- `Save As` rename flow (`client.tsx:1362`) — calls `saveDeckToCloud(newName)` with explicit name. Behaves identically.
- Type-check passes (`autosaveEnabled` and `UseDeckStateOptions` have no other consumers).
- No tests reference autosave (`grep` confirmed) — `npm test` should be unaffected.

## Risks

- Users who relied on autosave catching their edits during long sessions will lose that safety net. Mitigation: the `hasUnsavedChanges` indicator already nudges them to save, and localStorage persistence still preserves drafts across reloads.
- The dedup comment update is the only behavioral seam worth reading carefully — branch behavior is unchanged.
