# Play Mode Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hand zone context menu with random card actions, mid-game deck swap, and automated stale game cleanup.

**Architecture:** Three independent features sharing the SpacetimeDB module. Feature 3 (cleanup) is server-only. Features 1 and 2 add new reducers + UI. All features follow existing patterns: reducers in `spacetimedb/src/index.ts`, UI components matching `DeckContextMenu` style.

**Tech Stack:** SpacetimeDB (TypeScript server module), React, react-konva, Framer Motion

---

### Task 1: Add stale game cleanup scheduled reducer

**Files:**
- Modify: `spacetimedb/src/schema.ts` (new CleanupSchedule table, add to schema export)
- Modify: `spacetimedb/src/index.ts` (new reducer + scheduling logic)

- [ ] **Step 1: Add CleanupSchedule table to schema**

In `spacetimedb/src/schema.ts`, add a new scheduled table before the schema export (before line 238). Follow the `DisconnectTimeout` pattern:

```typescript
// ---------------------------------------------------------------------------
// 10. CleanupSchedule
// ---------------------------------------------------------------------------
let _handleCleanupStaleGames: any;
export const setCleanupStaleGamesReducer = (reducer: any) => {
  _handleCleanupStaleGames = reducer;
};

export const CleanupSchedule = table(
  {
    name: 'cleanup_schedule',
    public: true,
    scheduled: () => _handleCleanupStaleGames,
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);
```

Then add `CleanupSchedule` to the schema export:

```typescript
const spacetimedb = schema({
  Game,
  Player,
  CardInstance,
  CardCounter,
  GameAction,
  ChatMessage,
  Spectator,
  DisconnectTimeout,
  ZoneSearchRequest,
  CleanupSchedule,
});
```

- [ ] **Step 2: Add the cleanup reducer**

In `spacetimedb/src/index.ts`, add after the `handle_disconnect_timeout` reducer (after line 870). Import the new table and setter:

```typescript
import { CleanupSchedule, setCleanupStaleGamesReducer } from './schema';
```

Add this at the top of `index.ts` imports (line 3 area).

Then add the reducer:

```typescript
// ---------------------------------------------------------------------------
// Scheduled reducer: cleanup_stale_games
// ---------------------------------------------------------------------------
const ONE_HOUR_MICROS = 3_600_000_000n;
const THIRTY_MIN_MICROS = 1_800_000_000n;
const TWENTY_FOUR_HOURS_MICROS = 86_400_000_000n;

export const cleanup_stale_games = spacetimedb.reducer(
  { arg: CleanupSchedule.rowType },
  (ctx, { arg }) => {
    const now = ctx.timestamp.microsSinceUnixEpoch;

    // 1. Abandon waiting games older than 1 hour
    for (const game of [...ctx.db.Game.iter()]) {
      if (game.status === 'waiting' && (now - game.createdAt.microsSinceUnixEpoch) > ONE_HOUR_MICROS) {
        ctx.db.Game.id.update({ ...game, status: 'finished' });
      }
    }

    // 2. Abandon pregame games older than 30 minutes
    for (const game of [...ctx.db.Game.iter()]) {
      if (game.status === 'pregame' && (now - game.createdAt.microsSinceUnixEpoch) > THIRTY_MIN_MICROS) {
        ctx.db.Game.id.update({ ...game, status: 'finished' });
      }
    }

    // 3. Abandon playing games where both players disconnected and no recent activity
    for (const game of [...ctx.db.Game.iter()]) {
      if (game.status !== 'playing') continue;
      const players = [...ctx.db.Player.player_game_id.filter(game.id)];
      const allDisconnected = players.length > 0 && players.every((p: any) => !p.isConnected);
      if (!allDisconnected) continue;

      // Check for recent game actions
      let latestActionTime = 0n;
      for (const action of ctx.db.GameAction.game_action_game_id.filter(game.id)) {
        const actionTime = action.timestamp.microsSinceUnixEpoch;
        if (actionTime > latestActionTime) latestActionTime = actionTime;
      }
      if (latestActionTime === 0n) latestActionTime = game.createdAt.microsSinceUnixEpoch;

      if ((now - latestActionTime) > THIRTY_MIN_MICROS) {
        ctx.db.Game.id.update({ ...game, status: 'finished' });
      }
    }

    // 4. Delete data for finished games older than 24 hours
    for (const game of [...ctx.db.Game.iter()]) {
      if (game.status !== 'finished') continue;
      if ((now - game.createdAt.microsSinceUnixEpoch) <= TWENTY_FOUR_HOURS_MICROS) continue;

      const gameId = game.id;

      // Delete card counters for all cards in this game
      for (const card of [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)]) {
        for (const counter of [...ctx.db.CardCounter.card_counter_card_instance_id.filter(card.id)]) {
          ctx.db.CardCounter.id.delete(counter.id);
        }
        ctx.db.CardInstance.id.delete(card.id);
      }

      // Delete game actions
      for (const action of [...ctx.db.GameAction.game_action_game_id.filter(gameId)]) {
        ctx.db.GameAction.id.delete(action.id);
      }

      // Delete chat messages
      for (const msg of [...ctx.db.ChatMessage.chat_message_game_id.filter(gameId)]) {
        ctx.db.ChatMessage.id.delete(msg.id);
      }

      // Delete spectators
      for (const spec of [...ctx.db.Spectator.spectator_game_id.filter(gameId)]) {
        ctx.db.Spectator.id.delete(spec.id);
      }

      // Delete zone search requests
      for (const req of [...ctx.db.ZoneSearchRequest.zone_search_request_game_id.filter(gameId)]) {
        ctx.db.ZoneSearchRequest.id.delete(req.id);
      }

      // Delete players
      for (const player of [...ctx.db.Player.player_game_id.filter(gameId)]) {
        ctx.db.Player.id.delete(player.id);
      }

      // Delete the game itself
      ctx.db.Game.id.delete(gameId);
    }

    // Schedule next cleanup in 1 hour
    ctx.db.CleanupSchedule.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.time(now + ONE_HOUR_MICROS),
    });
  }
);

setCleanupStaleGamesReducer(cleanup_stale_games);
```

