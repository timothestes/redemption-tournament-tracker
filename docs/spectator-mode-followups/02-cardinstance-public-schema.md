# 02 — `CardInstance` is public; every hand card's identity ships to spectators

**Priority:** Critical
**Effort:** L
**Status:** TODO
**Ship together with:** [01](01-image-preloader-leak.md), [03](03-pendingdeckdata-public.md) (one architectural fix covers all three)

## Problem

`CardInstance` is `public: true` with full card fields (`cardName`, `cardSet`, `cardImgFile`, `cardType`, `brigade`, `strength`, `toughness`, `alignment`, `identifier`, `specialAbility`, `reference`). The spectator subscribes to `CardInstance.where(c => c.gameId.eq(gameId))` and receives every hand card's full identity, regardless of `handRevealed` / `shareHandWithSpectators`.

The client draws a `CardBackShape` for face-down cards but the underlying data is already in the spectator's local table cache.

## Why it matters

**The face-down hand is a lie.** A DevTools snippet like:

```js
[...conn.db.cardInstance.iter()].filter(c => c.zone === 'hand')
```

reveals both hands in cleartext. For a competitive card game, this is the foundational integrity break — info asymmetry is the whole game. A Twitch viewer with DevTools can DM the seated player: "their hand is X, Y, Z." This is the tournament-cheating vector.

Reviewer B: "rate by exploit class first, severity second" — this is adversarial-trivial, full hand reveal, Critical.

## Code references

- [spacetimedb/src/schema.ts:91-153](../../spacetimedb/src/schema.ts#L91-L153) — `CardInstance` table definition
- [app/play/hooks/useGameState.ts:973-975](../../app/play/hooks/useGameState.ts#L973-L975) — spectator subscription
- [app/play/components/MultiplayerCanvas.tsx:577-632](../../app/play/components/MultiplayerCanvas.tsx#L577-L632) — defensive zeroing of `myHandBrigadeCounts` (a duct-tape attempt at preventing indirect leaks)
- [app/play/components/MultiplayerCanvas.tsx:215-243](../../app/play/components/MultiplayerCanvas.tsx#L215-L243) — `isHandCardFaceVisible` client-side gate

## Fix sketch

SpacetimeDB doesn't support per-subscriber column filtering, so this is a **schema split**, not a flag.

1. Split `CardInstance` into:
   - **Public skeleton:** `id`, `gameId`, `ownerPlayerId`, `zone`, `position`, `faceUp`, `revealedTo` (set of identities or `'all'`)
   - **Private body:** `cardInstanceId` → `cardName`, `cardImgFile`, `brigade`, etc. Only inserted/updated when the card is meant to be visible to a given subscriber.

2. Each reducer that changes zone or reveal state writes/clears the private body row accordingly.

3. Spectator subscribes to the skeleton always; subscribes to the body only via a filtered query (e.g., where the card is face-up to all, or where the spectator's identity is in `revealedTo`).

4. Client code that reads `cardName` etc. must handle absence gracefully (probably already does for face-down).

This is an L-effort migration — affects every reducer that mutates `CardInstance`, plus the client-side `useGameState` hook and likely `useSpectatorGameState`. Worth a small spec doc before starting.

## Related / cross-cutting

- The defensive zeroing at `MultiplayerCanvas.tsx:578-583` (with the comment "avoid leaking card-face data indirectly") signals the team noticed indirect leaks already. The schema split makes those defenses unnecessary.
- Same architectural pattern applies to [03](03-pendingdeckdata-public.md) — `pendingDeckData` is public on the Player table for the same reason.
- See also Low/Defer item: `handRevealSnapshot` propagating player→opponent reveals to spectators — separate consent question.
