# 17 — Anonymous-spectator access on `/play/spectate/[code]`

**Priority:** Medium
**Effort:** S (the gate); product decision required first
**Status:** TODO — needs product decision

## Problem

`/play/spectate/[code]/page.tsx` has no auth check. Anonymous users get `displayName = 'Spectator'` and proceed. The only gating is `Game.isPublic` in `join_as_spectator`.

If a spectator URL is shared (intentionally in a tournament Discord, accidentally in a screenshot, scraped from a public link), anyone with the URL can spectate any non-private game without an account.

## Why it matters

**Product decision, not strictly a bug.** Two paths:

- If anonymous spectating is intentional → fine, but the Critical leaks ([01](01-image-preloader-leak.md), [02](02-cardinstance-public-schema.md), [03](03-pendingdeckdata-public.md)) become many-eyes problems the moment a link is shared.
- If anonymous spectating is not intentional → quick auth gate fixes this.

Compounds with [07](07-share-hand-global-toggle.md): if anonymous spectating is allowed, accepting one friend's hand-reveal request also reveals to any anonymous spectator who joins later.

## Code references

- [app/play/spectate/[code]/page.tsx](../../app/play/spectate/[code]/page.tsx) — no auth check
- [spacetimedb/src/index.ts](../../spacetimedb/src/index.ts) — `join_as_spectator` gates only on `Game.isPublic`

## Fix sketch

Depends on the product decision:

**If auth-required:**
- Standard Supabase auth check in the page server component
- Redirect to login with `?next=/play/spectate/[code]` if no session
- Server-side gate in `join_as_spectator` reducer: require a non-anonymous identity (check that `ctx.sender` maps to a known supabase user)

**If anonymous-allowed but tracked:**
- Generate a stable anonymous identity per browser (localStorage-backed)
- Show clearly in the player UI that "this spectator is anonymous"
- Maybe rate-limit anonymous joins per game

**If full anonymous-public (current behavior):**
- Mark it as intentional in CLAUDE.md
- Prioritize the Critical privacy fixes ([01]–[03]) since they're now the only barrier between a shared URL and a hand reveal

## Notes

- Worth discussing with the product owner before any code changes.
- Default `displayName = 'Spectator'` is the existing friction point — at minimum, every anonymous spectator gets the same name, so the players can't distinguish them in the spectator list.
