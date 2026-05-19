# Spectator Mode — Design

**Date:** 2026-05-18
**Status:** Approved for implementation planning
**Scope:** Multiplayer SpacetimeDB game (`app/play/`, `spacetimedb/src/`)

## Context

Scaffolding for spectator mode already exists:
- `Spectator` table in `spacetimedb/src/schema.ts`
- `join_as_spectator` and spectator-aware `leave_game` reducers
- `/app/play/spectate/[code]/client.tsx` route (currently disabled at the UI level)
- `SpectatorBar` component, `SpectatorPregameView`, `Spectate` toggle in `GameLobby` (disabled)

Hand visibility is fully client-side today: every `card_instance` row streams to every client, and the canvas hides opponent hand cards using `Player.handRevealed` + `Player.handRevealSnapshot`. There are no SpacetimeDB views in the project.

This spec wires up the missing functionality and keeps the same client-side trust model.

## Goals

1. Spectators can join any game by code/URL, including mid-game and the spectator's own games (no player-exclusion gate).
2. Default spectator visibility: Lands of Bondage, Territory, Discard, Banish, Land of Redemption, Reserve, Paragon — i.e. everything except hidden hand cards.
3. Each player independently controls a `shareHandWithSpectators` toggle. When on, that player's hand is face-up to all spectators. Default off.
4. Spectators can press "Request hands" → non-blocking toast appears on each player's screen with Accept/Decline. Accept flips that player's toggle on. Either player can flip off at any time.
5. Either player can kick a specific spectator. Kicked spectators are banned from that game until it finishes.
6. Either player can flip the game to private (`Game.isPublic = false`). New spectator joins are rejected; existing spectators stay.
7. Spectator join/leave appears in chat as system messages.

## Non-goals

- Server-side hand-data redaction. Spectator clients receive the same `card_instance` rows other clients do; visibility is enforced in the canvas. This matches today's opponent-hiding trust model and is consistent across the app. A future "Level 2 visibility" pass would address spectators and opponents together.
- Multiple identities per browser tab. Self-spectate means opening `/play/spectate/<code>` in a separate tab; same identity ends up with both a `Player` and a `Spectator` row, which is fine.
- New reveal channels for spectators only. Spectators see card-level reveals via the same `revealExpiresAt` / `handRevealSnapshot` fields opponents already see.
- Refactoring the existing `ChatMessage.senderId` overload (Player.id vs Spectator.id) — system messages use a `senderId = 0n` sentinel; properly typing sender kind is a separate cleanup.

## Schema changes — `spacetimedb/src/schema.ts`

### `Player` — add one column

```ts
shareHandWithSpectators: t.bool().default(false),
```

### New table — `SpectatorBan`

```ts
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

### New table — `SpectatorHandRequest`

Transient signal for the player-side toast. Cleaned up by a scheduled reducer 30s after `requestedAt`.

```ts
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

### New scheduled table — `SpectatorHandRequestExpiry`

Follows the existing pattern (`DisconnectTimeout`, `ChooseFirstTimeout`, `CleanupSchedule`): forward-reference setter exported from `schema.ts`, reducer wired up at module load in `index.ts`.

