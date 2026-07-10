# Sticky Print/Art Filters (AB + 1st Print K/L)

**Date:** 2026-07-10
**Status:** Approved design, pending implementation plan
**Surfaces:** Public deckbuilder (`/decklist/card-search`) and the Forge deck builder (both render the shared `CardSearchClient`)

## Problem

The card-search filters reset to hardcoded defaults every session. A user who prefers to
always see **AB (alternate art) versions** and **1st-print K/L starter variants** must re-enable
those two filters on every visit and after every filter reset. The preference should be
remembered ("sticky") across sessions per device, and a filter reset should restore the user's
remembered preference rather than snapping back to the hardcoded default.

Scope was deliberately narrowed (during brainstorming) to **two filters only**:

- **"No AB Versions"** — `noAltArt` ([`client.tsx:217`](../../../app/decklist/card-search/client.tsx))
- **"No 1st Print K/L Starters"** — `noFirstPrint` ([`client.tsx:218`](../../../app/decklist/card-search/client.tsx))

Legality mode (Rotation / Classic / "Unlimited") is **out of scope** for this change.

## Current State (as-is)

- Both filters are flat `useState` hooks in `app/decklist/card-search/client.tsx`, hardcoded to
  `true`. Semantics are **inverted**: `true` HIDES the cards. The user's desired state is
  `false` for both (show AB / show 1st-print K/L).
- Filter application:
  - `noAltArt` → `.filter((c) => !noAltArt || !c.set.includes("AB"))` (`client.tsx:1156`)
  - `noFirstPrint` → `.filter((c) => !noFirstPrint || (!c.set.includes("K1P") && !c.set.includes("L1P")))` (`client.tsx:1157-1159`)
- `handleResetFilters()` (`client.tsx:1384-1425`) currently forces both back to `true`
  (`client.tsx:1394-1395`). It already **preserves** `legalityMode` on reset
  (`client.tsx:1387-1388`) — the precedent this change extends to the two print filters.
- There is an **existing, broken** persistence attempt for `noAltArt` only:
  - Key `deck-filter-noab`, written on every change (`client.tsx:746-749`), but read only in
    browse mode. The init effect early-returns whenever a `deckId` is present
    (`client.tsx:658-661`). Because normal deck-editing and the **entire Forge** always carry a
    `deckId`, the saved value is written but **never applied while building a deck**.
- Both surfaces render the same `CardSearchClient`, so a single change covers both. The Forge
  config sets `syncFiltersToUrl: false` and `localStoragePersist: false`
  (`forgeBuilderConfig.tsx`), but the existing `deck-filter-noab` write is un-gated and already
  fires in the Forge, so localStorage persistence needs no feature flag.

## Design

### Behavior model: implicit "last-used"

No new "save as default" UI. The two toggles *are* their own preference: whatever the user last
set them to is persisted and seeds the initial value next session. Consequences:

- **First-time / never-touched users:** unchanged. Both still default to `true` (hide AB / hide
  1st-print). No behavior change for anyone who has never flipped them.
- **After flipping "No AB Versions" off:** it stays off across sessions and survives Reset, in
  both the public builder and the Forge.
- **Reset** restores these two filters to the saved preference (i.e. leaves them where the user
  set them) instead of forcing `true` — mirroring how `legalityMode` already behaves on reset.

### Storage

- Single namespaced localStorage key: `deck-sticky-filters`
- Value: JSON `{ "noAltArt": boolean, "noFirstPrint": boolean }`
- Read via lazy `useState` initializers, SSR-guarded (`typeof window !== "undefined"`), matching
  the established `app/shared/hooks/useCardScale.ts` pattern. Reading at initializer time (rather
  than in a post-mount effect) avoids a visible flicker from default→saved and makes the value
  correct on first render.
- Persist on change via a `useEffect` keyed on the two values.
- When no saved value exists, fall back to the current hardcoded default `true` for each key, so
  existing behavior is preserved for untouched users.

### Changes

1. **Seed initial state from storage.** Replace the hardcoded `useState(true)` initializers for
   `noAltArt` and `noFirstPrint` with lazy initializers that read `deck-sticky-filters` (SSR-safe,
   default `true` per key). Encapsulate in a small helper/hook (e.g. `useStickyFilters`) to keep
   `client.tsx` readable and the read/write logic in one place.
2. **Persist on change.** Single `useEffect` writes `{ noAltArt, noFirstPrint }` to
   `deck-sticky-filters`. Must run regardless of `deckId` (so it works in the Forge and in
   deck-editing).
3. **Fix reset.** In `handleResetFilters()`, remove the `setnoAltArt(true)` / `setnoFirstPrint(true)`
   lines and instead restore both from the saved preference (which, since they haven't changed,
   is effectively "leave as-is").
4. **Remove the old mechanism.** Delete the `deck-filter-noab` write effect (`client.tsx:746-749`)
   and its browse-only read (`client.tsx:715-716`) so there is exactly one persistence path.
   Optionally, one-time migrate an existing `deck-filter-noab` value into `deck-sticky-filters`
   for `noAltArt`.

### Data flow

```
localStorage["deck-sticky-filters"]
   │  (lazy useState init, SSR-guarded, default true per key)
   ▼
noAltArt / noFirstPrint state  ──►  filter useMemo (client.tsx:1156-1159)
   │
   ├─ on change ──► useEffect ──► write localStorage["deck-sticky-filters"]
   │
   └─ handleResetFilters() ──► restore from saved prefs (not hardcoded true)
```

## Edge Cases

- **Existing `deck-filter-noab` users:** users who previously toggled AB off in browse mode had
  the value saved but never applied in the builder. After this change the read runs regardless of
  deck mode, so their saved preference will now take effect in the builder too. This is the
  intended fix, but it is a **visible behavior change** for those specific users — call it out in
  the PR description.
- **SSR / hydration:** lazy initializers must guard `typeof window` and tolerate the server
  rendering the default (`true`) while the client hydrates to the saved value, consistent with
  how `useCardScale`/`useChatScale` already behave in this codebase.
- **Corrupt / non-JSON stored value:** parse defensively; on parse failure fall back to defaults
  and overwrite on next persist.
- **Paragon decks:** unaffected — this change touches only `noAltArt`/`noFirstPrint`, not
  `legalityMode` (which is auto-forced to Paragon for Paragon decks).

## Testing / Verification

- Toggle "No AB Versions" off in the public builder, reload the page → it stays off.
- Same in the Forge builder (has a `deckId`) → it stays off (proves the old `deckId` early-return
  bug is fixed).
- Click Reset with the preference set to "show AB" → AB stays shown (not re-hidden).
- Fresh browser / cleared localStorage → both default to `true` (hide), matching today's behavior.
- Repeat all four for "No 1st Print K/L Starters".
- Confirm no lingering writes to `deck-filter-noab`.

## Out of Scope

- Cross-device / account-level persistence (Supabase). Chosen storage is per-device localStorage;
  an account-synced version is a possible future follow-up.
- Making `legalityMode` (Rotation/Classic/"Unlimited") sticky.
- Any new settings UI or "save as default" control.
