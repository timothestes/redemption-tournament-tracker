# Card-Search DnD: Progress & Improvement Backlog

**Status:** In-progress on `add-maybeboard` branch
**Created:** 2026-05-15
**Goal:** Make the whole card-search section feel seamless, smooth, and fun to drag-and-drop in — for PC *and* mobile users.

---

## 1. What this PR is about

This PR introduces the **Maybeboard** zone (a "Considering" scratchpad for cards a user isn't ready to commit to their deck) and wires up **drag-and-drop** between the deck-panel zones using `@dnd-kit`.

The work is the union of three sequential design specs already on disk:

- [PR 1 — `is_reserve` → `zone` schema refactor](../../../supabase/migrations/028_replace_is_reserve_with_zone.sql) (landed pre-branch)
- [PR 2 — Maybeboard UI + import/export](2026-05-13-maybeboard-ui-and-dnd-design.md) (§3)
- [PR 3 — `@dnd-kit` integration](2026-05-13-maybeboard-ui-and-dnd-design.md) (§4)
- [Drop-ergonomics + tab-drop fix follow-up](2026-05-13-maybeboard-drop-ergonomics-and-tab-fix-design.md)

All three are now landed on the branch.

---

## 2. What's done

### Schema & data layer
- `deck_cards.zone` enum: `main` / `reserve` / `maybeboard`
- Maybeboard cards excluded from all downstream consumers (legality, pricing, paragon rules, game state, OG previews)
- `useDeckState` accepts `zone` everywhere

### UI
- Persistent `MaybeboardStrip` at bottom of deck panel, visible across all 4 tabs
- Click/right-click context menus for "Add/Move to maybeboard" everywhere a card lives (search tiles, modal, main/reserve rows, thumbnail menus)
- Public deck view shows maybeboard as muted "Considering" section
- Import/export round-trips maybeboard via `# maybeboard` markers in the `Tokens:` section

### Drag-and-drop (within deck panel)
- `@dnd-kit/core` + `sortable` + `utilities` installed
- 5 droppables registered: `zone:main`, `zone:reserve`, `zone:maybeboard`, `tab:main`, `tab:reserve`
- All 6 zone-pair drags work: main↔reserve, main↔maybeboard, reserve↔maybeboard
- Tab triggers act as drop targets (drag onto Main/Reserve tab → card moves + tab switches)
- DragOverlay shows ghost card image at 60% opacity
- Strip auto-expands during drag (`min-h-[120px] md:min-h-[160px]`)
- "Drop into Maybeboard" overlay when valid drop in progress
- Auto-expand-on-drag for collapsed strip; restores collapsed state on drop end
- Keyboard support via `KeyboardSensor` + `screenReaderInstructions`
- All 8 spec acceptance cases verified end-to-end via Playwright pointer events

### Recent polish (post-spec)
- `autoScroll={false}` — page no longer scrolls when dragging near the bottom edge
- 6-dot drag-handle glyph fades in on hover for main/reserve card rows
- Trailing "Drop more cards here" placeholder fills the maybeboard strip dead space *(NOTE: critic flagged this as the wrong pattern — see §5 below)*

---

## 3. Bugs caught & fixed during verification

These weren't in the spec but surfaced when actually exercising the drags end-to-end with Playwright:

### 3a. 4 of 5 droppables weren't registered with `@dnd-kit`
**Root cause:** `useDroppable()` calls at the top of `DeckBuilderPanel` ran *outside* the `<DndContext>` provider (the provider is rendered in the panel's own return JSX). React context resolves at hook-call time, so the hooks saw the default empty context and silently failed to register.

**Symptom:** drags resolved to the only working droppable (`zone:maybeboard`, which lives in `MaybeboardStrip` — a child component that *is* inside the context).

**Fix:** extracted a `<Droppable>` wrapper component so the hooks run inside the JSX tree.

### 3b. Default `rectIntersection` couldn't see tab triggers
**Root cause:** `rectIntersection` compares against the source draggable's *static* rect (it doesn't translate during drag — only the `DragOverlay` does). So a card in the grid (`y ≈ 261+`) never overlapped the tab row (`y = 168–212`), even when the pointer was directly over it.

**Fix:** custom `pointerWithin → rectIntersection` collision detector. Pointer-precise for small targets, with rect-intersection fallback for gaps.

### 3c. `disabled: !isDragging` on tab droppables
**Root cause:** Toggling `disabled` mid-drag leaves the rect un-measured by the collision detector.

**Fix:** removed; tab droppables are always registered, and the handler is gated by `handleDragEnd` only firing during a drag anyway.

> **Note:** The follow-up spec's stated fix (no-op `handleDragOver`, switch tabs in `handleDragEnd`) was correct but masked by 3a + 3b + 3c. The drag never reached `handleDragEnd` with `over=tab:reserve` in the first place.

---

## 4. Known gaps — where drag-and-place isn't compatible yet

The user's framing: "make the *whole* card-search section drag-and-place compatible." Today we've only wired drag within the deck panel. The big missing pieces:

### 4a. Search column → deck *(deferred in PR 3 §4.11, but user is asking)*
The search results column on the left has hundreds of card tiles. Currently click-to-add via an "Add card" button or right-click menu. **No drag.**

Why deferred originally:
- Heavy mobile-UX implications (the search column hides behind a drawer on mobile)
- Two interaction models (drag *and* click) make the UI ambiguous if not designed carefully

What it would take:
- Wrap search-result tiles in `useDraggable` with `data: { source: 'search', card }`
- New collision logic: a drop on any zone droppable just *adds* the card to that zone (no removal from source)
- `DragOverlay` needs to handle "external" sources too
- Mobile: needs an alternate gesture (the search column isn't visible mid-drag on phone)

### 4b. Modal (ModalWithClose) → deck
When the user taps a card thumbnail (search tile, public deck, etc.), `ModalWithClose` shows a full-card view. Currently has buttons "Add to Main / Reserve / Maybeboard." **No drag.**

What it would take:
- The card image in the modal becomes a draggable
- Closing the modal automatically on drag-start? Or render the modal in a portal that doesn't interrupt the drag overlay?
- `@dnd-kit` doesn't traverse portal boundaries, so the modal needs to render *inside* the same DndContext

### 4c. Deck zone drop area is too narrow
Currently the `zone:main` and `zone:reserve` droppables wrap only the `space-y-4` card grid (~141px tall when sparse). The rest of the tab content area is non-droppable empty space. **The user noted this directly: "the deck area should be more generous in its drag zone."**

Fix: expand the droppable to cover the entire tab content scroll area (`flex-1 overflow-y-auto overflow-x-hidden p-4`), so any drop anywhere in the tab body lands in that zone.

### 4d. Same-zone reordering inside a zone
Spec called this out as out-of-scope (PR 3 §4.11) because grouping by type would fight manual ordering. Worth revisiting if/when manual ordering becomes a feature.

### 4e. "Trash" drop target to remove cards
Out of scope in spec. Would be a nice symmetric drop target.

---

## 5. Pain points for users

### 5a. PC users

**Drag-handle vs row controls collision** *(user-flagged)*
Hovering a main/reserve card row reveals both:
- The 6-dot drag-handle glyph (top-left)
- The `−` / `+` / `…` controls (mid-row)

A user who wants to drag has to aim for the card image and avoid the controls. A user who wants to step quantity has to avoid the drag handle. Two competing affordances in the same hover state.

*Possible solutions:*
- Make the entire card image area the drag target (already true) and visually emphasize the drag-handle on hover *more strongly* than the controls
- Move the controls into a footer strip below the card image (separate from the drag-able area)
- Tell the user "drag the image, click the buttons" via copy / animation on first use

**Drop zones are smaller than they look**
The user thinks they're dropping on "the Main tab" but really has to land on the `space-y-4` card grid or the tab trigger button. Empty space in the tab body is not a drop target. Fix: §4c above.

**Drag activation distance 6px**
Mouse users with twitchy hands or precision trackpads can accidentally start a drag when intending a click. The 6px threshold is the @dnd-kit default. Could bump to 8–10px to be more forgiving.

**Mask gradient hides cards at scroll-end** *(critic flag)*
The maybeboard strip's right-edge fade-mask is unconditional when the row overflows. When scrolled fully right, the last visible cards still fade into transparency. Looks broken.

**"Drop more cards here" placeholder always visible** *(critic flag, my recent change)*
The dashed-bordered placeholder I added to fill the dead space reads as scaffolding rather than content. Should appear *only during an active drag*. When idle, thumbnails hug left, rest is quiet droppable background.

**Collapsed strip doesn't feel like a drawer** *(user-flagged + critic flag)*
At 29px tall with a tiny chevron in one corner and a `?` in the other, the collapsed bar has no "handle" affordance. Users won't know it's tappable.

**No drag from search / modal** *(user-flagged, §4a + §4b above)*

### 5b. Mobile users

**Always-visible affordance missing**
The 6-dot drag-handle is hover-only. On touch, there's no hover. Mobile users have no visual cue that cards are draggable — they have to discover it via long-press.

**Long-press conflicts**
- 200ms TouchSensor delay activates drag
- Native long-press for the OS context menu fires after ~500ms
- The maybeboard thumbnail menu was moved to a `⋯` overflow button per spec §3.6 to free long-press for drag

Is the `⋯` button big enough on a phone? WCAG 24×24 minimum. Worth measuring.

**Maybeboard strip eats vertical real estate**
At rest: ~80px. Expanded during drag: ~120–160px. Plus the MobileBottomNav (~56px) and the safe-area inset (~34px on notched phones). That's 170–250px of bottom chrome on a 600–700px tall phone viewport. The deck list above gets squeezed.

*Possible solutions:*
- Default to collapsed on mobile (29px instead of 80px at rest)
- Don't auto-expand during a drag *from* the maybeboard on mobile (the user knows they're dragging from there)

**Tab triggers are narrow targets on phones**
With 4 tabs (Main/Reserve/Stats/Details) split across a ~400px-wide drawer, each tab is ~100px wide. Dragging precisely onto Main vs Reserve is tight, especially with the auto-tab-switch behavior disabled.

**Stepper +/- buttons are under WCAG minimum** *(critic flag)*
The +/- buttons on maybeboard thumbnails are smaller than 24×24 px — fine on desktop hover, hard to hit on touch.

**Vertical scroll vs drag arbitration**
TouchSensor's `delay: 200, tolerance: 5` should let a quick swipe scroll the deck list and a long-press initiate a drag. But the user may still get accidental drags when scrolling slowly. Worth instrumenting if reports come in.

---

## 6. Inconsistencies noticed during dev

These won't break anything but they erode the "polished tool" feel:

| Inconsistency | Where | Fix |
|---|---|---|
| Drag-handle hover-only on desktop; no equivalent on mobile | `DeckCardList.tsx` (DraggableRow) | Always-visible faint glyph; opacity-100 on touch via `@media (hover: none)` |
| Two names for the same feature: "Maybeboard" (builder) vs "Considering" (public view) | `MaybeboardStrip.tsx` + `app/decklist/[deckId]/client.tsx` | Pick one. *Recommendation:* "Considering" everywhere — friendlier, less jargon |
| Tab `isOver` styling: `ring-2 ring-primary/60 rounded` | `DeckBuilderPanel.tsx` (Droppable for tab:*) | Different intensity than... |
| Zone `isOver` styling: `ring-2 ring-primary/40 bg-primary/5` | `DeckBuilderPanel.tsx` (Droppable for zone:*) | ...zone drops. Standardize. |
| Maybeboard `isOver` styling: `border-2 border-primary bg-primary/15` | `MaybeboardStrip.tsx` | Yet another. Pick one drop-target visual language. |
| `isOver` border-2 vs default border-t causes 1px layout shift | `MaybeboardStrip.tsx` | Use a transparent border-t at rest, switch color on hover (no width change) |
| `ModalWithClose` action row has 3 zone buttons but no drag option | `ModalWithClose.tsx` | §4b above |
| Search tile "Add card" button defaults to main; no zone picker, no drag | `app/decklist/card-search/client.tsx` | §4a above |
| Strip says `sticky bottom-0 z-10` but has no scrolling ancestor | `MaybeboardStrip.tsx` | True sticky requires the deck panel to scroll internally. Today it's positioned by flex order only. |
| Collapsed state isn't persisted | `MaybeboardStrip.tsx` (`useState(false)`) | localStorage per-deck |
| Auto-expand-on-drag works for collapsed strip but the transition is `linear`, not eased | `MaybeboardStrip.tsx` | `ease-out` over 150ms |

---

## 7. Prioritized roadmap

### P0 — quick wins (high impact, low effort)
1. **Make the deck zone drop target generous** *(user-flagged)*
   Expand `zone:main` / `zone:reserve` droppable to cover the full tab content area, not just the card grid.
2. **Fix the mask-gradient bug**
   Track `scrollLeft` and conditionally mask only the side with more content. Fade-out shouldn't appear when fully scrolled.
3. **Kill the always-on "Drop more cards here" placeholder**
   Show the dashed treatment *only* during an active drag from another zone. When idle, thumbnails hug left, rest is quiet droppable background.
4. **Bump drag activation distance from 6px → 10px**
   Trade a touch of activation sensitivity for far fewer accidental drags on twitchy hands.

### P1 — drawer feel (medium effort, biggest UX upgrade)
5. **Real collapsed-state drawer affordance** *(critic recommended)*
   - Full-width tap target with hover background (`hover:bg-muted/40`)
   - Centered horizontal pill drag-handle glyph (iOS sheet style)
   - Bigger chevron (16×16 not 12×12)
   - Persist collapsed state in localStorage per deck
6. **Default to collapsed on mobile**
   Recover ~50px of vertical space at rest. User expands on demand.
7. **Generous deck-zone hover/drop styling** — when a drag is active, *the entire tab content area* shows a subtle drop-zone indicator, not just the small card grid.

### P2 — extend drag to the rest of card-search *(user-flagged)*
8. **Search column → deck drag** (§4a)
   Big scope; needs its own design spec covering mobile gesture, drop-zone behavior, drag-overlay handling, and whether shift-drag adds multiple copies.
9. **Modal (`ModalWithClose`) → deck drag** (§4b)
   Smaller scope but needs portal-boundary thinking with `@dnd-kit`.

### P3 — polish & consistency
10. **Always-visible drag affordance on mobile** — `@media (hover: none) { opacity: 0.6 }` on the 6-dot glyph
11. **Standardize drop-zone visual language** across tab/zone/maybeboard
12. **WCAG-compliant +/− stepper buttons** on maybeboard thumbnails (≥24×24)
13. **Rename "Maybeboard" → "Considering"** in the builder (matches public label)
14. **`m` keyboard shortcut** to toggle maybeboard collapse (power-user nice-to-have)

### P4 — bigger structural moves (only if §1–§3 don't move the needle)
15. **Make the deck panel scroll internally** so the strip can be *truly* sticky
16. **Trash drop target** for removal-by-drag (§4e)
17. **Reorder-within-zone** (§4d) — only if manual ordering becomes a feature

---

## 8. Open questions

- Should drag-and-drop be the *primary* interaction model on PC, with click as fallback? Or co-equal?
- Should mobile have a fundamentally different interaction (e.g., tap-to-select-then-tap-target, instead of long-press-drag)?
- Is `MaybeboardStrip` the right home for the "Considering" pile long-term, or should it eventually become a side rail / dedicated tab?
- Do we want shift-drag = move-all-copies? Spec marked it as a stretch goal.

---

## 9. Pointers

- Recent commit-level changes: branch `add-maybeboard`, ahead of `main` by ~5 commits
- DnD wiring: [DeckBuilderPanel.tsx — DndContext setup](../../../app/decklist/card-search/components/DeckBuilderPanel.tsx) + [Droppable wrapper](../../../app/decklist/card-search/components/DeckBuilderPanel.tsx)
- Draggable rows: [DeckCardList.tsx — DraggableRow](../../../app/decklist/card-search/components/DeckCardList.tsx)
- Strip + thumbnail draggables: [MaybeboardStrip.tsx](../../../app/decklist/card-search/components/MaybeboardStrip.tsx)
- Drag-end logic / collision detection: [DeckBuilderPanel.tsx — handleDragEnd, dndCollisionDetection](../../../app/decklist/card-search/components/DeckBuilderPanel.tsx)
- Original specs: [PR 2 + PR 3 design](2026-05-13-maybeboard-ui-and-dnd-design.md), [drop-ergonomics follow-up](2026-05-13-maybeboard-drop-ergonomics-and-tab-fix-design.md)
