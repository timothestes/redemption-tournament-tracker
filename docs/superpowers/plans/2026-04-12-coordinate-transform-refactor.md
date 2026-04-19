# Coordinate Transform Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract 22+ inline coordinate transform sites from MultiplayerCanvas.tsx into 4 pure, tested utility functions — making opponent card bugs diagnosable and preventing future regressions.

**Architecture:** Create `app/play/utils/coordinateTransforms.ts` with pure functions (no Konva/React/SpacetimeDB dependencies). Replace all inline mirror/normalize/clamp/center/anchor-adjust math in MultiplayerCanvas.tsx with calls to these functions. Drag handler control flow, zone hover, hand reordering, pile/deck drops, and all non-position logic stays unchanged.

**Tech Stack:** TypeScript, Vitest

**Design Spec:** `docs/superpowers/specs/2026-04-12-coordinate-transform-refactor-design.md`

---

## What This Does NOT Change

All of these existing drag behaviors are preserved as-is — only the coordinate math inside them changes:
- Drag to deck zones (with top/bottom popup)
- Drag to pile zones (reserve, discard, banish, LOR)
- Drag top card from discard, reserve
- Drag all cards from Land of Bondage
- Hand card reordering (fan arc drag-and-drop)
- Modal card drag (search deck modal → any zone)
- Zone hover highlighting during drag
- Ghost image rendering for group drags
- Z-index stacking behavior (single and group)
- Snap-back on invalid drops
- Reserve protection (turn 1 check)

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `app/play/utils/coordinateTransforms.ts` | **Create** | 4 pure functions: `toScreenPos`, `toDbPos`, `cardCenter`, `adjustAnchorForRotationChange` |
| `app/play/utils/__tests__/coordinateTransforms.test.ts` | **Create** | Unit tests for all 4 functions + round-trip property |
| `app/play/components/MultiplayerCanvas.tsx` | **Modify** | Replace 22+ inline transform sites with utility calls |

---

## Task 1: Create `toScreenPos` with tests

**Files:**
- Create: `app/play/utils/__tests__/coordinateTransforms.test.ts`
- Create: `app/play/utils/coordinateTransforms.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// app/play/utils/__tests__/coordinateTransforms.test.ts
import { describe, it, expect } from 'vitest';
import { toScreenPos } from '../coordinateTransforms';

const zone = { x: 100, y: 200, width: 400, height: 300, label: 'territory' };

describe('toScreenPos', () => {
  it('converts my card at origin (0,0) to zone top-left', () => {
    const { x, y } = toScreenPos(0, 0, zone, 'my');
    expect(x).toBe(100);
    expect(y).toBe(200);
  });

  it('converts my card at (1,1) to zone bottom-right', () => {
    const { x, y } = toScreenPos(1, 1, zone, 'my');
    expect(x).toBe(500);
    expect(y).toBe(500);
  });

  it('converts my card at (0.5, 0.5) to zone center', () => {
    const { x, y } = toScreenPos(0.5, 0.5, zone, 'my');
    expect(x).toBe(300);
    expect(y).toBe(350);
  });

  it('mirrors opponent card at (0,0) to zone bottom-right', () => {
    // opponent (0,0) in DB → mirrored to (1,1) on screen → zone bottom-right
    const { x, y } = toScreenPos(0, 0, zone, 'opponent');
    expect(x).toBe(500);
    expect(y).toBe(500);
  });

  it('mirrors opponent card at (1,1) to zone top-left', () => {
    const { x, y } = toScreenPos(1, 1, zone, 'opponent');
    expect(x).toBe(100);
    expect(y).toBe(200);
  });

  it('mirrors opponent card at (0.3, 0.5) symmetrically', () => {
    // opponent at DB (0.3, 0.5) → screen mirror → same visual position as my card at (0.7, 0.5)
    const opp = toScreenPos(0.3, 0.5, zone, 'opponent');
    const my = toScreenPos(0.7, 0.5, zone, 'my');
    expect(opp.x).toBe(my.x);
    expect(opp.y).toBe(my.y);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/play/utils/__tests__/coordinateTransforms.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `toScreenPos`**

```typescript
// app/play/utils/coordinateTransforms.ts
import type { ZoneRect } from '../layout/multiplayerLayout';

export type Owner = 'my' | 'opponent';

