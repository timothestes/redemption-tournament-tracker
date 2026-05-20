# 16 — Unhandled `requestSpectatorHandReveal` promise rejection

**Priority:** Medium
**Effort:** S
**Status:** TODO

## Problem

`conn.reducers.requestSpectatorHandReveal({ gameId })` is called without a `.catch()` handler. If the spectator was just kicked but the UI hasn't reflected it yet (or the row never propagated), the server throws `'Not a spectator in this game'` and the rejection tears through Next.js's error overlay in dev.

The codebase already has a defensive comment at [app/play/spectate/[code]/client.tsx:117-127](../../app/play/spectate/[code]/client.tsx#L117-L127) explaining this exact pattern for `joinAsSpectator`:
> joinAsSpectator returns a Promise that rejects asynchronously on server-side SenderError. A synchronous try/catch won't catch those rejections — attach .catch() instead.

The pattern wasn't applied to `requestSpectatorHandReveal`.

## Why it matters

**Dev-mode noise.** In production, it's a silent console error. Not a leak or integrity issue. Investigator/Reviewer B: Med.

But it's a signal — the same pattern likely affects other reducer call sites in spectator code. Worth a quick grep.

## Code references

- [app/play/spectate/[code]/client.tsx:445-449](../../app/play/spectate/[code]/client.tsx#L445-L449) — unhandled call site
- [spacetimedb/src/index.ts:6194](../../spacetimedb/src/index.ts#L6194) — `SenderError` throw point
- [app/play/spectate/[code]/client.tsx:117-127](../../app/play/spectate/[code]/client.tsx#L117-L127) — the comment + correct `.catch()` pattern on `joinAsSpectator`

## Fix sketch

Add `.catch()` with a user-facing toast:

```ts
void conn.reducers.requestSpectatorHandReveal({ gameId }).catch((err) => {
  toast.error('Couldn\'t send request — you may no longer be a spectator.');
  console.error(err);
});
```

While in the file, grep for other unhandled `conn.reducers.*` calls in spectator code:

```bash
grep -n "conn.reducers\." app/play/spectate/[code]/client.tsx
```

…and apply the same pattern where needed.

## Notes

- Same family as [04](04-pile-browse-spectator-gate.md): individual call sites each owning their own defensive pattern → drift. A centralized `useSafeReducerCall(reducer, args)` hook could eliminate this whole class of bug.