```ts
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

### Schema export

Add `SpectatorBan`, `SpectatorHandRequest`, `SpectatorHandRequestExpiry` to the `schema({ ... })` call at the bottom of `schema.ts`.

## Reducers — `spacetimedb/src/index.ts`

### Modified

**`join_as_spectator({ code, displayName })`**

1. Lookup game by code; throw if not found.
2. Check `SpectatorBan` for `(gameId, ctx.sender)` — throw `'You have been removed from this game'` if banned.
3. If `!game.isPublic`, check whether a `Spectator` row already exists for `(gameId, ctx.sender)`. If not, throw `'This game is private'`. (Existing spectators reconnecting are still allowed.)
4. If a `Spectator` row already exists for `(gameId, ctx.sender)`, return without inserting (idempotent reconnect).
5. Insert `Spectator` row.
6. Insert system `ChatMessage`: `senderId = 0n`, text `"<displayName> started spectating"`.

**`leave_game({ gameId })`** — spectator branch only

When the spectator branch deletes a `Spectator` row, also insert a system `ChatMessage`: `"<displayName> stopped spectating"`. Player branch unchanged.

### New

**`leave_as_spectator({ gameId })`**

Used by the spectator tab on unmount/close. Only touches the `Spectator` row for `ctx.sender` — works correctly when the same identity is also a Player. Emits the "stopped spectating" system chat. No-op if no Spectator row exists.

**`set_share_hand_with_spectators({ gameId, share })`**

Caller must be a Player in `gameId`. Updates `Player.shareHandWithSpectators`.

**`request_spectator_hand_reveal({ gameId })`**

Caller must be a Spectator in `gameId`. Inserts `SpectatorHandRequest` row, inserts system `ChatMessage` (`"<displayName> requested to see hands"`), schedules a `SpectatorHandRequestExpiry` row 30 seconds out referencing the request id.

**`expire_spectator_hand_request({ arg })`** (scheduled)

Deletes the `SpectatorHandRequest` row with the matching `requestId`, if it still exists. Wired into `SpectatorHandRequestExpiry.scheduled`.

**`kick_spectator({ gameId, spectatorId })`**

Caller must be a Player in `gameId`. Looks up the target `Spectator` row, inserts a `SpectatorBan` row (`bannedBySeat = caller.seat`, `bannedAt = ctx.timestamp`), deletes the `Spectator` row, emits system `ChatMessage` (`"<spectatorName> was removed from spectators by <playerName>"`).

**`set_game_private({ gameId, isPublic })`**

Caller must be a Player in `gameId`. Updates `Game.isPublic`. Emits system `ChatMessage` (`"Game set to private by <playerName>"` / `"Game set to public by <playerName>"`).

## Client changes

### `app/play/spectate/[code]/client.tsx`

- Re-enable the route (currently aria-labelled "Spectator mode — read only" and gated off).
- Replace hardcoded `displayName: 'Spectator'` with the spectator's Supabase profile display name (fall back to `'Spectator'` if missing).
- On unmount / `beforeunload`, call `leaveAsSpectator({ gameId })` instead of leaving the connection to time out.
- Render the existing canvas with a new prop indicating spectator-view mode (see canvas changes below).
- Add a "Request hands" button to `SpectatorBar` that calls `requestSpectatorHandReveal({ gameId })`. Disabled for 30 seconds after a click (matches the auto-expiry window).

### `app/play/components/MultiplayerCanvas.tsx`

- Today the canvas filters opponent hand cards using `handRevealed` (legacy whole-hand flag) and `handRevealSnapshot` (JSON array of card IDs). Extract the per-card visibility predicate into a helper, e.g. `isHandCardFaceVisible(card, viewerKind, ownerPlayer)`, with `viewerKind` ∈ `'self' | 'opponent' | 'spectator'`.
- For `'spectator'`: face is visible iff `ownerPlayer.shareHandWithSpectators === true` OR the card's id is in `ownerPlayer.handRevealSnapshot` OR `card.revealExpiresAt` is active.
- Wire the helper into both seats' hand rendering when the canvas is mounted in spectator mode.
- No new rendering primitives — same face-down / face-up paths the opponent view already uses.

### Player controls (existing player menu / footer — exact location TBD during plan write-up)

Three new controls:

1. **Share hand with spectators** — toggle bound to `Player.shareHandWithSpectators`, calls `setShareHandWithSpectators`. Hide entirely when there are zero spectators (avoid clutter).
2. **Spectators (N)** panel — lists each `Spectator` row in this game with a kick button. Kick calls `kickSpectator({ gameId, spectatorId })`. Panel collapsed/hidden when N = 0.
3. **Make game private / public** — toggle bound to `Game.isPublic`, calls `setGamePrivate`.

### Hand-reveal request toast (player side)

- Subscribe to `SpectatorHandRequest` filtered by current `gameId`.
- New row → spawn a toast using the existing toast primitive (Sonner / shadcn — match what the rest of the app uses).
- Toast body: `"<spectatorName> wants to see hands"` with **Share hand** / **Dismiss** buttons.
- **Share hand** → `setShareHandWithSpectators({ share: true })`. **Dismiss** → local dismissal only; no server call (the server doesn't track per-player decisions, just the request signal).
- Toast auto-dismisses when the underlying `SpectatorHandRequest` row is deleted (by the 30-second expiry reducer).

### `app/play/components/GameLobby.tsx`

- Re-enable the Spectate toggle (currently disabled with a "disabled until spectator mode is ready" comment). No other lobby changes.

### `SpectatorPregameView` in `PregameScreen.tsx`

No changes. The new visibility rules only matter once cards are on the canvas.

### Chat rendering (`ChatPanel` or wherever messages render)

Add a `senderId === 0n` branch: render with muted styling, italic, no sender prefix. Existing player/spectator sender lookup unchanged.

## Data flow

**Spectator joins**

```
Spectator tab → joinAsSpectator({ code, displayName })
  → checks SpectatorBan, checks game.isPublic
  → inserts Spectator + system ChatMessage
  → subscriptions push to all clients
  → Player UIs update "Spectators (N)"; chat shows "X started spectating"
