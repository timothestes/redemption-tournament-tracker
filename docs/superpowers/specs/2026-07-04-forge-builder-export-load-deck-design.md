# Forge Builder: Import/Export + Load Deck

**Date:** 2026-07-04
**Status:** Approved

## Problem

The Forge deck builder (the shared `CardSearchClient` parameterized by
`makeForgeBuilderConfig`) is missing menu features the public builder has:
Import, Copy to Clipboard, Download .txt, Download .txt (by set), and Load
Deck. They were deliberately disabled during the Phase-3 unification:

- `enableImportExport: false` — rationale at the time: "the text format has no
  forge-UUID notion, so exported lists can't round-trip." This is now outdated:
  forge cards live in the builder's pool with real names/sets, and matched pool
  cards carry their `forge:<id>` stamp in `imgFile`, so text import resolves
  and re-saves them correctly.
- Load Deck is hidden whenever a custom `persistence` is configured, because
  `LoadDeckModal` only lists the public `decks` table.

## Decisions

1. **Whole import/export group** — flip the existing `enableImportExport` flag
   for Forge rather than adding an export-only flag. Import, Copy, both
   Downloads, Ctrl+I/E, and the empty-state import button all appear.
2. **Load Deck loads in place + syncs the URL** — instant switch like the main
   site, then `history.replaceState` to `/forge/play/decks/<id>` so refresh
   and back behave correctly. No full navigation.
3. **Privacy accepted** — exported .txt files contain forge card names in
   plain text on the member's device. Inherent to the feature; accepted by the
   Forge owner.

## Design

### 1. Enable import/export (config-only)

`makeForgeBuilderConfig` sets `enableImportExport: true`. Update the stale doc
comment on the flag in `builderConfig.tsx` (it still claims forge export can't
round-trip).

Downstream already works with no code changes:
- Copy / Download .txt export `qty\tname`; forge cards have real names.
- Download .txt (by set) groups by `officialSet` = the forge set's name.
- Import parses against the config pool (forge + public). Forge pool cards
  have `imgFile` stamped with the `forge:<id>` dataLine, so the post-import
  auto-save maps them to `{ source: "forge", cardId }` entries in
  `forge_decks`.

### 2. Load Deck via injectable deck list

- `DeckBuilderPersistence` gains
  `listDecks?: () => Promise<Array<{ id: string; name: string; format?: string; card_count?: number; updated_at: string }>>`.
- `LoadDeckModal` accepts an optional `listDecks` prop; when omitted it uses
  the current public `loadUserDecksAction` path unchanged.
- `DeckBuilderPanel` gate becomes: show Load Deck when there is no custom
  persistence **or** the persistence provides `listDecks`. Applies to both the
  desktop and mobile menus. The injected lister is passed to the main
  Load Deck modal only (not Replace Good/Evil).
- Forge config implements `listDecks` by mapping `listForgeDecks()` summaries
  (`cardCount` → `card_count`, `updatedAt` → `updated_at`).
- Selection flows through the existing `onLoadDeck` → `loadDeckFromCloud`,
  which already routes to the forge `loadById`.

### 3. URL sync after in-place load

- `DeckBuilderConfig` gains optional `onDeckLoaded?: (deckId: string) => void`.
- `client.tsx` calls it only after a successful Load-Deck-modal load (wraps
  the `onLoadDeck` handler passed to `DeckBuilderPanel`).
- Forge's `DeckBuilder.tsx` passes
  `(id) => window.history.replaceState(null, "", \`/forge/play/decks/${id}\`)`.

## Out of scope (flagged, not fixed)

- Replace Good/Evil… shows for T2 forge decks and lists *public* decks — a
  pre-existing quirk.
- Sharing, PDF/image generation, shopping, and in-menu delete stay off for
  Forge as originally designed.

## Verification

- Extend existing tests: forge config `listDecks` mapping; a forge card
  round-trips export text → `parseDeckText` against the forge pool.
- Manual browser pass on a forge deck: copy, both downloads, import, Load
  Deck switch + URL update + refresh.
