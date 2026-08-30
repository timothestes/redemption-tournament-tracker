# Mobile Support for Online Multiplayer (`/play`)

**Date:** 2026-08-29
**Status:** Approved — implementation pending
**Scope:** Tablet + phone-landscape support for the multiplayer game board, comprising a touch interaction layer, a board camera, and a touch layout profile.

---

## 1. Problem

`/play` is desktop-only by design. Mobile was explicitly deferred twice — see
[`2026-03-29-virtual-canvas-scaling-design.md`](2026-03-29-virtual-canvas-scaling-design.md)
("Desktop + ultrawide support — mobile deferred", Out of Scope: "Mobile layout")
and [`2026-03-23-play-mode-redesign-design.md`](2026-03-23-play-mode-redesign-design.md)
(Out of Scope: "Mobile display support"). This is a known, scoped gap, not rot.

Two independent things block mobile play.

### 1.1 Vertical resolution

`calculateScale()` clamps the container aspect ratio into a supported band and then
takes `min(containerWidth / virtualWidth, containerHeight / VIRTUAL_HEIGHT)`. Inside
the band those two terms are equal, so the effective scale reduces to:

```
scale = containerHeight / 1080
```

A phone in landscape has roughly 350–390 CSS px of height, pinning scale near 0.32.
Measured card sizes at real device viewports (48px turn bar, `RightPanel` at its
280px floor when open / 36px collapsed):

| Device | Panel open | Panel collapsed |
|---|---|---|
| iPhone 14 Pro **portrait** | 6×8 px | 19×27 px |
| iPhone 14 Pro landscape | 29×41 px | 42×58 px |
| iPhone SE landscape | 21×29 px | 32×45 px |
| iPad mini landscape | 40×56 px | 53×74 px |
| iPad Pro 11 landscape | 49×68 px | 62×87 px |
| Laptop 1440×900 | 62×86 px | 72×100 px |
| Desktop 1920×1080 | 84×118 px | 96×135 px |

Portrait is structurally broken rather than merely cramped: `RightPanel` is a **flex
sibling** of the canvas at `clamp(280px, 20vw, 380px)`, so on a 393px-wide viewport it
consumes 71% of the width and strangles the board to 113px.

Tablet landscape, by contrast, is already at laptop parity (53–62px cards) and would be
playable today if touch input worked.

### 1.2 No touch interaction model

`app/play/` contains zero touch-specific handling. What exists instead:

- ~24 `onContextMenu` sites and 8 context-menu components (1,856 lines) — right-click
  **is** the interaction model, and touch has no right-click.
- 33 `onMouseEnter` handlers driving the hover loupe. At 29px, preview stops being a
  convenience and becomes mandatory — but hover does not exist on touch.
- 20 Konva `draggable` nodes with no tap/drag disambiguation.
- No `touch-action: none` on the stage container ([`MultiplayerCanvas.tsx:6279`](../../../app/play/components/MultiplayerCanvas.tsx)),
  so browser gestures fight the board.
- `GameToolbar` buttons at `minWidth: 50` with `fontSize: 8` labels — far under the
  44px touch-target guideline, and unreadable.

### 1.3 The card-size formula

Substituting the definitions in `multiplayerLayout.ts` into the scale above:

```
physical card width
  = VIRTUAL_HEIGHT × AR × (1 − sidebarWidthRatio) × mainCardWidthRatio × containerHeight/VIRTUAL_HEIGHT
  = containerWidth × (1 − sidebarWidthRatio) × mainCardWidthRatio
```

**`VIRTUAL_HEIGHT` cancels.** Lowering the virtual height to enlarge cards — an obvious
first instinct — has no effect whatsoever. The only levers are reclaiming container
width and adjusting two ratios.

This caps what a layout profile alone can achieve. On an iPhone 14 Pro landscape the
realistic ceiling is ~57px cards, and the territory band has vertical room for a single
card row. **A readable full Redemption board does not fit on a phone.** Fit-zoom can
convey the *shape* of the board; a camera is required to read and manipulate it.

The camera is therefore structural, not a convenience.

---

## 2. Existing architecture that makes this tractable

Three properties of the current code do most of the work.

