# 06 — Same-identity multi-tab clobber deletes all rows on any single tab close

**Priority:** High
**Effort:** M
**Status:** TODO

## Problem

`clientDisconnected` in `spacetimedb/src/index.ts` iterates and deletes every row whose identity matches `ctx.sender`, with no per-connection refcounting. This affects both the Spectator and Player branches.

If a user has two tabs open on the same identity:
- Streamer with OBS browser source + monitor tab spectating the same game
- Player browsing the lobby in tab A while spectating a different game in tab B

Closing any one tab triggers `clientDisconnected`, which deletes **every** row for that identity. The remaining tab's client thinks it's still connected, but the server has removed its row → kick-detection logic fires "You were removed from this game."

## Why it matters

**Casual scenario, visible false-kick UX.** Streamers commonly use multi-tab setups. Triggers a confusing user-facing error message ("you were removed") with no actual removal. Reviewer A noted the Player branch (at [spacetimedb/src/index.ts:6249-6280](../../spacetimedb/src/index.ts#L6249-L6280)) has the same shape and was not separately severity-flagged by investigators — fix should cover both.

## Code references

- [spacetimedb/src/index.ts:6286-6298](../../spacetimedb/src/index.ts#L6286-L6298) — Spectator branch, identity-keyed delete loop
- [spacetimedb/src/index.ts:6249-6280](../../spacetimedb/src/index.ts#L6249-L6280) — Player branch, same shape (sets `isConnected=false` for all matching rows, starts a single DisconnectTimeout)
- [app/play/spectate/[code]/client.tsx:163-176](../../app/play/spectate/[code]/client.tsx#L163-L176) — client-side kick detection that fires on missing row

## Fix sketch

Option A — **per-connection refcount keyed on `(identity, connectionId)`:**
- SpacetimeDB provides `ctx.connectionId` (or equivalent) in reducers
- Store `connectionId` as a column on Spectator/Player rows
- On `clientDisconnected`, delete only the row matching `(identity, connectionId)` of the disconnecting connection

Option B — **last-tab-wins via heartbeat:**
- Keep current shape but require a periodic heartbeat reducer; rows without recent heartbeats are reaped
- More complex; only worth it if the SDK doesn't expose stable `connectionId`

Option A is cleaner. Check the SpacetimeDB API surface — `ctx.getConnection()` already exists per commit `807daa0`, may expose the right ID.

## Notes

- Compounds with [05](05-reconnect-didcallreducer.md): close one tab → both deleted → remaining tab can't re-register because `didCallReducer.current === true`. Fix both together for a clean recovery story.
- Open product question: is same-identity multi-tab supposed to be supported, or warned/blocked at the client? Answer determines whether this fix or a "you have another tab open" detection is the right move.
