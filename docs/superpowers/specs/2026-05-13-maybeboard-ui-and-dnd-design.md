# Maybeboard UI, DnD, and Import/Export Design

**Status:** Draft — ready for implementation
**Created:** 2026-05-13
**Depends on:** PR 1 — `is_reserve` → `zone` schema refactor (already landed)
**Tracks:** PR 2 — Maybeboard UI + import/export · PR 3 — `@dnd-kit` integration

---

## 1. Overview

### What maybeboard is
A **scratchpad of cards the user is considering** while deckbuilding. Maybeboard is a *visual layer*, not a competition-grade deck zone. PR 1 already shipped the schema (`zone TEXT IN ('main', 'reserve', 'maybeboard')`) and the boundary filters that keep maybeboard cards out of:

- Deck legality (filtering done at call sites: `useDeckCheck`, save-time `app/decklist/actions.ts`)
- Tournament publication (`tracker/tournaments/actions.ts`)
- Game state (multiplayer `play/actions.ts`, single-player `goldfish/[deckId]/page.tsx`)
- Deck price totals (Postgres functions `get_deck_total_prices`, `get_deck_budget_prices`)
- Shopify purchase totals (`BuyDeckModal`)
- Paragon brigade requirements + Dominant copy limits + Type 2 alignment balance
- Public deck preview cover-card auto-selection

**Invariant going forward:** maybeboard rows exist in the `deck_cards` table but are excluded from every downstream consumer except the deckbuilder UI itself and the public deck view's display. Any new feature must default to filtering them out.

### What maybeboard is *not*
- It is **not** legal/illegal in any format — it has no copy limits, no paragon rules, no min/max size.
- It is **not** part of the deck for play (goldfish, multiplayer, or tournament submission).
- It is **not** part of deck pricing or "buy this deck."
- It is **not** the place to track tokens (tokens are auto-computed on export from main+reserve cards).

### Success criteria
A user can:
1. Drop a card into maybeboard from anywhere (search column tile, modal, existing main/reserve card via context menu, drag).
2. See their maybeboard list at-a-glance across all deck panel tabs.
3. Move cards from maybeboard into main or reserve by drag or button click.
4. Save the deck and see maybeboard persist across reloads, copies, and public sharing.
5. Export the deck as `.txt` with maybeboard cards in the `Tokens:` section and re-import it without loss.
6. View someone else's public deck and see their maybeboard as a secondary section.

---

## 2. Locked-in decisions (from prior brainstorm)

| Decision | Choice | Rationale |
|---|---|---|
| DnD library | `@dnd-kit/core` + `@dnd-kit/sortable` | First-class touch/keyboard sensors, ~10kb, no a11y reinvention. Touch reliability matters at tournament tables. |
| Drag scope | Within deck panel only (main ↔ reserve ↔ maybeboard strip) | Search → deck stays click-based. Cross-pane drag is structurally impossible on mobile (drawer hides search). Two clear interaction models beats one ambiguous one. |
| Maybeboard quantity | Counted, 1-4 with stepper badge | Players ask "should I run 2 or 3?" — the count is the entire reason maybeboard exists. Reuses the existing stepper component. No copy cap enforced. |
| Empty-state strip | Always visible (~64px), with hint copy | Stable drop target for DnD. Prevents layout shift against the resizable panel. Discoverable. |
| Cross-tab drop | Tab bar transforms into drop zones during drag (`useDroppable` on tab triggers) | Discoverable, instant, accessible via KeyboardSensor. Hover-dwell is an a11y anti-pattern. |
| Export format | Maybeboard cards merge into the existing `Tokens:` section | Per user instruction. No new file format marker. |
| Public visibility | Visible in `FullDeckView`, visually muted as a secondary column | Public, but reads as "considering" not "running." |

---

## 3. PR 2 — Maybeboard UI + import/export (no DnD yet)

PR 2 ships the maybeboard as a working feature with **click-only** interaction. PR 3 layers DnD on top. This split keeps PR 2 reviewable (no library install) and isolates the DnD risk.

### 3.1 The maybeboard strip

A persistent horizontal scrolling row of mini-thumbnails pinned to the bottom of the deck panel, **always visible across all four tabs** (`main` / `reserve` / `info` / `cover`). Note: "stats" content (type/brigade breakdown) is still rendered conditionally inside the `main` and `reserve` tabs — there is no dedicated Stats tab.

