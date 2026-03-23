# Multiplayer Redemption CCG via SpacetimeDB

**Date:** 2026-03-23
**Status:** Draft
**Branch:** spacetime-db-thoughts

## Overview

A real-time multiplayer (1v1) implementation of the Redemption CCG, integrated into the existing Next.js tournament tracker app. Uses SpacetimeDB for authoritative game state and real-time sync between players. Builds upon the existing goldfish (solitaire) mode, reusing its Konva.js rendering, drag-and-drop, and UI components.

## Goals

- Two players can play a full game of Redemption online in real-time
- Server-authoritative game state prevents meaningful cheating
- Smooth, responsive drag-and-drop UX despite network round-trips
- Spectators can watch games in progress
- Game actions are logged for future replay capability
- Reconnection is seamless if a player drops

## Non-Goals (Out of Scope)

- Full rules engine (legal play validation, combat resolution, ability triggers)
- Undo system (complex in multiplayer, deferred)
- Lobby/matchmaking browser (game codes only for now)
- Tournament bracket integration
- More than 2 players per game (architected for it, not built)

---

## Architecture

### Approach: Server-Authoritative with Local Drag Optimization

All game state lives in SpacetimeDB tables. Every mutation flows through a server-side reducer that validates `ctx.sender` ownership and turn order. The Konva canvas is a renderer of SpacetimeDB subscription data.

**Exception:** During an active drag, the card position updates locally on the Konva canvas for smooth UX. On drop, the final position commits to SpacetimeDB via a reducer call. If the reducer rejects the action (not your turn, not your card), the card snaps back to its original position.

**Data flow:**

```
Player drags card → local Konva visual (smooth)
Player drops card → conn.reducers.moveCard({ cardInstanceId, toZone, posX, posY })
  → Server validates: is it sender's card? is it sender's turn?
  → Server updates card_instance table
  → Subscription pushes update to both clients
  → Konva re-renders (no-op for the acting player, update for opponent)
  → If rejected: card snaps back on the acting player's canvas
```

### Visibility Model

**Level 1 (MVP):** All tables are public. Client-side rendering handles information hiding — opponent's Hand zone cards render as card backs. A technically savvy player could inspect subscription data in dev tools to see opponent's hand.

**Architected for Level 2:** All reducers validate `ctx.sender` ownership, so swapping to private tables + SpacetimeDB views is a drop-in upgrade. The view would filter: "show all my cards + opponent's non-hand cards."

**What reducers prevent even at Level 1:**
- Moving opponent's cards
- Playing out of turn
- Drawing when it's not your phase
- Skipping opponent's turn

**What Level 2 would additionally prevent:**
- Seeing opponent's hand contents
- Seeing opponent's deck order

### Randomness

SpacetimeDB reducers must be deterministic. All randomness (shuffle, dice) uses a seeded PRNG:

- **Seed:** `ctx.timestamp.microsSinceUnixEpoch`
- **Algorithm:** xorshift64 (simple, fast, sufficient for card games)
- **Usage:** Fisher-Yates shuffle for deck randomization, modulo for dice rolls
- Neither player controls or predicts the seed

---

## SpacetimeDB Schema

### game

| Column | Type | Notes |
|--------|------|-------|
| id | u64 | PK, auto-inc |
| code | string | Unique, 4-char join code (e.g., "ABCD") |
| status | enum | Waiting, Playing, Finished |
| current_turn | u64 | Seat number of active player (0 or 1) |
| current_phase | enum | Draw, Upkeep, Preparation, Battle, Discard |
| turn_number | u64 | Increments each full round |
| created_at | timestamp | |
| created_by | identity | |

### player

| Column | Type | Notes |
|--------|------|-------|
| id | u64 | PK, auto-inc |
| game_id | u64 | Indexed |
| identity | identity | SpacetimeDB connection identity |
| seat | u8 | 0 = player 1, 1 = player 2 (extensible to 3-4) |
| deck_id | string | Supabase deck ID (for reference only) |
| display_name | string | |
| is_connected | bool | |
| souls_rescued | u64 | |
| auto_route_lost_souls | bool | Player preference |

### card_instance

