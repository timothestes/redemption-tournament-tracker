# Consent-Based Opponent Zone Search

**Date:** 2026-03-25
**Status:** Draft

## Overview

Players need the ability to search an opponent's deck, hand, and reserve during play (triggered by card effects like "look at opponent's hand" or "search opponent's deck and discard a card"). This requires a consent flow — the opponent must approve the request before their zone is revealed. Once approved, the requesting player can browse the zone, take actions on cards (discard, banish, move to deck positions), and drag cards to any zone on the canvas.

## Current State

- Client already receives full opponent card data via SpacetimeDB subscription (Level 1 visibility)
- Opponent sidebar zones (discard, reserve, banish, L.O.R.) are already browsable via click (inline grid)
- Opponent deck and hand are NOT browsable — deck is excluded from click handler, hand shows only card backs
- No consent/request mechanism exists
- The existing `move_card` reducer allows either player to move any card (sandbox mode) — consent is a UX gate, not server-enforced

## Flow

1. **Player A** right-clicks opponent's deck, hand, or reserve pile → context menu shows "Search [Zone]"
2. SpacetimeDB reducer `request_zone_search` creates a `ZoneSearchRequest` row with status `pending`
3. **Player B** sees a blocking modal dialog: "[Player A] wants to search your [Zone]. Allow / Deny?"
   - Implemented as an overlay `<div>` with no backdrop dismiss (same pattern as `browseOpponentZone` overlay but without click-to-close)
4. **If Player B allows:** reducer `approve_zone_search` updates status to `approved`. Player A's browse modal opens showing the opponent's zone cards with full search/filter and action buttons.
5. **If Player B denies:** reducer `deny_zone_search` updates status to `denied`. Player A gets a toast: "Request denied."
6. **When Player A closes** the browse modal: reducer `complete_zone_search` updates status to `completed` and deletes the request row (cleanup).

## SpacetimeDB Changes

### New Table: `ZoneSearchRequest`

```
ZoneSearchRequest {
  id: u64 (auto-increment)
  gameId: u64
  requesterId: u64 (player row ID, matches Player.id)
  targetPlayerId: u64 (player row ID, matches Player.id)
  zone: String ("deck" | "hand" | "reserve")
  status: String ("pending" | "approved" | "denied" | "completed")
  createdAt: u64 (timestamp)
}
```

Note: Uses `u64` player row IDs (not `Identity`) to match the existing codebase convention (`CardInstance.ownerId`, `GameAction.playerId`).

### New Reducers

- `request_zone_search(gameId, zone)` — creates a pending request. Validates: game exists, caller is a player in the game, zone is one of deck/hand/reserve, no other pending request exists from the same requester.
- `approve_zone_search(requestId)` — sets status to `approved`. Validates: caller is the target player, request is pending.
- `deny_zone_search(requestId)` — sets status to `denied`. Validates: caller is the target player, request is pending. Deletes the row after setting status (cleanup).
- `complete_zone_search(requestId)` — deletes the request row. Validates: caller is the requester, request is approved.
- `move_opponent_card(requestId, cardInstanceId, toZone, posX?, posY?)` — moves a card that belongs to the target player. Single reducer with `toZone` parameter (matches the existing `move_card` pattern). Validates: request is approved, card was originally in the requested zone (checked against `ZoneSearchRequest.zone`), caller is the requester. For "shuffle into deck" the client calls `move_opponent_card` to move the card to deck, then `shuffleDeck` is called on the opponent's deck (uses the existing seeded shuffle pattern from `utils.ts`).

**Note on enforcement:** The existing `move_card` reducer allows either player to move any card. `move_opponent_card` adds a consent validation layer for audit/logging purposes, but a malicious client could bypass it via `move_card`. This is consistent with the Level 1 sandbox trust model. True enforcement requires Level 2 server-side visibility (out of scope).

## UI Components

### 1. Opponent Zone Context Menu

Right-click on opponent's deck, hand, or reserve pile shows a context menu with "Search [Zone]" option.

**Trigger points:**
- **Opponent sidebar piles** (deck, reserve): Add `onContextMenu` handler to the opponent sidebar pile `<Group>` elements in MultiplayerCanvas, matching the pattern used for player sidebar piles.
- **Opponent hand**: The opponent hand currently renders bare `<CardBackShape>` elements with no event handlers. Add a wrapping `<Group>` around the opponent hand area with an `onContextMenu` handler.

**Behavior:** On click "Search [Zone]", calls `request_zone_search` reducer and shows a toast: "Waiting for opponent to approve..."

### 2. Consent Dialog (Target Player)

An overlay on the target player's canvas. Cannot be dismissed without choosing Allow or Deny.

**Implementation:** Render as an absolute-positioned `<div>` overlay (z-index 800, above context menus) with a semi-transparent backdrop. No `onClick` dismiss on backdrop — only the Allow/Deny buttons close it.

