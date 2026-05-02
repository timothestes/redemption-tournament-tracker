# Konva Drag Perf Plan — Eliminate Pixel Hit-Detection on Pointermove

**Date:** 2026-05-01
**Scope:** `/play` only (MultiplayerCanvas + GameCardNode). Goldfish out of scope.

## Background — what the profile shows and what we'll attack

Every hot stack on the main thread bottoms out in `_platform_memmove ← getImageData ← Konva._getIntersection ← _pointermove`. That means Konva is rebuilding/reading its hit graph on every `pointermove`. The per-frame work scales with the number of `listening` shapes on the stage. The two existing mitigations (`gameLayer.listening(false)` during card drag at line 2214; same during marquee at line 3708) cover only the active drag/marquee phase. Hover and pre-drag traversal still pay full cost.

Five orthogonal levers, in priority order:

1. Give every interactive `Konva.Group` a rectangular `hitFunc` so Konva skips pixel readback entirely for that subtree.
2. Disable `perfectDrawEnabled` on every `Konva.Image`, `Rect`, `Text` we render — kills a stroke/fill double-buffer pass for free.
3. Tighten `listening` discipline: `listening={false}` on every shape that isn't a hit target; use it permanently rather than imperatively.
4. rAF-throttle the hover state setters so `pointermove` doesn't rerender React 60+ times/second.
5. Replace the 8-zone HTML hover overlay's `transition: 'all 0.15s ease'` with a stagger or a single Konva-side highlight to eliminate the 8 simultaneous CSS animations on drop.

---

## Files the implementer must read first (before editing)

In this order:

1. `/Users/timestes/projects/redemption-tournament-tracker/app/shared/components/GameCardNode.tsx` (446 lines, full file) — every Konva element rendered per card lives here.
2. `/Users/timestes/projects/redemption-tournament-tracker/app/play/components/MultiplayerCanvas.tsx` lines 1535-1596 (`findZoneAtPosition` — the geometric drop-target resolver, proves Konva hit testing is **not** used for drops), lines 2186-2440 (drag handlers + existing `gameLayer.listening(false)` mitigation), lines 3180-3217 (`handleMouseEnter`/`handleMouseLeave`), lines 3713-3737 (`handleStageMouseMove`), lines 3801-5219 (Stage and Layer JSX), lines 5361-5419 (zone-hover HTML overlay with the 8 CSS transitions).
3. `/Users/timestes/projects/redemption-tournament-tracker/app/shared/hooks/useModalCardDrag.ts` (235 lines) — confirms drag-from-modal also uses `findZoneAtPosition`, not Konva hit graph.

The implementer should grep for `<KonvaImage` / `<Rect` / `<Text` usages outside `GameCardNode.tsx` to confirm where `perfectDrawEnabled={false}` needs to be added.

---

## Fix 1 — Rectangular `hitFunc` on the card outer Group (and other interactive Groups)

### What to change

**A. `GameCardNode.tsx`** — add a `hitFunc` to the outer `<Group>` at line 163-193.

Add a stable `hitFunc` callback (defined outside the component or memoized via `useCallback` with `[cardWidth, cardHeight]` deps):

```tsx
// inside GameCardNode, before return
const hitFunc = useCallback((ctx: any /* Konva.Context */, shape: Konva.Shape) => {
  ctx.beginPath();
  ctx.rect(0, 0, cardWidth, cardHeight);
  ctx.closePath();
  ctx.fillStrokeShape(shape);
}, [cardWidth, cardHeight]);
```

Pass `hitFunc={hitFunc}` to the outermost `<Group>` (the one with `draggable`, `onMouseDown`, `onDragStart`, `onContextMenu`, etc., starting at line 163).

This tells Konva: "the hit region for this Group is just this rectangle — don't traverse children, don't do offscreen pixel sampling." With ~30+ cards on the board, this collapses thousands of per-pointermove pixel reads into a single bbox check per card.

**B. Sidebar pile Groups** — in `MultiplayerCanvas.tsx` at lines 4716 (my pile Groups) and 4914 (opponent pile Groups). These render the count badge / face-up top card / draggable Group wrapper. Each has `onClick` / `onContextMenu`. Give the *outer* `<Group>` for each pile a `hitFunc` that's the bounding rect of the pile zone (`zone.x, zone.y, zone.width, zone.height`):