**Layout target:**
- Height: 80px on desktop, 72px on mobile (in drawer)
- Width: 100% of the panel; horizontal scroll when overflowing
- Card thumbnails: ~48px wide × full strip height, aspect-ratio cropped
- Stepper badge: overlays the thumbnail bottom-right, identical visual to the existing Main/Reserve list quantity badge
- Header bar: `Maybeboard (12) (?) →` — clicking `(N)` toggles collapse/expand (see §3.8 graduation note); `(?)` opens an info tooltip with copy *"A scratchpad for cards you're considering. Not part of your deck."*; `→` arrow appears only when the strip overflows horizontally
- Overflow affordance: when the strip overflows, render a subtle right-edge gradient fade (mask-image) plus the `→` arrow indicator next to the header count to signal scrollability

**ASCII mockup:**
```
╔═══════════════════════════════════════════════════╗
║  main │ reserve │ info │ cover                   ║
╠═══════════════════════════════════════════════════╣
║                                                   ║
║   (current tab content scrolls here)              ║
║                                                   ║
║                                                   ║
╠═══════════════════════════════════════════════════╣
║ Maybeboard (3)                                    ║  ← header bar
║ ┌──┐ ┌──┐ ┌──┐ ┌──┐                              ║  ← strip
║ │×2│ │×1│ │×3│ │×1│  ←scrollable→                ║
║ └──┘ └──┘ └──┘ └──┘                              ║
╚═══════════════════════════════════════════════════╝
```

**Empty state:**
```
╠═══════════════════════════════════════════════════╣
║ Maybeboard (0)                                    ║
║ ▢ Cards you're considering will appear here       ║
║   Click "Move to maybeboard" on any card          ║
╚═══════════════════════════════════════════════════╝
```

The empty state uses a muted dashed border to read as a "drop zone" hint (which it will be once PR 3 lands), but in PR 2 it's purely informational.

### 3.2 Card interactions in PR 2

| Surface | Action | Behavior |
|---|---|---|
| Search result tile (left column) | New context-menu item "Add to maybeboard" | Adds 1 copy at `zone: 'maybeboard'` |
| `ModalWithClose` (card detail modal) | New button "Add to maybeboard" in the action row, alongside "Main"/"Reserve" | Adds 1 copy |
| Main/Reserve card row in `DeckCardList` | New context-menu item "Move to maybeboard" | Removes from current zone, adds to maybeboard |
| Maybeboard strip thumbnail | Tap/click | Opens `ModalWithClose` in maybeboard context |
| Maybeboard strip thumbnail | Long-press / right-click | Context menu: "Move to main", "Move to reserve", "Remove" |
| Maybeboard strip stepper badge | Tap +/− | Increment/decrement quantity (no copy cap) |
| Maybeboard strip header `(N)` | Tap | Toggle strip collapse/expand. Collapsed state shows just `Maybeboard (N) ▸`; expanded shows the thumbnails. Collapse state persists per-deck in local state. |

### 3.3 Public visibility in `FullDeckView`

In the public deck page (`app/decklist/[deckId]/client.tsx`), render maybeboard as a **third section after Reserve**, visually muted (lower opacity, italic header):

- Grouped mode (current side-by-side layout): Reserve sidebar gets a Maybeboard sub-section below it. Section header reads **"Considering"** with a small `(?)` info tooltip — *"A scratchpad — not part of the deck."*
- Stacked mode: Maybeboard section after Reserve with the same **"Considering"** header and `(?)` tooltip.

Use "Considering" as the public-facing label in both layouts. Reserve "Maybeboard" as the in-builder term.

