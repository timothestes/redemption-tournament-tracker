# Paragon Shared LoB Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the Paragon multiplayer shared LoB so the layout fits the screen, reads as a single zone with a clear background, supports drag-back into the shared band, routes right-click "deck" actions to the shared Soul Deck, and only refills on actual rescue.

**Architecture:** Five focused changes — (1) layout reallocation in `multiplayerLayout.ts`, (2) zone backgrounds + drop hit-test in `MultiplayerCanvas.tsx`, (3) Paragon-aware right-click action overrides for shared souls (Top/Bottom/Shuffle/Exchange), (4) `DeckExchangeModal` accepts a `targetZone` prop, (5) `move_card` reducers (server + goldfish) shift to rescue-only refill semantics.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, react-konva, SpacetimeDB (TypeScript module + generated client bindings), Vitest for goldfish reducer tests.

**Source spec:** `docs/superpowers/specs/2026-04-18-paragon-shared-lob-polish-design.md`

---

## File touch summary

- `app/play/layout/multiplayerLayout.ts` — Paragon vertical reallocation, sidebar bounds, lobCard sizing (Task 1)
- `app/play/components/MultiplayerCanvas.tsx` — sharedLob + soulDeck backgrounds; drop hit-test for sharedLob; Paragon zone-context-menu wiring; right-click soul action overrides (Tasks 2, 3, 4, 5, 6)
- `app/shared/components/DeckExchangeModal.tsx` — optional `targetZone` prop (Task 6)
- `spacetimedb/src/index.ts` — `move_card` + `move_cards_batch` refill condition; ownership-revert path on shared-LoB drop (Tasks 3, 7)
- `app/goldfish/state/gameReducer.ts` — refill condition parity in `MOVE_CARD` and `MOVE_CARDS_BATCH` cases (Task 8)
- `lib/cards/__tests__/cardAbilities.test.ts` and/or `app/goldfish/state/*.test.ts` — update / add refill tests (Task 9)
- Generated client bindings (`lib/spacetimedb/module_bindings/**`) — regenerated via `spacetime generate` (Task 10)

---

### Task 1: Reallocate Paragon vertical layout

**Files:**
- Modify: `app/play/layout/multiplayerLayout.ts` — `format === 'Paragon'` branch around lines 285–500
- Test: existing visual check via dev server (no unit test for pure pixel math; integration check happens in Task 2 once backgrounds render)

Goal: drop the unused opp-LoB slot, shrink the shared band to one LoB's worth, redistribute the freed pixels into the territories, and extend each sidebar across the shared band's vertical center. Recompute `lobCard` against `sharedBandHeight` so souls don't render at the small per-seat-LoB size.

- [ ] **Step 1: Replace the Paragon branch's vertical math**

In the existing `if (format === 'Paragon') { ... }` block, replace the body with the following (preserve the surrounding declarations of `let sharedLob`, `let soulDeck`, etc.):

```ts
if (format === 'Paragon') {
  const SOUL_DECK_GUTTER = 4;

  // 1. Drop the unused opp LoB slot at the top — shift opp territory up.
  const paragonOppTerritoryY = oppHandHeight;

  // 2. Shrink the shared band to roughly one per-seat LoB's visual weight.
  const paragonSharedBandHeight = oppLobHeight + gap * 2;

  // 3. Distribute the freed budget evenly into the two territories.
  const freedBudget = dividerHeight + playerLobHeight - gap * 2;
  const territoryBonus = Math.floor(freedBudget / 2);
  const paragonOppTerritoryHeight = oppTerritoryHeight + territoryBonus;
  const paragonPlayerTerritoryHeight = playerTerritoryHeight + (freedBudget - territoryBonus);

  const paragonSharedBandY = paragonOppTerritoryY + paragonOppTerritoryHeight;
  const paragonPlayerTerritoryY = paragonSharedBandY + paragonSharedBandHeight;
  const paragonPlayerHandY = paragonPlayerTerritoryY + paragonPlayerTerritoryHeight;
  const paragonPlayerHandHeight = stageHeight - paragonPlayerHandY;

  const soulDeckWidth = Math.round(Math.min(100, (playAreaWidth - pad * 2) * 0.12));

  sharedLob = {
    x: pad + soulDeckWidth + SOUL_DECK_GUTTER,
    y: paragonSharedBandY + gap,
    width: playAreaWidth - pad * 2 - soulDeckWidth - SOUL_DECK_GUTTER,
    height: paragonSharedBandHeight - gap * 2,
    label: 'Land of Bondage (Shared)',
  };
  soulDeck = {
    x: pad,
    y: paragonSharedBandY + gap,
    width: soulDeckWidth,
    height: paragonSharedBandHeight - gap * 2,
    label: 'Soul Deck',
  };

  // Collapse legacy LoB / divider rects to zero-height at the shared band's Y
  // so any forgotten render sites are silent no-ops.
  paragonOpponentLob = { x: pad, y: paragonSharedBandY, width: playAreaWidth - pad * 2, height: 0, label: '' };
  paragonDivider    = { x: 0,   y: paragonSharedBandY, width: stageWidth,           height: 0, label: '' };
  paragonPlayerLob  = { x: pad, y: paragonPlayerTerritoryY + paragonPlayerTerritoryHeight, width: playAreaWidth - pad * 2, height: 0, label: '' };

  // Replace opponent territory + player territory + player hand rects with the
  // reallocated geometry so downstream code reads the correct dimensions.
  paragonOpponentTerritory = {
    ...opponentTerritory,
    y: paragonOppTerritoryY + gap,
    height: paragonOppTerritoryHeight - gap,
  };
  paragonPlayerTerritory = {
    ...playerTerritory,
    y: paragonPlayerTerritoryY,
    height: paragonPlayerTerritoryHeight - gap,
  };
  paragonPlayerHand = {
    x: 0,
    y: paragonPlayerHandY,
    width: stageWidth,
    height: paragonPlayerHandHeight,
    label: 'Hand',
  };
}
```

