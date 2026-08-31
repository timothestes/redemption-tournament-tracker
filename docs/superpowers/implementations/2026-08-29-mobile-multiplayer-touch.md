# Mobile Multiplayer Touch — Implementation Notes

**Date:** 2026-08-29
**Spec:** [`../specs/2026-08-29-mobile-multiplayer-touch-design.md`](../specs/2026-08-29-mobile-multiplayer-touch-design.md)
**Plan:** [`../plans/2026-08-29-mobile-multiplayer-touch.md`](../plans/2026-08-29-mobile-multiplayer-touch.md)

What shipped, why it is shaped this way, and what is still missing.

---

## 1. The one piece of arithmetic that drives everything

```
physical card width = containerWidth × (1 − sidebarWidthRatio) × mainCardWidthRatio
```

`VIRTUAL_HEIGHT` **cancels out**. Changing the virtual height to make cards
bigger — the obvious first instinct — does nothing at all. The only levers are
reclaiming container width and the two ratios.

Measured effect of `TOUCH_PROFILE`, at full viewport height:

| Device | Default profile | Compact profile |
|---|---|---|
| iPhone 14 Pro landscape | 43×61 px | **60×84 px** |
| iPhone SE landscape | 34×48 px | 47×66 px |
| Pixel 8 landscape | 45×63 px | 61×86 px |
| iPad mini landscape | 61×85 px | 79×111 px |

Even at 60px a card is recognisable but **not readable** — no card name, no
strength/toughness. That is why the camera is structural rather than a
convenience: fit-zoom conveys the *shape* of the board, and the camera is how
you read it. Tablets need none of this; they are already at laptop parity.

## 2. Camera: one transform, not two

The Konva `<Layer>` takes `scaleX/scaleY/x/y`, and every HTML overlay positions
itself through `virtualToScreen(vx, vy, scale, offsetX, offsetY)`. Same three
numbers. So the camera folds **into** that triple via `applyCameraToScale`
rather than sitting beside it, and every consumer inherits it with no call-site
change.

The safety argument is algebraic, not empirical: at `zoom = 1` centred,

```
offsetX' = containerWidth/2 − (virtualWidth/2) × fitScale
         = (containerWidth − virtualWidth × fitScale) / 2
         = offsetX          // exactly calculateScale's value
```

`camera.test.ts` asserts this across 8 viewports including both letterboxed
regimes. On pointer devices `camera` is `null` and `applyCameraToScale` returns
the fit transform **by reference**, so desktop does not merely match — it takes
a different branch entirely.

**Side jumps fit on the height axis.** A side rect spans the full board width,
so contain-fitting one can never zoom in (width binds at fit) and every side
jump would have been a silent no-op. Caught by a unit test, not by inspection.

## 3. Tap-to-move, and why the rail exists

Drag is a poor primary mechanic on touch: cards are 45–60px, a fingertip covers
~44px, and once a camera can pan, the destination may be off-screen.

So: tap a card to arm it, tap a destination to commit. Two commit paths, on
purpose —

- **Tap a zone on canvas** → drops at the tap point, because position matters
  for equipping and battle placement.
- **Tap a rail chip** → auto-arranged slot, and works when the destination is
  off-screen. This is what makes cross-side movement **independent of the
  camera**, which is the whole point of the rail.

No server work was needed: `findZoneAtPosition` already returned
`owner: 'opponent'` and those drops were already legal.

**The tap path is not the drag path.** It mirrors the drag path's ownership
rules and its rotation-anchor correction (opponent zones render rot 180 and
anchor bottom-right), but it has no source anchor to preserve. Getting this
wrong put cards a full card-size away from the tap; there is a note in
`handleTapMoveCommit` explaining exactly which parts of the drag path it copies
and which it deliberately does not.

## 4. Presentation via attribute + CSS, not props

The eight context menus (1,856 lines) have eight different internal shapes, so a
`variant` prop meant eight bespoke edits. Instead each root carries
`data-context-menu`, `InputModeReflector` (root layout) reflects
`data-input-mode` onto `<html>`, and one scoped block in `globals.css` restyles
them into bottom sheets with ≥44px rows. Same trick for `data-game-toolbar`,
`data-phase-bar` and `data-card-scale-control`.