**A single centralized hit-tester.** `findZoneAtPosition(x, y)`
([`MultiplayerCanvas.tsx:2782`](../../../app/play/components/MultiplayerCanvas.tsx))
returns `{ zone: DropZoneKey; owner: 'my' | 'opponent' | 'shared' }` in virtual
coordinates. Card drag, modal drag, opponent drag and the soul-deck pile all route
through it. Tap-to-move reuses it unchanged, fed a tap point instead of a drag-end point.

**Cross-side movement already works.** Drops with `owner: 'opponent'` are already legal
(sandbox mode permits opponent territory, LoB, sidebar piles and hand). Moving a card to
the opponent's side is not a new mechanic and needs no server work — it is purely a
*reachability* problem once a camera can put the destination off-screen.

**One transform, universally respected.** The Konva `<Layer>` takes
`scaleX={scale} scaleY={scale} x={offsetX} y={offsetY}`, and every HTML overlay
positions itself via `virtualToScreen(vx, vy, scale, offsetX, offsetY)` — battle UI,
previews, seams, `useModalCardDrag`. Same three numbers, single source of truth.

Consequently, folding the camera **into** `scale/offsetX/offsetY` gives every consumer
the camera for free with no call-site changes.

**`GameCardNode` is the single card-input choke point** and already mirrors
`onClick`→`onTap`, `onDblClick`→`onDblTap`, `onMouseEnter`→`onTouchStart`.

**`components/ui/mobile-drawer.tsx` already exists** as a portal-based bottom sheet.

---

## 3. Design

### 3.1 Input mode detection

New `app/shared/hooks/useInputMode.ts` returning `'pointer' | 'touch'`, derived from
`matchMedia('(pointer: coarse)')` with a reactive listener.

Media-query detection rather than UA sniffing, so hybrid devices (iPad with trackpad,
Surface) resolve correctly and can change mode mid-session.

Overridable via `?input=touch` / `?input=pointer`. The override is a hard requirement,
not a debug nicety: it is what lets the validation harness force touch mode inside a
desktop Chromium.

### 3.2 Board camera

New `app/shared/layout/camera.ts`. Camera state is `{ zoom, centerX, centerY }`
expressed in **virtual** coordinates. Composition:

```
scale'   = fitScale × zoom
offsetX' = viewportCenterX − centerX × scale'
offsetY' = viewportCenterY − centerY × scale'
```

**Identity property.** At `zoom = 1` and `center = (virtualWidth/2, VIRTUAL_HEIGHT/2)`:

```
offsetX' = containerWidth/2 − (virtualWidth/2) × fitScale
         = (containerWidth − virtualWidth × fitScale) / 2
         = offsetX          // exactly today's value
```

The composed transform reduces algebraically to the current one. Desktop regression risk
is zero **by construction**, and this is asserted as a property test rather than assumed.

Constraints:
- `zoom` clamped to `[1, 3]` — never zoom out past fit.
- `center` clamped so the board cannot drift out of the viewport.
- Zoom anchors on the pinch midpoint (or double-tap point), not the viewport center.

Layout rects stay in virtual coordinates and are camera-independent, which is correct —
only screen↔virtual conversion changes.

`useVirtualCanvas` gains an optional camera argument and returns the composed transform.
Omitting it yields today's behaviour byte-for-byte, so `goldfish` and
`WaitingRoomGoldfish` are unaffected.

### 3.3 Jump targets

Computed as union rects over `mpLayout.zones`, then fitted to the viewport. Per explicit
design decision these are **sides**, not territories — territory alone does not capture
what a player controls:

| Target | Union of |
|---|---|
| **My side** | my hand ∪ my territory ∪ my LoB ∪ my sidebar piles |
| **Opponent's side** | opp hand ∪ opp territory ∪ opp LoB ∪ opp sidebar piles |
| **Fit** | whole board |
| **Battle** | the Field of Battle band (only while `battleActive`) |

Transitions are animated so the player does not lose spatial orientation.

**Side jumps fit on the height axis, not both.** A side rect spans the full
board width, so contain-fitting one can never zoom in — width is always the
binding constraint at fit, which would make every side jump a silent no-op.
`fitRectToViewport(..., { axis: 'height' })` instead fills the viewport
vertically and lets the player pan horizontally along the side. Measured on an
iPhone 14 Pro landscape this yields roughly 2x zoom, taking cards from ~57px to
~112px. Only the whole-board **Fit** target uses `axis: 'both'`.