Add a `let paragonOpponentTerritory: ZoneRect | undefined;` declaration alongside the other `let paragon*` variables at the top of the Paragon branch, AND wire `opponentTerritory: paragonOpponentTerritory ?? opponentTerritory` in the returned `zones` object near the existing `playerTerritory: paragonPlayerTerritory ?? playerTerritory` line.

- [ ] **Step 2: Update sidebar bounds to span the shared band's vertical center**

Replace the existing sidebar Y/height calculations (around lines 442–449) with:

```ts
const sharedBandMidY = format === 'Paragon' && sharedLob
  ? sharedLob.y + sharedLob.height / 2
  : null;

const oppSidebarY = oppLobY;
const oppSidebarHeight =
  format === 'Paragon' && sharedBandMidY !== null
    ? sharedBandMidY - oppLobY
    : dividerY - oppLobY;

const playerSidebarY =
  format === 'Paragon' && sharedBandMidY !== null
    ? sharedBandMidY
    : dividerY + dividerHeight;

const playerSidebarHeight =
  (format === 'Paragon'
    ? (paragonPlayerHand?.y ?? playerHandY)
    : playerHandY) - playerSidebarY;
```

Also note: in Paragon mode `oppSidebarY` should drop the now-removed opp LoB. Replace the assignment with:

```ts
const oppSidebarY = format === 'Paragon' ? oppHandHeight : oppLobY;
```

- [ ] **Step 3: Recompute `lobCard` from `sharedBandHeight` when Paragon**

Around line 470, find:

```ts
const computed = computeCardDimensions(playAreaWidth, oppLobHeight, profile);
```

Wrap it so Paragon uses the shared band's height for the LoB tier:

```ts
const lobHeightForCardSizing =
  format === 'Paragon' && sharedLob
    ? sharedLob.height
    : oppLobHeight;
const computed = computeCardDimensions(playAreaWidth, lobHeightForCardSizing, profile);
```

This keeps the `mainCard` and `oppHandCard` sizes unchanged (they use `playAreaWidth`) while sizing `lobCard` against the actual shared-band height.

- [ ] **Step 4: Manual visual check**

