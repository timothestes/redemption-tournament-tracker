# Play Mode Bug Batch — Design Spec

**Date:** 2026-03-25
**Scope:** 12 independent bug fixes in the multiplayer play mode canvas

---

## Bug 1: Context menu hidden below preview loupe

**Problem:** Right-clicking a discard pile card opens the context menu (`zIndex: 900`), but the hover preview tooltip (`zIndex: 1000` in `CardPreviewSystem.tsx:89`) renders on top, obscuring the menu.

**Fix:** Clear `hoveredInstanceId` and `hoveredCard` when opening any context menu. In `handleCardContextMenu` (MultiplayerCanvas.tsx:1138), add `setHoveredInstanceId(null)` and `stopHoverAnimation()` at the top of the handler, before computing menu position.

**Files:** `MultiplayerCanvas.tsx` (handleCardContextMenu)

---

## Bug 2: Can't drag opponent territory cards

**Problem:** Opponent territory cards have `isDraggable={false}` and noop drag handlers (MultiplayerCanvas.tsx:1654-1658). Players need to move opponent territory cards during gameplay (capturing heroes, rescuing lost souls, etc.).

**Fix:** Make opponent territory `GameCardNode` instances draggable:
- Set `isDraggable={true}` on opponent free-form zone cards
- Wire up `handleCardDragStart`, `handleCardDragMove`, `handleCardDragEnd`
- The drag-end handler's `findZoneAtPosition` already resolves `hit.owner` as `'my'` or `'opponent'`. When moving an opponent territory card to a player zone, use the existing `moveCard` / `moveCardsBatch` reducers (the SpacetimeDB module already handles cross-player card moves for territory — territory is public information, unlike deck/reserve which require `requestZoneSearch`).

**Coordinate handling:** Opponent territory cards are rendered with 180° rotation and mirrored positions (`1 - posX`, `1 - posY`). During drag:
- The card node is moved to the Layer root (escaping the clip group), so absolute stage coordinates are used during drag — same as player card drags.
- On drop, the position normalization uses the **target** zone rect, not the source. If dropping into a player zone, no mirroring is needed. If dropping back into opponent territory, re-mirror the position before sending to the server.

**Prerequisite check:** Verify that the SpacetimeDB `move_card` reducer accepts moves where the card belongs to the opponent and the target zone belongs to the current player (or vice versa). If it's gated to same-player only, a new `move_opponent_territory_card` reducer is needed that allows moves for cards in public (non-hidden) zones without a `requestId`.

**Files:** `MultiplayerCanvas.tsx` (opponent territory rendering, ~line 1640-1668), potentially `useGameState.ts` and SpacetimeDB module

---

## Bug 3: Opponent reserve modal thinner than player's

**Problem:** `OpponentBrowseModal` has different internal layout/padding compared to `ZoneBrowseModal`, making it visually narrower.

**Fix:** Audit both modals and unify:
- Both should use the same `maxWidth`, `width`, card grid column count, card sizing, and internal padding
- The difference is likely in the card grid or wrapper styling. `OpponentBrowseModal` may have extra padding or fewer grid columns.

**Files:** `ZoneBrowseModal.tsx`, `OpponentBrowseModal.tsx`

---

## Bug 4: Opponent reserve should require zone search request

**Problem:** Clicking an opponent's reserve pile opens the browse modal directly (MultiplayerCanvas.tsx:2005-2010) without requiring opponent consent. Reserve is hidden information and should use the same request flow as deck search.

**Fix:** Change the click handler for opponent reserve:
- Remove the direct `setBrowseOpponentZone` call for reserve
- Instead, trigger `requestZoneSearch('reserve')` → show "Waiting for opponent to approve..." toast → on approval, open `OpponentBrowseModal`
- The right-click context menu path already supports this (lines 2011-2028 include `'reserve'` in the context menu trigger). The click path just needs to match.
- Keep direct browse for non-hidden zones (discard, banish, LOR — these are public information).

**Files:** `MultiplayerCanvas.tsx` (opponent pile click handler, ~line 2005-2010)

---

## Bug 5: Opponents can see face-down card details on hover

**Problem:** The hover preview system (`CardPreviewSystem.tsx`) shows card images/details for all cards regardless of `isFlipped` state. Opponents can hover over face-down cards in play and see what they are.

