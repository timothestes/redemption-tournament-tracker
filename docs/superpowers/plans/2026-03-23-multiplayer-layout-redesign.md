# Multiplayer Canvas Layout Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the multiplayer canvas so cards fit their zones at any viewport size, add a collapsible card loupe panel, and refactor layout code into clean separate files.

**Architecture:** Extract all layout math from the 1699-line `MultiplayerCanvas.tsx` into three focused layout files (`multiplayerLayout.ts`, `multiplayerHandLayout.ts`, `multiplayerAutoArrange.ts`). Introduce four-tier card sizing (main, LOB, opponent hand, pile) with dual width+height constraints. Port goldfish's `CardLoupePanel` for card previews. The canvas component becomes rendering-only.

**Tech Stack:** TypeScript, Konva (react-konva), Next.js dynamic imports, existing goldfish CardPreviewContext/CardLoupePanel

**Spec:** `docs/superpowers/specs/2026-03-23-multiplayer-layout-redesign.md`

---

### Task 1: Create `multiplayerLayout.ts` — Zone rects + four-tier card sizing

This is the single source of truth for all proportions. Every number in this file comes from the spec.

**Files:**
- Create: `app/play/layout/multiplayerLayout.ts`

**Reference files to read first:**
- `app/play/layout/mirrorLayout.ts` — current layout (being replaced). Note the `ZoneRect` interface, `MirrorLayout` interface, `buildSidebar` helper, and `isParagon` support
- `app/goldfish/layout/zoneLayout.ts` — goldfish's dual-constraint `getCardDimensions` at lines 16-31 as the model for height-aware card sizing
- `docs/superpowers/specs/2026-03-23-multiplayer-layout-redesign.md` — spec with exact ratios, the `MultiplayerLayout` interface definition, and all four card sizing functions

- [ ] **Step 1: Create the file with types and constants**

```typescript
// app/play/layout/multiplayerLayout.ts

export interface ZoneRect {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export interface CardDimensions {
  cardWidth: number;
  cardHeight: number;
}

type PileZone = 'lor' | 'banish' | 'reserve' | 'deck' | 'discard' | 'paragon';

export interface MultiplayerLayout {
  zones: {
    opponentHand: ZoneRect;
    opponentTerritory: ZoneRect;
    opponentLob: ZoneRect;
    divider: ZoneRect;
    playerLob: ZoneRect;
    playerTerritory: ZoneRect;
    playerHand: ZoneRect;
  };
  sidebar: {
    opponent: Partial<Record<PileZone, ZoneRect>>;
    player: Partial<Record<PileZone, ZoneRect>>;
  };
  mainCard: CardDimensions;
  lobCard: CardDimensions;
  opponentHandCard: CardDimensions;
  pileCard: CardDimensions;
  sidebarWidth: number;
  playAreaWidth: number;
}

// --- Proportions (from spec) ---
const CARD_ASPECT_RATIO = 1.4;
const SIDEBAR_WIDTH_RATIO = 0.15;

// Vertical zone ratios (must sum to 1.0)
const OPP_HAND_RATIO = 0.08;
const OPP_TERRITORY_RATIO = 0.27;
const OPP_LOB_RATIO = 0.09;
const DIVIDER_RATIO = 0.02;
const PLAYER_LOB_RATIO = 0.09;
const PLAYER_TERRITORY_RATIO = 0.27;
const PLAYER_HAND_RATIO = 0.18;

// Card sizing
const MAIN_CARD_WIDTH_RATIO = 0.06;     // 6% of play width
const MAIN_CARD_HAND_HEADROOM = 0.82;   // 82% of hand height for cards
const LOB_CARD_HEADROOM = 0.85;         // 85% of LOB height for cards
const OPP_HAND_HEADROOM = 0.78;         // 78% of opponent hand height
const OPP_HAND_SCALE = 0.55;            // 55% of main card width max
const PILE_LABEL_RATIO = 0.22;          // 22% of pile slot for labels
```

- [ ] **Step 2: Implement the four card sizing functions**

Add these below the constants:

