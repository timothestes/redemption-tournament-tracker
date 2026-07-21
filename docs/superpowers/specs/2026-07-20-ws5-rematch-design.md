# WS-5 — Rematch: one-tap run-it-back + cancel pending

Part of the multiplayer-flows-fixes effort (audit PR #221 → workstreams WS-1..6). WS-3
and WS-4 have shipped; WS-5 is the next item in the serialized chain that touches the
game-over surfaces. Fix #5 from the audit's recommended order.

## Problem

Two gaps in the post-game rematch flow on `/play`:

1. **Normal games force a deck re-pick every rematch.** Forge games are already one-tap
   (they reuse the seat's authorized deck), but normal `/play` opens the `DeckPickerModal`
   on every "Play Again" — even though the player almost always wants to run it back with
   the same deck. Friction on the most common action.

2. **A pending rematch request cannot be cancelled.** After a player requests a rematch
   they see a disabled "Waiting…" button and a "Waiting for opponent…" toast with no way
   out. `respond_rematch` explicitly rejects the requester ("Cannot respond to your own
   rematch request"), so there is no server path to retract. The requester is stuck until
   the opponent acts (or leaves).

## Goals

- Normal `/play` "Play Again" is **one-tap**: reuse the last deck, no picker.
- Preserve deck flexibility for normal play via a quiet **"Change deck"** escape hatch
  (opens the existing picker). Applies to both initiating a rematch and accepting one.
- A requester can **cancel** a pending rematch and return to the game-over state.

## Non-goals

- No new `Game` fields. `rematchCode` (vestigial, always `''`) is left untouched.
- No change to the Forge rematch path beyond sharing the "Change deck" affordance
  (Forge stays one-tap with its deck locked by seat authorization).
- Design-system cleanup of these bespoke amber dialogs is **WS-6**, not here.

## Design

### Part A — one-tap run-it-back (normal)

`gameParams.deckId` (which already tracks mid-game deck swaps) is already passed to
`GameOverOverlay` as `myDeckId` on the normal path — it is simply ignored today because
the normal branch always opens the picker. The change:

- **Play Again (primary)** → reuse `myDeckId`: `loadDeckForGame(myDeckId)` → `requestRematch(...)`.
  No picker. This mirrors the existing `handleForgeRematch` path, using the normal
  `loadDeckForGame` loader instead of `loadForgeDeckForGame`.
- **Change deck (secondary)** → opens `DeckPickerModal` (today's behavior), then requests
  the rematch with the chosen deck. Rendered as a quiet secondary affordance next to the
  primary action, not a separate step.
- **Accept** (responding to the opponent's request) gets the same treatment: reuse
  `myDeckId` one-tap, with a "Change deck" option that opens the picker before responding.

Fallback: if `myDeckId` is missing or `loadDeckForGame` fails, fall back to opening the
picker (never leave the player with a dead button).

### Part B — cancel pending rematch

Mirror the existing mutually-agreed **pause-request cancel** pattern already in this
codebase (`request_pause` / `onCancelPauseRequest`).

- **Server** — new reducer `cancel_rematch(gameId)`:
  - Guards: game `status === 'finished'`; `rematchRequestedBy !== ''`; the caller's seat
    equals `rematchRequestedBy`; `rematchResponse === ''` (can't cancel once resolved).
  - Effect: clear the rematch fields — identical field-clear to the `respond_rematch`
    decline branch (`rematchRequestedBy`, `rematchDeckId0/1`, `rematchDeckData0/1`,
    `rematchParagon0/1`, `rematchResponse`, `rematchCode`).
  - Log a `REMATCH_CANCELLED` action, symmetric with `REMATCH_DECLINED`.
  - Logic-only, **no schema change**, no bindings-shape change beyond the new reducer.

- **Client** — `cancelRematch(gameId)` wrapper in `useGameState` calling
  `conn.reducers.cancelRematch({ gameId })`; no-op stub in the disconnected branch (matches
  the existing `requestRematch`/`respondRematch` pattern).

- **UI**
  - `TurnIndicator`: when `rematchPending`, the current disabled "Waiting…" button becomes
    an active **Cancel** button wired to `onCancelRematch`.
  - `GameOverOverlay`: the `showWaitingStatus` toast ("Waiting for opponent…") gains a
    **Cancel** affordance calling `gameState.cancelRematch(...)`.
  - `client.tsx`: pass a new `onCancelRematch` down to `TurnIndicator` on both finished
    render paths.

## Files

| File | Change |
|------|--------|
| `spacetimedb/src/index.ts` | New `cancel_rematch` reducer + `REMATCH_CANCELLED` log |
| `app/play/hooks/useGameState.ts` | `cancelRematch` wrapper (+ interface + disconnected stub) |
| `app/play/components/GameOverOverlay.tsx` | Normal one-tap request/accept; "Change deck" secondary; cancel in waiting toast |
| `app/play/components/TurnIndicator.tsx` | "Waiting…" → active "Cancel" button (`onCancelRematch`) |
| `app/play/[code]/client.tsx` | Wire `onCancelRematch` on both finished paths |

## Deploy / verification

- The new reducer requires a **SpacetimeDB module republish + `spacetime generate`** for
  both `redemption-multiplayer-dev` and prod `redemption-multiplayer`, paired with the
  Vercel deploy on merge — same operational note as WS-4 (behavior lives in the module).
  Use the `spacetimedb-deploy` skill.
- Verify with the `verify` skill / a 2-player Playwright pass:
  1. Normal game → both players finish → **Play Again is one-tap** (no picker), rematch
     starts with the same decks.
  2. **Change deck** opens the picker and the rematch uses the newly chosen deck.
  3. Requester **cancels** a pending rematch → back to game-over; either player can then
     re-initiate.
  4. **Accept** is one-tap; Accept → Change deck path still works.
  5. Forge rematch unchanged (still one-tap).

## Risks

- Format-match guards in `request_rematch` / `respond_rematch` are unchanged; reusing the
  last deck keeps the same format, so the one-tap path can't trip them. The "Change deck"
  path can still pick a mismatched format — the existing server guard already rejects it;
  surface that error the same way it is surfaced today.
- Cancel races with the opponent's accept: if accept lands first, `cancel_rematch` throws
  (`rematchResponse !== ''`) and is a harmless no-op — the game has already reset. The
  client's `rematchPending` derivation flips off on the subscription update regardless.
