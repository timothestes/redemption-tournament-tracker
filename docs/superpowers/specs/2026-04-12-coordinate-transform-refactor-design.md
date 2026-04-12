# Coordinate Transform Refactor — Design Spec

**Date:** 2026-04-12
**Status:** Draft
**Scope:** Extract opponent card coordinate transforms from MultiplayerCanvas.tsx into shared utilities

## Problem

MultiplayerCanvas.tsx (3,784 lines) contains **22 separate sites** where opponent card positions are transformed between database coordinates (normalized 0–1) and screen coordinates (pixels). These transforms handle:

- **Position mirroring**: `1 - posX` / `1 - posY` to flip opponent cards across the board
- **Rotation anchor adjustment**: rotation=180 makes `(x,y)` the bottom-right corner instead of top-left, requiring offset corrections when crossing between player/opponent zones
- **Center-point calculation**: hit detection needs the visual center, which differs based on rotation
- **Clamping**: keeping cards within zone bounds during normalization

These 22 sites are implemented **ad-hoc and inline** — each one independently computes the same math with slight variations. This causes:

1. **Hard-to-find bugs**: Dragging opponent card groups currently breaks their positions (cards collapse into a horizontal line). The bug has resisted analysis because the transform logic is scattered across 400+ lines of drag handler code with no single source of truth to verify against.
2. **Duplication**: The same mirror operation (`1 - value`) appears in 8+ places. The same center-point calculation appears in 2 places. The same anchor adjustment appears in 3 places.
3. **Fragility**: Every new feature that touches card positions (battles, card effects, zone transfers) must correctly reimplement these transforms or break opponent rendering.

## Current Architecture

All transforms live inline in MultiplayerCanvas.tsx across these operations:

| Operation | Transform Sites | What They Do |
|-----------|----------------|--------------|
| **Rendering** (DB→Screen) | 6 sites | Mirror posX/posY, apply rotation=180, compute bounds |
| **Drag end** (Screen→DB) | 10 sites | Normalize pixel→0-1, mirror for opponent, adjust anchor on rotation change, clamp |
| **Hit detection** (Screen→Screen) | 4 sites | Compute visual center accounting for rotation, zone validation |
| **Modal drag** (Screen→DB) | 2 sites | Mirror positions for zone search drops |

The transform logic is tangled with Konva node manipulation, React state updates, SpacetimeDB reducer calls, and ghost image rendering — making it impossible to test in isolation.

## Proposed Architecture

### New file: `app/play/utils/coordinateTransforms.ts`

Pure functions with no dependencies on Konva, React, or SpacetimeDB:

```typescript
interface ZoneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Owner = 'my' | 'opponent';

/**
 * Convert a normalized DB position (0–1) to screen pixel coordinates.
 * Handles opponent mirroring: opponent positions are stored un-mirrored
 * in the DB and flipped at render time.
 */
function toScreenPos(
  dbX: number, dbY: number,
  zone: ZoneRect, owner: Owner,
): { x: number; y: number }

/**
 * Convert screen pixel coordinates to a normalized DB position (0–1).
 * Handles opponent mirroring and optional clamping to keep cards
 * within zone bounds.
 */
function toDbPos(
  screenX: number, screenY: number,
  zone: ZoneRect, owner: Owner,
  opts?: { clampCardWidth?: number; clampCardHeight?: number },
): { x: number; y: number }

/**
 * Compute the visual center of a card given its anchor position,
 * dimensions, and rotation. For rotation=180 cards, the anchor is
 * the bottom-right corner.
 */
function cardCenter(
  anchorX: number, anchorY: number,
  width: number, height: number,
  rotation: number,
): { x: number; y: number }

/**
 * Adjust a drop position when a card crosses between rotation contexts
 * (e.g., player territory rotation=0 → opponent territory rotation=180).
 * Offsets by card dimensions to keep the visual position stable.
 */
function adjustAnchorForRotationChange(
  dropX: number, dropY: number,
  cardWidth: number, cardHeight: number,
  sourceRotated: boolean, targetRotated: boolean,
): { x: number; y: number }

/**
 * Whether a card in the given zone/owner context renders with rotation=180.
 */
function isRotatedContext(zone: string, owner: Owner): boolean
```

