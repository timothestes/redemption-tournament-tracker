# Maybeboard Zone — Design Notes

## Overview

Add a third card zone ("maybeboard") to the deck builder alongside the existing Main Deck and Reserve. The maybeboard is for cards the user is considering but hasn't committed to. It should be clearly separate from the actual deck and excluded from tournament-facing outputs.

## Data Model Recommendation

**Use an additive boolean, not a schema migration.**

The existing system tracks zones via `is_reserve BOOLEAN DEFAULT false` on the `deck_cards` table. Migrating this to an enum (`zone TEXT`) would require altering the column type, updating every existing row, changing the unique constraint, and updating every query — high risk for existing data.

Instead, add a new column:

```sql
ALTER TABLE deck_cards ADD COLUMN is_maybeboard BOOLEAN DEFAULT false;
```

On the TypeScript side, add `isMaybeboard?: boolean` to `DeckCard` (in `app/decklist/card-search/types/deck.ts`) and keep `isReserve` untouched.

**Invalid state concern:** A card could theoretically have `is_reserve: true, is_maybeboard: true`. Prevent this in application code — the UI should never produce this combination. Maybeboard cards should always have `is_reserve: false, is_maybeboard: true`.

**Benefits:** Zero risk to existing data, additive-only migration, trivial rollback (drop the column), and all existing codepaths continue working unchanged.

## Unique Constraint

The current constraint is `UNIQUE(deck_id, card_name, card_set, is_reserve)`. It needs updating to include `is_maybeboard`:

```sql
ALTER TABLE deck_cards DROP CONSTRAINT deck_cards_deck_id_card_name_card_set_is_reserve_key;
ALTER TABLE deck_cards ADD CONSTRAINT deck_cards_deck_id_card_name_card_set_zone_key
  UNIQUE(deck_id, card_name, card_set, is_reserve, is_maybeboard);
```

## Every File That Needs Changes

### Types
- **`app/decklist/card-search/types/deck.ts`** — Add `isMaybeboard?: boolean` to `DeckCard`. Add `maybeboardCount` to `DeckStats`.

### State Hook
- **`app/decklist/card-search/hooks/useDeckState.ts`** — Every function that takes `isReserve: boolean` (`addCard`, `removeCard`, `updateQuantity`, `getCardQuantity`) needs an additional `isMaybeboard` parameter or a zone-style parameter. `getDeckStats()` needs to compute `maybeboardCount`. Cloud save/load needs to map `isMaybeboard` ↔ `is_maybeboard`. Preview card selection should exclude maybeboard cards.

### Tab System
- **`app/decklist/card-search/components/DeckBuilderPanel.tsx`** — `TabType` (currently `"main" | "reserve" | "info" | "cover"`) needs `"maybeboard"`. Add a fifth tab button and content block. `handleMoveCard` currently takes `(fromReserve: boolean, toReserve: boolean)` — needs rethinking for three zones (see "Move Card UX" below).

### Card List
- **`app/decklist/card-search/components/DeckCardList.tsx`** — `filterReserve?: boolean` prop needs extending to filter three zones. The move button currently does `onMoveCard(..., isReserve, !isReserve)` (simple boolean flip) — with three zones, the destination is ambiguous (see "Move Card UX" below).

### Search Grid (Card Pool)
- **`app/decklist/card-search/client.tsx`** — The `activeDeckTab === "reserve"` expression that routes +/- buttons needs a third case for maybeboard. The quantity badges (currently `×N` for main, `×N R` for reserve) need a third indicator for maybeboard cards.

### Validation
- **`app/decklist/card-search/utils/deckValidation.ts`** — Maybeboard cards must be **completely excluded** from all validation: deck size limits, lost soul count, dominant count, Type 2 good/evil alignment, Paragon brigade stats, reserve content restrictions. The simplest approach is to filter them out at the very top of `validateDeck()`.

