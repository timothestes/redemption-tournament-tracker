# Multiplayer Pause Feature — Design

**Date:** 2026-05-03
**Status:** Approved, ready for implementation

## Problem

Players in multiplayer games sometimes need to step away (bathroom, judge call, rules question) but the elapsed-time display keeps running. There is no server-authoritative way for both players to agree to pause the game.

## Design

A pause button next to the existing game timer. Pressing it sends a consent request to the opponent. On acceptance, the timer freezes for both players. The button becomes a play button; pressing it sends a resume request that also requires consent.

Pause is **honor-system only** — it stops the timer display and shows a "paused" indicator on both screens, but does *not* lock card-action reducers. Either player can still move cards, draw, etc. The pause is a fairness signal, not an enforced game freeze.

## Behaviour rules

| Decision | Choice |
|---|---|
| Timeout for unanswered requests | None — request stays pending until accepted, declined, or cancelled by requester |
| Concurrent requests | Only one pending request per game at a time |
| Who can request | Either player |
| What pause locks | Timer display only (no reducer locking) |
| Disconnect during pending request | Auto-clear the pending request |
| Disconnect while paused | Stay paused (the absent player can rejoin to a paused game) |

## SpacetimeDB schema changes

Add four fields to `Game` (in [spacetimedb/src/schema.ts](spacetimedb/src/schema.ts)):

```ts
pauseRequestedBy: t.string().default(''),     // '' | '0' | '1' (seat that requested)
pauseRequestType: t.string().default(''),     // '' | 'pause' | 'resume'
pauseStartedAtMicros: t.u64().default(0n),    // when current pause began (0 = not paused)
totalPausedMicros: t.u64().default(0n),       // accumulated paused time across the game
```

Derived state (no `isPaused` flag — derived from these):

| State | `pauseStartedAtMicros` | `pauseRequestedBy` | `pauseRequestType` |
|---|---|---|---|
| Running, no request | `0` | `''` | `''` |
| Pause request pending | `0` | `'0'` or `'1'` | `'pause'` |
| Paused | `> 0` | `''` | `''` |
| Resume request pending | `> 0` | `'0'` or `'1'` | `'resume'` |

## Reducers

Five new reducers in [spacetimedb/src/index.ts](spacetimedb/src/index.ts). All validate caller is a player in the game and `game.status === 'playing'`.

```
request_pause(gameId)
  // Guard: pauseRequestedBy == '' (one pending at a time)
  // Guard: pauseStartedAtMicros == 0 (not already paused)
  // Set: pauseRequestedBy = caller's seat, pauseRequestType = 'pause'

respond_to_pause(gameId, accepted)
  // Guard: pauseRequestType == 'pause' && pauseRequestedBy != ''
  // Guard: caller is the OPPONENT of pauseRequestedBy
  // If accepted: pauseStartedAtMicros = ctx.timestamp; clear request fields
  // If declined: just clear request fields

request_resume(gameId)
  // Guard: pauseStartedAtMicros > 0 (currently paused)
  // Guard: pauseRequestedBy == '' (one pending at a time)
  // Set: pauseRequestedBy = caller's seat, pauseRequestType = 'resume'

respond_to_resume(gameId, accepted)
  // Guard: pauseRequestType == 'resume' && pauseRequestedBy != ''
  // Guard: caller is the OPPONENT of pauseRequestedBy
  // If accepted: totalPausedMicros += (now - pauseStartedAtMicros)
  //              pauseStartedAtMicros = 0
  //              clear request fields
  // If declined: just clear request fields (still paused)

cancel_pause_request(gameId)
  // Guard: pauseRequestedBy == caller's seat
  // Clear request fields (works for pause OR resume pending)
```

Disconnect hook (existing `clientDisconnected` in [spacetimedb/src/index.ts](spacetimedb/src/index.ts)):
- For each game the disconnecting player is in, if `pauseRequestedBy` matches their seat, clear the request fields.
- Do NOT auto-resume an already-active pause.

## Client changes

### Timer hook ([app/play/hooks/useGameTimer.ts](app/play/hooks/useGameTimer.ts))

Extend the hook signature to accept the new pause state:

```ts
useGameTimer(
  anchorMicros: bigint | null,
  pauseStartedAtMicros: bigint,   // 0n when not paused
  totalPausedMicros: bigint,
)
```

Compute elapsed:

```
elapsedMs =
  (now - anchorMs)
  - Number(totalPausedMicros / 1000n)
  - (pauseStartedAtMicros > 0n ? now - Number(pauseStartedAtMicros / 1000n) : 0)
```

Existing local `pause`/`resume` (used for "search modal open") stays as-is — separate session-only concern, layered on top.

### Pause/Play button ([app/play/components/TurnIndicator.tsx](app/play/components/TurnIndicator.tsx))

A small icon button rendered next to `timerDisplay`. State machine:

| Game state | Button shows | onClick |
|---|---|---|
| Running, no request | Pause icon | call `request_pause` |
| Pause request pending, by me | "Cancel request" with spinner | call `cancel_pause_request` |
| Pause request pending, by opponent | (button hidden, toast handles UI) | — |
| Paused, no request | Play icon | call `request_resume` |
| Resume request pending, by me | "Cancel request" with spinner | call `cancel_pause_request` |
| Resume request pending, by opponent | (button hidden, toast handles UI) | — |

### Consent toast (new, opponent's screen)

When `pauseRequestedBy` is the opponent's seat and `pauseRequestType !== ''`, render a toast at the top of the screen:

- "Opponent wants to pause the game" / "Opponent wants to resume the game"
- Two buttons: **Accept** / **Decline**
- Accept → call `respond_to_pause` or `respond_to_resume` with `accepted: true`
- Decline → same, with `accepted: false`

Style follows existing `toast-notification.tsx` patterns. Non-blocking.

### Paused indicator

When `pauseStartedAtMicros > 0n`, the timer display in `TurnIndicator` renders in a dimmed/italic style with a small "PAUSED" label next to it. (Reuses the existing `timerPaused` styling already in the component for the search-modal-open case.)

## File-by-file impact

| File | Change |
|---|---|
| `spacetimedb/src/schema.ts` | Add 4 fields to `Game` table |
| `spacetimedb/src/index.ts` | 5 new reducers + disconnect cleanup |
| `app/play/hooks/useGameTimer.ts` | Accept and apply pause state |
| `app/play/[code]/client.tsx` | Pass pause state to hook + canvas |
| `app/play/components/MultiplayerCanvas.tsx` | Forward pause state + render consent toast |
| `app/play/components/TurnIndicator.tsx` | Pause/play button next to timer |

After schema/reducer edits: republish the SpacetimeDB module and regenerate bindings (per `spacetimedb-deploy` skill).

## Test plan

1. Player A clicks pause → button shows "Cancel"; Player B sees toast.
2. Player B accepts → both screens show paused timer; button on A flips to play.
3. Player A clicks play → button shows "Cancel"; Player B sees resume toast.
4. Player B accepts → timer resumes; total paused time is correctly subtracted.
5. Player B declines → request clears; state unchanged.
6. Player A cancels pending request → state clears.
7. Player A disconnects mid-request → request auto-clears for B.
8. Player A disconnects mid-pause → game stays paused; B can request resume.
