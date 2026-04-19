# Play Mode Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 7 issues in the multiplayer `/play` route: TOKEN label bug, zone ordering, cramped layout, broken context menus, missing zone counts, unwired chat, and add Playwright test route.

**Architecture:** Eliminate the shared right sidebar. Each player's pile zones move inline within their board half. A new left HTML column (outside the Konva canvas) holds a persistent card preview panel and collapsible chat. Context menus are extracted from goldfish into shared components with a common `GameActions` interface.

**Tech Stack:** Next.js 15, React 19, TypeScript, react-konva (Konva canvas), SpacetimeDB (multiplayer state), Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-23-play-mode-redesign-design.md`

---

## File Structure

### New files
| File | Responsibility |
|---|---|
| `app/shared/types/gameActions.ts` | Shared `GameActions` interface used by context menus |
| `app/shared/components/CardContextMenu.tsx` | Right-click menu for individual cards (extracted from goldfish) |
| `app/shared/components/DeckContextMenu.tsx` | Right-click menu for deck pile (extracted from goldfish) |
| `app/shared/components/ZoneContextMenu.tsx` | Right-click menu for empty zone area (extracted from goldfish) |
| `app/shared/components/MultiCardContextMenu.tsx` | Right-click menu for multi-selected cards (extracted from goldfish) |
| `app/play/components/CardPreviewPanel.tsx` | Persistent card preview in left sidebar |
| `app/play/test/page.tsx` | Dummy route with mock game state for Playwright screenshots |

### Modified files
| File | Change summary |
|---|---|
| `app/goldfish/types.ts` | Add `isToken: boolean` to `GameCard` interface |
| `app/shared/components/GameCardNode.tsx` | Change token check from `ownerId === 'player2'` to `card.isToken` |
| `app/goldfish/state/gameReducer.ts` | Update 3 token checks to `card.isToken`; set `isToken: true` in ADD_OPPONENT_LOST_SOUL |
| `app/goldfish/state/gameInitializer.ts` | Add `isToken: false` to card creation |
| `app/goldfish/components/CardContextMenu.tsx` | Delete after shared version is created |
| `app/goldfish/components/MultiCardContextMenu.tsx` | Delete after shared version is created |
| `app/goldfish/components/DeckContextMenu.tsx` | Delete after shared version is created |
| `app/goldfish/components/ZoneContextMenu.tsx` | Delete after shared version is created |
| `app/goldfish/components/GoldfishCanvas.tsx` | Update token check; wire shared context menus via GameActions adapter |
| `app/play/components/ContextMenus.tsx` | Delete — replaced by shared context menu components |
| `app/play/layout/mirrorLayout.ts` | Full rewrite: new zone order, inline piles, no shared sidebar |
| `app/play/components/MultiplayerCanvas.tsx` | Set `isToken: false` in adapter; wire context menus; add zone counts; lift hoveredCard state |
| `app/play/components/ChatPanel.tsx` | Restyle from `position: fixed` slide-out to normal-flow sidebar panel |
| `app/play/[code]/client.tsx` | Flex container layout; wire ChatPanel + CardPreviewPanel |

---

## Task 1: Add `isToken` to GameCard type

**Files:**
- Modify: `app/goldfish/types.ts:50-70`

- [ ] **Step 1: Add `isToken` field to GameCard interface**

In `app/goldfish/types.ts`, add `isToken: boolean` to the `GameCard` interface after the `ownerId` field (around line 67):

```typescript
// Inside the GameCard interface, after ownerId line:
isToken: boolean;
```

- [ ] **Step 2: Verify TypeScript catches all missing `isToken` assignments**

Run: `npx tsc --noEmit 2>&1 | head -40`
Expected: Multiple TypeScript errors in files that create `GameCard` objects without `isToken`. This confirms every creation site needs updating.

- [ ] **Step 3: Commit**

```bash
git add app/goldfish/types.ts
git commit -m "feat: add isToken field to GameCard type"
```

---

## Task 2: Fix TOKEN label in GameCardNode

**Files:**
- Modify: `app/shared/components/GameCardNode.tsx:92`

- [ ] **Step 1: Update token check**

Change line 92 from:
```typescript
const isToken = card.ownerId === 'player2';
```
to:
```typescript
const isToken = card.isToken;
```

- [ ] **Step 2: Verify no other `player2` references in this file**

Run: `grep -n "player2" app/shared/components/GameCardNode.tsx`
Expected: No matches.

- [ ] **Step 3: Commit**

```bash
git add app/shared/components/GameCardNode.tsx
git commit -m "fix: use card.isToken instead of ownerId check for TOKEN badge"
```

---

## Task 3: Update goldfish gameInitializer to set isToken

**Files:**
- Modify: `app/goldfish/state/gameInitializer.ts:24-42`

- [ ] **Step 1: Add `isToken: false` to card creation in expandDeckCards()**

In the `GameCard` object literal inside `expandDeckCards()` (around line 24-42), add `isToken: false`:

```typescript
const card: GameCard = {
  instanceId: crypto.randomUUID(),
  ownerId: 'player1',
  isToken: false,  // <-- add this line
  zone: dc.is_reserve ? 'reserve' : 'deck',
  // ... rest unchanged
};
```

- [ ] **Step 2: Commit**

```bash
git add app/goldfish/state/gameInitializer.ts
git commit -m "fix: set isToken: false on all player deck cards"
```

---

## Task 4: Update goldfish gameReducer token handling

**Files:**
- Modify: `app/goldfish/state/gameReducer.ts:91,189,201,283`

- [ ] **Step 1: Update MOVE_CARD token check (line 91)**

Change:
```typescript
result.card.ownerId === 'player2'
```
to:
```typescript
result.card.isToken
```

- [ ] **Step 2: Update SHUFFLE_AND_MOVE_TO_TOP token check (line 189)**

Same change: `result.card.ownerId === 'player2'` → `result.card.isToken`

- [ ] **Step 3: Update SHUFFLE_AND_MOVE_TO_BOTTOM token check (line 201)**

Same change: `result.card.ownerId === 'player2'` → `result.card.isToken`

- [ ] **Step 4: Set `isToken: true` in ADD_OPPONENT_LOST_SOUL action (around line 359)**

Find the card object created in the ADD_OPPONENT_LOST_SOUL case and add `isToken: true`:

```typescript
const opponentCard: GameCard = {
  instanceId: crypto.randomUUID(),
  ownerId: 'player2',
  isToken: true,  // <-- add this
  // ... rest unchanged
};
```

- [ ] **Step 5: Check for any other `ownerId === 'player2'` in reducer**

Run: `grep -n "player2" app/goldfish/state/gameReducer.ts`
Expected: Only the `ownerId: 'player2'` assignment in ADD_OPPONENT_LOST_SOUL remains (that's correct — tokens ARE player2-owned, but the token *check* is now `isToken`).

- [ ] **Step 6: Commit**

```bash
git add app/goldfish/state/gameReducer.ts
git commit -m "fix: use isToken flag for token checks in game reducer"
```

---

## Task 5: Update goldfish CardContextMenu and MultiCardContextMenu

**Files:**
- Modify: `app/goldfish/components/CardContextMenu.tsx:7-9`
- Modify: `app/goldfish/components/MultiCardContextMenu.tsx:133`

- [ ] **Step 1: Update isOpponentToken() in CardContextMenu.tsx**

Change `isOpponentToken()` (lines 7-9) from:
```typescript
function isOpponentToken(card: GameCard): boolean {
  return card.ownerId === 'player2';
}
```
to:
```typescript
function isOpponentToken(card: GameCard): boolean {
  return card.isToken;
}
```

- [ ] **Step 2: Update MultiCardContextMenu.tsx token check**

Find the `allTokens` check (around line 133) and change:
```typescript
selectedCards.every(c => c.ownerId === 'player2')
```
to:
```typescript
selectedCards.every(c => c.isToken)
```

- [ ] **Step 3: Update GoldfishCanvas.tsx token check**

Find the opponent token rendering check (around line 283) and change:
```typescript
card?.ownerId === 'player2'
```
to:
```typescript
card?.isToken
```

- [ ] **Step 4: Verify no remaining `player2` token checks in goldfish components**

Run: `grep -rn "ownerId.*player2" app/goldfish/components/`
Expected: No matches (only the `ownerId: 'player2'` assignments in reducer should remain).

- [ ] **Step 5: Commit**

```bash
git add app/goldfish/components/CardContextMenu.tsx app/goldfish/components/MultiCardContextMenu.tsx app/goldfish/components/GoldfishCanvas.tsx
git commit -m "fix: use card.isToken for token checks in goldfish components"
```

---

## Task 6: Set isToken in multiplayer adapter

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx:64-93`

