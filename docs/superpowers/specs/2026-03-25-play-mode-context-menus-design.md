# Play Mode Context Menus & Deck Operations — Wiring Spec

**Date:** 2026-03-25
**Status:** Draft
**Depends on:** 2026-03-24-play-mode-feature-parity-design.md (Phases 2.6 & 3)

## Overview

Play mode is missing right-click context menus on decks, zones, and L.O.R. that goldfish mode already has. The shared components exist in `app/shared/components/` but four of them (`DeckSearchModal`, `DeckPeekModal`, `DeckExchangeModal`, `ZoneBrowseModal`) are **hard-coupled to goldfish's `useGame()` context**. They must be refactored before play mode can use them.

Three components are already decoupled and ready to wire: `DeckContextMenu`, `DeckDropPopup`, `LorContextMenu`.

All required SpacetimeDB reducers already exist: `drawCard`, `drawMultiple`, `shuffleDeck`, `moveCardToTopOfDeck`, `moveCardToBottomOfDeck`, `exchangeCards`, `moveCard`, `moveCardsBatch`.

## Current State

**What works in play mode:**
- `CardContextMenu` — right-click single cards (counters, meek, flip, move to zone/deck)
- `MultiCardContextMenu` — right-click with multi-selection (batch move, meek, flip)
- `ZoneContextMenu` — right-click LOB zone (spawn tokens)
- Double-click deck pile to draw 1
- Click sidebar zones (discard/reserve/banish/LOR) to open inline browse grid
- Drag & drop between zones

**What's missing vs goldfish:**
1. No `DeckContextMenu` on right-click deck pile
2. No `DeckSearchModal` (search/filter deck, drag cards out)
3. No `DeckPeekModal` (reveal top/bottom/random N cards)
4. No `DeckExchangeModal` (tutor/exchange cards with deck)
5. No `DeckDropPopup` (options when dragging card onto deck)
6. No `LorContextMenu` on right-click L.O.R. zone
7. Inline browse grid instead of shared `ZoneBrowseModal`
8. `CardContextMenu` missing "Exchange with Deck" action (no `onExchange` prop passed)

## Prerequisite: Decouple Modals from Goldfish Context

### Problem

Four modals call `useGame()` internally to access game state and actions:

| Component | Uses from `useGame()` |
|---|---|
| `DeckSearchModal` | `state.zones.deck`, `moveCard`, `moveCardsBatch`, `moveCardToTopOfDeck`, `moveCardToBottomOfDeck`, `shuffleDeck` |
| `DeckPeekModal` | `state.zones.deck`, `moveCardsBatch`, `shuffleDeck` |
| `DeckExchangeModal` | `state.zones.deck`, `moveCard`, `moveCardToTopOfDeck`, `shuffleDeck` |
| `ZoneBrowseModal` | `state.zones[zoneId]`, `moveCard`, `moveCardsBatch`, `moveCardToTopOfDeck`, `moveCardToBottomOfDeck`, `shuffleCardIntoDeck` |

They also use `useCardPreview()` from `CardPreviewContext` — this is already available in play mode's render tree (wrapped in `client.tsx` line 79), so no change needed.

### Solution: `ModalGameProvider` Context

Create a lightweight context that wraps the subset of game state/actions needed by modals. Both goldfish and play mode provide their own implementation.

**New file:** `app/shared/contexts/ModalGameContext.tsx`

```typescript
import { createContext, useContext } from 'react';
import type { GameCard, ZoneId } from '@/app/shared/types/gameCard';

export interface ModalGameState {
  zones: Record<string, GameCard[]>;
}

export interface ModalGameActions {
  moveCard(instanceId: string, toZone: ZoneId, toIndex?: number, posX?: number, posY?: number): void;
  moveCardsBatch(instanceIds: string[], toZone: ZoneId): void;
  moveCardToTopOfDeck(instanceId: string): void;
  moveCardToBottomOfDeck(instanceId: string): void;
  shuffleDeck(): void;
  shuffleCardIntoDeck(instanceId: string): void;
}

export interface ModalGameContextValue {
  state: ModalGameState;
  actions: ModalGameActions;
}

const ModalGameContext = createContext<ModalGameContextValue | null>(null);

export function ModalGameProvider({ children, value }: { children: React.ReactNode; value: ModalGameContextValue }) {
  return <ModalGameContext.Provider value={value}>{children}</ModalGameContext.Provider>;
}

export function useModalGame(): ModalGameContextValue {
  const ctx = useContext(ModalGameContext);
  if (!ctx) throw new Error('useModalGame must be used within a ModalGameProvider');
  return ctx;
}
```

