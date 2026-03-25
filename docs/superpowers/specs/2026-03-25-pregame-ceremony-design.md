# Pre-Game Ceremony: Ready Up, Dice Roll, First-Player Choice

**Date:** 2026-03-25
**Status:** Draft

## Overview

Replace the current "creator always goes first" behavior with a proper pre-game ceremony: both players ready up, the server rolls dice to pick a winner, and the winner chooses who takes the first turn. Players can also switch decks before readying up.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| First-player mechanic | Roll winner **chooses** who goes first | Matches real Redemption table play |
| Roll mechanic | Server-picked d20 for each seat, no ties possible (re-rolls internally) | Reuses existing seeded RNG; no client coordination needed |
| Deck locking | Locked on ready; un-ready to swap | Clean mental model, prevents delay griefing |
| Opponent deck visibility | Private — only "Ready" / "Not Ready" shown | Competitive integrity |
| Tie handling | Server re-rolls internally until someone wins | No UX for ties needed |
| Disconnect during pregame | Cancel game immediately | No state worth preserving yet |

## State Machine

```
waiting → pregame → playing → finished
             │
             ├─ deck_select   (swap decks, click ready)
             ├─ rolling        (server rolled, clients animate)
             └─ choosing       (roll winner picks who goes first)
```

The `join_game` reducer transitions the game from `waiting` to `pregame` with `pregamePhase: 'deck_select'`. Cards are NOT loaded until the game starts.

## Schema Changes

### Game Table — New Fields

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `pregamePhase` | `t.string()` | `""` | `""` / `"deck_select"` / `"rolling"` / `"choosing"` |
| `pregameReady0` | `t.bool()` | `false` | Seat 0 ready status (reused for roll acknowledgment) |
| `pregameReady1` | `t.bool()` | `false` | Seat 1 ready status (reused for roll acknowledgment) |
| `rollWinner` | `t.string()` | `""` | `""` (unset) / `"0"` / `"1"` — seat of the roll winner. String to avoid ambiguity with seat 0 default. Only read when `pregamePhase === 'choosing'`. |
| `rollResult0` | `t.u64()` | `0n` | Die result for seat 0 (1-20, for display) |
| `rollResult1` | `t.u64()` | `0n` | Die result for seat 1 (1-20, for display) |

> **Note:** `rollWinner` uses `t.string()` instead of `t.u64()` because a `0n` default would be indistinguishable from "seat 0 won." The empty string `""` is a clear sentinel for "no roll yet."

### Player Table — New Fields

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `pendingDeckData` | `t.string()` | `""` | JSON deck data stored until game starts; cleared after `insertCardsShuffleDraw` |

> **Note:** `pendingDeckData` is set in the `Player.insert()` call in both `create_game` and `join_game` (not as a subsequent update). Add `pendingDeckData: deckData` to the insert object.

### Index Convention

The existing codebase uses `accessor` (not `name`) as the key for index definitions. Any new indexes must follow this pattern:
```typescript
indexes: [{ accessor: 'some_index_name', algorithm: 'btree' as const, columns: ['someCol'] }]
```
No new indexes are needed for this feature — all queries use existing indexes on `gameId` and primary keys.

## New Reducers

### `pregame_ready`

**Params:** `{ gameId: t.u64(), ready: t.bool() }`

- Validates `game.status === 'pregame'` and `game.pregamePhase === 'deck_select'`
- Sets `pregameReady0` or `pregameReady1` based on sender's seat
- If un-readying (`ready: false`), just sets the flag and returns
- When BOTH are true after this call:
  - Creates a single PRNG instance: `const rng = xorshift64(makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, 0n, game.rngCounter))`
  - Rolls for seat 0: `Number(rng.next() % 20n) + 1`
  - Rolls for seat 1: `Number(rng.next() % 20n) + 1`
  - If tie, calls `rng.next()` twice again (loop until different results)
  - Increments `game.rngCounter` once after all rolls complete
  - Sets `rollResult0`, `rollResult1`, `rollWinner` (as string: `"0"` or `"1"`)
  - Resets `pregameReady0` and `pregameReady1` to `false` (reused for roll acknowledgment)
  - Sets `pregamePhase: 'rolling'`
  - Logs `PREGAME_ROLL` action with roll results

### `pregame_acknowledge_roll`

**Params:** `{ gameId: t.u64() }`

- Validates `game.status === 'pregame'` and `game.pregamePhase === 'rolling'`
- Sets sender's ready boolean to `true`
- When BOTH are true:
  - Sets `pregamePhase: 'choosing'`

### `pregame_choose_first`

**Params:** `{ gameId: t.u64(), chosenSeat: t.u64() }`

