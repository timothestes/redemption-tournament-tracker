# Play Mode Bug Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 12 independent bugs in the multiplayer play mode canvas covering z-ordering, drag behavior, fairness, filtering, and layout.

**Architecture:** Each bug is a self-contained task touching 1-3 files. No shared dependencies between tasks. All changes are in the `app/play/` and `app/shared/` directories.

**Tech Stack:** React, react-konva (Konva canvas), TypeScript, SpacetimeDB (game state)

---

### Task 1: Fix territory and LOB label overflow into count badge

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx` (LOB label overlay ~line 1783-1791, territory label overlay ~line 1842-1850)

- [ ] **Step 1: Fix LOB label overflow**

In `MultiplayerCanvas.tsx`, find the LOB label overlay section (~line 1783). The `<Text>` element for the zone label has no `width` or `ellipsis` constraint. Add them:

```typescript
// BEFORE (line 1783-1791):
<Text
  x={zone.x + 6}
  y={zone.y + 4}
  text={zone.label.toUpperCase()}
  fontSize={11}
  fontFamily="Cinzel, Georgia, serif"
  fill={fillColor}
  letterSpacing={1}
/>

// AFTER:
<Text
  x={zone.x + 6}
  y={zone.y + 4}
  text={zone.label.toUpperCase()}
  fontSize={11}
  fontFamily="Cinzel, Georgia, serif"
  fill={fillColor}
  letterSpacing={1}
  width={zone.width - 44}
  ellipsis={true}
/>
```

Also update the background `<Rect>` width to use the zone width instead of the estimated label width. Change the `<Rect>` at ~line 1775:

```typescript
// BEFORE:
<Rect
  x={zone.x}
  y={zone.y}
  width={labelW + 6}
  height={20}
  fill={bgFill}
  cornerRadius={[3, 0, 4, 0]}
/>

// AFTER:
<Rect
  x={zone.x}
  y={zone.y}
  width={Math.min(labelW + 6, zone.width)}
  height={20}
  fill={bgFill}
  cornerRadius={[3, 0, 4, 0]}
/>
```

- [ ] **Step 2: Fix territory label overflow**

Same fix for the territory label overlay section (~line 1842). Add `width` and `ellipsis` to the `<Text>`:

```typescript
// BEFORE (line 1842-1850):
<Text
  x={zone.x + 6}
  y={zone.y + 4}
  text={zone.label.toUpperCase()}
  fontSize={11}
  fontFamily="Cinzel, Georgia, serif"
  fill={fillColor}
  letterSpacing={1}
/>

// AFTER:
<Text
  x={zone.x + 6}
  y={zone.y + 4}
  text={zone.label.toUpperCase()}
  fontSize={11}
  fontFamily="Cinzel, Georgia, serif"
  fill={fillColor}
  letterSpacing={1}
  width={zone.width - 44}
  ellipsis={true}
/>
```

Also cap the background `<Rect>` at ~line 1834:

```typescript
// BEFORE:
width={labelW + 6}

// AFTER:
width={Math.min(labelW + 6, zone.width)}
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "fix: constrain territory/LOB label width to prevent badge collision"
```

---

### Task 2: Fix dice roll username cutoff on long names

**Files:**
- Modify: `app/play/components/DiceOverlay.tsx` (~line 134-142, 144-156)

- [ ] **Step 1: Add overflow handling to roller name container**

In `DiceOverlay.tsx`, find the `motion.div` wrapper for the roller name (~line 134). It has `whiteSpace: 'nowrap'` but no overflow handling. Add `overflow: 'hidden'`:

```typescript
// BEFORE (line 134-142):
style={{
  position: 'absolute',
  top: dieSize + 4,
  left: 0,
  right: 0,
  textAlign: 'center',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
}}

// AFTER:
style={{
  position: 'absolute',
  top: dieSize + 4,
  left: -16,
  right: -16,
  textAlign: 'center',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  pointerEvents: 'none',
}}
```

The `left: -16, right: -16` gives 128px total width (96px die + 32px), centered, with ellipsis for overflow.

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add app/play/components/DiceOverlay.tsx
git commit -m "fix: truncate long usernames in dice roll overlay"
```

---

### Task 3: Fix context menu hidden below preview loupe

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx` (`handleCardContextMenu` ~line 1138)

- [ ] **Step 1: Verify hover is already cleared**

Read `handleCardContextMenu` at line 1138. Check if `setHoveredInstanceId(null)` and `stopHoverAnimation()` are already there. Looking at lines 1145-1147:

```typescript
// Clear hover state
setHoveredInstanceId(null);
stopHoverAnimation();
```

These are already present. The real issue is that `hoveredCard` and `hoverReady` are NOT cleared — the `CardPreviewSystem` hover tooltip uses `hoveredCard` and `hoverReady`, not `hoveredInstanceId`. Add those clears:

```typescript
// BEFORE (line 1145-1147):
// Clear hover state
setHoveredInstanceId(null);
stopHoverAnimation();