| Column | Type | Notes |
|--------|------|-------|
| id | u64 | PK, auto-inc |
| game_id | u64 | Indexed |
| owner_id | u64 | player.id — card belongs to this player |
| zone | enum | Deck, Hand, Territory, LandOfBondage, LandOfRedemption, Discard, Reserve, Banish |
| zone_index | u64 | Ordering within stacked zones |
| pos_x | f64 | Free-form zones (Territory, LandOfBondage) |
| pos_y | f64 | Free-form zones |
| is_meek | bool | Tapped/rotated 180 degrees |
| is_flipped | bool | Face-down |
| card_name | string | |
| card_set | string | |
| card_img_file | string | Vercel Blob image path |
| card_type | string | Character, LS, Fortress, etc. |
| brigade | string | |
| strength | string | |
| toughness | string | |
| alignment | string | |
| identifier | string | |
| notes | string | Player-added notes |

### card_counter

| Column | Type | Notes |
|--------|------|-------|
| id | u64 | PK, auto-inc |
| card_instance_id | u64 | Indexed |
| color | string | Counter color identifier |
| count | u64 | |

### game_action

| Column | Type | Notes |
|--------|------|-------|
| id | u64 | PK, auto-inc |
| game_id | u64 | Indexed |
| player_id | u64 | |
| action_type | string | MOVE_CARD, DRAW, MEEK, SHUFFLE, ROLL_DICE, etc. |
| payload | string | JSON blob with action details |
| turn_number | u64 | |
| phase | string | |
| timestamp | timestamp | |

### chat_message

| Column | Type | Notes |
|--------|------|-------|
| id | u64 | PK, auto-inc |
| game_id | u64 | Indexed |
| sender_id | u64 | |
| text | string | |
| sent_at | timestamp | |

### spectator

| Column | Type | Notes |
|--------|------|-------|
| id | u64 | PK, auto-inc |
| game_id | u64 | Indexed |
| identity | identity | |
| display_name | string | |

---

## Reducers

### Game Lifecycle

**create_game(deck_id, display_name, deck_data[])**
- Creates game row with random 4-char code, status=Waiting
- Creates player row (seat=0)
- Stores deck card data as card_instance rows (zone=Deck, is_flipped=true)
- Shuffles deck using seeded PRNG
- Handles "always start with" cards (tutor to hand)
- Draws opening hand (8 cards, auto-routing Lost Souls to LandOfBondage)
- Logs GAME_CREATED action

**join_game(code, deck_id, display_name, deck_data[])**
- Finds game by code, validates status=Waiting
- Creates player row (seat=1)
- Inserts card_instance rows for joining player's deck (same shuffle + draw logic)
- Sets game status=Playing, current_turn=0, phase=Draw, turn_number=1
- Logs GAME_STARTED action

**join_as_spectator(code, display_name)**
- Validates game exists
- Creates spectator row

**leave_game()**
- Sets player.is_connected=false (or removes spectator row)

**resign_game()**
- Validates sender is a player in the game
- Sets game status=Finished
- Logs RESIGN action

### Turn & Phase

**advance_phase()**
- Validates it's sender's turn
- Advances phase: Draw -> Upkeep -> Preparation -> Battle -> Discard
- Logs ADVANCE_PHASE action

**end_turn()**
- Validates it's sender's turn
- Switches current_turn to other player's seat
- Resets phase to Draw
- Increments turn_number
- Auto-draws 3 cards for the new active player (respects auto_route_lost_souls)
- Logs END_TURN action

### Card Actions

**draw_card()**
- Validates sender's turn and appropriate phase
- Moves top card (lowest zone_index in Deck) from sender's Deck to Hand
- Sets is_flipped=false
- If auto_route_lost_souls and card is Lost Soul: moves to LandOfBondage, draws replacement
- Logs DRAW action

**draw_multiple(count)**
- Calls draw_card logic N times

**move_card(card_instance_id, to_zone, zone_index?, pos_x?, pos_y?)**
- Validates sender owns the card
- Validates it's sender's turn
- Updates card's zone, zone_index, pos_x, pos_y
- Handles face-up/face-down logic per target zone (Deck = face-down, others = face-up)
- Logs MOVE_CARD action

**move_cards_batch(card_instance_ids[], to_zone, positions?)**
- Same validation per card, batch update

**shuffle_deck()**
- Validates sender owns the deck
- Randomizes zone_index for all sender's Deck cards using seeded PRNG
- Logs SHUFFLE action

