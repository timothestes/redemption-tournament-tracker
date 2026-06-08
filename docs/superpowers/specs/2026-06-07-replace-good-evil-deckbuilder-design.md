# Replace Good / Replace Evil — T2 Deck Builder

**Date:** 2026-06-07
**Status:** Approved design, pending implementation plan

## Summary

Add two new menu items to the deck builder's "More options" dropdown — **Replace Good**
and **Replace Evil** — visible only when the current deck's format is **T2**. Pressing one
opens a deck picker; choosing a source deck replaces the current deck's good (or evil) half
with the source deck's good (or evil) half. The change is applied to the **in-memory working
deck only** — it is not persisted until the user saves, so it is reviewable and reversible
(reload from cloud discards it).

This supports the common T2 workflow of keeping one alignment fixed while swapping the other
half in and out to test different pairings.

## Decisions (from brainstorming)

- **Source of replacement cards:** another saved deck, chosen via a deck picker.
- **What counts as the half:** strictly `"Good"` / strictly `"Evil"` cards across **all zones**
  (main + reserve + maybeboard). Dual `"Good/Evil"` and neutral cards are NOT part of the half.
- **Gating:** the two buttons appear only for T2 decks (`normalizeDeckFormat(deck.format) === 'T2'`).
- **Allowed sources:** any of the user's saved decks (not restricted to T2). The alignment
  filter handles whatever the source contains.
- **No persistence side effects:** in-memory only; user saves manually as with any other edit.
- **No rebalancing:** the result may be temporarily unbalanced (unequal good/evil), which is
  expected mid-edit and surfaced by existing T2 validation.

## Behavior

When the user selects a source deck for "Replace Good" (Evil is symmetric):

1. Load the source deck via `loadDeckByIdAction(sourceDeckId)`.
2. Reconstruct full `Card` objects for the source's DB rows using the same lookup the existing
   `loadDeckFromCloud` flow uses, so each card has its `alignment` populated.
3. From the source, keep only cards whose alignment is **strictly** `"Good"`
   (`card.alignment?.toLowerCase() === "good"`). This naturally excludes `"Good/Evil"` and
   neutral cards. Preserve each kept card's `zone` and `quantity`.
4. Build the new working deck:
   - Start from the current `deck.cards`.
   - Remove every card whose alignment is strictly `"Good"`, across all zones.
   - Append the source's strictly-Good cards (with their zones and quantities).
   - Leave all neutral, dual, and strictly-Evil cards in the current deck untouched.
5. `setDeck(newDeck)` to apply in memory (marks unsaved).
6. Toast a summary, e.g. *"Replaced good half: removed 38, added 41 from 'Royal Priesthood'."*

**Edge case:** if the source deck contains zero strictly-Good (or Evil) cards, make no changes
and show a warning toast (e.g. *"'Deck X' has no good-aligned cards."*).

## Components & Changes

All changes are surgical; no new server actions (reuses `loadDeckByIdAction` and
`loadUserDecksAction`).

### 1. `app/decklist/card-search/components/LoadDeckModal.tsx`

Add optional presentation props so the same modal can act as a generic source-deck picker:

- `title?: string` (default current "Load Deck" heading)
- `actionVerb?` / subtitle text (e.g. "Choose a source deck") — minimal, optional.

Behavior is unchanged when the new props are omitted. The existing `onLoadDeck(deckId)`
callback is reused as the generic "deck chosen" callback.

### 2. `app/decklist/card-search/components/DeckBuilderPanel.tsx`

- Add props `onReplaceGood?: (sourceDeckId: string) => void` and
  `onReplaceEvil?: (sourceDeckId: string) => void`.
- Add modal-visibility state (`showReplaceGoodModal`, `showReplaceEvilModal`).
- Add two buttons in the "More options" dropdown, rendered only when the deck is T2 and the
  callbacks/auth are present. Each opens a `LoadDeckModal` instance with the appropriate title,
  whose `onLoadDeck` fires the corresponding `onReplace*` callback.

### 3. `app/decklist/card-search/client.tsx`

- Implement `handleReplaceGood(sourceDeckId)` and `handleReplaceEvil(sourceDeckId)` (or one
  parametrized helper) that perform the load → reconstruct → filter → rebuild → `setDeck` flow
  described above, reusing the existing card-reconstruction logic from `loadDeckFromCloud`.
- Pass them to `DeckBuilderPanel` as `onReplaceGood` / `onReplaceEvil`.
- Emit success/warning toasts via the existing notify mechanism.

## Out of Scope

- No new server action or DB migration.
- No automatic save.
- No automatic rebalancing of good/evil counts.
- No changes to T2 validation rules.

## Verification

- Replace Good/Replace Evil buttons appear only for T2 decks; absent for T1/Paragon.
- After a replace, the untouched half (and all neutral/dual cards) are byte-for-byte unchanged;
  only the targeted alignment's cards are swapped, with correct zones and quantities.
- Replacing from a source with no matching-alignment cards leaves the deck unchanged and warns.
- The change is unsaved after the operation; reloading from cloud restores the original.