- [ ] **Step 1: Add `isToken: false` to cardInstanceToGameCard()**

In the `cardInstanceToGameCard()` function (lines 64-93), add `isToken: false` to the returned GameCard object:

```typescript
return {
  instanceId: String(card.id),
  ownerId: owner,
  isToken: false,  // <-- add this line
  zone: card.zone as GameCard['zone'],
  // ... rest unchanged
};
```

- [ ] **Step 2: Build to verify all isToken TypeScript errors are resolved**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors (or at least no errors related to `isToken`).

- [ ] **Step 3: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "fix: set isToken: false in multiplayer card adapter"
```

---

## Task 7: Rewrite mirrorLayout.ts — new zone order + inline piles

**Files:**
- Modify: `app/play/layout/mirrorLayout.ts` (full rewrite)

- [ ] **Step 1: Update the MirrorLayout interface**

The interface stays the same (no sidebar rects needed — left sidebar is HTML). But `myZones` and `opponentZones` now use the new zone order and inline pile positions.

- [ ] **Step 2: Rewrite calculateMirrorLayout()**

Replace the entire function body. Key changes:
1. Remove shared sidebar column — no `sidebarWidth`. Stage dimensions already exclude the HTML left sidebar.
2. Fix zone order — Opponent: Hand → LOB → Territory. Player: Territory → LOB → Hand.
3. Add inline pile columns (~12% width) at right edge of each player's board half.
4. New pile order — Player: LOR, Banish, Reserve, Deck, Discard. Opponent: Discard, Deck, Reserve, Banish, LOR.

```typescript
export function calculateMirrorLayout(
  stageWidth: number,
  stageHeight: number,
  isParagon: boolean = false
): MirrorLayout {
  // ── Row heights ──────────────────────────────────────────────────────
  const phaseBarHeight = Math.round(stageHeight * 0.05);
  const handHeight = Math.round(stageHeight * 0.07);
  const playAreaHeight = stageHeight - phaseBarHeight - handHeight * 2;
  const halfPlayHeight = Math.round(playAreaHeight / 2);

  const lobHeight = Math.round(halfPlayHeight * 0.25);
  const territoryHeight = halfPlayHeight - lobHeight;

  // ── Column widths ────────────────────────────────────────────────────
  const pileColumnWidth = Math.round(stageWidth * 0.12);
  const mainWidth = stageWidth - pileColumnWidth;

  // ── Y anchors — OPPONENT: Hand → LOB → Territory ────────────────────
  const oppHandY = 0;
  const oppLobY = handHeight;
  const oppTerritoryY = oppLobY + lobHeight;

  // ── Y anchors — PLAYER: Territory → LOB → Hand ──────────────────────
  const myTerritoryY = handHeight + halfPlayHeight;
  const myLobY = myTerritoryY + territoryHeight;
  const myHandY = myLobY + lobHeight;
  const phaseBarY = myHandY + handHeight;

  const pad = 6;
  const zonePad = 4;

  // ── Free-form zones ──────────────────────────────────────────────────
  const oppLobZone: ZoneRect = {
    x: pad, y: oppLobY + pad,
    width: mainWidth - pad * 2, height: lobHeight - pad * 2,
    label: 'Opponent Land of Bondage',
  };
  const oppTerritoryZone: ZoneRect = {
    x: pad, y: oppTerritoryY + pad,
    width: mainWidth - pad * 2, height: territoryHeight - pad * 2,
    label: 'Opponent Territory',
  };
  const myTerritoryZone: ZoneRect = {
    x: pad, y: myTerritoryY + pad,
    width: mainWidth - pad * 2, height: territoryHeight - pad * 2,
    label: 'Territory',
  };
  const myLobZone: ZoneRect = {
    x: pad, y: myLobY + pad,
    width: mainWidth - pad * 2, height: lobHeight - pad * 2,
    label: 'Land of Bondage',
  };

  // ── Inline pile sidebar helper ───────────────────────────────────────
  const buildSidebar = (
    sidebarAreaY: number, areaHeight: number,
    labels: string[], keys: string[]
  ): Record<string, ZoneRect> => {
    const count = labels.length;
    const slotPad = 4;
    const slotHeight = Math.round((areaHeight - slotPad * (count + 1)) / count);
    const result: Record<string, ZoneRect> = {};
    labels.forEach((label, i) => {
      result[keys[i]] = {
        x: mainWidth + zonePad,
        y: sidebarAreaY + slotPad * (i + 1) + slotHeight * i,
        width: pileColumnWidth - zonePad * 2,
        height: slotHeight,
        label,
      };
    });
    return result;
  };

  // Player piles: LOR (top) → Banish → Reserve → Deck → Discard (bottom)
  const myPileLabels = isParagon
    ? ['Land of Redemption', 'Banish Zone', 'Reserve', 'Deck', 'Discard', 'Paragon']
    : ['Land of Redemption', 'Banish Zone', 'Reserve', 'Deck', 'Discard'];
  const myPileKeys = isParagon
    ? ['land-of-redemption', 'banish', 'reserve', 'deck', 'discard', 'paragon']
    : ['land-of-redemption', 'banish', 'reserve', 'deck', 'discard'];

  // Opponent piles: Discard (top) → Deck → Reserve → Banish → LOR (bottom)
  const oppPileLabels = isParagon
    ? ['Paragon', 'Discard', 'Deck', 'Reserve', 'Banish Zone', 'Land of Redemption']
    : ['Discard', 'Deck', 'Reserve', 'Banish Zone', 'Land of Redemption'];
  const oppPileKeys = isParagon
    ? ['paragon', 'discard', 'deck', 'reserve', 'banish', 'land-of-redemption']
    : ['discard', 'deck', 'reserve', 'banish', 'land-of-redemption'];

  const mySidebar = buildSidebar(myTerritoryY, halfPlayHeight, myPileLabels, myPileKeys);
  const opponentSidebar = buildSidebar(oppLobY, halfPlayHeight, oppPileLabels, oppPileKeys);

  // ── Hand + phase bar ─────────────────────────────────────────────────
  const opponentHandRect: ZoneRect = {
    x: 0, y: oppHandY, width: stageWidth, height: handHeight, label: 'Opponent Hand',
  };
  const myHandRect: ZoneRect = {
    x: 0, y: myHandY, width: stageWidth, height: handHeight, label: 'Hand',
  };
  const phaseBarRect: ZoneRect = {
    x: 0, y: phaseBarY, width: stageWidth, height: phaseBarHeight, label: 'Phase Bar',
  };

  return {
    myZones: { territory: myTerritoryZone, 'land-of-bondage': myLobZone, ...mySidebar },
    opponentZones: { territory: oppTerritoryZone, 'land-of-bondage': oppLobZone, ...opponentSidebar },
    myHandRect, opponentHandRect, phaseBarRect,
  };
}
```

- [ ] **Step 3: Verify the layout compiles**

Run: `npx tsc --noEmit 2>&1 | grep mirrorLayout`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add app/play/layout/mirrorLayout.ts
git commit -m "feat: rewrite mirror layout — new zone order, inline piles, no shared sidebar"
```