**Fix:** Gate the hover preview on card visibility:
- In `handleMouseEnter` (MultiplayerCanvas.tsx:1176), check if the card belongs to the opponent AND `card.isFlipped === true`. If so, don't set `hoveredCard` (skip the preview entirely).
- Also check in `CardPreviewSystem.tsx` / `CardLoupePanel.tsx`: if the hovered card is flipped, show the card back instead of the card image.
- The `GameCard` type already has `isFlipped: boolean`. Need to also track card ownership (player vs opponent) — pass this through the `HoveredCardInfo` interface or check against the game state.

**Files:** `MultiplayerCanvas.tsx` (handleMouseEnter), `CardPreviewSystem.tsx`, `CardLoupePanel.tsx`

---

## Bug 6: Reserve sorting

**Problem:** Reserve cards are not sorted when the browse modal opens. Players want cards sorted by type then name (like goldfish mode).

**Fix:** `ZoneBrowseModal.tsx` already has reserve sorting logic (lines 150-153):
```typescript
const cards = zoneId === 'reserve'
  ? [...rawCards].sort((a, b) => a.type.localeCompare(b.type) || a.cardName.localeCompare(b.cardName))
  : rawCards;
```
- Verify this sorting is active when the modal opens in multiplayer mode. The issue may be that the `zoneId` value doesn't match `'reserve'` exactly (could be a key mismatch).
- Also ensure `OpponentBrowseModal` applies the same sorting for opponent reserve.

**Files:** `ZoneBrowseModal.tsx`, `OpponentBrowseModal.tsx`

---

## Bug 7: Lost soul type filtering not working in deck search

**Problem:** In `DeckSearchModal`, only name filtering appears to work. Type filtering (including "Lost Soul") doesn't match correctly.

**Root cause:** The `matchesSearch` function (DeckSearchModal.tsx:166-186) uses `c.type.toLowerCase().includes(t)` for type filtering. Lost souls may be stored as `'LS'` (abbreviation) rather than `'Lost Soul'`, so typing "lost soul" in the type filter won't match `'LS'`.

**Fix:**
- Check how card types are stored in the game state (likely `'LS'`, `'Lost Soul'`, or similar). The goldfish reducer uses: `card.type === 'LS' || card.type === 'Lost Soul'` (gameReducer.ts:14).
- Add a normalization map in `matchesSearch` that expands abbreviations, OR add a special case: if searching for "lost soul" and the card type is `'LS'`, match it.
- Better approach: normalize the type display in the search UI so the field selector for "Type" shows human-readable types. Consider adding a type dropdown instead of free-text, matching the full set of card types in the deck.

**Files:** `DeckSearchModal.tsx` (matchesSearch function, search field UI)

---

## Bug 8: Territory label text collides with count badge

**Problem:** Territory zone labels (e.g., "LAND OF BONDAGE") and LOB labels overflow into the count badge. The label width is estimated at `7px * charCount` but has no actual width constraint. Screenshot confirms collision on both territory and LOB labels.

**Fix:** Constrain the label Text element:
- Set `width={zone.width - badgeWidth - labelPadding}` on the territory/LOB label Text nodes. The sidebar labels already do this correctly (using `width={zone.width - 12}` with `ellipsis: true`).
- Add `ellipsis: true` so overflowing text is truncated with "…"
- Apply to both player and opponent territory/LOB label overlays (MultiplayerCanvas.tsx ~lines 1833-1873 for territory, similar for LOB at ~lines 1760-1810).
- Badge width is 24px + 8px gap + 6px left padding = ~38px reserved. So label width = `zone.width - 44`.

**Files:** `MultiplayerCanvas.tsx` (territory label overlays, LOB label overlays)

---

## Bug 9: Sidebar pile card placeholders too small

**Problem:** On horizontal/wide displays, sidebar zone slots are tall but the pile card thumbnails remain tiny. The `getPileCardDimensions` function (multiplayerLayout.ts:129-134) uses `slotHeight * 0.78` but doesn't scale up enough.