// AFTER:
// Clear hover state — dismiss both the glow AND the preview tooltip
setHoveredInstanceId(null);
setHoveredCard(null);
setHoverReady(false);
stopHoverAnimation();
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "fix: dismiss hover preview tooltip when opening context menu"
```

---

### Task 4: Suppress hover preview for face-down opponent cards

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx` (`handleMouseEnter` ~line 1176)

- [ ] **Step 1: Gate hover preview on card visibility**

In `handleMouseEnter` (~line 1176), add a check: if the card is face-down (`isFlipped`) AND belongs to the opponent (`ownerId === 'player2'`), skip setting the hover preview. The glow animation is fine — it doesn't reveal card info. Only skip the card preview:

```typescript
// BEFORE (line 1176-1192):
const handleMouseEnter = useCallback(
  (card: GameCard, e: Konva.KonvaEventObject<MouseEvent>) => {
    if (isDraggingRef.current) return;
    setHoveredInstanceId(card.instanceId);
    setHoveredCard(card);
    startHoverAnimation();
    // Capture mouse position for the hover preview tooltip
    const pos = { x: e.evt.clientX, y: e.evt.clientY };
    mousePosRef.current = pos;
    setMousePos(pos);
    // Start 250ms delay before showing hover preview
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoverReady(false);
    hoverTimerRef.current = setTimeout(() => setHoverReady(true), 250);
  },
  [startHoverAnimation],
);

// AFTER:
const handleMouseEnter = useCallback(
  (card: GameCard, e: Konva.KonvaEventObject<MouseEvent>) => {
    if (isDraggingRef.current) return;
    setHoveredInstanceId(card.instanceId);
    startHoverAnimation();

    // Don't show card preview for face-down opponent cards (hidden info)
    if (card.isFlipped && card.ownerId === 'player2') {
      setHoveredCard(null);
      return;
    }

    setHoveredCard(card);
    // Capture mouse position for the hover preview tooltip
    const pos = { x: e.evt.clientX, y: e.evt.clientY };
    mousePosRef.current = pos;
    setMousePos(pos);
    // Start 250ms delay before showing hover preview
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoverReady(false);
    hoverTimerRef.current = setTimeout(() => setHoverReady(true), 250);
  },
  [startHoverAnimation],
);
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "fix: hide card preview for face-down opponent cards"
```

---

### Task 5: Gate opponent reserve behind zone search request

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx` (opponent pile click handler ~line 2007-2010)

- [ ] **Step 1: Change reserve click to use requestZoneSearch**

In the opponent sidebar pile rendering (~line 2007), the `onClick` handler opens the browse modal directly for all non-deck zones. Change it to gate reserve behind the zone search consent flow:

```typescript
// BEFORE (line 2007-2010):
onClick={zoneKey !== 'deck' ? () => {
  const zoneLabels: Record<string, string> = { discard: "Opponent's Discard", reserve: "Opponent's Reserve", banish: "Opponent's Banish", lor: "Opponent's Land of Redemption" };
  setBrowseOpponentZone({ zone: zoneKey, cards, label: zoneLabels[zoneKey] ?? zoneKey });
} : undefined}

// AFTER:
onClick={zoneKey !== 'deck' && zoneKey !== 'reserve' ? () => {
  const zoneLabels: Record<string, string> = { discard: "Opponent's Discard", banish: "Opponent's Banish", lor: "Opponent's Land of Redemption" };
  setBrowseOpponentZone({ zone: zoneKey, cards, label: zoneLabels[zoneKey] ?? zoneKey });
} : zoneKey === 'reserve' ? () => {
  requestZoneSearch('reserve');
  showGameToast('Waiting for opponent to approve reserve search...');
} : undefined}
```

This makes:
- Deck: no click handler (unchanged)
- Reserve: triggers `requestZoneSearch` + toast (was: direct browse)
- Discard/Banish/LOR: direct browse (unchanged — public info)

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "fix: require opponent consent before browsing their reserve"
```

---

