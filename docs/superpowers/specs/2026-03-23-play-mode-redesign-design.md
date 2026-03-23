# Play Mode Redesign — Layout, Context Menus, Chat & Bug Fixes

**Date:** 2026-03-23
**Status:** Draft
**Scope:** 7 issues affecting the multiplayer `/play` route

---

## Problem Statement

The multiplayer play mode has several issues preventing it from being usable:

1. **TOKEN label bug** — All of player 2's cards display "TOKEN" badge because `GameCardNode` uses `ownerId === 'player2'` as the token check, a goldfish-only assumption.
2. **Zone ordering wrong** — Opponent's Land of Bondage renders below their Territory instead of between their Hand and Territory.
3. **Sidebar zone ordering wrong** — Player's sidebar reads Deck→Discard→Reserve→Banish→LOR top-to-bottom, should be LOR→Banish→Reserve→Deck→Discard. Opponent should mirror.
4. **Space is cramped** — Two players' worth of zones don't fit well in the current shared-sidebar layout. No card preview panel. No responsive scaling.
5. **Context menus broken** — All right-click handlers are no-ops. None of the goldfish context menu functionality works.
6. **No zone counts** — Territory and Land of Bondage don't show card counts like the pile zones do.
7. **Chat not rendered** — `ChatPanel.tsx` is fully built but never wired into the game client.

---

## Design Overview

### Layout: Inline Pile Zones + Left Sidebar (MTGO-Style)

The shared right sidebar is eliminated. Each player's pile zones are embedded inline within their own board half. A fixed left column holds the card preview and chat panel.

```
┌──────────┬──────────────────────────────────────────────────┐
│          │ OPPONENT HAND (card backs)                       │
│ CARD     ├──────────────────────────┬───────────────────────┤
│ PREVIEW  │ OPPONENT LOB             │ Opp inline piles      │
│          ├──────────────────────────┤ (Dis, Deck, Res,      │
│ (always  │ OPPONENT TERRITORY       │  Ban, LOR)            │
│  visible)├══════════════════════════╪═══════════════════════┤
│          │ YOUR TERRITORY           │ Your inline piles     │
├──────────┤──────────────────────────┤ (LOR, Ban, Res,       │
│ CHAT     │ YOUR LOB                 │  Deck, Dis)           │
│ + LOG    ├──────────────────────────┴───────────────────────┤
│          │ YOUR HAND (fan arc)                              │
│(collapse)├──────────────────────────────────────────────────┤
│          │ PHASE BAR + TURN INDICATOR                       │
└──────────┴──────────────────────────────────────────────────┘
```

**Rationale:** This follows the universal pattern from MTGO, Untap.in, and Lackey CCG — pile zones belong to each player's board area, not a shared sidebar. The left column provides persistent card preview and chat without overlapping the game board.

### Zone Order (Fixed Mirror)

**Opponent (top to bottom):** Hand → LOB → Territory
**Player (bottom to top, mirrored):** Hand → LOB → Territory

Territories face each other across the center line — the "battlefield." LOB sits between each player's hand and territory.

### Sidebar Pile Zone Order

**Player (top to bottom within their board half):** LOR → Banish → Reserve → Deck → Discard
**Opponent (mirrored, top to bottom within their board half):** Discard → Deck → Reserve → Banish → LOR

The opponent's order is the player's order flipped, so when reading across the center line, matching zones align.

---

## Detailed Design

### 1. TOKEN Label Fix

**Primary file:** `app/shared/components/GameCardNode.tsx`

**Current:** `const isToken = card.ownerId === 'player2';` (line 92)

**Change:** Add an explicit `isToken` boolean to the `GameCard` type. All token checks across the codebase change from `ownerId === 'player2'` to `card.isToken`.

- **Goldfish mode:** The `ADD_OPPONENT_LOST_SOUL` action in `gameReducer.ts` sets `isToken: true` on spawned token cards. `gameInitializer.ts` sets `isToken: false` on all player cards.
- **Multiplayer mode:** The `cardInstanceToGameCard()` adapter in `MultiplayerCanvas.tsx` sets `isToken: false` for all cards. No token concept exists in SpacetimeDB yet. Future token support would add an `isToken` field to the `CardInstance` schema.

