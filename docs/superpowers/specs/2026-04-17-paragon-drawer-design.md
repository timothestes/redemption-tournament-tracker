# Paragon Drawer Design

**Date:** 2026-04-17
**Status:** Approved, ready for implementation plan
**Scope:** Goldfish mode + multiplayer (`app/play`)

## Summary

Replace the sidebar "Paragon" zone in goldfish and multiplayer with a toggleable bottom drawer that shows the paragon card at its native landscape aspect. The drawer is available whenever `format === "Paragon"`, hidden otherwise. In multiplayer, a tab row lets any player view any other player's paragon (paragons are public info).

## Motivation

- The paragon card is wide (1.4:1 landscape) and doesn't fit naturally in the portrait-shaped sidebar pile slots.
- A bottom drawer gives the card proper real estate when the player wants to reference it, and reclaims sidebar space (6 → 5 zones) the rest of the time.
- A single shared component serves both solo goldfish and multiplayer, and is forward-compatible with 3+ player games.

## Non-goals

- Card metadata panel, deck notes, or any content beyond the card image.
- Syncing drawer open/closed state between players.
- AI opponent or any rules-enforcement changes.
- Mobile-specific simplified view beyond what falls out of CSS responsive sizing.

## Architecture

### Data model

- **Goldfish:** `GameState.paragonName: string | null` — already exists; drawer reads it directly.
- **Multiplayer:** Needs a new `paragon: string` field on the `Player` row in SpacetimeDB so each player's paragon name is visible to the other player. The `paragon` value already flows through `GameParams` from the deck picker — it just isn't persisted to the player row yet. The existing `paragon` zone on the `cards` table stays (unused for now); no card instances are created there.
- The `zones.paragon` array (goldfish) and `myCards.paragon` / `opponentCards.paragon` (multiplayer) are not used by the drawer. The paragon is a **name reference**, not a card instance.

### SpacetimeDB change required

- **Schema:** add `paragon: t.string()` to `Player` table ([spacetimedb/src/schema.ts](spacetimedb/src/schema.ts)).
- **Reducers:** the reducer(s) that create Player rows (game creation / join) must accept and store a `paragon` argument. `GameParams.paragon` already carries the value on the client.
- **Regenerate bindings and republish** per the spacetimedb-deploy skill (see `spacetimedb/CLAUDE.md`).

### New component and helper

- `app/shared/components/ParagonDrawer.tsx` — DOM overlay, not Konva.
- `app/shared/types/paragonEntry.ts` — shared `ParagonEntry` type.
- `app/shared/utils/paragonEntries.ts` — `buildParagonEntries(input) → ParagonEntry[]` helper with unit tests.

### Mount points

- `app/goldfish/[deckId]/client.tsx`
- `app/play/[code]/client.tsx`

### Layout changes

**`app/goldfish/layout/zoneLayout.ts`:**
- Remove the `isParagon` parameter.
- Sidebar is always 5 zones: Deck, Discard, Reserve, Banish, Land of Redemption.
- `paragonZone` is still emitted in the returned zones record but positioned off-screen (`-1000, -1000`), consistent with the current off-screen pattern used when `isParagon = false`.
- Update call sites to drop the `isParagon` argument.

**`app/play/layout/multiplayerLayout.ts`:**
- Remove the `isParagon` parameter.
- Both player sidebar pile columns are always 5 zones.
- Remove "Paragon" from `oppPileLabels` and the own-pile labels array; drop `paragon` from the `PileZone` type if no remaining consumer.
- `sidebar.player.paragon` / `sidebar.opponent.paragon` entries are removed; update call sites (`MultiplayerCanvas.tsx`) accordingly.

### New component

`app/shared/components/ParagonDrawer.tsx` — a DOM overlay, not a Konva layer. Mounted alongside the existing canvas in both:

- `app/goldfish/[deckId]/client.tsx`
- `app/play/[code]/client.tsx`

### Helper

```ts
// app/shared/types/paragonEntry.ts
export interface ParagonEntry {
  playerId: string;
  displayName: string;   // "You" for self, otherwise player displayName
  paragonName: string;   // e.g. "David" — used to build image URL
  imageUrl: string;      // /paragons/Paragon ${paragonName}.png
  isSelf: boolean;
}

// app/shared/utils/paragonEntries.ts
interface Input {
  players: Array<{ id: string; displayName: string; paragonName: string | null; isSelf: boolean }>;
}
export function buildParagonEntries(input: Input): ParagonEntry[];
```

- Filters out players with `paragonName === null`.
- Local player's `displayName` is replaced with `"You"` in the returned entry.
- Entries preserve input order.
- Pure function, unit-tested with vitest.

## ParagonDrawer component

### Visibility

- Rendered only when `format === "Paragon"`.
- Two visual states: closed (pull-tab) and open (full drawer with backdrop).

### Pull-tab (closed state)

