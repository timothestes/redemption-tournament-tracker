# Collection Tracker — Design

**Date:** 2026-06-10
**Status:** Approved for implementation (user delegated decisions)

## Summary

A per-user card collection tracker at `/collection`, powered by the same client-side card
catalog and filter UI as the deck builder. Logged-in users browse every Redemption card,
set owned quantities inline, view set-completion stats, import/export CSV, and — the killer
integration — exclude owned cards when building a YTG cart from a deck.

## Decision: NOT a decklist type

Collections get their own table instead of reusing `decks`/`deck_cards` with a
`type: 'collection'` flag. Rationale:

- A collection is a **singleton per user**, not one of many named documents. Folders,
  visibility, tags, format, legality checking, preview cards — none of it applies.
- **Write patterns differ.** Decks save via atomic full-replace (`replace_deck_cards` RPC),
  fine for ≤300 rows. A collection with thousands of rows edited one card at a time needs
  incremental per-card upserts, not full replaces.
- Keeping collection rows out of `deck_cards` keeps community/my-decks queries and the
  deck-count/price RPCs from scanning unrelated bulk data.

## Data model

```sql
CREATE TABLE collection_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_name text NOT NULL,
  card_set text NOT NULL,
  card_img_file text NOT NULL DEFAULT '',
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, card_name, card_set, card_img_file)
);
CREATE INDEX idx_collection_cards_user_id ON collection_cards (user_id);
```

- Identity matches the app-wide card key `name|set|imgFile` (same as `CARD_BY_FULL_KEY`
  and `card_price_mappings.card_key`), so alt-art printings are tracked separately and
  YTG price lookups line up exactly.
- `quantity > 0` invariant: setting a card to 0 deletes the row.
- RLS: all four operations gated on `auth.uid() = user_id` (same pattern as `api_keys`).

### Scale / Postgres access patterns

The full Redemption catalog is ~6k unique printings, so a "complete" collection is ≤ ~7k
rows. Reads load the user's full collection in keyed batches of 1000 (same pagination
pattern as `loadDeckByIdAction` for cubes) into a client-side `Map<fullKey, quantity>` —
roughly 60 bytes/row, ≤ ~0.5 MB worst case. All browsing/filtering then happens client-side
against the already-bundled card catalog; Postgres is never queried per-filter.

Writes are incremental: one debounced upsert/delete per card edited (optimistic UI).
CSV import bulk-upserts in chunks of 500 rows with `ON CONFLICT` on the unique key.

## Routes & UI

`app/collection/page.tsx` — server component, render-based auth gate (same as
`my-decks/page.tsx`): signed-out users see a sign-in prompt.

`app/collection/client.tsx` — the tracker:

- **Search + filters**: text search box plus the reused `FilterGrid` (brigades, rarity,
  alignment, testament, legality, etc.) over `ALL_CARDS`, with the deck builder's
  incremental grid rendering (60/batch).
- **Quantity controls on every card**: owned-count badge, +/− steppers, and direct number
  entry. Cards owned get a visual treatment (ring/badge); unowned cards are slightly dimmed
  when "owned only" is off.
- **Owned-only toggle** to view just the collection.
- **Stats bar**: unique cards owned, total copies, and a **set completion panel**
  (owned-unique / total-unique per official set, computed client-side).
- **Export**: download CSV (`Quantity,Name,Set,ImgFile`) and copy-to-clipboard.
- **Import CSV modal**: flexible header matching (`quantity|qty|count`, `name|card`,
  `set`), resolution order exact name+set+imgFile → name+set → officialSet fallback →
  name-only (warning). Two modes: **Merge** (add quantities) and **Replace** (wipe then
  insert). Shows per-row errors/warnings before and after committing.

Mobile-first: steppers sized for touch, sticky stats bar, grid identical to deck builder.

## Server actions (`app/collection/actions.ts`)

- `loadCollectionAction()` → all rows, batched at 1000.
- `setCollectionCardQuantityAction(name, set, imgFile, quantity)` → upsert; 0 deletes.
- `bulkImportCollectionAction(rows, mode: 'merge' | 'replace')` → chunked upserts;
  replace mode deletes the user's rows first.
- `clearCollectionAction()`.
- `getOwnedQuantitiesAction(keys: {name, set}[])` → aggregate owned quantities for the
  YTG integration (sums across imgFile printings of the same name+set).

## YTG "exclude owned" integration

`BuyDeckModal` gains a **"Don't buy cards I already own"** checkbox (shown when signed in).
When checked, it fetches owned quantities for the deck's cards via
`getOwnedQuantitiesAction`, subtracts owned from needed per name+set (a deck card whose
owned count ≥ needed drops out entirely), and posts the remainder to the existing
`/api/ytg-cart` — no API changes. Excluded cards are listed in the modal so the user sees
why the cart shrank. Cross-set duplicate-group matching ("I own the K version of this L
card") is explicitly out of scope for v1; budget mode already covers substitution.

## Navigation

Add **My Collection** (`/collection`, authRequired, "new" badge) to the existing **Decks**
dropdown in `components/top-nav.tsx`, desktop and mobile. No larger nav reorg: the dropdown
already holds the user's card-inventory destinations (My Decks, Community Decks), and adding
one item is less disruptive than introducing a new top-level group on mobile.

## Out of scope (v1)

- Trade lists / want lists / condition & foil tracking (Redemption has no foils).
- Collection value estimation (prices exist; can be layered on later via `card_prices`).
- Deck-vs-collection "can I build this?" diffing beyond the YTG cart integration.
- Public/shared collections.

## Testing

- Unit tests for CSV parse/generate round-trip (mirrors `deckImportExport` test style).
- Manual verification: quantity edits persist across reload; import merge vs replace;
  YTG cart excludes owned; signed-out gate renders.
