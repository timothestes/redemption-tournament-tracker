# Play Mode Context Menus & Deck Operations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire goldfish mode's right-click context menus and deck modals into play mode so both modes have feature parity.

**Architecture:** Four deck/zone modals currently hardcode `useGame()` from goldfish context. We create a `ModalGameContext` abstraction that both modes can provide, then refactor the modals to use it. Three simple menu components (DeckContextMenu, DeckDropPopup, LorContextMenu) are already decoupled and just need wiring into MultiplayerCanvas.

**Tech Stack:** React 19, Konva.js (react-konva), SpacetimeDB, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-25-play-mode-context-menus-design.md`

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `app/shared/contexts/ModalGameContext.tsx` | **CREATE** | Context + provider for modal game state/actions |
| `app/shared/components/DeckSearchModal.tsx` | MODIFY | Replace `useGame()` → `useModalGame()` |
| `app/shared/components/DeckPeekModal.tsx` | MODIFY | Replace `useGame()` → `useModalGame()` |
| `app/shared/components/DeckExchangeModal.tsx` | MODIFY | Replace `useGame()` → `useModalGame()` |
| `app/shared/components/ZoneBrowseModal.tsx` | MODIFY | Replace `useGame()` → `useModalGame()`, add `readOnly` prop |
| `app/goldfish/components/GoldfishCanvas.tsx` | MODIFY | Wrap modals with `ModalGameProvider` |
| `app/play/components/MultiplayerCanvas.tsx` | MODIFY | Add all menus, modals, ModalGameProvider, useModalCardDrag |

---

## Task 1: Create ModalGameContext

**Files:**
- Create: `app/shared/contexts/ModalGameContext.tsx`

- [ ] **Step 1: Create the context directory and file**

```typescript
// app/shared/contexts/ModalGameContext.tsx
'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { GameCard, ZoneId } from '@/app/shared/types/gameCard';

export interface ModalGameActions {
  moveCard(instanceId: string, toZone: ZoneId, toIndex?: number, posX?: number, posY?: number): void;
  moveCardsBatch(instanceIds: string[], toZone: ZoneId): void;
  moveCardToTopOfDeck(instanceId: string): void;
  moveCardToBottomOfDeck(instanceId: string): void;
  shuffleDeck(): void;
  shuffleCardIntoDeck(instanceId: string): void;
}

export interface ModalGameContextValue {
  zones: Record<string, GameCard[]>;
  actions: ModalGameActions;
}

const ModalGameContext = createContext<ModalGameContextValue | null>(null);

export function ModalGameProvider({ children, value }: { children: ReactNode; value: ModalGameContextValue }) {
  return <ModalGameContext.Provider value={value}>{children}</ModalGameContext.Provider>;
}