(Caught by the camera unit tests during implementation, not by inspection.)

### 3.4 Tap-to-move

State machine in `app/play/hooks/useTapToMove.ts`:

```
idle ──tap card──▶ armed(card) ──tap destination──▶ commit ──▶ idle
                        │
                        └──tap same card / empty space──▶ idle
```

While armed: the card carries a selection ring, legal destination zones highlight, and
the destination rail (§3.5) appears. Long-press while armed opens the context menu
instead of moving — arming never blocks the menu.

Two distinct commit paths, deliberately:

- **Tap a zone on canvas** → drop at the tap point. Position matters for equipping and
  battle placement, so canvas taps preserve free-form placement.
- **Tap a rail chip** → drop into an auto-arranged slot.

### 3.5 The destination rail — cross-side movement

The reachability problem a camera introduces: when your card is armed and the opponent's
Land of Redemption is off-screen, drag-to-drop cannot reach it, and edge auto-pan while
holding a card is fiddly on a small screen.

Solution: `app/play/components/DestinationRail.tsx`, a chip bar that appears on arm and
lists **every legal destination regardless of what the camera is showing**.

```
ARMED: Lost Soul                                    [Cancel]
[ Mine ]  Territory · Hand · Reserve · Discard · Deck · LoR · Banish
[Theirs]  Territory · LoB · LoR · Discard · Banish · Hand
```

Mine/Theirs is a two-row grouping with a toggle on narrow viewports. Chips are derived
from `findZoneAtPosition`'s zone vocabulary plus ownership, filtered by what the server
already accepts, so the rail cannot offer an illegal move.

This decouples reachability from the camera entirely, which is the point.

### 3.6 Gesture budget

| Gesture | Target | Action |
|---|---|---|
| Tap | card | arm / disarm |
| Tap | zone (while armed) | move here, at tap point |
| Tap | empty space | clear selection / disarm |
| Long-press 500 ms | card | card context menu (sheet) |
| Long-press 500 ms | zone | zone context menu (sheet) |
| 1-finger drag | card | free-form move, with edge auto-pan |
| 1-finger drag | background | pan camera |
| 2-finger pinch | anywhere | zoom camera, anchored at midpoint |
| Double-tap | card | toggle meek (existing behaviour) |
| Double-tap | background | toggle fit ↔ zoom |

Arbitration rules:

- A press that moves >10px before 500 ms is a **drag**; 500 ms without movement is a
  **long-press**, and the pending drag is cancelled via `node.stopDrag()`.
- A second touch point during a card drag cancels the drag and promotes the interaction
  to a pinch, restoring the card to its origin.
- Double-tap splits by target so meek and zoom never collide.

Stage container gains `touch-action: none`, `-webkit-touch-callout: none` and
`user-select: none` so iOS does not hijack the gestures.

### 3.7 Context menus as bottom sheets

The 1,856 lines of menu logic are **not** refactored.

*Implementation note:* the original plan added a `variant?: 'pointer' | 'touch'`
prop to each of the eight components. In practice they have eight different
internal shapes, so a prop meant eight bespoke edits. The shipped approach is
smaller: each root carries a `data-context-menu` attribute (one line per file),
`useInputMode` reflects `data-input-mode` onto `<html>`, and one scoped CSS
block in `globals.css` restyles them into bottom sheets with ≥44px rows. The
`!important` flags are needed to beat the components' own inline positioning,
and that override is the entire extent of the change — no action logic moves.

Affected: `CardContextMenu`, `MultiCardContextMenu`, `DeckContextMenu`,
`ReserveContextMenu`, `HandContextMenu`, `ZoneContextMenu`,
`OpponentZoneContextMenu`, `LorContextMenu`.

Konva calls `preventDefault()` on any touchstart hitting a listening shape,
which suppresses the synthesized `mousedown` these menus used for
outside-click dismissal — so on touch a menu could not be closed at all. All
17 menus and modals now carry a paired `touchstart` listener.

### 3.8 Touch layout profile

New `TOUCH_PROFILE` in `multiplayerLayout.ts`, additive beside `NARROW_PROFILE` and
`STANDARD_PROFILE`. Selected on `containerHeight < 500 && inputMode === 'touch'` —
keyed on **physical** container height rather than virtual width, because height is the
binding constraint.

