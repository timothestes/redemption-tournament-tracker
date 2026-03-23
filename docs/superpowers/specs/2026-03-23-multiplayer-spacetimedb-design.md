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
Player drops card → conn.reducers.moveCard({ gameId, cardInstanceId, toZone, posX, posY })
  → Server validates: is it sender's card?
  → Server updates card_instance table
  → Subscription pushes update to both clients
  → Konva re-renders (no-op for the acting player, update for opponent)
  → If rejected (not sender's card): card snaps back on the acting player's canvas
```

### Visibility Model

**Level 1 (MVP):** All tables are public. Client-side rendering handles information hiding — opponent's Hand zone cards render as card backs. A technically savvy player could inspect subscription data in dev tools to see opponent's hand.

**Architected for Level 2:** All reducers validate `ctx.sender` ownership, so swapping to private tables + SpacetimeDB views is a drop-in upgrade. The view would filter: "show all my cards + opponent's non-hand cards."

**What reducers prevent even at Level 1:**
- Moving opponent's cards (ownership validation on all card actions)
- Changing the turn/phase when it's not your turn (turn validation on phase progression only)
- Skipping opponent's turn

**What Level 2 would additionally prevent:**
- Seeing opponent's hand contents
- Seeing opponent's deck order

### Randomness

SpacetimeDB reducers must be deterministic. All randomness (shuffle, dice) uses a seeded PRNG:

- **Seed:** `ctx.timestamp.microsSinceUnixEpoch ^ game.id ^ player.id ^ game.rng_counter` where `rng_counter` is a monotonic counter on the `game` table that increments with each PRNG-dependent operation (shuffle, dice roll). This ensures unique seeds even for rapid successive calls.
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
| format | enum | T1, T2, Paragon |
| rng_counter | u64 | Monotonic counter for PRNG seed uniqueness |
| last_dice_roll | string | JSON: { result, sides, rollerId } — triggers DiceRollOverlay on change |
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
| auto_route_lost_souls | bool | Player preference |

### card_instance

| Column | Type | Notes |
|--------|------|-------|
| id | u64 | PK, auto-inc |
| game_id | u64 | Indexed |
| owner_id | u64 | player.id — card belongs to this player |
| zone | enum | deck, hand, territory, land-of-bondage, land-of-redemption, discard, reserve, banish, paragon |
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
| special_ability | string | Card's special ability text |
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

### disconnect_timeout (scheduled table)

| Column | Type | Notes |
|--------|------|-------|
| scheduled_id | u64 | PK, auto-inc |
| scheduled_at | scheduleAt | Fires 5 minutes after disconnect |
| game_id | u64 | |
| player_id | u64 | |

Linked to `handle_disconnect_timeout` reducer. When a player disconnects, a row is inserted. If they reconnect, the row is deleted to cancel the timeout.

### Index Definitions

All "Indexed" columns require explicit SpacetimeDB index definitions in the table options:

```
game:            game_code          (btree, columns: ['code'])
player:          player_game_id     (btree, columns: ['gameId'])
card_instance:   card_game_id       (btree, columns: ['gameId'])
                 card_owner_id      (btree, columns: ['ownerId'])
card_counter:    counter_card_id    (btree, columns: ['cardInstanceId'])
game_action:     action_game_id     (btree, columns: ['gameId'])
chat_message:    chat_game_id       (btree, columns: ['gameId'])
spectator:       spectator_game_id  (btree, columns: ['gameId'])
```

### Zone Enum Alignment

Zone values use kebab-case strings matching the goldfish `ZoneId` type exactly:
`deck | hand | territory | land-of-bondage | land-of-redemption | discard | reserve | banish | paragon`

This ensures goldfish components can consume SpacetimeDB data without a mapping layer. The `paragon` zone is included to support Paragon format games.

### Derived Values (Not Stored)

- **souls_rescued**: Derived client-side by counting cards in `land-of-redemption` zone for a given player. Not stored on the `player` table to avoid sync drift.

---

## Reducers

### Game ID Resolution

All game-scoped reducers accept an explicit `game_id` parameter. The reducer validates that `ctx.sender` is a player (or spectator, for chat) in that game before proceeding. This is simpler and more robust than looking up the player's active game.

### Turn Validation Philosophy

Since full rules enforcement is a non-goal, **card action reducers validate ownership only, not turn order.** This matches the sandbox philosophy — players can respond during the opponent's turn (e.g., playing Enhancement cards in battle), adjust their board freely, and manage their own cards at any time. Only phase/turn progression reducers enforce whose turn it is.

| Reducer Category | Validates Ownership | Validates Turn |
|-----------------|-------------------|----------------|
| Card actions (move, meek, flip, counter) | Yes | No |
| Draw actions | Yes | No |
| Phase/turn progression (set_phase, end_turn) | N/A | Yes |
| Game lifecycle (create, join, resign) | N/A | N/A |

### Game Lifecycle

**create_game(deck_id, display_name, format, deck_data[])**
- Creates game row with random 4-char code, status=Waiting, format
- Validates code uniqueness against active games (Waiting/Playing status); regenerates if collision
- Creates player row (seat=0)
- Stores deck card data as card_instance rows (zone=deck, is_flipped=true)
- Shuffles deck using seeded PRNG (increments rng_counter)
- Handles "always start with" cards (tutor to hand)
- Draws opening hand (8 cards, auto-routing Lost Souls to land-of-bondage)
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

**leave_game(game_id)**
- Sets player.is_connected=false (or removes spectator row)

**resign_game(game_id)**
- Validates sender is a player in the game
- Sets game status=Finished
- Logs RESIGN action

### Turn & Phase

**set_phase(game_id, phase)**
- Validates it's sender's turn
- Sets current_phase to any valid phase (allows jumping forward or backward, matching goldfish PhaseBar UX)
- Logs SET_PHASE action

**end_turn(game_id)**
- Validates it's sender's turn
- Switches current_turn to other player's seat
- Resets phase to Draw
- Increments turn_number
- Internally draws 3 cards for the new active player (operating on the new player's deck directly, not delegating to draw_card reducer — avoids sender mismatch). Respects auto_route_lost_souls for the new active player.
- Logs END_TURN action

### Card Actions

**draw_card(game_id)**
- Validates sender is a player in the game
- Moves top card (lowest zone_index in deck) from sender's Deck to Hand
- Sets is_flipped=false
- If auto_route_lost_souls and card is Lost Soul: moves to land-of-bondage, draws replacement
- Logs DRAW action

**draw_multiple(game_id, count)**
- Calls draw_card logic N times for sender

**move_card(game_id, card_instance_id, to_zone, zone_index?, pos_x?, pos_y?)**
- Validates sender owns the card
- Updates card's zone, zone_index, pos_x, pos_y
- Handles face-up/face-down logic per target zone (deck = face-down, others = face-up)
- Logs MOVE_CARD action

**move_cards_batch(game_id, card_instance_ids[], to_zone, positions?)**
- Same ownership validation per card, batch update

**shuffle_deck(game_id)**
- Validates sender owns the deck
- Randomizes zone_index for all sender's deck cards using seeded PRNG (increments rng_counter)
- Logs SHUFFLE action

**shuffle_card_into_deck(game_id, card_instance_id)**
- Validates ownership
- Moves card to deck zone
- Shuffles entire deck using seeded PRNG (increments rng_counter)
- Logs SHUFFLE_INTO_DECK action

**meek_card(game_id, card_instance_id)**
- Validates ownership
- Sets is_meek=true
- Logs MEEK action

**unmeek_card(game_id, card_instance_id)**
- Validates ownership
- Sets is_meek=false
- Logs UNMEEK action

**flip_card(game_id, card_instance_id)**
- Validates ownership
- Toggles is_flipped
- Logs FLIP action

**update_card_position(game_id, card_instance_id, pos_x, pos_y)**
- Validates ownership
- Updates position only (no zone change)
- Does NOT log (too noisy for replay)

**add_counter(game_id, card_instance_id, color)**
- Validates ownership (looks up card_instance by id, checks owner_id matches sender's player row)
- Upserts card_counter row (increment count or insert with count=1)
- Logs ADD_COUNTER action

**remove_counter(game_id, card_instance_id, color)**
- Validates ownership
- Decrements count, deletes row if count reaches 0
- Logs REMOVE_COUNTER action

**set_note(game_id, card_instance_id, text)**
- Validates ownership
- Updates card_instance.notes
- Does NOT log

**exchange_cards(game_id, card_instance_ids[])**
- Validates ownership of all cards (any zone — sandbox flexibility, not restricted to hand)
- Returns cards to deck zone
- Shuffles deck using seeded PRNG (increments rng_counter)
- Draws same number of replacement cards
- Logs EXCHANGE action

### Utility

**roll_dice(game_id, sides)**
- Uses seeded PRNG to generate result 1..sides (increments rng_counter)
- Updates a `last_dice_roll` field on the `game` table (result + roller identity) — both clients watch this field via subscription and trigger the DiceRollOverlay animation when it changes
- Also logs ROLL_DICE action with result in payload for game history

**send_chat(game_id, text)**
- Validates sender is a player or spectator in the game
- Inserts chat_message row
- No turn validation

**set_player_option(game_id, option_name, value)**
- Updates player preferences (e.g., auto_route_lost_souls)

### Lifecycle Hooks

**clientConnected**
- Finds player by ctx.sender identity, sets is_connected=true
- Deletes any pending disconnect_timeout rows for this player (cancels timeout)

**clientDisconnected**
- Sets is_connected=false
- Inserts a disconnect_timeout scheduled table row (fires after 5 minutes) with game_id and player_id

**handle_disconnect_timeout (scheduled reducer)**
- Receives the disconnect_timeout row as arg
- Checks if player is still disconnected (is_connected=false)
- If still disconnected: set game status=Finished, log TIMEOUT action
- If reconnected: no-op (row auto-deleted after reducer completes)

---

## Client Architecture

### Route Structure

The URL parameter is the 4-character game **code** (e.g., `/play/ABCD`), not the numeric ID. This is user-friendly for sharing links. The server component resolves the code to validate the game exists; the client subscribes by game_id after connecting.

```
app/play/
  page.tsx                          Lobby: create game or enter join code
  [code]/
    page.tsx                        Server component: validate game exists, load deck from Supabase
    client.tsx                      'use client': SpacetimeDB + game canvas
  spectate/
    [code]/
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

**Subscription scoping:** The client subscribes only to the current game's data, not all games:

```typescript
conn.subscriptionBuilder().subscribe([
  `SELECT * FROM game WHERE id = ${gameId}`,
  `SELECT * FROM player WHERE game_id = ${gameId}`,
  `SELECT * FROM card_instance WHERE game_id = ${gameId}`,
  `SELECT * FROM card_counter`,  // filtered client-side by card_instance_id
  `SELECT * FROM game_action WHERE game_id = ${gameId}`,
  `SELECT * FROM chat_message WHERE game_id = ${gameId}`,
  `SELECT * FROM spectator WHERE game_id = ${gameId}`,
]);
```

**React data flow:**

```
SpacetimeDBProvider (connection builder, memoized)
  GameProvider (custom context)
    useTable(tables.game)           -> [rows] -> find by game_id -> game state
    useTable(tables.player)         -> [rows] -> filter by game_id -> both players
    useTable(tables.cardInstance)   -> [rows] -> filter by game_id -> all cards
    useTable(tables.cardCounter)    -> [rows] -> join by card_instance_id
    useTable(tables.chatMessage)    -> [rows] -> filter by game_id -> chat
    useTable(tables.gameAction)     -> [rows] -> filter by game_id -> log

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

**Spectator view:**
- At Level 1, spectators see both players' hands (full information, like a broadcast/stream view). This is intentional — spectators are friends watching a game, not potential cheaters.
- At Level 2, spectator visibility can be restricted via views if needed.

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
  strength, toughness, alignment, identifier, specialAbility }
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

## Authentication: Supabase ↔ SpacetimeDB Identity Bridge

### The Problem

The app uses Supabase Auth for user accounts (login, deck management, tournament registration). SpacetimeDB has its own identity system. We need to bridge them so a logged-in Supabase user maps to a stable SpacetimeDB identity.

### The Solution: OIDC Provider

SpacetimeDB supports any OIDC-compliant provider. Supabase Auth is OIDC-compliant — it issues JWTs with standard claims. The bridge works like this:

1. **User logs into the app via Supabase Auth** (existing flow, unchanged)
2. **Client connects to SpacetimeDB** with the Supabase JWT token via `.withToken(supabaseSession.access_token)`
3. **SpacetimeDB derives a stable Identity** from the OIDC token — same user always gets the same Identity across sessions
4. **The `player` table stores both** the SpacetimeDB `identity` (for reducer authorization) and the Supabase `user_id` (string, for linking back to decks, profiles, etc.)

### Schema Addition

Add to the `player` table:

| Column | Type | Notes |
|--------|------|-------|
| supabase_user_id | string | Supabase Auth user UUID, for linking to decks/profiles |

### How It Works in Practice

```
Supabase Auth login → JWT (access_token)
  → SpacetimeDB connection: .withToken(access_token)
  → SpacetimeDB derives Identity from JWT claims
  → create_game / join_game reducers use ctx.sender (Identity)
  → Player row stores both identity + supabase_user_id
  → Deck loading: uses supabase_user_id to fetch from Supabase
```

### Key Benefits

- **No duplicate auth system** — Supabase handles login, SpacetimeDB trusts its tokens
- **Stable identity** — same Supabase user always maps to the same SpacetimeDB identity
- **Deck ownership** — supabase_user_id on the player row links back to the user's saved decks
- **No guest play** — users must be logged in (already required for deck access)

### Investigation Needed

- Confirm SpacetimeDB's TypeScript SDK supports passing a custom OIDC token (vs. only SpacetimeAuth tokens). The `.withToken()` method exists but we need to verify it accepts arbitrary JWTs.
- Determine if SpacetimeDB needs OIDC discovery configuration (issuer URL, JWKS endpoint) pointed at Supabase's OIDC endpoints.
- Fallback: if Supabase JWT isn't directly compatible, use SpacetimeAuth tokens and store a mapping between SpacetimeDB identity and Supabase user_id in a server table.

---

## CI/CD: SpacetimeDB Module Deployment

### GitHub Actions Workflow

On merge to `main`, a GitHub Action should:

1. **Publish the SpacetimeDB module** to maincloud via CLI
2. **Regenerate client bindings** and commit them if changed
3. **Deploy the Next.js app** to Vercel (existing flow)

### Proposed Workflow: `.github/workflows/deploy-spacetimedb.yml`

```yaml
name: Deploy SpacetimeDB Module
on:
  push:
    branches: [main]
    paths:
      - 'spacetimedb/**'  # Only trigger on server module changes

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install SpacetimeDB CLI
        run: curl -sSf https://install.spacetimedb.com | sh

      - name: Authenticate
        run: spacetime login --token ${{ secrets.SPACETIMEDB_TOKEN }}

      - name: Publish module
        run: spacetime publish <db-name> --module-path spacetimedb

      - name: Generate client bindings
        run: |
          spacetime generate --lang typescript \
            --out-dir lib/spacetimedb/module_bindings \
            --module-path spacetimedb

      - name: Commit bindings if changed
        run: |
          git diff --quiet lib/spacetimedb/module_bindings/ || {
            git add lib/spacetimedb/module_bindings/
            git commit -m "chore: regenerate SpacetimeDB client bindings"
            git push
          }
```

### Key Decisions

- **Trigger on `spacetimedb/**` path changes only** — don't republish if only the Next.js app changed
- **`--clear-database` is NOT used in CI** — only for local dev. Production publishes should migrate, not wipe.
- **Client bindings committed to repo** — ensures the Next.js build always has matching bindings without needing SpacetimeDB CLI during Vercel build
- **SPACETIMEDB_TOKEN** stored as a GitHub secret — obtained via `spacetime login` locally

### Local Dev vs. CI

| Action | Local Dev | CI (merge to main) |
|--------|-----------|-------------------|
| Publish | `spacetime publish <name> --clear-database -y --module-path spacetimedb` | `spacetime publish <name> --module-path spacetimedb` (no clear) |
| Generate | Manual after publish | Automated, committed to repo |
| Database | Local SpacetimeDB instance or dev database on maincloud | Production database on maincloud |

---

## Migration Notes

The existing SpacetimeDB chat prototype at `app/play/play/` should be removed. It was scaffolding for learning the SDK. The new module lives at `spacetimedb/` (project root level) and the game client is integrated into the Next.js app at `app/play/`.

## Future Enhancements (Post-MVP)

- **Level 2 visibility**: Private tables + SpacetimeDB views for true hand hiding
- **Lobby/matchmaking**: Browse open games, filter by format
- **Tournament integration**: Link games to tournament rounds
- **Undo system**: Request-based undo with opponent approval
- **Replay viewer**: Step through game_action log to replay games
- **3-4 player support**: Extend seat system, adapt mirror layout
- **Full rules engine**: Server-side validation of legal plays
- **Emotes/reactions**: Quick communication during games
- **Card definition reference table**: Normalize static card data (name, image, stats) into a shared table to reduce card_instance row size. Currently denormalized for simplicity.