```typescript
function getMainCardDimensions(
  playWidth: number, stageHeight: number
): CardDimensions {
  const widthBased = playWidth * MAIN_CARD_WIDTH_RATIO;
  const playerHandHeight = stageHeight * PLAYER_HAND_RATIO;
  const heightConstraint = playerHandHeight * MAIN_CARD_HAND_HEADROOM;
  const heightBased = heightConstraint / CARD_ASPECT_RATIO;
  const cardWidth = Math.round(Math.min(widthBased, heightBased));
  const cardHeight = Math.round(cardWidth * CARD_ASPECT_RATIO);
  return { cardWidth, cardHeight };
}

function getLobCardDimensions(
  mainCard: CardDimensions, lobZoneHeight: number
): CardDimensions {
  const maxHeight = lobZoneHeight * LOB_CARD_HEADROOM;
  if (mainCard.cardHeight <= maxHeight) return mainCard;
  const cardHeight = Math.round(maxHeight);
  const cardWidth = Math.round(cardHeight / CARD_ASPECT_RATIO);
  return { cardWidth, cardHeight };
}

function getOpponentHandCardDimensions(
  mainCard: CardDimensions, opponentHandHeight: number
): CardDimensions {
  const maxHeight = opponentHandHeight * OPP_HAND_HEADROOM;
  const heightBased = maxHeight / CARD_ASPECT_RATIO;
  const cardWidth = Math.round(Math.min(mainCard.cardWidth * OPP_HAND_SCALE, heightBased));
  const cardHeight = Math.round(cardWidth * CARD_ASPECT_RATIO);
  return { cardWidth, cardHeight };
}

function getPileCardDimensions(sidebarSlotHeight: number): CardDimensions {
  const maxHeight = sidebarSlotHeight * (1 - PILE_LABEL_RATIO);
  const cardHeight = Math.round(Math.max(30, maxHeight));
  const cardWidth = Math.round(cardHeight / CARD_ASPECT_RATIO);
  return { cardWidth, cardHeight };
}
```

- [ ] **Step 3: Implement `calculateMultiplayerLayout`**

This is the main export. Model the zone building after `calculateMirrorLayout` in `mirrorLayout.ts` (lines 68-173) but with the new proportions. Keep the same `buildSidebar` helper pattern and paragon support (6 zones when `isParagon`).

