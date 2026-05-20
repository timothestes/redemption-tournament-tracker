# 03 — `pendingDeckData` public on Player — full decklist leak pre-game

**Priority:** Critical
**Effort:** M
**Status:** TODO
**Ship together with:** [02](02-cardinstance-public-schema.md) (same architectural fix domain)

## Problem

`Player.pendingDeckData` is a `t.string()` column on the public Player table, holding the full deck JSON (including paragon). It's only cleared at game start. Spectators who join during `waiting` or `pregame` see both players' complete decklists.

## Why it matters

**Casual exploit (DevTools). Full decklist of both players before round start.** In competitive Redemption, decklist privacy until game start matters — knowing your opponent's full list, including paragon, before game 1 is a real cheating vector. Tournament players who spectate each other's lobbies pre-round would have an unearned advantage.

Reviewer B upgraded this from High to Critical based on casual-DevTools exploit class.

## Code references

- [spacetimedb/src/schema.ts:80](../../spacetimedb/src/schema.ts#L80) — `pendingDeckData: t.string()` column
- [spacetimedb/src/index.ts:700](../../spacetimedb/src/index.ts#L700) — cleared at game start (host)
- [spacetimedb/src/index.ts:811](../../spacetimedb/src/index.ts#L811) — cleared at game start (joiner)

## Fix sketch

Two viable shapes:

**Option A — move to non-public table** (preferred):
- New table `PendingDeck` with `(gameId, identity)` key, `public: false`
- Server-side reducers read/write this table during pregame
- A view or reducer-callable read exposes only the caller's own pending deck to themselves

**Option B — one-shot reducer payload:**
- Keep `pendingDeckData` off any table
- Have the seated player call a reducer that returns their pending deck synchronously
- Server holds it in transient state until game start

Option A is cleaner — pregame already involves multiple round-trips, so an extra table is low overhead.

## Notes

- Same root pattern as [02](02-cardinstance-public-schema.md): private data on a public table. If [02] adopts the schema-split approach with a separate private-body table, `pendingDeckData` should ride along on the same migration.
- Also surfaces `supabaseUserId` and `identity` on the public Player row — see Low/Defer.
