# 08 — Lifecycle re-derivation clobbers `error` state

**Priority:** High
**Effort:** S
**Status:** TODO

## Problem

The "watching" effect in the spectator client unconditionally calls `setLifecycle('watching')` whenever a matching game row appears in `gameState.allGames`. There's no guard against the existing `lifecycle === 'error'` state.

**Repro:** Get banned from a game, click spectate. `joinAsSpectator` rejects → `lifecycle = 'error'` is set by the rejection handler. But the next `allGames` update (server still streams Game row updates for that code) calls `setLifecycle('watching')`, briefly showing the spectator UI on top of the error screen.

## Why it matters

**Inevitable for any rejection path** (ban, server-side validation failure, race). Breaks the error UX — user sees the canvas flashing in/out from under their "you can't watch this" message. Investigator and Reviewer A both rate this High.

## Code references

- [app/play/spectate/[code]/client.tsx:145-160](../../app/play/spectate/[code]/client.tsx#L145-L160) — the unguarded `setLifecycle('watching')` effect

## Fix sketch

Add a guard before the lifecycle transition:

```ts
if (lifecycle === 'error') return;
setLifecycle('watching');
```

Or better: refactor to an explicit state machine where `'watching'` is reachable only from `'joining'`, not from `'error'`.

## Notes

- Related to [README](README.md) architectural theme: lifecycle is one effect doing too many things. The `'error'` clobber is the most visible symptom; a state-machine refactor would prevent this and the kick-detection startup race (Low/Defer) and the unmount cleanup re-firing (folded into [05](05-reconnect-didcallreducer.md)).
- Quick fix is fine for now; flag it for inclusion in a lifecycle refactor when one happens.