**shuffle_card_into_deck(card_instance_id)**
- Validates ownership
- Moves card to Deck zone
- Shuffles entire deck using seeded PRNG
- Logs SHUFFLE_INTO_DECK action

**meek_card(card_instance_id)**
- Validates ownership
- Sets is_meek=true
- Logs MEEK action

**unmeek_card(card_instance_id)**
- Validates ownership
- Sets is_meek=false
- Logs UNMEEK action

**flip_card(card_instance_id)**
- Validates ownership
- Toggles is_flipped
- Logs FLIP action

**update_card_position(card_instance_id, pos_x, pos_y)**
- Validates ownership
- Updates position only (no zone change)
- Does NOT log (too noisy for replay)

**add_counter(card_instance_id, color)**
- Validates ownership
- Upserts card_counter row (increment count or insert with count=1)
- Logs ADD_COUNTER action

**remove_counter(card_instance_id, color)**
- Validates ownership
- Decrements count, deletes row if count reaches 0
- Logs REMOVE_COUNTER action

**set_note(card_instance_id, text)**
- Validates ownership
- Updates card_instance.notes
- Does NOT log

**exchange_cards(card_instance_ids[])**
- Validates ownership of all cards, all in Hand zone
- Returns cards to Deck zone
- Shuffles deck using seeded PRNG
- Draws same number of replacement cards
- Logs EXCHANGE action

### Utility

**roll_dice(sides)**
- Uses seeded PRNG to generate result 1..sides
- Inserts game_action log entry with the result (both players see it via subscription)
- Logs ROLL_DICE action with result in payload

**send_chat(game_id, text)**
- Validates sender is a player or spectator in the game
- Inserts chat_message row
- No turn validation

**set_player_option(option_name, value)**
- Updates player preferences (e.g., auto_route_lost_souls)

### Lifecycle Hooks

**clientConnected**
- Finds player by ctx.sender identity, sets is_connected=true

**clientDisconnected**
- Sets is_connected=false
- Inserts a scheduled table row for disconnect timeout (5 minutes)
- If player reconnects before timeout fires, the scheduled row is deleted

**Disconnect timeout reducer (scheduled)**
- If player is still disconnected when this fires, set game status=Finished
- Log TIMEOUT action

---

## Client Architecture

### Route Structure

```
app/play/
  page.tsx                          Lobby: create game or enter join code
  [gameId]/
    page.tsx                        Server component: validate game, load deck from Supabase
    client.tsx                      'use client': SpacetimeDB + game canvas
  spectate/
    [gameId]/
      page.tsx                      Read-only spectator view
  components/
    MultiplayerCanvas.tsx           Main Konva canvas (adapted from GoldfishCanvas)
    OpponentHand.tsx                Card backs row at top
    ChatPanel.tsx                   Chat + action log overlay
    ConnectionStatus.tsx            Online/offline indicator
    GameLobby.tsx                   Create/join UI with game code
    TurnIndicator.tsx               Whose turn + phase controls
    SpectatorBar.tsx                Viewer count/names
  hooks/
    useGameState.ts                 Wraps SpacetimeDB subscriptions into game context
    useMultiplayerImagePreloader.ts Progressive image loading
    useSpacetimeConnection.ts       Connection builder + reconnection
  layout/
    mirrorLayout.ts                 Two-player zone positioning
  lib/
    spacetimedb-provider.tsx        SpacetimeDB React provider wrapper
```

### SpacetimeDB Server Module Structure

```
spacetimedb/                        Project root level (not inside app/)
  src/
    schema.ts                       Table definitions, exports spacetimedb
    index.ts                        Reducers + lifecycle hooks
    utils.ts                        Seeded PRNG, shuffle helper
  package.json
  tsconfig.json

spacetime.json                      Project root, DB config
```

Generated client bindings output to a location importable by Next.js (e.g., `lib/spacetimedb/module_bindings/`), aliased in tsconfig.json.

### SpacetimeDB to React Data Flow

