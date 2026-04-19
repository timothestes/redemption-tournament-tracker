# Play Mode Features — Design Spec

**Date:** 2026-03-25
**Scope:** 3 independent features: hand context menu (random actions), mid-game deck swap, stale game cleanup

---

## Feature 1: Hand Zone Context Menu (Random Actions)

**Problem:** There's no way to randomly send cards from hand to other zones. In Redemption, card effects sometimes require random discards or random card movement. Currently, the hand zone has no right-click menu at all — only individual cards do.

### Design

**New component:** `HandContextMenu` — follows the same pattern as `DeckContextMenu` with nested submenus and quick-count buttons.

**Menu structure:**
```
Hand (N cards)
├── Random to Discard     [1] [3] [6] [X...]
├── Random to Reserve     [1] [3] [6] [X...]
├── Random to Deck Top    [1] [3] [6] [X...]
├── Random to Deck Bottom [1] [3] [6] [X...]
└── Shuffle Random into Deck [1] [3] [6] [X...]
```

Each row has quick-count buttons (1, 3, 6) and an expandable custom stepper (X) — identical to the `DeckContextMenu` submenu pattern.

**Wiring in MultiplayerCanvas:**
- Add `onContextMenu` handler to the hand zone background `<Rect>` (the hand zone rect at `myHandRect`)
- New state: `handMenu: { x: number; y: number } | null`
- Right-clicking the hand zone background (not on a card) opens the menu
- Menu is dismissed via `closeAllMenus()`

**SpacetimeDB reducer:** `random_hand_to_zone`

```
Parameters:
  gameId: u64
  count: u64
  toZone: string        // 'discard' | 'reserve' | 'deck'
  deckPosition: string  // 'top' | 'bottom' | 'shuffle' | '' (for non-deck zones)
```

Server-side logic:
1. Find all cards in the calling player's hand zone
2. Use the seeded PRNG (`advanceRng` / game's `rngCounter`) to pick `count` random cards
3. Move each card to the target zone:
   - For discard/reserve: set zone, clear posX/posY
   - For deck top: set zone to 'deck', set zoneIndex to 0
   - For deck bottom: set zone to 'deck', set zoneIndex to max+1
   - For shuffle into deck: set zone to 'deck', then shuffle all deck cards
4. Log action: `RANDOM_HAND_TO_ZONE` with payload containing the card names moved and destination

**Client-side hook:** Add `randomHandToZone` to `useGameState.ts` actions, wired to `conn.reducers.randomHandToZone({ gameId, count, toZone, deckPosition })`.

**Files:**
- Create: `app/shared/components/HandContextMenu.tsx`
- Modify: `app/play/components/MultiplayerCanvas.tsx` (hand zone right-click handler, menu state, menu rendering)
- Modify: `app/play/hooks/useGameState.ts` (new action)
- Modify: `spacetimedb/src/index.ts` (new reducer)
- Regenerate: `lib/spacetimedb/module_bindings/`

---

## Feature 2: Mid-Game Deck Swap

**Problem:** Once a game starts, there's no way to switch decks. For casual play and testing, players want to load a different deck without restarting the entire game.

### Design

**UI entry point:** Add a "Load Deck" button to the `GameToolbar`. This is a low-frequency action, so it should be behind a confirmation to prevent accidental triggers.

**Flow:**
1. Player clicks "Load Deck" in toolbar
2. `DeckPickerModal` opens (same component used in pregame)
3. Player selects a deck
4. Confirmation dialog: "This will clear all your cards from the game and load [Deck Name]. Continue?"
5. On confirm: call `reload_deck` reducer
6. Modal closes, game continues with new cards

**SpacetimeDB reducer:** `reload_deck`

```
Parameters:
  gameId: u64
  deckId: string
  deckData: string  // JSON deck data (same format as pregame)
```

Server-side logic:
1. Verify the caller is a player in this game
2. Delete all `CardInstance` rows for this player in this game
3. Delete all `CardCounter` rows associated with those cards
4. Parse deck data and insert new `CardInstance` rows (same logic as `insertCardsShuffleDraw`)
5. Shuffle the new deck using seeded PRNG
6. Draw opening hand of 8 cards
7. Log action: `RELOAD_DECK` with payload containing new deck ID

This reuses the existing `insertCardsShuffleDraw` helper function. The delete logic mirrors what `accept_rematch` already does (lines 648-655 in index.ts), but scoped to one player instead of both.

**Client-side:**
- Add `reloadDeck` action to `useGameState.ts`
- Add "Load Deck" button to `GameToolbar` (with `LoaderCircle` or `RefreshCw` icon)
- Add state for showing the deck picker modal in the canvas component
- Use `loadDeckForGame` (already exists in PregameScreen) to fetch deck data before calling the reducer

**Files:**
- Modify: `app/shared/components/GameToolbar.tsx` (new button)
- Modify: `app/play/components/MultiplayerCanvas.tsx` (deck picker modal state, confirmation dialog)
- Modify: `app/play/hooks/useGameState.ts` (new action)
- Modify: `spacetimedb/src/index.ts` (new reducer)
- Regenerate: `lib/spacetimedb/module_bindings/`

---

## Feature 3: Stale Game Cleanup

**Problem:** Games accumulate in SpacetimeDB indefinitely. Finished games, their card instances, actions, and chat messages are never deleted. The CSV export shows games stuck in "playing", "waiting", and "pregame" states with no cleanup. Over time this degrades performance (more rows for subscription queries to scan).

### Design

**Scheduled cleanup reducer:** `cleanup_stale_games`

Uses SpacetimeDB's scheduled table mechanism to run periodically.

**New scheduled table:** `CleanupSchedule`
```
scheduledId: u64 (primaryKey, autoInc)
scheduledAt: scheduleAt
```

**Cleanup rules (in order):**

1. **Abandoned waiting games** — Games in "waiting" status older than 1 hour → set status to "finished"

2. **Abandoned pregame games** — Games in "pregame" status older than 30 minutes → set status to "finished"

3. **Stale playing games** — Games in "playing" status where BOTH players have `isConnected: false` and no `GameAction` in the last 30 minutes → set status to "finished"

4. **Old finished game data cleanup** — Games in "finished" status older than 24 hours:
   - Delete all `CardInstance` rows for the game
   - Delete all `CardCounter` rows for those cards
   - Delete all `GameAction` rows for the game
   - Delete all `ChatMessage` rows for the game
   - Delete all `Spectator` rows for the game
   - Delete all `ZoneSearchRequest` rows for the game
   - Delete the `Player` rows for the game
   - Delete the `Game` row itself

**Scheduling:**
- On module init (or first game creation), insert a `CleanupSchedule` row scheduled for 1 hour from now
- At the end of each cleanup run, schedule the next run 1 hour later (self-rescheduling)

**Timestamp comparison:** Use `ctx.timestamp.microsSinceUnixEpoch` and compare against `game.createdAt.microsSinceUnixEpoch`. For activity checks, compare against the most recent `GameAction.timestamp` for the game.

**Files:**
- Modify: `spacetimedb/src/schema.ts` (new `CleanupSchedule` table)
- Modify: `spacetimedb/src/index.ts` (new reducer, scheduling logic in init/clientConnected)
- Regenerate: `lib/spacetimedb/module_bindings/`

---

## Implementation Order

1. **Feature 3** (stale game cleanup) — server-only, no UI, addresses data growth immediately
2. **Feature 1** (hand context menu) — new UI + reducer, highest gameplay value
3. **Feature 2** (mid-game deck swap) — convenience feature, lower priority
