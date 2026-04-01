# Battle Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated "Field of Battle" zone that expands between territories during Battle Phase, giving players clear card placement for attacking heroes, blocking evil characters, and enhancements.

**Architecture:** The thin divider between territories expands into a 20%-height battle zone when the phase changes to "battle." A new `"field-of-battle"` zone value is added to the type system. Cards dropped in the zone snap to structured positions via a pure utility. A Konva `Group` component renders the zone background, clash line, and drop guides. When battle phase ends, cards auto-return to territory.

**Tech Stack:** TypeScript, Konva.js (react-konva), SpacetimeDB (existing reducers — no schema changes)

**Spec:** `docs/superpowers/specs/2026-03-31-battle-bridge-field-of-battle-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `app/shared/types/gameCard.ts` | Add `"field-of-battle"` to `ZoneId`, `ALL_ZONES`, `ZONE_LABELS` |
| Modify | `app/play/layout/multiplayerLayout.ts` | Add `battleActive` param, compute battle zone rect, export battle layout profiles |
| Create | `app/play/layout/battleZoneSnap.ts` | Pure utility for snap positions within the battle zone |
| Create | `app/play/components/BattleZoneLayer.tsx` | Konva `Group` rendering battle zone background, clash line, and drop guides |
| Modify | `app/play/components/MultiplayerCanvas.tsx` | Wire up battle zone: zone maps, `findZoneAtPosition`, free-form rendering, card-return on phase exit |
| Create | `app/play/layout/__tests__/battleZoneSnap.test.ts` | Unit tests for snap position calculations |
| Create | `app/play/layout/__tests__/multiplayerLayout.battle.test.ts` | Unit tests for battle-active layout calculations |

---

### Task 1: Add `"field-of-battle"` to the Zone Type System

**Files:**
- Modify: `app/shared/types/gameCard.ts:8-35`

- [ ] **Step 1: Add `"field-of-battle"` to `ZoneId` type**

In `app/shared/types/gameCard.ts`, add `'field-of-battle'` to the `ZoneId` union, `ALL_ZONES` array, and `ZONE_LABELS` record:

```typescript
export type ZoneId =
  | 'deck'
  | 'hand'
  | 'reserve'
  | 'discard'
  | 'paragon'
  | 'land-of-bondage'
  | 'territory'
  | 'land-of-redemption'
  | 'banish'
  | 'field-of-battle';

export const ALL_ZONES: ZoneId[] = [
  'deck', 'hand', 'reserve', 'discard', 'paragon',
  'land-of-bondage', 'territory',
  'land-of-redemption', 'banish',
  'field-of-battle',
];

export const ZONE_LABELS: Record<ZoneId, string> = {
  'deck': 'Deck',
  'hand': 'Hand',
  'reserve': 'Reserve',
  'discard': 'Discard',
  'paragon': 'Paragon',
  'land-of-bondage': 'Land of Bondage',
  'territory': 'Territory',
  'land-of-redemption': 'Land of Redemption',
  'banish': 'Banish Zone',
  'field-of-battle': 'Field of Battle',
};
```

- [ ] **Step 2: Verify the build compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors (existing errors are OK if they were there before).

- [ ] **Step 3: Commit**

```bash
git add app/shared/types/gameCard.ts
git commit -m "feat: add field-of-battle to ZoneId type system"
```

---

### Task 2: Update Layout System for Battle-Active Mode

**Files:**
- Modify: `app/play/layout/multiplayerLayout.ts`
- Create: `app/play/layout/__tests__/multiplayerLayout.battle.test.ts`

- [ ] **Step 1: Write failing test for battle layout**

Create `app/play/layout/__tests__/multiplayerLayout.battle.test.ts`:

```typescript
import { calculateMultiplayerLayout } from '../multiplayerLayout';