### Task 6: Make top card of discard pile draggable

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx` (player discard ~line 1956-1969, opponent discard ~line 2057-2070)

- [ ] **Step 1: Make player's discard top card draggable**

In the player sidebar pile rendering, find the `GameCardNode` for the discard top card (~line 1956). Change `isDraggable` and wire up real drag handlers:

```typescript
// BEFORE (line 1965-1969):
isDraggable={false}
hoverProgress={hoveredInstanceId === String(topCard.id) ? hoverProgress : 0}
onDragStart={noopCardDrag}
onDragMove={noopDrag}
onDragEnd={noopCardDragEnd}

// AFTER:
isDraggable={zoneKey === 'discard'}
hoverProgress={hoveredInstanceId === String(topCard.id) ? hoverProgress : 0}
onDragStart={zoneKey === 'discard' ? handleCardDragStart : noopCardDrag}
onDragMove={zoneKey === 'discard' ? handleCardDragMove : noopDrag}
onDragEnd={zoneKey === 'discard' ? handleCardDragEnd : noopCardDragEnd}
```

Also add `nodeRef={registerCardNode}` to the `GameCardNode` props so the drag system can look up the node. Check if it's already there — if not, add it after `isSelected`:

```typescript
isSelected={false}
nodeRef={zoneKey === 'discard' ? registerCardNode : undefined}
isDraggable={zoneKey === 'discard'}
```

- [ ] **Step 2: Make opponent's discard top card draggable**

Same change for the opponent discard pile `GameCardNode` (~line 2057):

```typescript
// BEFORE (line 2066-2070):
isDraggable={false}
hoverProgress={hoveredInstanceId === String(topCard.id) ? hoverProgress : 0}
onDragStart={noopCardDrag}
onDragMove={noopDrag}
onDragEnd={noopCardDragEnd}

// AFTER:
isDraggable={zoneKey === 'discard'}
hoverProgress={hoveredInstanceId === String(topCard.id) ? hoverProgress : 0}
nodeRef={zoneKey === 'discard' ? registerCardNode : undefined}
onDragStart={zoneKey === 'discard' ? handleCardDragStart : noopCardDrag}
onDragMove={zoneKey === 'discard' ? handleCardDragMove : noopDrag}
onDragEnd={zoneKey === 'discard' ? handleCardDragEnd : noopCardDragEnd}
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: make discard pile top card draggable into play"
```

---

### Task 7: Fix lost soul type filtering in deck search modal

**Files:**
- Modify: `app/shared/components/DeckSearchModal.tsx` (`matchesSearch` ~line 166-186)

- [ ] **Step 1: Add type normalization to matchesSearch**

Lost souls are stored with `type: 'LS'` in the game state. When a user types "lost soul" in the type filter, `'ls'.includes('lost soul')` fails. Add a normalization map:

```typescript
// Add above matchesSearch (~line 166):
const TYPE_ALIASES: Record<string, string[]> = {
  'ls': ['lost soul', 'lost souls'],
  'he': ['hero', 'heroes'],
  'ec': ['evil character', 'evil characters'],
  'gc': ['good character', 'good characters'],
  'ee': ['evil enhancement', 'evil enhancements'],
  'ge': ['good enhancement', 'good enhancements'],
  'da': ['dominant artifact', 'dominant artifacts'],
  'ar': ['artifact'],
  'fo': ['fortress'],
  'si': ['site'],
  'cu': ['curse'],
  'co': ['covenant'],
};

const matchesSearch = (c: GameCard, term: string): boolean => {
  const t = term.toLowerCase();

  const matchesType = (type: string, searchTerm: string): boolean => {
    const typeLower = type.toLowerCase();
    if (typeLower.includes(searchTerm)) return true;
    // Check if the search term matches any alias for this type abbreviation
    const aliases = TYPE_ALIASES[typeLower];
    if (aliases) return aliases.some(alias => alias.includes(searchTerm));
    // Check reverse: user typed abbreviation, match full type
    for (const [abbrev, aliases] of Object.entries(TYPE_ALIASES)) {
      if (aliases.some(a => a.includes(searchTerm)) && typeLower === abbrev) return true;
    }
    return false;
  };

  if (searchField === 'all') {
    return (
      matchesType(c.type, t) ||
      c.cardName.toLowerCase().includes(t) ||
      c.brigade.toLowerCase().includes(t) ||
      c.alignment.toLowerCase().includes(t) ||
      c.identifier.toLowerCase().includes(t) ||
      c.specialAbility.toLowerCase().includes(t)
    );
  }
  switch (searchField) {
    case 'type': return matchesType(c.type, t);
    case 'name': return c.cardName.toLowerCase().includes(t);
    case 'brigade': return c.brigade.toLowerCase().includes(t);
    case 'alignment': return c.alignment.toLowerCase().includes(t);
    case 'identifier': return c.identifier.toLowerCase().includes(t);
    case 'ability': return c.specialAbility.toLowerCase().includes(t);
  }
};
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add app/shared/components/DeckSearchModal.tsx
git commit -m "fix: support type aliases in deck search (LS → Lost Soul, etc.)"
```

---

### Task 8: Verify and fix reserve sorting in multiplayer

**Files:**
- Modify: `app/shared/components/OpponentBrowseModal.tsx` (if sorting is missing)

- [ ] **Step 1: Verify ZoneBrowseModal sorting**

Read `ZoneBrowseModal.tsx` line 150-153. The sorting logic is already there:
```typescript
const cards = zoneId === 'reserve'
  ? [...rawCards].sort((a, b) => a.type.localeCompare(b.type) || a.cardName.localeCompare(b.cardName))
  : rawCards;
