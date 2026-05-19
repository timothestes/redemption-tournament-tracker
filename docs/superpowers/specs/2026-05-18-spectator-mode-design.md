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
3. Each player independently controls a `shareHandWithSpectators` toggle. When on, that player's hand is face-up to **all** current and future spectators. Default off.
4. Spectators can press "Request hands" → non-blocking row-driven banner appears on each player's screen with **Share with spectators** / **Dismiss**. Share flips that player's toggle on (visible to all spectators, not just the requester). Either player can flip off at any time.
5. Either player can kick a specific spectator. Kicked spectators are banned from that game until it finishes.
6. Either player can flip the game to private (`Game.isPublic = false`). New spectator joins are rejected; existing spectators stay.
7. Spectator join/leave appears in chat as system messages.

## Non-goals

- Server-side hand-data redaction. Spectator clients receive the same `card_instance` rows other clients do; visibility is enforced in the canvas. This matches today's opponent-hiding trust model and is consistent across the app. A future "Level 2 visibility" pass would address spectators and opponents together.
- Multiple identities per browser tab. Self-spectate means opening `/play/spectate/<code>` in a separate tab; same identity ends up with both a `Player` and a `Spectator` row, which is fine. **Your own hand will appear face-down in the spectator tab unless you toggle `shareHandWithSpectators` on yourself** — this is by design, not a bug, since the spectator view is governed by the same toggle regardless of whose tab it is.
- New reveal channels for spectators only. Spectators see card-level reveals via the same `revealExpiresAt` / `handRevealSnapshot` fields opponents already see.
- Refactoring the existing `ChatMessage.senderId` overload (Player.id vs Spectator.id) — system messages use a `senderId = 0n` sentinel and embed the display name directly in the text, so no client-side sender lookup is needed for the new messages. Properly typing sender kind is a separate cleanup.
- Per-spectator hand visibility. `shareHandWithSpectators` is one boolean per player; sharing reveals to every current and future spectator. Per-(player, spectator) ACLs are deferred — the request banner copy is explicit ("Share with all spectators?") so users aren't misled.
- Hardening bans against fresh identities. `SpectatorBan` is identity-keyed; a determined user can sign out / open incognito and rejoin with a new identity. Bans are best-effort, sufficient for social moderation.

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

Add `SpectatorBan`, `SpectatorHandRequest`, `SpectatorHandRequestExpiry` to the `schema({ ... })` call at `schema.ts:345`. In `index.ts`, call `setSpectatorHandRequestExpiryReducer(expire_spectator_hand_request)` at module load, mirroring the existing `setDisconnectTimeoutReducer` wiring near `index.ts:1674`.

## Reducers — `spacetimedb/src/index.ts`

### Modified

**`join_as_spectator({ code, displayName })`**

1. Lookup game by code; throw if not found.
2. Check `SpectatorBan` for `(gameId, ctx.sender)` — throw `'You have been removed from this game'` if banned.
3. If `!game.isPublic`, check whether a `Spectator` row already exists for `(gameId, ctx.sender)`. If not, throw `'This game is private'`. (Existing spectators reconnecting are still allowed.)
4. If a `Spectator` row already exists for `(gameId, ctx.sender)`, update its `displayName` (catches renames between sessions) and return without inserting another row (idempotent reconnect).
5. Insert `Spectator` row.
6. Insert system `ChatMessage`: `senderId = 0n`, text `"<displayName> started spectating"`.

**`leave_game({ gameId })`** — spectator branch only

When the spectator branch deletes a `Spectator` row, also insert a system `ChatMessage`: `"<displayName> stopped spectating"`. Player branch unchanged.

**`clientDisconnected` lifecycle hook**

Today only iterates `Player` rows. Add a Spectator branch: for each `Spectator` row with `identity === ctx.sender`, delete the row and emit the "stopped spectating" system chat. No grace timeout — spectators don't get the same reconnect window as Players (their only persistent state is the row itself). This is the safety net for tab-close, mobile backgrounding, crashes, and `beforeunload` races where `leave_as_spectator` never fires.

### New

**`leave_as_spectator({ gameId })`**

Used by the spectator tab on unmount/close. Only touches the `Spectator` row for `ctx.sender` — works correctly when the same identity is also a Player. Emits the "stopped spectating" system chat. No-op if no Spectator row exists.

**`set_share_hand_with_spectators({ gameId, share })`**

Caller must be a Player in `gameId`. Updates `Player.shareHandWithSpectators`. (Global per player — flips for all current and future spectators.)

**`request_spectator_hand_reveal({ gameId })`**

Caller must be a Spectator in `gameId`. **Rate limit**: if a `SpectatorHandRequest` row already exists for `(gameId, this spectator's id)`, return silently (no throw, no duplicate insert, no duplicate chat). Client-side button-disable is not enough — direct reducer calls bypass it. Otherwise: insert `SpectatorHandRequest` row, insert system `ChatMessage` (`"<displayName> requested to see hands"`), schedule a `SpectatorHandRequestExpiry` row 30 seconds out referencing the request id.