```tsx
hitFunc={(ctx, shape) => {
  ctx.beginPath();
  ctx.rect(zone.x, zone.y, zone.width, zone.height);
  ctx.closePath();
  ctx.fillStrokeShape(shape);
}}
```

Note: the inner draggable cards (rendered via `GameCardNode`) already get their own card-sized `hitFunc` from change A. Since Konva traverses children before parents for hit testing, the inner card `hitFunc` will catch direct card hits and the outer pile `hitFunc` will catch click/context-menu on the empty zone area.

**C. Soul Deck pile** at lines 4420-4496 — same pattern, hitFunc covering the pile rect (`px - 2, py - 2, pileWidth, pileHeight`).

**D. Zone background `<Rect>`s** at lines 3812 (shared LoB), 3826 (soul deck), 3861 (my zones), 3929 (opponent zones), 3976 (my hand), 4013 (opponent hand). These already use `Rect`, which has cheap rectangular hit-testing built in — **no change needed** here for fix 1, but they're relevant for fix 2.

**E. Reserve "👁 reveal" Group** at lines 4750-4773 — small interactive Group. Apply a tiny `hitFunc` matching its 20×18 button rect.

### Why this specific change

The profile's hot path is `getImageData ← _getIntersection ← forEach over shapes`. A `hitFunc` short-circuits the per-shape rasterization — Konva calls the function and uses canvas's native `isPointInPath` against the simple rect, never paints the shape into the offscreen hit canvas. The card outer Group is the single biggest contributor because it's the most numerous interactive shape on the board.

### Risk / behavior to preserve

- **Card visual bounds vs hit bounds**: `GameCardNode` renders the card image at exactly `(0, 0, cardWidth, cardHeight)` (line 281-283), and the outer Group's transforms (rotation, the meek-rotation inner Group) operate around the card's local 0-origin. The inner Group at line 270-275 rotates around the card center for meek; this is *visual only* and inherits the outer Group's hit shape. So a rectangular `(0, 0, cardWidth, cardHeight)` hit shape on the outer Group correctly covers both upright and meek cards.
- **Counter badges and reveal ring** (lines 339-360, 368-404) extend slightly outside `cardHeight` and to the right of `cardWidth` (badges at `cardWidth - 14`, radius 12 → reach to `cardWidth + ~−2`). They sit *inside* the rect already. The reveal ring at `cardWidth - outerRadius - 4` for cx is also inside. So no clipping risk.
- **LOB arrival glow Rect** at lines 198-211 is `(-1, -1, cardWidth+2, cardHeight+2)` — slightly outside the hit rect, but it has `listening={false}` already, so it's not part of hit testing. No issue.
- **Selection / hover highlight** Rects (lines 234-267) are also `listening={false}`, no issue.
- **The opponent territory cards rotated 180°** (line 4976 `rotation={180}`) — Konva applies the parent transform to the hit shape automatically, so `(0, 0, cardWidth, cardHeight)` in local space still hits correctly when the Group is rotated 180.
- **CardContextMenu on Ctrl+click** at line 175-180 — uses `e.target` and `node.stopDrag()`. Won't break.

### Verification

1. Hover a card — green/golden glow still appears.
2. Right-click a card — context menu opens.
3. Click a card to select → shift-click another → drag — multi-select drag still works.
4. Click an empty area inside the card slightly past the rounded corner — *should* still hit. (Previously the rounded card image with `cornerRadius={4}` would hit-miss in the corner; now the rect catches it. This is a *very minor visual delta* — corners are now slightly more clickable. Acceptable.)
5. Drag opponent territory card (rotated 180°) into your hand.
6. Click the count badge / "👁" reveal indicator — still triggers.

---

## Fix 2 — `perfectDrawEnabled={false}` on every `Konva.Image`, `Rect`, `Text`

### What to change

Konva's `perfectDrawEnabled` (default true) makes Konva paint the shape into a buffer canvas first, then composite onto the layer — to ensure stroke/fill/shadow combinations render correctly without z-fighting. The double-paint costs ~30-40% per shape with no visible difference for our shapes.

Apply `perfectDrawEnabled={false}` to:

**A. `GameCardNode.tsx`** — every `<Rect>`, `<KonvaImage>`, `<Circle>`, `<Arc>`, `<Text>` element. Specifically lines 28-33, 38-46, 198-211, 217-230, 235-248, 253-266, 280-284, 286, 292-298, 304-312, 314-321, 322-334, 344, 345, 346-357, 385, 387-393, 395-401, 415-424, 425-439.