- Validates `game.status === 'pregame'` and `game.pregamePhase === 'choosing'`
- Validates sender's seat matches `game.rollWinner` (parsed from string: `BigInt(game.rollWinner)`) — only winner can choose
- Validates `chosenSeat` is 0 or 1
- For BOTH players:
  - Reads `player.pendingDeckData`
  - Validates `pendingDeckData` is non-empty and parseable as JSON array (throw `SenderError` if not)
  - Calls `insertCardsShuffleDraw(ctx, game, player, pendingDeckData)`
  - Clears `pendingDeckData` to `""`
- Updates game:
  - `status: 'playing'`
  - `pregamePhase: ''`
  - `currentTurn: chosenSeat`
  - `currentPhase: 'draw'`
  - `turnNumber: 1n`
- Logs `GAME_STARTED` action

### `pregame_change_deck`

**Params:** `{ gameId: t.u64(), deckId: t.string(), deckData: t.string() }`

- Validates `game.status === 'pregame'` and `game.pregamePhase === 'deck_select'`
- Validates sender is NOT ready (their ready flag is `false`)
- Validates `deckData` is parseable JSON array (throw `SenderError` if not)
- Updates sender's `Player` row: `deckId` and `pendingDeckData`
- Logs `PREGAME_DECK_CHANGE` action

## Changes to Existing Reducers

### `create_game`

- Still inserts `Game` row with `status: 'waiting'` (unchanged — game waits for opponent)
- Still inserts `Player` row with `seat: 0n`
- **No longer calls `insertCardsShuffleDraw`** — instead stores `deckData` in `player.pendingDeckData`
- New fields initialized: `pregamePhase: ''`, `pregameReady0: false`, `pregameReady1: false`, `rollWinner: ''`, `rollResult0: 0n`, `rollResult1: 0n`
- Sets `currentTurn: 0n` and `currentPhase: 'pregame'` at insert time — these are overwritten by `pregame_choose_first` when the game actually starts. Client code should NOT read `currentTurn` until `status === 'playing'`.

### `join_game`

- Inserts `Player` row with `seat: 1n`
- **No longer calls `insertCardsShuffleDraw`** — stores `deckData` in `player.pendingDeckData`
- **No longer sets `status: 'playing'`** — instead sets `status: 'pregame'`, `pregamePhase: 'deck_select'`
- Does NOT set `currentTurn` or `turnNumber` yet

### `clientDisconnected`

- Add check: if `game.status === 'pregame'`, set `status: 'finished'` immediately
- No timeout grace period — pregame has no state worth preserving

## Client-Side Changes

### New Lifecycle State

Add `'pregame'` to `LifecycleState` in `client.tsx`:

```typescript
type LifecycleState = 'creating' | 'joining' | 'waiting' | 'pregame' | 'playing' | 'finished' | 'error';
```

Lifecycle sync effect adds:
```typescript
if (game.status === 'pregame') setLifecycle('pregame');
```

### New Component: `PregameScreen`

Rendered when `lifecycle === 'pregame'`. Reads `game.pregamePhase` to render the appropriate sub-screen.

#### `deck_select` Phase

- Shows both player names (from Player table)
- Your section:
  - Current deck name displayed
  - "Change Deck" button → opens `DeckPickerModal` (reused from lobby)
  - "Ready" / "Un-ready" toggle button
  - If ready, "Change Deck" is disabled (must un-ready first)
- Opponent section:
  - Shows "Selecting deck..." or "Ready" (based on their ready boolean)
  - No deck details shown (private)
- When "Change Deck" is clicked:
  - Opens `DeckPickerModal` with same search/filter UI as lobby (My Decks / Community tabs)
  - On selection, calls `loadDeckForGame(newDeckId)` server action to get expanded cards
  - Calls `conn.reducers.pregameChangeDeck({ gameId, deckId, deckData })`
- When "Ready" is clicked:
  - Calls `conn.reducers.pregameReady({ gameId, ready: true })`

#### `rolling` Phase

- Animated dice display showing both d20 results (visual style from existing `DiceOverlay`)
- Both dice animate simultaneously, then reveal results
- Announces: "{Winner name} wins the roll!"
- "Continue" button for each player → calls `conn.reducers.pregameAcknowledgeRoll({ gameId })`
- Shows waiting indicator for the other player after you acknowledge

#### `choosing` Phase

- **If you're the roll winner:**
  - "You won the roll! Who goes first?"
  - Two buttons: "I'll go first" / "{Opponent name} goes first"
  - Clicking calls `conn.reducers.pregameChooseFirst({ gameId, chosenSeat })`
- **If you're NOT the winner:**
  - "{Winner name} is choosing who goes first..."
  - Waiting indicator

