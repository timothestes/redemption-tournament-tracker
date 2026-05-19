# Spectator Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up spectator mode end-to-end: spectators can join any game (including self-spectate for testing), see public zones by default, request hand reveals via a banner+toggle flow, and players can kick + mark games private.

**Architecture:** SpacetimeDB backend adds 3 tables (`SpectatorBan`, `SpectatorHandRequest`, `SpectatorHandRequestExpiry`) + one `Player` column + 7 new reducers + a `clientDisconnected` Spectator branch. Client adds a spectator variant of `useGameState`, extends the hand-card visibility predicate to a third `'spectator'` viewer kind, builds a row-driven `SpectatorHandRequestBanner`, and extends the existing `CardScaleControl` gear popover with a Spectators subsection.

**Tech Stack:** SpacetimeDB (TypeScript module), Next.js 15 App Router, React 19, `spacetimedb/react` (`useTable`), TypeScript. Deploy via `spacetime publish` to `redemption-multiplayer-dev` only (per user instruction). No production publish in this plan.

**Spec:** [docs/superpowers/specs/2026-05-18-spectator-mode-design.md](../specs/2026-05-18-spectator-mode-design.md)

---

## File map

**Modify (backend):**
- `spacetimedb/src/schema.ts` — add `Player.shareHandWithSpectators`, add `SpectatorBan`, `SpectatorHandRequest`, `SpectatorHandRequestExpiry`, update `schema({ ... })` export.
- `spacetimedb/src/index.ts` — add new reducers, modify `join_as_spectator`, `leave_game`, `onDisconnect`; wire scheduled setter.

**Modify (client):**
- `app/play/hooks/useGameState.ts` — add spectator variant.
- `app/play/components/MultiplayerCanvas.tsx` — extract visibility predicate; spectator-mode branches; extend `CardScaleControl` props.
- `app/shared/components/CardScaleControl.tsx` — accept new Spectators-subsection props and render.
- `app/play/components/ChatPanel.tsx` — `senderId === 0n` system-message branch in 3 sites (lines ~999, ~1428-1432, ~1664-1670).
- `app/play/components/SpectatorBar.tsx` — add "Request hands" button.
- `app/play/spectate/[code]/client.tsx` — re-enable, real `displayName`, `leaveAsSpectator` on unmount, pass `viewerKind: 'spectator'`.
- `app/play/components/GameLobby.tsx` — re-enable Spectate toggle.
- `app/play/page.tsx` (or wherever the play game wrapper renders) — mount `SpectatorHandRequestBanner` in the player view.

**Create (client):**
- `app/play/components/SpectatorHandRequestBanner.tsx` — row-driven banner modeled on `PauseConsentToast`.

**Auto-regenerated:**
- `lib/spacetimedb/module_bindings/**` — via `spacetime generate` after each publish.

---

## Task 1: Schema additions

**Files:**
- Modify: `spacetimedb/src/schema.ts`

- [ ] **Step 1: Add the new `Player` column.**

In `spacetimedb/src/schema.ts`, inside the `Player` table's columns object (currently ends around line 83 with `handRevealSnapshot`), append:

```ts
    handRevealSnapshot: t.string().default('[]'), // existing — keep
    shareHandWithSpectators: t.bool().default(false),
  }
);
```

- [ ] **Step 2: Add `SpectatorBan` table.**

Insert immediately after the existing `Spectator` table block (around line 233 in the current file):

```ts
// ---------------------------------------------------------------------------
// 7b. SpectatorBan — per-game identity ban list, enforced by join_as_spectator
// ---------------------------------------------------------------------------
export const SpectatorBan = table(
  {
    name: 'spectator_ban',
    public: true,
    indexes: [
      { accessor: 'spectator_ban_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    identity: t.identity(),
    bannedBySeat: t.u64(),
    bannedAt: t.timestamp(),
  }
);
```

- [ ] **Step 3: Add `SpectatorHandRequest` table.**

Insert directly after `SpectatorBan`:

```ts
// ---------------------------------------------------------------------------
// 7c. SpectatorHandRequest — transient signal for the player-side banner.
// Rate-limited per-spectator by request_spectator_hand_reveal.
// Auto-cleaned 30s after requestedAt by expire_spectator_hand_request.
// ---------------------------------------------------------------------------
export const SpectatorHandRequest = table(
  {
    name: 'spectator_hand_request',
    public: true,
    indexes: [
      { accessor: 'spectator_hand_request_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    spectatorId: t.u64(),
    spectatorName: t.string(),
    requestedAt: t.timestamp(),
  }
);
```

- [ ] **Step 4: Add `SpectatorHandRequestExpiry` scheduled table.**

Insert directly after `SpectatorHandRequest`. Follows the existing scheduled-table forward-reference pattern (see `DisconnectTimeout` around schema.ts:245):

```ts
// ---------------------------------------------------------------------------
// 7d. SpectatorHandRequestExpiry (scheduled)
// Deletes the matching SpectatorHandRequest row 30s after creation.
// ---------------------------------------------------------------------------
let _handleSpectatorHandRequestExpiry: any;
export const setSpectatorHandRequestExpiryReducer = (reducer: any) => {
  _handleSpectatorHandRequestExpiry = reducer;
};

export const SpectatorHandRequestExpiry = table(
  {
    name: 'spectator_hand_request_expiry',
    public: true,
    scheduled: () => _handleSpectatorHandRequestExpiry,
    indexes: [
      { accessor: 'spectator_hand_request_expiry_request_id', algorithm: 'btree' as const, columns: ['requestId'] },
    ],
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    requestId: t.u64(),
  }
);
```

- [ ] **Step 5: Update the `schema({ ... })` export.**

In `spacetimedb/src/schema.ts:345`, add the three new tables to the object passed to `schema(...)`:

```ts
const spacetimedb = schema({
  Game,
  Player,
  CardInstance,
  CardCounter,
  GameAction,
  ChatMessage,
  Spectator,
  SpectatorBan,                  // new
  SpectatorHandRequest,          // new
  SpectatorHandRequestExpiry,    // new
  DisconnectTimeout,
  ZoneSearchRequest,
  ChooseFirstTimeout,
  CleanupSchedule,
});
```

- [ ] **Step 6: Type-check the module.**

