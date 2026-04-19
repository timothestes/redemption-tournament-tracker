# Virtual Canvas Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace viewport-relative layout math with a fixed 1920x1080 virtual canvas so the game looks identical on every screen.

**Architecture:** A shared `virtualCanvas.ts` module provides constants, a scaling hook, and coordinate transforms. Both goldfish and multiplayer canvases render all game content inside a scaled Konva `<Layer>` while keeping the Stage at real container dimensions. Letterbox areas show the cave background. Context menus continue using `clientX`/`clientY` (no changes). Selection lasso and modal card drag use the Layer's `getRelativePointerPosition()` for virtual-coord pointer queries.

**Tech Stack:** Konva (react-konva), TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-29-virtual-canvas-scaling-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `app/shared/layout/virtualCanvas.ts` | Constants (1920x1080), `calculateScale()`, `virtualToScreen()`/`screenToVirtual()`, `useVirtualCanvas()` hook |
| `app/shared/layout/__tests__/virtualCanvas.test.ts` | Unit tests for pure scaling/transform functions |

### Modified files
| File | What changes |
|------|-------------|
| `app/goldfish/[deckId]/client.tsx` | Remove viewport state + window.resize + MAX_ASPECT_RATIO. Use `useVirtualCanvas`. Pass scale/offset to canvas. |
| `app/goldfish/components/GoldfishCanvas.tsx` | Accept scale/offset props. Add scaled game Layer + letterbox Layer. Fix pointer coords in selection lasso, deck drop popup, zone menu spawn. Pass `VIRTUAL_WIDTH`/`VIRTUAL_HEIGHT` to layout functions. |
| `app/goldfish/layout/zoneLayout.ts` | Remove `CARD_WIDTH_RATIO`/`CARD_HEIGHT_RATIO`. Replace `getCardDimensions()` with constants. |
| `app/goldfish/layout/handLayout.ts` | Remove `getCardDimensions` import/call. Accept card dimensions as params. |
| `app/play/components/MultiplayerCanvas.tsx` | Replace inline ResizeObserver with `useVirtualCanvas`. Add scaled game Layer + letterbox Layer. Fix pointer coords in selection lasso, deck drop popup, LOB menu spawn. Pass `VIRTUAL_WIDTH`/`VIRTUAL_HEIGHT` to layout. |
| `app/play/layout/multiplayerLayout.ts` | Remove dynamic card sizing functions. Replace with constants computed from 1920x1080. |
| `app/shared/hooks/useModalCardDrag.ts` | Accept scale/offset options. Convert `clientX - rect.left` to virtual coords via `screenToVirtual()`. |

---

## Task 1: Create Virtual Canvas Module

**Files:**
- Create: `app/shared/layout/__tests__/virtualCanvas.test.ts`
- Create: `app/shared/layout/virtualCanvas.ts`

- [ ] **Step 1: Write failing tests for `calculateScale`**

```typescript
// app/shared/layout/__tests__/virtualCanvas.test.ts
import { describe, it, expect } from 'vitest';
import { calculateScale, virtualToScreen, screenToVirtual, VIRTUAL_WIDTH, VIRTUAL_HEIGHT } from '../virtualCanvas';

describe('calculateScale', () => {
  it('returns scale 1.0 when container matches virtual size', () => {
    const result = calculateScale(1920, 1080);
    expect(result.scale).toBe(1);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
  });

  it('scales down for smaller container, no letterbox on matching aspect ratio', () => {
    const result = calculateScale(960, 540);
    expect(result.scale).toBe(0.5);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
  });

  it('adds horizontal letterbox for ultrawide container', () => {
    // 3440x1440 ultrawide — height is limiting factor
    const result = calculateScale(3440, 1440);
    expect(result.scale).toBeCloseTo(1440 / 1080); // ~1.333
    const scaledWidth = 1920 * result.scale;
    expect(result.offsetX).toBeCloseTo((3440 - scaledWidth) / 2);
    expect(result.offsetY).toBe(0);
  });

  it('adds vertical letterbox for tall/narrow container', () => {
    // 1080x1920 portrait — width is limiting factor
    const result = calculateScale(1080, 1920);
    expect(result.scale).toBeCloseTo(1080 / 1920); // 0.5625
    const scaledHeight = 1080 * result.scale;
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBeCloseTo((1920 - scaledHeight) / 2);
  });
});

describe('virtualToScreen', () => {
  it('converts virtual origin to screen offset', () => {
    const result = virtualToScreen(0, 0, 0.5, 100, 50);
    expect(result.x).toBe(100);
    expect(result.y).toBe(50);
  });

  it('converts virtual center to scaled screen position', () => {
    const result = virtualToScreen(960, 540, 0.5, 100, 50);
    expect(result.x).toBe(960 * 0.5 + 100); // 580
    expect(result.y).toBe(540 * 0.5 + 50);  // 320
  });
});

describe('screenToVirtual', () => {
  it('is the inverse of virtualToScreen', () => {
    const scale = 0.75;
    const offsetX = 120;
    const offsetY = 30;
    const vx = 500;
    const vy = 300;
    const screen = virtualToScreen(vx, vy, scale, offsetX, offsetY);
    const back = screenToVirtual(screen.x, screen.y, scale, offsetX, offsetY);
    expect(back.x).toBeCloseTo(vx);
    expect(back.y).toBeCloseTo(vy);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/shared/layout/__tests__/virtualCanvas.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement virtualCanvas.ts**

```typescript
// app/shared/layout/virtualCanvas.ts
import { useState, useEffect, useMemo, type RefObject } from 'react';

