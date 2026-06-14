# Collection Check — "Check my collection" Feature

**Date:** 2026-06-14
**Status:** Approved design, ready for implementation plan

## Summary

Add a **"Check my collection"** button to the two deck surfaces — the public deck view
(`app/decklist/[deckId]/client.tsx`) and the deck builder
(`app/decklist/card-search/components/DeckBuilderPanel.tsx`). The button opens a modal that
tells a signed-in user exactly which cards (and how many copies) the deck needs that they do
**not** own, with a one-line summary ("You own 48 / 60 — missing 12") and an option to buy
some or all of the missing cards from Your Turn Games (YTG).

This is collection-first, distinct from the existing **Buy on YTG** flow (`BuyDeckModal`),
which is purchase-first, filtered to YTG availability, and matches by `name|set`.

## Decided Requirements

- **Output:** a modal with a missing-cards list + a buy-from-YTG action + an owned/total summary.
- **Matching:** by **card name only** — owning any printing of a card name counts as owning it.
- **Zones counted:** `main` + `reserve`. Ignore `maybeboard` (scratchpad).
- **Visibility:** button shows **only when the user is signed in**. An empty collection means
  every deck card is "missing".
- **Quantity-aware:** deck needs 3, own 1 ⇒ missing 2.

## Approach

A new focused **`CollectionCheckModal`** plus two small **pure helpers**. The buy step reuses
the existing, battle-tested `BuyDeckModal` rather than reimplementing the YTG cart UI.

Rejected: extending `BuyDeckModal` itself. Its owned-exclusion (`applyOwnedExclusion`) is
`name|set`-keyed, which conflicts with the name-only requirement, and changing that shared
helper would alter the real buy flow. Its display is also built around YTG matched/unmatched
inventory, so a card the user is missing that YTG doesn't stock would render as "unavailable"
rather than "you need this."

## Data Flow

1. Both pages already load collection state via
   `useCollectionState({ enabled: isLoggedIn })`. It exposes `quantities: Map<string, number>`
   keyed by `` `${card_name}|${card_set}|${card_img_file}` `` and `isAvailable: boolean`
   (true once a load succeeds). The public view loads it at
   `app/decklist/[deckId]/client.tsx:145`. The builder's parent (`app/decklist/card-search/client.tsx`)
   loads it; `DeckBuilderPanel` does not currently receive it.
2. `aggregateOwnedByName(quantities)` collapses the fullKey-keyed map into `Record<name, totalQty>`
   (split the key on `|`, take index 0, sum).
3. `computeMissingCards(deckCards, ownedByName)` takes the same `BuyDeckCard[]` already built for
   `BuyDeckModal` on each page, restricts to `main` + `reserve`, allocates owned copies greedily by
   card name across entries (in array order), and returns:
   `{ missing: BuyDeckCard[], ownedCount: number, totalCount: number }`.
   Each missing entry keeps its original `card_key`/printing so the buy step can hand it to YTG.

### `BuyDeckCard` shape (existing, reused verbatim)

```ts
interface BuyDeckCard {
  card_name: string;
  card_key: string;   // `${name}|${set}|${imgFile}`
  quantity: number;
  zone: DeckZone;     // "main" | "reserve" | "maybeboard"
}
```

### `computeMissingCards` semantics

- `totalCount` = sum of `quantity` over `main` + `reserve` entries.
- Pool owned copies by **card name** (from `ownedByName`).
- Iterate `main` + `reserve` entries in array order. For each entry, take
  `min(remainingOwnedForName, entry.quantity)` from the pool; the leftover
  `entry.quantity - taken` (when > 0) becomes a `missing` entry with the same `card_key`/zone.
- `ownedCount` = `totalCount` − (sum of missing quantities).
- Two printings of the same name (whether in the same zone or split across main/reserve) **share
  one owned pool**; the first entries consume owned copies first.
- Empty collection ⇒ `ownedByName` empty ⇒ all entries missing.

## Components

### `CollectionCheckModal.tsx` (new)

Props:
```ts
{
  cards: BuyDeckCard[];                 // full deck (main+reserve+maybeboard); helper filters
  ownedByName: Record<string, number>;
  collectionAvailable: boolean;         // useCollectionState.isAvailable
  onClose: () => void;
  onBuyMissing: (missing: BuyDeckCard[]) => void;  // parent opens BuyDeckModal
}
```

Behavior / UI:
- Header summary: **"You own {ownedCount} / {totalCount} — missing {missingCount}"**.
- Missing list grouped by zone (Main, then Reserve), each row showing card name and `×N` short.
- States:
  - **Owns everything** (`missing.length === 0`): celebratory empty state, no buy button.
  - **Collection not yet loaded** (`!collectionAvailable`): brief loading note.
  - **Missing cards present:** show list + **"Buy missing on YTG"** button.