```bash
cd spacetimedb && npx tsc --noEmit
```

Expected: no errors. Common pitfalls:
- "name is used for multiple entities" → index name collision; verify the three new index `accessor` strings are unique.
- "reading 'tag'" → indexes placed in COLUMNS object instead of OPTIONS — must be in the first arg.

- [ ] **Step 7: Commit.**

```bash
git add spacetimedb/src/schema.ts
git commit -m "spectator: add SpectatorBan, SpectatorHandRequest, SpectatorHandRequestExpiry schema"
```

---

## Task 2: Simple toggle reducers (`set_share_hand_with_spectators`, `set_game_private`)

**Files:**
- Modify: `spacetimedb/src/index.ts`

- [ ] **Step 1: Add `set_share_hand_with_spectators` reducer.**

Append to `spacetimedb/src/index.ts` (any logical place — e.g. near the existing `set_player_option` around line 5411):

```ts
// ---------------------------------------------------------------------------
// Reducer: set_share_hand_with_spectators
// Per-player toggle that controls hand visibility to all current and future
// spectators. Global per player (not per-spectator).
// ---------------------------------------------------------------------------
export const set_share_hand_with_spectators = spacetimedb.reducer(
  { gameId: t.u64(), share: t.bool() },
  (ctx, { gameId, share }) => {
    const player = findPlayerBySender(ctx, gameId);
    if (player.shareHandWithSpectators === share) return;
    ctx.db.Player.id.update({ ...player, shareHandWithSpectators: share });
  }
);
```

- [ ] **Step 2: Add `set_game_private` reducer (same file).**

```ts
// ---------------------------------------------------------------------------
// Reducer: set_game_private
// Either seated player flips Game.isPublic. Existing spectators stay; new
// joins via join_as_spectator are blocked while isPublic=false.
// ---------------------------------------------------------------------------
export const set_game_private = spacetimedb.reducer(
  { gameId: t.u64(), isPublic: t.bool() },
  (ctx, { gameId, isPublic }) => {
    const caller = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.isPublic === isPublic) return;

    ctx.db.Game.id.update({ ...game, isPublic });

    const text = isPublic
      ? `Game set to public by ${caller.displayName}`
      : `Game set to private by ${caller.displayName}`;
    ctx.db.ChatMessage.insert({
      id: 0n,
      gameId,
      senderId: 0n, // 0n = system message sentinel; autoInc IDs start at 1
      text,
      sentAt: ctx.timestamp,
    });
  }
);
```

- [ ] **Step 3: Type-check.**

```bash
cd spacetimedb && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add spacetimedb/src/index.ts
git commit -m "spectator: add set_share_hand_with_spectators and set_game_private reducers"
```

---

## Task 3: `kick_spectator` reducer

**Files:**
- Modify: `spacetimedb/src/index.ts`

- [ ] **Step 1: Add `kick_spectator` reducer.**

Append to `spacetimedb/src/index.ts`:

```ts
// ---------------------------------------------------------------------------
// Reducer: kick_spectator
// Either seated player removes a spectator and bans their identity from
// rejoining for the remainder of this game.
// ---------------------------------------------------------------------------
export const kick_spectator = spacetimedb.reducer(
  { gameId: t.u64(), spectatorId: t.u64() },
  (ctx, { gameId, spectatorId }) => {
    const caller = findPlayerBySender(ctx, gameId);

    const target = ctx.db.Spectator.id.find(spectatorId);
    if (!target || target.gameId !== gameId) {
      throw new SenderError('Spectator not found in this game');
    }

    ctx.db.SpectatorBan.insert({
      id: 0n,
      gameId,
      identity: target.identity,
      bannedBySeat: caller.seat,
      bannedAt: ctx.timestamp,
    });

    ctx.db.Spectator.id.delete(target.id);

    ctx.db.ChatMessage.insert({
      id: 0n,
      gameId,
      senderId: 0n,
      text: `${target.displayName} was removed from spectators by ${caller.displayName}`,
      sentAt: ctx.timestamp,
    });
  }
);
```

- [ ] **Step 2: Type-check.**

```bash
cd spacetimedb && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add spacetimedb/src/index.ts
git commit -m "spectator: add kick_spectator reducer with per-game ban list"
```

---

## Task 4: `leave_as_spectator` + update `leave_game` + `onDisconnect` Spectator branch

**Files:**
- Modify: `spacetimedb/src/index.ts`

- [ ] **Step 1: Update `leave_game` spectator branch to emit system chat.**

In `spacetimedb/src/index.ts`, find the spectator branch of `leave_game` (currently lines ~1535-1541):

```ts
    // Try to find as spectator
    for (const spectator of ctx.db.Spectator.spectator_game_id.filter(gameId)) {
      if (spectator.identity.toHexString() === ctx.sender.toHexString()) {
        ctx.db.Spectator.id.delete(spectator.id);
        return;
      }
    }
```

Replace with:

```ts
    // Try to find as spectator
    for (const spectator of ctx.db.Spectator.spectator_game_id.filter(gameId)) {
      if (spectator.identity.toHexString() === ctx.sender.toHexString()) {
        const displayName = spectator.displayName;
        ctx.db.Spectator.id.delete(spectator.id);
        ctx.db.ChatMessage.insert({
          id: 0n,
          gameId,
          senderId: 0n,
          text: `${displayName} stopped spectating`,
          sentAt: ctx.timestamp,
        });
        return;
      }
    }
```

- [ ] **Step 2: Add `leave_as_spectator` reducer.**

Append elsewhere in `spacetimedb/src/index.ts` (e.g. immediately after `leave_game`):

```ts
// ---------------------------------------------------------------------------
// Reducer: leave_as_spectator
// Spectator-only leave path. Used by the spectator tab on unmount so that
// self-spectate works: leave_game above hits the Player branch first when
// the same identity has both rows, so spectators need a dedicated reducer.
// Silent no-op if no Spectator row exists (e.g. ban-rejected join, double
// fire on unmount).
// ---------------------------------------------------------------------------
export const leave_as_spectator = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    for (const spectator of ctx.db.Spectator.spectator_game_id.filter(gameId)) {
      if (spectator.identity.toHexString() === ctx.sender.toHexString()) {
        const displayName = spectator.displayName;
        ctx.db.Spectator.id.delete(spectator.id);
        ctx.db.ChatMessage.insert({
          id: 0n,
          gameId,
          senderId: 0n,
          text: `${displayName} stopped spectating`,
          sentAt: ctx.timestamp,
        });
        return;
      }
    }
  }
);
```

