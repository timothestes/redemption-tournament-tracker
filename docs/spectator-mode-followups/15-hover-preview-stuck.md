# 15 — Hover preview stuck when card unmounts mid-hover

**Priority:** Medium
**Effort:** S
**Status:** TODO

## Problem

`handleMouseLeave` is the only path that clears `hoveredCard` / `hoveredInstanceId`. When a Konva shape unmounts (because the card moved zones server-side mid-hover), no `mouseleave` fires, so the floating preview keeps rendering with stale card data until the next pointer movement.

Affects both player and spectator views, but spectator hits it more often because they can't trigger zone changes themselves — the only way it happens is when the player moves a card while the spectator is hovering, which is exactly the spectator's normal viewing pattern.

## Why it matters

**Visual bug, not a leak.** A "ghost" card preview that shows incorrect info. Confusing but not exploitable. Investigator and Reviewer B: Med — spectator hits it more often.

## Code references

- [app/play/components/MultiplayerCanvas.tsx:3617-3625](../../app/play/components/MultiplayerCanvas.tsx#L3617-L3625) — `handleMouseLeave` (the only clear path)
- [app/play/components/MultiplayerCanvas.tsx:7354](../../app/play/components/MultiplayerCanvas.tsx#L7354) — preview render site

## Fix sketch

Add a `useEffect` that clears the hovered state when the hovered card no longer exists in the current card map:

```ts
useEffect(() => {
  if (hoveredInstanceId && !cardMap.has(hoveredInstanceId)) {
    setHoveredCard(null);
    setHoveredInstanceId(null);
  }
}, [hoveredInstanceId, cardMap]);
```

(Adjust to actual variable names / data shape.)

## Notes

- Konva-specific defensive code already exists at [MultiplayerCanvas.tsx:3591](../../app/play/components/MultiplayerCanvas.tsx#L3591) (100ms `dragEndTimeRef` fence) — same family of "Konva doesn't fire the events we'd expect during state churn."
- Worth a broader audit of "what state assumes a DOM/canvas event will clean it up?" — could be other instances.