`!important` is required to beat the components' own inline styles, and that
override is the entire extent of the change — no action logic moved.

**Trade-off:** the reflector is global, so the CSS also lands on goldfish. Input
mode is a device fact, not a page fact, so this is correct — but it means an
out-of-scope surface gets touch presentation for free. Goldfish's `PhaseBar` is
deliberately **not** tagged: raising its buttons to 44px widened an already
crowded bar and clipped "End Turn".

## 5. Gesture arbitration — the parts that bite

- Konva fires **`tap`, not `click`**, for touch. Any `onClick` without a paired
  `onTap` is dead on touch. Likewise `e.evt.button === 0` is `false` for a
  `TouchEvent` (no `button`) — use `isPrimaryPointer`.
- Konva only names the **Stage** as `e.target` when a tap misses every
  *listening* shape. Most zone rects listen, so gating a stage handler on
  `e.target === stage` silently limits it to territory. Hit-test the point.
- A camera pan is **not** a Konva drag, so Konva still emits `tap`/`dbltap` when
  it ends. Without a movement threshold a pan commits a move, and two pans read
  as a double-tap.
- `Konva.dragDistance` is 3px but the long-press tolerance is 10px. In that band
  a drag has already started, so `stopDrag()` emits a real `dragend` — the
  canvas marks the drag cancelled *before* `stopDrag()` runs.
- Konva `preventDefault()`s touchstart on listening shapes, suppressing the
  synthesized `mousedown` that every menu used for outside-click dismissal.

## 6. Validation

Four layers, because single-signal UI validation fails — pixel diffs catch
movement but miss intent, and LLM critique alone trails human experts.

| Layer | What | Run |
|---|---|---|
| 1 | Deterministic rules (44px targets, 11px text, overflow) | `npx vitest run e2e/mobile/` |
| 2 | Screenshot matrix + manifest for critique agents | `npm run shots:mobile` |
| 3 | CDP touch gestures (`e2e/mobile/touchGestures.ts`) | via Playwright |
| 4 | Real-device checklist | [`../../mobile-device-qa-checklist.md`](../../mobile-device-qa-checklist.md) |

Pinch **is** automatable via CDP `Input.dispatchTouchEvent` with two touch
points (Chromium only). `Input.synthesizePinchGesture` exists but is
experimental and CI-flaky, so it is avoided. `window.__mpCamera` is exposed
outside production so camera behaviour can be tested independently of gesture
recognition.

**Always read the desktop-baseline shot as a control.** Most findings on the
board are pre-existing; the baseline is how you tell.

## 7. Known gaps

Honest list. None of these are hidden behind a passing test.

**The multiplayer board has never been visually validated.** The screenshot
harness reaches `/play` (lobby) and `/goldfish/[deckId]` only; a real
multiplayer board needs auth plus a live SpacetimeDB game. Goldfish shares
`GameCardNode`, the virtual-canvas transform and all the menus, so it is a
genuine regression surface — but it exercises **none** of the camera,
tap-to-move, rail, or `TOUCH_PROFILE` code. Wiring `e2e/seed.ts` into the
harness is the single highest-value next step.

Still missing on touch:

- **Hand and Land of Bondage zone menus.** Sidebar piles now have `onTap`, but
  the hand/LoB rects still only have `onClick`. No zone long-press exists;
  `onLongPress` is passed to `GameCardNode` only.
- **No armed-card affordance.** The spec promised a selection ring and
  highlighted destination zones; neither is implemented. The rail's card name
  is the only cue.
- **Hover preview positions at `NaN`** on touch — `onTouchStart` forwards a
  `TouchEvent` to a handler reading `clientX`. Preview lands in the corner.
- **`touchcancel` is not handled.** Konva fires `pointerup`, not
  `touchend`/`touchcancel`, so an iOS edge-swipe mid-press can leave the loupe
  stuck and fire a menu with no finger down.
- **Multi-select** (shift-click, marquee) has no touch equivalent; the planned
  select-mode toggle was not built, so `MultiCardContextMenu` is unreachable.
- **No edge auto-pan** while dragging a card.
- **Rail "Deck" chip** skips the put-top/put-bottom/shuffle popup, and any
  move out of reserve skips the turn-1 reserve confirmation.
- **Double-tap background** only zooms out; it is not the promised toggle.