### Deck Picker Integration

The existing `DeckPickerModal` from `app/play/components/DeckPickerModal.tsx` is reused directly. It already supports:
- "My Decks" tab with local search
- "Community" tab with debounced search, format filter, sort options
- Pagination (12 per page)
- Deck preview cards with images

The pregame screen imports and renders it with an `onSelect` callback that triggers the deck change reducer.

The `loadDeckForGame` server action in `app/play/actions.ts` is also reused to expand deck quantities into individual card entries.

### Spectator View

Spectators joining during pregame see a read-only version:
- "Players are preparing..."
- Player A: "Ready" / "Selecting deck..."
- Player B: "Ready" / "Selecting deck..."
- During rolling: watch the dice animation
- During choosing: "Waiting for {winner} to choose..."

### `useGameState` Hook — New Methods

Add these methods to the `GameState` interface, following the existing pattern of wrapping reducer calls:

```typescript
pregameReady: (ready: boolean) => void;
pregameAcknowledgeRoll: () => void;
pregameChooseFirst: (chosenSeat: bigint) => void;
pregameChangeDeck: (deckId: string, deckData: string) => void;
```

Each wraps the corresponding `conn.reducers.*` call with the current `gameId`.

### Reconnect During Pregame

If a player refreshes during pregame, the `GameInner` component remounts with `didCallReducer.current = false`. The existing effect at lines 278-327 would try to call `createGame`/`joinGame` again, which would fail (game already exists).

**Fix:** Before calling `createGame`/`joinGame`, check if a game with this code already exists in subscription data and the player is already in it. If so, skip the reducer call and just sync lifecycle from the existing game state. This check goes in the existing `useEffect` that calls reducers:

```typescript
// If game already exists (reconnect scenario), skip reducer call
const existingGame = allGames?.find(g => g.code === code);
if (existingGame) {
  setGameId(existingGame.id);
  didCallReducer.current = true;
  return; // lifecycle sync effect will handle the rest
}
```

### Deck Data for `DeckPickerModal` During Pregame

The `DeckPickerModal` requires a `myDecks` prop. During pregame, this data is not available from the page-level fetch (which happened on the `/play` lobby page).

**Solution:** The `PregameScreen` component calls `loadUserDecks()` (a new lightweight server action or reuses existing deck-fetching logic from the lobby page) on mount to populate the "My Decks" tab. The "Community" tab already fetches on-demand via `loadPublicDecksAction()`. Store the deck list in local state within `PregameScreen`.

### Action Logging

New action types logged during pregame:

| Action Type | When | Payload |
|-------------|------|---------|
| `PREGAME_READY` | Player readies/un-readies | `{ seat, ready }` |
| `PREGAME_ROLL` | Both ready, dice rolled | `{ result0, result1, winner }` |
| `PREGAME_DECK_CHANGE` | Player swaps deck | `{ seat, newDeckId }` |
| `GAME_STARTED` | First-player chosen, game begins | `{ chosenSeat, chosenBy }` |

## File Changes Summary

| File | Change |
|------|--------|
| `spacetimedb/src/schema.ts` | Add 6 fields to Game, 1 field to Player |
| `spacetimedb/src/index.ts` | Add 4 new reducers, modify `create_game`, `join_game`, `clientDisconnected` |
| `app/play/[code]/client.tsx` | Add `'pregame'` lifecycle, render `PregameScreen` |
| `app/play/components/PregameScreen.tsx` | **New file** — pregame ceremony UI |
| `app/play/hooks/useGameState.ts` | Expose new game fields, add pregame action methods |
| Client bindings | Regenerate after schema changes |

## Edge Cases

- **Both players ready at exact same time:** Server handles atomically — both flags set, roll happens once
- **Player disconnects mid-roll animation:** `clientDisconnected` cancels the game
- **Roll winner takes too long to choose:** No timeout for now — the UI makes it a simple binary choice. Consider adding a 60s timeout in a future iteration.
- **Player tries to change deck while ready:** Reducer rejects with `SenderError` — must un-ready first
- **Spectator joins during pregame:** Sees read-only ceremony view. Spectators can also join during `waiting` (before second player) — they see the waiting screen like normal.
- **Player refreshes during pregame:** Reconnects via SpacetimeDB, subscription restores game state. Client detects existing game and skips reducer call (see "Reconnect During Pregame" section). Pregame screen re-renders at current phase.
- **Empty or malformed `pendingDeckData`:** `pregame_choose_first` validates both players' deck data is non-empty and parseable before starting. Throws `SenderError` if invalid.
- **Dice tie:** Server re-rolls using the same PRNG instance (no new seed needed) until results differ. Tie handling is invisible to clients — they only see the final winning results.