**`expire_spectator_hand_request({ arg })`** (scheduled)

Looks up `SpectatorHandRequest.id.find(arg.requestId)` first. If the row exists, delete it. Calling `.delete()` on a missing PK can throw in some SDK paths, so guard with `.find()`. Wired into `SpectatorHandRequestExpiry.scheduled`.

**`kick_spectator({ gameId, spectatorId })`**

Caller must be a Player in `gameId`. **Server-side lookup of `caller.displayName`** via `Player.player_identity.filter(ctx.sender)` (the reducer doesn't take a name arg, must compose the system message itself). Looks up the target `Spectator` row for its `identity` and `displayName`, inserts a `SpectatorBan` row (`bannedBySeat = caller.seat`, `bannedAt = ctx.timestamp`), deletes the `Spectator` row, emits system `ChatMessage` (`"<spectatorName> was removed from spectators by <playerName>"`).

**`set_game_private({ gameId, isPublic })`**

Caller must be a Player in `gameId`. **Server-side lookup of `caller.displayName`** as in `kick_spectator`. Updates `Game.isPublic`. Emits system `ChatMessage` (`"Game set to private by <playerName>"` / `"Game set to public by <playerName>"`). To clean-slate kick everyone, the player flips private first, then kicks each existing spectator individually — there's a small race window where a third spectator could join between the two reducers, but it's acceptable for a social-moderation feature.

## Client changes

### `app/play/spectate/[code]/client.tsx`

- Re-enable the route (currently aria-labelled "Spectator mode — read only" and gated off).
- Replace hardcoded `displayName: 'Spectator'` with the spectator's Supabase profile display name (fall back to `'Spectator'` if missing).
- On unmount / `beforeunload`, call `leaveAsSpectator({ gameId })` — guard with `gameId !== null` so we don't send `BigInt(0)`. The new `clientDisconnected` Spectator branch is the safety net when this never fires (mobile backgrounding, crashes).
- Render the existing canvas with a `viewerKind: 'spectator'` prop (see canvas + hook changes below).
- Add a "Request hands" button to `SpectatorBar` that calls `requestSpectatorHandReveal({ gameId })`. Client-side button-disable for 30 seconds is a UX nicety; the reducer enforces the real rate limit.

### `app/play/hooks/useGameState.ts` — spectator variant

Today `useGameState` returns `myPlayer` / `opponentPlayer` keyed on the viewer's identity. A spectator has no Player row, so both would be `undefined` and the canvas would null-deref. Add a spectator-mode branch (or sibling `useSpectatorGameState`) that:

- Returns `seat0Player` / `seat1Player` instead of `myPlayer` / `opponentPlayer`.
- Returns `viewerKind: 'spectator'`.
- Returns `myCards` / `opponentCards` shaped around seat 0 / seat 1 (stable convention — e.g. seat 0 on the bottom), so the canvas's existing two-zone layout works unchanged.

### `app/play/components/MultiplayerCanvas.tsx`

- Today the canvas filters opponent hand cards using `handRevealed` (legacy whole-hand flag) and `handRevealSnapshot` (JSON array of card IDs). Extract the per-card visibility predicate into a helper, e.g. `isHandCardFaceVisible(card, viewerKind, ownerPlayer)`, with `viewerKind` ∈ `'self' | 'opponent' | 'spectator'`.
- For `'spectator'`: face is visible iff `ownerPlayer.shareHandWithSpectators === true` OR the card's id is in `ownerPlayer.handRevealSnapshot` OR `card.revealExpiresAt` is active. Apply to **both** seats — in spectator mode the "my hand" path that's normally unconditionally face-up must run through this predicate too.
- Brigade-count derivations (`myHandBrigadeCounts` ~line 519, `opponentHandBrigadeCounts` ~line 536) must respect the same predicate in spectator mode — only compute when the share-toggle is on for that seat.
- No new rendering primitives — same face-down / face-up paths the opponent view already uses.

### Player controls — extend `CardScaleControl` (gear popover at `MultiplayerCanvas.tsx:~5868`)

`CardScaleControl` already groups game-wide toggles (timer visibility, card/chat scale, load deck). Extend it with a new "Spectators" subsection:

1. **Share hand with spectators** — toggle bound to `Player.shareHandWithSpectators`, calls `setShareHandWithSpectators`. Hidden when there are zero spectators.
2. **Spectators (N)** list — one row per `Spectator` in this game with a kick button → `kickSpectator({ gameId, spectatorId })`. **Hide rows whose `identity === myPlayer.identity`** (self-spectate tab) to avoid the "kick yourself" affordance. Subsection collapsed/hidden when N = 0.
3. **Make game private / public** — toggle bound to `Game.isPublic`, calls `setGamePrivate`. Always visible (orthogonal to spectator count).

### Hand-reveal request banner — model on `PauseConsentToast`

The app does **not** use Sonner or shadcn `useToast`. The fire-and-forget `GameToast` (`app/shared/components/GameToast.tsx`) has no action-button support. The right pattern is `app/play/components/PauseConsentToast.tsx` — a row-driven banner that renders while a server row exists and disappears when the row is deleted.

- Build `SpectatorHandRequestBanner` on the same pattern.
- Subscribe to `SpectatorHandRequest` filtered by current `gameId`.
- For each row, render a banner: `"<spectatorName> wants to see hands"` with **Share with spectators** / **Dismiss** buttons.
- **Share with spectators** → `setShareHandWithSpectators({ share: true })`. **Dismiss** → local-only dismissal of that row id (track in component state). Server doesn't track decisions; only the request signal.
- Two-tab race: when `myPlayer.shareHandWithSpectators` flips to `true` (from any tab or any source), auto-dismiss any active banner so a stale prompt in the other tab disappears.
- Banner auto-disappears when the underlying `SpectatorHandRequest` row is deleted by `expire_spectator_hand_request` after 30s.

### `app/play/components/GameLobby.tsx`

- Re-enable the Spectate toggle (currently disabled with a "disabled until spectator mode is ready" comment). No other lobby changes.

### `SpectatorPregameView` in `PregameScreen.tsx`

No changes. The new visibility rules only matter once cards are on the canvas. `pregameReady0/1` and `rollResult0/1` are already public data; a spectator subscribing mid-pregame renders a deterministic snapshot.

### Chat rendering — three sites in `MultiplayerCanvas.tsx`

Chat is rendered in two places in `MultiplayerCanvas.tsx` (in-canvas overlay ~lines 1429-1432 and side panel ~lines 1667-1670), with a third duplicated sender lookup around line 999. The `senderId === 0n` system-message branch must be added to all three sites: render with muted styling, italic, no sender prefix. Existing Player/Spectator sender lookup is untouched.

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
  → reducer checks: existing request for this (gameId, spectatorId)? → silent no-op
  → inserts SpectatorHandRequest + system ChatMessage
  → schedules SpectatorHandRequestExpiry (+30s)
  → Both players' SpectatorHandRequestBanner renders from the new row
  → Share → setShareHandWithSpectators({ share: true })
  → Player row update streams; spectator canvas re-derives, hand cards flip face-up
  → Any active banner on the same player (e.g. second tab) auto-dismisses
  → 30s later, expire_spectator_hand_request deletes the request row; banner disappears
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
  → reducer looks up caller.displayName + target.identity/displayName
  → inserts SpectatorBan + system ChatMessage, deletes Spectator row
  → Kicked spectator's client sees its Spectator row vanish
    → redirect to /play, show GameToast "You were removed from this game"
  → Future joinAsSpectator from that identity throws (banned)
```

**Spectator tab closes (any path)**

```
beforeunload fires → leave_as_spectator({ gameId })   (best-effort)
                  → deletes Spectator row + "stopped spectating" chat
beforeunload doesn't fire (mobile background, crash, network drop)
  → eventually clientDisconnected hook fires
  → Spectator branch deletes Spectator row + emits same system chat
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
- Spectator presses "Request hands" → both players see a banner → each independently shares/dismisses.
- Spectator spams "Request hands" → only one banner appears per active request (rate-limited server-side).
- Kick from seat 0 — spectator is banned, cannot rejoin from same identity. Same from seat 1.
- Flip private — new spectator join rejected. Existing spectator stays. Flip public — new joins succeed.
- Spectator closes tab → `leaveAsSpectator` fires → "stopped spectating" system chat posts.
- Spectator force-quits the browser (skip `beforeunload`) → `clientDisconnected` Spectator branch deletes the row + posts the same chat.
- Self-spectate: open spectator tab while seated at the game. Own row does NOT appear in own "Spectators" list. Own hand appears face-down in the spectator tab until the share toggle is flipped.
- Two-tab race: open game in two browser windows as same player. Spectator requests hands. Share in window A → window B's banner auto-dismisses.
- Renamed user reconnecting as spectator: `displayName` on the existing Spectator row updates.
- ChatMessage left over from a kicked/disconnected Spectator still renders (sender lookup tolerates missing rows).
- System chat messages render with muted styling and no sender prefix at all three render sites.
- Per-card `revealExpiresAt` flashes are visible to spectators (no regression in existing reveal behavior).

**Rollout**

Dev DB only. Publish via the project's existing `spacetime publish` workflow against the dev module name. Regenerate client bindings, verify in two browser tabs, then re-publish on user request.

## Implementation notes

- Auto-inc IDs in SpacetimeDB start at 1; `senderId = 0n` is a safe system-message sentinel today. Add a one-line code comment near the first use so a future migration doesn't accidentally seed autoInc from 0.
- The spectator branch of `leave_game` and the new `leave_as_spectator` and the new `clientDisconnected` branch all emit the same `"<displayName> stopped spectating"` system chat — keep them in lockstep when implementing.
- `SpectatorHandRequest.spectatorId` is stored for rate-limit lookups (per-(gameId, spectatorId) "already exists?" check) and not for display — display uses `spectatorName`.