---

## Task 8: Update MultiplayerCanvas rendering for new layout

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Update zone background rendering**

The canvas currently renders zone backgrounds for the old layout (shared sidebar). Update to:
1. Render opponent free-form zones (LOB above Territory) with the new Y positions from `mirrorLayout`.
2. Render player free-form zones (Territory above LOB) with new Y positions.
3. Render inline pile zones for each player at the right edge of their board half.
4. Remove the shared sidebar zone backgrounds.

- [ ] **Step 2: Add count badges to Territory and LOB zones**

In the zone label rendering section, after each free-form zone label text, add a count badge:

```typescript
// After the zone label Text node for territory/LOB:
<Rect
  x={zone.x + labelTextWidth + 8}
  y={zone.y + 4}
  width={24}
  height={18}
  fill="rgba(196, 149, 90, 0.25)"
  cornerRadius={4}
  stroke="rgba(196, 149, 90, 0.5)"
  strokeWidth={0.5}
/>
<Text
  x={zone.x + labelTextWidth + 8}
  y={zone.y + 5}
  width={24}
  text={String(cardsInZone.length)}
  fontSize={11}
  fill="#e8d5a3"
  align="center"
/>
```

Do this for all 4 free-form zones: my territory, my LOB, opponent territory, opponent LOB.