**Fix:** Increase pile card sizing:
- Change `getPileCardDimensions` to use a larger portion of the slot: `slotHeight * 0.85` instead of `0.78`, and raise the max reasonable height (from effectively uncapped to something like 140px).
- Reduce `PILE_LABEL_RATIO` from `0.22` to `0.15` — the count badge doesn't need 22% of the slot height.
- Adjust the vertical centering in the rendering code (MultiplayerCanvas.tsx ~line 1885: `cy = zone.y + 20 + ...`) to account for the new proportions.

**Files:** `multiplayerLayout.ts` (getPileCardDimensions, PILE_LABEL_RATIO), `MultiplayerCanvas.tsx` (pile card rendering)

---

## Bug 10: Can't drag top card of discard pile into play

**Problem:** Discard pile cards are rendered with `isDraggable={false}` (MultiplayerCanvas.tsx:1965 for player, 2066 for opponent). In Redemption, the top card of the discard pile is accessible and should be draggable onto the canvas.

**Fix:** Make the top card of the discard pile draggable:
- For the **player's** discard (line 1946-1974): when `zoneKey === 'discard'`, set `isDraggable={true}` and wire up `handleCardDragStart`, `handleCardDragMove`, `handleCardDragEnd` on the top card's `GameCardNode`.
- For the **opponent's** discard (line 2052-2080): same treatment — make top card draggable so the player can interact with it (e.g., moving it to their own zones during gameplay).
- Only the **top card** should be draggable. Other cards in the pile remain hidden/inaccessible. The rendering already only shows the top card as a `GameCardNode`, so this change is scoped to that single node.
- Need to set the card's `zone` to `'discard'` correctly so the drag-end handler knows the source zone for the move reducer.

**Files:** `MultiplayerCanvas.tsx` (player discard pile ~line 1946, opponent discard pile ~line 2052)

---

## Bug 11: Bottom menu covers hand on some dimensions

**Problem:** `GameToolbar` is positioned at `bottom: 8px` with `zIndex: 200` (GameToolbar.tsx:148). On short screens, hand cards can render underneath the toolbar.

**Fix:** Account for toolbar height in hand layout:
- In `multiplayerLayout.ts`, subtract toolbar height (~48px) from the available hand zone height. The hand zone is `PLAYER_HAND_RATIO = 0.18` of stage height. On short screens (e.g., 600px height), 18% = 108px, and a 48px toolbar eats nearly half of that.
- Alternative: position the toolbar above the hand zone rather than overlapping it. Use the layout calculation to reserve space.
- **Priority:** Low — the user noted this may not be a big problem. Implement as a best-effort improvement.

**Files:** `multiplayerLayout.ts` (hand zone calculation), `GameToolbar.tsx` (positioning)

---

## Bug 12: Dice roll username cutoff on long names

**Problem:** The roller name in `DiceOverlay.tsx` has `whiteSpace: 'nowrap'` (line 140) but no `maxWidth` or `textOverflow`. Long usernames overflow the die container and get cut off by the viewport edge.

**Fix:** Add text overflow handling to the roller name element:
```
maxWidth: dieSize + 32  // 128px, slightly wider than the 96px die
overflow: 'hidden'
textOverflow: 'ellipsis'
```
Apply to both the player roll (bottom-left) and opponent roll (bottom-right) name labels.

**Files:** `DiceOverlay.tsx` (roller name styling, ~line 140-156)

---

## Implementation Order (suggested)

These bugs are independent. Suggested order by impact and ease:

1. **Bug 8** — Territory label overflow (quick, highly visible)
2. **Bug 12** — Dice username cutoff (quick CSS fix)
3. **Bug 1** — Context menu behind loupe (quick, one line)
4. **Bug 5** — Face-down card hover leak (security/fairness issue)
5. **Bug 4** — Opponent reserve requires consent (fairness issue)
6. **Bug 10** — Discard pile top card drag (gameplay blocker)
7. **Bug 7** — Lost soul type filtering (functional bug)
8. **Bug 6** — Reserve sorting (verify existing logic)
9. **Bug 2** — Opponent territory card dragging (medium, may need SpacetimeDB change)
10. **Bug 3** — Opponent reserve modal width (cosmetic)
11. **Bug 9** — Sidebar pile sizing (layout tweak)
12. **Bug 11** — Bottom menu overlap (low priority)