- [ ] **Step 3: Seed initial cleanup schedule**

Add to the existing `clientConnected` lifecycle hook (or init). Find the `spacetimedb.clientConnected` call. Inside it, check if a cleanup schedule already exists and seed one if not:

```typescript
// Inside clientConnected, after existing logic:
// Seed cleanup schedule if none exists
const existingCleanup = [...ctx.db.CleanupSchedule.iter()];
if (existingCleanup.length === 0) {
  ctx.db.CleanupSchedule.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + ONE_HOUR_MICROS),
  });
}
```

- [ ] **Step 4: Publish module, regenerate bindings, verify**

```bash
cd spacetimedb && spacetime publish redemption-game --module-path . && cd ..
spacetime generate --lang typescript --out-dir lib/spacetimedb/module_bindings --module-path spacetimedb
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add spacetimedb/src/schema.ts spacetimedb/src/index.ts lib/spacetimedb/module_bindings/
git commit -m "feat: add scheduled stale game cleanup (1hr waiting, 30min pregame, 24hr finished)"
```

---

### Task 2: Add random_hand_to_zone SpacetimeDB reducer

**Files:**
- Modify: `spacetimedb/src/index.ts` (new reducer)

- [ ] **Step 1: Add the random_hand_to_zone reducer**

In `spacetimedb/src/index.ts`, add after the existing shuffle-related reducers (after the `shuffle_card_into_deck` reducer). The reducer picks N random cards from the player's hand and moves them to the target zone using the seeded PRNG:

```typescript
// ---------------------------------------------------------------------------
// Reducer: random_hand_to_zone
// ---------------------------------------------------------------------------
export const random_hand_to_zone = spacetimedb.reducer(
  {
    gameId: t.u64(),
    count: t.u64(),
    toZone: t.string(),
    deckPosition: t.string(),
  },
  (ctx, { gameId, count, toZone, deckPosition }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    // Get all cards in the player's hand
    const handCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === player.id && c.zone === 'hand'
    );

    if (handCards.length === 0) throw new SenderError('No cards in hand');

    const actualCount = Math.min(Number(count), handCards.length);

    // Use seeded PRNG to pick random cards
    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });
    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, player.id, newRngCounter);
    const rng = xorshift64(seed);

    // Fisher-Yates partial shuffle to pick `actualCount` random indices
    const indices = handCards.map((_: any, i: number) => i);
    for (let i = indices.length - 1; i > indices.length - 1 - actualCount && i > 0; i--) {
      const j = Number(rng.next() % BigInt(i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const pickedCards = indices.slice(indices.length - actualCount).map((i: number) => handCards[i]);

    // Determine max zoneIndex for deck placement
    let maxDeckIndex = 0n;
    if (toZone === 'deck') {
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === player.id && c.zone === 'deck' && c.zoneIndex > maxDeckIndex) {
          maxDeckIndex = c.zoneIndex;
        }
      }
    }

    // Move each picked card
    const movedNames: string[] = [];
    for (let i = 0; i < pickedCards.length; i++) {
      const card = pickedCards[i];
      movedNames.push(card.cardName);

      let newZoneIndex = 0n;
      if (toZone === 'deck') {
        if (deckPosition === 'top') {
          // Top = lowest zoneIndex. Shift existing cards or use negative approach.
          // Simpler: set to -1n offset from current min, then we'll normalize after
          newZoneIndex = BigInt(-(i + 1));
        } else if (deckPosition === 'bottom') {
          newZoneIndex = maxDeckIndex + BigInt(i + 1);
        }
        // 'shuffle' handled after moving all cards
      }

      ctx.db.CardInstance.id.update({
        ...card,
        zone: toZone,
        zoneIndex: newZoneIndex,
        posX: '',
        posY: '',
      });
    }

    // If shuffle into deck, shuffle the entire deck now
    if (toZone === 'deck' && deckPosition === 'shuffle') {
      const latestGame = ctx.db.Game.id.find(gameId);
      if (!latestGame) return;
      const shuffleRng = latestGame.rngCounter + 1n;
      ctx.db.Game.id.update({ ...latestGame, rngCounter: shuffleRng });

      const allDeckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.ownerId === player.id && c.zone === 'deck'
      );
      const shuffleIndices = allDeckCards.map((_: any, idx: number) => idx);
      const shuffleSeed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, player.id, shuffleRng);
      seededShuffle(shuffleIndices, shuffleSeed);
      for (let i = 0; i < allDeckCards.length; i++) {
        ctx.db.CardInstance.id.update({ ...allDeckCards[i], zoneIndex: BigInt(shuffleIndices[i]) });
      }
    }

    const destLabel = toZone === 'deck' ? `deck (${deckPosition})` : toZone;
    logAction(ctx, gameId, player.id, 'RANDOM_HAND_TO_ZONE',
      JSON.stringify({ cards: movedNames, destination: destLabel, count: actualCount }),
      game.turnNumber, game.currentPhase);
  }
);
```

- [ ] **Step 2: Wire client-side action**

In `app/play/hooks/useGameState.ts`, find where other actions like `shuffleDeck` are defined. Add `randomHandToZone`:

```typescript
const randomHandToZone = useCallback(
  (count: number, toZone: string, deckPosition: string) => {
    conn?.reducers.randomHandToZone({ gameId, count: BigInt(count), toZone, deckPosition });
  },
  [conn, gameId],
);
```

Add it to the returned `actions` object and to the `GameActions` interface in `app/shared/types/gameActions.ts`:

```typescript
randomHandToZone: (count: number, toZone: string, deckPosition: string) => void;
```

- [ ] **Step 3: Publish and regenerate**

```bash
cd spacetimedb && spacetime publish redemption-game --module-path . && cd ..
spacetime generate --lang typescript --out-dir lib/spacetimedb/module_bindings --module-path spacetimedb
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add spacetimedb/ lib/spacetimedb/module_bindings/ app/play/hooks/useGameState.ts app/shared/types/gameActions.ts
git commit -m "feat: add random_hand_to_zone SpacetimeDB reducer and client action"
```

---

### Task 3: Create HandContextMenu component

**Files:**
- Create: `app/shared/components/HandContextMenu.tsx`

- [ ] **Step 1: Create the HandContextMenu component**

Create `app/shared/components/HandContextMenu.tsx`. Model it after `DeckContextMenu.tsx` — reuse the same `SubmenuLockContext`, `ActiveSubmenuContext`, `SubmenuTrigger`, and `SubMenuActionRow` pattern. The menu has 5 rows, each with quick-count buttons (1, 3, 6, X):

```typescript
'use client';

import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Archive, ChevronUp, ChevronDown, Shuffle } from 'lucide-react';

// Reuse the same context/submenu pattern from DeckContextMenu
const SubmenuLockContext = createContext<{ lock: () => void; unlock: () => void } | null>(null);
const ActiveSubmenuContext = createContext<{
  active: string | null;
  setActive: (label: string | null) => void;
  closeTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
} | null>(null);

interface HandContextMenuProps {
  x: number;
  y: number;
  handSize: number;
  onClose: () => void;
  onRandomToDiscard: (count: number) => void;
  onRandomToReserve: (count: number) => void;
  onRandomToDeckTop: (count: number) => void;
  onRandomToDeckBottom: (count: number) => void;
  onShuffleRandomIntoDeck: (count: number) => void;
}

export function HandContextMenu({
  x, y, handSize, onClose,
  onRandomToDiscard, onRandomToReserve,
  onRandomToDeckTop, onRandomToDeckBottom,
  onShuffleRandomIntoDeck,
}: HandContextMenuProps) {
  // ... (same positioning, backdrop, submenu coordination pattern as DeckContextMenu)
  // Menu items:
  // 1. Random to Discard     [Trash2 icon]  [1] [3] [6] [X...]
  // 2. Random to Reserve     [Archive icon] [1] [3] [6] [X...]
  // 3. Random to Deck Top    [ChevronUp]    [1] [3] [6] [X...]
  // 4. Random to Deck Bottom [ChevronDown]  [1] [3] [6] [X...]
  // 5. Shuffle into Deck     [Shuffle]      [1] [3] [6] [X...]
}
```