- [ ] **Step 3: Add hoveredCard state and lift it for the preview panel**

Add state to track the last hovered card:
```typescript
const [hoveredCard, setHoveredCard] = useState<GameCard | null>(null);
```

Update `onMouseEnter` handlers to call `setHoveredCard(card)`. Do NOT clear on `onMouseLeave` — the preview persists showing the last hovered card.

Expose `hoveredCard` via a callback prop or ref so the parent `client.tsx` can pass it to `CardPreviewPanel`.

- [ ] **Step 4: Build to verify**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: update canvas rendering for new mirror layout with zone counts"
```

---

## Task 9: Create shared GameActions interface

**Files:**
- Create: `app/shared/types/gameActions.ts`

- [ ] **Step 1: Create the shared types directory and interface**

```typescript
import type { GameCard } from '@/app/goldfish/types';

/**
 * Common interface for game actions shared between goldfish and multiplayer modes.
 * All IDs are strings — multiplayer adapter converts to bigint internally.
 */
export interface GameActions {
  // Core card operations
  moveCard(cardId: string, toZone: string, posX?: string, posY?: string): void;
  moveCardsBatch(cardIds: string[], toZone: string): void;
  flipCard(cardId: string): void;
  meekCard(cardId: string): void;
  unmeekCard(cardId: string): void;
  addCounter(cardId: string, color: string): void;
  removeCounter(cardId: string, color: string): void;
  shuffleCardIntoDeck(cardId: string): void;
  shuffleDeck(): void;
  setNote(cardId: string, text: string): void;
  exchangeCards(cardIds: string[]): void;
  drawCard(): void;
  drawMultiple(count: number): void;