Maybeboard cards in the public view:
- Click to open card detail modal: yes
- Count toward deck size: no
- Show in OG image / preview: no — already filtered out in [page.tsx:22-24](app/decklist/%5BdeckId%5D/page.tsx#L22-L24)

**Pre-existing filter comments to revise during this work:**
- `app/decklist/card-search/components/FullDeckView.tsx:146-147` has an "intentionally excluded" comment for maybeboard — remove/revise when the in-builder preview tab renders the new Maybeboard section.
- `app/decklist/[deckId]/client.tsx:366-367` currently filters only main/reserve — this must be revised to include the public Maybeboard "Considering" section.

### 3.4 Import/export — the `Tokens:` round-trip

**Background:** the current export ([deckImportExport.ts](app/decklist/card-search/utils/deckImportExport.ts)) auto-calculates a `Tokens:` section from cards in main+reserve that *generate* tokens (Heavenly Host, Two Possessed, etc.) using `CARD_TO_TOKEN_MAP`. These are game tokens (physical play pieces), not deck-list entries.

Per the user's decision, maybeboard cards also export under `Tokens:`. We need to make the round-trip clean. We use a **two-layer scheme**: explicit comment markers (primary signal) plus a normalized auto-token name set (fallback for files exported by older clients or hand-edited).

**Export (`generateDeckText`, `generateDeckTextBySet`):**
Emit `# auto-generated` before the auto-token block and `# maybeboard` before the maybeboard block, both inside the `Tokens:` section:
```
Main cards...
Reserve:
Reserve cards...
Tokens:
# auto-generated
7	Heavenly Host Token       ← auto-generated game token
7	Wicked Spirit Token       ← auto-generated game token
# maybeboard
2	Faith                     ← maybeboard card (quantity carries over)
1	Hope                      ← maybeboard card
```
Auto-tokens appear first (alphabetical) under `# auto-generated`, then maybeboard cards (alphabetical) under `# maybeboard`.

**Import (`parseDeckText`) — two-layer routing:**

1. **Primary signal: comment markers.** Parse `#`-prefixed lines as section markers. Lines after `# maybeboard` route to `zone: 'maybeboard'`. Lines after `# auto-generated` (or before any marker, for backward compat with old exports) are treated as auto-tokens.
2. **Auto-token check (fallback for unmarked lines).** Flatten the values of `CARD_TO_TOKEN_MAP` by splitting each value on `|` (some entries are pipe-delimited variants), then normalize via the existing `normalizeCardName` helper (lowercase + apostrophe normalization). If the line's normalized name matches any entry in this flattened set, **skip** — it'll be regenerated on next export.
3. **Best-effort fallback.** Anything that doesn't match an auto-token name AND isn't behind a `# maybeboard` marker falls back to a card-database lookup → if found, add to maybeboard with a warning (matching today's unknown-card behavior); if not found, warn and skip.

**Why filter out auto-tokens on import:**
A user exporting then re-importing should not end up with `Heavenly Host Token` in their maybeboard. Auto-tokens are derived; they're not real catalog cards and don't have valid card data. Filtering them ensures the round-trip is idempotent.

**Edge case:** A user manually adds `Heavenly Host Token` to their maybeboard via the UI. With the `# maybeboard` marker, the new export correctly routes it on re-import. Older exports (no markers) will still strip it as an auto-token — acceptable loss for the legacy path, and the marker scheme eliminates the collision for any export produced after PR 2 ships.

### 3.5 Files to modify (PR 2)

| File | Change |
|---|---|
| `app/decklist/card-search/components/DeckBuilderPanel.tsx` | Add the maybeboard strip below the tab content (before the `</Card>` close). Pass through `onAddToMaybeboard` handler. |
| `app/decklist/card-search/components/MaybeboardStrip.tsx` *(new)* | The horizontal-scroll strip component. ~150 lines. |
| `app/decklist/card-search/components/DeckCardList.tsx` | Add a new "Move to maybeboard" menu/button entry in **both** the grid render path (around line 184) and the list render path (around line 723). The existing `onMoveCard(name, set, fromZone, toZone)` signature already accepts any zone pair — no callback changes needed. Note the current button hardcodes `isReserve ? 'main' : 'reserve'`; the new entry passes `'maybeboard'` as the destination. |
| `app/decklist/card-search/client.tsx` | Add "Add to maybeboard" menu item to search result tiles. The relevant context is the `openSearchMenuCard` state (around lines 336–352) — add the new entry alongside the existing "Add to main" / "Add to reserve" entries. |
| `app/decklist/card-search/ModalWithClose.tsx` | Add a **third action group** to the action row alongside Main (blue) and Reserve (amber). The row uses button *groups* (an add button + a decrement button per zone), not single buttons — the Maybeboard group mirrors this structure (`+`/`−`) and picks a distinct accent color (e.g., violet/purple). The **mobile bottom-sheet variant** of the same modal has its own action row that also needs the same third group added. |
| `app/decklist/card-search/utils/deckImportExport.ts` | Implement the `Tokens:` round-trip per §3.4. |
| `app/decklist/[deckId]/client.tsx` | Render Maybeboard section in public view (grouped + stacked layouts). |
| `app/decklist/card-search/components/FullDeckView.tsx` | Same for the in-builder preview tab. |
| `app/decklist/card-search/hooks/useDeckState.ts` | No signature changes — `addCard(card, 'maybeboard')` already works. |

### 3.6 Mobile considerations

- Strip stays pinned to the bottom of the deck drawer and **must sit above `MobileBottomNav`** using the same offset pattern used elsewhere in the codebase: `bottom-[calc(3.5rem+env(safe-area-inset-bottom))]`.
- Horizontal touch scroll works natively — no library needed.
- **Long-press for context menu (300ms).** The codebase has no existing long-press hook today; PR 2 introduces a small `useLongPress` utility (or inlines `pointerdown`/`pointerup` + timer in the strip component).
- Tap a thumbnail to open `ModalWithClose` in maybeboard context.

**Migration note (long-press collides with PR 3 drag activation):** PR 3's TouchSensor activates at 200ms long-press, which would collide with PR 2's 300ms context-menu long-press. The migration:
- **PR 2:** long-press on a strip thumbnail opens the context menu.
- **PR 3:** long-press is reassigned to drag activation. The strip thumbnail context menu moves to a small overflow affordance (`⋯`) rendered on each thumbnail (visible on hover desktop / always visible mobile).

### 3.7 PR 2 acceptance criteria

- [ ] Add a card to maybeboard via search-tile menu, modal button, and main-card context menu
- [ ] Maybeboard strip shows the card with quantity 1, then 2 after re-add
- [ ] Strip stays visible across all four tabs (`main` / `reserve` / `info` / `cover`)
- [ ] Maybeboard cards don't appear in type or brigade breakdowns, legality, validation, BuyDeck totals, or preview thumbnails (regression check). (`getDeckStats` exposes `maybeboardCount` as a top-level field but correctly excludes maybeboard from `cardsByType` / `cardsByBrigade`.)
- [ ] Save deck → reload → maybeboard persists with correct quantities
- [ ] Export deck → file has maybeboard cards under `Tokens:` after any auto-generated tokens, with `# auto-generated` and `# maybeboard` comment markers (§3.4)
- [ ] Import that exported file → maybeboard cards restored; auto-tokens are skipped on import
- [ ] Public deck page shows maybeboard as a muted secondary section labeled **"Considering"** with `(?)` tooltip
- [ ] On mobile, strip is reachable inside the drawer without breaking layout and sits above `MobileBottomNav` using the `bottom-[calc(3.5rem+env(safe-area-inset-bottom))]` offset
- [ ] All existing tests still pass (run `vitest`)

**Accessibility:**
- [ ] Strip is wrapped in `<section aria-label="Maybeboard, N cards">` with `N` reflecting current count
- [ ] Quantity changes (add/remove/+/−) are announced via a polite `aria-live` region
- [ ] Keyboard support on a focused thumbnail: `+` and `−` increment/decrement the stepper; `Shift+F10` or the `Menu` key opens the context menu

### 3.8 Stretch goals (defer to PR 2.5 if scope creeps)

- ~~Collapse/expand strip header~~ — **promoted to PR 2 scope** (see §3.2: tapping the `(N)` header toggles collapse/expand)
- Sort options for the strip (by name, by type, by addition order — default: addition order)
- Hide-when-empty toggle in deck settings

---

## 4. PR 3 — `@dnd-kit` integration

PR 3 adds drag-and-drop *between zones inside the deck panel*. Search → deck stays click-based.

### 4.1 Install

```bash
npm install @dnd-kit/core@^6.3 @dnd-kit/sortable @dnd-kit/utilities
```

Three packages, ~14kb gzipped total. `@dnd-kit/core` is pinned to `^6.3` (React 19 compatibility floor). Strict-mode safe with React 19.

### 4.2 Architecture

**One top-level `<DndContext>` wraps the deck panel.** It needs the deck state in scope so `handleDragEnd` can call `addCard`/`removeCard`. Place it in `DeckBuilderPanel.tsx` at the root return.

```tsx
import { DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor, useSensors, useSensor } from '@dnd-kit/core';

const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  useSensor(KeyboardSensor),
);

<DndContext
  sensors={sensors}
  onDragStart={handleDragStart}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
>
  {/* tabs + tab content + maybeboard strip */}
  <DragOverlay>{activeId ? <DraggedCardGhost ... /> : null}</DragOverlay>
</DndContext>
```

**Activation constraints:**
- Pointer: 6px distance — prevents accidental drag on click-intended interactions
- Touch: 200ms delay + 5px tolerance — long-press feel, doesn't fight scroll
- Keyboard: arrow keys to traverse droppables, Enter to commit

**Portal caveat:** `@dnd-kit` does not traverse React portal boundaries. Any portal-rendered draggable (e.g., a card inside the hover-preview portal) must not be wrapped by the same `<DndContext>` — it won't see the context and drag will silently no-op. Modals opened from drag sources (e.g., `ModalWithClose`) are fine because the drag completes before the modal opens.

### 4.3 Droppable zones

Four droppables — three permanent (the zones) and two synthesized while dragging (the `main` / `reserve` tab triggers). Only `main` and `reserve` are zone-targetable from a tab trigger — `info` and `cover` are inert during drag and **not** drop targets.

| Droppable id | Where | When active |
|---|---|---|
| `zone:main` | `main` tab content area | Always |
| `zone:reserve` | `reserve` tab content area | Always |
| `zone:maybeboard` | The maybeboard strip | Always |
| `tab:main`, `tab:reserve` | The `main` and `reserve` tab triggers themselves | Only during an active drag — see §4.4 |

Each card row in Main/Reserve and each thumbnail in the maybeboard strip is a **draggable** with `id = '{zone}:{cardName}|{cardSet}'`.

### 4.4 Cross-tab drop UX

Decided pattern: **tab bar transforms into drop zones during drag**.

- `onDragStart`: set `isDragging = true` state, which conditionally wraps the `main` and `reserve` tab triggers in `useDroppable({ id: 'tab:main' })` and `useDroppable({ id: 'tab:reserve' })`.
- While dragging, the `main` / `reserve` tab triggers get a highlighted ring (e.g., `ring-2 ring-primary/60`) and the underline indicator is replaced by a "drop here" treatment.
- The `info` and `cover` tab triggers are **inert during drag**: visibly dimmed (e.g., `opacity-40 pointer-events-none`), not wrapped in `useDroppable`, and ignore drop events. Only `main` and `reserve` light up.
- `onDragOver` with a `tab:*` target: switch `activeTab` immediately so the user sees the destination zone before releasing.
- `onDragEnd` on a `tab:*` target: treat as a drop on the corresponding `zone:*` droppable.

This avoids hover-dwell timers and makes the drop targets keyboard-discoverable.

### 4.5 Drag affordances

- **Cursor**: `grab` on hover, `grabbing` during drag (handled by `@dnd-kit` defaults)
- **DragOverlay**: ghost of the card image at 60% opacity following the pointer
- **Drop zone highlights**: each `useDroppable` exposes `isOver` — apply a subtle `bg-primary/5 ring-1 ring-primary/30` style when true
- **Snap-back animation**: `@dnd-kit` handles this when `onDragEnd` returns without resolving the drop
- **Invalid drop feedback**: drop on a zone the card is already in → no-op (no toast — silent)

### 4.6 Drop semantics

| Source zone | Drop target | Behavior |
|---|---|---|
| `main` | `reserve` | Move 1 copy (decrement source, increment target). Existing main copies stay. |
| `main` | `maybeboard` | Same — move 1 copy. |
| `reserve` | `main` | Move 1 copy. |
| `reserve` | `maybeboard` | Move 1 copy. |
| `maybeboard` | `main` | Move 1 copy. |
| `maybeboard` | `reserve` | Move 1 copy. |
| Any | Same zone | No-op. |

**No existing `handleMoveCard` helper exists today.** The current pattern in the codebase is two calls: `removeCard(name, set, fromZone)` followed by `addCard(card, toZone)`. PR 3 introduces a unified helper — call it `handleMoveCard(card, fromZone, toZone)` (or similar) — that wraps those two calls and is shared by drag-end handlers, the "Move to maybeboard" menu entries, and the existing reserve/main toggle.

**Shift-drag = move all copies (stretch goal):** standard MtG-tool convention. Detect via `event.activatorEvent.shiftKey` in `handleDragEnd`. Default to single-copy move.

### 4.7 Mobile/touch behavior

- TouchSensor delay (200ms) means a quick tap still functions as tap (open modal), while a long-press initiates drag.
- Strip scrolling is preserved because the activation distance trips before the scroll gesture.
- On mobile, the deck drawer takes the full viewport; tab bar drop targets remain accessible.
- **Reassignment from PR 2:** PR 2's 300ms long-press for the strip thumbnail context menu is replaced by drag activation. The strip-thumbnail context menu moves to a small overflow affordance (`⋯`) rendered on each thumbnail. See §3.6.

### 4.8 Keyboard support

`@dnd-kit`'s KeyboardSensor exposes a standard pattern:
- Tab to a draggable card row → press Space to pick up
- Arrow keys traverse droppables (Main → Reserve → Maybeboard cycle)
- Space again to drop, Escape to cancel

Announce via `accessibility.screenReaderInstructions` for screen reader support — `@dnd-kit` provides this out of the box; we just supply the messages.

### 4.9 Files to modify (PR 3)

| File | Change |
|---|---|
| `package.json` | Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |
| `app/decklist/card-search/components/DeckBuilderPanel.tsx` | Wrap content in `<DndContext>`, add sensors, drop handlers, DragOverlay, conditional tab droppables during drag |
| `app/decklist/card-search/components/DeckCardList.tsx` | Each card row becomes `useDraggable`. Wrap whole list area in `useDroppable` for the zone target. |
| `app/decklist/card-search/components/MaybeboardStrip.tsx` *(from PR 2)* | Each thumbnail becomes `useDraggable`. Strip is a `useDroppable` for `zone:maybeboard`. |
| `app/decklist/card-search/components/DragGhost.tsx` *(new)* | Visual for the `<DragOverlay>` — just renders the card image. |
| `app/decklist/card-search/hooks/useDeckDnd.ts` *(new, optional)* | Extracts sensor + handler logic to keep `DeckBuilderPanel` from growing. |

### 4.10 PR 3 acceptance criteria

- [ ] Drag a card from Main onto the Reserve tab trigger → it moves to Reserve and the tab switches
- [ ] Drag from any zone to any other zone (5 combinations) → 1 copy moves
- [ ] Drag works on iPhone Safari and Android Chrome (200ms long-press)
- [ ] Keyboard-only flow: tab to card, space to pick up, arrow to zone, space to drop
- [ ] Screen reader announces drag start/over/end events
- [ ] No regression in scroll: vertical scroll of card lists + horizontal scroll of strip both work without triggering drags
- [ ] DragOverlay ghost appears and follows pointer
- [ ] Drop on same zone is a silent no-op
- [ ] Existing click handlers (stepper, remove, view card) still work — drag activation distance is right

### 4.11 Out of scope for PR 3 (defer)

- Drag from search column → deck (huge mobile UX implications; users have click-to-add already)
- Drag to remove (a "trash" drop zone)
- Multi-select drag (shift-click then drag)
- Reorder within a zone (the deck panel groups by type, so manual ordering would fight that)
- Sortable within the maybeboard strip (deferred to PR 2.5 stretch)

---

## 5. Open questions

These are decisions we'd benefit from making before/during implementation, not after.

1. **Maybeboard quantity cap.** **Decided: no cap.** The existing main/reserve UI quietly enforces a soft 4-copy display cap on the stepper; the maybeboard stepper allows `+` past 4. *Optional polish (not a requirement):* when count > 4 on a non-Dominant card, render a subtle informational label (e.g., a small "over 4" hint) — this is taste-call only and does not block anything.

2. **Maybeboard in deck description / share URL.** Today, the deck description ([Deck.description](app/decklist/card-search/types/deck.ts#L?)) is a free-text field. Should we keep maybeboard *out* of any sharing-summary string, or include `"+ N considering"` next to "+ N reserve"? Recommend: include it on the public deck page only, not in `/decklist/[deckId]/page.tsx` OG description.

3. **Empty-state hint copy.** Options:
   - "Cards you're considering will appear here"
   - "Drag or use the menu to add cards" (PR 3 — preserves discoverability of both the drag *and* click paths)
   - "Click 'Move to maybeboard' on any card"
   Recommend: option 3 for PR 2, swap to option 2 in PR 3.

4. **Should the strip be hideable per user?** A power user might never use maybeboard and want the 64px back. Add a toggle in deck settings? Recommend: defer to PR 2.5 stretch; ship without a hide toggle.

5. **Mobile: replace the strip with a tab?** Given mobile vertical space is precious, an alternative on mobile only is to make Maybeboard a 5th tab. Recommend: **no** — kills the cross-tab glance-ability that's the whole point of the strip. Eat the 72px.

6. **Search column maybeboard filter chip?** Should the search results have a "Show only my maybeboard" filter? Recommend: defer; this is a power-user feature that's not core to the maybeboard concept.

---

## 6. Risks

1. **Strip + tab content layout math.** Adding 80px to the bottom of the deck panel means the tab content's `max-height` calc has to update. The panel is already resizable — verify the strip doesn't fight the resize handle.
2. **DnD library + React 19.** `@dnd-kit` is React 19-compatible as of 6.x, but verify no strict-mode double-invocation issues with the sensors during dev.
3. **Touch scroll conflicts.** Horizontal scroll of the strip + vertical scroll of the tab content + DnD touch sensor on both — the activation constraints in §4.2 should prevent conflicts, but mobile testing is mandatory.
4. **Export round-trip and auto-tokens.** The `# auto-generated` / `# maybeboard` marker scheme (§3.4) eliminates the collision for any export produced after PR 2 ships — the markers are an explicit routing signal on import. Only legacy exports (no markers) fall back to the CARD_TO_TOKEN_MAP filter; in that path, a manually-added "Heavenly Host Token" in maybeboard is silently stripped. Acceptable for the legacy path; document in code comment.
5. **Public deck OG previews.** Verify maybeboard cards do not get auto-selected as cover thumbnails. Already filtered in PR 1 — write a regression test as part of PR 2.
6. **Goldfish / multiplayer interaction.** Out of scope: live sync between an open goldfish or multiplayer session and concurrent deck edits in the builder. A user editing their maybeboard while a goldfish tab is open will not see the goldfish session update; reload is required. (Maybeboard is already excluded from game state, so this is purely a refresh-staleness concern, not a correctness one.)

---

## 7. Sequencing

```
PR 1 (DONE)  →  PR 2 (UI + import/export, no DnD)  →  PR 3 (DnD)
```

PR 2 and PR 3 are deliberately sequential. PR 2 ships a fully functional maybeboard with click-only interaction; users can use it day one. PR 3 layers DnD on top without changing data shape or behavior — pure UX upgrade.

If PR 3 hits a blocker (mobile DnD bugs, library issue), we can ship PR 2 alone and revisit drag later. The reverse — shipping DnD without the underlying UI — is impossible.

---

## 8. Appendix: data model recap (post-PR 1)

```ts
// app/decklist/card-search/types/deck.ts
export type DeckZone = 'main' | 'reserve' | 'maybeboard';

export interface DeckCard {
  card: Card;
  quantity: number;
  zone: DeckZone;
}

export interface DeckStats {
  mainDeckCount: number;
  reserveCount: number;
  maybeboardCount: number;  // ← added in PR 1
  uniqueCards: number;
  cardsByType: Record<string, number>;
  cardsByBrigade: Record<string, number>;
}
```

```sql
-- supabase/migrations/028
deck_cards.zone TEXT NOT NULL DEFAULT 'main'
  CHECK (zone IN ('main', 'reserve', 'maybeboard'))

UNIQUE (deck_id, card_name, card_set, zone)
INDEX idx_deck_cards_zone ON (deck_id, zone)
```

```ts
// useDeckState.ts — already accepts zone everywhere
addCard(card: Card, zone: DeckZone = 'main')
removeCard(name: string, set: string, zone: DeckZone = 'main')
updateQuantity(name, set, quantity, zone: DeckZone = 'main')
getCardQuantity(name, set, zone: DeckZone = 'main')
```