```ts
const TOUCH_PROFILE: LayoutProfile = {
  sidebarWidthRatio:      0.10,   // icon rail; tap opens a pile sheet
  oppHandRatio:           0.05,   // thin strip of card backs
  oppTerritoryRatio:      0.30,
  oppLobRatio:            0.085,
  dividerRatio:           0.005,
  playerLobRatio:         0.085,
  playerTerritoryRatio:   0.30,
  playerHandRatio:        0.175,
  mainCardWidthRatio:     0.078,
  oppHandScale:           0.55,
  pileLabelRatio:         0.14,
};
// vertical ratios sum to 1.000, matching NARROW/STANDARD
```

Supporting changes:

- **Turn indicator overlays the canvas** rather than occupying a fixed 48px bar,
  recovering ~14% of vertical space on a phone.
- **`RightPanel` becomes a bottom sheet** on touch instead of a flex sibling, so it no
  longer subtracts from canvas width.
- **Sidebar piles collapse into an icon rail**; tapping a pile opens the existing
  browse modal in sheet form.
- **`env(safe-area-inset-*)`** honoured for the landscape notch.

Net effect on an iPhone 14 Pro landscape: **43px → 57px** cards at fit zoom.

iPad is deliberately untouched by this profile — at 744px height it keeps the standard
profile and gains only the touch input layer. This is why tablet support is close to free.

### 3.9 Orientation gate

Phone portrait is not supported. When `containerWidth < containerHeight &&
containerWidth < 700`, render `RotateDevicePrompt`.

The 700px threshold lets iPad portrait (834×1112) through — it letterboxes but remains
usable — while gating phones, where the layout is structurally broken rather than merely
tight.

### 3.10 Pre-existing touch bugs fixed en route

These are prerequisites, not scope creep:

1. `handleCardClick` gates on `e.evt.button === 0`. On a `TouchEvent`, `button` is
   `undefined`, so `leftClicksSinceContextMenuRef` never increments — and
   `handleDblClick` requires it to be ≥2. **Double-tap-to-meek is silently dead on
   touch today.** Fix: treat `undefined` as the primary button.
2. `GameCardNode`'s `onTouchStart` sets hover state, but no touch path ever clears it —
   the loupe sticks. Fix: clear on `touchend`/`touchcancel` and on camera movement.
3. `handleCardClick` reads `e.evt.shiftKey` for multi-select, undefined on touch.
   Multi-select moves behind an explicit "Select" mode toggle in the touch toolbar.

---

## 4. Validation

Research consensus is that single-signal UI validation fails: pixel diffs are good at
catching movement but poor at understanding intent, and LLM design critique still falls
short of human experts. Accordingly — **four layers, the LLM never the sole judge, and
every finding grounded in a screenshot plus route.**

### Layer 1 — Deterministic assertions
`e2e/mobile/layout-rules.spec.ts`:

- Every **control** ≥44×44 CSS px (WCAG 2.5.5 AAA, Apple HIG); hard floor 24×24 with
  24px spacing (WCAG 2.5.8 AA).
- **Cards** take the WCAG "essential" exception on rendered size, but their *tap
  hit-region* must be padded to ≥44px even when the card draws smaller.
- No text below 11px; no element overflowing canvas bounds; no horizontal body scroll.
- **Camera identity:** at `zoom = 1`, the composed transform equals the pre-change
  baseline exactly.

### Layer 2 — Screenshot matrix + vision critique
`scripts/mobile-shots.ts` captures viewports × board states × camera states to PNG plus
a manifest JSON carrying route and state metadata. Critique subagents evaluate against
stated design intent and must cite `(screenshot, viewport, state)` for every finding.
Structured output so runs are diffable.

### Layer 3 — Task-driven play agents
Playwright with CDP touch injection against a seeded game. Tasks are concrete:

- Play a Hero from hand to territory.
- **Move a Lost Soul to the opponent's Land of Redemption** — the cross-side acceptance test.
- Open a card's context menu and rotate the card.
- Zoom to the opponent's side and back to fit.

Agents report the step at which they got stuck, with a screenshot at failure.

### Layer 4 — Real-device checklist
Manual QA against a Vercel preview, covering what emulation structurally cannot reach:
iOS long-press callout, Safari's URL bar collapsing the height the scale depends on,
safe-area insets, pinch feel, haptics.

