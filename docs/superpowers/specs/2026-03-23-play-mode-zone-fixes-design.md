# Play Mode Zone Rendering Fixes

**Date:** 2026-03-23
**Status:** Draft
**Scope:** 5 visual issues from impeccable critique of the multiplayer board

---

## Problem Statement

After the initial play mode redesign (layout rewrite, inline piles, left sidebar), visual testing revealed 5 issues:

1. **LOB cards brutally clipped** — zone clipping cuts off lost souls, making the most important scoring cards barely visible
2. **Hand cards cut off at bottom** — fan arc extends below hand zone, overlapping with phase bar
3. **Territory cards overflow into LOB** — free-form cards placed near zone edges bleed into adjacent zones
4. **Empty territory wastes space** — massive dark void with no guidance for players
5. **Phase bar overlaps hand** — TurnIndicator overlay competes with hand card interaction area

---

## Design

### 1. LOB as Auto-Arranged Horizontal Strip

Convert Land of Bondage from free-form placement to auto-arranged horizontal layout.

**Rendering:**
- Cards laid out left-to-right with fixed spacing (`cardWidth + 6px`)
- When total card width exceeds zone width, cards overlap with `minVisibleFraction: 0.4` (same overlap logic as hand cards)
- Cards vertically centered within LOB zone height
- No clipping on LOB zones — slight top/bottom overflow is acceptable for a strip

**Interaction:**
- LOB cards are `isDraggable={true}` — they can be dragged OUT of LOB to other zones
- When a drag ends and the drop target is the same LOB zone, snap the card back to its auto-position (treat as no-op move, do not call `moveCard` with position)
- When a drag ends on a different zone, call `moveCard` as normal
- Cards dragged INTO LOB from other zones: `moveCard` sets zone to `'land-of-bondage'`; the client renders them at auto-positions regardless of stored `posX`/`posY`
- `posX`/`posY` from SpacetimeDB are ignored for LOB rendering — auto-layout is client-side only

**Zone constant change:**
- `FREE_FORM_ZONES` changes from `['territory', 'land-of-bondage']` to `['territory']`
- A new constant `AUTO_ARRANGE_ZONES = ['land-of-bondage']` is added
- `isFreeFormZone()` helper (if it exists) returns false for LOB
- `findZoneAtPosition()`: LOB zones are still valid drop targets (cards can be dragged into/out of them) but position recording is skipped for auto-arrange zones
- Drag-end handler: when dropping on an auto-arrange zone, call `moveCard` with `posX='0', posY='0'` (positions are ignored by rendering)
- Marquee selection: LOB cards are NOT included in marquee selection (only territory cards are)

**Applies to:** Both player and opponent LOB zones.

### 2. Hand Zone Height Increase

**Zone height:** 12% → 14% of stage height.

The increased height plus the removal of the phase bar from the canvas (Section 3) gives hand cards significantly more room. The fan arc centering formula `handRect.y + Math.max(0, (handRect.height - cardHeight) / 2)` is already correct — the real fix is the additional vertical pixels from the height increase and phase bar removal. No formula change needed.

### 3. Phase Bar as HTML Below Canvas

Move TurnIndicator from a Konva canvas overlay to an HTML element below the canvas.

**Layout change:**

```
┌──────────┬──────────────────────────────────────┐
│          │  KONVA CANVAS (game board)           │
│ LEFT     │  - No phase bar zone in layout       │
│ SIDEBAR  │  - Canvas gets the recovered height  │
│          ├──────────────────────────────────────┤
│          │  TURN INDICATOR (HTML, 56px fixed)   │
│          │  Phase buttons + D20/Draw/End Turn   │
└──────────┴──────────────────────────────────────┘
```

**Changes:**
- Remove `phaseBarHeight` and `phaseBarRect` from `calculateMirrorLayout()` and `MirrorLayout` interface — canvas no longer reserves space for it
- The recovered ~7% height goes to play area (bigger territories)
- The right-side container in `client.tsx` changes from `position: relative` with an absolute canvas child to a `display: flex; flexDirection: column` layout:
  - Canvas wrapper: `flex: 1; position: relative; overflow: hidden` (Konva Stage inside)
  - TurnIndicator: `flexShrink: 0; height: 56px` (HTML below canvas)
- TurnIndicator component: remove `position: fixed; bottom: 0; left: 0; right: 0` styling, become normal-flow element
- Concede button: rendered as a right-aligned element inside the TurnIndicator component (passed as a prop or slot), not as a separate absolute-positioned element in `client.tsx`

### 4. Empty Zone Ghost Text

Empty territory zones display centered guidance text:

- Text: "Drop characters and enhancements here"
- Color: `rgba(232, 213, 163, 0.15)` — barely visible
- Rendered as Konva `Text`, centered horizontally and vertically in the zone
- Only shown when zone card count is 0
- Disappears when first card is placed

Applies to both player and opponent territory zones.

### 5. Territory Keeps Clipping

Territory zones retain `clipX/clipY/clipWidth/clipHeight` to prevent free-form cards from overflowing into LOB or hand zones. LOB zones have clipping removed (auto-arranged strips don't need it).

### 6. Count Badge Positioning

Keep existing label-relative positioning approach (badge placed after label text width + 8px gap). This avoids overlap regardless of label length. No change needed — just verify the current code doesn't produce overlaps after the LOB rendering changes.

---

## Files Affected

| File | Change |
|---|---|
| `app/play/layout/mirrorLayout.ts` | Remove phaseBarHeight/phaseBarRect; hand 12%→14%; recalculate play area |
| `app/play/components/MultiplayerCanvas.tsx` | LOB auto-arrange rendering; remove LOB clipping; keep territory clipping; ghost text for empty zones; fix count badge positioning; remove phase bar zone rendering |
| `app/play/components/TurnIndicator.tsx` | Restyle from fixed overlay to normal-flow HTML element (remove position: fixed) |
| `app/play/[code]/client.tsx` | Add TurnIndicator as HTML below canvas; move Concede button into phase bar area |
| `app/play/test/page.tsx` | Update mock rendering to match new LOB strip layout and removed phase bar |

---

## Out of Scope

- LOB card reordering (drag to rearrange within LOB)
- Dynamic zone sizing based on card count
- Responsive breakpoint behavior (Phase 2)
