# 01 — Hand-card image preloader fetches both hands to spectators

**Priority:** Critical
**Effort:** S
**Status:** TODO
**Ship together with:** [02](02-cardinstance-public-schema.md), [03](03-pendingdeckdata-public.md) (same root cause: client-side privacy on public data)

## Problem

`buildPrioritizedImageUrls` is called by the spectator client with both players' `myCards['hand']` and `opponentCards['hand']`, so the browser fetches `/cards/<actual-card>.png` for every hand card — regardless of whether the spectator is supposed to see those cards.

## Why it matters

**Casual exploit, zero DevTools required.** Opening the Network tab on a spectator's browser reveals every hand card's image URL by filename. For streamers, the Network panel may be casually visible in screen captures. For a Twitch viewer or tournament Discord lurker, the URL bar pattern is enough. This is the most dangerous single finding in the audit — it's the cheapest path to a hand reveal.

Reviewer B flagged this as Critical with exploit class **casual** (vs. the `CardInstance` leak in [02](02-cardinstance-public-schema.md) which needs DevTools).

## Code references

- [app/play/lib/multiplayerImageUrls.ts:43,51](../../app/play/lib/multiplayerImageUrls.ts#L43-L51) — `pushZone(out, seen, myCards['hand'])` and same for opponent hand
- [app/play/spectate/[code]/client.tsx:196-204](../../app/play/spectate/[code]/client.tsx#L196-L204) — spectator client call site

## Fix sketch

In the spectator client's call to `buildPrioritizedImageUrls`:

- Filter hand zones out of the preload list unless `ownerPlayer.shareHandWithSpectators === true`, AND
- Even when sharing is on, ideally only preload cards present in `handRevealSnapshot` (don't speculatively prefetch all hand cards)

Better long-term: drop spectator preloading of hand zones entirely — the server-side filtering work in [02](02-cardinstance-public-schema.md) will leave the spectator without `cardImgFile` for face-down cards anyway, so there's no URL to preload.

## Notes

- Reviewer A confirmed the finding factually at the cited lines.
- The fix here is band-aid until the schema split in [02](02-cardinstance-public-schema.md) lands. Doing this first is still worth it — the schema split is L-effort, this is S-effort, and the leak is severe.