**All files with `ownerId === 'player2'` token checks that must be updated:**
- `app/shared/components/GameCardNode.tsx` — rendering (dashed border, TOKEN badge)
- `app/goldfish/state/gameReducer.ts` — token auto-removal logic, shuffle prevention
- `app/goldfish/components/CardContextMenu.tsx` — `isOpponentToken()` helper, simplified menu
- `app/goldfish/components/MultiCardContextMenu.tsx` — token filtering in batch operations
- `app/goldfish/components/GoldfishCanvas.tsx` — opponent token rendering path

No database migration needed — this is a client-side rendering change.

### 2. Board Layout Rewrite

**File:** `app/play/layout/mirrorLayout.ts`

**Changes to `calculateMirrorLayout()`:**

- Remove the shared right sidebar column entirely.
- Add a left sidebar column: `clamp(150px, 10vw, 220px)` wide.
- Reorder opponent zones: Hand → LOB → Territory (currently Hand → Territory → LOB).
- Add per-player inline pile columns (~12% of board width) at the right edge of each player's board half.
- Player pile order (top to bottom): LOR, Banish, Reserve, Deck, Discard.
- Opponent pile order (top to bottom): Discard, Deck, Reserve, Banish, LOR.

**Layout architecture — HTML + Canvas split:**

The left sidebar (card preview + chat) is rendered as an **HTML column outside the Konva Stage**, not as Konva canvas elements. This is because chat requires DOM form elements (text input, scrollable messages, tabs) that cannot exist inside a `<canvas>`.

The page layout uses a CSS flex container:
```
┌─────────────────────────────────────────────────┐
│ flex container (row)                            │
│ ┌──────────┐ ┌────────────────────────────────┐ │
│ │ HTML div  │ │ Konva Stage (canvas)           │ │
│ │ - preview │ │ - zones, cards, hands, piles   │ │
│ │ - chat    │ │                                │ │
│ └──────────┘ └────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

The left sidebar width is controlled by CSS: `width: clamp(150px, 10vw, 220px)`. The Konva Stage takes `flex: 1` (remaining width). `MirrorLayout` does NOT include sidebar rects — it only calculates zones within the canvas:

```typescript
interface MirrorLayout {
  // unchanged
  myZones: Record<string, ZoneRect>;
  opponentZones: Record<string, ZoneRect>;
  myHandRect: ZoneRect;
  opponentHandRect: ZoneRect;
  phaseBarRect: ZoneRect;
}
```

The `calculateMirrorLayout()` function receives the Konva stage dimensions (excluding the left sidebar width), so all zone calculations remain purely within canvas space.

### 3. Responsive Tiers (Phase 2)

> **Phasing note:** The initial implementation targets a single desktop tier (>= 1600px). Responsive behavior at smaller breakpoints is Phase 2 work and should not block the core layout rewrite. The table below documents the intended behavior for future implementation.

All zone layout remains proportional (percentages of stage dimensions). The left sidebar is the only element with a fixed-width clamp.

| Viewport width | Left sidebar | Inline piles | Card preview | Chat |
|---|---|---|---|---|
| >= 1600px (full desktop) | ~180px, always visible | ~12% width, card thumbnail + count | Full card image + ability text | Collapsible panel, starts open |
| 1200–1599px (laptop) | ~150px, collapsible, starts collapsed | ~10% width, card back + count only | Card image only (no text) | Collapsible, starts minimized (icon + badge) |
| < 1200px (small laptop) | Hidden entirely | ~10% width, count badge only | Hover tooltip only | Floating icon only, opens as overlay |

**Minimum supported width:** 1024px. Below that, display a "please use a larger screen" message instead of the game board.

### 4. Shared Context Menus

**Current state:** Goldfish mode has full context menu support (card, deck, zone, multi-card). Play mode has no-op handlers.

**Approach:** Extract context menu components from `app/goldfish/components/` into `app/shared/components/` and wire them into both modes via a common actions interface.

**Actions interface:**

The two modes use different ID types (goldfish uses `string`, multiplayer uses `bigint`). The shared interface uses `string` throughout; each mode provides an adapter that converts as needed.

```typescript
interface GameActions {
  // Card operations (cardId is always string — multiplayer adapter converts to bigint)
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