- [ ] **Step 3: Add Spectator branch to `onDisconnect` lifecycle hook.**

In `spacetimedb/src/index.ts:5998`, find the existing `onDisconnect` body. Append a Spectator-cleanup block AFTER the existing Player loop, still inside the same arrow function:

```ts
export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  // (existing Player loop stays here unchanged)

  // Safety net for spectators when leave_as_spectator never fires
  // (mobile backgrounding, crashes, network drops). Unlike Players,
  // Spectators get no reconnect grace — their only persistent state is
  // the row itself, so reconnect = re-call joinAsSpectator.
  for (const spectator of ctx.db.Spectator.iter()) {
    if (spectator.identity.toHexString() !== ctx.sender.toHexString()) continue;
    const displayName = spectator.displayName;
    const gameId = spectator.gameId;
    ctx.db.Spectator.id.delete(spectator.id);
    ctx.db.ChatMessage.insert({
      id: 0n,
      gameId,
      senderId: 0n,
      text: `${displayName} stopped spectating`,
      sentAt: ctx.timestamp,
    });
  }
});
```

Note: there is no index on `Spectator.identity`, so `.iter()` is correct here (lifecycle hooks are infrequent enough that this is fine). If you'd rather add an index, do it in Task 1 instead.

- [ ] **Step 4: Type-check.**

```bash
cd spacetimedb && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add spacetimedb/src/index.ts
git commit -m "spectator: add leave_as_spectator + clientDisconnected branch + leave_game system chat"
```

---

## Task 5: `request_spectator_hand_reveal` + scheduled `expire_spectator_hand_request`

**Files:**
- Modify: `spacetimedb/src/index.ts`

- [ ] **Step 1: Add `request_spectator_hand_reveal` reducer.**

Append to `spacetimedb/src/index.ts`:

```ts
// ---------------------------------------------------------------------------
// Reducer: request_spectator_hand_reveal
// Spectator-initiated request that prompts both players via a banner.
// Rate-limited: if a request from this spectator is already pending,
// silently no-op (client-side disable is bypassable; this is the real gate).
// ---------------------------------------------------------------------------
export const request_spectator_hand_reveal = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    // Find the spectator row for the caller
    let spectator: any = null;
    for (const s of ctx.db.Spectator.spectator_game_id.filter(gameId)) {
      if (s.identity.toHexString() === ctx.sender.toHexString()) {
        spectator = s;
        break;
      }
    }
    if (!spectator) throw new SenderError('Not a spectator in this game');

    // Rate limit: silently no-op if an active request already exists for
    // this (gameId, spectatorId).
    for (const req of ctx.db.SpectatorHandRequest.spectator_hand_request_game_id.filter(gameId)) {
      if (req.spectatorId === spectator.id) return;
    }

    const row = ctx.db.SpectatorHandRequest.insert({
      id: 0n,
      gameId,
      spectatorId: spectator.id,
      spectatorName: spectator.displayName,
      requestedAt: ctx.timestamp,
    });

    ctx.db.ChatMessage.insert({
      id: 0n,
      gameId,
      senderId: 0n,
      text: `${spectator.displayName} requested to see hands`,
      sentAt: ctx.timestamp,
    });

    // Schedule expiry 30s out
    const future = ctx.timestamp.microsSinceUnixEpoch + 30_000_000n;
    ctx.db.SpectatorHandRequestExpiry.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.time(future),
      requestId: row.id,
    });
  }
);
```

- [ ] **Step 2: Add the scheduled `expire_spectator_hand_request` reducer.**

Append to `spacetimedb/src/index.ts`:

```ts
// ---------------------------------------------------------------------------
// Scheduled reducer: expire_spectator_hand_request
// Auto-cleanup of SpectatorHandRequest 30s after creation. .find() before
// .delete() to no-op safely if the row was already removed elsewhere.
// ---------------------------------------------------------------------------
export const expire_spectator_hand_request = spacetimedb.reducer(
  { arg: SpectatorHandRequestExpiry.rowType },
  (ctx, { arg }) => {
    const row = ctx.db.SpectatorHandRequest.id.find(arg.requestId);
    if (row) ctx.db.SpectatorHandRequest.id.delete(arg.requestId);
  }
);
```

- [ ] **Step 3: Wire the scheduled reducer's forward reference at module load.**

In `spacetimedb/src/index.ts`, find the existing `setDisconnectTimeoutReducer(handle_disconnect_timeout);` line at ~1674. Add the parallel wiring nearby (any location after `expire_spectator_hand_request` is defined):

```ts
// Wire the scheduled reducer to the schema's forward reference
setSpectatorHandRequestExpiryReducer(expire_spectator_hand_request);
```

You also need to import the setter and the row-type table at the top of `index.ts`. Look at the existing imports from `./schema` (around the top of the file) and add `setSpectatorHandRequestExpiryReducer` and `SpectatorHandRequestExpiry` to that import.

- [ ] **Step 4: Verify `ScheduleAt` is already imported.**

Search the file:

```bash
grep -n "from 'spacetimedb'" spacetimedb/src/index.ts | head -3
```

If `ScheduleAt` isn't imported yet, add it to the existing `import { ... } from 'spacetimedb';` line. (`DisconnectTimeout` scheduling already uses it elsewhere; it's likely there.)

- [ ] **Step 5: Type-check.**

```bash
cd spacetimedb && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add spacetimedb/src/index.ts
git commit -m "spectator: add request_spectator_hand_reveal + 30s scheduled cleanup"
```

---

## Task 6: Update `join_as_spectator` (ban check, private check, idempotent, system chat)

**Files:**
- Modify: `spacetimedb/src/index.ts:1487-1510`

- [ ] **Step 1: Replace the body of `join_as_spectator`.**

Find the current reducer at `spacetimedb/src/index.ts:1487` and replace its body. Final version:

```ts
export const join_as_spectator = spacetimedb.reducer(
  {
    code: t.string(),
    displayName: t.string(),
  },
  (ctx, { code, displayName }) => {
    // Find game by code
    let game: any = null;
    for (const g of ctx.db.Game.game_code.filter(code)) {
      game = g;
      break;
    }
    if (!game) throw new SenderError('No game found with that code');

    // Ban check
    for (const ban of ctx.db.SpectatorBan.spectator_ban_game_id.filter(game.id)) {
      if (ban.identity.toHexString() === ctx.sender.toHexString()) {
        throw new SenderError('You have been removed from this game');
      }
    }

    // Idempotent reconnect: if a row already exists for (gameId, sender),
    // refresh displayName so renames propagate and return without inserting
    // a second row.
    for (const existing of ctx.db.Spectator.spectator_game_id.filter(game.id)) {
      if (existing.identity.toHexString() === ctx.sender.toHexString()) {
        if (existing.displayName !== displayName) {
          ctx.db.Spectator.id.update({ ...existing, displayName });
        }
        return;
      }
    }

    // Private games block new spectators (existing ones already returned above)
    if (!game.isPublic) throw new SenderError('This game is private');

    ctx.db.Spectator.insert({
      id: 0n,
      gameId: game.id,
      identity: ctx.sender,
      displayName,
    });

    ctx.db.ChatMessage.insert({
      id: 0n,
      gameId: game.id,
      senderId: 0n,
      text: `${displayName} started spectating`,
      sentAt: ctx.timestamp,
    });
  }
);
```

- [ ] **Step 2: Type-check.**

```bash
cd spacetimedb && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add spacetimedb/src/index.ts
git commit -m "spectator: join_as_spectator now enforces ban + private + idempotent reconnect"
```

---

## Task 7: Publish to dev DB and regenerate client bindings

**Files:** none modified by hand; `lib/spacetimedb/module_bindings/**` is regenerated.

- [ ] **Step 1: Check the default spacetime server.**

```bash
spacetime server list
```

Expected: `maincloud.spacetimedb.com` marked with `***`. If it isn't, fix that before publishing.

- [ ] **Step 2: Publish to the dev database.**

```bash
echo "y" | spacetime publish redemption-multiplayer-dev --module-path "$(pwd)/spacetimedb" --no-config --server maincloud
```

Expected: `Updated database with name: redemption-multiplayer-dev`.

If the publish fails with a migration error (e.g. dropped/renamed columns), wipe with `--clear-database -y` and re-publish — acceptable for dev since real games are short-lived:

```bash
echo "y" | spacetime publish redemption-multiplayer-dev --clear-database -y --module-path "$(pwd)/spacetimedb" --no-config --server maincloud
```

- [ ] **Step 3: Regenerate TypeScript bindings.**

```bash
spacetime generate --lang typescript --out-dir lib/spacetimedb/module_bindings --module-path spacetimedb
```

- [ ] **Step 4: Sanity-check the generated bindings include the new reducers + tables.**

```bash
grep -l "leaveAsSpectator\|setShareHandWithSpectators\|kickSpectator\|setGamePrivate\|requestSpectatorHandReveal" lib/spacetimedb/module_bindings/*.ts | head
ls lib/spacetimedb/module_bindings/ | grep -i "spectator_ban\|spectator_hand_request"
```

Expected: at least one file matches the reducer grep; two new table files for `spectator_ban_table.ts` and `spectator_hand_request_table.ts` (or similar — exact filenames vary by generator version).

- [ ] **Step 5: Commit bindings.**

```bash
git add lib/spacetimedb/module_bindings/
git commit -m "spectator: regenerate client bindings for new tables and reducers"
```

---

## Task 8: Spectator variant of `useGameState`

**Files:**
- Modify: `app/play/hooks/useGameState.ts`

- [ ] **Step 1: Read the existing hook to understand its shape.**

```bash
wc -l app/play/hooks/useGameState.ts
```

Open it. Note the existing return shape: `myPlayer`, `opponentPlayer`, `myCards`, `opponentCards`, `spectators`, `chatMessages`, etc. The keying is "viewer's identity = my".

- [ ] **Step 2: Add a sibling hook `useSpectatorGameState`.**

Append to `app/play/hooks/useGameState.ts`:

```ts
/**
 * Spectator-mode variant. The viewer has no Player row, so we cannot key
 * "my" vs "opponent" off identity. Instead expose seat0/seat1 directly and
 * shape the cards bucket so the existing canvas's two-zone layout works
 * unchanged (seat 0 takes the "my" slot, seat 1 takes "opponent").
 */
export function useSpectatorGameState(gameId: bigint | null) {
  const [players] = useTable(
    tables.Player.where(p => p.gameId.eq(gameId ?? 0n)),
  );
  const [cards] = useTable(
    tables.CardInstance.where(c => c.gameId.eq(gameId ?? 0n)),
  );
  const [spectators] = useTable(
    tables.Spectator.where(s => s.gameId.eq(gameId ?? 0n)),
  );
  const [chatMessages] = useTable(
    tables.ChatMessage.where(m => m.gameId.eq(gameId ?? 0n)),
  );
  const [game] = useTable(
    tables.Game.where(g => g.id.eq(gameId ?? 0n)),
  );
  // (Add other tables your existing useGameState subscribes to —
  // GameAction, CardCounter, ZoneSearchRequest, etc. Mirror the same
  // filtered subscriptions.)

  const seat0Player = players.find(p => p.seat === 0n) ?? null;
  const seat1Player = players.find(p => p.seat === 1n) ?? null;

  const bucketByOwnerAndZone = (ownerId: bigint | undefined) => {
    if (ownerId === undefined) return {};
    const buckets: Record<string, typeof cards> = {};
    for (const c of cards) {
      if (c.ownerId !== ownerId) continue;
      (buckets[c.zone] ??= []).push(c);
    }
    return buckets;
  };

  return {
    viewerKind: 'spectator' as const,
    game: game[0] ?? null,
    seat0Player,
    seat1Player,
    // Adapt to the canvas's "myCards / opponentCards" expectation
    myPlayer: seat0Player,
    opponentPlayer: seat1Player,
    myCards: bucketByOwnerAndZone(seat0Player?.id),
    opponentCards: bucketByOwnerAndZone(seat1Player?.id),
    spectators,
    chatMessages,
  };
}
```