```
SpacetimeDBProvider (connection builder, memoized)
  GameProvider (custom context)
    useTable(tables.game)           -> game state (turn, phase, status)
    useTable(tables.player)         -> both players' info
    useTable(tables.cardInstance)   -> all cards in all zones
    useTable(tables.cardCounter)    -> counters on cards
    useTable(tables.chatMessage)    -> chat history
    useTable(tables.gameAction)     -> action log

    Derived state (useMemo):
      myCards         cards where owner = me, grouped by zone
      opponentCards   cards where owner != me, grouped by zone
      isMyTurn        game.current_turn === my seat
      myPlayer        player where identity = me
      opponentPlayer  player where identity != me
```

### Goldfish Component Reuse

**Reuse directly (import from app/goldfish/):**
- GameCardNode rendering (card images, meek rotation, counters, glow)
- useImagePreloader (extended for progressive loading)
- useSelectionState (marquee multi-select)
- useModalCardDrag (drag from modals)
- handLayout.ts (fan/spread positioning)
- DeckSearchModal, DeckPeekModal, ZoneBrowseModal, DeckExchangeModal
- CardContextMenu, DeckContextMenu, ZoneContextMenu
- CardLoupePanel, CardHoverPreview, CardZoomModal
- DiceRollOverlay (animation client-side, result from reducer)
- GameToast

**Adapt for multiplayer:**
- GoldfishCanvas -> MultiplayerCanvas (mirror layout, two players)
- zoneLayout.ts -> mirrorLayout.ts (opponent zones mirrored at top)
- PhaseBar -> TurnIndicator (shows whose turn, disables when not yours)
- GameContext -> useGameState (SpacetimeDB subscriptions instead of local reducer)
- gameReducer.ts -> replaced entirely by SpacetimeDB reducers

**New components:**
- OpponentHand, ChatPanel, ConnectionStatus, GameLobby, SpectatorBar

### Replacing gameReducer.ts

The goldfish game reducer is the local state machine. In multiplayer, SpacetimeDB reducers replace it:

```
Goldfish:  dispatch({ type: 'MOVE_CARD', payload }) -> gameReducer -> new state -> re-render
Multi:     conn.reducers.moveCard({ ... }) -> server validates -> table update -> subscription -> re-render
```

The `useGameState` hook provides the same interface shape that goldfish components expect (cards grouped by zone, current phase, turn number), but backed by SpacetimeDB subscriptions instead of useReducer.

---

## Board Layout

MTGO-style mirror layout. Each player's zones read outward from the center battlefield.

```
+-----------------------------------------------------------+
| Opponent Hand: [back][back][back][back]  (top edge)       |
+----------------------------------------+------------------+
|   Opponent's Land of Bondage           | Opp Deck     [#] |
|   (their Lost Souls)                   | Opp Discard  [#] |
+----------------------------------------+ Opp Reserve  [#] |
|                                        | Opp Banish   [#] |
|   Opponent's Territory                 | Opp LOR      [#] |
|   (free-form, face-up)                |                  |
+----------------------------------------+------------------+
|                                        |                  |
|   Your Territory                       | Your LOR     [#] |
|   (free-form, drag cards here)         | Your Banish  [#] |
|                                        | Your Reserve [#] |
+----------------------------------------+ Your Discard [#] |
|   Your Land of Bondage                 | Your Deck    [#] |
|   (your Lost Souls)                    |                  |
+----------------------------------------+------------------+
| Your Hand: [card][card][card][card][card]  (fan layout)   |
+-----------------------------------------------------------+
| Phase Bar (turn indicator + phase buttons)                 |
+-----------------------------------------------------------+
```

**Layout logic:**
- Opponent hand at top edge (card backs, count matches actual hand size)
- Opponent LOB near their hand, opponent Territory toward center
- Your Territory toward center, your LOB near your hand
- Territories face each other in the middle (the battlefield)
- Sidebar stacks mirror: opponent top-right, yours bottom-right
- Your hand at bottom with fan layout
- Phase bar at very bottom (your controls, thumb-reachable on mobile)
- Chat/Action log is a slide-out overlay panel (not in main layout)

**Turn state visuals:**
- Your turn: phase bar interactive, your zones subtly highlighted
- Opponent's turn: phase bar shows current phase but disabled, opponent's zones highlighted
- Waiting for opponent: pulsing indicator with game code displayed

---

## Deck Loading Bridge

Deck data flows one-way from Supabase to SpacetimeDB at game start.

