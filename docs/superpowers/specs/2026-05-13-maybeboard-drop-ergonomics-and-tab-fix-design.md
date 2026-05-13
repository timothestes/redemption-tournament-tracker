# Maybeboard Drop Ergonomics + Reserve Tab-Drop Fix

**Status:** Draft — ready for implementation
**Created:** 2026-05-13
**Depends on:** PR 3 — `@dnd-kit` integration (already landed on `add-maybeboard`)
**Follow-up to:** [2026-05-13-maybeboard-ui-and-dnd-design.md](2026-05-13-maybeboard-ui-and-dnd-design.md)

---

## 1. Overview

Two problems surfaced when exercising the PR 3 drag-and-drop wiring end-to-end:

1. **Maybeboard is a small drop target.** The strip is 80px tall and anchored at the bottom of the deck panel. Dragging from a Main card near the top of a long list means traversing ~500px to a thin target — easy to miss.
2. **Reserve tab-drop silently aborts.** Dragging a Main card onto the Reserve tab trigger does not move the card. Root cause: `handleDragOver` calls `setActiveTab('reserve')` mid-drag, which unmounts the Main tab content (plain conditional render, not `forceMount`). The source draggable's DOM node disappears and `@dnd-kit` cancels the drag.

This spec addresses both with minimal surface area. No new dependencies.

## 2. Verified findings (Playwright)

- ✅ **Main → Maybeboard drag works.** Pointerdown on a Main card, pointermove past 6px activation, pointerup over the strip → card moves. Main 2→1, Maybeboard 0→1.
- ❌ **Main → Reserve via tab trigger fails.** Same pointer sequence with destination set to the Reserve tab button → no state change. Main 1, Reserve 0, Maybeboard 1 (unchanged).
- DOM verified: strip is `position: static`, anchored at panel bottom via flex layout. The `flex-1 overflow-y-auto overflow-x-hidden p-4` div inside the panel is the only internal scroll container; it sits *above* the strip, so on long deck lists the strip stays in view today. Sticky positioning is a defensive add, not a present-tense fix.

## 3. Part A — Maybeboard drop expansion during drag

### 3.1 What changes

`MaybeboardStrip.tsx` only.

1. **Read drag state via `useDndContext()`.** Pull `active` from `@dnd-kit/core`; treat `!!active` as "drag in progress."
2. **Grow during drag.** Animate the strip's `min-height` from `80px` → `160px` (desktop) / `120px` (mobile) using `transition-all duration-200`. Use a Tailwind responsive breakpoint:
   ```tsx
   className={cn(
     "...existing classes...",
     "transition-all duration-200",
     isDragging && "min-h-[120px] md:min-h-[160px]",
   )}
   ```
3. **"Drop here" overlay.** When `isDragging` and the active drag's `fromZone !== 'maybeboard'`, render a centered label overlaid on the thumbnail area:
   ```tsx
   <div className="absolute inset-x-0 bottom-2 flex items-center justify-center pointer-events-none">
     <span className="text-sm font-medium text-primary/90 bg-card/80 backdrop-blur px-3 py-1 rounded-md border border-primary/40 shadow-sm">
       Drop into Maybeboard
     </span>
   </div>
   ```
   The overlay is `pointer-events-none` so it doesn't interfere with the droppable. Hide it when `fromZone === 'maybeboard'` (silent no-op case).
4. **Stronger drop-over feedback.** Replace the existing `isOver` styling (`border-primary bg-primary/5`) with `border-2 border-primary bg-primary/15` for unmistakable landing feedback.
5. **Defensive sticky positioning.** Add `sticky bottom-0 z-10` to the section. No-op today (no scrolling ancestor) but cheap insurance for any future panel-layout change that introduces a scrolling ancestor. Pair with `bg-card/95 backdrop-blur` so any content peeking through during the not-yet-existent overflow case reads as overlapping content, not transparency artifacts.

### 3.2 Sketch