  // Goldfish-only (optional — undefined in multiplayer)
  moveCardToTopOfDeck?(cardId: string): void;
  moveCardToBottomOfDeck?(cardId: string): void;
  removeOpponentToken?(cardId: string): void;

  // Deck inspection (optional — may not be available in all modes)
  searchDeck?(): void;
  peekTopN?(count: number): void;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/shared/types/gameActions.ts
git commit -m "feat: add shared GameActions interface for context menus"
```

---

## Task 10a: Create shared CardContextMenu + MultiCardContextMenu

**Files:**
- Create: `app/shared/components/CardContextMenu.tsx`
- Create: `app/shared/components/MultiCardContextMenu.tsx`

- [ ] **Step 1: Create shared CardContextMenu**

Copy `app/goldfish/components/CardContextMenu.tsx` to `app/shared/components/CardContextMenu.tsx`. Refactor:
1. Remove `useGame()` import — accept `actions: GameActions` and `card: GameCard` as props.
2. Replace `moveCard(card.instanceId, zone)` → `actions.moveCard(card.instanceId, zone)`.
3. Replace `removeOpponentToken(card.instanceId)` → `actions.removeOpponentToken?.(card.instanceId)`. Conditionally render "Remove Token" only when `actions.removeOpponentToken` is defined.
4. Replace `moveCardToTopOfDeck(card.instanceId)` → `actions.moveCardToTopOfDeck?.(card.instanceId)`. Hide button when undefined.
5. Replace `moveCardToBottomOfDeck(card.instanceId)` → `actions.moveCardToBottomOfDeck?.(card.instanceId)`. Hide when undefined.
6. Replace `addCounter`/`removeCounter`/`flipCard`/`meekCard`/`unmeekCard`/`shuffleCardIntoDeck`/`addNote` → `actions.xxx(card.instanceId, ...)`.
7. Change `isOpponentToken(card)` → `card.isToken`.

Props interface:
```typescript
interface CardContextMenuProps {
  card: GameCard;
  x: number;
  y: number;
  actions: GameActions;
  onClose: () => void;
}
```

- [ ] **Step 2: Create shared MultiCardContextMenu**

Copy `app/goldfish/components/MultiCardContextMenu.tsx` to `app/shared/components/MultiCardContextMenu.tsx`. Refactor:
1. Remove `useGame()` import — accept `actions: GameActions` as prop.
2. Replace `allTokens` check: `selectedCards.every(c => c.ownerId === 'player2')` → `selectedCards.every(c => c.isToken)`.
3. Replace all action calls with `actions.xxx(...)`.

- [ ] **Step 3: Commit**

```bash
git add app/shared/components/CardContextMenu.tsx app/shared/components/MultiCardContextMenu.tsx
git commit -m "feat: create shared CardContextMenu and MultiCardContextMenu"
```

---

## Task 10b: Create shared DeckContextMenu + ZoneContextMenu

**Files:**
- Create: `app/shared/components/DeckContextMenu.tsx`
- Create: `app/shared/components/ZoneContextMenu.tsx`

- [ ] **Step 1: Create shared DeckContextMenu**

Copy `app/goldfish/components/DeckContextMenu.tsx` to `app/shared/components/DeckContextMenu.tsx`. This component already uses callback props rather than `useGame()` directly — verify and adapt to use `GameActions` where applicable. Callbacks like `onSearchDeck`, `onRevealTop`, etc. that are goldfish-specific should be optional props (conditionally rendered).

- [ ] **Step 2: Create shared ZoneContextMenu**

Copy `app/goldfish/components/ZoneContextMenu.tsx` to `app/shared/components/ZoneContextMenu.tsx`. Same pattern — accept `actions: GameActions` as prop.

- [ ] **Step 3: Commit**

```bash
git add app/shared/components/DeckContextMenu.tsx app/shared/components/ZoneContextMenu.tsx
git commit -m "feat: create shared DeckContextMenu and ZoneContextMenu"
```

---

## Task 10c: Wire shared menus into GoldfishCanvas + delete old menu files

**Files:**
- Modify: `app/goldfish/components/GoldfishCanvas.tsx`
- Delete: `app/goldfish/components/CardContextMenu.tsx`
- Delete: `app/goldfish/components/MultiCardContextMenu.tsx`
- Delete: `app/goldfish/components/DeckContextMenu.tsx`
- Delete: `app/goldfish/components/ZoneContextMenu.tsx`

- [ ] **Step 1: Create goldfish GameActions adapter in GoldfishCanvas**

```typescript
const goldfishActions: GameActions = useMemo(() => ({
  moveCard: (cardId, toZone, posX, posY) => dispatch(gameActions.moveCard(cardId, toZone, posX, posY)),
  moveCardsBatch: (cardIds, toZone) => dispatch(gameActions.moveCardsBatch(cardIds, toZone)),
  flipCard: (cardId) => dispatch(gameActions.flipCard(cardId)),
  meekCard: (cardId) => dispatch(gameActions.meekCard(cardId)),
  unmeekCard: (cardId) => dispatch(gameActions.unmeekCard(cardId)),
  addCounter: (cardId, color) => dispatch(gameActions.addCounter(cardId, color)),
  removeCounter: (cardId, color) => dispatch(gameActions.removeCounter(cardId, color)),
  shuffleCardIntoDeck: (cardId) => dispatch(gameActions.shuffleCardIntoDeck(cardId)),
  shuffleDeck: () => dispatch(gameActions.shuffleDeck()),
  setNote: (cardId, text) => dispatch(gameActions.addNote(cardId, text)),
  exchangeCards: (cardIds) => dispatch(gameActions.exchangeCards(cardIds)),
  drawCard: () => dispatch(gameActions.drawCard()),
  drawMultiple: (count) => dispatch(gameActions.drawMultiple(count)),
  moveCardToTopOfDeck: (cardId) => dispatch(gameActions.moveCardToTopOfDeck(cardId)),
  moveCardToBottomOfDeck: (cardId) => dispatch(gameActions.moveCardToBottomOfDeck(cardId)),
  removeOpponentToken: (cardId) => dispatch(gameActions.removeOpponentToken(cardId)),
}), [dispatch]);
```

- [ ] **Step 2: Replace old imports with shared components**

Change imports from `./CardContextMenu` → `@/app/shared/components/CardContextMenu`, etc. Pass `actions={goldfishActions}` to each shared menu component.

- [ ] **Step 3: Delete old goldfish-specific context menu files**

```bash
rm app/goldfish/components/CardContextMenu.tsx
rm app/goldfish/components/MultiCardContextMenu.tsx
rm app/goldfish/components/DeckContextMenu.tsx
rm app/goldfish/components/ZoneContextMenu.tsx
```

Note: `LorContextMenu.tsx` stays in goldfish — it's goldfish-only (handles adding Lost Souls to opponent's Land of Redemption).

- [ ] **Step 4: Verify goldfish mode still builds**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire shared context menus into goldfish, delete old menu files"
```

---

## Task 11: Wire context menus into MultiplayerCanvas

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`
- Delete: `app/play/components/ContextMenus.tsx` (existing multiplayer menus with `bigint` IDs — replaced by shared components + adapter)

- [ ] **Step 1: Create multiplayer GameActions adapter**

In `MultiplayerCanvas.tsx`, create the adapter that wraps `useGameState()` methods:

```typescript
const multiplayerActions: GameActions = useMemo(() => ({
  moveCard: (cardId, toZone, posX, posY) =>
    gameState.moveCard(BigInt(cardId), toZone, undefined, posX, posY),
  moveCardsBatch: (cardIds, toZone) =>
    gameState.moveCardsBatch(cardIds.join(','), toZone),
  flipCard: (cardId) => gameState.flipCard(BigInt(cardId)),
  meekCard: (cardId) => gameState.meekCard(BigInt(cardId)),
  unmeekCard: (cardId) => gameState.unmeekCard(BigInt(cardId)),
  addCounter: (cardId, color) => gameState.addCounter(BigInt(cardId), color),
  removeCounter: (cardId, color) => gameState.removeCounter(BigInt(cardId), color),
  shuffleCardIntoDeck: (cardId) => gameState.shuffleCardIntoDeck(BigInt(cardId)),
  shuffleDeck: () => gameState.shuffleDeck(),
  setNote: (cardId, text) => gameState.setNote(BigInt(cardId), text),
  exchangeCards: (cardIds) => gameState.exchangeCards(cardIds.join(',')),
  drawCard: () => gameState.drawCard(),
  drawMultiple: (count) => gameState.drawMultiple(BigInt(count)),
  // Goldfish-only — not available in multiplayer
  moveCardToTopOfDeck: undefined,
  moveCardToBottomOfDeck: undefined,
  removeOpponentToken: undefined,
}), [gameState]);
```

- [ ] **Step 2: Replace noopContextMenu with real handler**

Replace the `noopContextMenu` callback with a handler that opens the shared `CardContextMenu`:

```typescript
const [contextMenu, setContextMenu] = useState<{
  card: GameCard; x: number; y: number;
} | null>(null);

const handleContextMenu = useCallback(
  (card: GameCard, e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (pos) setContextMenu({ card, x: pos.x, y: pos.y });
  }, []
);
```

- [ ] **Step 3: Render shared context menu components**

Add the shared context menu components to the JSX, rendered outside the Konva Stage (as React DOM overlays):

```typescript
{contextMenu && (
  <CardContextMenu
    card={contextMenu.card}
    x={contextMenu.x}
    y={contextMenu.y}
    actions={multiplayerActions}
    onClose={() => setContextMenu(null)}
  />
)}
```

Similarly wire `DeckContextMenu`, `ZoneContextMenu`, and `MultiCardContextMenu` with appropriate state and handlers.

- [ ] **Step 4: Delete old ContextMenus.tsx**

```bash
rm app/play/components/ContextMenus.tsx
```

This file had multiplayer-specific menu implementations with `bigint` IDs. The shared components + adapter pattern replaces it entirely.

- [ ] **Step 5: Build and verify**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: wire shared context menus into multiplayer canvas, delete old ContextMenus.tsx"
```

---

## Task 12: Create CardPreviewPanel component

**Files:**
- Create: `app/play/components/CardPreviewPanel.tsx`

- [ ] **Step 1: Create the component**

```typescript
'use client';

import Image from 'next/image';
import type { GameCard } from '@/app/goldfish/types';

interface CardPreviewPanelProps {
  card: GameCard | null;
}

export default function CardPreviewPanel({ card }: CardPreviewPanelProps) {
  if (!card) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'rgba(232, 213, 163, 0.3)',
        fontSize: 12, fontStyle: 'italic', padding: 16,
        fontFamily: 'var(--font-geist-sans, system-ui, sans-serif)',
      }}>
        Hover a card to preview
      </div>
    );
  }

  const showBack = card.isFlipped;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      padding: 8, overflow: 'hidden',
      fontFamily: 'var(--font-geist-sans, system-ui, sans-serif)',
    }}>
      {/* Card image */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1.4' }}>
        {showBack ? (
          <div style={{
            width: '100%', height: '100%',
            background: 'linear-gradient(135deg, #2a1f14, #1a150e)',
            border: '1px solid rgba(107, 78, 39, 0.4)',
            borderRadius: 4,
          }} />
        ) : card.cardImgFile ? (
          <Image
            src={card.cardImgFile}
            alt={card.cardName}
            fill
            style={{ objectFit: 'contain', borderRadius: 4 }}
            sizes="220px"
          />
        ) : null}
      </div>

      {/* Card info */}
      <div style={{ fontSize: 12, color: '#e8d5a3', lineHeight: 1.4 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{card.cardName}</div>
        {card.type && (
          <div style={{ color: 'rgba(232, 213, 163, 0.6)', fontSize: 11 }}>
            {card.type}
            {card.brigade ? ` · ${card.brigade}` : ''}
          </div>
        )}
        {(card.strength || card.toughness) && (
          <div style={{ fontSize: 11, color: 'rgba(232, 213, 163, 0.5)' }}>
            {card.strength}/{card.toughness}
          </div>
        )}
        {card.specialAbility && (
          <div style={{
            marginTop: 4, fontSize: 11, color: 'rgba(232, 213, 163, 0.7)',
            maxHeight: 120, overflowY: 'auto', lineHeight: 1.45,
          }}>
            {card.specialAbility}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/play/components/CardPreviewPanel.tsx
git commit -m "feat: add CardPreviewPanel component for left sidebar"
```

---

## Task 13: Restyle ChatPanel for left sidebar

**Files:**
- Modify: `app/play/components/ChatPanel.tsx`

- [ ] **Step 1: Restyle from fixed slide-out to normal-flow panel**

Two elements have `position: fixed` that must be changed:

**Toggle button (line ~150):** Currently `position: fixed`, `right: isOpen ? 322 : 0`, vertical `writingMode: 'vertical-rl'`. Replace with:
- `position: relative` (normal flow)
- Remove `right`, `top`, `transform` properties
- Remove `writingMode: 'vertical-rl'` — button is now horizontal
- Change to a horizontal row: icon + "Chat" text + unread badge, left-aligned
- Style: `width: '100%'`, `padding: '8px 12px'`, horizontal layout

**Main panel (line ~219):** Currently `position: fixed`, `right: isOpen ? 0 : -320`, `width: 320`, `height: '100dvh'`. Replace with:
- Remove `position: fixed`, `right`, `width`, `height`
- Add `flex: 1`, `overflow: hidden`, `display: flex`, `flexDirection: column`
- The panel now fills its parent container naturally

**Collapse behavior:** When `isOpen` is false, hide the panel content (tabs, messages, input) and show only the toggle button row with unread badge. When `isOpen` is true, show everything. Use `display: none` / `display: flex` toggle instead of CSS `right` offset animation.

The internal content (message list, input row, tabs, game log) stays unchanged.

- [ ] **Step 2: Build to verify**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/play/components/ChatPanel.tsx
git commit -m "feat: restyle ChatPanel from slide-out to left sidebar panel"
```

---

## Task 14: Wire everything in client.tsx — flex layout + ChatPanel + CardPreviewPanel

**Files:**
- Modify: `app/play/[code]/client.tsx`

- [ ] **Step 1: Create flex container layout**

Wrap the game UI in a flex row: left HTML sidebar + Konva canvas area.

```typescript
// Inside the 'playing' state render:
<div style={{ display: 'flex', width: '100vw', height: '100dvh' }}>
  {/* Left sidebar — HTML */}
  <div style={{
    width: 'clamp(150px, 10vw, 220px)',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(10, 8, 5, 0.97)',
    borderRight: '1px solid rgba(107, 78, 39, 0.3)',
  }}>
    {/* Card Preview — top */}
    <div style={{ flexShrink: 0, borderBottom: '1px solid rgba(107, 78, 39, 0.2)' }}>
      <CardPreviewPanel card={hoveredCard} />
    </div>
    {/* Chat — bottom, takes remaining space */}
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <ChatPanel
        chatMessages={gameState.chatMessages}
        gameActions={gameState.gameActionLog}
        myPlayerId={gameState.myPlayer?.id ?? BigInt(0)}
        onSendChat={gameState.sendChat}
        playerNames={playerNameMap}
      />
    </div>
  </div>