**Flow:**
1. Player selects deck in lobby (Next.js page)
2. Next.js server action fetches deck from Supabase (card names, images, stats)
3. Client receives deck data as JSON
4. Client calls create_game or join_game reducer, passing deck data array
5. Reducer inserts one card_instance row per card (zone=Deck, shuffled via seeded PRNG)
6. Reducer handles "always start with" tutoring and opening hand draw

**What crosses the bridge per card:**
```
{ cardName, cardSet, cardImgFile, cardType, brigade,
  strength, toughness, alignment, identifier }
```

No further Supabase calls during gameplay. Game state is self-contained in SpacetimeDB.

---

## Image Loading Strategy

Three-phase progressive loading. No blocking loading screen.

**Phase 1: Preload your deck (during lobby wait)**
- Player creates/joins game, already has deck data from Supabase
- Start preloading all card images immediately
- By the time opponent joins, your images are likely cached

**Phase 2: Preload opponent's cards (on game start)**
- join_game subscription delivers opponent's card_instance rows
- Collect unique image URLs, filter out already-cached images
- Load remaining in parallel
- Cards render as card backs until their image loads

**Phase 3: Lazy load on reveal**
- As opponent plays cards, images may already be cached from Phase 2
- If not, load on first render with card back fallback, swap in when ready

**Optimizations:**
- Shared Map<url, HTMLImageElement> cache (deduplicates common cards)
- Priority loading: visible zones first (Territory, LOB), stacked zones second, Deck last
- Vercel Blob CDN caching — repeat games are near-instant
- Browser HTTP cache for long-term persistence

---

## Reconnection & Game Lifecycle

### Reconnection

SpacetimeDB handles this natively:
1. clientConnected lifecycle hook sets player.is_connected=true
2. Client re-subscribes to game tables, receives full current state
3. Konva canvas renders from subscription data
4. Opponent sees connection status update

No special reconnection logic required.

### Disconnect Handling

- Opponent disconnects: "Opponent disconnected" banner with timer
- Scheduled table row fires reducer after 5 minutes
- If opponent reconnects, scheduled row is deleted (timeout cancelled)
- If timeout fires and player still disconnected: game status=Finished

### Game End States

| State | Trigger |
|-------|---------|
| Finished (resign) | Player calls resign_game reducer |
| Finished (timeout) | Disconnected player didn't return within 5 minutes |
| Abandoned | Game in Waiting status, creator disconnected |

Finished games remain in database for history/replay. Abandoned games cleaned up immediately. Optional: scheduled cleanup for games older than N days.

---

## MVP Feature Checklist

1. Create/join game via 4-character code
2. Load deck from saved Supabase decks
3. Mirror layout (opponent top, you bottom)
4. Drag cards between your own zones (free-form positioning in Territory/LOB)
5. Real-time sync of opponent's public zones
6. Server-enforced turn order and phase progression
7. Hidden hand (opponent sees card backs)
8. Basic game actions: draw, meek/unmeek, flip, counters, discard, move
9. Chat between players
10. Spectator mode (read-only subscription)
11. Game action log (append-only, for future replay)
12. Deck search/peek/browse modals (client-side filtering at Level 1)
13. Shared dice rolling (seeded PRNG, both players see result)
14. Reconnection handling (SpacetimeDB native)
15. Deck exchange/mulligan
16. Card notes
17. "Always start with" card tutoring at game start

---

## Dev Workflow

```bash
# Start local SpacetimeDB server
spacetime start

# Publish module (after schema/reducer changes)
spacetime publish <db-name> --clear-database -y --module-path spacetimedb

# Regenerate client bindings
spacetime generate --lang typescript --out-dir lib/spacetimedb/module_bindings --module-path spacetimedb

# Start Next.js dev server
npm run dev
```

---

## Future Enhancements (Post-MVP)

- **Level 2 visibility**: Private tables + SpacetimeDB views for true hand hiding
- **Lobby/matchmaking**: Browse open games, filter by format
- **Tournament integration**: Link games to tournament rounds
- **Undo system**: Request-based undo with opponent approval
- **Replay viewer**: Step through game_action log to replay games
- **3-4 player support**: Extend seat system, adapt mirror layout
- **Full rules engine**: Server-side validation of legal plays
- **Emotes/reactions**: Quick communication during games