### Note on gesture automation
Pinch-zoom **is** automatable via CDP `Input.dispatchTouchEvent` with two touch points
(Chromium only). `Input.synthesizePinchGesture` exists but is flagged experimental and
is reported flaky in CI, so it is avoided. Additionally `window.__mpCamera` is exposed
in non-production builds so camera behaviour can be tested independently of gesture
recognition.

---

## 5. Files

**New**

| Path | Purpose |
|---|---|
| `app/shared/layout/camera.ts` | Camera state, transform composition, clamping, `fitRectToViewport` |
| `app/shared/hooks/useInputMode.ts` | `pointer`/`touch` detection with URL override |
| `app/shared/components/ContextSheet.tsx` | Bottom-sheet shell for touch-variant menus |
| `app/play/hooks/useBoardCamera.ts` | Camera state, gesture handlers, jump targets |
| `app/play/hooks/useTapToMove.ts` | Arm/commit state machine |
| `app/play/hooks/useLongPress.ts` | Long-press recognizer for Konva nodes |
| `app/play/components/DestinationRail.tsx` | Cross-side destination chips |
| `app/play/components/TouchControls.tsx` | Jump buttons, zoom, select-mode toggle |
| `app/play/components/PileRail.tsx` | Collapsed sidebar for touch |
| `app/play/components/RotateDevicePrompt.tsx` | Portrait gate |
| `scripts/mobile-shots.ts` | Screenshot matrix harness |
| `e2e/mobile/*.spec.ts` | Layer 1 + Layer 3 suites |

**Modified**

| Path | Change |
|---|---|
| `app/shared/layout/virtualCanvas.ts` | Optional camera argument; composed transform |
| `app/play/layout/multiplayerLayout.ts` | `TOUCH_PROFILE`; selection by container height + input mode |
| `app/play/components/MultiplayerCanvas.tsx` | Wire hooks; `touch-action`; long-press; touch bug fixes |
| `app/play/[code]/client.tsx` | Panel → sheet; turn bar overlay; safe area; orientation gate |
| `app/play/components/RightPanel.tsx` | Sheet variant |
| `app/shared/components/GameToolbar.tsx` | Touch sizing |
| `app/shared/components/GameCardNode.tsx` | Long-press wiring; hover clear on touch end |
| 8 context-menu components | `variant?: 'pointer' \| 'touch'` |

---

## 6. Sequencing

| Phase | Delivers | Risk |
|---|---|---|
| **0** Foundation + harness | Input mode, camera as no-op transform, `touch-action`, touch bug fixes, L1+L2 harness | None — invisible |
| **1** Touch input layer | Long-press sheets, tap-to-move, destination rail → **tablets playable** | Low, additive |
| **2** Camera | Pinch/pan, jump to my side / opponent's side / fit | Low — desktop unchanged at zoom 1 |
| **3** Phone layout profile | Icon rail, sheet panel, orientation gate, overlay turn bar | Medium — the only layout change |
| **4** Docs + agent validation | Implementation doc; all four validation layers | — |

Camera precedes the layout profile deliberately: it carries lower risk and makes small
cards tolerable on its own, so phone landscape becomes usable before any zone geometry
is touched.

---

## 7. Out of scope

- **Phone portrait layout.** Gated behind a rotate prompt; a real portrait design
  (zone tabs, one territory at a time) is a separate project.
- **Goldfish and spectator modes.** They share `useVirtualCanvas` and inherit the
  no-op camera, but get no touch layer in this work.
- **Native app packaging.**
- **Server / SpacetimeDB changes.** None required — cross-side moves are already legal.
- **CI integration of the new suites.** No CI currently runs tests in this repo;
  wiring that up is tracked separately.

---

## 8. Success criteria

1. A player can complete a full turn on an iPad in landscape using only touch.
2. A player can complete a full turn on an iPhone in landscape using only touch.
3. A Lost Soul can be moved to the opponent's Land of Redemption without the
   destination being visible on screen.
4. Desktop behaviour is unchanged — asserted by the camera identity property test and
   the existing suites.
5. All controls meet the 44×44 target; card tap regions meet 44px.
6. Phone portrait shows the rotate prompt rather than a broken board.