### Goldfish Integration

In `GoldfishCanvas.tsx`, wrap the modal rendering area with `ModalGameProvider`, bridging from the existing `useGame()`:

```tsx
const { state, moveCard, moveCardsBatch, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleDeck, shuffleCardIntoDeck } = useGame();

const modalGameValue = useMemo(() => ({
  state: { zones: state.zones },
  actions: { moveCard, moveCardsBatch, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleDeck, shuffleCardIntoDeck },
}), [state.zones, moveCard, moveCardsBatch, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleDeck, shuffleCardIntoDeck]);

// Wrap modals:
<ModalGameProvider value={modalGameValue}>
  {showDeckSearch && <DeckSearchModal ... />}
  {peekState && <DeckPeekModal ... />}
  {/* etc. */}
</ModalGameProvider>
```

### Play Mode Integration

In `MultiplayerCanvas.tsx`, build the same provider from SpacetimeDB data:

```tsx
const modalGameValue = useMemo(() => ({
  state: {
    zones: Object.fromEntries(
      Object.entries(myCards).map(([zone, cards]) => [
        zone,
        cards.map(c => cardInstanceToGameCard(c, getCountersForCard(c.id), 'player1'))
      ])
    ),
  },
  actions: {
    moveCard: (id, toZone, _idx, posX, posY) =>
      multiplayerActions.moveCard(id, toZone, posX?.toString(), posY?.toString()),
    moveCardsBatch: (ids, toZone) =>
      multiplayerActions.moveCardsBatch(ids, toZone),
    moveCardToTopOfDeck: (id) => multiplayerActions.moveCardToTopOfDeck(id),
    moveCardToBottomOfDeck: (id) => multiplayerActions.moveCardToBottomOfDeck(id),
    shuffleDeck: () => multiplayerActions.shuffleDeck(),
    shuffleCardIntoDeck: (id) => multiplayerActions.shuffleCardIntoDeck(id),
  },
}), [myCards, multiplayerActions, /* counter deps */]);
```

### Modal Refactoring

Replace `useGame()` calls with `useModalGame()` in each modal:

- `DeckSearchModal.tsx`: Replace `const { state, moveCard, ... } = useGame()` with `const { state, actions } = useModalGame()`. Use `state.zones.deck` for deck cards and `actions.moveCard` etc. for operations.
- `DeckPeekModal.tsx`: Same pattern — `useModalGame()` instead of `useGame()`.
- `DeckExchangeModal.tsx`: Same pattern.
- `ZoneBrowseModal.tsx`: Same pattern. Add `readOnly?: boolean` prop — when true, hide all action buttons and disable drag.