export function useModalGame(): ModalGameContextValue {
  const ctx = useContext(ModalGameContext);
  if (!ctx) throw new Error('useModalGame must be used within a ModalGameProvider');
  return ctx;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add app/shared/contexts/ModalGameContext.tsx
git commit -m "feat: add ModalGameContext for mode-agnostic modal game state"
```

---

## Task 2: Refactor DeckSearchModal to use ModalGameContext

**Files:**
- Modify: `app/shared/components/DeckSearchModal.tsx`

**Key context:** This modal currently calls `useGame()` at line 131 to get `state`, `moveCard`, `moveCardsBatch`, `moveCardToTopOfDeck`, `moveCardToBottomOfDeck`, `shuffleDeck`. It also calls `useCardPreview()` at line 9 (this stays — CardPreviewProvider is available in both modes).

- [ ] **Step 1: Replace imports**

Replace:
```typescript
import { useGame } from '@/app/goldfish/state/GameContext';
```
With:
```typescript
import { useModalGame } from '@/app/shared/contexts/ModalGameContext';
```

- [ ] **Step 2: Replace useGame() destructure**

At line 131, replace:
```typescript
const { state, moveCard, moveCardsBatch, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleDeck } = useGame();
```
With:
```typescript
const { zones, actions } = useModalGame();
const { moveCard, moveCardsBatch, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleDeck } = actions;
```

- [ ] **Step 3: Replace all `state.zones.deck` references with `zones.deck`**

Search for `state.zones` in the file and replace with `zones`. This pattern appears in deck card filtering (where it reads `state.zones.deck`).

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add app/shared/components/DeckSearchModal.tsx
git commit -m "refactor: DeckSearchModal uses ModalGameContext instead of useGame()"
```

---

## Task 3: Refactor DeckPeekModal to use ModalGameContext

**Files:**
- Modify: `app/shared/components/DeckPeekModal.tsx`

**Key context:** Line 70 calls `useGame()` to get `state`, `moveCardsBatch`, `shuffleDeck`. Line 9 calls `useCardPreview()` (stays).

- [ ] **Step 1: Replace imports**

Replace:
```typescript
import { useGame } from '@/app/goldfish/state/GameContext';
```
With:
```typescript
import { useModalGame } from '@/app/shared/contexts/ModalGameContext';
```

- [ ] **Step 2: Replace useGame() destructure**

At line 70, replace:
```typescript
const { state, moveCardsBatch, shuffleDeck } = useGame();
```
With:
```typescript
const { zones, actions } = useModalGame();
const { moveCardsBatch, shuffleDeck } = actions;
```

- [ ] **Step 3: Replace all `state.zones.deck` with `zones.deck`**

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add app/shared/components/DeckPeekModal.tsx
git commit -m "refactor: DeckPeekModal uses ModalGameContext instead of useGame()"
```

---

## Task 4: Refactor DeckExchangeModal to use ModalGameContext

**Files:**
- Modify: `app/shared/components/DeckExchangeModal.tsx`

**Key context:** Line 31 calls `useGame()` to get `state`, `moveCard`, `moveCardToTopOfDeck`, `shuffleDeck`. Line 9 calls `useCardPreview()` (stays).

- [ ] **Step 1: Replace imports**

Replace:
```typescript
import { useGame } from '@/app/goldfish/state/GameContext';
```
With:
```typescript
import { useModalGame } from '@/app/shared/contexts/ModalGameContext';
```

- [ ] **Step 2: Replace useGame() destructure**

At line 31, replace:
```typescript
const { state, moveCard, moveCardToTopOfDeck, shuffleDeck } = useGame();
```
With:
```typescript
const { zones, actions } = useModalGame();
const { moveCard, moveCardToTopOfDeck, shuffleDeck } = actions;
```

- [ ] **Step 3: Replace `state.zones.deck` with `zones.deck`**

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add app/shared/components/DeckExchangeModal.tsx
git commit -m "refactor: DeckExchangeModal uses ModalGameContext instead of useGame()"
```

---

## Task 5: Refactor ZoneBrowseModal to use ModalGameContext + add readOnly prop

**Files:**
- Modify: `app/shared/components/ZoneBrowseModal.tsx`

**Key context:** Line 146 calls `useGame()` to get `state`, `moveCard`, `moveCardsBatch`, `moveCardToTopOfDeck`, `moveCardToBottomOfDeck`, `shuffleCardIntoDeck`. Line 9 calls `useCardPreview()` (stays). Needs a `readOnly` prop for opponent zone browsing in play mode.

- [ ] **Step 1: Replace imports**

Replace:
```typescript
import { useGame } from '@/app/goldfish/state/GameContext';
```
With:
```typescript
import { useModalGame } from '@/app/shared/contexts/ModalGameContext';
```

- [ ] **Step 2: Add readOnly to props interface**

In `ZoneBrowseModalProps` (around line 136), add:
```typescript
readOnly?: boolean;
```

And destructure it in the function params.

- [ ] **Step 3: Replace useGame() destructure**

At line 146, replace:
```typescript
const { state, moveCard, moveCardsBatch, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleCardIntoDeck } = useGame();
```
With:
```typescript
const { zones, actions } = useModalGame();
const { moveCard, moveCardsBatch, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleCardIntoDeck } = actions;
```

- [ ] **Step 4: Replace `state.zones[zoneId]` with `zones[zoneId]`**

- [ ] **Step 5: Guard action buttons with readOnly**

Wrap the action buttons/drag handlers so they don't render or fire when `readOnly` is true. Find the move-to-zone buttons and the drag pointer handlers, and conditionally disable them:
```typescript
// In the card context popup and drag handlers:
if (readOnly) return;
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add app/shared/components/ZoneBrowseModal.tsx
git commit -m "refactor: ZoneBrowseModal uses ModalGameContext, add readOnly prop"
```

---

## Task 6: Wrap Goldfish Modals with ModalGameProvider

**Files:**
- Modify: `app/goldfish/components/GoldfishCanvas.tsx`

**Key context:** GoldfishCanvas already renders DeckSearchModal (line 1691), DeckPeekModal (line 1701), DeckExchangeModal (line 1884), ZoneBrowseModal (line 1680). It already has `useGame()` destructured. We wrap these renders with `ModalGameProvider`.

- [ ] **Step 1: Add import**

```typescript
import { ModalGameProvider, type ModalGameContextValue } from '@/app/shared/contexts/ModalGameContext';
```

- [ ] **Step 2: Build the provider value**

Near the other memoized values, add:
```typescript
const modalGameValue = useMemo<ModalGameContextValue>(() => ({
  zones: state.zones,
  actions: {
    moveCard,
    moveCardsBatch,
    moveCardToTopOfDeck,
    moveCardToBottomOfDeck,
    shuffleDeck,
    shuffleCardIntoDeck,
  },
}), [state.zones, moveCard, moveCardsBatch, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleDeck, shuffleCardIntoDeck]);
```

Note: These function names come from `useGame()` — goldfish's `GameContextValue` provides them all directly. `exchangeCards` is intentionally NOT included — the `DeckExchangeModal` implements exchange logic internally using `moveCard` + `moveCardToTopOfDeck` + `shuffleDeck`, not a single `exchangeCards` call.

- [ ] **Step 3: Wrap modal renders with provider**

Find the section where modals are rendered (around lines 1679-1898). Wrap the modal JSX block with:
```tsx
<ModalGameProvider value={modalGameValue}>
  {browseZone !== null && <ZoneBrowseModal ... />}
  {showDeckSearch && <DeckSearchModal ... />}
  {peekState && <DeckPeekModal ... />}
  {exchangeCardIds && <DeckExchangeModal ... />}
</ModalGameProvider>
```

- [ ] **Step 4: Verify goldfish mode still works**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

Then manually test: open goldfish mode, right-click deck, search deck, peek, exchange, browse zones. Everything should work identically.

- [ ] **Step 5: Commit**

```bash
git add app/goldfish/components/GoldfishCanvas.tsx
git commit -m "feat: wrap goldfish modals with ModalGameProvider"
```

---

## Task 7: Wire Simple Menus into MultiplayerCanvas (DeckContextMenu, LorContextMenu, DeckDropPopup)

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

These three components are already decoupled from goldfish context — they accept all data via props.

- [ ] **Step 1: Add imports**

```typescript
import { DeckContextMenu } from '@/app/shared/components/DeckContextMenu';
import { DeckDropPopup } from '@/app/shared/components/DeckDropPopup';
import { LorContextMenu } from '@/app/shared/components/LorContextMenu';
```

- [ ] **Step 2: Add state variables**

After the existing `zoneMenu` state (line 372):
```typescript
const [deckMenu, setDeckMenu] = useState<{ x: number; y: number } | null>(null);
const [lorMenu, setLorMenu] = useState<{ x: number; y: number } | null>(null);
const [deckDrop, setDeckDrop] = useState<{ x: number; y: number; cardId: string } | null>(null);
```

- [ ] **Step 3: Add closeAllMenus helper**

```typescript
const closeAllMenus = useCallback(() => {
  setContextMenu(null);
  setMultiCardContextMenu(null);
  setZoneMenu(null);
  setDeckMenu(null);
  setLorMenu(null);
  setDeckDrop(null);
  setBrowseMyZone(null);
  setBrowseOpponentZone(null);
}, []);
```

- [ ] **Step 4: Add moveDeckCardsToZone helper**

For DeckContextMenu's discard/reserve/draw-from-bottom/random callbacks:
```typescript
const moveDeckCardsToZone = useCallback((
  position: 'top' | 'bottom' | 'random',
  count: number,
  targetZone: string,
) => {
  const deckCards = [...(myCards['deck'] ?? [])].sort(
    (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex)
  );
  let selected: typeof deckCards;
  if (position === 'top') selected = deckCards.slice(0, count);
  else if (position === 'bottom') selected = deckCards.slice(-count);
  else {
    const shuffled = [...deckCards];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    selected = shuffled.slice(0, count);
  }
  const ids = selected.map(c => String(c.id));
  if (ids.length > 0) multiplayerActions.moveCardsBatch(ids, targetZone);
}, [myCards, multiplayerActions]);
```

- [ ] **Step 5: Add right-click handler to deck pile Group**

Find the my-sidebar-piles section (line ~1553, the `SIDEBAR_ZONES.map` block). The deck pile `<Group>` currently has `onDblClick` but no `onContextMenu`. Add to the `<Group>`:
```typescript
onContextMenu={zoneKey === 'deck' ? (e: Konva.KonvaEventObject<PointerEvent>) => {
  e.evt.preventDefault();
  const stage = stageRef.current;
  if (!stage) return;
  const container = stage.container().getBoundingClientRect();
  closeAllMenus();
  setDeckMenu({
    x: e.evt.clientX - container.left,
    y: e.evt.clientY - container.top,
  });
} : undefined}
```

- [ ] **Step 6: Add right-click handler to L.O.R. pile Group**

In the same sidebar map, add for L.O.R.:
```typescript
onContextMenu={zoneKey === 'land-of-redemption' ? (e: Konva.KonvaEventObject<PointerEvent>) => {
  e.evt.preventDefault();
  const stage = stageRef.current;
  if (!stage) return;
  const container = stage.container().getBoundingClientRect();
  closeAllMenus();
  setLorMenu({
    x: e.evt.clientX - container.left,
    y: e.evt.clientY - container.top,
  });
} : undefined}
```

- [ ] **Step 7: Intercept deck drops for DeckDropPopup**

In `handleCardDragEnd` (line 765-767), replace:
```typescript
} else if (targetZone === 'deck') {
  // Deck: for now just move to deck (Task 17 adds top/bottom/shuffle popup)
  moveCard(cardId, targetZone, '0');
```
With:
```typescript
} else if (targetZone === 'deck') {
  const stage = stageRef.current;
  if (stage) {
    const pointer = stage.getPointerPosition();
    const container = stage.container().getBoundingClientRect();
    setDeckDrop({
      x: (pointer?.x ?? container.width / 2),
      y: (pointer?.y ?? container.height / 2),
      cardId,
    });
  } else {
    moveCard(cardId, targetZone, '0');
  }
```

- [ ] **Step 8: Add onExchange prop to CardContextMenu render**

Find the `CardContextMenu` render (line ~1902). Add the `onExchange` prop:
```tsx
<CardContextMenu
  card={contextMenu.card}
  x={contextMenu.x}
  y={contextMenu.y}
  actions={multiplayerActions}
  onClose={() => setContextMenu(null)}
  onExchange={(cardIds) => { setContextMenu(null); setExchangeCardIds(cardIds); }}
/>
```

(This requires `exchangeCardIds` state — added in Task 8.)

- [ ] **Step 9: Render the three menu components**

After the existing `zoneMenu` JSX block (after line ~1934), add:

```tsx
{deckMenu && (
  <DeckContextMenu
    x={deckMenu.x}
    y={deckMenu.y}
    deckSize={(myCards['deck'] ?? []).length}
    onClose={() => setDeckMenu(null)}
    onSearchDeck={() => { setDeckMenu(null); setShowDeckSearch(true); }}
    onShuffleDeck={() => { multiplayerActions.shuffleDeck(); setDeckMenu(null); }}
    onDrawTop={(n) => { multiplayerActions.drawMultiple(n); setDeckMenu(null); }}
    onRevealTop={(n) => { setDeckMenu(null); setPeekState({ position: 'top', count: n }); }}
    onDiscardTop={(n) => { moveDeckCardsToZone('top', n, 'discard'); setDeckMenu(null); }}
    onReserveTop={(n) => { moveDeckCardsToZone('top', n, 'reserve'); setDeckMenu(null); }}
    onDrawBottom={(n) => { moveDeckCardsToZone('bottom', n, 'hand'); setDeckMenu(null); }}
    onRevealBottom={(n) => { setDeckMenu(null); setPeekState({ position: 'bottom', count: n }); }}
    onDiscardBottom={(n) => { moveDeckCardsToZone('bottom', n, 'discard'); setDeckMenu(null); }}
    onReserveBottom={(n) => { moveDeckCardsToZone('bottom', n, 'reserve'); setDeckMenu(null); }}
    onDrawRandom={(n) => { moveDeckCardsToZone('random', n, 'hand'); setDeckMenu(null); }}
    onRevealRandom={(n) => { setDeckMenu(null); setPeekState({ position: 'random', count: n }); }}
    onDiscardRandom={(n) => { moveDeckCardsToZone('random', n, 'discard'); setDeckMenu(null); }}
    onReserveRandom={(n) => { moveDeckCardsToZone('random', n, 'reserve'); setDeckMenu(null); }}
  />
)}

{lorMenu && (
  <LorContextMenu
    x={lorMenu.x}
    y={lorMenu.y}
    onClose={() => setLorMenu(null)}
    onAddSoul={() => {
      multiplayerActions.spawnLostSoul?.('NT', '0.5', '0.5');
      setLorMenu(null);
    }}
  />
)}

{deckDrop && (
  <DeckDropPopup
    x={deckDrop.x}
    y={deckDrop.y}
    onShuffleIn={() => { multiplayerActions.shuffleCardIntoDeck(deckDrop.cardId); setDeckDrop(null); }}
    onTopDeck={() => { multiplayerActions.moveCardToTopOfDeck(deckDrop.cardId); setDeckDrop(null); }}
    onBottomDeck={() => { multiplayerActions.moveCardToBottomOfDeck(deckDrop.cardId); setDeckDrop(null); }}
    onExchange={() => { setDeckDrop(null); setExchangeCardIds([deckDrop.cardId]); }}
    onCancel={() => setDeckDrop(null)}
  />
)}
```

Note: `setShowDeckSearch`, `setPeekState`, `setExchangeCardIds` are added in Task 8. This step may show TS errors until Task 8 is complete — that's expected.

- [ ] **Step 10: Verify it compiles (may have errors from missing state — ok)**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
If only errors are about `setShowDeckSearch`/`setPeekState`/`setExchangeCardIds` not existing, that's expected and fixed in Task 8.

- [ ] **Step 11: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: wire DeckContextMenu, LorContextMenu, DeckDropPopup into play mode"
```

---

## Task 8: Wire Modals into MultiplayerCanvas (DeckSearchModal, DeckPeekModal, DeckExchangeModal, ZoneBrowseModal)

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Add imports**

```typescript
import { ModalGameProvider, type ModalGameContextValue } from '@/app/shared/contexts/ModalGameContext';
import { DeckSearchModal } from '@/app/shared/components/DeckSearchModal';
import { DeckPeekModal } from '@/app/shared/components/DeckPeekModal';
import { DeckExchangeModal } from '@/app/shared/components/DeckExchangeModal';
import { ZoneBrowseModal } from '@/app/shared/components/ZoneBrowseModal';
import { useModalCardDrag } from '@/app/shared/hooks/useModalCardDrag';
import type { ZoneId } from '@/app/shared/types/gameCard';
```

- [ ] **Step 2: Add modal state variables**

After the state added in Task 7:
```typescript
const [showDeckSearch, setShowDeckSearch] = useState(false);
const [peekState, setPeekState] = useState<{ position: 'top' | 'bottom' | 'random'; count: number } | null>(null);
const [exchangeCardIds, setExchangeCardIds] = useState<string[] | null>(null);
```

Update `closeAllMenus` to also clear these:
```typescript
const closeAllMenus = useCallback(() => {
  setContextMenu(null);
  setMultiCardContextMenu(null);
  setZoneMenu(null);
  setDeckMenu(null);
  setLorMenu(null);
  setDeckDrop(null);
  setShowDeckSearch(false);
  setPeekState(null);
  setExchangeCardIds(null);
  setBrowseMyZone(null);
  setBrowseOpponentZone(null);
}, []);
```

- [ ] **Step 3: Build ModalGameProvider value**

```typescript
const modalGameValue = useMemo<ModalGameContextValue>(() => ({
  zones: Object.fromEntries(
    Object.entries(myCards).map(([zone, cards]) => [
      zone,
      cards.map(c => cardInstanceToGameCard(c, counters.get(c.id) ?? [], 'player1'))
    ])
  ),
  actions: {
    moveCard: (id, toZone, _idx, posX, posY) =>
      gameState.moveCard(BigInt(id), toZone, undefined, posX?.toString(), posY?.toString()),
    moveCardsBatch: (ids, toZone) =>
      gameState.moveCardsBatch(ids.join(','), toZone),
    moveCardToTopOfDeck: (id) => gameState.moveCardToTopOfDeck(BigInt(id)),
    moveCardToBottomOfDeck: (id) => gameState.moveCardToBottomOfDeck(BigInt(id)),
    shuffleDeck: () => gameState.shuffleDeck(),
    shuffleCardIntoDeck: (id) => gameState.shuffleCardIntoDeck(BigInt(id)),
  },
}), [myCards, counters, gameState]);
```

Note: `counters` is a `Map<bigint, CardCounter[]>` from `useGameState()` (destructured at line ~158 of MultiplayerCanvas). `cardInstanceToGameCard` at line 73 accepts `CardCounter[]` directly.

- [ ] **Step 4: Instantiate useModalCardDrag**

The hook expects `findZoneAtPosition: (x, y) => ZoneId | null` but MultiplayerCanvas has `findZoneAtPosition: (x, y) => { zone, owner } | null`. Create a thin wrapper:

```typescript
const findZoneForModalDrag = useCallback((x: number, y: number): ZoneId | null => {
  const hit = findZoneAtPosition(x, y);
  if (!hit || hit.owner !== 'my') return null;
  return hit.zone as ZoneId;
}, [findZoneAtPosition]);

const {
  dragState: modalDrag,
  startDrag: modalStartDrag,
  startMultiDrag: modalStartMultiDrag,
  hoveredZone: modalHoveredZone,
  ghostRef: modalGhostRef,
  didDragRef: modalDidDragRef,
} = useModalCardDrag({
  stageRef,
  zoneLayout: myZones as Partial<Record<ZoneId, ZoneRect>>,
  findZoneAtPosition: findZoneForModalDrag,
  moveCard: (id: string, toZone: ZoneId, _idx?: number, posX?: number, posY?: number) =>
    gameState.moveCard(BigInt(id), String(toZone), undefined, posX?.toString(), posY?.toString()),
  moveCardsBatch: (ids: string[], toZone: ZoneId) =>
    gameState.moveCardsBatch(ids.join(','), String(toZone)),
  onDeckDrop: (cardId, screenX, screenY) => setDeckDrop({ x: screenX, y: screenY, cardId }),
  cardWidth,
  cardHeight,
});
```

- [ ] **Step 5: Compute peekCardIds**

```typescript
const peekCardIds = useMemo(() => {
  if (!peekState) return [];
  const sorted = [...(myCards['deck'] ?? [])].sort(
    (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex)
  );
  let selected: typeof sorted;
  if (peekState.position === 'top') selected = sorted.slice(0, peekState.count);
  else if (peekState.position === 'bottom') selected = sorted.slice(-peekState.count);
  else {
    const shuffled = [...sorted];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    selected = shuffled.slice(0, peekState.count);
  }
  return selected.map(c => String(c.id));
}, [peekState, myCards]);
```

- [ ] **Step 6: Update browseZone state type and remove inline browse grid**

The current `browseZone` state (line 371) is typed as `{ zone: string; cards: ...; label: string; readOnly: boolean }`. Since `ZoneBrowseModal` reads cards from `useModalGame()`, simplify the state to just `{ zone: string; readOnly: boolean }`.

Update the state declaration:
```typescript
const [browseZone, setBrowseZone] = useState<{ zone: string; readOnly: boolean } | null>(null);
```

Update all `setBrowseZone` call sites (sidebar pile onClick handlers) to remove `cards` and `label` fields:
```typescript
// My zones (line ~1569):
setBrowseZone({ zone: zoneKey, readOnly: false });

// Opponent zones (line ~1667, similar pattern):
setBrowseZone({ zone: zoneKey, readOnly: true });
```

For opponent zones, `ZoneBrowseModal` will need opponent cards in the provider. Add opponent zone cards to `modalGameValue.zones` for browseable zones — OR keep opponent browse as the existing inline grid (simpler). **Recommended:** Keep the inline grid for opponent zones only, use `ZoneBrowseModal` for player zones. Split the `browseZone` state into two:
```typescript
const [browseMyZone, setBrowseMyZone] = useState<ZoneId | null>(null);
const [browseOpponentZone, setBrowseOpponentZone] = useState<{ zone: string; cards: CardInstance[] } | null>(null);
```

Then delete the inline browse grid for player zones (it's replaced by `ZoneBrowseModal`), but keep the inline grid for opponent zones (read-only, no actions needed).

- [ ] **Step 7: Render modals wrapped in ModalGameProvider**

Replace the deleted browse grid with:

```tsx
<ModalGameProvider value={modalGameValue}>
  {browseMyZone && (
    <ZoneBrowseModal
      zoneId={browseMyZone}
      onClose={() => setBrowseMyZone(null)}
      onStartDrag={modalStartDrag}
      onStartMultiDrag={modalStartMultiDrag}
      didDragRef={modalDidDragRef}
      isDragActive={modalDrag.isDragging}
    />
  )}

  {showDeckSearch && (
    <DeckSearchModal
      onClose={() => setShowDeckSearch(false)}
      onStartDrag={modalStartDrag}
      onStartMultiDrag={modalStartMultiDrag}
      didDragRef={modalDidDragRef}
      isDragActive={modalDrag.isDragging}
    />
  )}

  {peekState && (
    <DeckPeekModal
      cardIds={peekCardIds}
      title={`${peekState.position === 'top' ? 'Top' : peekState.position === 'bottom' ? 'Bottom' : 'Random'} ${peekState.count}`}
      onClose={() => setPeekState(null)}
      onStartDrag={modalStartDrag}
      onStartMultiDrag={modalStartMultiDrag}
      didDragRef={modalDidDragRef}
      isDragActive={modalDrag.isDragging}
    />
  )}

  {exchangeCardIds && (
    <DeckExchangeModal
      exchangeCardIds={exchangeCardIds}
      onComplete={() => { setExchangeCardIds(null); clearSelection(); }}
      onCancel={() => setExchangeCardIds(null)}
      onStartDrag={modalStartDrag}
      didDragRef={modalDidDragRef}
      isDragActive={modalDrag.isDragging}
    />
  )}
</ModalGameProvider>
```

- [ ] **Step 8: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: wire deck modals and zone browse into play mode via ModalGameProvider"
```

---

## Task 9: Manual Verification

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test goldfish mode (regression check)**

Open goldfish mode with any deck. Verify:
- Right-click deck → DeckContextMenu opens with all submenus
- Search Deck → modal opens, cards show, drag works
- Peek (top/bottom/random) → modal opens with correct cards
- Right-click card → Exchange with Deck works
- Click discard/reserve/banish → ZoneBrowseModal opens
- Right-click LOB → token spawn menu works
- Right-click LOR → Add Soul works

- [ ] **Step 3: Test play mode (new features)**

Start a play mode game. Verify:
- Right-click deck pile → DeckContextMenu opens
  - Draw 1, Draw 3, Draw X work
  - Shuffle Deck works
  - Search Deck opens DeckSearchModal
  - Reveal Top N opens DeckPeekModal
  - Discard/Reserve top N moves cards correctly
- Right-click L.O.R. → LorContextMenu with "Add Soul"
- Drag card onto deck → DeckDropPopup (Shuffle In / Top / Bottom / Exchange)
- Right-click card → "Exchange with Deck" opens DeckExchangeModal
- Click discard/reserve/banish → ZoneBrowseModal (replaces old inline grid)
- Click opponent discard/reserve → ZoneBrowseModal in readOnly mode
- All menus close on Esc, click-outside, opening another menu
- No console errors

- [ ] **Step 4: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during manual verification"
```

---

## Summary

| Task | Description | Depends On |
|------|-------------|------------|
| 1 | Create ModalGameContext | — |
| 2 | Refactor DeckSearchModal | Task 1 |
| 3 | Refactor DeckPeekModal | Task 1 |
| 4 | Refactor DeckExchangeModal | Task 1 |
| 5 | Refactor ZoneBrowseModal + readOnly | Task 1 |
| 6 | Wrap goldfish modals with provider | Tasks 2-5 |
| 7 | Wire simple menus into MultiplayerCanvas | — |
| 8 | Wire modals into MultiplayerCanvas | Tasks 2-6 |
| 9 | Manual verification | Tasks 7-8 |

Tasks 2-5 can run in parallel. Tasks 7 and 1 can run in parallel. Task 6 depends on 2-5. Task 8 depends on 6 and 7. Task 9 is the final check.
