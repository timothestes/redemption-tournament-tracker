# Lobby Cleanup on User Departure

**Date:** 2026-03-27
**Status:** Approved

## Problem

When a user creates a public game and leaves the waiting screen (navigates away, closes tab, or crashes), the lobby entry lingers for up to 15 seconds before being cleaned up. Other players see stale lobbies they can't actually join.

## Root Cause

1. **No proactive client cleanup.** The client never calls `leaveGame()` when unmounting the waiting screen — it relies entirely on WebSocket disconnect detection.
2. **`leave_game` reducer doesn't finish waiting games.** It only sets `isConnected = false`, leaving the game in `waiting` status.
3. **15-second disconnect timeout for waiting games.** Originally set to survive the brief disconnect during lobby→game page navigation, but that navigation uses separate SpacetimeDB connections so the timeout is unnecessarily long.

## Design: Belt and Suspenders

### 1. Client-side cleanup (`/play/[code]/client.tsx`)

Add a `useEffect` in the inner game component that:
- On unmount, if the game is still in `waiting` status, calls `gameState.leaveGame()`
- Registers a `beforeunload` listener as backup for tab/browser close

The cleanup should only fire for waiting-status games. Playing/finished games have their own lifecycle.

### 2. Server: `leave_game` finishes waiting games immediately

Modify the `leave_game` reducer: when the leaving player is in a game with `status === 'waiting'`, set the game to `status = 'finished'` immediately. This makes lobby removal instant when the client successfully calls `leaveGame()`.

For non-waiting games, behavior is unchanged (just sets `isConnected = false`).

### 3. Server: Reduce waiting-game disconnect timeout to 5s

In `clientDisconnected`, change the waiting-game timeout from 15s to 5s. This is the fallback for crash/network-drop scenarios where the client can't call `leaveGame()`. 5 seconds is long enough to survive a page refresh (which triggers disconnect → reconnect → `clientConnected` cancels the timeout).

## Coverage Matrix

| Scenario | Mechanism | Lobby removal delay |
|----------|-----------|---------------------|
| Navigate away (Back button, link) | `leaveGame()` on unmount | Instant |
| Close tab / browser | `beforeunload` → `leaveGame()` | Instant (best-effort) |
| Browser crash / network drop | Server disconnect timeout | ~5s |
| Long-abandoned games | Hourly cleanup sweep | ≤1 hour |

## Files Changed

| File | Change |
|------|--------|
| `app/play/[code]/client.tsx` | Add cleanup `useEffect` + `beforeunload` handler |
| `spacetimedb/src/index.ts` | `leave_game`: finish waiting games immediately |
| `spacetimedb/src/index.ts` | `clientDisconnected`: reduce waiting timeout 15s → 5s |