```tsx
// MaybeboardStrip.tsx
import { useDndContext, useDroppable } from "@dnd-kit/core";

export default function MaybeboardStrip(props: MaybeboardStripProps) {
  const { active } = useDndContext();
  const fromZone = active?.data.current?.fromZone as DeckZone | undefined;
  const isDragging = !!active;
  const isValidDrop = isDragging && fromZone !== 'maybeboard';

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: "zone:maybeboard",
    data: { zone: "maybeboard" as DeckZone },
  });

  return (
    <section
      ref={setDroppableRef}
      aria-label={...}
      className={cn(
        "sticky bottom-0 z-10 border-t bg-card/95 backdrop-blur flex-shrink-0",
        "transition-all duration-200 relative",
        isValidDrop && "min-h-[120px] md:min-h-[160px]",
        isOver ? "border-2 border-primary bg-primary/15" : "border-border",
      )}
    >
      {/* existing header + thumbnails */}
      {isValidDrop && (
        <div className="absolute inset-x-0 bottom-2 flex items-center justify-center pointer-events-none">
          <span className="text-sm font-medium text-primary/90 bg-card/80 backdrop-blur px-3 py-1 rounded-md border border-primary/40 shadow-sm">
            Drop into Maybeboard
          </span>
        </div>
      )}
    </section>
  );
}
```

### 3.3 Edge cases

- **Drag originates from the maybeboard.** `fromZone === 'maybeboard'`. Don't grow, don't show the overlay — the strip is the source. The card row stays draggable for cross-zone drag to main/reserve.
- **No active drag.** All new styling collapses to existing 80px static behavior.
- **Strip is collapsed** (`collapsed === true`). The collapsed header shows just the count; during drag, expand it automatically so the drop target is visible. Either auto-expand on drag start (preferred) or grow the collapsed bar to ~80px with the overlay alone. **Decision: auto-expand on drag start, restore prior state on drag end.** Read the `active` transition and set `collapsed` accordingly via an effect.

## 4. Part B — Fix Reserve tab-drop bug

### 4.1 What changes

`DeckBuilderPanel.tsx` only.

1. **Remove eager tab switch from `handleDragOver`.** Current code:
   ```ts
   const handleDragOver = useCallback((event: DragOverEvent) => {
     const overId = event.over?.id;
     if (overId === "tab:main") setActiveTab("main");
     else if (overId === "tab:reserve") setActiveTab("reserve");
   }, []);
   ```
   becomes:
   ```ts
   // No-op for tab targets — switching activeTab here would unmount the
   // source draggable (Main/Reserve are conditionally rendered) and abort
   // the drag. The tab trigger's `isOver` ring is sufficient feedback;
   // we switch activeTab after the drop completes (see handleDragEnd).
   const handleDragOver = useCallback((_event: DragOverEvent) => {}, []);
   ```
   We keep `handleDragOver` registered for future use (e.g., sortable feedback) but drop the side effect.

2. **Switch tab in `handleDragEnd` after a successful tab-drop.**
   ```ts
   const handleDragEnd = useCallback(
     (event: DragEndEvent) => {
       const active = event.active;
       const over = event.over;
       setActiveDragCard(null);
       if (!over) return;
       const fromZone = active.data.current?.fromZone as DeckZone | undefined;
       const card = active.data.current?.card as Card | undefined;
       if (!fromZone || !card) return;

       let toZone = over.data.current?.zone as DeckZone | undefined;
       const overId = String(over.id);
       const isTabDrop = overId.startsWith("tab:");
       if (!toZone) {
         if (overId.startsWith("zone:")) toZone = overId.slice(5) as DeckZone;
         else if (isTabDrop) toZone = overId.slice(4) as DeckZone;
       }
       if (!toZone || toZone === fromZone) return;

       handleMoveCard(card.name, card.set, fromZone, toZone);

       // After a tab-drop, switch the active tab to the destination so the
       // user sees their moved card land.
       if (isTabDrop && (toZone === "main" || toZone === "reserve")) {
         setActiveTab(toZone);
       }
     },
     [handleMoveCard]
   );
   ```

### 4.2 Why not force-mount Main + Reserve during drag

Considered: render both Main and Reserve tab content during drag with `display: none` on the inactive one, so unmount never happens. Rejected because:

- Heavier DOM (two card grids rendered simultaneously).
- More state complexity (tracking which is visually active vs which is DOM-mounted).
- The "preview destination zone before release" behavior from the original [PR 3 design §4.4](2026-05-13-maybeboard-ui-and-dnd-design.md) is a nice-to-have, not essential. The tab `isOver` ring already shows where the card will land.
- Simpler fix passes the same acceptance criteria.

If the post-drop tab-switch feels jarring in practice, we can revisit force-mount in a follow-up.

## 5. Files to change

| File | Change |
|---|---|
| `app/decklist/card-search/components/MaybeboardStrip.tsx` | Use `useDndContext`. Grow `min-height` + render "Drop into Maybeboard" overlay when dragging from a non-maybeboard source. Stronger `isOver` styling. Add `sticky bottom-0 z-10` + opaque-ish background. Auto-expand on drag start if collapsed; restore on drag end. |
| `app/decklist/card-search/components/DeckBuilderPanel.tsx` | Remove side effect from `handleDragOver`. In `handleDragEnd`, after a tab-drop move, set `activeTab` to the destination zone. |

## 6. Acceptance criteria

- [ ] Drag a Main card → strip expands to ≥120px (mobile) / 160px (desktop) within ~200ms
- [ ] "Drop into Maybeboard" label appears during drag from main/reserve, does NOT appear when dragging from a maybeboard thumbnail
- [ ] Drop onto the expanded strip moves the card; strip animates back to 80px
- [ ] `isOver` styling shows the strong border/background when cursor is over the strip
- [ ] Drag a Main card onto the Reserve tab trigger → card moves to Reserve, activeTab switches to Reserve (verified via Playwright pointer events)
- [ ] Drag a Reserve card onto the Main tab trigger → symmetric behavior
- [ ] Drag Maybeboard thumbnail onto Main/Reserve tab triggers → cards move, activeTab switches
- [ ] Strip remains anchored at panel bottom on long decks (no regression — verify with a 50-card deck)
- [ ] If strip was collapsed before drag, it auto-expands during drag and restores its collapsed state on drag end (or cancel)
- [ ] Mobile (≤640px width): expanded strip is ≤120px tall; doesn't push above MobileBottomNav

## 7. Risks

1. **Auto-expand-on-drag for collapsed strip + state restore.** Need to track the user's "pre-drag" collapsed state and restore it on `onDragEnd`/`onDragCancel`. If the drag is cancelled mid-flight (Escape, source unmounts), the restore must still run. Use an effect keyed on `isDragging` plus a ref for the prior state.
2. **`useDndContext()` outside the strip's own droppable.** The hook returns the same context as `useDroppable` uses — should be safe, but verify no infinite-render loop when `active` changes (React batches DnD updates, but a misconfigured `useEffect` could regress).
3. **Mobile drawer height.** The expanded strip + MobileBottomNav + safe-area inset = ~200px of bottom chrome on a short phone. Confirm the deck list above still has room to display cards during drag.
4. **Tab switch after drop feels delayed.** With the bug fix, the user drops on the Reserve tab and then sees the tab switch a frame later. Could feel slightly less responsive than the original "switch on hover" behavior. Mitigation: ensure the transition is instant (no animation on the tab switch itself; only the strip animates).

## 8. Out of scope

- Force-mount-during-drag approach to preserve the "preview destination zone" UX. Revisit if §7.4 turns out to feel bad in practice.
- Edge auto-scroll during drag (cursor near bottom of panel auto-scrolls the deck list). Separate consideration.
- Search-grid → deck-zone drag. Still deferred per PR 3 §4.11.

## 9. Validation plan

Use the same Playwright pointer-event helper from verification (see commit history for the `__dragTest` snippet). Cover:

1. Main → Maybeboard (regression)
2. Main → Reserve via tab trigger (bug fix verification)
3. Reserve → Main via tab trigger
4. Reserve → Maybeboard
5. Maybeboard → Main via tab trigger
6. Maybeboard → Reserve via tab trigger
7. Strip starts collapsed → drag begins → strip expanded → drop completes → strip recollapsed
8. Drag from maybeboard → strip does NOT grow or show "Drop into Maybeboard" overlay
