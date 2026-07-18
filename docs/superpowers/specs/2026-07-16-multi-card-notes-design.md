# Multi-Card Notes (Batch "Negated") — Design

**Date:** 2026-07-16
**Status:** Approved (adversarial subagent review, 2 rounds)

## Problem

In multiplayer, a player often needs to mark a wide swath of cards at once — e.g.
"Negated" across most of a battle line-up. Today notes are single-card only: the
marquee drag-select exists, the multi-card context menu exists, and per-card notes
exist, but they aren't connected.

## What already exists (unchanged)

- Marquee drag-select (`useSelectionState`, wired in `MultiplayerCanvas`). One
  marquee selects a single owner's cards (majority-owner rule), so noting both
  sides takes two passes. Opponent-owned swaths work: `set_note` has no
  ownership gate, and the multi menu opens for any selected card.
- `MultiCardContextMenu` (shared with goldfish) with per-card client-side loops
  for Meek All / Flip All.
- `set_note` reducer (40-char max, trims, overwrites), `CardInstance.notes`,
  note pill on `GameCardNode`, `CardNotePopover` editor, "Negated" preset in the
  single-card menu.

## Changes

### 1. `app/shared/components/MultiCardContextMenu.tsx`

New optional prop `onEditNotes?: (cardIds: string[]) => void`. A **Note**
section between the meek/flip toggles and "Move to...", rendered only when the
prop is provided (mirrors how `onEditNote` gates the single-card note section):

- **Mark All "Negated"** — loops `actions.setNote(id, 'Negated')` via `doAction`.
- **Add Note to All...** — `onClick={() => { onClose(); onEditNotes(selectedIds); }}`
  (the `onExchange` pattern, NOT `doAction`): ids are captured at click time so
  the popover survives menu close / selection clearing.
- **Clear All Notes** — only rendered when ≥1 selected card has a non-empty note
  (resolved from `zones`); loops `actions.setNote(id, '')` via `doAction`.

Goldfish does not pass `onEditNotes`, so no note items appear there (goldfish's
single-card menu has no note section either — avoids un-clearable notes).
The `allTokens` early-return branch intentionally keeps its focused menu
(Rescue / Remove); mixed token+card selections hit the main branch and work.

### 2. `app/play/components/MultiplayerCanvas.tsx`

- `notePopover` state generalized from `{ cardId, x, y, initialValue }` to
  `{ cardIds: string[], x, y, initialValue }`. Single-card path passes a
  one-element list seeded with the card's current note; multi path seeds `''`.
- `onSave` loops `gameState.setNote(BigInt(id), text)` over `cardIds`, with one
  guard: **empty text + multiple cards = cancel, not bulk clear.**
  `CardNotePopover` saves on click-away, so without the guard an abandoned
  multi-note dialog would silently wipe existing notes on every selected card.
  The single-card path keeps the existing clear-by-emptying flow.
- Wire `onEditNotes` on the multi-menu render (opens popover at menu x/y).
- Hygiene: wrap the popover render in `!isSpectator` (its only setters were
  already spectator-gated; server rejects non-players regardless).

### 3. `spacetimedb/src/index.ts` — fix hidden-identity log leak

`set_note` currently logs `cardName`/`cardImgFile` unconditionally, so noting a
face-down or in-hand card announces its identity in the game log — and batch
noting would turn that into a one-click sweep of the opponent's face-down cards.
Fix: omit `cardName`/`cardImgFile` from the SET_NOTE payload when
`card.isFlipped || card.zone === 'hand'`, mirroring the existing guards in
`flip_card`/`meek_card`. `ChatPanel` already falls back to the generic
"set a note on a card" line when `cardName` is absent — no client change.

Requires a module publish + bindings regen (reducer signature unchanged, so no
binding diff expected — publish is for server behavior).

## Semantics

- Applying a note **overwrites** each card's existing note (single-card parity).
- No undo participation (consistent with Meek All).
- N cards → N SET_NOTE log lines (consistent with Meek All).
- `flip_card` wiping notes on face-down flip is unchanged, deliberate behavior.

## Out of scope

- Batch `set_notes_batch` reducer (client loop matches the menu's existing
  pattern; revisit only if log volume becomes a problem).
- Note items in the token-only menu branch.
- Goldfish note UI.