Copy the full `SubmenuTrigger`, `SubMenuActionRow`, `ITEM_STYLE`, `QUICK_BTN_STYLE`, positioning logic, and backdrop click-away from `DeckContextMenu.tsx`. Replace the menu items with the 5 hand random actions.

Each row calls its callback with the count. The "X..." stepper should cap at `handSize`.

The header should show "Hand (N cards)" where N is `handSize`.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/shared/components/HandContextMenu.tsx
git commit -m "feat: create HandContextMenu component with random card actions"
```

---

### Task 4: Wire HandContextMenu into MultiplayerCanvas

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Add hand menu state and handler**

In `MultiplayerCanvas.tsx`, add state for the hand context menu near the other menu states (around line 398):

```typescript
const [handMenu, setHandMenu] = useState<{ x: number; y: number } | null>(null);
```

Add `handMenu` clearing to the `closeAllMenus` function.

- [ ] **Step 2: Add right-click handler on hand zone background**

Find the hand zone background `<Rect>` (around line 1488 — the "My hand" rect). Add an `onContextMenu` handler:

```typescript
<Rect
  x={myHandRect.x}
  y={myHandRect.y}
  width={myHandRect.width}
  height={myHandRect.height}
  fill="#0d0905"
  opacity={0.5}
  onContextMenu={(e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const container = stage.container().getBoundingClientRect();
    closeAllMenus();
    setHandMenu({
      x: e.evt.clientX - container.left,
      y: e.evt.clientY - container.top,
    });
  }}
/>
```

Note: the Rect currently has no `onContextMenu` — you're adding it.

- [ ] **Step 3: Render the HandContextMenu**

Near where `DeckContextMenu` is rendered (around line 2334), add:

```typescript
{handMenu && (
  <HandContextMenu
    x={handMenu.x}
    y={handMenu.y}
    handSize={myCards['hand']?.length ?? 0}
    onClose={() => setHandMenu(null)}
    onRandomToDiscard={(count) => { setHandMenu(null); multiplayerActions.randomHandToZone(count, 'discard', ''); }}
    onRandomToReserve={(count) => { setHandMenu(null); multiplayerActions.randomHandToZone(count, 'reserve', ''); }}
    onRandomToDeckTop={(count) => { setHandMenu(null); multiplayerActions.randomHandToZone(count, 'deck', 'top'); }}
    onRandomToDeckBottom={(count) => { setHandMenu(null); multiplayerActions.randomHandToZone(count, 'deck', 'bottom'); }}
    onShuffleRandomIntoDeck={(count) => { setHandMenu(null); multiplayerActions.randomHandToZone(count, 'deck', 'shuffle'); }}
  />
)}
```

Import `HandContextMenu` at the top of the file.

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: wire hand zone right-click menu with random card actions"
```

---

### Task 5: Add reload_deck SpacetimeDB reducer

**Files:**
- Modify: `spacetimedb/src/index.ts` (new reducer)

- [ ] **Step 1: Add the reload_deck reducer**

In `spacetimedb/src/index.ts`, add after the `random_hand_to_zone` reducer:

```typescript
// ---------------------------------------------------------------------------
// Reducer: reload_deck
// ---------------------------------------------------------------------------
export const reload_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
    deckId: t.string(),
    deckData: t.string(),
  },
  (ctx, { gameId, deckId, deckData }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    // Validate deck data
    try { JSON.parse(deckData); } catch {
      throw new SenderError('Invalid deck data');
    }

    // 1. Delete all card instances and counters for this player
    for (const card of [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)]) {
      if (card.ownerId !== player.id) continue;
      for (const counter of [...ctx.db.CardCounter.card_counter_card_instance_id.filter(card.id)]) {
        ctx.db.CardCounter.id.delete(counter.id);
      }
      ctx.db.CardInstance.id.delete(card.id);
    }

    // 2. Update player's deck ID
    ctx.db.Player.id.update({ ...player, deckId });

    // 3. Insert new cards, shuffle, draw opening hand
    const currentGame = ctx.db.Game.id.find(gameId);
    if (!currentGame) throw new SenderError('Game not found');
    insertCardsShuffleDraw(ctx, currentGame, player, deckData);

    logAction(ctx, gameId, player.id, 'RELOAD_DECK',
      JSON.stringify({ deckId }),
      game.turnNumber, game.currentPhase);
  }
);
```