```typescript
export function calculateMultiplayerLayout(
  stageWidth: number,
  stageHeight: number,
  isParagon: boolean = false
): MultiplayerLayout {
  const pad = 6;
  const zonePad = 4;

  // Column widths
  // NOTE: The Konva stage is sized by its container (flex:1 area between chat sidebar and loupe).
  // stageWidth is already the canvas width — loupe is outside the stage.
  // So loupeWidth is not needed here and has been removed from the function signature.
  const sidebarWidth = Math.round(stageWidth * SIDEBAR_WIDTH_RATIO);
  const mainWidth = stageWidth - sidebarWidth;

  // Row heights
  const oppHandH = Math.round(stageHeight * OPP_HAND_RATIO);
  const oppTerritoryH = Math.round(stageHeight * OPP_TERRITORY_RATIO);
  const oppLobH = Math.round(stageHeight * OPP_LOB_RATIO);
  const dividerH = Math.round(stageHeight * DIVIDER_RATIO);
  const playerLobH = Math.round(stageHeight * PLAYER_LOB_RATIO);
  const playerTerritoryH = Math.round(stageHeight * PLAYER_TERRITORY_RATIO);
  const playerHandH = Math.round(stageHeight * PLAYER_HAND_RATIO);

  // Y anchors (top → bottom)
  let y = 0;
  const oppHandY = y; y += oppHandH;
  const oppTerritoryY = y; y += oppTerritoryH;
  const oppLobY = y; y += oppLobH;
  const dividerY = y; y += dividerH;
  const playerLobY = y; y += playerLobH;
  const playerTerritoryY = y; y += playerTerritoryH;
  const playerHandY = y;

  // Main play width (for zones — excludes sidebar column)
  const mainW = stageWidth - sidebarWidth;

  // --- Zone rects ---
  const zones = {
    opponentHand: { x: 0, y: oppHandY, width: stageWidth, height: oppHandH, label: 'Opponent Hand' },
    opponentTerritory: { x: pad, y: oppTerritoryY + pad, width: mainW - pad * 2, height: oppTerritoryH - pad * 2, label: 'Opponent Territory' },
    opponentLob: { x: pad, y: oppLobY + pad, width: mainW - pad * 2, height: oppLobH - pad * 2, label: 'Opponent Land of Bondage' },
    divider: { x: 0, y: dividerY, width: stageWidth, height: dividerH, label: '' },
    playerLob: { x: pad, y: playerLobY + pad, width: mainW - pad * 2, height: playerLobH - pad * 2, label: 'Land of Bondage' },
    playerTerritory: { x: pad, y: playerTerritoryY + pad, width: mainW - pad * 2, height: playerTerritoryH - pad * 2, label: 'Territory' },
    playerHand: { x: 0, y: playerHandY, width: stageWidth, height: playerHandH, label: 'Hand' },
  };

  // --- Sidebar ---
  // Build sidebar helper (same pattern as mirrorLayout.ts buildSidebar)
  function buildSidebar(
    areaY: number, areaHeight: number,
    labels: string[], keys: string[]
  ): Partial<Record<PileZone, ZoneRect>> {
    const count = labels.length;
    const slotPad = 4;
    const slotHeight = Math.round((areaHeight - slotPad * (count + 1)) / count);
    const result: Partial<Record<PileZone, ZoneRect>> = {};
    labels.forEach((label, i) => {
      result[keys[i] as PileZone] = {
        x: mainW + zonePad,
        y: areaY + slotPad * (i + 1) + slotHeight * i,
        width: sidebarWidth - zonePad * 2,
        height: slotHeight,
        label,
      };
    });
    return result;
  }

  // Player sidebar: top 50% = opponent, bottom 50% = player
  const sidebarHalf = Math.round(stageHeight / 2);

  const oppPileLabels = isParagon
    ? ['Paragon', 'Discard', 'Deck', 'Reserve', 'Banish Zone', 'Land of Redemption']
    : ['Discard', 'Deck', 'Reserve', 'Banish Zone', 'Land of Redemption'];
  const oppPileKeys = isParagon
    ? ['paragon', 'discard', 'deck', 'reserve', 'banish', 'lor']
    : ['discard', 'deck', 'reserve', 'banish', 'lor'];

  const myPileLabels = isParagon
    ? ['Land of Redemption', 'Banish Zone', 'Reserve', 'Deck', 'Discard', 'Paragon']
    : ['Land of Redemption', 'Banish Zone', 'Reserve', 'Deck', 'Discard'];
  const myPileKeys = isParagon
    ? ['lor', 'banish', 'reserve', 'deck', 'discard', 'paragon']
    : ['lor', 'banish', 'reserve', 'deck', 'discard'];

  const sidebar = {
    opponent: buildSidebar(0, sidebarHalf, oppPileLabels, oppPileKeys),
    player: buildSidebar(sidebarHalf, stageHeight - sidebarHalf, myPileLabels, myPileKeys),
  };

  // --- Card dimensions (four tiers) ---
  const effectivePlayWidth = mainW;  // play area width for card sizing
  const mainCard = getMainCardDimensions(effectivePlayWidth, stageHeight);
  const lobCard = getLobCardDimensions(mainCard, oppLobH);  // use raw zone height (before padding)
  const opponentHandCard = getOpponentHandCardDimensions(mainCard, oppHandH);

  // Pile card: use the computed sidebar slot height
  const sampleSlotHeight = Math.round(
    (sidebarHalf - 4 * ((isParagon ? 6 : 5) + 1)) / (isParagon ? 6 : 5)
  );
  const pileCard = getPileCardDimensions(sampleSlotHeight);

  return {
    zones,
    sidebar,
    mainCard,
    lobCard,
    opponentHandCard,
    pileCard,
    sidebarWidth,
    playAreaWidth: effectivePlayWidth,
  };
}
```

