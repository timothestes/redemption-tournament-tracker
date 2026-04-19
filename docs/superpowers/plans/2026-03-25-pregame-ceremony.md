# Pre-Game Ceremony Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pre-game ceremony where players ready up, roll dice to determine who chooses first player, and can swap decks before readying.

**Architecture:** New `pregame` game status with server-driven sub-phases (`deck_select` → `rolling` → `choosing`). SpacetimeDB schema gets 6 new Game fields and 1 new Player field. Four new reducers handle the ceremony. A new `PregameScreen` React component renders the UI.

**Tech Stack:** SpacetimeDB (TypeScript server module), Next.js App Router, React, Tailwind CSS + shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-25-pregame-ceremony-design.md`

**Key reference:** `spacetimedb/CLAUDE.md` — READ THIS before writing any SpacetimeDB code. Contains critical SDK gotchas.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `spacetimedb/src/schema.ts` | Add new fields to Game and Player tables |
| `spacetimedb/src/index.ts` | Add 4 new reducers, modify `create_game`, `join_game`, `clientDisconnected` |
| `app/play/hooks/useGameState.ts` | Expose pregame action methods on GameState interface |
| `app/play/[code]/client.tsx` | Add `'pregame'` lifecycle state, render PregameScreen, fix reconnect |
| `app/play/components/PregameScreen.tsx` | **New** — pregame ceremony UI (deck select, roll, choose) |
| `app/play/actions.ts` | Add `loadUserDecks` server action for pregame deck picker |
| `lib/spacetimedb/module_bindings/` | Regenerated client bindings (auto-generated, do not hand-edit) |

---

## Task 1: Schema Changes — Game and Player Tables

**Files:**
- Modify: `spacetimedb/src/schema.ts:6-30` (Game table)
- Modify: `spacetimedb/src/schema.ts:35-54` (Player table)

- [ ] **Step 1: Add new fields to Game table**

In `spacetimedb/src/schema.ts`, add these fields to the Game table columns (second argument of `table()`), after `createdByName`:

```typescript
pregamePhase: t.string(),     // "" | "deck_select" | "rolling" | "choosing"
pregameReady0: t.bool(),      // seat 0 ready (reused for roll ack)
pregameReady1: t.bool(),      // seat 1 ready (reused for roll ack)
rollWinner: t.string(),       // "" | "0" | "1" — string to avoid 0n ambiguity
rollResult0: t.u64(),         // d20 result for seat 0
rollResult1: t.u64(),         // d20 result for seat 1
```

- [ ] **Step 2: Add `pendingDeckData` field to Player table**

In the Player table columns, add after `autoRouteLostSouls`:

```typescript
pendingDeckData: t.string(),  // JSON deck data, stored until game starts
```

- [ ] **Step 3: Verify schema compiles**

Run: `cd spacetimedb && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add spacetimedb/src/schema.ts
git commit -m "feat(stdb): add pregame ceremony fields to Game and Player tables"
```

---

## Task 2: Modify Existing Reducers — `create_game` and `join_game`

**Files:**
- Modify: `spacetimedb/src/index.ts:179-235` (`create_game`)
- Modify: `spacetimedb/src/index.ts:240-291` (`join_game`)

- [ ] **Step 1: Modify `create_game` — defer card loading**

In the `create_game` reducer:

1. Add the new fields to the `Game.insert()` call (after `createdByName`):
```typescript
pregamePhase: '',
pregameReady0: false,
pregameReady1: false,
rollWinner: '',
rollResult0: 0n,
rollResult1: 0n,
```

2. Add `pendingDeckData: deckData` to the `Player.insert()` call (after `autoRouteLostSouls`).

3. **Remove** the call to `insertCardsShuffleDraw(ctx, game, player, deckData)` — cards are now deferred until `pregame_choose_first`.

- [ ] **Step 2: Modify `join_game` — transition to pregame instead of playing**

In the `join_game` reducer:

1. Add `pendingDeckData: deckData` to the `Player.insert()` call.

2. **Remove** the call to `insertCardsShuffleDraw(ctx, game, player, deckData)`.

3. Change the `Game.id.update()` call from:
```typescript
ctx.db.Game.id.update({
  ...latestGame,
  status: 'playing',
  currentTurn: 0n,
  currentPhase: 'draw',
  turnNumber: 1n,
});
```
To:
```typescript
ctx.db.Game.id.update({
  ...latestGame,
  status: 'pregame',
  pregamePhase: 'deck_select',
});
```

4. Change the `logAction` call from `'GAME_STARTED'` to `'PLAYER_JOINED'`.

- [ ] **Step 3: Verify compilation**

Run: `cd spacetimedb && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "feat(stdb): defer card loading, transition to pregame on join"
```

---

## Task 3: New Reducers — Pregame Ceremony

**Files:**
- Modify: `spacetimedb/src/index.ts` (add after `join_game` reducer, before `join_as_spectator`)

- [ ] **Step 1: Add `pregame_ready` reducer**

Add after the `join_game` reducer:

```typescript
// ---------------------------------------------------------------------------
// Reducer: pregame_ready
// ---------------------------------------------------------------------------
export const pregame_ready = spacetimedb.reducer(
  {
    gameId: t.u64(),
    ready: t.bool(),
  },
  (ctx, { gameId, ready }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'pregame') throw new SenderError('Game is not in pregame');
    if (game.pregamePhase !== 'deck_select') throw new SenderError('Not in deck select phase');

    const player = findPlayerBySender(ctx, gameId);

    // Set ready flag for this player's seat
    const updates: any = { ...game };
    if (player.seat === 0n) {
      updates.pregameReady0 = ready;
    } else {
      updates.pregameReady1 = ready;
    }
    ctx.db.Game.id.update(updates);

    logAction(ctx, gameId, player.id, 'PREGAME_READY',
      JSON.stringify({ seat: player.seat.toString(), ready }),
      0n, 'pregame');

    // If un-readying, stop here
    if (!ready) return;

    // Check if both are now ready
    const latestGame = ctx.db.Game.id.find(gameId);
    if (!latestGame) return;
    if (!latestGame.pregameReady0 || !latestGame.pregameReady1) return;

    // Both ready — roll dice
    const seed = makeSeed(
      ctx.timestamp.microsSinceUnixEpoch,
      gameId,
      0n, // neutral — not player-specific
      latestGame.rngCounter
    );
    const rng = xorshift64(seed);

    let r0: number, r1: number;
    do {
      r0 = Number(rng.next() % 20n) + 1;
      r1 = Number(rng.next() % 20n) + 1;
    } while (r0 === r1);

    const winner = r0 > r1 ? '0' : '1';

    ctx.db.Game.id.update({
      ...latestGame,
      pregameReady0: false, // reset for roll acknowledgment
      pregameReady1: false,
      pregamePhase: 'rolling',
      rollResult0: BigInt(r0),
      rollResult1: BigInt(r1),
      rollWinner: winner,
      rngCounter: latestGame.rngCounter + 1n,
    });

    logAction(ctx, gameId, player.id, 'PREGAME_ROLL',
      JSON.stringify({ result0: r0, result1: r1, winner }),
      0n, 'pregame');
  }
);
```

Note: This imports `xorshift64` from `./utils` — it's already imported via `makeSeed` at the top of `index.ts`. Add `xorshift64` to the import line:
```typescript
import { makeSeed, seededShuffle, seededDiceRoll, xorshift64, generateGameCode } from './utils';
```

- [ ] **Step 2: Add `pregame_acknowledge_roll` reducer**

```typescript
// ---------------------------------------------------------------------------
// Reducer: pregame_acknowledge_roll
// ---------------------------------------------------------------------------
export const pregame_acknowledge_roll = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'pregame') throw new SenderError('Game is not in pregame');
    if (game.pregamePhase !== 'rolling') throw new SenderError('Not in rolling phase');

    const player = findPlayerBySender(ctx, gameId);

    const updates: any = { ...game };
    if (player.seat === 0n) {
      updates.pregameReady0 = true;
    } else {
      updates.pregameReady1 = true;
    }
    ctx.db.Game.id.update(updates);

    // Check if both acknowledged
    const latestGame = ctx.db.Game.id.find(gameId);
    if (!latestGame) return;
    if (!latestGame.pregameReady0 || !latestGame.pregameReady1) return;

    // Both acknowledged — move to choosing
    ctx.db.Game.id.update({
      ...latestGame,
      pregamePhase: 'choosing',
    });
  }
);
```

- [ ] **Step 3: Add `pregame_choose_first` reducer**

```typescript
// ---------------------------------------------------------------------------
// Reducer: pregame_choose_first
// ---------------------------------------------------------------------------
export const pregame_choose_first = spacetimedb.reducer(
  {
    gameId: t.u64(),
    chosenSeat: t.u64(),
  },
  (ctx, { gameId, chosenSeat }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'pregame') throw new SenderError('Game is not in pregame');
    if (game.pregamePhase !== 'choosing') throw new SenderError('Not in choosing phase');
    if (chosenSeat !== 0n && chosenSeat !== 1n) throw new SenderError('Invalid seat');

    const player = findPlayerBySender(ctx, gameId);
    if (player.seat.toString() !== game.rollWinner) {
      throw new SenderError('Only the roll winner can choose');
    }

    // Load decks for both players
    const players: any[] = [...ctx.db.Player.player_game_id.filter(gameId)];
    for (const p of players) {
      if (!p.pendingDeckData || p.pendingDeckData === '') {
        throw new SenderError('Player ' + p.displayName + ' has no deck data');
      }
      // Validate JSON
      try { JSON.parse(p.pendingDeckData); } catch {
        throw new SenderError('Invalid deck data for ' + p.displayName);
      }
    }

    // Insert cards, shuffle, and draw for both players
    // Re-read game before each call since insertCardsShuffleDraw increments rngCounter
    for (const p of players) {
      const currentGame = ctx.db.Game.id.find(gameId);
      if (!currentGame) throw new SenderError('Game not found');
      insertCardsShuffleDraw(ctx, currentGame, p, p.pendingDeckData);
      // Clear pending data
      const latestPlayer = ctx.db.Player.id.find(p.id);
      if (latestPlayer) {
        ctx.db.Player.id.update({ ...latestPlayer, pendingDeckData: '' });
      }
    }

    // Start the game
    const latestGame = ctx.db.Game.id.find(gameId);
    if (!latestGame) throw new SenderError('Game not found');
    ctx.db.Game.id.update({
      ...latestGame,
      status: 'playing',
      pregamePhase: '',
      currentTurn: chosenSeat,
      currentPhase: 'draw',
      turnNumber: 1n,
    });

    logAction(ctx, gameId, player.id, 'GAME_STARTED',
      JSON.stringify({ chosenSeat: chosenSeat.toString(), chosenBy: player.displayName }),
      1n, 'draw');
  }
);
```

- [ ] **Step 4: Add `pregame_change_deck` reducer**

```typescript
// ---------------------------------------------------------------------------
// Reducer: pregame_change_deck
// ---------------------------------------------------------------------------
export const pregame_change_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
    deckId: t.string(),
    deckData: t.string(),
  },
  (ctx, { gameId, deckId, deckData }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'pregame') throw new SenderError('Game is not in pregame');
    if (game.pregamePhase !== 'deck_select') throw new SenderError('Not in deck select phase');

    const player = findPlayerBySender(ctx, gameId);

    // Must not be ready
    const isReady = player.seat === 0n ? game.pregameReady0 : game.pregameReady1;
    if (isReady) throw new SenderError('Cannot change deck while ready');

    // Validate deck data
    try {
      const parsed = JSON.parse(deckData);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('not array or empty');
    } catch {
      throw new SenderError('Invalid deck data');
    }

    ctx.db.Player.id.update({ ...player, deckId, pendingDeckData: deckData });

    logAction(ctx, gameId, player.id, 'PREGAME_DECK_CHANGE',
      JSON.stringify({ seat: player.seat.toString(), newDeckId: deckId }),
      0n, 'pregame');
  }
);
```

- [ ] **Step 5: Add `xorshift64` to imports**

At the top of `spacetimedb/src/index.ts`, update the import:
```typescript
import { makeSeed, seededShuffle, seededDiceRoll, xorshift64, generateGameCode } from './utils';
```
(Add `xorshift64` — `generateGameCode` may or may not already be imported; check first.)

- [ ] **Step 6: Verify compilation**

Run: `cd spacetimedb && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "feat(stdb): add pregame_ready, pregame_acknowledge_roll, pregame_choose_first, pregame_change_deck reducers"
```

---

## Task 4: Modify `clientDisconnected` — Cancel Game During Pregame

**Files:**
- Modify: `spacetimedb/src/index.ts:1240-1256` (`clientDisconnected`)

- [ ] **Step 1: Add pregame cancellation logic**

In the `clientDisconnected` handler, after setting `isConnected: false` and before scheduling the disconnect timeout, add:

```typescript
// If game is in pregame, cancel immediately — no state to preserve
const gameForPlayer = ctx.db.Game.id.find(player.gameId);
if (gameForPlayer && gameForPlayer.status === 'pregame') {
  ctx.db.Game.id.update({ ...gameForPlayer, status: 'finished' });
  logAction(
    ctx,
    player.gameId,
    player.id,
    'PREGAME_DISCONNECT',
    JSON.stringify({ reason: 'opponent_disconnected' }),
    0n,
    'pregame'
  );
  continue; // Skip scheduling timeout for pregame games
}
```

The `continue` skips the `DisconnectTimeout.insert` that follows. Note: the existing loop uses `for...of`, so `continue` works.

- [ ] **Step 2: Verify compilation**

Run: `cd spacetimedb && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "feat(stdb): cancel game immediately on disconnect during pregame"
```

---

## Task 5: Publish Module and Regenerate Bindings

**Files:**
- Modify: `lib/spacetimedb/module_bindings/` (auto-generated)

- [ ] **Step 1: Publish the updated module**

Run: `spacetime publish redemption-game --clear-database -y --module-path spacetimedb`

This will clear existing game data (expected during development) and deploy the new schema.

- [ ] **Step 2: Regenerate client bindings**

Run: `spacetime generate --lang typescript --out-dir lib/spacetimedb/module_bindings --module-path spacetimedb`

- [ ] **Step 3: Verify new types exist**

Check that `lib/spacetimedb/module_bindings/types/` includes the new fields. The `Game` type should have `pregamePhase`, `pregameReady0`, `pregameReady1`, `rollWinner`, `rollResult0`, `rollResult1`. The `Player` type should have `pendingDeckData`.

- [ ] **Step 4: Verify app compiles**

Run: `npm run build`
Expected: Build may have type errors in client code that references old types — that's expected and will be fixed in later tasks.

- [ ] **Step 5: Commit**

```bash
git add lib/spacetimedb/module_bindings/
git commit -m "chore: regenerate SpacetimeDB client bindings for pregame ceremony"
```

---

## Task 6: Add `loadUserDecks` Server Action

**Files:**
- Modify: `app/play/actions.ts`

- [ ] **Step 1: Add `loadUserDecks` action**

Add this server action at the end of `app/play/actions.ts`:

```typescript
/**
 * Load the current user's decks for the pregame deck picker.
 * Returns the same shape as the lobby page query.
 */