- [ ] **Step 2: Wire client-side action**

In `app/play/hooks/useGameState.ts`, add:

```typescript
const reloadDeck = useCallback(
  (deckId: string, deckData: string) => {
    conn?.reducers.reloadDeck({ gameId, deckId, deckData });
  },
  [conn, gameId],
);
```

Add to the returned `actions` object and `GameActions` interface:

```typescript
reloadDeck: (deckId: string, deckData: string) => void;
```

- [ ] **Step 3: Publish and regenerate**

```bash
cd spacetimedb && spacetime publish redemption-game --module-path . && cd ..
spacetime generate --lang typescript --out-dir lib/spacetimedb/module_bindings --module-path spacetimedb
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add spacetimedb/ lib/spacetimedb/module_bindings/ app/play/hooks/useGameState.ts app/shared/types/gameActions.ts
git commit -m "feat: add reload_deck SpacetimeDB reducer for mid-game deck swap"
```

---

### Task 6: Add Load Deck UI to toolbar and canvas

**Files:**
- Modify: `app/shared/components/GameToolbar.tsx` (new button + callback prop)
- Modify: `app/play/components/MultiplayerCanvas.tsx` (deck picker modal state, confirmation, reducer call)

- [ ] **Step 1: Add onLoadDeck prop to GameToolbar**

In `GameToolbar.tsx`, add to `GameToolbarProps`:

```typescript
/** Called to trigger mid-game deck reload (multiplayer only). */
onLoadDeck?: () => void;
```

Add to the destructured props and add a new button in the `buttons` array after "End Turn":

```typescript
// Load Deck — multiplayer only
{
  icon: RefreshCw,
  label: 'Load Deck',
  onClick: onLoadDeck ?? (() => {}),
  shortcut: '',
  hidden: !isMultiplayer,
},
```

Import `RefreshCw` from `lucide-react`.

- [ ] **Step 2: Add deck reload flow in MultiplayerCanvas**

In `MultiplayerCanvas.tsx`, add state:

```typescript
const [showReloadDeckPicker, setShowReloadDeckPicker] = useState(false);
const [reloadDeckConfirm, setReloadDeckConfirm] = useState<{ deckId: string; deckName: string; deckData: string } | null>(null);
```

Pass `onLoadDeck={() => setShowReloadDeckPicker(true)}` to the `GameToolbar` component.

Render the `DeckPickerModal` conditionally:

```typescript
{showReloadDeckPicker && (
  <DeckPickerModal
    onClose={() => setShowReloadDeckPicker(false)}
    onSelect={async (deck) => {
      const result = await loadDeckForGame(deck.id);
      setShowReloadDeckPicker(false);
      setReloadDeckConfirm({ deckId: deck.id, deckName: deck.name, deckData: result.deckData });
    }}
  />
)}
```

Import `DeckPickerModal` and `loadDeckForGame` at the top.

Render a confirmation dialog when `reloadDeckConfirm` is set — a simple modal with "This will clear all your cards from the game and load [deckName]. Continue?" with Cancel/Confirm buttons. On confirm, call `multiplayerActions.reloadDeck(reloadDeckConfirm.deckId, reloadDeckConfirm.deckData)` and clear the state.

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit
git add app/shared/components/GameToolbar.tsx app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: add Load Deck button for mid-game deck swap"
```

---

## Summary

| Task | Feature | Files Changed |
|------|---------|---------------|
| 1 | Stale game cleanup | `schema.ts`, `index.ts`, bindings |
| 2 | Random hand reducer | `index.ts`, `useGameState.ts`, `gameActions.ts`, bindings |
| 3 | HandContextMenu component | `HandContextMenu.tsx` (new) |
| 4 | Wire hand menu into canvas | `MultiplayerCanvas.tsx` |
| 5 | Reload deck reducer | `index.ts`, `useGameState.ts`, `gameActions.ts`, bindings |
| 6 | Load Deck UI | `GameToolbar.tsx`, `MultiplayerCanvas.tsx` |