```

Verify that when the multiplayer canvas opens the reserve browse modal, it passes `zoneId='reserve'`. Check the `setBrowseZone` call in MultiplayerCanvas.tsx.

- [ ] **Step 2: Add sorting to OpponentBrowseModal**

Read `OpponentBrowseModal.tsx` and check if it sorts reserve cards. If it doesn't have the same sort, add it. Find where cards are used in the component and add sorting:

```typescript
// In OpponentBrowseModal, find where cards prop is used for rendering.
// Add sorting before rendering:
const sortedCards = zoneName?.toLowerCase().includes('reserve')
  ? [...cards].sort((a, b) => a.type.localeCompare(b.type) || a.cardName.localeCompare(b.cardName))
  : cards;
// Then use sortedCards instead of cards in the grid rendering.
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add app/shared/components/OpponentBrowseModal.tsx
git commit -m "fix: sort reserve cards by type then name in opponent browse modal"
```

---

### Task 9: Make opponent territory cards draggable

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx` (opponent territory rendering ~line 1644-1663)

- [ ] **Step 1: Check SpacetimeDB reducer support**

Before making code changes, check if the `moveCard` reducer in the SpacetimeDB module accepts moves for opponent cards. Read `app/play/hooks/useGameState.ts` and find the `moveCard` function. Also check `spacetimedb/server/src/lib.rs` or the bindings for the `move_card` reducer signature.

If `moveCard` only moves the current player's cards, you'll need to add a `moveOpponentTerritoryCard` reducer. Flag this as a blocker if so and skip to the next task.

- [ ] **Step 2: Wire up drag handlers for opponent territory cards**

In the opponent territory rendering section (~line 1644-1663), change the props:

```typescript
// BEFORE (line 1653-1662):
isSelected={false}
isDraggable={false}
hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
onDragStart={noopCardDrag}
onDragMove={noopDrag}
onDragEnd={noopCardDragEnd}
onContextMenu={handleCardContextMenu}
onDblClick={noopDblClick}
onMouseEnter={handleMouseEnter}
onMouseLeave={handleMouseLeave}

// AFTER:
isSelected={isSelected(String(card.id))}
isDraggable={true}
hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
nodeRef={registerCardNode}
onClick={handleCardClick}
onDragStart={handleCardDragStart}
onDragMove={handleCardDragMove}
onDragEnd={handleCardDragEnd}
onContextMenu={handleCardContextMenu}
onDblClick={noopDblClick}
onMouseEnter={handleMouseEnter}
onMouseLeave={handleMouseLeave}
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: make opponent territory cards draggable"
```

---

### Task 10: Unify opponent browse modal width with player's

**Files:**
- Modify: `app/shared/components/OpponentBrowseModal.tsx` (~line 174-190)

- [ ] **Step 1: Compare modal styling**

Read both modals' container styling:
- `ZoneBrowseModal.tsx`: Find the outer `<div>` styling (should have `width: '80vw', maxWidth: 700`)
- `OpponentBrowseModal.tsx`: Line 181-182 has `width: '80vw', maxWidth: 700`

The outer dimensions match. The difference is likely in card grid styling or padding. Compare the card grid sections of both modals. Look for `grid-template-columns`, `gap`, card image sizing, and padding.

Unify any differences so both modals render cards at the same size in the same grid layout. Specifically check:
- Grid column count and card width
- Card image aspect ratio
- Internal padding around the grid

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add app/shared/components/OpponentBrowseModal.tsx
git commit -m "fix: unify opponent browse modal layout with player's modal"
```

---

### Task 11: Increase sidebar pile card sizes

**Files:**
- Modify: `app/play/layout/multiplayerLayout.ts` (line 85, line 129-134)
- Modify: `app/play/components/MultiplayerCanvas.tsx` (pile card centering ~line 1885)

- [ ] **Step 1: Reduce PILE_LABEL_RATIO and increase card size**

In `multiplayerLayout.ts`:

```typescript
// BEFORE (line 85):
const PILE_LABEL_RATIO = 0.22;