describe('calculateMultiplayerLayout with battleActive', () => {
  it('returns a fieldOfBattle zone when battleActive is true', () => {
    const layout = calculateMultiplayerLayout(1920, 1080, false, true);
    expect(layout.zones.fieldOfBattle).toBeDefined();
    expect(layout.zones.fieldOfBattle.width).toBeGreaterThan(0);
    expect(layout.zones.fieldOfBattle.height).toBeGreaterThan(0);
    expect(layout.zones.fieldOfBattle.label).toBe('Field of Battle');
  });

  it('does not return fieldOfBattle zone when battleActive is false', () => {
    const layout = calculateMultiplayerLayout(1920, 1080, false, false);
    expect(layout.zones.fieldOfBattle).toBeUndefined();
  });

  it('compresses territories when battle is active', () => {
    const normal = calculateMultiplayerLayout(1920, 1080, false, false);
    const battle = calculateMultiplayerLayout(1920, 1080, false, true);
    expect(battle.zones.playerTerritory.height).toBeLessThan(normal.zones.playerTerritory.height);
    expect(battle.zones.opponentTerritory.height).toBeLessThan(normal.zones.opponentTerritory.height);
  });

  it('positions fieldOfBattle between opponent territory and player territory', () => {
    const layout = calculateMultiplayerLayout(1920, 1080, false, true);
    const fob = layout.zones.fieldOfBattle;
    const oppTerritory = layout.zones.opponentTerritory;
    const playerTerritory = layout.zones.playerTerritory;
    // Field of battle should be below opponent territory and above player territory
    expect(fob.y).toBeGreaterThanOrEqual(oppTerritory.y + oppTerritory.height - 5);
    expect(fob.y + fob.height).toBeLessThanOrEqual(playerTerritory.y + 5);
  });

  it('battle zone takes approximately 20% of stage height', () => {
    const layout = calculateMultiplayerLayout(1920, 1080, false, true);
    const ratio = layout.zones.fieldOfBattle.height / 1080;
    expect(ratio).toBeGreaterThan(0.15);
    expect(ratio).toBeLessThan(0.25);
  });

  it('all zone heights still sum to stage height (battle mode)', () => {
    const layout = calculateMultiplayerLayout(1920, 1080, false, true);
    const z = layout.zones;
    const totalHeight =
      z.opponentHand.height +
      z.opponentLob.height +
      z.opponentTerritory.height +
      z.fieldOfBattle.height +
      z.playerTerritory.height +
      z.playerLob.height +
      (1080 - z.playerHand.y); // player hand extends to bottom
    // Allow ±10px for rounding
    expect(totalHeight).toBeGreaterThan(1070);
    expect(totalHeight).toBeLessThan(1090);
  });

  it('works with narrow layout too', () => {
    const layout = calculateMultiplayerLayout(1440, 1080, false, true);
    expect(layout.zones.fieldOfBattle).toBeDefined();
    expect(layout.zones.fieldOfBattle.height).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest app/play/layout/__tests__/multiplayerLayout.battle.test.ts --no-coverage 2>&1 | tail -20`
Expected: FAIL — `fieldOfBattle` is undefined, `calculateMultiplayerLayout` doesn't accept 4th arg.

- [ ] **Step 3: Add battle-active layout profiles to multiplayerLayout.ts**

In `app/play/layout/multiplayerLayout.ts`, add battle variants after the existing profiles (after line ~118):

```typescript
/** Battle-active layout: territory compresses, field-of-battle zone appears. */
const NARROW_BATTLE_PROFILE: LayoutProfile = {
  ...NARROW_PROFILE,
  oppTerritoryRatio: 0.1825,
  dividerRatio: 0.20,   // repurposed as battle zone
  playerTerritoryRatio: 0.1825,
};
// Sum check: 0.07 + 0.1825 + 0.10 + 0.20 + 0.10 + 0.1825 + 0.165 = 1.0 ✓

const STANDARD_BATTLE_PROFILE: LayoutProfile = {
  ...STANDARD_PROFILE,
  oppTerritoryRatio: 0.18,
  dividerRatio: 0.20,   // repurposed as battle zone
  playerTerritoryRatio: 0.18,
};
// Sum check: 0.08 + 0.18 + 0.09 + 0.20 + 0.09 + 0.18 + 0.18 = 1.0 ✓
```

- [ ] **Step 4: Update the `MultiplayerLayout` interface to include optional `fieldOfBattle`**

Change the `zones` type inside `MultiplayerLayout` (line ~47):

```typescript
export interface MultiplayerLayout {
  zones: {
    opponentHand: ZoneRect;
    opponentTerritory: ZoneRect;
    opponentLob: ZoneRect;
    divider: ZoneRect;
    fieldOfBattle?: ZoneRect;
    playerLob: ZoneRect;
    playerTerritory: ZoneRect;
    playerHand: ZoneRect;
  };
  // ... rest unchanged
}
```

- [ ] **Step 5: Update `calculateMultiplayerLayout` signature and profile selection**

Add `battleActive` parameter and select the correct profile:

```typescript
export function calculateMultiplayerLayout(
  stageWidth: number,
  stageHeight: number,
  isParagon: boolean = false,
  battleActive: boolean = false,
): MultiplayerLayout {
  const profile = battleActive
    ? (stageWidth <= BREAKPOINT_WIDTH ? NARROW_BATTLE_PROFILE : STANDARD_BATTLE_PROFILE)
    : getProfile(stageWidth);
```

- [ ] **Step 6: Add `fieldOfBattle` zone rect calculation and update Y anchors**

In the body of `calculateMultiplayerLayout`, after the divider rect is calculated (around line ~343), when `battleActive` is true the divider rect becomes the field of battle:

Replace the divider zone rect construction (the existing `const divider: ZoneRect = { ... }`) with:

```typescript
  const divider: ZoneRect = {
    x: 0,
    y: dividerY,
    width: stageWidth,
    height: dividerHeight,
    label: '',
  };

  const fieldOfBattle: ZoneRect | undefined = battleActive
    ? {
        x: pad,
        y: dividerY,
        width: playAreaWidth - pad * 2,
        height: dividerHeight,
        label: 'Field of Battle',
      }
    : undefined;
```

And in the return statement, add `fieldOfBattle`:

```typescript
  return {
    zones: {
      opponentHand,
      opponentTerritory,
      opponentLob,
      divider,
      fieldOfBattle,
      playerLob,
      playerTerritory,
      playerHand,
    },
    // ... rest unchanged
  };
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest app/play/layout/__tests__/multiplayerLayout.battle.test.ts --no-coverage 2>&1 | tail -20`
Expected: All 6 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add app/play/layout/multiplayerLayout.ts app/play/layout/__tests__/multiplayerLayout.battle.test.ts
git commit -m "feat: add battle-active layout mode to multiplayerLayout"
```

---

### Task 3: Create Battle Zone Snap Utility

**Files:**
- Create: `app/play/layout/battleZoneSnap.ts`
- Create: `app/play/layout/__tests__/battleZoneSnap.test.ts`

- [ ] **Step 1: Write failing tests for snap positions**

Create `app/play/layout/__tests__/battleZoneSnap.test.ts`:

```typescript
import {
  getCharacterSnapPosition,
  getEnhancementSnapPosition,
} from '../battleZoneSnap';

// Mock a battle zone rect: 100x200 at position (50, 300)
const zoneRect = { x: 50, y: 300, width: 1000, height: 200, label: 'Field of Battle' };
const cardWidth = 98;
const cardHeight = 137;

describe('getCharacterSnapPosition', () => {
  it('centers the first character horizontally on the player side (bottom half)', () => {
    const pos = getCharacterSnapPosition('player', 0, zoneRect, cardWidth, cardHeight);
    // Should be centered horizontally in the zone
    const expectedX = zoneRect.x + zoneRect.width / 2 - cardWidth / 2;
    expect(pos.x).toBeCloseTo(expectedX, 0);
    // Should be in the bottom half of the zone
    expect(pos.y).toBeGreaterThan(zoneRect.y + zoneRect.height / 2 - 10);
  });

  it('centers the first character on the opponent side (top half)', () => {
    const pos = getCharacterSnapPosition('opponent', 0, zoneRect, cardWidth, cardHeight);
    // Should be in the top half of the zone
    expect(pos.y).toBeLessThan(zoneRect.y + zoneRect.height / 2);
  });

  it('offsets banded characters to the right', () => {
    const first = getCharacterSnapPosition('player', 0, zoneRect, cardWidth, cardHeight);
    const second = getCharacterSnapPosition('player', 1, zoneRect, cardWidth, cardHeight);
    expect(second.x).toBeGreaterThan(first.x);
  });
});

describe('getEnhancementSnapPosition', () => {
  it('places the first enhancement to the left of the character', () => {
    const charPos = getCharacterSnapPosition('player', 0, zoneRect, cardWidth, cardHeight);
    const enhPos = getEnhancementSnapPosition('player', 0, 0, zoneRect, cardWidth, cardHeight);
    expect(enhPos.x).toBeLessThan(charPos.x);
    expect(enhPos.y).toBeCloseTo(charPos.y, 0);
  });

  it('stacks enhancements with 60% card width overlap', () => {
    const enh0 = getEnhancementSnapPosition('player', 0, 0, zoneRect, cardWidth, cardHeight);
    const enh1 = getEnhancementSnapPosition('player', 0, 1, zoneRect, cardWidth, cardHeight);
    // Each subsequent enhancement should be further left by 40% of card width
    const step = cardWidth * 0.4;
    expect(enh0.x - enh1.x).toBeCloseTo(step, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest app/play/layout/__tests__/battleZoneSnap.test.ts --no-coverage 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the snap utility**

Create `app/play/layout/battleZoneSnap.ts`:

```typescript
/**
 * Battle zone snap positions.
 *
 * Calculates where characters and enhancements should snap to within
 * the Field of Battle zone. Returns absolute canvas coordinates.
 *
 * Layout per side (horizontal):
 *   [Enh N] ... [Enh 1] [Enh 0]  [Char 0]  [Char 1]  [Char 2]
 *                                     ↑
 *                              centered in zone
 */

import type { ZoneRect } from './multiplayerLayout';

/** Gap between banded characters (px). */
const BAND_GAP = 10;

/** Enhancement overlap: each enhancement shows 40% of card width. */
const ENH_VISIBLE_RATIO = 0.4;

/**
 * Get the snap position for a character in the battle zone.
 *
 * @param side       Which side of the battle zone ('player' = bottom half, 'opponent' = top half)
 * @param charIndex  0 = primary character, 1+ = banded characters
 * @param zone       The full battle zone rect
 * @param cardWidth  Card width in canvas pixels
 * @param cardHeight Card height in canvas pixels
 * @returns Absolute {x, y} position (top-left corner of the card)
 */
export function getCharacterSnapPosition(
  side: 'player' | 'opponent',
  charIndex: number,
  zone: ZoneRect,
  cardWidth: number,
  cardHeight: number,
): { x: number; y: number } {
  const halfHeight = zone.height / 2;

  // Vertical center within the appropriate half
  const halfY = side === 'player'
    ? zone.y + halfHeight  // bottom half starts at midpoint
    : zone.y;              // top half starts at zone top
  const y = halfY + (halfHeight - cardHeight) / 2;

  // Horizontal: primary character centered, banded offset right
  const centerX = zone.x + zone.width / 2 - cardWidth / 2;
  const x = centerX + charIndex * (cardWidth + BAND_GAP);

  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Get the snap position for an enhancement in the battle zone.
 *
 * Enhancements cascade to the LEFT of their parent character,
 * overlapping by (1 - ENH_VISIBLE_RATIO) of card width.
 *
 * @param side           Which side ('player' or 'opponent')
 * @param charIndex      Which character this enhancement belongs to (0 = primary)
 * @param enhIndex       0 = closest to character, 1 = next left, etc.
 * @param zone           The full battle zone rect
 * @param cardWidth      Card width in canvas pixels
 * @param cardHeight     Card height in canvas pixels
 * @returns Absolute {x, y} position (top-left corner of the card)
 */
export function getEnhancementSnapPosition(
  side: 'player' | 'opponent',
  charIndex: number,
  enhIndex: number,
  zone: ZoneRect,
  cardWidth: number,
  cardHeight: number,
): { x: number; y: number } {
  const charPos = getCharacterSnapPosition(side, charIndex, zone, cardWidth, cardHeight);
  const step = cardWidth * ENH_VISIBLE_RATIO;

  return {
    x: Math.round(charPos.x - (enhIndex + 1) * step),
    y: charPos.y,
  };
}

/**
 * Convert absolute canvas position to normalized 0-1 coordinates within the battle zone.
 */
export function absoluteToNormalized(
  x: number,
  y: number,
  zone: ZoneRect,
): { posX: string; posY: string } {
  return {
    posX: String((x - zone.x) / zone.width),
    posY: String((y - zone.y) / zone.height),
  };
}

/**
 * Convert normalized 0-1 coordinates to absolute canvas position within the battle zone.
 */
export function normalizedToAbsolute(
  posX: string,
  posY: string,
  zone: ZoneRect,
): { x: number; y: number } {
  return {
    x: zone.x + parseFloat(posX) * zone.width,
    y: zone.y + parseFloat(posY) * zone.height,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest app/play/layout/__tests__/battleZoneSnap.test.ts --no-coverage 2>&1 | tail -10`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/play/layout/battleZoneSnap.ts app/play/layout/__tests__/battleZoneSnap.test.ts
git commit -m "feat: add battle zone snap position utility"
```

---

### Task 4: Create BattleZoneLayer Konva Component

**Files:**
- Create: `app/play/components/BattleZoneLayer.tsx`

This component renders the visual treatment for the battle zone: background, clash line, and drop guide silhouettes.

- [ ] **Step 1: Create the BattleZoneLayer component**

Create `app/play/components/BattleZoneLayer.tsx`:

```typescript
'use client';

import { Group, Rect, Line, Text } from 'react-konva';
import type { ZoneRect } from '../layout/multiplayerLayout';

interface BattleZoneLayerProps {
  zone: ZoneRect;
  cardWidth: number;
  cardHeight: number;
  /** Number of cards the player currently has in the battle zone. */
  playerCardCount: number;
  /** Number of cards the opponent currently has in the battle zone. */
  opponentCardCount: number;
}

/**
 * Renders the Field of Battle zone visual treatment:
 * - Warm amber background with radial glow
 * - Central clash line
 * - Drop guide silhouettes when empty
 */
export function BattleZoneLayer({
  zone,
  cardWidth,
  cardHeight,
  playerCardCount,
  opponentCardCount,
}: BattleZoneLayerProps) {
  const midY = zone.y + zone.height / 2;
  const halfHeight = zone.height / 2;

  // Guide positions: centered horizontally in each half
  const guideCenterX = zone.x + zone.width / 2 - cardWidth / 2;
  const playerGuideY = zone.y + halfHeight + (halfHeight - cardHeight) / 2;
  const opponentGuideY = zone.y + (halfHeight - cardHeight) / 2;

  return (
    <Group>
      {/* Battle zone background — warm amber glow */}
      <Rect
        x={zone.x}
        y={zone.y}
        width={zone.width}
        height={zone.height}
        fill="#1e1610"
        opacity={0.55}
        cornerRadius={3}
      />

      {/* Radial glow effect at center — simulated with a lighter rect */}
      <Rect
        x={zone.x + zone.width * 0.2}
        y={midY - zone.height * 0.3}
        width={zone.width * 0.6}
        height={zone.height * 0.6}
        fillRadialGradientStartPoint={{ x: zone.width * 0.3, y: zone.height * 0.3 }}
        fillRadialGradientEndPoint={{ x: zone.width * 0.3, y: zone.height * 0.3 }}
        fillRadialGradientStartRadius={0}
        fillRadialGradientEndRadius={zone.width * 0.3}
        fillRadialGradientColorStops={[0, 'rgba(241, 189, 126, 0.12)', 1, 'rgba(241, 189, 126, 0)']}
        listening={false}
      />

      {/* Clash line — horizontal gradient line at the center */}
      <Line
        points={[zone.x + 40, midY, zone.x + zone.width - 40, midY]}
        stroke="#F1BD7E"
        strokeWidth={1}
        opacity={0.3}
        dash={[8, 6]}
        listening={false}
      />

      {/* Drop guide — Player side (hero placeholder) */}
      {playerCardCount === 0 && (
        <Group>
          <Rect
            x={guideCenterX}
            y={playerGuideY}
            width={cardWidth}
            height={cardHeight}
            stroke="#F1BD7E"
            strokeWidth={1}
            dash={[6, 4]}
            opacity={0.25}
            cornerRadius={3}
            listening={false}
          />
          <Text
            x={guideCenterX}
            y={playerGuideY + cardHeight / 2 - 6}
            width={cardWidth}
            text="HERO"
            fontSize={10}
            fontFamily="Cinzel, Georgia, serif"
            fill="#F1BD7E"
            opacity={0.35}
            align="center"
            listening={false}
          />
        </Group>
      )}

      {/* Drop guide — Opponent side (blocker placeholder) */}
      {opponentCardCount === 0 && (
        <Group>
          <Rect
            x={guideCenterX}
            y={opponentGuideY}
            width={cardWidth}
            height={cardHeight}
            stroke="#F1BD7E"
            strokeWidth={1}
            dash={[6, 4]}
            opacity={0.25}
            cornerRadius={3}
            listening={false}
          />
          <Text
            x={guideCenterX}
            y={opponentGuideY + cardHeight / 2 - 6}
            width={cardWidth}
            text="BLOCKER"
            fontSize={10}
            fontFamily="Cinzel, Georgia, serif"
            fill="#F1BD7E"
            opacity={0.35}
            align="center"
            listening={false}
          />
        </Group>
      )}
    </Group>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i "BattleZoneLayer" | head -5`
Expected: No errors related to BattleZoneLayer.

- [ ] **Step 3: Commit**

```bash
git add app/play/components/BattleZoneLayer.tsx
git commit -m "feat: add BattleZoneLayer Konva component for battle zone rendering"
```

---

### Task 5: Wire Up Battle Zone in MultiplayerCanvas — Zone Maps & Detection

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

This task adds the battle zone to the zone maps and updates `findZoneAtPosition` to detect it. It does NOT yet render cards or handle transitions — that's Tasks 6 and 7.

- [ ] **Step 1: Import BattleZoneLayer and snap utilities**

At the top of `MultiplayerCanvas.tsx`, add imports (near line ~51):

```typescript
import { BattleZoneLayer } from './BattleZoneLayer';
import {
  getCharacterSnapPosition,
  getEnhancementSnapPosition,
  absoluteToNormalized,
  normalizedToAbsolute,
} from '../layout/battleZoneSnap';
```

- [ ] **Step 2: Update `isFreeFormZone` to include `field-of-battle`**

Change the helper at line ~131:

```typescript
function isFreeFormZone(zone: string): boolean {
  return zone === 'territory' || zone === 'field-of-battle';
}
```

- [ ] **Step 3: Pass `battleActive` to the layout calculation**

The layout `useMemo` (around line ~180) needs to know if we're in battle phase. Add phase detection and pass it through:

```typescript
  // ---- Battle phase detection ----
  const currentPhase = gameState.game?.currentPhase ?? 'draw';
  const isBattlePhase = currentPhase === 'battle';

  // ---- Layout ----
  const mpLayout = useMemo(
    () => calculateMultiplayerLayout(virtualWidth, VIRTUAL_HEIGHT, false, isBattlePhase),
    [virtualWidth, isBattlePhase],
  );
```

Note: Check if `isParagon` is currently being passed here. If the existing code passes a variable for paragon, keep that. The key change is adding `isBattlePhase` as the 4th argument.

- [ ] **Step 4: Add `field-of-battle` to `myZones` and `opponentZones`**

Update both `useMemo` blocks (~lines 199-225). Each player's zone map gets the battle zone when it exists. Since the battle zone is shared (both players' cards live in it), add it to BOTH maps — each pointing to the same rect:

```typescript
  const myZones: Record<string, ZoneRect> = useMemo(() => {
    if (!mpLayout) return {};
    return {
      territory: mpLayout.zones.playerTerritory,
      'land-of-bondage': mpLayout.zones.playerLob,
      'land-of-redemption': mpLayout.sidebar.player.lor!,
      banish: mpLayout.sidebar.player.banish!,
      reserve: mpLayout.sidebar.player.reserve!,
      deck: mpLayout.sidebar.player.deck!,
      discard: mpLayout.sidebar.player.discard!,
      ...(mpLayout.sidebar.player.paragon ? { paragon: mpLayout.sidebar.player.paragon } : {}),
      ...(mpLayout.zones.fieldOfBattle ? { 'field-of-battle': mpLayout.zones.fieldOfBattle } : {}),
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
      ...(mpLayout.zones.fieldOfBattle ? { 'field-of-battle': mpLayout.zones.fieldOfBattle } : {}),
    };
  }, [mpLayout]);
```

- [ ] **Step 5: Update `findZoneAtPosition` to check the battle zone first**

In `findZoneAtPosition` (line ~594), add a battle zone check BEFORE the my-zones loop. The battle zone needs priority because it overlaps with where the divider used to be. Add after the opponent hand check (~line 606):

```typescript
      // Check field of battle zone (shared — determine side by y position)
      if (mpLayout.zones.fieldOfBattle) {
        const fob = mpLayout.zones.fieldOfBattle;
        if (pointInRect(x, y, fob)) {
          const midY = fob.y + fob.height / 2;
          const owner = y < midY ? 'opponent' : 'my';
          return { zone: 'field-of-battle', owner };
        }
      }
```

- [ ] **Step 6: Verify the build compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 7: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: wire battle zone into MultiplayerCanvas zone maps and hit detection"
```

---

### Task 6: Render Battle Zone Background and Cards

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

This task renders the BattleZoneLayer visual treatment and renders cards that are in the `"field-of-battle"` zone.

- [ ] **Step 1: Render BattleZoneLayer in the Konva layer**

In the zone backgrounds section (around line ~1580, after the "Zone backgrounds — My zones" block), add the battle zone rendering. Place it BEFORE the opponent zone backgrounds so it renders in the correct z-order:

```typescript
          {/* ================================================================
              Battle Zone background — rendered when in battle phase
              ================================================================ */}
          {mpLayout.zones.fieldOfBattle && (
            <BattleZoneLayer
              zone={mpLayout.zones.fieldOfBattle}
              cardWidth={cardWidth}
              cardHeight={cardHeight}
              playerCardCount={(myCards['field-of-battle'] ?? []).length}
              opponentCardCount={(opponentCards['field-of-battle'] ?? []).length}
            />
          )}
```

- [ ] **Step 2: Add card rendering for battle zone cards**

After the existing free-form zones card rendering blocks (around line ~1860, after the opponent territory cards), add rendering for battle zone cards. Both my cards and opponent cards in the battle zone are rendered in the same area:

```typescript
          {/* ================================================================
              Cards in field of battle — My cards
              ================================================================ */}
          {mpLayout.zones.fieldOfBattle && (() => {
            const cards = myCards['field-of-battle'];
            if (!cards || cards.length === 0) return null;
            const zone = mpLayout.zones.fieldOfBattle;
            const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
            return (
              <Group
                key="my-cards-field-of-battle"
                clipX={zone.x}
                clipY={zone.y}
                clipWidth={zone.width}
                clipHeight={zone.height}
              >
                {sorted.map((card) => {
                  const gameCard = adaptCard(card, 'player1');
                  const x = card.posX ? parseFloat(card.posX) * zone.width + zone.x : zone.x + zone.width / 2 - cardWidth / 2;
                  const y = card.posY ? parseFloat(card.posY) * zone.height + zone.y : zone.y + zone.height * 0.75 - cardHeight / 2;
                  return (
                    <GameCardNode
                      key={String(card.id)}
                      card={gameCard}
                      x={x}
                      y={y}
                      rotation={0}
                      cardWidth={cardWidth}
                      cardHeight={cardHeight}
                      image={getCardImage(card)}
                      isSelected={isSelected(String(card.id))}
                      isDraggable={true}
                      hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                      nodeRef={registerCardNode}
                      onClick={handleCardClick}
                      onDragStart={handleCardDragStart}
                      onDragMove={handleCardDragMove}
                      onDragEnd={handleCardDragEnd}
                      onContextMenu={handleCardContextMenu}
                      onDblClick={handleDblClick}
                      onMouseEnter={handleMouseEnter}
                      onMouseLeave={handleMouseLeave}
                    />
                  );
                })}
              </Group>
            );
          })()}

          {/* ================================================================
              Cards in field of battle — Opponent cards
              ================================================================ */}
          {mpLayout.zones.fieldOfBattle && (() => {
            const cards = opponentCards['field-of-battle'];
            if (!cards || cards.length === 0) return null;
            const zone = mpLayout.zones.fieldOfBattle;
            const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
            return (
              <Group
                key="opp-cards-field-of-battle"
                clipX={zone.x}
                clipY={zone.y}
                clipWidth={zone.width}
                clipHeight={zone.height}
              >
                {sorted.map((card) => {
                  const gameCard = adaptCard(card, 'player2');
                  const x = card.posX ? parseFloat(card.posX) * zone.width + zone.x : zone.x + zone.width / 2 - cardWidth / 2;
                  const y = card.posY ? parseFloat(card.posY) * zone.height + zone.y : zone.y + zone.height * 0.25 - cardHeight / 2;
                  return (
                    <GameCardNode
                      key={String(card.id)}
                      card={gameCard}
                      x={x}
                      y={y}
                      rotation={0}
                      cardWidth={cardWidth}
                      cardHeight={cardHeight}
                      image={getCardImage(card)}
                      isSelected={isSelected(String(card.id))}
                      isDraggable={true}
                      hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                      nodeRef={registerCardNode}
                      onClick={handleCardClick}
                      onDragStart={handleCardDragStart}
                      onDragMove={handleCardDragMove}
                      onDragEnd={handleCardDragEnd}
                      onContextMenu={handleCardContextMenu}
                      onDblClick={handleDblClick}
                      onMouseEnter={handleMouseEnter}
                      onMouseLeave={handleMouseLeave}
                    />
                  );
                })}
              </Group>
            );
          })()}
```

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: render battle zone background and cards in field of battle"
```

---

### Task 7: Card Auto-Return on Battle Phase Exit

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

When the phase changes away from "battle," any cards still in `"field-of-battle"` should automatically return to their owner's territory.

- [ ] **Step 1: Add a `useEffect` for battle phase exit**

Add this effect in MultiplayerCanvas, after the existing phase detection (~after the `isBattlePhase` const):

```typescript
  // ---- Auto-return cards from field of battle when exiting battle phase ----
  const prevBattlePhaseRef = useRef(false);
  useEffect(() => {
    const wasBattle = prevBattlePhaseRef.current;
    prevBattlePhaseRef.current = isBattlePhase;

    // Only trigger on transition FROM battle to non-battle
    if (!wasBattle || isBattlePhase) return;

    // Return my cards from field of battle to my territory
    const myBattleCards = myCards['field-of-battle'] ?? [];
    for (const card of myBattleCards) {
      moveCard(String(card.id), 'territory', undefined, '0.45', '0.05');
    }

    // Return opponent's cards from field of battle to opponent territory
    const oppBattleCards = opponentCards['field-of-battle'] ?? [];
    for (const card of oppBattleCards) {
      // Use moveOpponentCard if available, or moveCard with appropriate ownership
      moveCard(String(card.id), 'territory', undefined, '0.45', '0.95');
    }

    if (myBattleCards.length > 0 || oppBattleCards.length > 0) {
      showGameToast('Battle ended — cards returned to territory', 'info');
    }
  }, [isBattlePhase, myCards, opponentCards, moveCard]);
```

**Important note for the implementer:** The exact API for `moveCard` in the multiplayer context may differ. Check how `moveCard` is destructured from `gameState` (line ~166). The function signature is likely `moveCard(cardInstanceId: string, toZone: string, zoneIndex?: string, posX?: string, posY?: string)`. Verify the params match what `useGameState` exposes. Also verify whether moving opponent cards requires `moveOpponentCard` or if `moveCard` can handle any card the player owns. In sandbox mode, only your own cards can be moved — opponent cards returning to their territory is handled by the opponent's client seeing the same phase change.

**Correction:** Since each player's client only moves their OWN cards, the opponent cards will be handled by the opponent's client running the same `useEffect`. Remove the opponent card loop:

```typescript
  useEffect(() => {
    const wasBattle = prevBattlePhaseRef.current;
    prevBattlePhaseRef.current = isBattlePhase;

    if (!wasBattle || isBattlePhase) return;

    const myBattleCards = myCards['field-of-battle'] ?? [];
    for (const card of myBattleCards) {
      moveCard(String(card.id), 'territory', undefined, '0.45', '0.05');
    }

    if (myBattleCards.length > 0) {
      showGameToast('Battle ended — cards returned to territory', 'info');
    }
  }, [isBattlePhase, myCards, moveCard]);
```

- [ ] **Step 2: Verify the build compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 3: Test manually**

1. Start a multiplayer game
2. Enter battle phase — verify the battle zone appears between territories
3. Drag a hero card from territory into the battle zone
4. Verify the card renders in the battle zone
5. Change phase to "discard" — verify the card returns to territory
6. Verify a toast appears: "Battle ended — cards returned to territory"

- [ ] **Step 4: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: auto-return cards from battle zone when exiting battle phase"
```

---

### Task 8: Handle Snap-to-Position on Drop in Battle Zone

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

When a card is dropped in the `"field-of-battle"` zone, snap it to a structured position using the snap utility instead of using the raw drop coordinates.

- [ ] **Step 1: Update `handleCardDragEnd` for battle zone snapping**

In `handleCardDragEnd` (around line ~1186 where different-zone moves are handled), add a special case for drops into `field-of-battle`. Find the section where free-form zone positions are calculated (look for the condition like `if (isFreeFormZone(targetZone))`) and add a battle zone branch before it:

```typescript
        // Special handling for field-of-battle zone: snap to structured position
        if (targetZone === 'field-of-battle' && mpLayout.zones.fieldOfBattle) {
          const fob = mpLayout.zones.fieldOfBattle;
          const side = hit.owner === 'my' ? 'player' : 'opponent';
          // Count existing characters on this side to determine charIndex
          const existingCards = hit.owner === 'my'
            ? (myCards['field-of-battle'] ?? [])
            : (opponentCards['field-of-battle'] ?? []);
          // Determine if this is a character or enhancement by card type
          const cardType = card.cardType;
          const isEnhancement = cardType === 'GE' || cardType === 'EE';

          let snapX: number;
          let snapY: number;

          if (isEnhancement) {
            // Find the number of enhancements already on this side
            const existingEnhancements = existingCards.filter(
              (c) => c.cardType === 'GE' || c.cardType === 'EE'
            );
            const snap = getEnhancementSnapPosition(
              side, 0, existingEnhancements.length, fob, cardWidth, cardHeight
            );
            snapX = snap.x;
            snapY = snap.y;
          } else {
            // Character — count existing characters
            const existingChars = existingCards.filter(
              (c) => c.cardType !== 'GE' && c.cardType !== 'EE'
            );
            const snap = getCharacterSnapPosition(
              side, existingChars.length, fob, cardWidth, cardHeight
            );
            snapX = snap.x;
            snapY = snap.y;
          }

          // Normalize to 0-1 within the battle zone
          const normalized = absoluteToNormalized(snapX, snapY, fob);

          if (isGroupDrag) {
            // For group drags, just move first card with snap, rest spread
            moveCardsBatch(cardIds, 'field-of-battle', normalized.posX, normalized.posY);
          } else {
            moveCard(cardIds[0], 'field-of-battle', undefined, normalized.posX, normalized.posY);
          }
          clearSelection();
          return;
        }
```

**Important note for the implementer:** The exact location in `handleCardDragEnd` to insert this depends on the current code structure. Look for the section after `const isSameZone = ...` where the code branches on whether it's a same-zone or different-zone move. The battle zone snap should go in the different-zone branch, before the generic free-form zone positioning. Also verify the exact signatures of `moveCard` and `moveCardsBatch` — the 3rd positional arg may be `zoneIndex`.

- [ ] **Step 2: Verify the build compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 3: Test manually**

1. Start a game, enter battle phase
2. Drag a hero to the battle zone — it should snap to the center of the player's half
3. Drag an enhancement to the battle zone — it should cascade to the left of the hero
4. Drag a second character — it should position to the right of the first
5. Opponent drags a blocker — should snap to the opponent's half

- [ ] **Step 4: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: snap cards to structured positions when dropped in battle zone"
```

---

### Task 9: Add Battle Zone to Selection & Context Menu Systems

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

Cards in the battle zone need to participate in the selection system (marquee select, click select) and context menus.

- [ ] **Step 1: Add battle zone cards to the selection bounds calculation**

Find the section where `bounds: CardBound[]` is built (around line ~1391, where it iterates `FREE_FORM_ZONES`). The battle zone cards should also be included. After the existing loop over `FREE_FORM_ZONES` for my cards, add:

```typescript
    // My cards in field of battle
    if (mpLayout?.zones.fieldOfBattle) {
      const cards = myCards['field-of-battle'] ?? [];
      const zone = mpLayout.zones.fieldOfBattle;
      for (const card of cards) {
        const x = card.posX ? parseFloat(card.posX) * zone.width + zone.x : zone.x;
        const y = card.posY ? parseFloat(card.posY) * zone.height + zone.y : zone.y;
        bounds.push({
          id: String(card.id),
          x,
          y,
          width: cardWidth,
          height: cardHeight,
        });
      }
    }
```

- [ ] **Step 2: Verify the build compiles and commit**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: include battle zone cards in selection system"
```

---

### Future Enhancement: Transition Animation

The spec mentions 300ms Konva tweens for the zone expansion/collapse. In this initial implementation, the layout change is instant (the `useMemo` recalculates when `isBattlePhase` changes). Smooth tweening requires interpolating between two full layout states for every zone rect, which is complex and is explicitly listed as a non-goal in the spec ("Animation polish beyond basic transitions can be refined later"). This can be added as a follow-up task by storing the previous layout, computing tween targets, and using `Konva.Tween` on each zone Group's position/size.

---

### Task 10: Final Verification & Cleanup

- [ ] **Step 1: Run the full test suite**

Run: `npx jest --no-coverage 2>&1 | tail -20`
Expected: All tests pass (including new battle layout and snap tests).

- [ ] **Step 2: Run the build**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Manual end-to-end testing**

Test the complete battle flow:
1. Start a multiplayer game between two browser tabs
2. Navigate to Preparation phase, play some characters to territory
3. Enter Battle Phase — verify zone expands smoothly
4. Drag a hero into the player's half of the battle zone — verify snap positioning
5. From the other tab (opponent), drag an evil character to the opponent's half — verify snap
6. Drag enhancements from hand — verify they cascade left of the character
7. Exit battle phase — verify cards return to territory with toast notification
8. Re-enter battle phase — verify zone expands again (empty, with drop guides)
9. Test on a narrow viewport (~1440px width) — verify narrow layout still works

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "fix: battle bridge final adjustments from manual testing"
```