- [ ] **Step 4: Verify the file compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add app/play/layout/multiplayerLayout.ts
git commit -m "feat: add multiplayerLayout.ts with four-tier card sizing and proportional zones"
```

---

### Task 2: Create `multiplayerHandLayout.ts` — Hand fan positioning

Extract the hand fan calculation from `MultiplayerCanvas.tsx` (lines 104-138) into a dedicated file, adapted to accept card dimensions as a parameter (instead of computing them inline).

**Files:**
- Create: `app/play/layout/multiplayerHandLayout.ts`

**Reference:**
- `app/play/components/MultiplayerCanvas.tsx:104-138` — current `calculateMultiplayerHandPositions`
- `app/goldfish/layout/handLayout.ts` — goldfish version for comparison
- `app/play/layout/multiplayerLayout.ts` — `ZoneRect` type to import

- [ ] **Step 1: Create the file**

```typescript
// app/play/layout/multiplayerHandLayout.ts

import type { ZoneRect } from './multiplayerLayout';

export interface HandCardPosition {
  x: number;
  y: number;
  rotation: number;
}

/**
 * Calculate fan positions for cards in a hand zone.
 * Works for both player hand (full size) and opponent hand (compact).
 */
export function calculateHandPositions(
  cardCount: number,
  handRect: ZoneRect,
  cardWidth: number,
  cardHeight: number,
): HandCardPosition[] {
  if (cardCount === 0) return [];

  const centerX = handRect.x + handRect.width / 2;
  const handAreaWidth = handRect.width * 0.75;
  const handY = handRect.y + Math.max(0, (handRect.height - cardHeight) / 2);

  const maxArcAngle = 20;
  const minVisibleFraction = 0.3;

  const maxCardSpacing = cardWidth + 4;
  const minCardSpacing = cardWidth * minVisibleFraction;
  const idealSpacing = Math.min(maxCardSpacing, handAreaWidth / Math.max(cardCount, 1));
  const spacing = Math.max(minCardSpacing, idealSpacing);

  const totalWidth = (cardCount - 1) * spacing;
  const startX = centerX - totalWidth / 2;

  const arcAngle = cardCount > 1 ? maxArcAngle / (cardCount - 1) : 0;
  const startAngle = -maxArcAngle / 2;

  return Array.from({ length: cardCount }, (_, i) => {
    const x = startX + i * spacing;
    const rotation = cardCount > 1 ? startAngle + i * arcAngle : 0;
    const normalizedPos = cardCount > 1 ? (i / (cardCount - 1)) * 2 - 1 : 0;
    const yOffset = normalizedPos * normalizedPos * 8;
    return { x, y: handY + yOffset, rotation };
  });
}
```

- [ ] **Step 2: Verify compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add app/play/layout/multiplayerHandLayout.ts
git commit -m "feat: extract hand fan layout into multiplayerHandLayout.ts"
```

---

### Task 3: Create `multiplayerAutoArrange.ts` — Zone auto-arrange logic

Extract the auto-arrange function from `MultiplayerCanvas.tsx` (lines 159-179).

**Files:**
- Create: `app/play/layout/multiplayerAutoArrange.ts`

**Reference:**
- `app/play/components/MultiplayerCanvas.tsx:159-179` — current `calculateAutoArrangePositions`
- `app/play/layout/multiplayerLayout.ts` — `ZoneRect` type

- [ ] **Step 1: Create the file**

```typescript
// app/play/layout/multiplayerAutoArrange.ts

import type { ZoneRect } from './multiplayerLayout';

/**
 * Calculate auto-arranged positions for cards in a horizontal strip zone (LOB).
 * Cards are laid out left-to-right with overlap when space is tight.
 */
export function calculateAutoArrangePositions(
  cardCount: number,
  zone: ZoneRect,
  cardWidth: number,
  cardHeight: number,
): { x: number; y: number }[] {
  if (cardCount === 0) return [];

  const padding = 8;
  const availWidth = zone.width - padding * 2;
  const maxSpacing = cardWidth + 6;
  const minSpacing = cardWidth * 0.4;
  const idealSpacing = Math.min(maxSpacing, availWidth / Math.max(cardCount, 1));
  const spacing = Math.max(minSpacing, idealSpacing);
  const startX = zone.x + padding;
  const cy = zone.y + zone.height / 2 - cardHeight / 2;

  return Array.from({ length: cardCount }, (_, i) => ({
    x: startX + i * spacing,
    y: cy,
  }));
}
```