- "Buy missing on YTG" handler: `onClose()` then `onBuyMissing(missing)`. The parent opens
  `BuyDeckModal` seeded with the missing cards. **Do not nest** the modals — close first, then open.
- Match `BuyDeckModal`'s existing visual conventions (bottom-sheet on mobile, centered card on
  desktop, same backdrop/`border`/`bg-card` tokens). No `focus:ring-2 focus:ring-ring` on controls
  (per project preference).

### Buy hand-off (reusing `BuyDeckModal`)

- Parent stores `buyCards: BuyDeckCard[] | null`. `onBuyMissing(missing)` sets it and opens
  `BuyDeckModal` with `cards={buyCards}`.
- `BuyDeckModal`'s **owned-exclusion stays OFF** (its default `excludeOwned=false`). Because the
  cards are already the missing set, leaving it off avoids double-subtraction. No change to
  `BuyDeckModal` is required.

## Helpers (new, pure, unit-testable)

`app/decklist/card-search/utils/collectionCheck.ts`:
- `aggregateOwnedByName(quantities: Map<string, number>): Record<string, number>`
- `computeMissingCards(cards: BuyDeckCard[], ownedByName: Record<string, number>): { missing: BuyDeckCard[]; ownedCount: number; totalCount: number }`

## Edits to Existing Files

1. **`app/decklist/[deckId]/client.tsx`**
   - Import `CollectionCheckModal`.
   - Add state: `showCollectionCheckModal`, `buyCards` (for the hand-off).
   - Add **"Check my collection"** button in the actions bar, gated on `isLoggedIn`, near the
     existing Buy buttons (~line 583–602 / the Goldfish + Export action row ~line 845).
   - Render `CollectionCheckModal` near the existing `BuyDeckModal` (~line 1683), passing the same
     `enrichedCards.map(...)` `BuyDeckCard[]` and `aggregateOwnedByName(collectionQuantities)`.
   - Wire `onBuyMissing` to set `buyCards` and open `BuyDeckModal`; `BuyDeckModal`'s `cards`
     becomes `buyCards ?? <full deck mapping>` so the existing Buy buttons still pass the full deck.

2. **`app/decklist/card-search/components/DeckBuilderPanel.tsx`**
   - Accept collection state via props from the parent (`collectionQuantities: Map<string, number>`,
     `collectionAvailable: boolean`) — `DeckBuilderPanel` does not load it today.
   - Import `CollectionCheckModal`; add `showCollectionCheckModal` + `buyCards` state.
   - Add **"Check my collection"** button next to the existing Buy buttons (~line 958), gated on
     signed-in.
   - Render `CollectionCheckModal` near `BuyDeckModal` (~line 3456), passing the same
     `deck.cards.map(...)` `BuyDeckCard[]` and `aggregateOwnedByName(collectionQuantities)`.

3. **`app/decklist/card-search/client.tsx`**
   - Pass the already-loaded collection state (`quantities`, `isAvailable`) down to
     `DeckBuilderPanel` as props.

4. **`app/decklist/card-search/components/BuyDeckModal.tsx`**
   - No behavior change. (Optionally extract `BuyDeckCard` to a shared location if the modal needs
     to import it; otherwise import the existing exported type.)

## Edge Cases

- **Signed out:** button not rendered.
- **Signed in, empty collection:** all main+reserve cards missing; summary reads "You own 0 / N".
- **Collection still loading:** `collectionAvailable` false → modal shows a brief loading note
  rather than a misleading "missing everything".
- **Owns the whole deck:** missing list empty → celebratory state, no buy button.
- **Maybeboard:** never counted in totals or missing.
- **Multiple printings of one name:** share a single owned pool (name-only matching).

## Testing

Unit tests for `collectionCheck.ts`:
- Quantity short: deck 3, own 1 ⇒ missing 2; `ownedCount`/`totalCount` correct.
- Multi-printing pooling: two printings of one name across main + reserve share owned pool;
  allocation follows array order.
- Empty collection ⇒ all missing.
- Owns everything ⇒ `missing` empty.
- Maybeboard excluded from totals.

Manual / e2e verification (per the agreed plan, two reviewers):
- Button appears only when signed in, on both pages.
- Modal summary + missing list are correct against a known collection vs. a known deck.
- "Buy missing on YTG" closes the check modal and opens `BuyDeckModal` with only the missing
  cards (no double-exclusion, correct z-index).
- Visual pass: mobile bottom-sheet and desktop layouts match existing modal conventions in light
  and dark mode.

## Out of Scope

- Inline per-card owned/missing highlighting on the deck list (Q1 chose the modal).
- Changing `BuyDeckModal`'s matching from `name|set` to name-only.
- Any new server action — owned-by-name is derived client-side from already-loaded collection state.