**Content:**
- Header: "Zone Search Request"
- Body: "[Player name] wants to search your [Zone]."
- Buttons: "Allow" (calls `approve_zone_search`) / "Deny" (calls `deny_zone_search`)

**Styling:** Goldfish theme variables (dark background, gold accent, Cinzel font). Centered on canvas.

### 3. Opponent Zone Browse Modal (Requesting Player)

A new `OpponentBrowseModal` component showing the opponent's zone cards. Receives opponent cards as props (NOT via `useModalGame()` — that context only has local player cards).

**Features:**
- Card grid with search/filter (name, type, brigade, alignment)
- Hover preview (card loupe)
- Multi-select support

**Button actions** (move opponent's card within opponent's zones):

| Action | Moves card to... |
|--------|-----------------|
| Discard | Opponent's discard pile |
| Banish | Opponent's banish pile |
| Top of Deck | Top of opponent's deck |
| Bottom of Deck | Bottom of opponent's deck |
| Shuffle into Deck | Opponent's deck (shuffled) |

All button actions call `move_opponent_card(requestId, cardId, toZone)`.

**Drag-out:** Dragging a card from the modal to the canvas drops it into **any zone** on the canvas.

### Drag-Out Implementation

The existing `useModalCardDrag` hook's `findZoneAtPosition` param is typed as `(x, y) => ZoneId | null`. MultiplayerCanvas's internal `findZoneAtPosition` returns `{ zone, owner } | null`. For the opponent browse modal, we need drag to target any zone (player or opponent).

**Approach:** Create a second `useModalCardDrag` instance for the opponent browse modal that:
- Uses the full zone layout (both `myZones` and `opponentZones` merged)
- Has a `findZoneAtPosition` wrapper that resolves to any zone (not filtered to `my` only)
- Calls `move_opponent_card` reducer instead of the regular `moveCard`

```typescript
const findZoneForOpponentDrag = useCallback((x: number, y: number): ZoneId | null => {
  const hit = findZoneAtPosition(x, y);
  if (!hit) return null;
  return hit.zone as ZoneId;
}, [findZoneAtPosition]);

const opponentModalDrag = useModalCardDrag({
  stageRef,
  zoneLayout: { ...myZones, ...opponentZones } as Partial<Record<ZoneId, ZoneRect>>,
  findZoneAtPosition: findZoneForOpponentDrag,
  moveCard: (id, toZone, _idx, posX, posY) =>
    gameState.moveOpponentCard(approvedRequestId, BigInt(id), String(toZone), posX?.toString(), posY?.toString()),
  moveCardsBatch: (ids, toZone) => { /* move each individually via move_opponent_card */ },
  cardWidth,
  cardHeight,
});
```

### 4. Request State Subscription

Both players subscribe to `ZoneSearchRequest` rows for their game. The client watches for:
- **Requester side:** status changes from `pending` → `approved` (open browse modal) or `pending` → `denied` (show toast)
- **Target side:** new rows with status `pending` (show consent dialog)

## Files Changed

| File | Change |
|------|--------|
| `spacetimedb/src/schema.ts` | Add `ZoneSearchRequest` table + register in schema export |
| `spacetimedb/src/index.ts` | Add 5 new reducers (request/approve/deny/complete + move_opponent_card) |
| `app/play/[code]/client.tsx` | Add `zone_search_request` to subscription SQL list |
| `app/play/hooks/useGameState.ts` | Subscribe to `ZoneSearchRequest` via `useTable`, expose pending/approved requests + action methods |
| `app/play/components/MultiplayerCanvas.tsx` | Add opponent zone right-click handlers (sidebar piles + hand group wrapper), consent dialog rendering, opponent browse modal state, request management |
| `app/shared/components/OpponentZoneContextMenu.tsx` | **NEW** — right-click menu for opponent zones ("Search [Zone]") |
| `app/shared/components/ConsentDialog.tsx` | **NEW** — blocking modal for zone search approval |
| `app/shared/components/OpponentBrowseModal.tsx` | **NEW** — browse modal with opponent-specific actions + drag |

## Out of Scope

- Server-side card visibility (Level 2) — currently all data is public, consent is a UX gate
- Auto-detecting card effects that trigger zone search (manual right-click only)
- Searching opponent's banish, discard, or L.O.R. (these are already visible/browsable)
- Server-side enforcement of consent (existing `move_card` allows any player to move any card)

## Success Criteria

- Right-click opponent deck/hand/reserve shows "Search [Zone]" option
- Opponent sees consent dialog and can Allow/Deny
- On Allow, requester sees full browse modal with search, filter, actions, and drag
- Button actions (Discard, Banish, etc.) move cards within opponent's zones
- Drag-out moves cards to any zone on the canvas (player or opponent)
- On Deny, requester sees "Request denied" toast
- Closing the modal completes and cleans up the request
- Multiple concurrent requests are prevented (one at a time per requester)
