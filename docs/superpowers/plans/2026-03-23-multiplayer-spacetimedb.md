# Multiplayer Redemption CCG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time 1v1 multiplayer Redemption CCG game using SpacetimeDB for state sync, integrated into the existing Next.js tournament tracker app.

**Architecture:** Server-authoritative game state in SpacetimeDB tables. All mutations flow through reducers with ownership validation. Konva.js canvas renders subscription data with local drag optimization. Goldfish components reused where possible.

**Tech Stack:** SpacetimeDB v2.x (TypeScript module), Next.js 15, React 19, Konva.js (react-konva), Supabase Auth, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-23-multiplayer-spacetimedb-design.md`

**SpacetimeDB SDK Rules:** `spacetimedb/CLAUDE.md` — **READ THIS BEFORE ANY SPACETIMEDB CODE.** Contains critical hallucination warnings and correct API patterns.

---

## File Structure

### SpacetimeDB Server Module (new)

```
spacetimedb/
  src/
    schema.ts               All table definitions (game, player, card_instance, etc.), export spacetimedb
    index.ts                 All reducers + lifecycle hooks, imports from schema
    utils.ts                 Seeded xorshift64 PRNG, Fisher-Yates shuffle, game code generator
  package.json              type: "module", spacetimedb ^2.0.4 dependency
  tsconfig.json             Standard TS config for SpacetimeDB modules
spacetime.json              Root-level SpacetimeDB config (database name, server)
```

### Generated Bindings (auto-generated, committed to repo)

```
lib/spacetimedb/
  module_bindings/           Output of `spacetime generate` — DO NOT EDIT
    index.ts                 DbConnection, tables, reducers exports
    types.ts                 Generated TypeScript types
    *.ts                     Per-table and per-reducer files
```

### Client — Next.js Routes & Components (new)

```
app/play/
  page.tsx                   Lobby page (create game, enter join code, select deck)
  [code]/
    page.tsx                 Server component: validate game code, load deck from Supabase
    client.tsx               'use client': SpacetimeDB connection + GameProvider + canvas
  spectate/
    [code]/
      page.tsx               Read-only spectator view
  components/
    GameLobby.tsx            Create/join game UI with code display
    MultiplayerCanvas.tsx    Main Konva canvas — adapted from GoldfishCanvas
    OpponentHand.tsx         Row of card backs at top of canvas
    TurnIndicator.tsx        Phase bar + turn indicator (adapted from PhaseBar)
    ChatPanel.tsx            Slide-out chat + action log
    ConnectionStatus.tsx     Online/offline indicator for opponent
    SpectatorBar.tsx         Spectator count/names display
  hooks/
    useGameState.ts          SpacetimeDB subscriptions → game context (replaces goldfish GameContext)
    useSpacetimeConnection.ts SpacetimeDB connection builder with Supabase token
    useMultiplayerImagePreloader.ts  Progressive 3-phase image loading
  layout/
    mirrorLayout.ts          Two-player zone positioning (mirror of goldfish zoneLayout)
  lib/
    spacetimedb-provider.tsx SpacetimeDB React provider wrapper
```

### Shared Components (extracted from goldfish)

```
app/shared/
  components/
    GameCardNode.tsx         Extracted from GoldfishCanvas — card image, meek rotation, counters, glow