**B. `MultiplayerCanvas.tsx`** — every `Konva.Image`, `Rect`, `Text` element. The grep at lines 3812-5198 covers them. Top targets:

- Zone background Rects (lines 3812, 3826, 3861, 3929, 3976, 4013).
- Hand label Texts (4003, 4006, 4038, 4041).
- LOB / territory overlay Rects + Texts (4524-4561, 4586-4623, 4651-4688).
- Sidebar pile count badge Rects + Texts (4734-4745, 4763-4772, 4931-4956).
- Soul Deck pile (4429-4495).
- Selection rect (5211-5217).

**C. `app/shared/components/GameCardNode.tsx` `CardBackShape`** at lines 28-46.

### Why this specific change

The profile shows `_platform_memmove` dominating, which is the buffer-canvas blit step. `perfectDrawEnabled=false` skips the buffer entirely. For shapes with stroke OR fill (not both with a shadow), the rendering is identical. Our shapes never combine stroke+fill+shadow in a way that needs the buffer:

- Card image (Konva.Image): no stroke, no shadow → safe.
- Zone backgrounds (Rect with fill + 1px stroke + opacity): edge case, but visually indistinguishable; safe.
- Selection / hover Rects with stroke + shadowBlur: these are the riskiest. Disabling `perfectDrawEnabled` here may produce a subtle stroke-over-shadow artifact. Test visually; if a regression appears, leave `perfectDrawEnabled` enabled on those specific Rects only. This is a per-shape opt-out, not all-or-nothing.

### Risk / behavior to preserve

- Cards with shadow-blur outline (selection at line 244-247, hover at line 263-265, reveal-arc at 385) might look very slightly different. Eyeball test: hover/select a card and confirm glow looks identical.
- The LOB arrival glow Rect at line 198-211 uses `stroke` only (no fill, no shadow) — completely safe.
- The "Choose Good"/"Choose Evil" outline at line 217-230 has stroke + shadow — possible visual delta. Verify on a card with that outline applied.

### Verification

1. Visually confirm zones / cards / counters / hover glow / selection glow look the same.
2. Specifically inspect: a card with reveal ring, a card with counters, a card with notes, a card during LOB arrival glow.

---

## Fix 3 — Audit `listening`; mute the gameLayer during hover too

### What to change

**A. Permanently `listening={false}` on shapes that exist only as visuals** (not click/hover targets):

In `MultiplayerCanvas.tsx`:
- Hand label Texts at 4003, 4038 — already `listening={false}`. Good.
- Hand count badge Groups at 4004, 4039 — already `listening={false}`. Good.
- LOB and territory overlay Groups (4523, 4585, 4650) — already `listening={false}`. Good.
- Pile count badge Groups (4734, 4931, 4947) — already `listening={false}`. Good.
- The shared LoB background `<Rect>` at line 3812 has `onContextMenu` but is otherwise just a visual zone. Keep listening here (needed for right-click → soul-deck menu).
- The zone backgrounds at 3861/3929 conditionally take handlers (`onClick`, `onContextMenu`) only when `key` is a sidebar pile zone. Currently the `<Rect>` is always rendered with the full prop set, even for territory and LoB rects. Add `listening={!isLob && !isFreeForm ? undefined : false}` (or pass `listening={false}` when no handler is attached) — this means the territory/LoB *background* rects don't enter the hit graph but the cards inside still do. **Substantial perf win — these are the largest visual rects on the board.**

This is the only listening change that materially shrinks the hit graph beyond what `hitFunc` already gives us.

**B. Mute gameLayer during hover (extend the existing drag/marquee mitigation):**

Currently `gameLayer.listening(false)` only fires in `handleCardDragStart` (line 2214) and `handleStageMouseDown` (line 3708). Per the profile, the cost is happening *outside* drag too. We **cannot** simply turn off listening permanently because hover (`onMouseEnter`/`onMouseLeave`) and click handlers depend on it.

Approach — **don't mute the layer during hover**; instead, rely on fixes 1 + 4 to make hover cheap. Layer-level muting during hover would require us to re-implement hover hit-testing manually against `allCardBounds`, which is more code and risk than this scope warrants. Document this decision so it doesn't get re-attempted.

### Why this specific change

The territory/LoB zone background Rects span ~25-40% of the canvas area each. Even though `Rect` hit testing is rectangular and doesn't cost a pixel readback, having them `listening` means they're added to Konva's `_listeningEnabled` shape list, which is iterated on every event. Removing them shrinks the per-event traversal proportionally. The change is minimal and the risk is bounded.