// ── Constants ──────────────────────────────────────────────────────────────
export const VIRTUAL_WIDTH = 1920;
export const VIRTUAL_HEIGHT = 1080;
export const VIRTUAL_ASPECT_RATIO = VIRTUAL_WIDTH / VIRTUAL_HEIGHT;

// ── Scaling ────────────────────────────────────────────────────────────────

export interface ScaleResult {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Compute a uniform scale factor + centering offsets to fit the fixed
 * virtual canvas (1920x1080) inside an arbitrary real container.
 */
export function calculateScale(containerWidth: number, containerHeight: number): ScaleResult {
  const scale = Math.min(containerWidth / VIRTUAL_WIDTH, containerHeight / VIRTUAL_HEIGHT);
  const scaledWidth = VIRTUAL_WIDTH * scale;
  const scaledHeight = VIRTUAL_HEIGHT * scale;
  return {
    scale,
    offsetX: (containerWidth - scaledWidth) / 2,
    offsetY: (containerHeight - scaledHeight) / 2,
  };
}

// ── Coordinate transforms (for HTML overlays) ─────────────────────────────

/** Convert a point in virtual canvas space to screen (container-relative) pixels. */
export function virtualToScreen(
  vx: number, vy: number,
  scale: number, offsetX: number, offsetY: number,
): { x: number; y: number } {
  return { x: vx * scale + offsetX, y: vy * scale + offsetY };
}

/** Convert a screen (container-relative) pixel position to virtual canvas coords. */
export function screenToVirtual(
  sx: number, sy: number,
  scale: number, offsetX: number, offsetY: number,
): { x: number; y: number } {
  return { x: (sx - offsetX) / scale, y: (sy - offsetY) / scale };
}

// ── React hook ─────────────────────────────────────────────────────────────

export interface VirtualCanvasState extends ScaleResult {
  containerWidth: number;
  containerHeight: number;
}

/**
 * Observes a container div and returns the current scale/offset needed to
 * fit the 1920x1080 virtual canvas inside it.
 */
export function useVirtualCanvas(containerRef: RefObject<HTMLDivElement | null>): VirtualCanvasState {
  const [container, setContainer] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainer({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const scaling = useMemo(
    () => calculateScale(container.width, container.height),
    [container.width, container.height],
  );

  return { ...scaling, containerWidth: container.width, containerHeight: container.height };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/shared/layout/__tests__/virtualCanvas.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/shared/layout/virtualCanvas.ts app/shared/layout/__tests__/virtualCanvas.test.ts
git commit -m "feat: add virtual canvas scaling module with tests"
```

---

## Task 2: Simplify Goldfish Layout Functions

**Files:**
- Modify: `app/goldfish/layout/zoneLayout.ts`
- Modify: `app/goldfish/layout/handLayout.ts`

The goal: remove viewport-relative ratio constants. Card dimensions become fixed constants derived from 1920x1080. Layout functions still accept `stageWidth`/`stageHeight` params (callers will pass `VIRTUAL_WIDTH`/`VIRTUAL_HEIGHT`), so this task doesn't break anything.

- [ ] **Step 1: Replace `getCardDimensions` with constants in zoneLayout.ts**

In `app/goldfish/layout/zoneLayout.ts`, replace lines 11-31:

```typescript
// Card dimensions as proportions of stage width
export const CARD_WIDTH_RATIO = 0.052; // ~100px at 1920
export const CARD_HEIGHT_RATIO = 0.093; // ~100 * 1.4 aspect ratio at 1080
export const CARD_ASPECT_RATIO = 1.4;

export function getCardDimensions(stageWidth: number, stageHeight?: number) {
  const widthBased = Math.round(stageWidth * CARD_WIDTH_RATIO);

  if (stageHeight) {
    // Ensure a card fits inside a sidebar zone (5 zones in play area, ~24px label padding)
    const playAreaHeight = stageHeight * 0.73; // after phase bar and hand
    const sidebarZoneHeight = playAreaHeight / 5;
    const maxCardHeight = sidebarZoneHeight - 28; // room for label + padding
    const heightBased = Math.round(maxCardHeight / CARD_ASPECT_RATIO);
    const w = Math.min(widthBased, heightBased);
    return { cardWidth: w, cardHeight: Math.round(w * CARD_ASPECT_RATIO) };
  }

  const height = Math.round(widthBased * CARD_ASPECT_RATIO);
  return { cardWidth: widthBased, cardHeight: height };
}
```

With:

```typescript
// Fixed card dimensions in virtual canvas coordinates (1920x1080).
// Previously computed as proportions of viewport — now constants.
export const CARD_ASPECT_RATIO = 1.4;
export const CARD_WIDTH = 100;   // was Math.round(1920 * 0.052)
export const CARD_HEIGHT = 140;  // was Math.round(100 * 1.4)

/** @deprecated Use CARD_WIDTH / CARD_HEIGHT constants directly. */
export function getCardDimensions(_stageWidth: number, _stageHeight?: number) {
  return { cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT };
}
```

- [ ] **Step 2: Update handLayout.ts to accept card dimensions as params**

In `app/goldfish/layout/handLayout.ts`, replace the entire file:

```typescript
export interface HandCardPosition {
  x: number;
  y: number;
  rotation: number;
}

/**
 * Calculate card positions in a fan arc for the hand zone.
 * All coordinates are in virtual canvas space (1920x1080).
 */
export function calculateHandPositions(
  cardCount: number,
  stageWidth: number,
  stageHeight: number,
  isSpread: boolean,
  cardWidth: number,
  cardHeight: number,
): HandCardPosition[] {
  if (cardCount === 0) return [];

  const handZoneTop = stageHeight - stageHeight * 0.22;
  const centerX = stageWidth / 2;
  const handAreaWidth = stageWidth * 0.75;

  // Vertically center cards in the hand zone, leaving room for the toolbar (~60px)
  const toolbarReserve = 60;
  const availableHeight = stageHeight - handZoneTop - toolbarReserve;
  const handY = handZoneTop + Math.max(0, (availableHeight - cardHeight) / 2);

  if (isSpread) {
    // Flat spread — no overlap, no rotation
    const totalWidth = cardCount * (cardWidth + 6);
    const startX = centerX - totalWidth / 2;
    return Array.from({ length: cardCount }, (_, i) => ({
      x: startX + i * (cardWidth + 6),
      y: handY,
      rotation: 0,
    }));
  }

  // Fan arc layout
  const maxArcAngle = 20; // degrees total arc spread
  const minVisibleFraction = 0.3;

  // Calculate overlap based on card count
  const maxCardSpacing = cardWidth + 4;
  const minCardSpacing = cardWidth * minVisibleFraction;
  const idealSpacing = Math.min(maxCardSpacing, handAreaWidth / Math.max(cardCount, 1));
  const spacing = Math.max(minCardSpacing, idealSpacing);

  const totalWidth = (cardCount - 1) * spacing;
  const startX = centerX - totalWidth / 2;

  // Arc angle per card
  const arcAngle = cardCount > 1 ? maxArcAngle / (cardCount - 1) : 0;
  const startAngle = -maxArcAngle / 2;

  return Array.from({ length: cardCount }, (_, i) => {
    const x = startX + i * spacing;
    const rotation = cardCount > 1 ? startAngle + i * arcAngle : 0;
    // Slight arc in y position (cards in the middle are slightly higher)
    const normalizedPos = cardCount > 1 ? (i / (cardCount - 1)) * 2 - 1 : 0;
    const yOffset = normalizedPos * normalizedPos * 15; // parabolic arc
    return {
      x,
      y: handY + yOffset,
      rotation,
    };
  });
}
```

- [ ] **Step 3: Verify the app still builds**

Run: `npx next build 2>&1 | tail -20` (or `npm run build`)

If there are compile errors from callers of `calculateHandPositions` that don't pass the new `cardWidth`/`cardHeight` params, fix them in the next task. The old `getCardDimensions` is kept as a deprecated shim so `GoldfishCanvas.tsx` still compiles until Task 3 updates it.

- [ ] **Step 4: Commit**

```bash
git add app/goldfish/layout/zoneLayout.ts app/goldfish/layout/handLayout.ts
git commit -m "refactor: goldfish layout uses fixed card dimensions for virtual canvas"
```

---

## Task 3: Migrate Goldfish Canvas to Virtual Canvas

**Files:**
- Modify: `app/goldfish/[deckId]/client.tsx`
- Modify: `app/goldfish/components/GoldfishCanvas.tsx`

This is the largest task — it restructures the Stage, fixes all coordinate-sensitive code, and wires up the virtual canvas hook.

### Step-by-step

- [ ] **Step 1: Update GoldfishCanvas props interface**

In `app/goldfish/components/GoldfishCanvas.tsx`, change the props interface (around line 36-38) from:

```typescript
interface GoldfishCanvasProps {
  width: number;
  height: number;
}
```

To:

```typescript
interface GoldfishCanvasProps {
  containerWidth: number;
  containerHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}
```

And update the destructuring at the top of the component (around line 41):

```typescript
export default function GoldfishCanvas({ containerWidth, containerHeight, scale, offsetX, offsetY }: GoldfishCanvasProps) {
```

- [ ] **Step 2: Replace layout calculations with virtual canvas constants**

In `GoldfishCanvas.tsx`, find the layout/card-dimension `useMemo` calls (around lines 212-213):

```typescript
const zoneLayout = useMemo(() => calculateZoneLayout(width, height, isParagon), [width, height, isParagon]);
const { cardWidth, cardHeight } = useMemo(() => getCardDimensions(width, height), [width, height]);
```

Replace with:

```typescript
import { VIRTUAL_WIDTH, VIRTUAL_HEIGHT, virtualToScreen } from '@/app/shared/layout/virtualCanvas';
import { CARD_WIDTH, CARD_HEIGHT } from '../layout/zoneLayout';

// Layout computed once against fixed virtual canvas — no viewport dependency
const zoneLayout = useMemo(() => calculateZoneLayout(VIRTUAL_WIDTH, VIRTUAL_HEIGHT, isParagon), [isParagon]);
const cardWidth = CARD_WIDTH;
const cardHeight = CARD_HEIGHT;
```

Also update the `rotateSidebarPiles` line (around line 216):

```typescript
// const rotateSidebarPiles = width / height > 1.9;
const rotateSidebarPiles = false; // Virtual canvas is always 16:9 — no need for rotation hack
```

- [ ] **Step 3: Update hand position calculation**

Find where hand positions are calculated (search for `calculateHandPositions` call). Update to pass card dimensions and virtual canvas size:

```typescript
// Old:
const handPositions = calculateHandPositions(handCards.length, width, height, state.isSpreadHand);

// New:
const handPositions = calculateHandPositions(handCards.length, VIRTUAL_WIDTH, VIRTUAL_HEIGHT, state.isSpreadHand, cardWidth, cardHeight);
```

- [ ] **Step 4: Add `gameLayerRef` and restructure the Stage JSX**

Add a ref for the game layer near the other refs (around line 44):

```typescript
const gameLayerRef = useRef<Konva.Layer>(null);
```

Replace the Stage JSX structure. Find the `<Stage>` tag (around line 945) and the closing `</Stage>` (around line 1445). The new structure:

```tsx
<Stage
  ref={stageRef}
  width={containerWidth}
  height={containerHeight}
  pixelRatio={typeof window !== 'undefined' ? window.devicePixelRatio : 1}
  onContextMenu={(e) => e.evt.preventDefault()}
  onMouseDown={handleStageMouseDown}
  onMouseMove={handleStageMouseMove}
  onMouseUp={handleStageMouseUp}
>
  {/* Letterbox background — real pixel coords, fills entire canvas */}
  <Layer listening={false}>
    <Rect width={containerWidth} height={containerHeight} fill="#0d0905" />
  </Layer>

  {/* Game layer — scaled to virtual canvas (1920x1080) */}
  <Layer
    ref={gameLayerRef as any}
    scaleX={scale}
    scaleY={scale}
    x={offsetX}
    y={offsetY}
    listening={true}
  >
    {/* ... ALL existing zone backgrounds, cards, hand content goes here ... */}
  </Layer>

  {/* Selection rectangle layer — also scaled so it aligns with game content */}
  <Layer
    ref={selectionLayerRef as any}
    listening={false}
    scaleX={scale}
    scaleY={scale}
    x={offsetX}
    y={offsetY}
  >
    <Rect
      ref={selectionRectRef as any}
      visible={false}
      fill="rgba(196,149,90,0.12)"
      stroke="#c4955a"
      strokeWidth={1}
      dash={[6, 3]}
    />
  </Layer>
</Stage>
```

Move all the existing zone background, card, and hand rendering code into the game `<Layer>`. The selection rectangle layer stays separate (for performance) but gets the same scale/offset so its coordinates align.

- [ ] **Step 5: Fix selection lasso pointer coordinates**

In `handleStageMouseDown` (around line 867-893) and `handleStageMouseMove` (around line 896-913), replace `stage.getPointerPosition()` with the game layer's relative pointer position:

```typescript
// Old:
const pos = stage.getPointerPosition();

// New:
const layer = gameLayerRef.current;
if (!layer) return;
const pos = layer.getRelativePointerPosition();
```

Apply this in both `handleStageMouseDown` (line 889) and `handleStageMouseMove` (line 908).

- [ ] **Step 6: Fix allCardBounds computation**

Find the `allCardBounds` useMemo (search for `allCardBounds`). This computes card positions for selection hit-testing. The card positions come from `node.x()`/`node.y()` on Konva nodes inside the scaled Layer, so they're already in virtual coords. The zone rect positions are also virtual. **No change needed** — just verify it still works.

- [ ] **Step 7: Fix deck drop popup screen coordinates**

In `handleCardDragEnd` (around line 540), the deck drop popup position is computed as:

```typescript
handleDeckDrop(card.instanceId, rect.left + centerX, rect.top + centerY);
```

After the refactor, `centerX`/`centerY` are in virtual coords but the popup needs viewport coords. Fix:

```typescript
// Convert virtual card center to viewport coordinates for the HTML popup
const screenPos = virtualToScreen(centerX, centerY, scale, offsetX, offsetY);
handleDeckDrop(card.instanceId, rect.left + screenPos.x, rect.top + screenPos.y);
```

- [ ] **Step 8: Fix zone context menu spawn coordinates**

In the LOB context menu handler (around lines 976-986):

```typescript
// Old:
const pointer = stage.getPointerPosition();
setZoneMenu({
  x: e.evt.clientX - container.left,
  y: e.evt.clientY - container.top,
  spawnX: pointer?.x ?? e.evt.clientX - container.left,
  spawnY: pointer?.y ?? e.evt.clientY - container.top,
});
```

The `x`/`y` (used for HTML menu position relative to container) should stay as `clientX - container.left`. The `spawnX`/`spawnY` (used for placing a new card in the zone) need virtual coords:

```typescript
const layer = gameLayerRef.current;
const pointer = layer?.getRelativePointerPosition();
setZoneMenu({
  x: e.evt.clientX - container.left,
  y: e.evt.clientY - container.top,
  spawnX: pointer?.x ?? VIRTUAL_WIDTH / 2,
  spawnY: pointer?.y ?? VIRTUAL_HEIGHT / 2,
});
```

Apply the same fix to the LOR context menu handler (around lines 988-996) — though LOR doesn't use spawnX/spawnY, just `x`/`y` for menu position, which stays as `clientX - container.left`.

- [ ] **Step 9: Update client.tsx to use `useVirtualCanvas`**

In `app/goldfish/[deckId]/client.tsx`, replace the current viewport tracking (lines 19-52) with the virtual canvas hook:

```typescript
import { useRef } from 'react';
import { useVirtualCanvas } from '@/app/shared/layout/virtualCanvas';

// Delete: MAX_ASPECT_RATIO constant
// Delete: getEffectiveDimensions function
// Delete: viewport state + window.resize listener
// Delete: dimensions useMemo

function GoldfishGameArea({ deck }: { deck: DeckDataForGoldfish }) {
  const { isLoupeVisible } = useCardPreview();
  const containerRef = useRef<HTMLDivElement>(null);
  const { scale, offsetX, offsetY, containerWidth, containerHeight } = useVirtualCanvas(containerRef);

  // ... image preloading stays the same ...

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#0d0905', cursor: 'default', display: 'flex', flexDirection: 'row' }}>
      {/* Cave background + overlays stay the same */}

      {/* Game area container — ref measures available space after loupe */}
      <div ref={containerRef} style={{ position: 'relative', flex: 1, height: '100%' }}>
        {containerWidth > 0 && containerHeight > 0 && (
          <GoldfishCanvas
            containerWidth={containerWidth}
            containerHeight={containerHeight}
            scale={scale}
            offsetX={offsetX}
            offsetY={offsetY}
          />
        )}
      </div>

      <CardLoupePanel />
    </div>
  );
}
```

The `containerRef` goes on the flex child that fills the space between the left edge and the loupe panel. The `useVirtualCanvas` hook measures it and computes the scale. No more `MAX_ASPECT_RATIO` or `getEffectiveDimensions`.

- [ ] **Step 10: Visual verification — goldfish**

Run: `npm run dev`

Open goldfish mode in the browser. Verify:
1. Game board renders with correct proportions at normal browser size
2. Resize the browser window — board scales uniformly, letterbox bars appear
3. Make the window very wide (simulate ultrawide) — horizontal letterbox bars appear, board stays centered
4. Make the window very tall — vertical letterbox bars appear
5. Drag cards between zones — drops land in correct zones
6. Right-click a card — context menu appears at the cursor position
7. Right-click LOB zone — context menu appears correctly
8. Selection lasso — drag-select selects the correct cards
9. Loupe panel expand/collapse — game board resizes correctly

- [ ] **Step 11: Commit**

```bash
git add app/goldfish/[deckId]/client.tsx app/goldfish/components/GoldfishCanvas.tsx
git commit -m "feat: migrate goldfish canvas to virtual canvas scaling"
```

---

## Task 4: Simplify Multiplayer Layout Functions

**Files:**
- Modify: `app/play/layout/multiplayerLayout.ts`

Same treatment as goldfish — card sizing functions become constants computed from the fixed 1920x1080 space.

- [ ] **Step 1: Compute fixed card dimensions and replace dynamic functions**

The multiplayer layout uses these proportions applied to 1920x1080:
- Play area width: `1920 * (1 - 0.15)` = **1632**
- Main card width: `1632 * 0.06` = **98** → round to **98**
- Main card height: `98 * 1.4` = **137**
- Player hand height: `1080 * 0.18` = **194.4**
- Hand headroom check: `194.4 * 0.82 / 1.4` = **114** — this is larger than 98, so width-based wins
- LOB height: `1080 * 0.09` = **97.2** — main card height (137) > `97.2 * 0.85` (82.6), so LOB card scales down
- LOB card height: `97.2 * 0.85` = **82.6** → LOB card width: `82.6 / 1.4` = **59**
- Opponent hand card: `98 * 0.75` = **74** width, `74 * 1.4` = **104** height
- Pile slot height: sidebar height / 5 zones, then 85% usable → compute at layout time (depends on isParagon)

In `app/play/layout/multiplayerLayout.ts`, replace the card sizing ratio constants (lines 79-86) and the four `get*CardDimensions` functions (lines 90-135) with:

```typescript
// Fixed card dimensions in virtual canvas coordinates (1920x1080).
const CARD_ASPECT_RATIO = 1.4;
const SIDEBAR_WIDTH_RATIO = 0.15;

export const MAIN_CARD: CardDimensions = { cardWidth: 98, cardHeight: 137 };
export const LOB_CARD: CardDimensions = { cardWidth: 59, cardHeight: 83 };
export const OPP_HAND_CARD: CardDimensions = { cardWidth: 74, cardHeight: 104 };

// Pile card dimensions depend on sidebar slot height (which varies with isParagon).
// Computed inside calculateMultiplayerLayout.
const PILE_LABEL_RATIO = 0.15;

function getPileCardDimensions(slotHeight: number): CardDimensions {
  const usable = slotHeight * (1 - PILE_LABEL_RATIO);
  const h = Math.min(Math.max(usable, 30), 140);
  const w = Math.round(h / CARD_ASPECT_RATIO);
  return { cardWidth: Math.max(w, Math.round(30 / CARD_ASPECT_RATIO)), cardHeight: Math.round(Math.max(h, 30)) };
}
```

Delete the ratio constants `MAIN_CARD_WIDTH_RATIO`, `MAIN_CARD_HAND_HEADROOM`, `LOB_CARD_HEADROOM`, `OPP_HAND_HEADROOM`, `OPP_HAND_SCALE`, and the functions `getMainCardDimensions`, `getLobCardDimensions`, `getOpponentHandCardDimensions`.

- [ ] **Step 2: Update `calculateMultiplayerLayout` to use fixed card sizes**

In the function body (around lines 302-314), replace:

```typescript
const mainCard = getMainCardDimensions(playAreaWidth, stageHeight);
const lobCard = getLobCardDimensions(mainCard, playerLobHeight);
const opponentHandCard = getOpponentHandCardDimensions(mainCard, oppHandHeight);
```

With:

```typescript
const mainCard = MAIN_CARD;
const lobCard = LOB_CARD;
const opponentHandCard = OPP_HAND_CARD;
```

Keep the pile card computation (it depends on sidebar slot height which varies with isParagon).

- [ ] **Step 3: Verify the app still builds**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds. The multiplayer canvas still passes `width`/`height` to `calculateMultiplayerLayout` — those will become `VIRTUAL_WIDTH`/`VIRTUAL_HEIGHT` in the next task.

- [ ] **Step 4: Commit**

```bash
git add app/play/layout/multiplayerLayout.ts
git commit -m "refactor: multiplayer layout uses fixed card dimensions for virtual canvas"
```

---

## Task 5: Migrate Multiplayer Canvas to Virtual Canvas

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

Same pattern as goldfish — replace ResizeObserver with `useVirtualCanvas`, add scaled Layer, fix pointer coords.

- [ ] **Step 1: Replace ResizeObserver with `useVirtualCanvas`**

Find the ResizeObserver code (around lines 153-166):

```typescript
const containerRef = useRef<HTMLDivElement>(null);
const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  const update = () => {
    setDimensions({ width: el.clientWidth, height: el.clientHeight });
  };
  update();
  const ro = new ResizeObserver(update);
  ro.observe(el);
  return () => ro.disconnect();
}, []);

const { width, height } = dimensions;
```

Replace with:

```typescript
import { useVirtualCanvas, VIRTUAL_WIDTH, VIRTUAL_HEIGHT, virtualToScreen } from '@/app/shared/layout/virtualCanvas';

const containerRef = useRef<HTMLDivElement>(null);
const { scale, offsetX, offsetY, containerWidth, containerHeight } = useVirtualCanvas(containerRef);
```

- [ ] **Step 2: Update layout computation to use virtual canvas dimensions**

Find the layout `useMemo` (around line 190-193):

```typescript
const mpLayout = useMemo(
  () => (width > 0 && height > 0 ? calculateMultiplayerLayout(width, height) : null),
  [width, height],
);
```

Replace with:

```typescript
const mpLayout = useMemo(
  () => calculateMultiplayerLayout(VIRTUAL_WIDTH, VIRTUAL_HEIGHT),
  [],
);
```

- [ ] **Step 3: Add `gameLayerRef` and restructure the Stage**

Add a ref:

```typescript
const gameLayerRef = useRef<Konva.Layer>(null);
```

Update the Stage (around lines 1472-1481) to the two-layer structure:

```tsx
<Stage
  ref={stageRef}
  width={containerWidth}
  height={containerHeight}
  pixelRatio={typeof window !== 'undefined' ? window.devicePixelRatio : 1}
  onContextMenu={(e) => e.evt.preventDefault()}
  onMouseDown={handleStageMouseDown}
  onMouseMove={handleStageMouseMove}
  onMouseUp={handleStageMouseUp}
>
  {/* Letterbox background */}
  <Layer listening={false}>
    <Rect width={containerWidth} height={containerHeight} fill="#0d0905" />
  </Layer>

  {/* Game layer — all content in 1920x1080 virtual coords */}
  <Layer
    ref={gameLayerRef as any}
    scaleX={scale}
    scaleY={scale}
    x={offsetX}
    y={offsetY}
  >
    {/* ... ALL existing zone backgrounds, cards, hand rendering ... */}
  </Layer>

  {/* Selection rectangle layer — scaled to match game layer */}
  <Layer
    ref={selectionLayerRef as any}
    listening={false}
    scaleX={scale}
    scaleY={scale}
    x={offsetX}
    y={offsetY}
  >
    <Rect
      ref={selectionRectRef as any}
      visible={false}
      fill="rgba(196,149,90,0.12)"
      stroke="#c4955a"
      strokeWidth={1}
      dash={[6, 3]}
    />
  </Layer>
</Stage>
```

- [ ] **Step 4: Fix selection lasso pointer coordinates**

In `handleStageMouseDown` and `handleStageMouseMove`, replace `stage.getPointerPosition()` with:

```typescript
const layer = gameLayerRef.current;
if (!layer) return;
const pos = layer.getRelativePointerPosition();
```

- [ ] **Step 5: Fix deck drop popup coordinates**

Find the deck drop positioning in `handleCardDragEnd` (around lines 1155-1163):

```typescript
const pointer = stage.getPointerPosition();
const container = stage.container().getBoundingClientRect();
setDeckDrop({
  x: (pointer?.x ?? container.width / 2),
  y: (pointer?.y ?? container.height / 2),
  cardId: String(cardId),
});
```

Replace with:

```typescript
const container = stage.container().getBoundingClientRect();
// centerX/centerY are in virtual coords (from node.x() inside scaled Layer)
const screenPos = virtualToScreen(centerX, centerY, scale, offsetX, offsetY);
setDeckDrop({
  x: screenPos.x,
  y: screenPos.y,
  cardId: String(cardId),
});
```

- [ ] **Step 6: Fix LOB context menu spawn coordinates**

Find the LOB context menu handler (around lines 1509-1513):

```typescript
const pointer = stage.getPointerPosition();
const spawnX = pointer ? (pointer.x - zone.x) / zone.width : 0.5;
const spawnY = pointer ? (pointer.y - zone.y) / zone.height : 0.5;
```

Replace with:

```typescript
const layer = gameLayerRef.current;
const pointer = layer?.getRelativePointerPosition();
const spawnX = pointer ? (pointer.x - zone.x) / zone.width : 0.5;
const spawnY = pointer ? (pointer.y - zone.y) / zone.height : 0.5;
```

Now `pointer` is in virtual coords, same as `zone.x`/`zone.width`. The normalization math stays correct.

- [ ] **Step 7: Update dimension guard and container div**

Find the early-return guard (around line 1441):

```typescript
if (width === 0 || height === 0 || !mpLayout || !myHandRect || !opponentHandRect) {
```

Replace `width === 0 || height === 0` with `containerWidth === 0 || containerHeight === 0`:

```typescript
if (containerWidth === 0 || containerHeight === 0 || !mpLayout || !myHandRect || !opponentHandRect) {
```

- [ ] **Step 8: Visual verification — multiplayer**

Run: `npm run dev`

Open multiplayer mode. Verify:
1. Board renders correctly at normal browser size
2. Resize — board scales, letterbox bars appear
3. Drag cards between zones — correct drop targets
4. Right-click LOB — context menu at cursor, spawn position correct
5. Selection lasso works
6. Deck drop popup appears at the card's position

- [ ] **Step 9: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: migrate multiplayer canvas to virtual canvas scaling"
```

---

## Task 6: Update useModalCardDrag for Virtual Coords

**Files:**
- Modify: `app/shared/hooks/useModalCardDrag.ts`

This hook converts `clientX - containerRect.left` to canvas coordinates for drop zone detection. After the refactor, zone rects are in virtual coords, so we need to convert screen coords to virtual.

- [ ] **Step 1: Add scale/offset to options interface**

In `app/shared/hooks/useModalCardDrag.ts`, update the options interface (around lines 19-29):

```typescript
interface UseModalCardDragOptions {
  stageRef: React.RefObject<Konva.Stage | null>;
  zoneLayout: Partial<Record<ZoneId, ZoneRect>>;
  findZoneAtPosition: (x: number, y: number) => ZoneId | null;
  moveCard: (instanceId: string, toZone: ZoneId, toIndex?: number, posX?: number, posY?: number) => void;
  moveCardsBatch: (cardInstanceIds: string[], toZone: ZoneId, positions?: Record<string, { posX: number; posY: number }>) => void;
  onDeckDrop?: (cardInstanceId: string, screenX: number, screenY: number) => void;
  onBatchDeckDrop?: (cardInstanceIds: string[]) => void;
  cardWidth: number;
  cardHeight: number;
  // Virtual canvas scaling — converts container-relative pixels to virtual coords
  scale: number;
  offsetX: number;
  offsetY: number;
}
```

- [ ] **Step 2: Convert coordinates in the move/up handlers**

In the `onMove` handler (around lines 132-138), replace the coordinate conversion:

```typescript
// Old:
const rect = stage.container().getBoundingClientRect();
const canvasX = e.clientX - rect.left;
const canvasY = e.clientY - rect.top;
const zone = findZoneAtPosition(canvasX, canvasY);
```

With:

```typescript
const rect = stage.container().getBoundingClientRect();
const stageX = e.clientX - rect.left;
const stageY = e.clientY - rect.top;
// Convert from container-relative pixels to virtual canvas coords
const canvasX = (stageX - offsetX) / scale;
const canvasY = (stageY - offsetY) / scale;
const zone = findZoneAtPosition(canvasX, canvasY);
```

Apply the same conversion in the `onUp` handler (around lines 154-157):

```typescript
const rect = stage.container().getBoundingClientRect();
const stageX = e.clientX - rect.left;
const stageY = e.clientY - rect.top;
const canvasX = (stageX - offsetX) / scale;
const canvasY = (stageY - offsetY) / scale;
const targetZone = findZoneAtPosition(canvasX, canvasY);
```

Also update the territory/LOB drop position calculation (around line 176-185) — `canvasX`/`canvasY` are now virtual coords, which is correct since `cardWidth`/`cardHeight` are also virtual:

```typescript
const baseX = canvasX - cardWidth / 2;
const baseY = canvasY - cardHeight / 2;
```

This is already correct — no change needed for this part.

- [ ] **Step 3: Update callers to pass scale/offset**

In `GoldfishCanvas.tsx`, find the `useModalCardDrag` call (around line 330) and add the new props:

```typescript
} = useModalCardDrag({
  stageRef,
  zoneLayout,
  findZoneAtPosition,
  moveCard,
  moveCardsBatch,
  onDeckDrop: handleDeckDrop,
  onBatchDeckDrop: handleBatchDeckDrop,
  cardWidth,
  cardHeight,
  scale,
  offsetX,
  offsetY,
});
```

Do the same in `MultiplayerCanvas.tsx` where `useModalCardDrag` is called (search for `useModalCardDrag`).

- [ ] **Step 4: Visual verification — modal card drag**

Run: `npm run dev`

In goldfish mode:
1. Open a modal (deck search, zone browse)
2. Drag a card from the modal onto the territory zone
3. Verify it drops at the correct position
4. Drag a card onto the deck zone — verify the DeckDropPopup appears correctly

Repeat in multiplayer mode.

- [ ] **Step 5: Commit**

```bash
git add app/shared/hooks/useModalCardDrag.ts app/goldfish/components/GoldfishCanvas.tsx app/play/components/MultiplayerCanvas.tsx
git commit -m "fix: useModalCardDrag converts screen coords to virtual canvas coords"
```

---

## Task 7: Cleanup and Final Verification

**Files:**
- Modify: `app/goldfish/layout/zoneLayout.ts` (remove deprecated shim if no callers remain)

- [ ] **Step 1: Remove deprecated `getCardDimensions` if unused**

Search for remaining callers:

```bash
grep -rn "getCardDimensions" app/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "__tests__"
```

If no callers remain outside zoneLayout.ts, remove the deprecated function and `CARD_WIDTH_RATIO` / `CARD_HEIGHT_RATIO` references (if any survive from step 2 of Task 2).

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass, including the new virtualCanvas tests.

- [ ] **Step 3: Run production build**

```bash
npm run build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 4: Cross-resolution visual verification**

Using browser dev tools device emulation, verify at these sizes:
- **1920x1080** (standard) — no letterbox, scale = 1.0
- **2560x1440** (1440p) — slightly scaled up, no letterbox (same 16:9)
- **3440x1440** (ultrawide 21:9) — horizontal letterbox bars, board centered
- **1366x768** (laptop) — scaled down, no letterbox (nearly 16:9)
- **1024x768** (4:3 tablet) — small vertical letterbox bars

In each: drag cards, open context menus, use selection lasso, verify deck drop popup position.

- [ ] **Step 5: Commit cleanup**

```bash
git add -A
git commit -m "chore: remove deprecated getCardDimensions, final cleanup"
```

---

## Summary of Coordinate Conversion Rules (Reference)

After this refactor, here's where each coordinate space is used:

| Context | Coordinate space | How to get it |
|---------|-----------------|---------------|
| Zone rects, card positions, layout math | Virtual (0-1920, 0-1080) | Layout functions return virtual coords |
| Konva node `.x()` / `.y()` (inside scaled Layer) | Virtual | Konva auto-converts via Layer transform |
| `onDragEnd` `e.target.x()` / `.y()` | Virtual | Konva's `setAbsolutePosition` inverts the transform |
| `gameLayerRef.getRelativePointerPosition()` | Virtual | Konva inverts the Layer transform |
| `stage.getPointerPosition()` | Stage (real pixels) | **Do NOT use** for zone/card comparisons |
| `e.evt.clientX` / `clientY` | Viewport | Use for `position: fixed` HTML overlays |
| `clientX - container.left` | Stage-relative (real pixels) | Convert to virtual via `screenToVirtual()` |
| HTML overlay positioning (context menus) | Viewport (`clientX`/`clientY`) | No conversion needed |