```

### Modifications to Existing Files

```
CLAUDE.md                    Add SpacetimeDB to tech stack, reference SDK rules (DONE)
tsconfig.json                Add path alias for @spacetimedb/* → lib/spacetimedb/module_bindings/*
.env.local                   Add NEXT_PUBLIC_SPACETIMEDB_HOST and NEXT_PUBLIC_SPACETIMEDB_DB_NAME
app/goldfish/types.ts        No changes — multiplayer defines its own types mapped from SpacetimeDB
app/goldfish/components/GoldfishCanvas.tsx  Extract GameCardNode into shared component, import from shared
```

### Key SDK Constraint: Enums

SpacetimeDB's `t.enum` creates **tagged unions** (`{ tag: 'deck', value: ... }`), NOT simple string enums. Use `t.string()` for zone, status, phase, and format columns, with string validation in reducers. This preserves direct compatibility with goldfish's `ZoneId` string type (`'deck' | 'hand' | ...`) without a mapping layer.

---

## Task Breakdown

### Task 1: SpacetimeDB Module Scaffold

**Files:**
- Create: `spacetimedb/package.json`
- Create: `spacetimedb/tsconfig.json`
- Create: `spacetime.json`

- [ ] **Step 1: Create SpacetimeDB module package.json**

```json
{
  "name": "redemption-multiplayer",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "spacetimedb": "^2.0.4"
  }
}
```

- [ ] **Step 2: Create tsconfig.json for SpacetimeDB module**

```json
{
  "compilerOptions": {
    "target": "es2020",
    "module": "es2020",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create spacetime.json at project root**

```json
{
  "dev": { "run": "npm run dev" },
  "database": "redemption-multiplayer",
  "server": "maincloud",
  "module-path": "./spacetimedb"
}
```

- [ ] **Step 4: Install dependencies**

Run: `cd spacetimedb && npm install`

- [ ] **Step 5: Commit**

```bash
git add spacetimedb/package.json spacetimedb/tsconfig.json spacetime.json
git commit -m "feat: scaffold SpacetimeDB module structure"
```

---

### Task 2: PRNG Utilities

**Files:**
- Create: `spacetimedb/src/utils.ts`

- [ ] **Step 1: Implement xorshift64 PRNG and Fisher-Yates shuffle**

```typescript
// Seeded xorshift64 PRNG — deterministic, suitable for SpacetimeDB reducers
export function xorshift64(seed: bigint): { next: () => bigint } {
  let state = seed === 0n ? 1n : seed; // Avoid zero state
  return {
    next(): bigint {
      state ^= state << 13n;
      state ^= state >> 7n;
      state ^= state << 17n;
      state &= 0xFFFFFFFFFFFFFFFFn; // Keep within u64 range
      return state < 0n ? -state : state; // Ensure positive
    },
  };
}

// Compose a unique seed from game state to avoid collisions
export function makeSeed(
  timestamp: bigint,
  gameId: bigint,
  playerId: bigint,
  rngCounter: bigint
): bigint {
  return timestamp ^ gameId ^ (playerId << 8n) ^ (rngCounter << 16n);
}

// Fisher-Yates shuffle using seeded PRNG — mutates array in place
export function seededShuffle<T>(items: T[], seed: bigint): T[] {
  const rng = xorshift64(seed);
  for (let i = items.length - 1; i > 0; i--) {
    const rand = rng.next();
    const j = Number(rand % BigInt(i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// Roll a die with N sides using seeded PRNG
export function seededDiceRoll(sides: number, seed: bigint): number {
  const rng = xorshift64(seed);
  return Number(rng.next() % BigInt(sides)) + 1;
}

// Generate a random 4-character game code (A-Z)
export function generateGameCode(seed: bigint): string {
  const rng = xorshift64(seed);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Number(rng.next() % 26n)];
  }
  return code;
}
```

- [ ] **Step 2: Commit**

```bash
git add spacetimedb/src/utils.ts
git commit -m "feat: add seeded PRNG utilities for SpacetimeDB reducers"
```

---

### Task 3: SpacetimeDB Schema (All Tables)

**Files:**
- Create: `spacetimedb/src/schema.ts`

This is the core data model. Read `spacetimedb/CLAUDE.md` before writing this — table definitions have specific syntax requirements (OPTIONS as first arg, COLUMNS as second arg, indexes in OPTIONS).

- [ ] **Step 1: Define all tables**

Define these tables following SpacetimeDB v2.x TypeScript syntax in `schema.ts`:
- `game` — with indexes on `code`
- `player` — with indexes on `gameId`
- `card_instance` — with indexes on `gameId`, `ownerId`
- `card_counter` — with indexes on `cardInstanceId`
- `game_action` — with indexes on `gameId`
- `chat_message` — with indexes on `gameId`
- `spectator` — with indexes on `gameId`
- `disconnect_timeout` — scheduled table linked to `handle_disconnect_timeout` reducer

**CRITICAL — Enum handling:** Do NOT use `t.enum` for zone, status, phase, or format columns. SpacetimeDB's `t.enum` creates tagged unions (`{ tag: 'deck', value: ... }`), not simple string enums. Instead, use `t.string()` for these columns and validate values in reducers. This preserves direct compatibility with goldfish's `ZoneId` string type.

Add `supabase_user_id: t.string()` to the `player` table (for linking back to Supabase user accounts/decks).

Reference the spec schema tables section for exact column types.

End with: `const spacetimedb = schema({ Game, Player, CardInstance, CardCounter, GameAction, ChatMessage, Spectator, DisconnectTimeout }); export default spacetimedb;`

- [ ] **Step 2: Verify schema compiles**

Run: `cd spacetimedb && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add spacetimedb/src/schema.ts
git commit -m "feat: define SpacetimeDB schema — all 8 tables with indexes"
```

---

### Task 4: Core Reducers — Game Lifecycle

**Files:**
- Create: `spacetimedb/src/index.ts`

- [ ] **Step 1: Implement game lifecycle reducers and lifecycle hooks**

Import `spacetimedb` from `./schema` and utilities from `./utils`. Implement:

**Reducers:**
- `create_game` — params: `{ deckId: string, displayName: string, format: string, supabaseUserId: string, deckData: string }` (deckData is JSON-serialized card array — SpacetimeDB reducer params don't support arrays of product types, so we serialize on the client and `JSON.parse` in the reducer with explicit validation). Creates game with unique code (retry on collision), creates player (seat=0, supabase_user_id set), inserts card_instances, shuffles deck, tutors "always start with" cards (reference `app/goldfish/state/gameInitializer.ts` for tutoring logic), draws opening hand (8 cards with Lost Soul auto-routing). Increments rng_counter for each PRNG operation.
- `join_game` — params: `{ code: string, deckId: string, displayName: string, supabaseUserId: string, deckData: string }`. Validates status=Waiting, creates player (seat=1, supabase_user_id set), inserts their cards, shuffles, draws hand. Sets game to Playing.
- `join_as_spectator` — params: `{ code: string, displayName: string }`. Creates spectator row.
- `leave_game` — params: `{ gameId: bigint }`. Sets is_connected=false or removes spectator.
- `resign_game` — params: `{ gameId: bigint }`. Sets status=Finished. Logs action.

**Lifecycle hooks:**
- `clientConnected` — find player by ctx.sender, set is_connected=true, cancel any pending disconnect_timeout.
- `clientDisconnected` — set is_connected=false, insert disconnect_timeout row (5 min).

**Scheduled reducer:**
- `handle_disconnect_timeout` — check if player still disconnected, set game to Finished if so.

**Helper (internal, not exported):**
- `drawCardsForPlayer(ctx, gameId, playerId, count, autoRouteLostSouls)` — shared draw logic used by create_game, join_game, end_turn.
- `logAction(ctx, gameId, playerId, actionType, payload, turnNumber, phase)` — inserts game_action row.
- `findPlayerBySender(ctx, gameId)` — validates ctx.sender is a player in the game, returns player row.

**CRITICAL:** All reducer params use object syntax `{ param: value }` not positional args. Use `0n` as placeholder for auto-increment IDs on insert. Read `spacetimedb/CLAUDE.md` for correct patterns.

- [ ] **Step 2: Publish to local SpacetimeDB and verify**

Run:
```bash
spacetime start  # if not already running
spacetime publish redemption-multiplayer --clear-database -y --module-path spacetimedb
```
Expected: "Published successfully" (or similar)

- [ ] **Step 3: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "feat: implement game lifecycle reducers and connection hooks"
```

---

### Task 5: Card Action & Utility Reducers

**Files:**
- Modify: `spacetimedb/src/index.ts`

- [ ] **Step 1: Add turn/phase reducers**

- `set_phase` — params: `{ gameId, phase }`. Validates sender's turn. Sets current_phase. Logs SET_PHASE.
- `end_turn` — params: `{ gameId }`. Validates sender's turn. Switches current_turn, resets phase to Draw, increments turn_number. Internally draws 3 cards for the NEW active player using `drawCardsForPlayer`. Logs END_TURN.

- [ ] **Step 2: Add card action reducers**

- `draw_card` — params: `{ gameId }`. Validates sender is player. Draws from sender's deck. Logs DRAW.
- `draw_multiple` — params: `{ gameId, count }`. Loops draw logic.
- `move_card` — params: `{ gameId, cardInstanceId, toZone, zoneIndex?, posX?, posY? }`. Validates ownership. Updates zone/position. Handles face-up/down per zone. Logs MOVE_CARD.
- `move_cards_batch` — params: `{ gameId, cardInstanceIds, toZone, positions? }`. Batch ownership validation + move.
- `shuffle_deck` — params: `{ gameId }`. Validates sender owns deck. Seeded shuffle. Logs SHUFFLE.
- `shuffle_card_into_deck` — params: `{ gameId, cardInstanceId }`. Validates ownership. Moves to deck + shuffles. Logs.
- `meek_card` / `unmeek_card` — params: `{ gameId, cardInstanceId }`. Toggle is_meek. Log.
- `flip_card` — params: `{ gameId, cardInstanceId }`. Toggle is_flipped. Log.
- `update_card_position` — params: `{ gameId, cardInstanceId, posX, posY }`. Validates ownership. No log.
- `add_counter` / `remove_counter` — params: `{ gameId, cardInstanceId, color }`. Validates ownership via card_instance lookup. Log.
- `set_note` — params: `{ gameId, cardInstanceId, text }`. Validates ownership. No log.
- `exchange_cards` — params: `{ gameId, cardInstanceIds }`. Validates ownership (any zone). Returns to deck, shuffles, draws replacements. Logs.

- [ ] **Step 3: Add utility reducers**

- `roll_dice` — params: `{ gameId, sides }`. Seeded PRNG roll. Updates game.last_dice_roll. Logs ROLL_DICE.
- `send_chat` — params: `{ gameId, text }`. Validates sender is player or spectator. Inserts chat_message.
- `set_player_option` — params: `{ gameId, optionName, value }`. Updates player preferences.

- [ ] **Step 4: Republish and verify**

Run:
```bash
spacetime publish redemption-multiplayer --clear-database -y --module-path spacetimedb
spacetime logs redemption-multiplayer  # check for errors
```

- [ ] **Step 5: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "feat: implement all card action, turn/phase, and utility reducers"
```

---

### Task 6: Generate Client Bindings & Configure Next.js

**Files:**
- Create: `lib/spacetimedb/module_bindings/` (auto-generated)
- Modify: `tsconfig.json` (add path alias)

- [ ] **Step 1: Generate TypeScript client bindings**

Run:
```bash
spacetime generate --lang typescript --out-dir lib/spacetimedb/module_bindings --module-path spacetimedb
```

- [ ] **Step 2: Add path alias to tsconfig.json**

Add to `compilerOptions.paths`:
```json
"@spacetimedb/*": ["lib/spacetimedb/module_bindings/*"]
```

- [ ] **Step 3: Install spacetimedb client SDK in the Next.js project**

Run: `npm install spacetimedb`

- [ ] **Step 4: Add SpacetimeDB environment variables**

Create/update `.env.local`:
```
NEXT_PUBLIC_SPACETIMEDB_HOST=ws://localhost:3000
NEXT_PUBLIC_SPACETIMEDB_DB_NAME=redemption-multiplayer
```

Add `.env.example` (or update existing) with these vars documented for other developers.

- [ ] **Step 5: Verify bindings import correctly**

Create a quick test: try importing `DbConnection` and `tables` from the generated bindings in a scratch file. Confirm types resolve. Verify Next.js resolves the `@spacetimedb/*` path alias (Next.js 15 reads `tsconfig.json` paths natively — if it doesn't work, also add the alias in `next.config.js`). Delete the scratch file.

- [ ] **Step 6: Commit**

```bash
git add lib/spacetimedb/ tsconfig.json package.json package-lock.json .env.example
git commit -m "feat: generate SpacetimeDB client bindings and configure path alias"
```

---

### Task 7: SpacetimeDB Connection & Provider

**Files:**
- Create: `app/play/hooks/useSpacetimeConnection.ts`
- Create: `app/play/lib/spacetimedb-provider.tsx`

- [ ] **Step 1: Create connection hook**

`useSpacetimeConnection.ts` — wraps SpacetimeDB connection setup:
- Uses `useMemo` to create `DbConnection.builder()` (CRITICAL: must be memoized to prevent reconnects on re-render)
- Reads Supabase session token via `useEffect` and passes to `.withToken()`
- Configures `.withUri()` from env var `NEXT_PUBLIC_SPACETIMEDB_HOST`
- Configures `.withDatabaseName()` from env var `NEXT_PUBLIC_SPACETIMEDB_DB_NAME`
- Handles `.onConnect()` — stores token in localStorage for reconnection
- Handles `.onConnectError()` — sets error state
- Returns `{ connectionBuilder, isConnected, error }`

- [ ] **Step 2: Create provider wrapper**

`spacetimedb-provider.tsx` — `'use client'` component:
- Wraps `SpacetimeDBProvider` from `spacetimedb/react`
- Takes `connectionBuilder` prop
- Provides SpacetimeDB context to children

- [ ] **Step 3: Commit**

```bash
git add app/play/hooks/useSpacetimeConnection.ts app/play/lib/spacetimedb-provider.tsx
git commit -m "feat: add SpacetimeDB connection hook and React provider"
```

---

### Task 8: Game State Hook (useGameState)

**Files:**
- Create: `app/play/hooks/useGameState.ts`

This is the most critical client-side piece — it wraps SpacetimeDB subscriptions into the interface shape that adapted goldfish components will consume.

- [ ] **Step 1: Implement useGameState hook**

`useGameState.ts` — `'use client'` hook that:
- Takes `gameId: bigint` as parameter
- Subscribes to game tables scoped to this game (see spec for subscription SQL queries)
- Uses `useTable(tables.game)`, `useTable(tables.player)`, `useTable(tables.cardInstance)`, etc.
- Derives state via `useMemo`:
  - `game` — the game row (find from rows by id)
  - `myPlayer` / `opponentPlayer` — player rows filtered by identity comparison
  - `myCards` / `opponentCards` — card_instances grouped by zone (as `Record<ZoneId, CardInstance[]>`)
  - `isMyTurn` — `game.currentTurn === myPlayer.seat`
  - `counters` — card_counter rows indexed by cardInstanceId
  - `chatMessages` — sorted by sentAt
  - `gameActions` — sorted by timestamp
  - `spectators` — spectator rows
  - `soulsRescued` — derived count of cards in land-of-redemption per player
- `card_counter` filtering: the subscription is unfiltered (no `game_id` column on card_counter). Filter client-side by checking if the `cardInstanceId` belongs to a known card_instance for this game.
- Uses `useSpacetimeDB()` to get connection and `useReducer` references
- Exposes action methods that call SpacetimeDB reducers:
  - `drawCard()` → `conn.reducers.drawCard({ gameId })`
  - `moveCard(cardInstanceId, toZone, ...)` → `conn.reducers.moveCard({ gameId, cardInstanceId, toZone, ... })`
  - `endTurn()` → `conn.reducers.endTurn({ gameId })`
  - `setPhase(phase)` → `conn.reducers.setPhase({ gameId, phase })`
  - ... and all other game actions from the spec
- All action methods are wrapped in `useCallback` with appropriate deps

**CRITICAL — Interface compatibility with goldfish components:** The return type of `useGameState()` must match the `GameContextValue` interface from `app/goldfish/state/GameContext.tsx` as closely as possible. 11 goldfish components (CardContextMenu, MultiCardContextMenu, ZoneContextMenu, DeckSearchModal, DeckPeekModal, DeckExchangeModal, ZoneBrowseModal, GameToolbar, PhaseBar, GameHUD, GoldfishCanvas) call `useGame()` directly. For multiplayer, create a `MultiplayerGameContext` that provides the same method names (drawCard, moveCard, shuffleDeck, meekCard, etc.) so these components can switch from `useGame()` to `useMultiplayerGame()` with minimal changes. The state shape should provide `zones: Record<ZoneId, GameCard[]>` matching goldfish's format, derived from the SpacetimeDB card_instance rows.

- [ ] **Step 2: Commit**

```bash
git add app/play/hooks/useGameState.ts
git commit -m "feat: implement useGameState hook — SpacetimeDB subscriptions to game context"
```

---

### Task 9: Mirror Layout

**Files:**
- Create: `app/play/layout/mirrorLayout.ts`

- [ ] **Step 1: Implement two-player zone positioning**

Reference `app/goldfish/layout/zoneLayout.ts` for the single-player layout. The mirror layout needs:

- `calculateMirrorLayout(stageWidth, stageHeight, isParagon?)` → `{ myZones: Record<ZoneId, ZoneRect>, opponentZones: Record<ZoneId, ZoneRect>, opponentHandRect: ZoneRect }`
- The layout splits the canvas vertically:
  - Top ~8%: opponent hand (card backs)
  - Top ~17%: opponent LOB + opponent sidebar (deck/discard/reserve/banish/LOR)
  - Top ~25%: opponent territory + opponent sidebar continued
  - Bottom ~25%: your territory + your sidebar
  - Bottom ~17%: your LOB + your sidebar
  - Bottom ~8%: your hand (fan)
  - Very bottom ~5%: phase bar area
- Sidebar is ~15% right column, same as goldfish
- Territory and LOB are free-form zones (support posX/posY)
- Reuse `getCardDimensions()` from goldfish for consistent card sizing
- Export `getCardDimensions` (re-export from goldfish or copy constants)

- [ ] **Step 2: Commit**

```bash
git add app/play/layout/mirrorLayout.ts
git commit -m "feat: implement mirror layout for two-player board"
```

---

### Task 10: Lobby Page

**Files:**
- Create: `app/play/page.tsx`
- Create: `app/play/components/GameLobby.tsx`

- [ ] **Step 1: Create lobby server component**

`app/play/page.tsx` — server component that:
- Requires auth (redirect to login if not authenticated)
- Fetches user's saved decks from Supabase
- Renders `<GameLobby decks={decks} />`

- [ ] **Step 2: Create GameLobby client component**

`GameLobby.tsx` — `'use client'` component with:
- Deck selector dropdown (from passed decks prop)
- "Create Game" button → calls a server action to load deck data from Supabase, then connects to SpacetimeDB, calls `createGame` reducer, shows the game code, navigates to `/play/[code]`
- "Join Game" section → text input for 4-char code + deck selector + "Join" button → loads deck, connects, calls `joinGame`, navigates to `/play/[code]`
- "Spectate" section → text input for code + "Watch" button → navigates to `/spectate/[code]`
- Display name input (pre-filled from Supabase profile)
- Format selector (T1/T2/Paragon) for create game
- Style with existing shadcn/ui components + Tailwind, matching the app's design system

- [ ] **Step 3: Create server action for loading deck data**

Create `app/play/actions.ts` with `'use server'` directive:
- `loadDeckForGame(deckId: string)` — fetches deck + cards from Supabase, returns the card data array in the format needed by the SpacetimeDB reducer (`{ cardName, cardSet, cardImgFile, cardType, brigade, strength, toughness, alignment, identifier, specialAbility }`)

- [ ] **Step 4: Commit**

```bash
git add app/play/page.tsx app/play/components/GameLobby.tsx app/play/actions.ts
git commit -m "feat: implement lobby page with create/join game flows"
```

---

### Task 11: Game Page Shell (Route + Connection)

**Files:**
- Create: `app/play/[code]/page.tsx`
- Create: `app/play/[code]/client.tsx`

- [ ] **Step 1: Create server component**

`app/play/[code]/page.tsx`:
- Receives `params.code`
- Requires auth
- Passes code to client component
- This is intentionally thin — the client component handles SpacetimeDB connection and game rendering

- [ ] **Step 2: Create client component shell**

`app/play/[code]/client.tsx` — `'use client'`:
- Uses `useSpacetimeConnection()` to connect to SpacetimeDB
- Wraps children in `SpacetimeDBProvider`
- Once connected and game data is available via subscription, renders the game canvas
- Shows loading state while connecting
- Shows error state if connection fails
- Shows "Waiting for opponent" state if game.status === Waiting
- When game.status === Playing, renders `<MultiplayerCanvas />`

- [ ] **Step 3: Commit**

```bash
git add app/play/[code]/page.tsx app/play/[code]/client.tsx
git commit -m "feat: add game page route with SpacetimeDB connection"
```

---

### Task 12: Image Preloader (Multiplayer)

**Files:**
- Create: `app/play/hooks/useMultiplayerImagePreloader.ts`

- [ ] **Step 1: Implement progressive image preloader**

Reference `app/goldfish/hooks/useImagePreloader.ts` for the base pattern. Extend it:

- Takes `myCardUrls: string[]` (known at lobby time) and `allCardUrls: string[]` (known after game starts)
- Phase 1: preloads `myCardUrls` immediately
- Phase 2: when `allCardUrls` changes (opponent joins), loads new unique URLs
- Phase 3: individual cards lazily loaded via `getImage(url)` fallback
- Returns `{ imageMap: Map<string, HTMLImageElement>, getImage: (url) => HTMLImageElement | null, isReady: boolean, progress: number }`
- Uses `Map<string, HTMLImageElement>` ref (not state) to avoid re-renders per image load
- No blocking loading screen — `isReady` just indicates initial batch complete

- [ ] **Step 2: Commit**

```bash
git add app/play/hooks/useMultiplayerImagePreloader.ts
git commit -m "feat: add progressive multiplayer image preloader"
```

---

### Task 13: Extract GameCardNode from Goldfish

**Files:**
- Create: `app/shared/components/GameCardNode.tsx`
- Modify: `app/goldfish/components/GoldfishCanvas.tsx`

`GameCardNode` is the memoized Konva component that renders a single card (image, meek rotation, counters, glow, selection border). It is currently defined inline inside `GoldfishCanvas.tsx` (not exported). Both goldfish and multiplayer need it.

- [ ] **Step 1: Extract GameCardNode into a shared file**

Copy the `GameCardNode` component (and its props interface) from `app/goldfish/components/GoldfishCanvas.tsx` into `app/shared/components/GameCardNode.tsx`. Export it.

- [ ] **Step 2: Update GoldfishCanvas to import from shared**

Replace the inline definition in `GoldfishCanvas.tsx` with an import from `app/shared/components/GameCardNode`.

- [ ] **Step 3: Verify goldfish still works**

Run: `npm run dev` and open the goldfish page. Confirm cards render correctly.

- [ ] **Step 4: Commit**

```bash
git add app/shared/components/GameCardNode.tsx app/goldfish/components/GoldfishCanvas.tsx
git commit -m "refactor: extract GameCardNode into shared component for multiplayer reuse"
```

---

### Task 14: MultiplayerCanvas — Basic Rendering

**Files:**
- Create: `app/play/components/MultiplayerCanvas.tsx`

This is the biggest component. Build it incrementally. Start with basic zone rendering and card display, then add interactivity in the next tasks.

- [ ] **Step 1: Create MultiplayerCanvas with zone backgrounds**

`MultiplayerCanvas.tsx` — `'use client'` component:
- Props: `{ gameId: bigint }`
- Uses `useGameState(gameId)` for all game data
- Uses `useMirrorLayout()` (or inline call to `calculateMirrorLayout`)
- Renders a Konva `<Stage>` filling the viewport
- Renders zone background rectangles for both players using mirror layout positions
- Labels each zone
- Renders card back placeholders in opponent hand area (count = opponent's hand card count)
- Renders your hand using `calculateHandPositions` from goldfish's `handLayout.ts`

Reference `app/goldfish/components/GoldfishCanvas.tsx` for the Konva rendering patterns — Stage, Layer, Group structure. Reuse `GameCardNode` rendering approach for individual cards (card image, meek rotation, counters overlay, selection glow).

- [ ] **Step 2: Render cards in all zones**

Iterate over `myCards` and `opponentCards` (grouped by zone from `useGameState`):
- Cards in free-form zones (territory, land-of-bondage): render at their `posX/posY`
- Cards in stacked zones (deck, discard, reserve, banish, LOR): render as a pile with count badge
- Cards in hand: render with fan positioning (yours) or card backs (opponent's)
- Cards face-down when `isFlipped` is true
- Cards rotated 180° when `isMeek` is true
- Counters displayed as colored circles (import from goldfish `GameCardNode` pattern)

- [ ] **Step 3: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: implement MultiplayerCanvas with basic zone and card rendering"
```

---

### Task 15: Drag & Drop

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Add single-card drag**

Wire up Konva drag events on card groups:
- `onDragStart`: store drag source zone, set dragging flag
- `onDragMove`: hit-test zones by card center position, highlight valid drop target
- `onDragEnd`: determine target zone from drop position, call `moveCard` reducer. If free-form zone, pass `posX/posY`. If deck, show deck-drop popup (top/bottom/shuffle). Card stays at drop position optimistically; if reducer rejects, snap back.

Reference goldfish `GoldfishCanvas.tsx` handlers: `handleCardDragStart`, `handleCardDragMove`, `handleCardDragEnd` for the pattern.

- [ ] **Step 2: Add multi-card drag**

Import and use `useSelectionState` from goldfish:
- Marquee selection on empty canvas
- Shift+click additive selection
- When dragging a selected card, create ghost image of followers (rasterize to single canvas)
- On drop, call `moveCardsBatch` reducer

- [ ] **Step 3: Add modal card drag**

Import `useModalCardDrag` from goldfish for dragging cards out of search/peek/browse modals into zones.

- [ ] **Step 4: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: add drag-and-drop with multi-select and modal drag support"
```

---

### Task 16: Turn Indicator & Phase Controls

**Files:**
- Create: `app/play/components/TurnIndicator.tsx`

- [ ] **Step 1: Implement TurnIndicator**

Adapted from goldfish's `PhaseBar.tsx`:
- Shows current turn number and whose turn it is (your name highlighted or opponent's)
- Phase buttons (Draw, Upkeep, Preparation, Battle, Discard) — clickable to jump to any phase when it's your turn
- End Turn button — calls `endTurn` reducer
- When it's opponent's turn: phase buttons show current phase but are disabled, turn indicator shows "Opponent's Turn"
- Visual: phase bar at bottom of canvas, same width as stage

Reference goldfish `PhaseBar.tsx` for the phase button layout and styling.

- [ ] **Step 2: Commit**

```bash
git add app/play/components/TurnIndicator.tsx
git commit -m "feat: add turn indicator with phase controls"
```

---

### Task 17: Context Menus

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Wire up context menus**

Import context menu components from goldfish: `CardContextMenu`, `DeckContextMenu`, `ZoneContextMenu`, `MultiCardContextMenu`, `LorContextMenu`.

These need to be adapted to call SpacetimeDB reducers instead of goldfish's `dispatch`. The adaptation approach:
- The context menus call action functions (like `moveCard`, `meekCard`, `shuffleDeck`)
- In goldfish, these come from `useGame()` — in multiplayer, they come from `useGameState()`
- Since `useGameState` exposes the same method names, the context menus can be reused if they accept the action functions as props (or if they're refactored to use a shared context interface)
- If the goldfish context menus use `useGame()` directly (they likely do), create thin wrapper components that pass `useGameState()` methods as equivalent props

Also add right-click handling on the Konva canvas to show the appropriate context menu based on what was clicked (card, zone, deck pile, empty space).

- [ ] **Step 2: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: wire up context menus for card and zone interactions"
```

---

### Task 18: Modals (Search, Peek, Browse, Exchange)

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Wire up goldfish modals**

Import from goldfish: `DeckSearchModal`, `DeckPeekModal`, `ZoneBrowseModal`, `DeckExchangeModal`, `DeckDropPopup`.

At Level 1, these work client-side — they filter/sort data that's already in the subscription. Wire them to:
- Open from context menu triggers (e.g., right-click deck → "Search Deck")
- Receive card data from `useGameState()` (your cards filtered by zone)
- On card selection/action within modal, call the appropriate SpacetimeDB reducer

Adapt the same way as context menus — pass reducer-calling functions instead of goldfish dispatch.

- [ ] **Step 2: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: integrate deck search, peek, browse, and exchange modals"
```

---

### Task 19: Opponent Hand & Connection Status

**Files:**
- Create: `app/play/components/OpponentHand.tsx`
- Create: `app/play/components/ConnectionStatus.tsx`

- [ ] **Step 1: Create OpponentHand**

Renders a row of card backs at the top of the canvas:
- Count matches opponent's actual hand size (from `opponentCards['hand'].length`)
- Konva Group with N card-back images evenly spaced
- No interactivity (can't click or drag opponent's hand)
- Shows "Opponent" label with display name

- [ ] **Step 2: Create ConnectionStatus**

Small indicator showing opponent's connection state:
- Green dot + "Connected" when `opponentPlayer.isConnected === true`
- Red dot + "Disconnected" when false, with a countdown timer (5 minutes)
- Positioned near opponent's name/hand area

- [ ] **Step 3: Wire up GameToast for multiplayer events**

Import `GameToast` from goldfish. Trigger toasts for multiplayer events:
- "Opponent drew a card"
- "Turn changed — your turn!" / "Opponent's turn"
- "Opponent disconnected"
- "Opponent reconnected"
- Deck empty warnings

- [ ] **Step 4: Commit**

```bash
git add app/play/components/OpponentHand.tsx app/play/components/ConnectionStatus.tsx
git commit -m "feat: add opponent hand display and connection status indicator"
```

---

### Task 20: Chat Panel

**Files:**
- Create: `app/play/components/ChatPanel.tsx`

- [ ] **Step 1: Implement chat + action log panel**

Slide-out panel (or toggle-able sidebar):
- Tab 1: **Chat** — message list + input field. Messages from `useGameState().chatMessages`. Send via `sendChat` reducer. Show sender name, timestamp.
- Tab 2: **Game Log** — scrolling list of game actions from `useGameState().gameActions`. Display as human-readable text (e.g., "Player 1 drew a card", "Player 2 moved Hero of Faith to territory").
- Toggle button floating at edge of screen to show/hide
- Auto-scroll to bottom on new messages
- Style with shadcn/ui components

- [ ] **Step 2: Commit**

```bash
git add app/play/components/ChatPanel.tsx
git commit -m "feat: add chat panel with game action log"
```

---

### Task 21: Dice Roll (Multiplayer)

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Wire up shared dice rolling**

- Add "Roll Dice" button to the game toolbar area
- On click: call `rollDice` reducer with sides=20 (or configurable)
- Watch `game.lastDiceRoll` field from `useGameState()` — when it changes, trigger `DiceRollOverlay` animation (import from goldfish)
- Both players see the same result and animation
- The result also appears in the game action log

- [ ] **Step 2: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: add shared dice rolling with synced animation"
```

---

### Task 22: Card Preview & Loupe Panel

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Wire up card preview system**

Import from goldfish: `CardHoverPreview`, `CardLoupePanel`, `CardZoomModal`, and `CardPreviewContext`.

- Hover preview: show card image popup on mouseover (same as goldfish)
- Loupe panel: collapsible right sidebar showing hovered card details
- Zoom modal: double-click a card to see full-size detail
- These are purely client-side visual components — no SpacetimeDB interaction needed
- Works for both your cards (full info) and opponent's visible cards (territory, LOB, discard, etc.)
- Opponent's hand cards: no preview (they're card backs)

- [ ] **Step 2: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: add card preview, loupe panel, and zoom modal"
```

---

### Task 23: Spectator View

**Files:**
- Create: `app/play/spectate/[code]/page.tsx`
- Create: `app/play/components/SpectatorBar.tsx`

- [ ] **Step 1: Create spectator page**

`spectate/[code]/page.tsx`:
- Connects to SpacetimeDB
- Calls `joinAsSpectator` reducer
- Renders the same `MultiplayerCanvas` but in read-only mode (no drag/drop, no context menus, no phase controls)
- Shows both players' hands (full info — Level 1 spectator visibility)
- Shows SpectatorBar with count of viewers

- [ ] **Step 2: Create SpectatorBar**

`SpectatorBar.tsx`:
- Shows "N spectators watching" with names on hover
- Positioned at top of screen, unobtrusive

- [ ] **Step 3: Commit**

```bash
git add app/play/spectate/[code]/page.tsx app/play/components/SpectatorBar.tsx
git commit -m "feat: add spectator view with read-only game rendering"
```

---

### Task 24: Game End & New Game Flow

**Files:**
- Modify: `app/play/[code]/client.tsx`
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Handle game end states**

When `game.status === 'Finished'`:
- Show a game-over overlay with result (who resigned, timeout, etc.)
- "Return to Lobby" button → navigates back to `/play`
- "New Game (same opponent)" button → creates a new game, shares code with opponent via chat message
- Disable all game interactions

- [ ] **Step 2: Add resign button**

Add a "Concede" button to the game toolbar area:
- Shows confirmation dialog (AlertDialog from shadcn/ui)
- On confirm: calls `resignGame` reducer
- Game ends immediately for both players

- [ ] **Step 3: Commit**

```bash
git add app/play/[code]/client.tsx app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: implement game end, concede, and new game flows"
```

---

### Task 25: CI/CD — GitHub Actions

**Files:**
- Create: `.github/workflows/deploy-spacetimedb.yml`

- [ ] **Step 1: Create GitHub Actions workflow**

See spec section "CI/CD: SpacetimeDB Module Deployment" for the full workflow YAML:
- Triggers on push to main when `spacetimedb/**` changes
- Installs SpacetimeDB CLI
- Authenticates with `SPACETIMEDB_TOKEN` secret
- Publishes module (no `--clear-database`)
- Generates bindings
- Commits bindings if changed

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy-spacetimedb.yml
git commit -m "feat: add GitHub Actions workflow for SpacetimeDB module deployment"
```

---

### Task 26: Cleanup & Polish

**Files:**
- Delete: `app/play/play/` (entire directory — old chat prototype)
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Remove old prototype**

Delete the `app/play/play/` directory (SpacetimeDB chat quickstart). Its useful content has been preserved in `spacetimedb/CLAUDE.md`.

- [ ] **Step 2: End-to-end smoke test**

Manual testing checklist:
1. Start local SpacetimeDB: `spacetime start`
2. Publish module: `spacetime publish redemption-multiplayer --clear-database -y --module-path spacetimedb`
3. Generate bindings: `spacetime generate --lang typescript --out-dir lib/spacetimedb/module_bindings --module-path spacetimedb`
4. Start Next.js: `npm run dev`
5. Open two browser windows (different users)
6. Window 1: Create game with a saved deck → see game code
7. Window 2: Join game with the code and a different deck
8. Both windows should show the game board with cards
9. Test: drag a card from hand to territory → appears on both screens
10. Test: advance phase, end turn → turn switches
11. Test: chat message → appears on both screens
12. Test: roll dice → animation on both screens
13. Test: resign → game ends for both

- [ ] **Step 3: Fix any issues found in smoke test**

Address bugs discovered during manual testing.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: cleanup old prototype, verify multiplayer end-to-end"
```