export async function loadUserDecks(): Promise<DeckOption[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: decks } = await supabase
    .from('decks')
    .select('id, name, format, card_count, preview_card_1, preview_card_2, paragon')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  return decks || [];
}
```

Also add the `DeckOption` import at the top of the file:
```typescript
import type { DeckOption } from './components/DeckPickerCard';
```

- [ ] **Step 2: Commit**

```bash
git add app/play/actions.ts
git commit -m "feat: add loadUserDecks server action for pregame deck picker"
```

---

## Task 7: Update `useGameState` Hook — Pregame Methods

**Files:**
- Modify: `app/play/hooks/useGameState.ts:31-80` (GameState interface)
- Modify: `app/play/hooks/useGameState.ts:380-434` (return object)

- [ ] **Step 1: Add pregame methods to GameState interface**

Add these after `leaveGame: () => void;` on line 79:

```typescript
// Pregame ceremony actions
pregameReady: (ready: boolean) => void;
pregameAcknowledgeRoll: () => void;
pregameChooseFirst: (chosenSeat: bigint) => void;
pregameChangeDeck: (deckId: string, deckData: string) => void;
```

- [ ] **Step 2: Add useCallback implementations**

Add these before the `return` statement (around line 388):

```typescript
const pregameReady = useCallback((ready: boolean) => {
  conn?.reducers.pregameReady({ gameId, ready });
}, [conn, gameId]);

