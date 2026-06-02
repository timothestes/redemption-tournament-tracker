# 05 — `didCallReducer` ref blocks re-join after silent SDK reconnect (mobile ghost state)

**Priority:** Critical
**Effort:** M
**Status:** TODO

## Problem

The spectator route is wrapped in bare `SpacetimeProvider` — not `SpacetimeConnectionResetWrapper` or `ReconnectOnResume` like the player route is. When the SpacetimeDB SDK reconnects under the hood:

1. Server-side `clientDisconnected` already deleted the Spectator row (no grace period, unlike Player which has `DisconnectTimeout`)
2. Client-side `didCallReducer.current` is stuck at `true` from the original mount
3. Client never re-calls `joinAsSpectator`

Result: client thinks it's spectating; server has no row. Compounds with [06](06-multi-tab-clobber.md) (multi-tab clobber → false kick) and the `SpectatorHandRequest` orphan ([11](11-spectatorhandrequest-cleanup.md), banner lingers for 30s with a ghost name).

## Why it matters

**Inevitable in the target use case.** CLAUDE.md explicitly calls out "mobile usage is high — players at tables checking standings on their phones." Tournament venues have notoriously bad Wi-Fi. Spectator on a phone backgrounded for 30s → silent desync → forced refresh as the only recovery. Reviewer B upgraded High→Critical for this reason.

## Code references

- [app/play/spectate/[code]/client.tsx:61](../../app/play/spectate/[code]/client.tsx#L61) — bare `SpacetimeProvider` wrapper (vs player route)
- [app/play/spectate/[code]/client.tsx:91](../../app/play/spectate/[code]/client.tsx#L91) — `didCallReducer` ref declared, set once, never reset
- [app/play/spectate/[code]/client.tsx:113-127](../../app/play/spectate/[code]/client.tsx#L113-L127) — `joinAsSpectator` call site, gated by ref
- [spacetimedb/src/index.ts:6286-6298](../../spacetimedb/src/index.ts#L6286-L6298) — `clientDisconnected` deletes spectator rows unconditionally
- [app/play/[code]/client.tsx:7-8](../../app/play/[code]/client.tsx#L7-L8) — player route's `SpacetimeConnectionResetWrapper` import (reference pattern)

## Fix sketch

Two complementary changes:

**Client side:**
- Wrap the spectator route in `SpacetimeConnectionResetWrapper` + `ReconnectOnResume`, matching the player route. This forces a component remount on reconnect, which resets the `didCallReducer` ref naturally.
- Alternatively (lighter touch): reset `didCallReducer.current = false` on SDK `onConnect` and re-call `joinAsSpectator`. Riskier — depends on SDK lifecycle correctness.

**Server side:**
- Add a spectator reconnect grace period mirroring the Player.isConnected pattern. On `clientDisconnected`, set a `spectator.isConnected = false` flag + start a short timeout; only delete the row if the timeout expires without reconnect.

Server-side change is the more robust fix. Client-side wrapper alone protects against many cases but a slow reconnect still drops the row.

## Notes

- Investigator open question: "Does the SpacetimeDB SDK fire `clientConnected` on transient reconnects, or only on initial connect?" — answer determines whether re-calling `joinAsSpectator` from a SDK `onConnect` hook is viable.
- The spectator route's lifecycle has multiple useRef fences (`didCallReducer`, `didSubscribe`, `wasWatching`) that paper over re-entry. A real fix would refactor lifecycle to a state machine where reconnect is a real transition — see architectural note in [README](README.md).
- See [12](12-spectator-row-back-nav.md) for the related back-nav row-leak (same lifecycle effect doing too much).