### Risk / behavior to preserve

- The LOB right-click menu currently fires from `onContextMenu` on the LoB zone Rect at line 3872 (my) / 3940 (opponent). If we make the LoB rect non-listening, we lose that. **Solution:** keep `listening` for the LoB rect (since `isLob` is true and `onContextMenu` is attached), but explicitly set `listening={false}` for territory rects (free-form) where neither `onClick` nor `onContextMenu` is attached. Inspect the conditional at lines 3871-3880 closely:
  - If `isLob`: contextMenu attached → must stay listening.
  - If `SIDEBAR_PILE_ZONES.includes(key)`: handlers attached → must stay listening.
  - **Else (territory):** no handlers → safe to set `listening={false}`.
- Verify: right-click empty territory area still produces no menu (correct — only LOB has zone-level menus); click drag empty area in territory still starts marquee selection (verified by `handleStageMouseDown` walking ancestors checking for handlers).

### Verification

1. Right-click in empty LOB area — opens zone menu.
2. Right-click in empty Territory area — does *not* open a zone menu (this is the current behavior).
3. Marquee-drag from empty Territory area — still starts marquee.
4. Marquee-drag from empty Hand area — still works (hand Rects keep `onContextMenu` and don't change).
5. Click sidebar pile (deck/discard/etc.) — still browses.

### Estimate

~10-15 line changes total. Low risk.

---

## Fix 4 — rAF-throttle hover state updates

### What to change

In `MultiplayerCanvas.tsx`, `handleMouseEnter` (lines 3180-3208) and `handleStageMouseMove` (lines 3713-3737) call `setHoveredInstanceId`, `setHoveredCard`, and `setMousePos` on every event. Konva fires these for every pointermove that crosses a shape, *which itself triggers more hit graph rebuilds*. React rerenders every card (`hoverProgress` prop change cascades to ~30 cards if `memo` doesn't short-circuit), and the React reconciliation cost shows up as `ViewManagerFlush` + `DoFlushPendingNotifications` in the profile (248 + 173 markers).

**Refactor:**

1. Add an rAF-throttle helper:

```tsx
// near other refs, around line 596
const pendingHoverFrameRef = useRef<number | null>(null);
const pendingHoverPayloadRef = useRef<{
  card: GameCard | null;
  mousePos: { x: number; y: number };
  instanceId: string | null;
} | null>(null);

const flushHoverState = useCallback(() => {
  pendingHoverFrameRef.current = null;
  const p = pendingHoverPayloadRef.current;
  if (!p) return;
  pendingHoverPayloadRef.current = null;
  setHoveredInstanceId(p.instanceId);
  setHoveredCard(p.card);
  setMousePos(p.mousePos);
}, []);

const queueHoverUpdate = useCallback((next: {
  card: GameCard | null;
  mousePos: { x: number; y: number };
  instanceId: string | null;
}) => {
  pendingHoverPayloadRef.current = next;
  if (pendingHoverFrameRef.current == null) {
    pendingHoverFrameRef.current = requestAnimationFrame(flushHoverState);
  }
}, [flushHoverState]);
```

2. Cleanup: cancel `pendingHoverFrameRef` on unmount.

3. In `handleMouseEnter` (line 3185), replace direct `setHoveredInstanceId(card.instanceId)` and `setHoveredCard(card)` and `setMousePos(pos)` with a single `queueHoverUpdate({ instanceId: card.instanceId, card, mousePos: pos })`. Keep `mousePosRef.current = pos` as-is (it's a ref, free).

4. In `handleStageMouseMove` (line 3719) — `setMousePos(clientPos)` is already gated behind `if (hoveredCard)`. Replace it with `queueHoverUpdate({ instanceId: hoveredInstanceId, card: hoveredCard, mousePos: clientPos })`. (Need to read latest hoveredCard via ref to avoid stale closure — see implementation note below.)

5. In `handleMouseLeave` (line 3210-3217) — keep direct `setHoveredInstanceId(null)` and `setHoveredCard(null)`. Leave is a single event; throttling it would feel laggy. *Also* cancel any queued update: `if (pendingHoverFrameRef.current) cancelAnimationFrame(pendingHoverFrameRef.current); pendingHoverFrameRef.current = null; pendingHoverPayloadRef.current = null;`

**Implementation note on stale closure:** `handleStageMouseMove` currently reads `hoveredCard` directly (line 3718). Since the throttled update changes when `hoveredCard` materializes in state, depending on `hoveredCard` in the deps list of `handleStageMouseMove` is correct (the callback rebinds). No change needed there as long as the existing pattern is preserved.

### Why this specific change

The profile's "248 ViewManagerFlush + 173 DoFlushPendingNotifications" smoking gun is React rerendering on every pointermove. Throttling to 1 update per frame (rAF) caps the rerender rate at the display refresh — bounded to once per ~16.6ms instead of however many pointermove events fire (often 60-120/sec on a high-poll-rate mouse).

### Risk / behavior to preserve

- The 250ms hover delay timer (line 3203-3205) is independent of the throttled state — keep it as-is. Setting `hoverReady` doesn't need throttling because it fires once.
- Hovered-card preview (`hoveredCard` driven CardPreviewSystem) might appear with up to ~16ms delay on hover-target switch. Imperceptible.
- The hover progress animation at line 550-562 uses its own rAF — unaffected.

### Verification

1. Hover from card to card rapidly — golden glow tracks correctly, just at one update per frame.
2. Hover preview tooltip appears after 250ms.
3. Hover-while-dragging is suppressed by `if (isDraggingRef.current) return;` — unchanged.
4. Mouse leave clears immediately (no perceptible lag).

### Estimate

~30 lines added, ~5 lines modified.

---

## Fix 5 — Eliminate the 8 simultaneous CSS hover-zone transitions

### What to change

The drag-hover overlay at `MultiplayerCanvas.tsx` lines 5361-5419 renders an HTML `<div>` per zone (10-15 zones in a normal game), each with `transition: 'all 0.15s ease'` and a border + background that swap when `dragHoverZone === key`. When `dragHoverZone` changes (e.g., on drop), every overlay div animates simultaneously → 8-15 concurrent CSS transition timelines → the profile's clustered CSSTransition markers.

**Two acceptable approaches; pick A.**

**Approach A (preferred): Drop the transition entirely.**

Change line 5399 `transition: 'all 0.15s ease'` to `transition: 'none'`. The zone highlight will pop instead of fading. This is fine UX — the highlight already updates on every pointermove (driven by `setDragHoverZone(zoneKey)` at line 2422), so a fade-in over 150ms is barely perceptible during normal drag movement. The fade only mattered visually on the *exit* event when drag ends.

If the implementer wants to soften the drop transition specifically, gate transitions to "border 0.1s, background 0.1s" instead of "all 0.15s" — `all` includes `width`, `height`, `left`, `top` which animate during scale changes (none here, but `all` is wasteful).

**Approach B (fallback if A looks too jarring): Render the highlight via Konva instead of HTML.**

Move the hover highlight into a third `<Layer>` (Konva) that's `listening={false}`. One Rect that gets repositioned (via `node.x/y/width/height/visible`) per `dragHoverZone` change. Single repaint per change, no CSS animation pile. ~20-30 lines.

**Recommendation:** ship A first, measure, only do B if it reads as ugly.

### Why this specific change

Profile shows 8 simultaneous CSSTransition markers at the drop instant + 4 GCMajor pauses (448ms total). Fewer concurrently animating elements = less style recomputation per frame and fewer `RestyleManager`/`EffectCompositor` cycles. The "EffectCompositor::GetAnimationElementAndPseudoForFrame" being the top JS-engine native frame is direct evidence this animation infrastructure is the dominant non-Konva cost.

### Risk / behavior to preserve

- Drop visual: highlight appears/disappears instantly. Test that the user can still see *which* zone is targeted during drag. This is preserved because the highlight color/border still differs hovered vs not.

### Verification

1. Drag a card across zones — highlights track without lag.
2. Drop a card — no visible jank or animation pile-up.
3. Drag a card into the source zone (which is excluded at line 5368) — no highlight on source, correct.

### Estimate

Approach A: 1 line change. Approach B: 20-30 lines.

---

## Dependency ordering

Fixes are largely independent. Suggested order to ship as individual commits for ease of bisecting if a regression appears:

1. **Fix 5 first** (1-line change, isolated, easy to verify drop snap-action).
2. **Fix 2 next** (mechanical `perfectDrawEnabled={false}` sweep, easy review).
3. **Fix 1** (hitFunc on outer Group + pile Groups; the highest-leverage perf change).
4. **Fix 3** (territory rect listening tweak; low risk after fix 1 lands).
5. **Fix 4** (rAF throttle; least mechanical, most chance of subtle bugs).

None of fixes 1-4 are prerequisites for each other — they're all reducing different per-event costs. Fix 5 is fully independent. Land any subset and measure in isolation.

---

## Churn estimate

| Fix | File(s) | Approx LOC change |
|---|---|---|
| 1 | GameCardNode.tsx (1 location) + MultiplayerCanvas.tsx (~5 pile/soul-deck Groups) | +30 |
| 2 | GameCardNode.tsx + MultiplayerCanvas.tsx (props addition on ~40 elements) | +40 modified-props |
| 3 | MultiplayerCanvas.tsx (listening prop on territory zone Rects) | +5 |
| 4 | MultiplayerCanvas.tsx (refs + 2 callbacks + handler edits) | +30 / -5 |
| 5 | MultiplayerCanvas.tsx line 5399 | 1 |

Total: ~110 lines across two files. None of it touches the 6646-line file's complex interior — all changes are at well-localized JSX prop sites, plus the new throttle helpers near the existing hover state block at line 543.

---

## SpacetimeDB note

**No SpacetimeDB schema or reducer changes are required.** Every change is client-side React/Konva. No `spacetime publish` / `spacetime generate` needed.

---

## Smoke-test checklist (run after all fixes land)

For each, drag the card and confirm correct end state + smooth pointer tracking:

- [ ] Card from hand → my territory (free-form drop, posX/posY set).
- [ ] Card from territory → discard pile.
- [ ] Card from territory → reserve pile.
- [ ] Card from territory → banish pile.
- [ ] Card from territory → land-of-redemption pile.
- [ ] Card from territory → land-of-bondage (auto-arrange).
- [ ] Card from territory → opponent territory (sandbox cross-side).
- [ ] Card from hand → opponent hand.
- [ ] Card from deck (top) → hand (draw mechanic).
- [ ] **Multi-select drag**: shift-click 3 cards in territory, drag to LOB → all three move.
- [ ] **Equipped-follower drag**: warrior with weapon attached → drag warrior to discard, weapon comes along.
- [ ] **Soul (LOB) drag with site attached**: drag soul → site comes along.
- [ ] **Paragon shared LoB**: drag from soul deck → shared LoB.
- [ ] **Right-click context menu** on a card mid-board.
- [ ] **Hover preview tooltip** appears after 250ms continuous hover.
- [ ] **Marquee selection** still functions (drag from empty area).
- [ ] **Zone-level context menu**: right-click empty LOB → menu opens.
- [ ] **Sidebar pile click**: click discard pile to browse.
- [ ] **Reserve reveal toggle (👁)**: click revealed indicator to hide.
- [ ] **Visual sanity**: hover glow, selection glow, LOB arrival glow, counter badges, reveal ring all look identical to before.

---

## Build / type-check note

**Recommended: skip a full `npm run build`.** All changes are prop additions and small handler refactors — TypeScript will catch anything broken at the editor level. The user has stated a preference for skipping builds on small changes.

**Run a build** if either is true:

- The implementer changes the `GameCardNode` props shape (e.g., adds a `hitFunc` prop the parent passes in — if `hitFunc` is defined inside the component as recommended, no API change → no build needed).
- Fix 4's rAF throttle introduces type errors around `pendingHoverPayloadRef` (it's a typed ref so this should be caught in-editor).

If TypeScript-in-editor shows clean and all smoke tests pass, ship without a full build.

---

## What this plan deliberately does NOT do

- Does not touch the goldfish canvas (out of scope).
- Does not change SpacetimeDB schema or reducers.
- Does not refactor `findZoneAtPosition` or any drop logic — Konva hit graph is bypassed for drops already.
- Does not introduce a third Konva layer for hover highlight (that's the Approach B fallback for fix 5, only if A looks bad).
- Does not mute `gameLayer.listening` during hover — fixes 1 + 4 should make hover cheap enough without it; muting would require reimplementing hover hit-test against `allCardBounds`, more risk than reward.

---

### Critical Files for Implementation

- /Users/timestes/projects/redemption-tournament-tracker/app/play/components/MultiplayerCanvas.tsx
- /Users/timestes/projects/redemption-tournament-tracker/app/shared/components/GameCardNode.tsx
- /Users/timestes/projects/redemption-tournament-tracker/app/shared/hooks/useModalCardDrag.ts (read-only — confirms drop logic doesn't depend on Konva hit graph)
