# 13 — Subscription accumulation across spectator→spectator navigation (suspected)

**Priority:** Medium
**Effort:** S (after runtime confirmation)
**Status:** TODO — needs runtime confirmation first

## Problem

Each mount of the spectator client calls `conn.subscriptionBuilder().subscribe([...code-specific SQL...])` without capturing or canceling the subscription handle. The same WebSocket connection survives SPA navigation (the spectator route uses bare `SpacetimeProvider`, not the reset wrapper), so navigating from one spectated game to another accumulates one game-by-code subscription per visit.

**Suspected, not confirmed.** Depends on SpacetimeDB SDK semantics — whether the SDK dedupes identical subscription queries on a single connection, or accumulates them.

## Why it matters

If the SDK accumulates, memory and inbound bandwidth grow linearly with spectator navigation count. On mobile (CLAUDE.md target use case), this kills the tab over a long session. If the SDK dedupes, this is moot.

Investigator: Med (suspected). Reviewer B: High if confirmed, defer until confirmed.

## Code references

- [app/play/spectate/[code]/client.tsx:99-110](../../app/play/spectate/[code]/client.tsx#L99-L110) — subscription site (no handle capture)

## Fix sketch

**Step 1 — confirm.** Either check SpacetimeDB docs/SDK source for dedup behavior, or run a quick experiment: spectate game A, navigate to game B, navigate to C. Inspect `conn.subscriptions` or equivalent. If counts grow, the leak is real.

**Step 2 — fix (if confirmed).** Capture the subscription handle and call `.unsubscribe()` (or whatever the SDK exposes) in the effect cleanup.

```ts
const sub = conn.subscriptionBuilder().subscribe([...]);
return () => sub.unsubscribe();
```

## Notes

- See SpacetimeDB SDK docs / context7 — there's been work on subscription handling worth re-reading before fixing.
- Related: [05](05-reconnect-didcallreducer.md) wrapping the spectator route in `SpacetimeConnectionResetWrapper` would force a remount on certain transitions; combined with handle cleanup, this becomes much more robust.
