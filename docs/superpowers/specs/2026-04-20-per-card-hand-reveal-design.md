# Per-Card Hand Reveal (30s) — Design

**Date:** 2026-04-20
**Status:** Approved for implementation planning
**Scope:** Goldfish (`app/goldfish/`) and Multiplayer (`app/play/`) modes

## Summary

Add a right-click action on a card in the local player's hand that temporarily reveals that single card's face to everyone else (opponent and spectators) for 30 seconds. The action is per-card and auto-expiring; it does not persistently flip the card. Distinct from the existing whole-hand reveal toggle and from `flipCard` (persistent face-down/face-up).

## User Experience

- Right-clicking a card in your hand opens the existing `CardContextMenu` with a new entry: **"Reveal for 30s"**.
- Clicking the entry reveals the card's face to opponents/spectators for 30 seconds.
- Your own hand view shows a subtle badge/border on the card plus a countdown (`0:30 → 0:00`).
- Opponent/spectator views render the card face-up in the hand area until the timer expires, then it reverts to face-down.
- Clicking "Reveal for 30s" again while the card is already revealed resets the timer to 30 seconds.
- When the card leaves the hand (play, discard, shuffle into deck, etc.) during the reveal, the reveal is cleared immediately.

### Menu visibility rules

The "Reveal for 30s" entry is shown only when:

- `card.zone === 'hand'`
- The card is owned by the local player (`ownerId === 'player1'` in goldfish; identity match in multiplayer)
- `isHandRevealed === false` (suppressed when the whole hand is already publicly revealed — redundant)

If the whole hand becomes revealed *after* a per-card reveal starts, the per-card countdown continues to display on the owner's side until it expires. Opponent-side rendering is unaffected because the full hand is already face-up.

## State Model

### Shared type change

Add a field to `GameCard` (`app/goldfish/types.ts`):

```ts
/** Unix ms epoch when this card's temporary reveal expires.
 *  Cleared when the card leaves its current zone. A card is "currently
 *  revealed" iff revealUntil !== undefined && revealUntil > Date.now(). */
revealUntil?: number;
```

### Why a timestamp, not a boolean + timer

Multiplayer has multiple clients with independent wall clocks. Storing an absolute expiry timestamp:

- Requires no server-side cleanup (the field is just "stale data" past its expiry; clients ignore it).
- Avoids drift — every client computes remaining time from the same authoritative value.
- Survives reconnection — a client joining mid-reveal sees the same countdown.

Clients drive re-render via a 1-second `setInterval` that runs while any visible card has an active `revealUntil`.

## Action Surface

Add one method to `GameActions` (`app/shared/types/gameActions.ts`):

```ts
revealCardInHand(cardId: string): void;
```

The duration (30000 ms) is a constant inside each implementation; the caller doesn't pass it. This keeps callers simple and means future changes to the duration are single-file.

## Goldfish Implementation

### Reducer action

New action in `app/goldfish/state/gameReducer.ts`:

```ts
{ type: 'REVEAL_CARD_IN_HAND'; cardId: string; revealUntil: number }
```

The reducer stays pure — the action creator reads `Date.now()` and passes `revealUntil` in. The reducer sets `revealUntil` on the matching card in the hand zone.

### Lifecycle clears

Every existing reducer action that moves a card out of the hand zone must clear `revealUntil` when writing the card into its new zone. This includes at minimum:

- `MOVE_CARD` (when source zone is hand)
- `SHUFFLE_CARD_INTO_DECK`
- `MOVE_CARD_TO_TOP_OF_DECK` / `MOVE_CARD_TO_BOTTOM_OF_DECK`
- Random-from-hand actions used by `HandContextMenu`
- Any other action that writes a card to a non-hand zone

The implementation plan will enumerate these exactly by reading the reducer.

### Action creator

A thin wrapper in the goldfish action layer calls `dispatch({ type: 'REVEAL_CARD_IN_HAND', cardId, revealUntil: Date.now() + 30_000 })`.

## Multiplayer Implementation

### SpacetimeDB schema

Add a column to the card row in `spacetimedb/src/schema.ts`:

```ts
reveal_expires_at: t.u64().optional()  // ms epoch
```

### New reducer

In `spacetimedb/src/index.ts`:

```ts
reveal_card_in_hand(ctx, card_id: string, duration_ms: u64)
```

Validates:

- Card exists.
- Card is owned by the calling identity.
- Card is currently in the `hand` zone.

Sets `reveal_expires_at = ctx.timestamp_ms + duration_ms`. No further bookkeeping — expiry is implicit via timestamp comparison on clients.