**Important:** Mirror every subscription/derivation your existing `useGameState` already does for player-mode (GameAction, CardCounter, ZoneSearchRequest, etc.). Read your existing hook end-to-end and copy each one; an omitted subscription will show as missing data on the spectator canvas (e.g. counters won't render, action log will be empty).

- [ ] **Step 3: Type-check.**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add app/play/hooks/useGameState.ts
git commit -m "spectator: add useSpectatorGameState returning seat0/seat1 + spectator viewerKind"
```

---

## Task 9: Hand-card visibility predicate + spectator-mode application

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Locate the existing visibility derivation.**

```bash
grep -n "handRevealSnapshot\|handRevealed" app/play/components/MultiplayerCanvas.tsx | head -20
```

Note the existing derivations around lines 507-545 (opponent-hand snapshot logic) and 5599-5640 (opponent hand rendering). These show the current per-card predicate that decides "is this opponent hand card visible?".

- [ ] **Step 2: Extract a pure helper at the top of `MultiplayerCanvas.tsx` (outside the component).**

```ts
type ViewerKind = 'self' | 'opponent' | 'spectator';

/**
 * Decide whether a hand card should render face-up for a given viewer.
 * - 'self': always face-up (you see your own hand).
 * - 'opponent': face-up iff owner.handRevealed AND the card is in the snapshot,
 *   OR the card has an active revealExpiresAt (per-card flash).
 * - 'spectator': face-up iff owner.shareHandWithSpectators, OR the card is in
 *   the snapshot when the owner had also revealed to opponents, OR the card
 *   has an active revealExpiresAt.
 */
export function isHandCardFaceVisible(
  card: { id: bigint; revealExpiresAt?: { microsSinceUnixEpoch: bigint } | null },
  viewerKind: ViewerKind,
  ownerPlayer: { handRevealed: boolean; handRevealSnapshot: string; shareHandWithSpectators?: boolean } | null | undefined,
  nowMicros: bigint,
): boolean {
  if (viewerKind === 'self') return true;
  if (!ownerPlayer) return false;

  const flashActive =
    card.revealExpiresAt !== undefined &&
    card.revealExpiresAt !== null &&
    card.revealExpiresAt.microsSinceUnixEpoch > nowMicros;
  if (flashActive) return true;

  let snapshot: Set<string>;
  try {
    snapshot = new Set<string>((JSON.parse(ownerPlayer.handRevealSnapshot || '[]') as unknown[]).map(String));
  } catch {
    snapshot = new Set<string>();
  }
  const inSnapshot = snapshot.has(String(card.id));

  if (viewerKind === 'opponent') {
    return ownerPlayer.handRevealed && inSnapshot;
  }
  // spectator
  return ownerPlayer.shareHandWithSpectators === true || inSnapshot;
}
```

- [ ] **Step 3: Replace the opponent-hand visibility derivation to use the helper.**

Find the existing block around line 540-545 in `MultiplayerCanvas.tsx` (the one computing `visible` from `opponentCards['hand']`). Replace its filter callback with a call to `isHandCardFaceVisible(c, 'opponent', opponentPlayer, nowMicros)`. Behavior must be identical for the opponent case (this is a refactor, not a behavior change).

- [ ] **Step 4: Wire `viewerKind` through `MultiplayerCanvas`.**

Add an optional prop to `MultiplayerCanvasProps`. Note: this prop is a **mount mode** (two values: player vs spectator), distinct from the helper's `ViewerKind` (three values: per-card 'self' / 'opponent' / 'spectator'). The mount mode determines which value to pass to the helper per card:

```ts
  /** 'spectator' when mounted from /play/spectate/[code]. Defaults to 'player'. */
  viewerKind?: 'player' | 'spectator';
```

Default to `'player'` in the component signature. When `viewerKind === 'player'`, the existing hand rendering uses 'self' for `myCards['hand']` and 'opponent' for `opponentCards['hand']`. When `viewerKind === 'spectator'`, both seats render with 'spectator'.

- [ ] **Step 5: Apply the helper to the "my hand" path in spectator mode.**

The "my hand" rendering today is unconditionally face-up. In spectator mode, run each "my hand" card through `isHandCardFaceVisible(c, 'spectator', seat0Player, nowMicros)` and `isHandCardFaceVisible(c, 'spectator', seat1Player, nowMicros)` for the opponent side. Use the same face-down rendering path the opponent hand already uses.

Concretely: in any block that today reads `myCards['hand']` and renders face-up unconditionally, branch on `viewerKind === 'spectator'` and run the same predicate as the opponent path.

- [ ] **Step 6: Guard brigade-count derivations.**

Find `myHandBrigadeCounts` (~line 519) and `opponentHandBrigadeCounts` (~line 536). For spectator mode, only compute when the respective player's `shareHandWithSpectators === true`; otherwise return an empty count object. Brigade counts derive from card faces so leaking them would defeat the visibility predicate.

- [ ] **Step 7: Type-check.**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit.**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "spectator: extract hand visibility predicate; apply for spectator viewerKind"
```

---

## Task 10: System chat (`senderId === 0n`) rendering branch in `ChatPanel.tsx`

**Files:**
- Modify: `app/play/components/ChatPanel.tsx`

- [ ] **Step 1: Update the search filter at line ~999.**

Find:

```ts
  const filteredChat = isSearching
    ? chatMessages.filter((msg) => {
        const senderName = playerNames[msg.senderId.toString()] ?? '';
        return `${senderName} ${msg.text}`.toLowerCase().includes(normalizedQuery);
      })
    : chatMessages;
```

Replace `senderName` lookup with a system-aware version:

```ts
  const senderNameOf = (msg: { senderId: bigint }) =>
    msg.senderId === 0n ? '' : (playerNames[msg.senderId.toString()] ?? '');

  const filteredChat = isSearching
    ? chatMessages.filter((msg) =>
        `${senderNameOf(msg)} ${msg.text}`.toLowerCase().includes(normalizedQuery),
      )
    : chatMessages;
```

- [ ] **Step 2: Update the chat render at line ~1428-1432.**

Find:

```tsx
{filteredChat.map((msg) => {
  const isMe = msg.senderId === myPlayerId;
  const senderName =
    playerNames[msg.senderId.toString()] ??
    (isMe ? 'You' : `Player ${msg.senderId}`);
  const time = formatTimestamp(msg.sentAt.microsSinceUnixEpoch);
  // ...existing render...
})}
```

Add a system-message branch at the top of the `map`:

```tsx
{filteredChat.map((msg) => {
  if (msg.senderId === 0n) {
    return (
      <div
        key={msg.id.toString()}
        style={{
          textAlign: 'center',
          fontStyle: 'italic',
          opacity: 0.6,
          fontSize: 11,
          margin: '4px 0',
          padding: '0 8px',
        }}
      >
        {msg.text}
      </div>
    );
  }
  const isMe = msg.senderId === myPlayerId;
  const senderName =
    playerNames[msg.senderId.toString()] ??
    (isMe ? 'You' : `Player ${msg.senderId}`);
  const time = formatTimestamp(msg.sentAt.microsSinceUnixEpoch);
  // ...existing render...
})}
```

- [ ] **Step 3: Update the second render site at line ~1664-1670 (combined chat+actions timeline).**

Find:

```tsx
if (entry.kind === 'chat') {
  const msg = entry.msg;
  const isMe = msg.senderId === myPlayerId;
  const senderName =
    playerNames[msg.senderId.toString()] ??
    (isMe ? 'You' : `Player ${msg.senderId}`);
  // ...existing render...
}
```

Add a system-message branch at the top:

```tsx
if (entry.kind === 'chat') {
  const msg = entry.msg;
  if (msg.senderId === 0n) {
    return (
      <div
        key={`chat-${msg.id.toString()}`}
        style={{
          textAlign: 'center',
          fontStyle: 'italic',
          opacity: 0.6,
          fontSize: 11,
          margin: '4px 0',
          padding: '0 8px',
        }}
      >
        {msg.text}
      </div>
    );
  }
  const isMe = msg.senderId === myPlayerId;
  // ...existing render...
}
```

- [ ] **Step 4: Type-check.**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add app/play/components/ChatPanel.tsx
git commit -m "spectator: render senderId=0n as system message (italic, muted, centered)"
```

---

## Task 11: `SpectatorHandRequestBanner` component

**Files:**
- Create: `app/play/components/SpectatorHandRequestBanner.tsx`
- Modify: wherever the player game wrapper renders (e.g. `app/play/[code]/page.tsx` or similar — find via Step 5 below)

- [ ] **Step 1: Read the model component.**

```bash
cat app/play/components/PauseConsentToast.tsx
```

The new banner follows the same pattern: subscribe to a server table, render only when relevant rows exist.

- [ ] **Step 2: Create `SpectatorHandRequestBanner.tsx`.**

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTable, useSpacetimeDB } from 'spacetimedb/react';
import { tables } from '@/lib/spacetimedb/module_bindings';

interface SpectatorHandRequestBannerProps {
  gameId: bigint | null;
  /** Local player's row — needed to call setShareHandWithSpectators and to auto-dismiss when share flips on. */
  myPlayer: { id: bigint; gameId: bigint; shareHandWithSpectators: boolean } | null;
}

/**
 * Row-driven banner stack: one banner per active SpectatorHandRequest for
 * this game. Each banner has Share / Dismiss buttons. Dismiss is local-only
 * (no server signal — the server only tracks the request itself).
 * Auto-dismisses when the underlying row is deleted by the 30s expiry
 * reducer OR when myPlayer.shareHandWithSpectators flips to true (covers
 * the two-tab race where a sibling tab accepted).
 */
export default function SpectatorHandRequestBanner({
  gameId,
  myPlayer,
}: SpectatorHandRequestBannerProps) {
  const { conn } = useSpacetimeDB() as any;
  const [allRequests] = useTable(
    tables.SpectatorHandRequest.where(r => r.gameId.eq(gameId ?? 0n)),
  );
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Auto-dismiss any active banner once shareHandWithSpectators flips true
  useEffect(() => {
    if (!myPlayer?.shareHandWithSpectators) return;
    setDismissed(prev => {
      const next = new Set(prev);
      for (const r of allRequests) next.add(r.id.toString());
      return next;
    });
  }, [myPlayer?.shareHandWithSpectators, allRequests]);

  const visible = useMemo(
    () => allRequests.filter(r => !dismissed.has(r.id.toString())),
    [allRequests, dismissed],
  );

  if (!myPlayer || visible.length === 0) return null;

  const onShare = () => {
    conn?.reducers.setShareHandWithSpectators({ gameId: myPlayer.gameId, share: true });
  };

  const onDismiss = (id: bigint) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id.toString());
      return next;
    });
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 800,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {visible.map((req) => (
        <div
          key={req.id.toString()}
          style={{
            background: 'rgba(14, 10, 6, 0.95)',
            border: '1px solid rgba(196, 149, 90, 0.4)',
            borderRadius: 8,
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            color: '#e6dbc4',
            pointerEvents: 'auto',
          }}
        >
          <span>{req.spectatorName} wants to see hands</span>
          <button
            onClick={onShare}
            style={{
              background: '#c4955a',
              color: '#0e0a06',
              border: 'none',
              borderRadius: 4,
              padding: '6px 12px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Share with spectators
          </button>
          <button
            onClick={() => onDismiss(req.id)}
            style={{
              background: 'transparent',
              color: '#e6dbc4',
              border: '1px solid rgba(196, 149, 90, 0.4)',
              borderRadius: 4,
              padding: '6px 12px',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Find where `PauseConsentToast` is mounted.**

```bash
grep -rn "PauseConsentToast" app/play/ | grep -v node_modules
```

Expected: at least one mount site in the player game wrapper (likely `app/play/[code]/page.tsx`, `app/play/[code]/client.tsx`, or inside `MultiplayerCanvas.tsx` itself).

- [ ] **Step 4: Mount `SpectatorHandRequestBanner` next to `PauseConsentToast`.**

In the file from Step 3, add the import and JSX directly alongside the existing `<PauseConsentToast ... />` element:

```tsx
import SpectatorHandRequestBanner from '@/app/play/components/SpectatorHandRequestBanner';

// ...

<SpectatorHandRequestBanner gameId={gameId} myPlayer={myPlayer} />
```

Skip this in spectator mode (it's irrelevant — spectators don't see the banner).

- [ ] **Step 5: Type-check.**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add app/play/components/SpectatorHandRequestBanner.tsx
git add -u   # mount-site file
git commit -m "spectator: add SpectatorHandRequestBanner with two-tab auto-dismiss"
```

---

## Task 12: Extend `CardScaleControl` with Spectators subsection

**Files:**
- Modify: `app/shared/components/CardScaleControl.tsx`
- Modify: `app/play/components/MultiplayerCanvas.tsx` (pass new props to `<CardScaleControl ... />` at ~line 5868)

- [ ] **Step 1: Read the existing `CardScaleControl` component.**

```bash
wc -l app/shared/components/CardScaleControl.tsx
```

Open it and note the existing props (timer toggle, scale slider, load deck).

- [ ] **Step 2: Add new props to the interface.**

In `app/shared/components/CardScaleControl.tsx`, extend the props interface:

```ts
interface CardScaleControlProps {
  // ...existing props...

  /** Spectators in the current game. Empty = subsection hidden. */
  spectators?: Array<{ id: bigint; identity: { toHexString: () => string }; displayName: string }>;
  /** Local player's identity hex — used to hide own row from the spectator list. */
  myIdentityHex?: string;
  /** Local player's shareHandWithSpectators value. */
  shareHandWithSpectators?: boolean;
  /** Game id, needed for the reducer calls. */
  gameId?: bigint;
  /** Whether the game is currently public. */
  isGamePublic?: boolean;
  /** Reducer callbacks (provided by parent so this component stays presentational). */
  onSetShareHand?: (share: boolean) => void;
  onKickSpectator?: (spectatorId: bigint) => void;
  onSetGamePrivate?: (isPublic: boolean) => void;
}
```

- [ ] **Step 3: Render the Spectators subsection.**

Inside the existing popover body, add a new section (visually a separator + heading + three controls):

```tsx
{props.gameId !== undefined && (
  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(196, 149, 90, 0.2)' }}>
    <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
      Spectators
    </div>

    {/* Share hand toggle — only when at least one spectator */}
    {(props.spectators ?? []).length > 0 && (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={!!props.shareHandWithSpectators}
          onChange={(e) => props.onSetShareHand?.(e.target.checked)}
        />
        <span>Share my hand with spectators</span>
      </label>
    )}

    {/* Spectator list — hide own identity (self-spectate) */}
    {(props.spectators ?? []).length > 0 && (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>
          Watching ({props.spectators!.filter(s => s.identity.toHexString() !== props.myIdentityHex).length})
        </div>
        {props.spectators!
          .filter(s => s.identity.toHexString() !== props.myIdentityHex)
          .map(s => (
            <div key={s.id.toString()} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
              <span>{s.displayName}</span>
              <button
                onClick={() => props.onKickSpectator?.(s.id)}
                style={{
                  background: 'transparent',
                  color: '#c4955a',
                  border: '1px solid rgba(196, 149, 90, 0.4)',
                  borderRadius: 4,
                  padding: '2px 8px',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                Kick
              </button>
            </div>
          ))}
      </div>
    )}

    {/* Private toggle — always visible */}
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={!props.isGamePublic}
        onChange={(e) => props.onSetGamePrivate?.(!e.target.checked)}
      />
      <span>Private game (no new spectators)</span>
    </label>
  </div>
)}
```

- [ ] **Step 4: Pass the new props from `MultiplayerCanvas.tsx:~5868`.**

In `app/play/components/MultiplayerCanvas.tsx`, find the existing `<CardScaleControl ... />` element and add:

```tsx
<CardScaleControl
  /* ...existing props... */
  spectators={gameState.spectators}
  myIdentityHex={myIdentity?.toHexString()}
  shareHandWithSpectators={gameState.myPlayer?.shareHandWithSpectators}
  gameId={gameId}
  isGamePublic={gameState.game?.isPublic}
  onSetShareHand={(share) => conn?.reducers.setShareHandWithSpectators({ gameId, share })}
  onKickSpectator={(spectatorId) => conn?.reducers.kickSpectator({ gameId, spectatorId })}
  onSetGamePrivate={(isPublic) => conn?.reducers.setGamePrivate({ gameId, isPublic })}
/>
```

The exact connection/identity/handle names vary by what `MultiplayerCanvas` already destructures — match them. If `conn` isn't already in scope, the codebase pattern is `const { conn } = useSpacetimeDB() as any;` (see `app/play/spectate/[code]/client.tsx:65` and `app/play/components/LobbyList.tsx:21-22`). Identity is reachable as `conn?.identity`.

- [ ] **Step 5: Type-check.**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add app/shared/components/CardScaleControl.tsx app/play/components/MultiplayerCanvas.tsx
git commit -m "spectator: extend CardScaleControl gear popover with share/kick/private controls"
```

---

## Task 13: Re-enable spectate route, lobby toggle, SpectatorBar request button, leave-on-unmount

**Files:**
- Modify: `app/play/spectate/[code]/client.tsx`
- Modify: `app/play/components/GameLobby.tsx`
- Modify: `app/play/components/SpectatorBar.tsx`

- [ ] **Step 1: Re-enable the spectate route.**

Open `app/play/spectate/[code]/client.tsx`. Search for the "currently disabled" / "read only" guards (around the `aria-label="Spectator mode — read only"` element near line 175 per the earlier grep) and remove the disable logic so the spectator client renders the canvas in spectator mode.

- [ ] **Step 2: Replace the hardcoded display name.**

Around line 78-80 of the spectate client, the call is:

```ts
conn.reducers.joinAsSpectator({
  code,
  displayName: 'Spectator',
});
```

Replace `'Spectator'` with the Supabase profile name. The existing app pattern is `useUser()` or reading from a profile store — match how `GameLobby.tsx` or the player join flow derives `displayName` (likely `profile?.displayName ?? user?.email ?? 'Spectator'`).

- [ ] **Step 3: Add `leaveAsSpectator` on unmount.**

In the same component, add a cleanup effect:

```ts
useEffect(() => {
  return () => {
    if (gameId !== null && conn) {
      conn.reducers.leaveAsSpectator({ gameId });
    }
  };
}, [gameId, conn]);
```

(Or fold it into the existing effect that handles connection lifecycle if there is one — match the file's existing pattern.)

- [ ] **Step 4: Pass `viewerKind='spectator'` to the canvas.**

The spectator client renders `<MultiplayerCanvas ... />`. Add the prop:

```tsx
<MultiplayerCanvas
  /* ...existing props... */
  viewerKind="spectator"
/>
```

Also swap `useGameState(gameId)` for `useSpectatorGameState(gameId)` in this file.

- [ ] **Step 5: Add "Request hands" button to `SpectatorBar.tsx`.**

Open `app/play/components/SpectatorBar.tsx`. Add a `gameId` prop and a request handler. Add the imports at the top of the file if not already present: `import { useState } from 'react';` and `import { useSpacetimeDB } from 'spacetimedb/react';`.

```tsx
interface SpectatorBarProps {
  code: string;
  spectatorCount: number;
  gameId: bigint;
}

export function SpectatorBar({ code, spectatorCount, gameId }: SpectatorBarProps) {
  const { conn } = useSpacetimeDB() as any;
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const isCooling = Date.now() < cooldownUntil;

  const onRequest = () => {
    if (isCooling) return;
    conn?.reducers.requestSpectatorHandReveal({ gameId });
    setCooldownUntil(Date.now() + 30_000);
  };

  return (
    <div /* existing wrapper styles */>
      {/* existing content */}
      <button
        onClick={onRequest}
        disabled={isCooling}
        style={{
          /* match the bar's existing button styling */
        }}
      >
        {isCooling ? 'Request sent' : 'Request hands'}
      </button>
    </div>
  );
}
```

Pass `gameId` from the spectator client at the existing `<SpectatorBar ... />` call (already at line ~161 in `spectate/[code]/client.tsx`).

- [ ] **Step 6: Re-enable the lobby Spectate toggle.**

Open `app/play/components/GameLobby.tsx`. Find the "disabled until spectator mode is ready" comment around lines 476-489 and re-enable the toggle (remove the `disabled` prop / comment).

- [ ] **Step 7: Type-check.**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit.**

```bash
git add app/play/spectate/[code]/client.tsx app/play/components/SpectatorBar.tsx app/play/components/GameLobby.tsx
git commit -m "spectator: re-enable spectate route + lobby toggle + Request hands button"
```

---

## Task 14: Manual definition-of-done verification

**Files:** none modified (unless verification turns up bugs).

- [ ] **Step 1: Start the dev server.**

```bash
npm run dev
```

Verify the dev server is connected to the dev DB:

```bash
grep NEXT_PUBLIC_SPACETIMEDB_DB_NAME .env.local
```

Expected: `NEXT_PUBLIC_SPACETIMEDB_DB_NAME=redemption-multiplayer-dev`.

- [ ] **Step 2: Self-spectate end-to-end.**

In tab A (`http://localhost:3000/play`), create a game, pick a deck, advance to the playing state with a Goldfish-style flow (no second player). Note the game code.

In tab B (same browser, new tab), open `http://localhost:3000/play/spectate/<CODE>`. Verify:
- Spectator client loads without error.
- Spectator canvas renders both seats' public zones (LoB, territory, discard, banish, LoR, reserve, paragon).
- Both seats' hands are face-down in tab B.
- Tab A's chat shows "<your name> started spectating".
- Tab A's gear popover now has a "Spectators (1)" / "Watching (0)" section (your own row hidden).

- [ ] **Step 3: Share-hand toggle round trip.**

In tab A, open the gear popover. Toggle "Share my hand with spectators" ON. Verify tab B's spectator canvas shows your hand face-up immediately. Toggle OFF — verify hand flips face-down.

- [ ] **Step 4: Request hands flow.**

In tab B, click "Request hands". Verify:
- Tab A renders a banner: "<spectator name> wants to see hands" with Share / Dismiss buttons.
- Tab A's chat shows "<spectator name> requested to see hands".
- Click Share — banner disappears, share-hand toggle flips to ON, tab B sees hand.
- Wait 30s (or fewer if your timer is shorter for testing) — banner from a subsequent request should auto-disappear.
- Tab B's "Request hands" button is disabled for 30s after click.

- [ ] **Step 5: Rate-limit verification.**

In tab B's devtools console, paste:

```js
for (let i = 0; i < 5; i++) {
  spacetimedb.reducers.requestSpectatorHandReveal({ gameId: <ID> });
}
```

(Replace `<ID>` with the BigInt gameId — get from a console log or `useGameState`.) Verify only ONE banner appears in tab A and only ONE "requested to see hands" chat line.

- [ ] **Step 6: Kick + ban verification.**

In tab A, click Kick next to the spectator. Verify:
- Tab B's spectator client sees its Spectator row deleted (canvas / SpectatorBar updates).
- Tab A's chat shows "<spectator name> was removed from spectators by <your name>".
- Reload tab B (same URL). Spectator client should reject with "You have been removed from this game".

- [ ] **Step 7: Private mode verification.**

Wipe the ban for a clean test (`spacetime sql redemption-multiplayer-dev "DELETE FROM spectator_ban"` if convenient), then re-join from tab B. In tab A, toggle Private game on. Open a third tab as a different user (incognito) and try to spectate — should reject with "This game is private". Verify the original spectator in tab B is unaffected. Toggle private off; the third tab can now join.

- [ ] **Step 8: Disconnect leak verification.**

In tab B, close the tab WITHOUT clicking leave (just Cmd+W). Verify:
- Tab A's spectator list updates within a few seconds (the `clientDisconnected` hook fires when SpacetimeDB notices the WebSocket drop).
- Tab A's chat shows "<spectator name> stopped spectating".

- [ ] **Step 9: System-message rendering.**

Inspect tab A's chat panel. All system messages from this test should render centered, italic, muted (no sender prefix). Verify both ChatPanel render sites — collapse/expand the chat panel if there are two layouts.

- [ ] **Step 10: Final commit (if anything was tweaked during manual testing).**

```bash
git status
git add -p
git commit -m "spectator: tweaks from manual verification pass"
```

If nothing changed, skip this step.

---

## Done.

At this point, all 14 tasks are complete and the spec is fully implemented. Outstanding items intentionally **not** in scope: production publish, identity-based ban hardening, server-side hand-data redaction. These are deferred per the spec.