// AFTER:
const PILE_LABEL_RATIO = 0.15;
```

Update `getPileCardDimensions` to use more of the available space:

```typescript
// BEFORE (line 129-134):
function getPileCardDimensions(slotHeight: number): CardDimensions {
  const usable = slotHeight * (1 - PILE_LABEL_RATIO);
  const h = Math.max(usable, 30);
  const w = Math.round(h / CARD_ASPECT_RATIO);
  return { cardWidth: Math.max(w, Math.round(30 / CARD_ASPECT_RATIO)), cardHeight: Math.round(Math.max(h, 30)) };
}

// AFTER:
function getPileCardDimensions(slotHeight: number): CardDimensions {
  const usable = slotHeight * (1 - PILE_LABEL_RATIO);
  const h = Math.min(Math.max(usable, 30), 140);
  const w = Math.round(h / CARD_ASPECT_RATIO);
  return { cardWidth: Math.max(w, Math.round(30 / CARD_ASPECT_RATIO)), cardHeight: Math.round(Math.max(h, 30)) };
}
```

The key change: cap at 140px max height so cards don't become absurdly large on very tall screens, while using more of the available space via the reduced `PILE_LABEL_RATIO`.

- [ ] **Step 2: Adjust pile card centering**

In `MultiplayerCanvas.tsx`, the centering calc uses a 20px top offset for the count badge. With the reduced label ratio, the badge is smaller. Reduce the badge offset:

```typescript
// BEFORE (~line 1885, and ~line 1999):
const cy = zone.y + 20 + Math.max(0, (zone.height - 20 - pileCardHeight) / 2);

// AFTER:
const cy = zone.y + 18 + Math.max(0, (zone.height - 18 - pileCardHeight) / 2);
```

Apply this change to both the player pile section (~line 1885) and the opponent pile section (~line 1999).

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add app/play/layout/multiplayerLayout.ts app/play/components/MultiplayerCanvas.tsx
git commit -m "fix: increase sidebar pile card sizes, reduce label ratio"
```

---

### Task 12: Mitigate bottom menu overlapping hand on short screens

**Files:**
- Modify: `app/play/layout/multiplayerLayout.ts` (hand zone height calculation ~line 77)

- [ ] **Step 1: Reserve toolbar space in hand zone**

In `multiplayerLayout.ts`, the hand zone uses `PLAYER_HAND_RATIO = 0.18`. On short screens, the toolbar (`bottom: 8px`, ~40px tall) overlaps. Instead of changing the ratio, subtract toolbar height from the hand zone's usable height in the layout calculation.

Find where `PLAYER_HAND_RATIO` is used to compute the hand zone height. The hand zone rect's height should be reduced by the toolbar height so hand card positions don't overlap:

```typescript
// In calculateMultiplayerLayout, find where playerHandRect is computed.
// Adjust the height to account for toolbar:
const TOOLBAR_RESERVED = 48; // toolbar height + padding

// When computing playerHandRect height, reduce by TOOLBAR_RESERVED:
// playerHandRect.height = Math.max(playerHandRect.height - TOOLBAR_RESERVED, 40);
```

The exact location depends on how `playerHandRect` is built. Read the layout function and apply the reduction to the hand zone's height.

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add app/play/layout/multiplayerLayout.ts
git commit -m "fix: reserve toolbar space in hand zone to prevent overlap"
```

---

## Summary

| Task | Bug | Files Changed |
|------|-----|---------------|
| 1 | Territory/LOB label overflow | `MultiplayerCanvas.tsx` |
| 2 | Dice roll username cutoff | `DiceOverlay.tsx` |
| 3 | Context menu behind loupe | `MultiplayerCanvas.tsx` |
| 4 | Face-down card hover leak | `MultiplayerCanvas.tsx` |
| 5 | Opponent reserve consent | `MultiplayerCanvas.tsx` |
| 6 | Discard pile top card drag | `MultiplayerCanvas.tsx` |
| 7 | Lost soul type filtering | `DeckSearchModal.tsx` |
| 8 | Reserve sorting | `OpponentBrowseModal.tsx` |
| 9 | Opponent territory dragging | `MultiplayerCanvas.tsx` |
| 10 | Opponent modal width | `OpponentBrowseModal.tsx` |
| 11 | Sidebar pile sizing | `multiplayerLayout.ts`, `MultiplayerCanvas.tsx` |
| 12 | Bottom menu overlap | `multiplayerLayout.ts` |