This is a mechanical find-and-replace in each file. The function signatures need light adaptation (goldfish's `moveCard` takes `(id, zone, index?, posX?, posY?)` with numbers; the `ModalGameActions` interface uses the same signature).

---

## Design: Wiring Changes in MultiplayerCanvas

### 1. DeckContextMenu (already decoupled — ready to wire)

**State:**
```typescript
const [deckMenu, setDeckMenu] = useState<{ x: number; y: number } | null>(null);
```

**Right-click handler on deck pile Group (line ~1567):**
Add `onContextMenu` to the deck pile `<Group>`:
```typescript
onContextMenu={(e: Konva.KonvaEventObject<PointerEvent>) => {
  e.evt.preventDefault();
  const stage = stageRef.current;
  if (!stage) return;
  const container = stage.container().getBoundingClientRect();
  closeAllMenus();
  setDeckMenu({
    x: e.evt.clientX - container.left,
    y: e.evt.clientY - container.top,
  });
}}
```

**Render:**
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
```

**Helper for non-draw deck operations:**
```typescript
const moveDeckCardsToZone = useCallback((
  position: 'top' | 'bottom' | 'random',
  count: number,
  targetZone: string,
) => {
  const deckCards = [...(myCards['deck'] ?? [])].sort(
    (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex)
  );
  let selected: CardInstance[];
  if (position === 'top') selected = deckCards.slice(0, count);
  else if (position === 'bottom') selected = deckCards.slice(-count);
  else {
    // Fisher-Yates shuffle for random selection
    const shuffled = [...deckCards];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    selected = shuffled.slice(0, count);
  }
  const ids = selected.map(c => String(c.id));
  multiplayerActions.moveCardsBatch(ids, targetZone);
}, [myCards, multiplayerActions]);
```

### 2. DeckSearchModal (needs ModalGameProvider)

**State:**
```typescript
const [showDeckSearch, setShowDeckSearch] = useState(false);
```

**Render (wrapped in ModalGameProvider):**
```tsx
{showDeckSearch && (
  <DeckSearchModal onClose={() => setShowDeckSearch(false)} />
)}
```

The modal reads deck cards via `useModalGame().state.zones.deck` — no props needed for data.

**Drag-from-modal:** `DeckSearchModal` accepts `onStartDrag`, `onStartMultiDrag`, `didDragRef`, and `isDragActive` props for modal-to-canvas drag. These come from the `useModalCardDrag` hook. Instantiate the hook in `MultiplayerCanvas`:

```typescript
const { onStartDrag, onStartMultiDrag, didDragRef, isDragActive } = useModalCardDrag({
  stageRef,
  zoneLayout: myZones,
  findZoneAtPosition,
  moveCard: (id, toZone, _idx, posX, posY) =>
    multiplayerActions.moveCard(id, toZone, posX?.toString(), posY?.toString()),
  moveCardsBatch: (ids, toZone) =>
    multiplayerActions.moveCardsBatch(ids, toZone),
  onDeckDrop: (cardId, screenX, screenY) => setDeckDrop({ x: screenX, y: screenY, cardId }),
  cardWidth: CARD_WIDTH,
  cardHeight: CARD_HEIGHT,
});
```

Then pass these to all modals that support drag:
```tsx
<DeckSearchModal
  onClose={() => setShowDeckSearch(false)}
  onStartDrag={onStartDrag}
  onStartMultiDrag={onStartMultiDrag}
  didDragRef={didDragRef}
  isDragActive={isDragActive}
/>
```

### 3. DeckPeekModal (needs ModalGameProvider)

**State:**
```typescript
const [peekState, setPeekState] = useState<{ position: 'top' | 'bottom' | 'random'; count: number } | null>(null);
```

**Data preparation:** Compute `cardIds` from deck order:
```typescript
const peekCardIds = useMemo(() => {
  if (!peekState) return [];
  const sorted = [...(myCards['deck'] ?? [])].sort(
    (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex)
  );
  let selected: CardInstance[];
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

**Render:**
```tsx
{peekState && (
  <DeckPeekModal
    cardIds={peekCardIds}
    title={`${peekState.position === 'top' ? 'Top' : peekState.position === 'bottom' ? 'Bottom' : 'Random'} ${peekState.count} Card${peekState.count > 1 ? 's' : ''}`}
    onClose={() => setPeekState(null)}
    onStartDrag={onStartDrag}
    onStartMultiDrag={onStartMultiDrag}
    didDragRef={didDragRef}
    isDragActive={isDragActive}
  />
)}
```

### 4. DeckExchangeModal (needs ModalGameProvider)

**State:**
```typescript
const [exchangeCardIds, setExchangeCardIds] = useState<string[] | null>(null);
```

**Render:**
```tsx
{exchangeCardIds && (
  <DeckExchangeModal
    exchangeCardIds={exchangeCardIds}
    onComplete={() => setExchangeCardIds(null)}
    onCancel={() => setExchangeCardIds(null)}
    onStartDrag={onStartDrag}
    didDragRef={didDragRef}
    isDragActive={isDragActive}
  />
)}
```

**Enable "Exchange with Deck" in CardContextMenu:**
Currently `CardContextMenu` is rendered without `onExchange` prop. Add it:
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

### 5. DeckDropPopup (already decoupled — ready to wire)

**State:**
```typescript
const [deckDrop, setDeckDrop] = useState<{ x: number; y: number; cardId: string } | null>(null);
```

**Trigger:** Intercept deck drops in the existing drag-end handler (line ~765):
```typescript
} else if (targetZone === 'deck') {
  setDeckDrop({ x: pointerPos.x, y: pointerPos.y, cardId });
  return; // Popup will handle the action
}
```

**Render:**
```tsx
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

### 6. LorContextMenu (already decoupled — ready to wire)

**State:**
```typescript
const [lorMenu, setLorMenu] = useState<{ x: number; y: number } | null>(null);
```

**Right-click handler on L.O.R. sidebar pile Group:**
Add `onContextMenu` alongside the existing `onClick` for the `land-of-redemption` zone:
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

**Render:**
```tsx
{lorMenu && (
  <LorContextMenu
    x={lorMenu.x}
    y={lorMenu.y}
    onClose={() => setLorMenu(null)}
    onAddSoul={() => {
      multiplayerActions.spawnLostSoul('NT', '0.5', '0.5');
      setLorMenu(null);
    }}
  />
)}
```

**Server-side note:** The `spawnLostSoul` reducer currently spawns into LOB. Check if it can be parameterized to target `land-of-redemption` instead, or add a `spawnOwnSoul` reducer.

### 7. Replace Inline Browse Grid with Shared ZoneBrowseModal (needs ModalGameProvider + readOnly prop)

**ZoneBrowseModal refactoring needed:**
- Replace `useGame()` with `useModalGame()`
- Add `readOnly?: boolean` prop — when true, hide move-to-zone buttons and disable drag handlers

**Remove** the entire inline browse grid (lines ~1939-2024 in MultiplayerCanvas).

**Render:**
```tsx
{browseZone && (
  <ZoneBrowseModal
    zoneId={browseZone.zone as ZoneId}
    onClose={() => setBrowseZone(null)}
    onStartDrag={browseZone.readOnly ? undefined : onStartDrag}
    onStartMultiDrag={browseZone.readOnly ? undefined : onStartMultiDrag}
    didDragRef={didDragRef}
    isDragActive={isDragActive}
    readOnly={browseZone.readOnly}
  />
)}
```

### 8. Close All Menus Helper

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
  setBrowseZone(null);
}, []);
```

Call at the start of every context menu handler.

---

## Implementation Order

```
Phase 0 — Foundation (prerequisite)
  0.1  Create ModalGameContext (new file)
  0.2  Refactor DeckSearchModal: useGame() → useModalGame()
  0.3  Refactor DeckPeekModal: useGame() → useModalGame()
  0.4  Refactor DeckExchangeModal: useGame() → useModalGame()
  0.5  Refactor ZoneBrowseModal: useGame() → useModalGame() + add readOnly prop
  0.6  Wrap goldfish modal rendering with ModalGameProvider (verify no regressions)

Phase 1 — Simple menus (no refactoring needed)
  1.1  Wire DeckContextMenu (right-click deck pile)
  1.2  Wire LorContextMenu (right-click L.O.R. pile)
  1.3  Wire DeckDropPopup (intercept deck drops)
  1.4  Add onExchange prop to CardContextMenu render
  1.5  Add closeAllMenus helper

Phase 2 — Modals (depends on Phase 0)
  2.1  Add ModalGameProvider in MultiplayerCanvas
  2.2  Instantiate useModalCardDrag hook
  2.3  Wire DeckSearchModal
  2.4  Wire DeckPeekModal
  2.5  Wire DeckExchangeModal
  2.6  Replace inline browse grid with ZoneBrowseModal
```

Phases 1 and 0 can proceed in parallel.

## Files Changed

| File | Change |
|------|--------|
| `app/shared/contexts/ModalGameContext.tsx` | **NEW** — context for modal game state/actions |
| `app/shared/components/DeckSearchModal.tsx` | Replace `useGame()` → `useModalGame()` |
| `app/shared/components/DeckPeekModal.tsx` | Replace `useGame()` → `useModalGame()` |
| `app/shared/components/DeckExchangeModal.tsx` | Replace `useGame()` → `useModalGame()` |
| `app/shared/components/ZoneBrowseModal.tsx` | Replace `useGame()` → `useModalGame()`, add `readOnly` prop |
| `app/goldfish/components/GoldfishCanvas.tsx` | Add `ModalGameProvider` wrapper around modals |
| `app/play/components/MultiplayerCanvas.tsx` | Add `ModalGameProvider`, all menu state/handlers/renders, `useModalCardDrag`, `closeAllMenus`, remove inline browse grid |

## Out of Scope

- Consent-based opponent zone search (Phase 6.2 in parent spec)
- New SpacetimeDB reducers (all needed reducers already exist, except possibly `spawnOwnSoul`)
- Keyboard shortcuts (Phase 1.2 in parent spec)
- Layout/toolbar changes (Phase 5 in parent spec)
- Multi-card drag fix (Phase 5.4 in parent spec)

## Success Criteria

- Right-click on deck pile opens DeckContextMenu with all submenus functional
- "Search Deck" opens DeckSearchModal with full search/filter/drag capabilities
- "Reveal Top/Bottom/Random" opens DeckPeekModal with correct cards
- "Exchange with Deck" on card context menu opens DeckExchangeModal
- Dragging a card onto deck shows DeckDropPopup (shuffle in / top / bottom / exchange)
- Right-click L.O.R. zone shows LorContextMenu with "Add Soul"
- Clicking sidebar zones opens shared ZoneBrowseModal with drag-out capability
- All menus close cleanly (Esc, click-outside, opening another menu)
- Goldfish mode continues to work identically (no regressions from modal refactoring)
- TypeScript compiles cleanly