  // Goldfish-only actions (no-op in multiplayer)
  moveCardToTopOfDeck?(cardId: string): void;
  moveCardToBottomOfDeck?(cardId: string): void;
  removeOpponentToken?(cardId: string): void;

  // Deck inspection (goldfish has full support; multiplayer may not support all)
  searchDeck?(): void;
  peekTopN?(count: number): void;
}
```

**Multiplayer adapter pattern:** The multiplayer mode creates a `GameActions` implementation that wraps `useGameState()` methods, converting `string` IDs to `bigint` via `BigInt(cardId)`. Goldfish-only methods (`moveCardToTopOfDeck`, `removeOpponentToken`, etc.) are left `undefined` — the shared menu components conditionally render those options only when the method is defined.

**Goldfish adapter pattern:** The goldfish mode creates a `GameActions` implementation that wraps `dispatch(gameActions.xxx())` calls. All methods are provided.

**Shared menu components:**

| Component | Trigger | Actions |
|---|---|---|
| `CardContextMenu` | Right-click card | Move to zone, counters, flip, meek, notes. Shows "Remove Token" only when `removeOpponentToken` is defined and `card.isToken` is true. |
| `DeckContextMenu` | Right-click deck pile | Search, peek top N, draw. Search/peek shown only when methods are defined. |
| `ZoneContextMenu` | Right-click empty zone area | Browse zone contents |
| `MultiCardContextMenu` | Right-click with multi-select | Batch move, exchange |

**Note:** `LorContextMenu` (goldfish-only, handles adding lost souls to opponent's Land of Redemption) stays in `app/goldfish/components/` — it's a goldfish-specific concept with no multiplayer equivalent.

### 5. Card Preview Panel

**Location:** Top portion of the left HTML sidebar column.

**Component:** New `app/play/components/CardPreviewPanel.tsx` (HTML/React, not Konva).

**Behavior:**
- Displays the **last hovered card** persistently — does not disappear when mouse leaves the card.
- Updates whenever any card is hovered (player's cards or opponent's visible cards).
- Face-down cards (opponent hand, flipped cards) show the card back image — no peeking.
- Double-click a card still opens the full zoom modal (existing `CardPreviewSystem` zoom behavior).

**Content displayed (>= 1600px tier):**
- Card image: fills sidebar width (~180px), auto-height at card aspect ratio (~252px)
- Below image: card name (bold), card type, brigade
- Below that: strength/toughness (if applicable)
- Below that: special ability text (scrollable if long)

**Interaction with goldfish loupe:** The goldfish mode's `CardLoupePanel` is a separate, more full-featured component (400px wide, toggleable). This card preview is play-mode-specific and simpler. No code sharing needed between them.

**Data flow:** `MultiplayerCanvas` tracks `hoveredCard` state (already partially implemented via `onMouseEnter`/`onMouseLeave` handlers). The parent component (`client.tsx`) lifts this state up and passes it to `CardPreviewPanel`.

### 6. Zone Counts on Territory & LOB (renumbered from original #5)

Add a count badge to each free-form zone's label in `MultiplayerCanvas.tsx`. Uses the same visual style as existing pile zone badges (rounded rect + count text).

Data sources (already computed in `useGameState`):
- `myCards['territory']?.length`
- `myCards['land-of-bondage']?.length`
- `opponentCards['territory']?.length`
- `opponentCards['land-of-bondage']?.length`

### 7. Chat Panel Wiring

**Current state:** `ChatPanel.tsx` is a fully built component with chat messages, game log tab, unread badges, and slide-out animation. `useGameState` exposes `chatMessages`, `gameActions`, and `sendChat`. They are never connected.

**Changes:**

- Restyle `ChatPanel` from a `position: fixed` right-side 320px slide-out to a **normal-flow HTML element** within the left sidebar `div`. It occupies the bottom portion of the left sidebar, below the card preview panel.
- Remove `position: fixed` and hardcoded width/height — the panel fills its parent container via `flex: 1` and `overflow-y: auto` for the message list.
- Wire into the game client (`app/play/[code]/client.tsx`): pass `chatMessages`, `gameActions`, `myPlayerId`, `sendChat`, and `playerNames` from `useGameState`.
- At >= 1600px tier: starts expanded. The toggle button becomes a collapse/expand for the entire chat section (not a slide-in/out).
- Keep existing Chat / Game Log tabs and unread tracking logic.

### 8. Dummy `/play/test` Route + Playwright Testing

Create `/app/play/test/page.tsx` that renders `MultiplayerCanvas` with mock game state:
- Two players with sample cards distributed across all zones.
- No SpacetimeDB connection required — passes static data.
- Used for:
  - Playwright screenshots at multiple viewport sizes (1920, 1440, 1280, 1024)
  - Visual layout inspection without needing two players to connect
  - Feeding screenshots to impeccable for design critique

---

## Files Affected

| File | Change |
|---|---|
| **TOKEN fix** | |
| `app/shared/components/GameCardNode.tsx` | Replace `ownerId === 'player2'` with `card.isToken` |
| `app/goldfish/types.ts` | Add `isToken: boolean` to `GameCard` type |
| `app/goldfish/state/gameReducer.ts` | Update `ownerId === 'player2'` checks to `card.isToken`; set `isToken: true` in `ADD_OPPONENT_LOST_SOUL` action |
| `app/goldfish/state/gameInitializer.ts` | Set `isToken: false` on all player cards |
| `app/goldfish/components/CardContextMenu.tsx` | Update `isOpponentToken()` to use `card.isToken` |
| `app/goldfish/components/MultiCardContextMenu.tsx` | Update token filtering to use `card.isToken` |
| `app/goldfish/components/GoldfishCanvas.tsx` | Update opponent token rendering check to use `card.isToken` |
| `app/play/components/MultiplayerCanvas.tsx` | Set `isToken: false` in `cardInstanceToGameCard()` adapter |
| **Layout rewrite** | |
| `app/play/layout/mirrorLayout.ts` | Full rewrite: new zone order, inline piles, no shared sidebar |
| `app/play/components/MultiplayerCanvas.tsx` | New layout rendering, zone counts on territory/LOB |
| `app/play/[code]/client.tsx` | Flex container (left sidebar HTML + Konva canvas), wire ChatPanel + CardPreviewPanel, lift hoveredCard state |
| **Card preview** | |
| `app/play/components/CardPreviewPanel.tsx` | New component: persistent card preview in left sidebar |
| **Chat** | |
| `app/play/components/ChatPanel.tsx` | Restyle from `position: fixed` slide-out to normal-flow left sidebar panel |
| **Shared context menus** | |
| `app/shared/components/CardContextMenu.tsx` | New shared component (extracted from goldfish) |
| `app/shared/components/DeckContextMenu.tsx` | New shared component (extracted from goldfish) |
| `app/shared/components/ZoneContextMenu.tsx` | New shared component (extracted from goldfish) |
| `app/shared/components/MultiCardContextMenu.tsx` | New shared component (extracted from goldfish) |
| `app/shared/types/gameActions.ts` | New file: shared `GameActions` interface |
| `app/goldfish/components/GoldfishCanvas.tsx` | Update to use shared context menu components via GameActions adapter |
| **Testing** | |
| `app/play/test/page.tsx` | New dummy route for Playwright visual testing |

---

## Out of Scope

- Mobile display support (deferred)
- SpacetimeDB `isToken` schema field (no token mechanics in multiplayer yet)
- Undo/redo in multiplayer (separate feature)
- Keyboard shortcuts in multiplayer (separate feature)
- Spectator mode layout changes