### Changes to MultiplayerCanvas.tsx

Replace all 22 inline transform sites with calls to the utility functions. Examples:

**Before (rendering, line ~2226):**
```typescript
const mirroredPosX = card.posX ? 1 - parseFloat(card.posX) : 0;
const mirroredPosY = card.posY ? 1 - parseFloat(card.posY) : 0;
const x = mirroredPosX * zoneW + zoneX;
const y = mirroredPosY * zoneH + zoneY;
```

**After:**
```typescript
const { x, y } = toScreenPos(
  parseFloat(card.posX || '0'),
  parseFloat(card.posY || '0'),
  oppZone, 'opponent',
);
```

**Before (drag end normalization, line ~1338):**
```typescript
const normX = (px: number) => {
  const raw = (px - zoneOffX) / zoneW;
  const clamped = isFreeFormZone(targetZone)
    ? Math.max(0, Math.min(raw, maxNormX))
    : raw;
  return isOpponentTarget ? 1 - clamped : clamped;
};
```

**After:**
```typescript
const toDb = (px: number, py: number) => toDbPos(
  px, py, zoneRect, isOpponentTarget ? 'opponent' : 'my',
  isFreeFormZone(targetZone) ? { clampCardWidth: cardWidth, clampCardHeight: cardHeight } : undefined,
);
```

**Before (center-point calculation, line ~1236):**
```typescript
const isDropRotated = Math.abs(dropRot) > 90;
const centerX = isDropRotated ? dropX - dragW / 2 : dropX + dragW / 2;
const centerY = isDropRotated ? dropY - dragH / 2 : dropY + dragH / 2;
```

**After:**
```typescript
const { x: centerX, y: centerY } = cardCenter(dropX, dropY, dragW, dragH, dropRot);
```

### Changes to bounds calculation (allCardBounds)

The bounds computation also duplicates the DB→Screen transform. Replace with `toScreenPos` calls.

## Known Bug to Fix During Refactor

**Opponent group drag produces horizontal line:** When dragging a group of opponent cards within opponent territory, the cards lose their relative positions. The root cause needs to be identified during implementation — the refactor will make it findable because the transform logic will be in one testable place rather than scattered inline.

## What This Does NOT Change

- **SpacetimeDB schema or reducers** — positions are still stored as normalized 0-1 strings
- **Konva rendering structure** — same Groups, Layers, clip regions
- **Drag handler control flow** — same paths for same-zone, cross-zone, snap-back, etc.
- **Selection or ghost image logic** — untouched
- **Goldfish mode** — no opponent transforms needed, unaffected

## Testing Strategy

The utility functions are pure math with no dependencies — unit test them directly:

- Round-trip: `toDbPos(toScreenPos(dbX, dbY, zone, owner), zone, owner)` ≈ `(dbX, dbY)` for both owners
- Mirror symmetry: `toScreenPos(0.3, 0.5, zone, 'opponent')` produces the visually mirrored position of `toScreenPos(0.7, 0.5, zone, 'my')`
- Anchor adjustment: crossing rotation contexts preserves visual position
- Clamping: cards stay within zone bounds
- Center calculation: correct for both rotation=0 and rotation=180

## Implementation Order

1. Create `coordinateTransforms.ts` with the utility functions
2. Add unit tests for the utilities
3. Replace rendering transforms (DB→Screen) — lowest risk, easy to visually verify
4. Replace bounds calculation transforms
5. Replace drag end transforms (Screen→DB) — highest risk, test with both player and opponent drags
6. Replace hit detection transforms
7. Replace modal drag transforms
8. Verify opponent group drag bug is fixed (or now diagnosable)

## Risks

- **Behavioral regression in drag handlers**: The drag handlers are complex and have many code paths. Replacing inline math with function calls could introduce subtle differences if the function signatures don't exactly match what each site needs. Mitigate by doing one site at a time and testing after each.
- **Edge cases in clamping**: The current clamping logic varies slightly between sites (some clamp, some don't). The utility function needs to handle this via the opts parameter.