Run `npm run dev`, open a Paragon multiplayer game in two windows. Confirm:
- Player hand is fully visible at the bottom (no cut-off).
- Opp territory sits directly under the opp hand (no empty cave-art gap above it).
- Shared LoB band visually weighs about the same as a single per-seat LoB.
- Sidebars (deck/discard/reserve/banish/lor) extend so they touch the shared band's vertical edges — no large empty band beside the shared LoB.
- Soul cards in the shared LoB render at a comfortable size (filling roughly the band's height).

- [ ] **Step 5: Commit**

```bash
git add app/play/layout/multiplayerLayout.ts
git commit -m "feat(play): reallocate Paragon vertical layout — shrink shared band, extend sidebars, resize LoB cards"
```

---

### Task 2: Background fills for sharedLob and soulDeck

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx` — zone backgrounds block (around line 3270 for player zones; add a Paragon-only block before)

Goal: render dark, semi-transparent `<Rect>` backgrounds for the shared LoB and Soul Deck slots, matching the style of the per-seat LoB backgrounds.

- [ ] **Step 1: Add the Paragon-only background block**

Inside the existing `<Layer ref={gameLayerRef}>` JSX, immediately before the `Object.entries(myZones).map(...)` block (around line 3263), add:

```tsx
{normalizedFormat === 'Paragon' && mpLayout?.zones.sharedLob && (
  <Rect
    x={mpLayout.zones.sharedLob.x}
    y={mpLayout.zones.sharedLob.y}
    width={mpLayout.zones.sharedLob.width}
    height={mpLayout.zones.sharedLob.height}
    fill="#1e1610"
    stroke="#6b4e27"
    strokeWidth={1}
    cornerRadius={3}
    opacity={0.45}
    onContextMenu={handleSharedLobContextMenu}
  />
)}
{normalizedFormat === 'Paragon' && mpLayout?.zones.soulDeck && (
  <Rect
    x={mpLayout.zones.soulDeck.x}
    y={mpLayout.zones.soulDeck.y}
    width={mpLayout.zones.soulDeck.width}
    height={mpLayout.zones.soulDeck.height}
    fill="#1e1610"
    stroke="#6b4e27"
    strokeWidth={1}
    cornerRadius={3}
    opacity={0.45}
  />
)}
```

The `handleSharedLobContextMenu` handler is added in Task 4. For now, define a temporary placeholder to keep the file compiling:

```ts
const handleSharedLobContextMenu = useCallback(
  (_e: Konva.KonvaEventObject<PointerEvent>) => {
    /* wired in Task 4 */
  },
  [],
);
```

- [ ] **Step 2: Type-check**

Run `npx tsc --noEmit 2>&1 | head -30`. Expected: clean.

- [ ] **Step 3: Visual check**

Reload dev server. The shared LoB now has a dark fill with a subtle border. The Soul Deck slot also has the matching dark fill behind the pile.

- [ ] **Step 4: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(play): render background fills for shared LoB + Soul Deck slots in Paragon"
```

---

### Task 3: Shared LoB as drop target

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx` — drop-zone hit-test path (search for the function that resolves a screen-space point to a destination zone in `handleCardDragEnd`)
- Modify: `spacetimedb/src/index.ts` — `move_card` + `move_cards_batch` reducers' `targetOwnerId` clauses (around lines 1690–1720 and the matching batch path)

Goal: a soul card dragged from a player's territory into the shared LoB rect should land back in `'land-of-bondage'` with `ownerId === 0n` (shared sentinel).

- [ ] **Step 1: Find the existing drop-zone resolution path**

```bash
grep -n "handleCardDragEnd\|getDropZone\|hitTestZone\|land-of-bondage'" /Users/timestes/projects/redemption-tournament-tracker/app/play/components/MultiplayerCanvas.tsx | head -30
```

The drag-end path resolves a screen-space point to a `{ zone, side }` (mine or opponent). Locate the section where it iterates `myZones`/`opponentZones` and add a Paragon-only branch before that iteration that hit-tests `mpLayout.zones.sharedLob`. If the point is inside, set the destination to `{ zone: 'land-of-bondage', side: 'shared', rect: mpLayout.zones.sharedLob }`.

- [ ] **Step 2: Wire the drop call to use ownerId `'0'`**

In the drop handler that calls `gameState.moveCard(...)` (or the wrapped `moveCard` defined at line 250), when the destination side is `'shared'`, pass `'0'` as the `targetOwnerId` argument:

```ts
moveCard(BigInt(id), 'land-of-bondage', undefined, posX, posY, '0');
```

For the multi-card batch path (`moveCardsBatch`), pass `'0'` as the `targetOwnerId` argument.

- [ ] **Step 3: Server — accept ownership reset to `0n` for soul-origin cards**

In `spacetimedb/src/index.ts` around line 1690, the existing block resolves `newOwnerId` from `targetOwnerId`. Add an explicit clause that **only** allows resetting ownership to `0n` for soul-origin cards moving INTO `'land-of-bondage'`. Replace:

```ts
const newOwnerId = targetOwnerId ? BigInt(targetOwnerId) : card.ownerId;
```

with:

```ts
let newOwnerId = targetOwnerId ? BigInt(targetOwnerId) : card.ownerId;
// Paragon: dropping a soul-origin card back into the shared LoB resets ownership to the shared sentinel.
if (
  targetOwnerId === '0' &&
  card.isSoulDeckOrigin === true &&
  toZone === 'land-of-bondage'
) {
  newOwnerId = 0n;
}
```

Apply the same change in `move_cards_batch` (search for the `targetOwnerId` parsing in that reducer and mirror the clause).

- [ ] **Step 4: Deploy + regenerate bindings (if signature unchanged, just publish)**

Use the `spacetimedb-deploy` skill (publishes the module and regenerates the TypeScript client bindings).

- [ ] **Step 5: Manual verification**

Two browser windows, Paragon game. From one window: drag a soul from the shared LoB to your territory. Then drag it back into the shared LoB. Both moves succeed. The other window sees the soul return to the shared LoB. The shared LoB count returns to its original number. (Refill semantics — Task 7 — will ensure no double-counting.)

- [ ] **Step 6: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx spacetimedb/src/index.ts lib/spacetimedb/module_bindings
git commit -m "feat(play+spacetime): shared LoB drop target with shared-ownership reset on drop"
```

---

### Task 4: Right-click on shared LoB background → spawn shared lost soul

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx` — replace the placeholder `handleSharedLobContextMenu` from Task 2 with a real implementation; reuse the existing `setZoneMenu` flow

Goal: right-clicking the empty shared-LoB background opens the same `ZoneContextMenu` that per-seat LoBs use, but spawned souls land with `ownerId === 0n`.

- [ ] **Step 1: Replace the placeholder handler**

Find the placeholder `handleSharedLobContextMenu` defined in Task 2 and replace it with a real handler mirroring the per-seat LoB context-menu code at lines 3296–3304:

```ts
const handleSharedLobContextMenu = useCallback(
  (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    closeAllMenus();
    const sharedRect = mpLayout?.zones.sharedLob;
    if (!sharedRect) return;
    const layer = gameLayerRef.current;
    const pointer = layer?.getRelativePointerPosition();
    const spawnX = pointer ? (pointer.x - sharedRect.x) / sharedRect.width : 0.5;
    const spawnY = pointer ? (pointer.y - sharedRect.y) / sharedRect.height : 0.5;
    setZoneMenu({
      x: e.evt.clientX,
      y: e.evt.clientY,
      spawnX,
      spawnY,
      targetPlayerId: '0', // shared sentinel
    });
  },
  [mpLayout, closeAllMenus],
);
```

- [ ] **Step 2: Verify the spawn handler honors `targetPlayerId === '0'`**

Look at the existing `onAddOpponentLostSoul` handler in the rendered `ZoneContextMenu` block (around line 4405):

```tsx
onAddOpponentLostSoul={(testament, posX, posY) => {
  gameState.spawnLostSoul(testament, String(posX), String(posY), zoneMenu.targetPlayerId);
}}
```

Confirm `gameState.spawnLostSoul` passes the targetPlayerId through to the server. If the server already accepts `'0'` for shared spawning, no additional change is needed. If not, add a server-side guard in `spawn_lost_soul` to insert with `ownerId: 0n` when `targetPlayerId === '0'`.

```bash
grep -n "spawn_lost_soul\|spawnLostSoul" /Users/timestes/projects/redemption-tournament-tracker/spacetimedb/src/index.ts | head -10
```

If the reducer needs the change, add the clause inside the reducer body and redeploy via `spacetimedb-deploy`.

- [ ] **Step 3: Manual verification**

Right-click the empty area of the shared LoB. The "Add Lost Soul" menu appears. Picking NT or OT spawns a Lost Soul Token in the shared LoB; both windows see it; ownerId stays `0n` (visible by checking the game-state log or the card's adapter).

- [ ] **Step 4: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx spacetimedb/src/index.ts lib/spacetimedb/module_bindings
git commit -m "feat(play): right-click shared LoB spawns lost soul with shared ownership"
```

---

### Task 5: Right-click shared soul → Top/Bottom/Shuffle redirect to soul deck

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx` — the `<CardContextMenu>` mount site (search for `<CardContextMenu` to find it; it's near line 4750–4780)

Goal: when the right-clicked card is a shared soul (`zone === 'land-of-bondage'` AND `ownerId === 0n`), override the `actions.moveCardToTopOfDeck` / `.moveCardToBottomOfDeck` / `.shuffleCardIntoDeck` props so they redirect to the shared Soul Deck.

- [ ] **Step 1: Locate the CardContextMenu render block**

```bash
grep -n "<CardContextMenu" /Users/timestes/projects/redemption-tournament-tracker/app/play/components/MultiplayerCanvas.tsx
```

It's mounted with an `actions` prop derived from `multiplayerActions` or the modalGameValue. Locate the `actions={...}` line.

- [ ] **Step 2: Build a Paragon shared-soul detector and override**

Right above the `<CardContextMenu ...>` JSX, add:

```tsx
const ctxCard = contextMenu?.card;
const isSharedSoul =
  ctxCard?.zone === 'land-of-bondage' &&
  ctxCard?.ownerId === 'player1' && // GameCard.ownerId is 'player1' for any viewer-owned card; shared cards are mapped this way too in modalGameValue
  // Re-check via the underlying CardInstance to confirm it's actually shared (ownerId === 0n)
  (() => {
    const live = ctxCard ? findAnyCardById(ctxCard.instanceId) : undefined;
    return live?.ownerId === 0n;
  })();

const sharedSoulActions = isSharedSoul
  ? {
      moveCardToTopOfDeck: (id: string) => gameState.moveCard(BigInt(id), 'soul-deck', '0'),
      moveCardToBottomOfDeck: (id: string) => gameState.moveCard(BigInt(id), 'soul-deck'),
      shuffleCardIntoDeck: (id: string) => {
        gameState.moveCard(BigInt(id), 'soul-deck');
        gameState.shuffleSoulDeck();
      },
    }
  : null;
```

Then in the `<CardContextMenu actions={...}>` line, merge:

```tsx
actions={{ ...multiplayerActions, ...(sharedSoulActions ?? {}) }}
```

(Adapt the merge to whichever object is currently being passed — the goal is the override wins when `isSharedSoul`.)

- [ ] **Step 3: Type-check**

Run `npx tsc --noEmit 2>&1 | head -30`. Expected: clean.

- [ ] **Step 4: Manual verification**

In a Paragon multiplayer game, right-click a shared soul in the LoB. Click "Top of Deck" — the soul moves into the Soul Deck pile (count goes up by 1, soul disappears from LoB). The shared LoB count drops by 1. **No refill fires** (Task 7 ensures this). Repeat for "Bottom of Deck" and "Shuffle into Deck".

- [ ] **Step 5: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(play): right-click shared soul redirects Top/Bottom/Shuffle to the soul deck"
```

---

### Task 6: Right-click shared soul → Exchange with Deck redirects to soul deck

**Files:**
- Modify: `app/shared/components/DeckExchangeModal.tsx` — accept optional `targetZone?: ZoneId` prop (default `'deck'`)
- Modify: `app/play/components/MultiplayerCanvas.tsx` — `onExchange` handler for shared souls opens the modal with `targetZone='soul-deck'`

Goal: when right-clicking a shared soul and choosing "Exchange with Deck", the modal shows shared soul-deck cards (not the player's private deck) and the exchange ends with the soul in the soul-deck and the chosen replacement coming out into the player's chosen destination.

- [ ] **Step 1: Add the `targetZone` prop to `DeckExchangeModal`**

Open `app/shared/components/DeckExchangeModal.tsx`. Find the `interface DeckExchangeModalProps` declaration. Add:

```ts
import type { ZoneId } from '@/app/shared/types/gameCard';

interface DeckExchangeModalProps {
  // ...existing fields...
  targetZone?: ZoneId; // default 'deck' — set to 'soul-deck' for Paragon shared-soul exchange
}
```

In the component body, destructure with a default:

```ts
const { exchangeCardIds, onComplete, onCancel, /* ... */, targetZone = 'deck' } = props;
```

Replace every `zones.deck` read with `zones[targetZone]`. Replace every move call that ends an exchange to `'deck'` with a move to `targetZone`. The existing string `'Sending to deck'` (line 300) should change to `'Sending to ' + (targetZone === 'soul-deck' ? 'soul deck' : 'deck')` or similar.

```bash
grep -n "zones\.deck\|'deck'\|\"deck\"" /Users/timestes/projects/redemption-tournament-tracker/app/shared/components/DeckExchangeModal.tsx
```

Audit each match; only the deck-target ones need to become `targetZone`.

- [ ] **Step 2: Wire the multiplayer canvas to pass `targetZone='soul-deck'` for shared souls**

In `MultiplayerCanvas.tsx`, find the existing `onExchange={(cardIds) => { setContextMenu(null); setExchangeCardIds(cardIds); }}` line (around line 4771). Replace `setExchangeCardIds` state shape with one that captures both the IDs and the target zone:

```ts
const [exchangeState, setExchangeState] = useState<
  { cardIds: string[]; targetZone: ZoneId } | null
>(null);
```

Replace existing references to `exchangeCardIds` accordingly. Update the `onExchange` callback:

```tsx
onExchange={(cardIds) => {
  setContextMenu(null);
  const isSharedSoul = isSharedSoulDetectorAt(cardIds[0]);
  setExchangeState({ cardIds, targetZone: isSharedSoul ? 'soul-deck' : 'deck' });
}}
```

Where `isSharedSoulDetectorAt(id)` checks `findAnyCardById(id)?.ownerId === 0n && findAnyCardById(id)?.zone === 'land-of-bondage'`.

Update the `<DeckExchangeModal ... />` mount (around line 5361):

```tsx
{exchangeState && (
  <DeckExchangeModal
    exchangeCardIds={exchangeState.cardIds}
    targetZone={exchangeState.targetZone}
    onComplete={() => { setExchangeState(null); clearSelection(); }}
    onCancel={() => setExchangeState(null)}
    onStartDrag={modalStartDrag}
    didDragRef={modalDidDragRef}
    isDragActive={modalDrag.isDragging}
    validDropRef={modalValidDropRef}
  />
)}
```

For the `targetZone === 'soul-deck'` case, wrap the modal in the existing `soulDeckModalGameValue` `ModalGameProvider` (set up in Task 15) so the modal sees soul-deck cards under `zones['soul-deck']`. For the default `'deck'` case, keep the existing `modalGameValue` provider wrapping. Use a conditional `ModalGameProvider` chain.

- [ ] **Step 3: Type-check**

Run `npx tsc --noEmit 2>&1 | head -30`. Expected: clean.

- [ ] **Step 4: Manual verification**

Right-click a shared soul → Exchange with Deck. The modal opens, showing soul-deck cards (face-down backs except for the names you'd normally see). Picking one swaps with the soul: the soul lands in the soul-deck, the chosen replacement comes out into your chosen destination. The shared LoB count drops by 1; **no refill fires**.

- [ ] **Step 5: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx app/shared/components/DeckExchangeModal.tsx
git commit -m "feat(play): right-click shared soul Exchange-with-Deck targets the soul deck"
```

---

### Task 7: Server — rescue-only refill semantics

**Files:**
- Modify: `spacetimedb/src/index.ts` — `move_card` reducer's refill clause (around line 1791); `move_cards_batch` reducer's refill clause (search for the analogous block in the batch reducer)

Goal: refill the shared LoB **only** when a soul-origin card moves to a `land-of-redemption`. All other destinations (territory, hand, soul-deck, discard, etc.) leave the LoB short and don't refill.

- [ ] **Step 1: Update `move_card` refill condition**

Find the existing refill block in `move_card` (around line 1791):

```ts
const triggeredRefill =
  normalizeFormat(game.format) === 'Paragon' &&
  card.isSoulDeckOrigin === true &&
  card.zone === 'land-of-bondage' &&
  toZone !== 'land-of-bondage';
if (triggeredRefill) {
  refillSoulDeck(ctx, game.id);
}
```

Replace with:

```ts
const triggeredRefill =
  normalizeFormat(game.format) === 'Paragon' &&
  card.isSoulDeckOrigin === true &&
  card.zone === 'land-of-bondage' &&
  toZone === 'land-of-redemption';
if (triggeredRefill) {
  refillSoulDeck(ctx, game.id);
}
```

- [ ] **Step 2: Update `move_cards_batch` refill condition**

Find the analogous block in `move_cards_batch` (search for `triggeredRefill` or `refillSoulDeck` in the batch reducer body) and apply the same edit — refill only when the per-card `toZone === 'land-of-redemption'`.

```bash
grep -n "refillSoulDeck\|triggeredRefill" /Users/timestes/projects/redemption-tournament-tracker/spacetimedb/src/index.ts
```

- [ ] **Step 3: Confirm the rescue-side ownership transfer still fires**

Verify the existing rescue-ownership-transfer block (around line 1696) still triggers — its condition is `card.ownerId === 0n && card.isSoulDeckOrigin === true && card.zone === 'land-of-bondage' && toZone !== 'land-of-bondage' && toZone !== 'soul-deck'`. That's still correct: rescue (toZone === 'land-of-redemption') triggers ownership transfer, while drag-back (toZone === 'land-of-bondage') and put-into-soul-deck (toZone === 'soul-deck') don't.

- [ ] **Step 4: Deploy via `spacetimedb-deploy` skill**

Publish the module + regenerate bindings.

- [ ] **Step 5: Manual verification**

Two-window Paragon game. Drag a soul → my territory. **No refill** (LoB count drops to 2). Drag the same soul back to shared LoB. LoB count returns to 3. Soul Deck count unchanged throughout.

Then drag a soul → my LoR. **Refill fires** (LoB count returns to 3, Soul Deck count drops by 1).

- [ ] **Step 6: Commit**

```bash
git add spacetimedb/src/index.ts lib/spacetimedb/module_bindings
git commit -m "feat(spacetime): rescue-only refill semantics for shared soul deck"
```

---

### Task 8: Goldfish — rescue-only refill parity

**Files:**
- Modify: `app/goldfish/state/gameReducer.ts` — `MOVE_CARD` case (around line 305) and `MOVE_CARDS_BATCH` case (around line 624)

Goal: mirror the server change in goldfish single-player so practice matches multiplayer behavior.

- [ ] **Step 1: Update `MOVE_CARD` refill condition**

Find:

```ts
const needsRefill =
  state.format === 'Paragon' &&
  result.fromZone === 'land-of-bondage' &&
  result.card.isSoulDeckOrigin === true &&
  toZone !== 'land-of-bondage';
```

Replace the last line with:

```ts
  toZone === 'land-of-redemption';
```

So the condition becomes:

```ts
const needsRefill =
  state.format === 'Paragon' &&
  result.fromZone === 'land-of-bondage' &&
  result.card.isSoulDeckOrigin === true &&
  toZone === 'land-of-redemption';
```

- [ ] **Step 2: Update `MOVE_CARDS_BATCH` refill block**

Find (around line 624):

```ts
let finalZones = zones;
if (state.format === 'Paragon') {
  // A soul-origin card may have left LoB as part of this batch; refill is idempotent.
  finalZones = refillSoulDeck(zones);
}
```

The batch reducer doesn't track per-card `toZone` outside `finalZoneById`. Replace with a check: refill if any card in the batch had `fromZone === 'land-of-bondage' && isSoulDeckOrigin && finalZone === 'land-of-redemption'`. Track this during the loop:

```ts
let anyRescue = false;
// ...inside the for loop, after computing finalZone for each card:
if (
  result.fromZone === 'land-of-bondage' &&
  result.card.isSoulDeckOrigin === true &&
  finalZone === 'land-of-redemption'
) {
  anyRescue = true;
}
// ...after the loop:
let finalZones = zones;
if (state.format === 'Paragon' && anyRescue) {
  finalZones = refillSoulDeck(zones);
}
```

- [ ] **Step 3: Type-check + run existing tests**

```bash
cd /Users/timestes/projects/redemption-tournament-tracker
npx tsc --noEmit 2>&1 | head -30
npx vitest run app/goldfish/state 2>&1 | tail -40
```

Some existing tests will fail because they assume refill on non-rescue moves. Note which ones; Task 9 updates them.

- [ ] **Step 4: Commit**

```bash
git add app/goldfish/state/gameReducer.ts
git commit -m "feat(goldfish): rescue-only refill semantics for Paragon (parity with server)"
```

---

### Task 9: Update goldfish refill tests

**Files:**
- Modify: existing goldfish reducer tests asserting refill on non-rescue moves; add new tests asserting NO refill on territory/hand/soul-deck moves and YES refill on LoR rescue

Goal: lock in the new semantics with tests that the implementer can reference when debugging future changes.

- [ ] **Step 1: Find existing refill tests**

```bash
grep -rn "refillSoulDeck\|isSoulDeckOrigin\|soul-deck" /Users/timestes/projects/redemption-tournament-tracker/app/goldfish --include="*.test.ts" --include="*.spec.ts"
```

- [ ] **Step 2: Update existing tests that asserted refill on non-rescue moves**

For each failing test, change the expectation:
- If the test moved a soul to territory/hand/discard and asserted "soul deck count drops by 1" → change to "soul deck count unchanged".
- If the test moved a soul to LoR and asserted refill → keep as-is (still passes).

- [ ] **Step 3: Add new tests for the new semantics**

Add three tests inside the existing `app/goldfish/state/__tests__/gameReducer.paragon.test.ts` (it already has the `makeCard` / `makeState` / `act` helpers and the "Paragon rescue + refill on MOVE_CARD" `describe` block at line 82). Add this block at the bottom of the file:

```ts
describe('Paragon rescue-only refill semantics', () => {
  it('does NOT refill when a soul moves from shared LoB to territory', () => {
    const soulDeck = [makeCard({ instanceId: 's1' })];
    const lob = [
      makeCard({ instanceId: 'l1', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l2', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l3', zone: 'land-of-bondage' }),
    ];
    const state = makeState({ 'soul-deck': soulDeck, 'land-of-bondage': lob });
    const next = gameReducer(state, act('MOVE_CARD', {
      cardInstanceId: 'l1',
      toZone: 'territory',
    }));
    expect(next.zones['soul-deck']).toHaveLength(1); // unchanged
    expect(next.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin)).toHaveLength(2);
    expect(next.zones.territory).toHaveLength(1);
  });

  it('does NOT refill when a soul moves back into the soul deck', () => {
    const soulDeck = [makeCard({ instanceId: 's1' })];
    const lob = [
      makeCard({ instanceId: 'l1', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l2', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l3', zone: 'land-of-bondage' }),
    ];
    const state = makeState({ 'soul-deck': soulDeck, 'land-of-bondage': lob });
    const next = gameReducer(state, act('MOVE_CARD', {
      cardInstanceId: 'l1',
      toZone: 'soul-deck',
    }));
    expect(next.zones['soul-deck']).toHaveLength(2); // soul went IN
    expect(next.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin)).toHaveLength(2); // not refilled
  });

  it('does NOT refill when a soul moves to hand', () => {
    const soulDeck = [makeCard({ instanceId: 's1' })];
    const lob = [
      makeCard({ instanceId: 'l1', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l2', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l3', zone: 'land-of-bondage' }),
    ];
    const state = makeState({ 'soul-deck': soulDeck, 'land-of-bondage': lob });
    const next = gameReducer(state, act('MOVE_CARD', {
      cardInstanceId: 'l1',
      toZone: 'hand',
    }));
    expect(next.zones['soul-deck']).toHaveLength(1); // unchanged
    expect(next.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin)).toHaveLength(2);
    expect(next.zones.hand).toHaveLength(1);
  });
});
```

(The existing rescue tests at line 82 already cover the YES-refill-on-LoR case — no new test needed.)

- [ ] **Step 4: Run tests**

```bash
npx vitest run app/goldfish 2>&1 | tail -30
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/goldfish/state/__tests__ app/goldfish/state/*.test.ts
git commit -m "test(goldfish): rescue-only refill semantics — drag-to-territory + soul-deck round trip"
```

(Adjust the path in `git add` to match where the tests live.)

---

### Task 10: Final SpacetimeDB deploy + binding regen + smoke check

**Files:**
- Generated: `lib/spacetimedb/module_bindings/**`

Goal: ensure the published module matches the latest server source after Tasks 3, 4, 7 and that client bindings are in sync.

- [ ] **Step 1: Use the `spacetimedb-deploy` skill**

It publishes the module and regenerates the TypeScript bindings.

- [ ] **Step 2: Type-check the regenerated bindings + project**

```bash
cd /Users/timestes/projects/redemption-tournament-tracker
npx tsc --noEmit 2>&1 | head -30
```

Expected: clean.

- [ ] **Step 3: Two-window smoke run**

Run `npm run dev` and play a complete Paragon multiplayer game from setup to several rescues, exercising every change:
1. Both seats see the new layout (no clipped hand, sensible band height).
2. Drag a soul to my territory → drag back to shared LoB. No double-count.
3. Right-click a soul → Top of Deck. Soul is in soul deck (count up by 1). LoB count drops, no refill.
4. Right-click a soul → Bottom of Deck. Same outcome (count up by 1, no refill).
5. Right-click a soul → Shuffle into Deck. Same outcome (count up by 1, pile reshuffled, no refill).
6. Right-click a soul → Exchange with Deck. Modal shows soul-deck cards, exchange completes, soul ends in soul-deck.
7. Drag a soul → my LoR. Refill fires (LoB count restored, soul-deck count drops by 1).

- [ ] **Step 4: Commit any binding changes**

```bash
git add lib/spacetimedb/module_bindings
git status
# only commit if there are actual binding diffs
git commit -m "chore(spacetime): regenerate client bindings after polish work" || true
```

---

## Final verification

- [ ] Run the full test suite

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] Production build (skip if user requests skipping per `feedback_skip_build.md` memory; this build can be run as a final sanity if requested)

```bash
npm run build
```

Expected: successful compile.

---

## Notes for implementer

- **Skill handoff:** SpacetimeDB publishing and binding regeneration MUST go through the `spacetimedb-deploy` skill (Tasks 3, 7, 10).
- **`isSharedSoul` vs `card.ownerId === 'player1'` confusion:** The client adapts shared cards (server `ownerId === 0n`) to GameCard with `ownerId: 'player1'` because that's the established "viewer-owned" sentinel in the existing modal patterns. Always re-check via `findAnyCardById(id)?.ownerId === 0n` (the underlying CardInstance) when you need to know "is this actually shared?".
- **Why `'0'` for shared sentinel in client→server reducer args:** the server's `targetOwnerId` is a string; `''` means "no change" and `'0'` is parsed as `BigInt('0') === 0n`. The server clause from Task 3 only honors `'0'` when the card is soul-origin AND `toZone === 'land-of-bondage'` — preventing accidental ownership-blanking elsewhere.
- **Two-call shuffle pattern (Task 5 step 2):** The "Shuffle into Deck" override calls `moveCard` then `shuffleSoulDeck`. There's no race window where the user sees an inconsistent pile because the move's commit and shuffle's commit are both server-side and the subscriptions update atomically per reducer call.
- **DeckExchangeModal's `targetZone` prop (Task 6):** consider this the primary structural change in this plan. Other modal call sites (single-player, deck-exchange-from-hand) keep their current behavior because the prop defaults to `'deck'`.
- **Refill change scope (Tasks 7 + 8):** rescue-only is a behavior change that affects more than the new drag-back workflow — it's the new canonical semantics. If existing single-player tests assume non-rescue refill, update them per Task 9; do not preserve old behavior with a flag.