  {/* Game canvas — takes remaining width */}
  <div style={{ flex: 1, position: 'relative' }}>
    <MultiplayerCanvas
      gameId={gameId}
      onHoveredCardChange={setHoveredCard}
    />
  </div>
</div>
```

- [ ] **Step 2: Add hoveredCard state to client.tsx**

```typescript
const [hoveredCard, setHoveredCard] = useState<GameCard | null>(null);
```

Update `MultiplayerCanvas` to accept an `onHoveredCardChange` callback prop and call it from its `onMouseEnter` handler.

- [ ] **Step 3: Build playerNameMap from game state**

```typescript
const playerNameMap = useMemo(() => {
  const map: Record<string, string> = {};
  if (gameState.myPlayer) map[gameState.myPlayer.id.toString()] = gameState.myPlayer.displayName;
  if (gameState.opponentPlayer) map[gameState.opponentPlayer.id.toString()] = gameState.opponentPlayer.displayName;
  return map;
}, [gameState.myPlayer, gameState.opponentPlayer]);
```

- [ ] **Step 4: Build and verify**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/play/[code]/client.tsx app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: wire flex layout with CardPreviewPanel and ChatPanel"
```

---

## Task 15: Create dummy /play/test route for Playwright

**Files:**
- Create: `app/play/test/page.tsx`

- [ ] **Step 1: Create mock game state page**

Create a page that renders the game UI with static mock data — no SpacetimeDB connection. Include:
- Two players with display names
- 5 cards in each player's hand
- 3 cards in each territory
- 2 cards in each LOB
- Cards in each pile zone (deck: 40, discard: 3, reserve: 2, banish: 1, LOR: 1)
- A few chat messages
- A few game actions in the log

This is a client component that mocks the game state shape and renders `MultiplayerCanvas` + left sidebar directly.

- [ ] **Step 2: Verify the page renders**

Run: `npm run dev` and navigate to `http://localhost:3000/play/test`
Expected: Game board renders with mock data, both players' zones visible, pile zones show counts.

- [ ] **Step 3: Commit**

```bash
git add app/play/test/page.tsx
git commit -m "feat: add dummy /play/test route for visual testing"
```

---

## Task 16: Final build verification + screenshots

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Visual smoke test**

Start dev server and verify at `http://localhost:3000/play/test`:
1. Both players' zones render in correct order (Opp: Hand → LOB → Territory | Player: Territory → LOB → Hand)
2. Pile zones appear inline at right edge of each player's board half
3. No "TOKEN" badges on regular cards
4. Card preview panel shows in left sidebar on hover
5. Chat panel visible in left sidebar below preview
6. Zone count badges visible on Territory and LOB zones
7. Right-click on a card opens context menu

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "fix: final adjustments from visual testing"
```