```

**Spectator requests hands**

```
Spectator → requestSpectatorHandReveal({ gameId })
  → inserts SpectatorHandRequest + system ChatMessage
  → schedules SpectatorHandRequestExpiry (+30s)
  → Player clients spawn toast from new SpectatorHandRequest row
  → Accept → setShareHandWithSpectators({ share: true })
  → Player row update streams; spectator canvas re-derives, hand cards flip face-up
  → 30s later, expire_spectator_hand_request deletes the request row; toast disappears
```

**Player hides hand**

```
Player → setShareHandWithSpectators({ share: false })
  → Player row update streams to all clients
  → Spectator canvas re-derives; hand cards flip face-down
```

**Player kicks spectator**

```
Player → kickSpectator({ gameId, spectatorId })
  → inserts SpectatorBan + system ChatMessage, deletes Spectator row
  → Kicked spectator's client sees its Spectator row vanish
    → redirect to /play, show toast "You were removed from this game"
  → Future joinAsSpectator from that identity throws (banned)
```

**Player flips private**

```
Player → setGamePrivate({ gameId, isPublic: false })
  → Game.isPublic update + system ChatMessage
  → New joinAsSpectator calls from non-existing spectators throw
  → Existing Spectator rows untouched
```

## Testing & rollout

**Self-spectate is the primary testing workflow.** Open a game in tab A as a player, open `/play/spectate/<code>` in tab B (same identity). Tab B exercises every spectator code path.

**Manual scenarios to walk through after implementation**

- Spectator joins during lobby, pregame, and mid-game.
- Each player toggles share-hand on/off — verify spectator canvas updates immediately.
- Spectator presses "Request hands" → both players see a toast → each independently accepts/declines.
- Kick from seat 0 — spectator is banned, cannot rejoin from same identity. Same from seat 1.
- Flip private — new spectator join rejected. Existing spectator stays. Flip public — new joins succeed.
- Spectator closes tab → `leaveAsSpectator` fires → "stopped spectating" system chat posts.
- System chat messages render with muted styling and no sender prefix.
- Per-card `revealExpiresAt` flashes are visible to spectators (no regression in existing reveal behavior).

**Rollout**

Dev DB only. Publish via the project's existing `spacetime publish` workflow against the dev module name. Regenerate client bindings, verify in two browser tabs, then re-publish on user request.

## Open items for the implementation plan

- Exact file for player controls (toggle / spectator list / private toggle). Locate `MultiplayerCanvas` UI affordances or the player footer/menu and pick the closest match.
- Confirm toast primitive in use today (Sonner vs shadcn `useToast`).
- Confirm chat panel component path for the system-message rendering branch.