const pregameAcknowledgeRoll = useCallback(() => {
  conn?.reducers.pregameAcknowledgeRoll({ gameId });
}, [conn, gameId]);

const pregameChooseFirst = useCallback((chosenSeat: bigint) => {
  conn?.reducers.pregameChooseFirst({ gameId, chosenSeat });
}, [conn, gameId]);

const pregameChangeDeck = useCallback((deckId: string, deckData: string) => {
  conn?.reducers.pregameChangeDeck({ gameId, deckId, deckData });
}, [conn, gameId]);
```

- [ ] **Step 3: Add to return object**

Add these to the return object (after `leaveGame`):

```typescript
pregameReady,
pregameAcknowledgeRoll,
pregameChooseFirst,
pregameChangeDeck,
```

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors (bindings were regenerated in Task 5)

- [ ] **Step 5: Commit**

```bash
git add app/play/hooks/useGameState.ts
git commit -m "feat: add pregame ceremony methods to useGameState hook"
```

---

## Task 8: Update `client.tsx` — Pregame Lifecycle State

**Files:**
- Modify: `app/play/[code]/client.tsx:88` (LifecycleState type)
- Modify: `app/play/[code]/client.tsx:370-381` (lifecycle sync effect)
- Modify: `app/play/[code]/client.tsx:278-327` (reducer call effect — reconnect fix)
- Modify: `app/play/[code]/client.tsx:477-516` (render section — add pregame)

- [ ] **Step 1: Add 'pregame' to LifecycleState**

On line 88, change:
```typescript
type LifecycleState = 'creating' | 'joining' | 'waiting' | 'playing' | 'finished' | 'error';
```
To:
```typescript
type LifecycleState = 'creating' | 'joining' | 'waiting' | 'pregame' | 'playing' | 'finished' | 'error';
```

- [ ] **Step 2: Add pregame to lifecycle sync effect**

In the effect that syncs lifecycle from game data (around lines 370-381), add a case for pregame before the `playing` check:

```typescript
if (game.status === 'pregame') {
  setLifecycle('pregame');
} else if (game.status === 'playing') {
```

- [ ] **Step 3: Fix reconnect — skip reducer call if game already exists**

In the effect that calls `createGame`/`joinGame` (around lines 278-327), after the `!gameParams` check and before the `try` block, add:

```typescript
// Reconnect scenario: game already exists, skip reducer call
const existingGames = [...(gameState.allGames || [])];
const existingGame = existingGames.find((g: any) => g.code === code);
if (existingGame) {
  setGameId(existingGame.id);
  return; // lifecycle sync effect handles the rest
}
```

Note: The `allGames` from `gameState` may not be populated yet on first render (subscriptions take time). The existing logic handles this — if `allGames` is empty, the code proceeds to call the reducer. The reconnect check only fires when subscription data has arrived.

- [ ] **Step 4: Add PregameScreen import and render block**

Add import at the top of the file:
```typescript
import PregameScreen from '../components/PregameScreen';
```

In the render section, after the `waiting` lifecycle block (after line ~516) and before the playing section, add:

```typescript
if (lifecycle === 'pregame') {
  return (
    <PregameScreen
      gameId={gameId!}
      gameState={gameState}
      code={code}
    />
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add app/play/[code]/client.tsx
git commit -m "feat: add pregame lifecycle state, reconnect fix, PregameScreen render"
```

---

## Task 9: Create `PregameScreen` Component

**Files:**
- Create: `app/play/components/PregameScreen.tsx`

This is the largest task. The component renders three sub-screens based on `game.pregamePhase`.

- [ ] **Step 1: Create the file with imports and props**

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import TopNav from '@/components/top-nav';
import { DeckPickerModal } from './DeckPickerModal';
import type { DeckOption } from './DeckPickerCard';
import { loadUserDecks, loadDeckForGame } from '../actions';
import type { GameState } from '../hooks/useGameState';

interface PregameScreenProps {
  gameId: bigint;
  gameState: GameState;
  code: string;
}

export default function PregameScreen({ gameId, gameState, code }: PregameScreenProps) {
  const { game, myPlayer, opponentPlayer } = gameState;

  if (!game) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Spectator view — no myPlayer means we're watching
  if (!myPlayer) {
    return (
      <>
        <TopNav />
        <div className="flex min-h-[calc(100vh-56px)] items-center justify-center px-4">
          <SpectatorPregameView game={game} players={[]} gameState={gameState} />
        </div>
      </>
    );
  }

  const phase = game.pregamePhase;

  return (
    <>
      <TopNav />
      <div className="flex min-h-[calc(100vh-56px)] items-center justify-center px-4">
        {phase === 'deck_select' && (
          <DeckSelectPhase
            gameState={gameState}
            gameId={gameId}
          />
        )}
        {phase === 'rolling' && (
          <RollingPhase
            gameState={gameState}
            gameId={gameId}
          />
        )}
        {phase === 'choosing' && (
          <ChoosingPhase
            gameState={gameState}
            gameId={gameId}
          />
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Add `DeckSelectPhase` sub-component**

```typescript
function DeckSelectPhase({ gameState, gameId }: { gameState: GameState; gameId: bigint }) {
  const { game, myPlayer, opponentPlayer } = gameState;
  const [myDecks, setMyDecks] = useState<DeckOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isChangingDeck, setIsChangingDeck] = useState(false);

  // Load user's decks on mount
  useEffect(() => {
    loadUserDecks().then(setMyDecks).catch(() => {});
  }, []);

  if (!game || !myPlayer) return null;

  const mySeat = myPlayer.seat;
  const myReady = mySeat === 0n ? game.pregameReady0 : game.pregameReady1;
  const opponentReady = mySeat === 0n ? game.pregameReady1 : game.pregameReady0;

  const handleToggleReady = () => {
    gameState.pregameReady(!myReady);
  };

  const handleDeckSelected = async (deck: DeckOption) => {
    setPickerOpen(false);
    setIsChangingDeck(true);
    try {
      const result = await loadDeckForGame(deck.id);
      gameState.pregameChangeDeck(deck.id, JSON.stringify(result.deckData));
    } catch (e) {
      console.error('Failed to change deck:', e);
    } finally {
      setIsChangingDeck(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card/95 backdrop-blur-sm p-8 sm:p-10 text-center max-w-md w-full">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-cinzel">Pre-Game</p>
      <h2 className="text-2xl font-bold font-cinzel mt-2">Get Ready</h2>

      {/* My player section */}
      <div className="mt-6 p-4 rounded-lg border border-border bg-background/50">
        <div className="flex items-center justify-between">
          <div className="text-left">
            <p className="font-semibold">{myPlayer.displayName} <span className="text-xs text-muted-foreground">(you)</span></p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Deck: {myPlayer.deckId ? 'Selected' : 'None'}
            </p>
          </div>
          {myReady ? (
            <span className="text-xs font-medium text-primary px-2 py-1 rounded-full bg-primary/10">Ready</span>
          ) : (
            <span className="text-xs text-muted-foreground">Not ready</span>
          )}
        </div>

        <div className="flex gap-2 mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen(true)}
            disabled={myReady || isChangingDeck}
          >
            {isChangingDeck ? 'Loading...' : 'Change Deck'}
          </Button>
          <Button
            variant={myReady ? 'outline' : 'default'}
            size="sm"
            onClick={handleToggleReady}
          >
            {myReady ? 'Un-ready' : 'Ready'}
          </Button>
        </div>
      </div>

      {/* Opponent section */}
      <div className="mt-3 p-4 rounded-lg border border-border bg-background/50">
        <div className="flex items-center justify-between">
          <p className="font-semibold">{opponentPlayer?.displayName || 'Opponent'}</p>
          {opponentReady ? (
            <span className="text-xs font-medium text-primary px-2 py-1 rounded-full bg-primary/10">Ready</span>
          ) : (
            <span className="text-xs text-muted-foreground">Selecting deck...</span>
          )}
        </div>
      </div>

      {/* Status hint */}
      {myReady && !opponentReady && (
        <p className="mt-4 text-sm text-muted-foreground">Waiting for opponent to ready up...</p>
      )}

      <DeckPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handleDeckSelected}
        myDecks={myDecks}
        selectedDeckId={myPlayer.deckId}
      />
    </div>
  );
}
```

- [ ] **Step 3: Add `RollingPhase` sub-component**

```typescript
function RollingPhase({ gameState, gameId }: { gameState: GameState; gameId: bigint }) {
  const { game, myPlayer, opponentPlayer } = gameState;
  const [showResults, setShowResults] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  // Animate: show dice rolling, then reveal results after delay
  useEffect(() => {
    const timer = setTimeout(() => setShowResults(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!game || !myPlayer) return null;

  const mySeat = myPlayer.seat;
  const myRoll = mySeat === 0n ? Number(game.rollResult0) : Number(game.rollResult1);
  const opponentRoll = mySeat === 0n ? Number(game.rollResult1) : Number(game.rollResult0);
  const iWon = mySeat.toString() === game.rollWinner;
  const winnerName = iWon ? myPlayer.displayName : (opponentPlayer?.displayName || 'Opponent');

  const handleAcknowledge = () => {
    setAcknowledged(true);
    gameState.pregameAcknowledgeRoll();
  };

  return (
    <div className="rounded-xl border border-border bg-card/95 backdrop-blur-sm p-8 sm:p-10 text-center max-w-md w-full">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-cinzel">Dice Roll</p>
      <h2 className="text-2xl font-bold font-cinzel mt-2">Who Goes First?</h2>

      <div className="mt-8 flex justify-center gap-8">
        {/* My die */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-2">{myPlayer.displayName}</p>
          <div className={`w-20 h-20 rounded-xl border-2 flex items-center justify-center text-3xl font-bold font-mono transition-all duration-500 ${
            showResults
              ? iWon ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'
              : 'border-border bg-muted animate-pulse'
          }`}>
            {showResults ? myRoll : '?'}
          </div>
        </div>

        {/* VS */}
        <div className="flex items-center text-muted-foreground font-cinzel text-sm pt-6">vs</div>

        {/* Opponent die */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-2">{opponentPlayer?.displayName || 'Opponent'}</p>
          <div className={`w-20 h-20 rounded-xl border-2 flex items-center justify-center text-3xl font-bold font-mono transition-all duration-500 ${
            showResults
              ? !iWon ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'
              : 'border-border bg-muted animate-pulse'
          }`}>
            {showResults ? opponentRoll : '?'}
          </div>
        </div>
      </div>

      {showResults && (
        <div className="mt-6">
          <p className="text-lg font-semibold font-cinzel">
            {winnerName} wins the roll!
          </p>

          {!acknowledged ? (
            <Button className="mt-4" onClick={handleAcknowledge}>
              Continue
            </Button>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Waiting for opponent to continue...
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add `ChoosingPhase` sub-component**

```typescript
function ChoosingPhase({ gameState, gameId }: { gameState: GameState; gameId: bigint }) {
  const { game, myPlayer, opponentPlayer } = gameState;

  if (!game || !myPlayer) return null;

  const mySeat = myPlayer.seat;
  const iWon = mySeat.toString() === game.rollWinner;
  const winnerName = iWon ? 'You' : (opponentPlayer?.displayName || 'Opponent');

  const handleChoose = (seat: bigint) => {
    gameState.pregameChooseFirst(seat);
  };

  return (
    <div className="rounded-xl border border-border bg-card/95 backdrop-blur-sm p-8 sm:p-10 text-center max-w-md w-full">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-cinzel">First Player</p>

      {iWon ? (
        <>
          <h2 className="text-2xl font-bold font-cinzel mt-2">You Won the Roll!</h2>
          <p className="mt-2 text-muted-foreground">Who should go first?</p>

          <div className="mt-6 flex flex-col gap-3">
            <Button size="lg" onClick={() => handleChoose(mySeat)}>
              I&apos;ll go first
            </Button>
            <Button size="lg" variant="outline" onClick={() => handleChoose(mySeat === 0n ? 1n : 0n)}>
              {opponentPlayer?.displayName || 'Opponent'} goes first
            </Button>
          </div>
        </>
      ) : (
        <>
          <h2 className="text-2xl font-bold font-cinzel mt-2">{winnerName} Won the Roll</h2>
          <p className="mt-4 text-muted-foreground">Waiting for them to choose who goes first...</p>
          <div className="mt-3 flex justify-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Add `SpectatorPregameView` sub-component**

```typescript
function SpectatorPregameView({ game, players, gameState }: { game: any; players: any[]; gameState: GameState }) {
  const phase = game.pregamePhase;

  // Get both players from gameState (spectator has no "my" player)
  const allPlayers = gameState.allGames; // We'll derive player names from game data

  return (
    <div className="rounded-xl border border-border bg-card/95 backdrop-blur-sm p-8 sm:p-10 text-center max-w-md w-full">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-cinzel">Spectating</p>
      <h2 className="text-2xl font-bold font-cinzel mt-2">
        {phase === 'deck_select' && 'Players Preparing...'}
        {phase === 'rolling' && 'Rolling for First Player...'}
        {phase === 'choosing' && 'Choosing Who Goes First...'}
      </h2>

      {phase === 'deck_select' && (
        <div className="mt-6 space-y-2">
          <div className="p-3 rounded-lg border border-border">
            <span className="text-sm">Player 1: </span>
            <span className="text-sm font-medium">{game.pregameReady0 ? 'Ready' : 'Selecting deck...'}</span>
          </div>
          <div className="p-3 rounded-lg border border-border">
            <span className="text-sm">Player 2: </span>
            <span className="text-sm font-medium">{game.pregameReady1 ? 'Ready' : 'Selecting deck...'}</span>
          </div>
        </div>
      )}

      {phase === 'rolling' && (
        <div className="mt-6 flex justify-center gap-8">
          <div className="w-16 h-16 rounded-xl border-2 border-border flex items-center justify-center text-2xl font-bold font-mono">
            {Number(game.rollResult0) || '?'}
          </div>
          <div className="flex items-center text-muted-foreground text-sm">vs</div>
          <div className="w-16 h-16 rounded-xl border-2 border-border flex items-center justify-center text-2xl font-bold font-mono">
            {Number(game.rollResult1) || '?'}
          </div>
        </div>
      )}

      {phase === 'choosing' && (
        <p className="mt-4 text-sm text-muted-foreground">
          Waiting for roll winner to choose...
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Verify the app builds**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add app/play/components/PregameScreen.tsx
git commit -m "feat: add PregameScreen component with deck select, rolling, and choosing phases"
```

---

## Task 10: Handle Pregame Disconnect on Client

**Files:**
- Modify: `app/play/[code]/client.tsx`

- [ ] **Step 1: Add disconnect detection during pregame**

In the lifecycle sync effect (the one that watches `gameState.game`), add detection for a game that was cancelled during pregame:

```typescript
if (game.status === 'finished' && lifecycle === 'pregame') {
  // Game was cancelled (opponent disconnected during pregame)
  setErrorMessage('Opponent disconnected. Game cancelled.');
  setLifecycle('error');
  return;
}
```

Add this check BEFORE the existing `game.status === 'finished'` check.

- [ ] **Step 2: Commit**

```bash
git add app/play/[code]/client.tsx
git commit -m "feat: detect pregame disconnect and show error"
```

---

## Task 11: Manual Integration Test

**Files:** None (verification only)

- [ ] **Step 1: Start SpacetimeDB and dev server**

Run in separate terminals:
1. `spacetime start` (if not already running)
2. `npm run dev`

- [ ] **Step 2: Test full pregame flow**

Open two browser windows (or one incognito):
1. **Window A:** Go to `/play`, select a deck, create a game
2. **Window B:** Go to `/play`, select a deck, join via game code
3. Both should see `PregameScreen` in `deck_select` phase
4. **Window A:** Click "Change Deck" — verify DeckPickerModal opens with My Decks / Community tabs
5. **Window A:** Select a different deck — verify it updates
6. Both click "Ready" — should transition to `rolling` phase
7. Dice animation plays, results shown, both click "Continue"
8. Transitions to `choosing` phase — winner sees choice buttons
9. Winner picks who goes first → game starts in `playing` state
10. Verify `currentTurn` matches the chosen seat

- [ ] **Step 3: Test un-ready flow**

1. Both in `deck_select` phase
2. **Window A** clicks Ready, then clicks "Un-ready"
3. **Window A** clicks "Change Deck" — should work (not locked)
4. Both ready again — verify roll proceeds

- [ ] **Step 4: Test disconnect during pregame**

1. Both in `deck_select` phase (one ready, one not)
2. Close **Window B**
3. **Window A** should see "Opponent disconnected. Game cancelled." after a moment

- [ ] **Step 5: Test reconnect during pregame**

1. Both in `deck_select` phase
2. Refresh **Window A**
3. Should reconnect and see pregame screen at current phase (not get stuck in creating/joining)