### Move reducer audit

Every existing reducer that moves a card out of hand must clear `reveal_expires_at = undefined`. The implementation plan will enumerate these by grepping for hand-source moves.

### Client wiring

`app/play/` `GameActions` impl calls the new reducer with `duration_ms = 30_000`. Passes `card.instanceId` through the existing bindings (regenerated via the `spacetimedb-deploy` skill after schema change).

### Deploy step

Because this touches `schema.ts` and `index.ts`, follow the `spacetimedb-deploy` skill: publish the module, regenerate TypeScript bindings. Client code that reads the new field will use the regenerated types.

## Rendering

### `CardContextMenu.tsx`

New entry rendered conditionally per the visibility rules above. Sits near `flipCard` (visually related). Label is static: **"Reveal for 30s"**.

### `GameCardNode.tsx`

Two behaviors driven by `revealUntil`:

1. **Owner view (own hand):** a small badge + border accent and a countdown text (`0:28`) overlayed on the card. Countdown recomputes each tick from `revealUntil - Date.now()`.
2. **Remote view (opponent/spectator hand):** when `revealUntil > Date.now()`, render the card face-up regardless of the normal face-down hand rule. When the timer lapses, normal rendering resumes automatically on the next tick.

### Ticking

A lightweight hook (`useRevealTick`) in the hand/game container runs a 1-second interval while `zones.hand.some(c => c.revealUntil && c.revealUntil > Date.now())` or the opponent-side equivalent. Forces re-render; no state update payload needed. Interval clears when no active reveals remain.

## Edge Cases (consolidated)

| Case | Behavior |
|------|----------|
| Card leaves hand during reveal | `revealUntil` cleared by the move action; reveal disappears for all clients. |
| Re-click "Reveal for 30s" while active | Timer resets to 30s (new `revealUntil`). |
| Whole hand revealed while per-card reveal active | Owner-side countdown continues; opponent side already sees the card face-up. |
| Whole hand revealed before per-card reveal triggered | Per-card menu entry is hidden (no-op redundancy). |
| Clock skew between clients (multiplayer) | Each client uses its own clock; worst-case drift is a few seconds of off-by difference in when the card flips back. Acceptable. |
| Client disconnects and reconnects mid-reveal | Reads the current `reveal_expires_at` from the server; countdown resumes correctly. |

## Files Touched

- `app/shared/types/gameActions.ts` — add `revealCardInHand`
- `app/shared/components/CardContextMenu.tsx` — new menu entry, visibility rules
- `app/shared/components/GameCardNode.tsx` — badge + countdown (owner), face-up override (remote)
- `app/goldfish/types.ts` — `revealUntil` on `GameCard`
- `app/goldfish/state/gameReducer.ts` — new action + lifecycle clears on move actions
- `app/goldfish/` action layer — `revealCardInHand` creator that supplies `Date.now() + 30_000`
- `app/play/` — wire `revealCardInHand` to the SpacetimeDB reducer call; map `reveal_expires_at` → `revealUntil` in the normalization layer that turns spacetime rows into `GameCard` so the shared renderer works without branching
- `spacetimedb/src/schema.ts` — `reveal_expires_at` column on the card row
- `spacetimedb/src/index.ts` — `reveal_card_in_hand` reducer + clears in move reducers
- Regenerated SpacetimeDB client bindings

## Testing

### Goldfish (manual smoke)

1. Right-click a hand card → "Reveal for 30s" appears in menu.
2. Click → card shows badge + countdown; countdown ticks down.
3. At 0, badge disappears; card is unchanged in hand.
4. Re-click mid-reveal → timer resets to 30s.
5. Move the card (play to territory) mid-reveal → badge disappears immediately.
6. Toggle full hand reveal → per-card menu entry is hidden on other hand cards.

### Multiplayer (two browser tabs)

1. Player A reveals a hand card → Player B sees the card face-up in A's hand.
2. Countdown on A's side matches roughly the time until B's card flips back.
3. A plays the card early → B's view flips it back immediately.
4. A reveals a card, reloads their tab → reveal badge still present with correct remaining time.
5. Player B attempts to call the reducer for one of A's cards → server rejects (ownership check).

## Non-Goals

- Multi-select reveal ("reveal 3 cards at once"). Single card only.
- Configurable duration. Hardcoded 30s.
- Revealing cards in zones other than hand. Only hand.
- Revealing cards in the opponent's hand. Owner-only.
- Reveal history / log entries. Ephemeral only.
