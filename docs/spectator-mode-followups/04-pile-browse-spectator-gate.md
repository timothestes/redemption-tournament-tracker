# 04 — One-click pile browse via left- and right-click bypasses spectator gates

**Priority:** Critical
**Effort:** M
**Status:** TODO
**Ship together as one patch:** all handler/setter/modal gates listed below

## Problem

Multiple pile-click handlers and `onContextMenu` paths on `MultiplayerCanvas.tsx` fire state setters (`setBrowseMyZone`, `setBrowseOpponentZone`, `setOpponentHandMenu`, `setDeckMenu`, `setLorMenu`, `setReserveMenu`) **with no `isSpectator` guard.** Commit `9fb4abc` ("tyr to fix it") added render-site `!isSpectator &&` gates around context menus, but:

- **`<ZoneBrowseModal>` mounts at lines 6862 and 6879 are unconditional** — they render whenever the state setter has fired
- **Left-click handlers** at 4266-4269, 4341-4345, 5307-5310, 5529-5532 lack guards entirely
- **Opponent-hand `onContextMenu`** at 5705-5712 (Reviewer A discovery) fires `setOpponentHandMenu` directly with no spectator check

Net result: a spectator left-clicks the reserve pile and sees private cards in the `ZoneBrowseModal`. No DevTools needed.

## Why it matters

**Casual exploit. One click. No DevTools.** Reserve is supposed to be private. The 9fb4abc commit shows the team already knew about the symptom (context menus appearing) but the fix was render-only — it didn't address the underlying handler/setter leak. Reviewer B: "the team already knows this is a problem and didn't fully fix it" → Critical.

## Code references

Click / context handlers (need `isSpectator` no-op guards):
- [MultiplayerCanvas.tsx:4266-4269](../../app/play/components/MultiplayerCanvas.tsx#L4266-L4269) — `myPileClickHandler`
- [MultiplayerCanvas.tsx:4341-4345](../../app/play/components/MultiplayerCanvas.tsx#L4341-L4345) — `oppPileClickHandler`
- [MultiplayerCanvas.tsx:5307-5310](../../app/play/components/MultiplayerCanvas.tsx#L5307-L5310) — inline `onClick`
- [MultiplayerCanvas.tsx:5312-5320](../../app/play/components/MultiplayerCanvas.tsx#L5312-L5320) — `onContextMenu` setting browse/menu state
- [MultiplayerCanvas.tsx:5529-5532](../../app/play/components/MultiplayerCanvas.tsx#L5529-L5532) — opponent-side inline `onClick`
- [MultiplayerCanvas.tsx:5705-5712](../../app/play/components/MultiplayerCanvas.tsx#L5705-L5712) — opponent-hand container `onContextMenu` (missed by 9fb4abc)

Modal mounts (defense-in-depth):
- [MultiplayerCanvas.tsx:6862](../../app/play/components/MultiplayerCanvas.tsx#L6862) — `<ZoneBrowseModal>` for opponent
- [MultiplayerCanvas.tsx:6879](../../app/play/components/MultiplayerCanvas.tsx#L6879) — `<ZoneBrowseModal>` for self

## Fix sketch

**Centralize the gate.** Don't keep adding `if (isSpectator) return;` to individual handlers — that's exactly what failed in 9fb4abc.

Recommended: a `useSpectatorGate()` hook that wraps each setter:

```ts
const { setBrowseMyZone, setBrowseOpponentZone, setOpponentHandMenu, /* ... */ } = useSpectatorGate(viewerKind, rawSetters);
// each wrapped setter becomes a no-op when viewerKind === 'spectator'
```

Plus gate the two `<ZoneBrowseModal>` render sites on `!isSpectator` as belt-and-suspenders.

Bonus: the hook can be unit-tested with a snapshot of "which setters are blocked for spectators" — and if someone adds a new modal-trigger setter, they must register it with the hook explicitly.

## Notes

- Reviewer A: "render-only gate, no setter gate" — captures the structural issue.
- Pattern recurs in [16](16-unhandled-promise-rejection.md) and the Low/Defer unread-badge bug — same family of "UI looks gated, state isn't."
- The 9fb4abc commit message ("tyr to fix it") is a tell that this needs a real fix, not another patch.
