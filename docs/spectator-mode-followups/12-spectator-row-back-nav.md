# 12 — Spectator row leaked on back-nav during join window

**Priority:** Medium
**Effort:** S
**Status:** TODO

## Problem

The unmount cleanup in the spectator client is gated on `gameId !== null`. But `gameId` is only set inside the resolver effect that runs **after** `joinAsSpectator` has already fired. If the user navigates away in that window (slow network, accidental back button), `leaveAsSpectator` never runs and the Spectator row lingers until the `clientDisconnected` safety net fires — which could be never on a still-active connection from another tab.

## Why it matters

**Casual scenario, eventually self-heals** but leaves stale spectator rows visible in the lobby and counted in spectator counts. Investigator: Med. Reviewer B kept it at Med.

## Code references

- [app/play/spectate/[code]/client.tsx:120](../../app/play/spectate/[code]/client.tsx#L120) — `joinAsSpectator` call site (fires before gameId is set)
- [app/play/spectate/[code]/client.tsx:130-136](../../app/play/spectate/[code]/client.tsx#L130-L136) — unmount cleanup gated on `gameId !== null`
- [app/play/spectate/[code]/client.tsx:138-160](../../app/play/spectate/[code]/client.tsx#L138-L160) — the resolver effect that finally sets gameId

## Fix sketch

Track an in-flight join with a ref:

```ts
const joinInFlightRef = useRef(false);
// when joinAsSpectator fires:
joinInFlightRef.current = true;
// cleanup:
return () => {
  if (gameId !== null || joinInFlightRef.current) {
    void conn.reducers.leaveAsSpectator({ /* by code if no gameId yet */ });
  }
};
```

The leave reducer may need to accept either `gameId` or `gameCode` to handle the pre-resolve case.

## Notes

- Folded conceptually with [05](05-reconnect-didcallreducer.md) and [13](13-subscription-accumulation.md) — all are facets of the same overloaded lifecycle effects.
- A state-machine refactor (see [README](README.md) architectural notes) would prevent this whole class of bug.