- [ ] **Step 2: Verify compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add app/play/layout/multiplayerAutoArrange.ts
git commit -m "feat: extract auto-arrange layout into multiplayerAutoArrange.ts"
```

---

### Task 4: Parameterize `CardPreviewContext` for multiplayer localStorage key

The goldfish `CardPreviewContext` hardcodes `goldfish-loupe-visible` as the localStorage key. Multiplayer needs `multiplayer-loupe-visible` so the two modes are independent.

**Files:**
- Modify: `app/goldfish/state/CardPreviewContext.tsx`

**Reference:**
- Read the full file (72 lines) — the `STORAGE_KEY` constant at line 5 and the `CardPreviewProvider` at lines 26-65

- [ ] **Step 1: Add an optional `storageKey` prop to `CardPreviewProvider`**

In `CardPreviewContext.tsx`, change:

```typescript
// Before:
const STORAGE_KEY = 'goldfish-loupe-visible';
// ...
export function CardPreviewProvider({ children }: { children: ReactNode }) {

// After:
const DEFAULT_STORAGE_KEY = 'goldfish-loupe-visible';
// ...
export function CardPreviewProvider({
  children,
  storageKey = DEFAULT_STORAGE_KEY
}: {
  children: ReactNode;
  storageKey?: string;
}) {
```

Then replace all `STORAGE_KEY` references inside the component with the `storageKey` prop (lines 30, 39).

- [ ] **Step 2: Verify goldfish still works** — existing usage passes no `storageKey`, so it defaults to `'goldfish-loupe-visible'`

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add app/goldfish/state/CardPreviewContext.tsx
git commit -m "refactor: parameterize CardPreviewContext localStorage key for multiplayer reuse"
```

---

### Task 5: Update `MultiplayerCanvas.tsx` — Use new layout files + four-tier card sizing

This is the largest task. Replace all inline layout math with imports from the new layout files, and use the four card size tiers.

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

**Reference:**
- The current file (1699 lines). Key areas:
  - Lines 9-13: imports from `mirrorLayout`
  - Lines 104-138: `calculateMultiplayerHandPositions` (now in `multiplayerHandLayout.ts`)
  - Lines 159-179: `calculateAutoArrangePositions` (now in `multiplayerAutoArrange.ts`)
  - Lines 224-239: layout + card dimension computation
  - Lines 839, 1548: calls to `calculateMultiplayerHandPositions`
  - Lines 1276, 1319: calls to `calculateAutoArrangePositions`
  - Lines 1361-1509: pile zone rendering using `pileCardWidth`/`pileCardHeight`
- `app/play/layout/multiplayerLayout.ts` — new layout (from Task 1)

- [ ] **Step 1: Update imports**

Replace:
```typescript
import {
  calculateMirrorLayout,
  getCardDimensions,
  type ZoneRect,
} from '../layout/mirrorLayout';
```

With:
```typescript
import {
  calculateMultiplayerLayout,
  type ZoneRect,
  type MultiplayerLayout,
} from '../layout/multiplayerLayout';
import { calculateHandPositions } from '../layout/multiplayerHandLayout';
import { calculateAutoArrangePositions } from '../layout/multiplayerAutoArrange';
```

- [ ] **Step 2: Delete the inline `calculateMultiplayerHandPositions` function** (lines 104-138)

- [ ] **Step 3: Delete the inline `calculateAutoArrangePositions` function** (lines 159-179)

- [ ] **Step 4: Update the layout computation block** (lines 224-239)

Replace:
```typescript
const layout = useMemo(
  () => (width > 0 && height > 0 ? calculateMirrorLayout(width, height) : null),
  [width, height],
);
const { cardWidth, cardHeight } = useMemo(
  () => (width > 0 ? getCardDimensions(width) : { cardWidth: 0, cardHeight: 0 }),
  [width],
);
const samplePileZone = layout?.myZones?.['deck'];
const pileSlotHeight = samplePileZone?.height ?? 60;
const pileCardHeight = Math.min(Math.round(cardHeight * 0.6), Math.max(30, pileSlotHeight - 28));
const pileCardWidth = Math.round(pileCardHeight / 1.4);
```

With:
```typescript
const mpLayout = useMemo(
  () => (width > 0 && height > 0 ? calculateMultiplayerLayout(width, height) : null),
  [width, height],
);

// Four-tier card dimensions
const { cardWidth, cardHeight } = mpLayout?.mainCard ?? { cardWidth: 0, cardHeight: 0 };
const lobCard = mpLayout?.lobCard ?? { cardWidth: 0, cardHeight: 0 };
const oppHandCard = mpLayout?.opponentHandCard ?? { cardWidth: 0, cardHeight: 0 };
const pileCardWidth = mpLayout?.pileCard.cardWidth ?? 0;
const pileCardHeight = mpLayout?.pileCard.cardHeight ?? 0;
```

Note: `isParagon` is not wired up yet (defaults to `false`). Wiring it from game state is a follow-up — the current `calculateMirrorLayout` also defaults to `false`.

- [ ] **Step 5a: Build compatibility helpers for the flat→split zone structure**

The old layout merged play zones and sidebar into one flat `Record<string, ZoneRect>` (`myZones`, `opponentZones`). The new layout splits them into `mpLayout.zones.*` and `mpLayout.sidebar.*`. To avoid rewriting every `Object.entries()` loop at once, create helper functions that reconstruct flat zone records from the new layout:

```typescript
// Near the top of the component, after layout computation:
const myZones: Record<string, ZoneRect> = useMemo(() => {
  if (!mpLayout) return {};
  return {
    territory: mpLayout.zones.playerTerritory,
    'land-of-bondage': mpLayout.zones.playerLob,
    // Sidebar zones — keep the original string keys that SpacetimeDB uses
    'land-of-redemption': mpLayout.sidebar.player.lor!,
    banish: mpLayout.sidebar.player.banish!,
    reserve: mpLayout.sidebar.player.reserve!,
    deck: mpLayout.sidebar.player.deck!,
    discard: mpLayout.sidebar.player.discard!,
    ...(mpLayout.sidebar.player.paragon ? { paragon: mpLayout.sidebar.player.paragon } : {}),
  };
}, [mpLayout]);

const opponentZones: Record<string, ZoneRect> = useMemo(() => {
  if (!mpLayout) return {};
  return {
    territory: mpLayout.zones.opponentTerritory,
    'land-of-bondage': mpLayout.zones.opponentLob,
    'land-of-redemption': mpLayout.sidebar.opponent.lor!,
    banish: mpLayout.sidebar.opponent.banish!,
    reserve: mpLayout.sidebar.opponent.reserve!,
    deck: mpLayout.sidebar.opponent.deck!,
    discard: mpLayout.sidebar.opponent.discard!,
    ...(mpLayout.sidebar.opponent.paragon ? { paragon: mpLayout.sidebar.opponent.paragon } : {}),
  };
}, [mpLayout]);

const myHandRect = mpLayout?.zones.playerHand ?? null;
const opponentHandRect = mpLayout?.zones.opponentHand ?? null;
```

**Why this approach:** SpacetimeDB stores zone names as strings like `'territory'`, `'land-of-bondage'`, `'land-of-redemption'`, etc. These keys MUST stay the same — they're the DB schema. The compatibility helpers reconstruct the flat record using the original string keys, so all existing `Object.entries()` loops, `findZoneAtPosition`, and SpacetimeDB zone key lookups continue to work unchanged.

The `SIDEBAR_PILE_ZONES` constant on line 38 also keeps its original values — no changes needed.

- [ ] **Step 5b: Update hand rect references**

Replace `layout.myHandRect` → `myHandRect` and `layout.opponentHandRect` → `opponentHandRect` throughout. These are now derived from `mpLayout.zones.playerHand` and `mpLayout.zones.opponentHand` via the helpers above.

- [ ] **Step 5c: Replace `layout.myZones` / `layout.opponentZones` with the computed `myZones` / `opponentZones`**

Since we reconstructed the same flat structure, most existing code using `myZones[zoneKey]` and `opponentZones[zoneKey]` works as-is. The key change is that `layout.myZones` becomes just `myZones` (the local computed variable). Search-and-replace:

- `layout?.myZones` → `myZones` (or null-check as needed)
- `layout?.opponentZones` → `opponentZones`
- `layout.myZones` → `myZones`
- `layout.opponentZones` → `opponentZones`
- `layout` null checks → `mpLayout` null checks

- [ ] **Step 6: Update LOB rendering to use `lobCard` dimensions**

Find all places where LOB cards are rendered (search for `land-of-bondage` or `Auto-arrange` in render code, lines ~1276-1319). Change the card dimensions from `cardWidth, cardHeight` to `lobCard.cardWidth, lobCard.cardHeight`:

```typescript
// Player LOB
const positions = calculateAutoArrangePositions(
  cards.length, zone, lobCard.cardWidth, lobCard.cardHeight
);
// ... render with lobCard.cardWidth, lobCard.cardHeight

// Opponent LOB — same change
```

- [ ] **Step 7: Update opponent hand to use `oppHandCard` dimensions**

Find the opponent hand rendering (~line 1518-1538). The opponent hand currently uses inline linear spacing (NOT `calculateMultiplayerHandPositions`). Change it to use the extracted `calculateHandPositions` with the opponent card tier — this changes the visual from linear row to fan arc, which is a deliberate improvement. Update card dimensions to `oppHandCard.cardWidth, oppHandCard.cardHeight`:

```typescript
// Opponent hand positions (now uses fan arc like player hand, but with smaller cards)
const oppHandPositions = calculateHandPositions(
  opponentHandCards.length,
  opponentHandRect!,
  oppHandCard.cardWidth,
  oppHandCard.cardHeight,
);
```

Also update the `CardBackShape` rendering to use `oppHandCard.cardWidth` and `oppHandCard.cardHeight`.

- [ ] **Step 8: Update player hand to use `mainCard` dimensions with new `calculateHandPositions`**

```typescript
const myHandPositions = calculateHandPositions(
  myHandCards.length,
  mpLayout.zones.playerHand,
  cardWidth,
  cardHeight,
);
```

- [ ] **Step 9: Verify compiles and no regressions**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 10: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "refactor: use new layout files and four-tier card sizing in MultiplayerCanvas"
```

---

### Task 6: Add CardLoupePanel to multiplayer — Replace CardPreviewPanel

Wire up the goldfish CardLoupePanel in the multiplayer game client.

**Files:**
- Modify: `app/play/[code]/client.tsx`
- Modify: `app/play/components/MultiplayerCanvas.tsx`
- Delete: `app/play/components/CardPreviewPanel.tsx`

**Reference:**
- `app/play/[code]/client.tsx` — the game room client. Search for `CardPreviewPanel`, `hoveredCard`, `onHoveredCardChange` to find all integration points
- `app/goldfish/[deckId]/client.tsx` — how goldfish wraps with `CardPreviewProvider` and places `CardLoupePanel` (lines 142-144, 148-155)
- `app/goldfish/state/CardPreviewContext.tsx` — `useCardPreview` hook
- `app/goldfish/components/CardLoupePanel.tsx` — exports `LOUPE_PANEL_WIDTH`, `LOUPE_COLLAPSED_WIDTH`

- [ ] **Step 1: In `client.tsx`, add CardPreviewProvider + CardLoupePanel imports**

```typescript
import { CardPreviewProvider, useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { CardLoupePanel, LOUPE_PANEL_WIDTH, LOUPE_COLLAPSED_WIDTH } from '@/app/goldfish/components/CardLoupePanel';
```

Remove the `CardPreviewPanel` import and the `hoveredCard` state.

- [ ] **Step 2: Wrap `GameInner` in `CardPreviewProvider`**

In the `GameClient` component (or wherever `GameInner` is rendered), wrap with:
```tsx
<CardPreviewProvider storageKey="multiplayer-loupe-visible">
  <GameInner ... />
</CardPreviewProvider>
```

- [ ] **Step 3: Restructure the playing layout**

The current layout is `[leftSidebar (preview + chat) | canvas]`. Change to `[leftSidebar (chat only) | canvas | loupePanel]`.

Inside `GameInner`, in the `lifecycle === 'playing'` render path, change the layout from a two-column to a three-column flex:

```tsx
<div style={{ display: 'flex', width: '100vw', height: '100vh' }}>
  {/* Left: Chat only */}
  <div style={{ width: 'clamp(180px, 12vw, 240px)', flexShrink: 0 }}>
    <ChatPanel ... />
  </div>

  {/* Center: Canvas (flex: 1) */}
  <div style={{ flex: 1, position: 'relative' }}>
    <MultiplayerCanvas gameId={...} />
    <TurnIndicator ... />
  </div>

  {/* Right: Loupe */}
  <CardLoupePanel />
</div>
```

Remove the old `CardPreviewPanel` from the left sidebar.

**Important:** `client.tsx` has multiple render paths — the `leftSidebar` variable (~line 331) serves both `playing` and `finished` states. Update the `leftSidebar` definition to remove `CardPreviewPanel` and reduce width. Also add the `CardLoupePanel` to all render paths that show the canvas (playing state at ~line 427 and finished-with-canvas state at ~line 363).

- [ ] **Step 4: In `MultiplayerCanvas.tsx`, replace `onHoveredCardChange` prop with `useCardPreview`**

Remove the `onHoveredCardChange` prop from the interface. Import `useCardPreview` and call `setPreviewCard` on hover:

```typescript
const { setPreviewCard } = useCardPreview();

// In the hover handler (search for onHoveredCardChange):
// Replace:  onHoveredCardChange?.(card);
// With:     setPreviewCard(card ? { cardName: card.cardName, cardImgFile: card.cardImgFile } : null);
```

- [ ] **Step 5: Update canvas width to account for loupe**

The canvas `width` is now `containerWidth` which is the flex:1 area. The loupe is outside the canvas. The layout's `loupeWidth` parameter should be `0` because the Konva stage only fills its container (which is already sized correctly by flex). This is already correct from Task 5 Step 4.

- [ ] **Step 6: Delete `CardPreviewPanel.tsx`**

```bash
rm app/play/components/CardPreviewPanel.tsx
```

- [ ] **Step 7: Verify compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: replace CardPreviewPanel with CardLoupePanel in multiplayer"
```

---

### Task 7: Delete old `mirrorLayout.ts` and clean up

**Files:**
- Delete: `app/play/layout/mirrorLayout.ts`
- Modify: any remaining imports

- [ ] **Step 1: Search for remaining references**

Run: `grep -r 'mirrorLayout' app/play/`

If any file still imports from `mirrorLayout`, update it to import from `multiplayerLayout`.

- [ ] **Step 2: Delete the file**

```bash
rm app/play/layout/mirrorLayout.ts
```

- [ ] **Step 3: Full build check**

Run: `npm run build 2>&1 | tail -20`
Expected: Clean build, no errors

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete old mirrorLayout.ts, replaced by multiplayerLayout.ts"
```

---

### Task 8: Visual verification at multiple viewport sizes

Open the multiplayer game at `localhost:3000/play`, create a game, and verify the layout at different browser window sizes.

**Files:** None (testing only)

- [ ] **Step 1: Test at 1920×1080** — Cards should fit all zones. Loupe visible on right. Player hand readable. Opponent hand compact with face-down backs.

- [ ] **Step 2: Test at 1366×768** — Everything should scale down proportionally. No overflow.

- [ ] **Step 3: Test at 1280×720** — Minimum target. Cards should be small but visible in all zones.

- [ ] **Step 4: Test at 2560×1440** — Cards should not be absurdly large. Proportions should hold.

- [ ] **Step 5: Test loupe collapse/expand** — Click the chevron. Canvas should resize. Card preview should show on hover.

- [ ] **Step 6: Resize window dynamically** — Drag the window edge. Layout should recompute smoothly without cards disappearing or overflowing.

- [ ] **Step 7: Test Paragon format** — If available, verify 6 sidebar zones per player.