### Export / Import
- **`app/decklist/card-search/utils/deckImportExport.ts`** — Add a `Maybeboard:` section to the text format. The parser needs to recognize this header and set `isMaybeboard: true` on parsed cards. `generateDeckText` needs a third filter block.

### PDF and Image Generation
- **`app/decklist/card-search/components/GeneratePDFModal.tsx`** and **`GenerateDeckImageModal.tsx`** — Both call `generateDeckText(deck)`. Maybeboard cards should be **excluded** from the text sent to the external API. Either filter them out before calling `generateDeckText`, or have `generateDeckText` accept an option to exclude maybeboard.

### Server Actions
- **`app/decklist/actions.ts`** — `DeckCardData` interface needs `is_maybeboard`. `saveDeckAction` needs to pass `is_maybeboard` in the insert and exclude maybeboard from `card_count`. All load actions (`loadDeckByIdAction`, `loadPublicDeckAction`) need to return the field. `copyPublicDeckAction` and `duplicateDeckAction` need to preserve it.

### Deck Detail View
- **`app/decklist/[deckId]/client.tsx`** — Add a third filter for maybeboard cards. Render a separate section in both stacked and normal views. Update the header card count to (probably) exclude maybeboard. Update the download handler.

### Community View
- **`app/decklist/community/client.tsx`** — Download handler needs the third section.

### Database
- New migration file adding the `is_maybeboard` column and updating the unique constraint.

## Duplicate Text Export Implementations

There are **three separate hand-rolled implementations** of the deck text format:
1. `app/decklist/card-search/utils/deckImportExport.ts` — the canonical one
2. `app/decklist/[deckId]/client.tsx` — in `handleDownloadTxt()`
3. `app/decklist/community/client.tsx` — in `handleDownload()`

The latter two work directly from raw DB card objects (using `is_reserve` instead of `isReserve`) and duplicate the same logic. Consider consolidating these into a shared utility as part of this work to avoid maintaining three copies.

## UX Decisions to Make

### Move Card Between Zones
Currently, the move button is a simple toggle (`!isReserve`). With three zones, a card in the main deck could go to reserve OR maybeboard. Options:
- **Dropdown/menu** on the move button with two target options
- **Two separate arrow buttons** per card (e.g., `→ R` and `→ M`)
- **Right-click context menu** with move options
- **Long press** on mobile to get options

### Card Pool Quantity Badge
Currently shows `×2` (main) and `×1 R` (reserve) stacked. Need a third badge for maybeboard. Suggestion: `×1 M` with the same dark styling. Three stacked badges may get tight on small cards — consider only showing badges for the active tab's zone, or using a more compact format.

### Public Deck View
Should the maybeboard be visible on shared/public decks? Options:
- **Separate tab or collapsible section** — visible but secondary
- **Hidden entirely** — maybeboard is private/drafting only
- **User toggle** — deck owner chooses whether to share their maybeboard

### Expanded Deck View (In-Builder)
A separate tab is the natural fit since we already have tabs for main/reserve/stats/details.

### Export Behavior
- **Text export (.txt):** Include maybeboard under a `Maybeboard:` header (useful for sharing ideas)
- **PDF generation:** Exclude (this is a tournament submission document)
- **Image generation:** Exclude (this is a visual decklist, not a draft workspace)
- **Import:** Parse `Maybeboard:` section if present
- **Copy to clipboard:** Include (same as text export)

## Implementation Order Suggestion

1. Database migration (additive, safe)
2. Types + state hook (`DeckCard`, `useDeckState`)
3. Server actions (save/load)
4. Tab system + DeckBuilderPanel (new tab, card display)
5. DeckCardList (filtering, move card UX)
6. Card pool badges + add-to-zone logic
7. Validation (exclude maybeboard)
8. Export/import (new section)
9. PDF/image generation (exclude maybeboard)
10. Deck detail view + public view
11. Community download handler
12. Consolidate duplicate text export implementations