- Anchored bottom-right corner of the viewport (bottom-left is used by chat in multiplayer).
- ~40px tall × ~140px wide.
- Label: "Paragon" plus a tiny (~32px tall × ~45px wide) landscape thumbnail of the current player's paragon card inside the tab — instantly recognizable without opening.
- Styled with existing goldfish aged-parchment / ochre tokens to match the toolbar.
- Click/tap → opens the drawer.

### Open state

- Slides up from the bottom with a dim backdrop over the play area (hand included).
- Paragon card rendered at its native landscape aspect (1.4:1):
  - Desktop: ~600px wide × ~430px tall, centered horizontally.
  - Mobile: `min(90vw, 600px)` wide, aspect ratio preserved.
- Image source: `/paragons/Paragon ${paragonName}.png` (served from `public/paragons/`).
- Close button in the top-right of the drawer.
- Closes on: backdrop click, `Esc`, `P` key, or close-button click.

### Multiplayer tab row

- Appears above the card **only when ≥2 players have paragons**.
- One tab per entry returned by `getParagonsByPlayer`, in player-seat order.
- Local player's tab labeled "You"; others labeled by their display name.
- Active tab highlighted with the goldfish gold accent.
- Clicking a tab swaps the card image to that player's paragon.
- Default active tab on open: "You" (the local player).
- If the tab row gets cramped at 4+ players, it wraps to a second row (deferred refinement; single-row with wrap is adequate for 2-4 players).

### Local state only

- Drawer open/closed state and active tab live in `useState` inside the component.
- Not synced to spacetimedb — viewing the paragon is a private, view-only action.
- Paragons are public information per Redemption rules, so peeking at an opponent's paragon has no game-state implications.

## Keyboard shortcuts

- `P` — toggles the drawer open/closed.
- `Esc` — closes the drawer.
- Handled by a local `keydown` listener inside `ParagonDrawer.tsx` (the component owns its open state, so the listener lives with the component rather than threading a callback through `useGameHotkeys`). The listener ignores keys typed into `<input>`, `<textarea>`, and `contentEditable` elements, matching the existing pattern in `useGameHotkeys.ts`.

## Edge cases

- **Non-paragon format:** drawer and pull-tab do not render at all.
- **Paragon format but no paragon card in state:** pull-tab renders without the thumbnail; opening the drawer shows an empty-state message ("No paragon selected"). This is an unexpected state but should not crash.
- **Opponent hasn't joined yet (multiplayer):** tab row shows only "You" until opponent seat is filled and their paragon card syncs in.
- **Mid-game paragon zone mutation:** the drawer re-reads from zone state on every render, so any future "move to paragon" action continues to work.

## Testing

Manual:
- Goldfish solo: open a paragon-format deck, toggle drawer with `P`, verify card shows correctly at landscape aspect.
- Goldfish non-paragon deck: verify no pull-tab appears.
- Multiplayer paragon-vs-paragon: both players can open drawer, tabs show "You" and opponent's name, switching tabs swaps the card.
- Multiplayer paragon-vs-T1: drawer appears only for the paragon player; tab row hidden (only 1 paragon).
- Mobile (narrow viewport): verify the open drawer fits within 90vw and the landscape aspect is preserved.
- Keyboard: `P` toggles, `Esc` closes, backdrop click closes.
- Sidebar zones: confirm all 5 pile slots (Deck, Discard, Reserve, Banish, LOR) render with the slightly taller slot height and no paragon slot appears.

## File inventory

### New files
- `app/shared/components/ParagonDrawer.tsx`
- `app/shared/types/paragonEntry.ts`
- `app/shared/utils/paragonEntries.ts`
- `app/shared/utils/__tests__/paragonEntries.test.ts`

### Modified files
- `spacetimedb/src/schema.ts` — add `paragon: t.string()` to `Player` table
- `spacetimedb/src/index.ts` — update reducers that create Player rows to accept `paragon` arg
- `app/goldfish/layout/zoneLayout.ts` — remove `isParagon` param, always 5 sidebar zones
- `app/goldfish/components/GoldfishCanvas.tsx` — drop `isParagon` arg and paragon entries from zone order lists
- `app/goldfish/[deckId]/client.tsx` — mount `<ParagonDrawer />`
- `app/play/layout/multiplayerLayout.ts` — remove `isParagon` param, drop "Paragon" from pile labels
- `app/play/components/MultiplayerCanvas.tsx` — drop `isParagon` arg; drop `sidebar.*.paragon` references
- `app/play/[code]/client.tsx` — mount `<ParagonDrawer />`, pass paragon name when creating/joining game
- `app/play/components/GameLobby.tsx` — pass paragon name into reducer calls (already in `GameParams`)

### Unchanged
- `app/goldfish/types.ts` — zone record still includes `paragon` (stays, off-screen)
- `app/goldfish/state/gameInitializer.ts` — no change needed (`paragonName` already on state)
- `app/goldfish/hooks/useKeyboardShortcuts.ts` — the `P` binding lives in the shared `useGameHotkeys`, which goldfish already wires through