/**
 * Convert a normalized DB position (0–1) to screen pixel coordinates.
 * Opponent positions are stored un-mirrored in the DB and flipped at render time.
 */
export function toScreenPos(
  dbX: number,
  dbY: number,
  zone: ZoneRect,
  owner: Owner,
): { x: number; y: number } {
  const normX = owner === 'opponent' ? 1 - dbX : dbX;
  const normY = owner === 'opponent' ? 1 - dbY : dbY;
  return {
    x: normX * zone.width + zone.x,
    y: normY * zone.height + zone.y,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/play/utils/__tests__/coordinateTransforms.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/play/utils/coordinateTransforms.ts app/play/utils/__tests__/coordinateTransforms.test.ts
git commit -m "feat: add toScreenPos coordinate transform utility with tests"
```

---

## Task 2: Add `toDbPos` with tests

**Files:**
- Modify: `app/play/utils/__tests__/coordinateTransforms.test.ts`
- Modify: `app/play/utils/coordinateTransforms.ts`

- [ ] **Step 1: Write the failing tests**

Add to the test file:

```typescript
import { toScreenPos, toDbPos } from '../coordinateTransforms';

// ... existing tests ...

describe('toDbPos', () => {
  it('normalizes my card at zone top-left to (0, 0)', () => {
    const { x, y } = toDbPos(100, 200, zone, 'my');
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });

  it('normalizes my card at zone bottom-right to (1, 1)', () => {
    const { x, y } = toDbPos(500, 500, zone, 'my');
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(1);
  });

  it('normalizes my card at zone center to (0.5, 0.5)', () => {
    const { x, y } = toDbPos(300, 350, zone, 'my');
    expect(x).toBeCloseTo(0.5);
    expect(y).toBeCloseTo(0.5);
  });

  it('mirrors opponent card — screen top-left becomes DB (1, 1)', () => {
    const { x, y } = toDbPos(100, 200, zone, 'opponent');
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(1);
  });

  it('mirrors opponent card — screen bottom-right becomes DB (0, 0)', () => {
    const { x, y } = toDbPos(500, 500, zone, 'opponent');
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });

  it('clamps card within zone bounds', () => {
    // Card is 80x120. Max normalized X = 1 - 80/400 = 0.8, max Y = 1 - 120/300 = 0.6
    const { x, y } = toDbPos(500, 500, zone, 'my', { cardWidth: 80, cardHeight: 120 });
    expect(x).toBeCloseTo(0.8);
    expect(y).toBeCloseTo(0.6);
  });

  it('clamps card at zone origin to (0, 0)', () => {
    const { x, y } = toDbPos(0, 0, zone, 'my', { cardWidth: 80, cardHeight: 120 });
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });

  it('does not clamp when no opts provided', () => {
    // Position beyond zone — no clamping, raw normalization
    const { x, y } = toDbPos(600, 600, zone, 'my');
    expect(x).toBeCloseTo(1.25);
    expect(y).toBeCloseTo(1.333, 2);
  });

  it('handles zero-width zone without division by zero', () => {
    const zeroZone = { x: 0, y: 0, width: 0, height: 0, label: 'empty' };
    const { x, y } = toDbPos(50, 50, zeroZone, 'my');
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  });
});

describe('round-trip: toDbPos(toScreenPos(db)) ≈ db', () => {
  const positions = [
    [0, 0], [1, 1], [0.5, 0.5], [0.3, 0.7], [0.1, 0.9],
  ];

  for (const [dbX, dbY] of positions) {
    it(`round-trips my card at (${dbX}, ${dbY})`, () => {
      const screen = toScreenPos(dbX, dbY, zone, 'my');
      const db = toDbPos(screen.x, screen.y, zone, 'my');
      expect(db.x).toBeCloseTo(dbX);
      expect(db.y).toBeCloseTo(dbY);
    });

    it(`round-trips opponent card at (${dbX}, ${dbY})`, () => {
      const screen = toScreenPos(dbX, dbY, zone, 'opponent');
      const db = toDbPos(screen.x, screen.y, zone, 'opponent');
      expect(db.x).toBeCloseTo(dbX);
      expect(db.y).toBeCloseTo(dbY);
    });
  }
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npx vitest run app/play/utils/__tests__/coordinateTransforms.test.ts`
Expected: toDbPos and round-trip tests FAIL — function not found

- [ ] **Step 3: Implement `toDbPos`**

Add to `coordinateTransforms.ts`:

```typescript
export interface ClampOpts {
  cardWidth: number;
  cardHeight: number;
}

/**
 * Convert screen pixel coordinates to a normalized DB position (0–1).
 * Handles optional clamping (keeps card within zone bounds) and opponent mirroring.
 *
 * NOTE: If the card is crossing between rotation contexts (e.g., player rotation=0
 * → opponent rotation=180), call `adjustAnchorForRotationChange` on the drop
 * position BEFORE passing it here. This function handles mirroring and clamping only.
 */
export function toDbPos(
  screenX: number,
  screenY: number,
  zone: ZoneRect,
  owner: Owner,
  clamp?: ClampOpts,
): { x: number; y: number } {
  const zoneW = zone.width || 1;
  const zoneH = zone.height || 1;
  let rawX = (screenX - zone.x) / zoneW;
  let rawY = (screenY - zone.y) / zoneH;
  if (clamp) {
    const maxX = Math.max(0, 1 - clamp.cardWidth / zoneW);
    const maxY = Math.max(0, 1 - clamp.cardHeight / zoneH);
    rawX = Math.max(0, Math.min(rawX, maxX));
    rawY = Math.max(0, Math.min(rawY, maxY));
  }
  return {
    x: owner === 'opponent' ? 1 - rawX : rawX,
    y: owner === 'opponent' ? 1 - rawY : rawY,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/play/utils/__tests__/coordinateTransforms.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/play/utils/coordinateTransforms.ts app/play/utils/__tests__/coordinateTransforms.test.ts
git commit -m "feat: add toDbPos with clamping, mirroring, and round-trip tests"
```

---

## Task 3: Add `cardCenter` with tests

**Files:**
- Modify: `app/play/utils/__tests__/coordinateTransforms.test.ts`
- Modify: `app/play/utils/coordinateTransforms.ts`

- [ ] **Step 1: Write the failing tests**

Add to the test file:

```typescript
import { toScreenPos, toDbPos, cardCenter } from '../coordinateTransforms';

// ... existing tests ...

describe('cardCenter', () => {
  it('returns center for rotation=0 (anchor is top-left)', () => {
    // Card at (100, 200), size 80x120, rotation=0
    // Center = (100 + 40, 200 + 60) = (140, 260)
    const { x, y } = cardCenter(100, 200, 80, 120, 0);
    expect(x).toBe(140);
    expect(y).toBe(260);
  });

  it('returns center for rotation=180 (anchor is bottom-right)', () => {
    // Card at (100, 200), size 80x120, rotation=180
    // Center = (100 - 40, 200 - 60) = (60, 140)
    const { x, y } = cardCenter(100, 200, 80, 120, 180);
    expect(x).toBe(60);
    expect(y).toBe(140);
  });

  it('returns center for rotation=-180 (also rotated)', () => {
    const { x, y } = cardCenter(100, 200, 80, 120, -180);
    expect(x).toBe(60);
    expect(y).toBe(140);
  });

  it('treats rotation=90 as not rotated (threshold is >90)', () => {
    const { x, y } = cardCenter(100, 200, 80, 120, 90);
    expect(x).toBe(140);
    expect(y).toBe(260);
  });

  it('treats rotation=91 as rotated', () => {
    const { x, y } = cardCenter(100, 200, 80, 120, 91);
    expect(x).toBe(60);
    expect(y).toBe(140);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/play/utils/__tests__/coordinateTransforms.test.ts`
Expected: cardCenter tests FAIL — function not found

- [ ] **Step 3: Implement `cardCenter`**

Add to `coordinateTransforms.ts`:

```typescript
/**
 * Compute the visual center of a card given its anchor position, dimensions,
 * and rotation. For rotation=180 (opponent territory), the Konva anchor is
 * the bottom-right corner, so center = anchor - half-dimensions.
 */
export function cardCenter(
  anchorX: number,
  anchorY: number,
  width: number,
  height: number,
  rotation: number,
): { x: number; y: number } {
  const isRotated = Math.abs(rotation) > 90;
  return {
    x: isRotated ? anchorX - width / 2 : anchorX + width / 2,
    y: isRotated ? anchorY - height / 2 : anchorY + height / 2,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/play/utils/__tests__/coordinateTransforms.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/play/utils/coordinateTransforms.ts app/play/utils/__tests__/coordinateTransforms.test.ts
git commit -m "feat: add cardCenter utility for rotation-aware center calculation"
```

---

## Task 4: Add `adjustAnchorForRotationChange` with tests

**Files:**
- Modify: `app/play/utils/__tests__/coordinateTransforms.test.ts`
- Modify: `app/play/utils/coordinateTransforms.ts`

- [ ] **Step 1: Write the failing tests**

Add to the test file:

```typescript
import {
  toScreenPos, toDbPos, cardCenter, adjustAnchorForRotationChange,
} from '../coordinateTransforms';

// ... existing tests ...

describe('adjustAnchorForRotationChange', () => {
  const cardW = 80;
  const cardH = 120;

  it('returns position unchanged when no rotation change', () => {
    const { x, y } = adjustAnchorForRotationChange(300, 400, cardW, cardH, false, false);
    expect(x).toBe(300);
    expect(y).toBe(400);
  });

  it('returns position unchanged when both rotated', () => {
    const { x, y } = adjustAnchorForRotationChange(300, 400, cardW, cardH, true, true);
    expect(x).toBe(300);
    expect(y).toBe(400);
  });

  it('subtracts dimensions when 180→0 (opponent→player territory)', () => {
    // Anchor shifts from bottom-right to top-left
    const { x, y } = adjustAnchorForRotationChange(300, 400, cardW, cardH, true, false);
    expect(x).toBe(220); // 300 - 80
    expect(y).toBe(280); // 400 - 120
  });

  it('adds dimensions when 0→180 (player→opponent territory)', () => {
    // Anchor shifts from top-left to bottom-right
    const { x, y } = adjustAnchorForRotationChange(300, 400, cardW, cardH, false, true);
    expect(x).toBe(380); // 300 + 80
    expect(y).toBe(520); // 400 + 120
  });

  it('round-trips: 0→180→0 returns original position', () => {
    const step1 = adjustAnchorForRotationChange(300, 400, cardW, cardH, false, true);
    const step2 = adjustAnchorForRotationChange(step1.x, step1.y, cardW, cardH, true, false);
    expect(step2.x).toBe(300);
    expect(step2.y).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/play/utils/__tests__/coordinateTransforms.test.ts`
Expected: adjustAnchorForRotationChange tests FAIL — function not found

- [ ] **Step 3: Implement `adjustAnchorForRotationChange`**

Add to `coordinateTransforms.ts`:

```typescript
/**
 * Adjust a drop position when a card crosses between rotation contexts.
 * Offsets by card dimensions to keep the visual position stable.
 *
 * 180→0 (opponent→player): subtract dimensions (bottom-right anchor → top-left)
 * 0→180 (player→opponent): add dimensions (top-left anchor → bottom-right)
 */
export function adjustAnchorForRotationChange(
  dropX: number,
  dropY: number,
  cardWidth: number,
  cardHeight: number,
  sourceRotated: boolean,
  targetRotated: boolean,
): { x: number; y: number } {
  let x = dropX;
  let y = dropY;
  if (sourceRotated && !targetRotated) {
    x -= cardWidth;
    y -= cardHeight;
  } else if (!sourceRotated && targetRotated) {
    x += cardWidth;
    y += cardHeight;
  }
  return { x, y };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/play/utils/__tests__/coordinateTransforms.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/play/utils/coordinateTransforms.ts app/play/utils/__tests__/coordinateTransforms.test.ts
git commit -m "feat: add adjustAnchorForRotationChange utility with tests"
```

---

## Task 5: Replace rendering transforms (DB→Screen)

Lowest risk — easy to visually verify. These changes affect how cards are positioned on screen.

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Add import at top of MultiplayerCanvas.tsx**

After the existing imports (around line 20), add:

```typescript
import { toScreenPos, toDbPos, cardCenter, adjustAnchorForRotationChange } from '../utils/coordinateTransforms';
```

- [ ] **Step 2: Replace my territory rendering (currently ~line 2190–2196)**

Find this code inside the `FREE_FORM_ZONES.map` for my cards (the `sorted.map` that creates `GameCardNode` with `rotation={0}`):

```typescript
const myZone = myZones[zoneKey];
const zoneX = myZone?.x ?? 0;
const zoneY = myZone?.y ?? 0;
const x = card.posX ? parseFloat(card.posX) * (myZone?.width ?? 0) + zoneX : zoneX + 20;
const y = card.posY ? parseFloat(card.posY) * (myZone?.height ?? 0) + zoneY : zoneY + 24;
```

Replace with:

```typescript
const myZone = myZones[zoneKey];
let x: number, y: number;
if (card.posX && myZone) {
  ({ x, y } = toScreenPos(parseFloat(card.posX), parseFloat(card.posY), myZone, 'my'));
} else {
  x = (myZone?.x ?? 0) + 20;
  y = (myZone?.y ?? 0) + 24;
}
```

- [ ] **Step 3: Replace opponent territory rendering (currently ~line 2244–2257)**

Find this code inside the `FREE_FORM_ZONES.map` for opponent cards (the `sorted.map` that creates `GameCardNode` with `rotation={180}`):

```typescript
const oppZone = opponentZones[zoneKey];
const zoneX = oppZone?.x ?? 0;
const zoneY = oppZone?.y ?? 0;
const zoneW = oppZone?.width ?? 0;
const zoneH = oppZone?.height ?? 0;
// Mirror opponent positions: flip both axes so their board
// appears rotated 180° (as if sitting across the table).
// With rotation=180, Konva renders the card extending LEFT and UP
// from (x,y), so the visible rectangle is (x-cardW, y-cardH) to (x,y).
// No additional offset needed — the rotation pivot handles it.
const mirroredPosX = card.posX ? 1 - parseFloat(card.posX) : 0;
const mirroredPosY = card.posY ? 1 - parseFloat(card.posY) : 0;
const x = mirroredPosX * zoneW + zoneX;
const y = mirroredPosY * zoneH + zoneY;
```

Replace with:

```typescript
const oppZone = opponentZones[zoneKey];
if (!oppZone) return null;
const { x, y } = toScreenPos(
  card.posX ? parseFloat(card.posX) : 0,
  card.posY ? parseFloat(card.posY) : 0,
  oppZone, 'opponent',
);
```

- [ ] **Step 4: Run dev server and visually verify**

Run: `npm run dev`
- Open a multiplayer game
- Verify my territory cards render in correct positions
- Verify opponent territory cards render in correct positions (mirrored, rotated 180)
- Verify cards are visually in the same positions as before the change

- [ ] **Step 5: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "refactor: replace rendering transforms with toScreenPos utility"
```

---

## Task 6: Replace bounds calculation transforms

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Replace my territory bounds (currently ~line 1748–1760)**

Find this code inside the `allCardBounds` useMemo, under "My free-form zone cards":

```typescript
const zone = myZones[zoneKey];
const zoneX = zone?.x ?? 0;
const zoneY = zone?.y ?? 0;
const x = card.posX ? parseFloat(card.posX) * (zone?.width ?? 0) + zoneX : zoneX + 20;
const y = card.posY ? parseFloat(card.posY) * (zone?.height ?? 0) + zoneY : zoneY + 24;
```

Replace with:

```typescript
const zone = myZones[zoneKey];
let x: number, y: number;
if (card.posX && zone) {
  ({ x, y } = toScreenPos(parseFloat(card.posX), parseFloat(card.posY), zone, 'my'));
} else {
  x = (zone?.x ?? 0) + 20;
  y = (zone?.y ?? 0) + 24;
}
```

- [ ] **Step 2: Replace opponent territory bounds (currently ~line 1770–1783)**

Find this code inside the `allCardBounds` useMemo, under "Opponent free-form zone cards":

```typescript
const mirroredPosX = card.posX ? 1 - parseFloat(card.posX) : 0;
const mirroredPosY = card.posY ? 1 - parseFloat(card.posY) : 0;
const x = mirroredPosX * zone.width + zone.x;
const y = mirroredPosY * zone.height + zone.y;
// Rotation=180 means (x,y) is bottom-right corner; bounding box is (x-w, y-h) to (x, y)
bounds.push({
  instanceId: String(card.id),
  x: x - cardWidth,
  y: y - cardHeight,
```

Replace with:

```typescript
const { x: anchorX, y: anchorY } = toScreenPos(
  card.posX ? parseFloat(card.posX) : 0,
  card.posY ? parseFloat(card.posY) : 0,
  zone, 'opponent',
);
// Rotation=180 means anchor is bottom-right corner; bounding box is (anchor-w, anchor-h) to (anchor)
bounds.push({
  instanceId: String(card.id),
  x: anchorX - cardWidth,
  y: anchorY - cardHeight,
```

- [ ] **Step 3: Verify marquee selection works**

Run: `npm run dev`
- Draw a marquee selection over my territory cards — should select correctly
- Draw a marquee selection over opponent territory cards — should select correctly
- Verify single-owner restriction still works (marquee touching both sides selects only one)

- [ ] **Step 4: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "refactor: replace bounds transforms with toScreenPos utility"
```

---

## Task 7: Replace modal drag transforms

These are the transform sites inside the modal card drag callbacks — when a player drags a card from the search/browse deck modal onto the canvas.

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Replace first modal drag site (currently ~line 776–787)**

Find this code inside the `moveCard` callback for the modal drag hook (inside `execute` closure):

```typescript
if (zone && posX != null && posY != null) {
  let rawX = (posX - zone.x) / zone.width;
  let rawY = (posY - zone.y) / zone.height;
  // Clamp so the entire card stays within the zone bounds
  if (isFreeFormZone(String(toZone))) {
    const maxX = Math.max(0, 1 - cardWidth / zone.width);
    const maxY = Math.max(0, 1 - cardHeight / zone.height);
    rawX = Math.max(0, Math.min(rawX, maxX));
    rawY = Math.max(0, Math.min(rawY, maxY));
  }
  const normX = isOppZone ? 1 - rawX : rawX;
  const normY = isOppZone ? 1 - rawY : rawY;
  gameState.moveCard(BigInt(id), String(toZone), undefined, normX.toString(), normY.toString(), ownerId);
```

Replace with:

```typescript
if (zone && posX != null && posY != null) {
  const owner: 'my' | 'opponent' = isOppZone ? 'opponent' : 'my';
  const clamp = isFreeFormZone(String(toZone)) ? { cardWidth, cardHeight } : undefined;
  const db = toDbPos(posX, posY, zone, owner, clamp);
  gameState.moveCard(BigInt(id), String(toZone), undefined, db.x.toString(), db.y.toString(), ownerId);
```

- [ ] **Step 2: Replace second modal drag site (currently ~line 844–856)**

Find this code inside the `moveCard` callback for the approved search request:

```typescript
if (zone && posX != null && posY != null) {
  let rawX = (posX - zone.x) / zone.width;
  let rawY = (posY - zone.y) / zone.height;
  // Clamp so the entire card stays within the zone bounds
  if (isFreeFormZone(String(toZone))) {
    const maxX = Math.max(0, 1 - cardWidth / zone.width);
    const maxY = Math.max(0, 1 - cardHeight / zone.height);
    rawX = Math.max(0, Math.min(rawX, maxX));
    rawY = Math.max(0, Math.min(rawY, maxY));
  }
  // Inverse-mirror for opponent zones (they render with 1-posX, 1-posY)
  normX = (isOppZone ? 1 - rawX : rawX).toString();
  normY = (isOppZone ? 1 - rawY : rawY).toString();
}
```

Replace with:

```typescript
if (zone && posX != null && posY != null) {
  const owner: 'my' | 'opponent' = isOppZone ? 'opponent' : 'my';
  const clamp = isFreeFormZone(String(toZone)) ? { cardWidth, cardHeight } : undefined;
  const db = toDbPos(posX, posY, zone, owner, clamp);
  normX = db.x.toString();
  normY = db.y.toString();
}
```

- [ ] **Step 3: Test modal drag to own territory**

Run: `npm run dev`
- Start a game, request to search opponent's deck
- Drag a card from the search modal to your own territory
- Verify the card lands where you dropped it

- [ ] **Step 4: Test modal drag to opponent territory**

- Drag a card from the search modal to the opponent's territory
- Verify the card lands where you dropped it (mirrored correctly)

- [ ] **Step 5: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "refactor: replace modal drag transforms with toDbPos utility"
```

---

## Task 8: Replace drag handler center calculations

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Replace dragMove center calculation (currently ~line 1174–1177)**

Find this code inside `handleCardDragMove`:

```typescript
const rot = (node as Konva.Group).rotation?.() ?? 0;
const isRotated = Math.abs(rot) > 90;
const centerX = isRotated ? x - dragW / 2 : x + dragW / 2;
const centerY = isRotated ? y - dragH / 2 : y + dragH / 2;
const hit = findZoneAtPosition(centerX, centerY);
```

Replace with:

```typescript
const rot = (node as Konva.Group).rotation?.() ?? 0;
const center = cardCenter(x, y, dragW, dragH, rot);
const hit = findZoneAtPosition(center.x, center.y);
```

- [ ] **Step 2: Replace dragEnd center calculation (currently ~line 1248–1252)**

Find this code inside `handleCardDragEnd`:

```typescript
const dropRot = (node as Konva.Group).rotation?.() ?? 0;
const isDropRotated = Math.abs(dropRot) > 90;
const centerX = isDropRotated ? dropX - dragW / 2 : dropX + dragW / 2;
const centerY = isDropRotated ? dropY - dragH / 2 : dropY + dragH / 2;
const hit = findZoneAtPosition(centerX, centerY);
```

Replace with:

```typescript
const dropRot = (node as Konva.Group).rotation?.() ?? 0;
const center = cardCenter(dropX, dropY, dragW, dragH, dropRot);
const hit = findZoneAtPosition(center.x, center.y);
```

- [ ] **Step 3: Verify zone hover still highlights correctly during drag**

Run: `npm run dev`
- Drag a card around — zones should highlight as the card's center passes over them
- Test with both my cards and opponent cards

- [ ] **Step 4: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "refactor: replace center calculations with cardCenter utility"
```

---

## Task 9: Replace drag end anchor adjustment and normalization

This is the highest-risk change — the core of the drag end handler. Do this carefully.

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Replace the anchor adjustment (currently ~line 1331–1343)**

Find this code inside `handleCardDragEnd`:

```typescript
const sourceIsRotated = sourceOwner === 'opponent' && (isFreeFormZone(sourceZone ?? '') || isAutoArrangeZone(sourceZone ?? '') || SIDEBAR_PILE_ZONES.includes(sourceZone as any));
const targetIsRotated = isOpponentTarget && isFreeFormZone(targetZone);
let adjDropX = dropX;
let adjDropY = dropY;
if (sourceIsRotated && !targetIsRotated) {
  // rotation 180→0: shift anchor from bottom-right to top-left
  adjDropX -= dragW;
  adjDropY -= dragH;
} else if (!sourceIsRotated && targetIsRotated) {
  // rotation 0→180: shift anchor from top-left to bottom-right
  adjDropX += dragW;
  adjDropY += dragH;
}
```

Replace with:

```typescript
const sourceIsRotated = sourceOwner === 'opponent' && (isFreeFormZone(sourceZone ?? '') || isAutoArrangeZone(sourceZone ?? '') || SIDEBAR_PILE_ZONES.includes(sourceZone as any));
const targetIsRotated = isOpponentTarget && isFreeFormZone(targetZone);
const { x: adjDropX, y: adjDropY } = adjustAnchorForRotationChange(
  dropX, dropY, dragW, dragH, sourceIsRotated, targetIsRotated,
);
```

- [ ] **Step 2: Replace normX/normY helper functions (currently ~line 1349–1364)**

Find these helper function definitions:

```typescript
const maxNormX = Math.max(0, 1 - cardWidth / zoneW);
const maxNormY = Math.max(0, 1 - cardHeight / zoneH);
const normX = (px: number) => {
  const raw = (px - zoneOffX) / zoneW;
  const clamped = isFreeFormZone(targetZone)
    ? Math.max(0, Math.min(raw, maxNormX))
    : raw;
  return isOpponentTarget ? 1 - clamped : clamped;
};
const normY = (py: number) => {
  const raw = (py - zoneOffY) / zoneH;
  const clamped = isFreeFormZone(targetZone)
    ? Math.max(0, Math.min(raw, maxNormY))
    : raw;
  return isOpponentTarget ? 1 - clamped : clamped;
};
```

Replace with:

```typescript
const targetOwner: 'my' | 'opponent' = isOpponentTarget ? 'opponent' : 'my';
const clampOpts = isFreeFormZone(targetZone) ? { cardWidth, cardHeight } : undefined;
const toDb = (px: number, py: number) => toDbPos(px, py, zoneRect!, targetOwner, clampOpts);
```

- [ ] **Step 3: Update all normX/normY callsites to use toDb**

There are ~10 callsites. Each follows one of these patterns:

**Pattern A — Single card position:**
```typescript
// Before:
String(normX(adjDropX)), String(normY(adjDropY))
// After:
const dbPos = toDb(adjDropX, adjDropY);
// then use: String(dbPos.x), String(dbPos.y)
```

**Pattern B — Group follower position:**
```typescript
// Before:
positions[id] = { posX: String(normX(adjDropX + offset.dx)), posY: String(normY(adjDropY + offset.dy)) };
// After:
const fDb = toDb(adjDropX + offset.dx, adjDropY + offset.dy);
positions[id] = { posX: String(fDb.x), posY: String(fDb.y) };
```

**Pattern C — Lead card in positions object:**
```typescript
// Before:
[card.instanceId]: { posX: String(normX(adjDropX)), posY: String(normY(adjDropY)) },
// After — compute first, then use:
const leadDb = toDb(adjDropX, adjDropY);
// ...
[card.instanceId]: { posX: String(leadDb.x), posY: String(leadDb.y) },
```

Apply these replacements to ALL callsites in the drag end handler:
1. Same-zone group drag positions (line ~1415–1421)
2. Same-zone single card update (line ~1430)
3. Reserve protection group positions (line ~1489–1495)
4. Reserve protection single card (line ~1502)
5. Different-zone group positions (line ~1556–1562)
6. Different-zone single card (line ~1575)

For each site, replace the paired `normX(...), normY(...)` calls with a single `toDb(x, y)` call, destructuring the result.

- [ ] **Step 4: Also remove the now-unused variables**

Remove these lines that are no longer needed (they were only used by the old normX/normY helpers):

```typescript
const zoneOffX = zoneRect?.x ?? 0;
const zoneOffY = zoneRect?.y ?? 0;
const zoneW = zoneRect?.width || 1;
const zoneH = zoneRect?.height || 1;
```

Note: `zoneRect` itself is still needed (passed to `toDb`). Keep the `zoneRect` declaration.

- [ ] **Step 5: Test single card drag within my territory**

Run: `npm run dev`
- Drag one of your cards within your territory
- Verify it lands exactly where dropped
- Drag it to the edge — verify clamping keeps it visible

- [ ] **Step 6: Test single card drag within opponent territory**

- Drag one of the opponent's cards within opponent territory
- Verify it lands where dropped (mirrored correctly)

- [ ] **Step 7: Test cross-zone drag (rotation change)**

- Drag a card from your territory to opponent territory (and vice versa)
- Verify the visual position stays consistent during the anchor swap

- [ ] **Step 8: Test group drag within my territory**

- Select multiple of your cards with marquee
- Drag the group within your territory
- Verify relative positions are preserved

- [ ] **Step 9: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "refactor: replace drag end normalization with toDbPos utility"
```

---

## Task 10: Verify opponent group drag bug

The primary motivation for this refactor — verify the opponent group drag bug is now fixed or diagnosable.

**Files:**
- None (manual testing only, possibly modify `app/play/utils/coordinateTransforms.ts` or `app/play/components/MultiplayerCanvas.tsx` if bug is found)

- [ ] **Step 1: Select multiple opponent cards**

Run: `npm run dev`
- Open a multiplayer game with cards in opponent territory
- Use marquee selection to select 2-3 opponent cards

- [ ] **Step 2: Drag the group within opponent territory**

- Drag the selected group to a new position within opponent territory
- **Expected (fixed):** Cards maintain their relative positions in the group
- **Bug symptom (if still broken):** Cards collapse into a horizontal line

- [ ] **Step 3: If bug persists, diagnose with consolidated transforms**

The transform logic is now in `toDbPos`. Add temporary `console.log` to the `toDb` helper in the drag end handler to inspect:
- Input pixel positions for each follower
- Output normalized positions
- Whether the follower offsets (`offset.dx`, `offset.dy`) are correct

With the transforms consolidated, the bug should be isolated to one of:
1. Follower offsets computed incorrectly in `handleCardDragStart`
2. The `toDb` call producing wrong results for opponent+rotation context
3. The SpacetimeDB `moveCardsBatch` reducer not applying positions correctly

If the bug is in the follower offset computation (most likely), it's in `handleCardDragStart` where offsets are captured — check whether follower positions account for rotation=180 anchor differences.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve opponent group drag position bug"
```
