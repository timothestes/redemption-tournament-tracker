# 14 — Banner + `PauseConsentToast` z-index collision; stacked banners overflow mobile

**Priority:** Medium (High on mobile)
**Effort:** S–M
**Status:** TODO

## Problem

`SpectatorHandRequestBanner` and `PauseConsentToast` both use the same CSS:

```css
position: absolute;
top: 50%;
left: 50%;
transform: translate(-50%, -50%);
z-index: 800;
```

When both are visible (opponent requests pause while a hand-reveal banner is already up), they render on top of each other — touch-dismiss targets the wrong one, content occludes content.

Multiple stacked `SpectatorHandRequestBanner`s also overflow mobile viewports — the column is centered with no max-height or scroll, so two or three concurrent requests push past the screen edges.

## Why it matters

**Mobile amplification.** On a 390px-wide phone (CLAUDE.md target use case), the stack can occlude the canvas entirely and lock interaction. Reviewer B: Med on desktop, High on mobile.

## Code references

- [app/play/components/SpectatorHandRequestBanner.tsx:67-94](../../app/play/components/SpectatorHandRequestBanner.tsx#L67-L94) — positioning
- [app/play/components/PauseConsentToast.tsx:47-64](../../app/play/components/PauseConsentToast.tsx#L47-L64) — same positioning convention

## Fix sketch

Two parts:

**1. Stacking container for banners:**
- Wrap all banner-type overlays in a single `<BannerStack>` container fixed to the top center
- `max-height: 60vh; overflow-y: auto; gap: 0.5rem`
- Banners append vertically; the container scrolls if too many

**2. Coalesce multiple hand-reveal requests:**
- Instead of N stacked banners, render one: "Bob, Carol, Dave want to see your hand"
- Tap to expand to per-spectator accept/deny

**3. z-index strategy:**
- `PauseConsentToast` is more important (blocks the game); should win z-index when both visible
- Establish a small z-index scale (banners=800, toasts=900, modals=1000) and use it consistently

## Notes

- The `BannerStack` container is also a natural place to apply `useSpectatorGate()` ([04](04-pile-browse-spectator-gate.md)) — spectators don't see `PauseConsentToast` but do see banners; centralizing makes that distinction explicit.
- Related Low/Defer: `prevSharingRef` in the banner mass-dismisses if mounted with sharing already true.
