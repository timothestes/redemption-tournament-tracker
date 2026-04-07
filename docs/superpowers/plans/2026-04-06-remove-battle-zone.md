# Remove Battle Phase Zone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "Field of Battle" zone that dynamically spawns when the game phase is "battle" — the zone rect, snap positioning, visual layer, auto-return logic, and all references in types/layout/canvas.

**Architecture:** The battle zone is spread across 8 files: type definitions, layout calculation, snap positioning, a visual component, and the main canvas. We delete 3 files entirely and surgically remove battle-specific code from 5 others. The `'battle'` phase itself stays in `GamePhase` — only the zone that spawns during it is removed.

**Tech Stack:** TypeScript, React (Konva), Next.js

---

### Task 1: Remove `'field-of-battle'` from type definitions

**Files:**
- Modify: `app/shared/types/gameCard.ts`

- [ ] **Step 1: Remove `'field-of-battle'` from `ZoneId`, `ALL_ZONES`, and `ZONE_LABELS`**

In `app/shared/types/gameCard.ts`, remove the `'field-of-battle'` entry from all three:

```typescript
// ZoneId — remove '| "field-of-battle"' (line 18)
export type ZoneId =
  | 'deck'
  | 'hand'
  | 'reserve'
  | 'discard'
  | 'paragon'
  | 'land-of-bondage'
  | 'territory'
  | 'land-of-redemption'
  | 'banish';

// ALL_ZONES — remove 'field-of-battle' from array (line 24)
export const ALL_ZONES: ZoneId[] = [
  'deck', 'hand', 'reserve', 'discard', 'paragon',
  'land-of-bondage', 'territory',
  'land-of-redemption', 'banish',
];

// ZONE_LABELS — remove the 'field-of-battle' entry (line 37)
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
};
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit --pretty 2>&1 | head -40`

Expected: Type errors in files that still reference `'field-of-battle'` — these are fixed in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add app/shared/types/gameCard.ts
git commit -m "refactor: remove 'field-of-battle' from ZoneId type definitions"
```

---

### Task 2: Delete battle zone files

**Files:**
- Delete: `app/play/layout/battleZoneSnap.ts`
- Delete: `app/play/layout/__tests__/battleZoneSnap.test.ts`
- Delete: `app/play/layout/__tests__/multiplayerLayout.battle.test.ts`
- Delete: `app/play/components/BattleZoneLayer.tsx`

- [ ] **Step 1: Delete all four files**

```bash
rm app/play/layout/battleZoneSnap.ts
rm app/play/layout/__tests__/battleZoneSnap.test.ts
rm app/play/layout/__tests__/multiplayerLayout.battle.test.ts
rm app/play/components/BattleZoneLayer.tsx
```

- [ ] **Step 2: Commit**

```bash
git add -A app/play/layout/battleZoneSnap.ts app/play/layout/__tests__/battleZoneSnap.test.ts app/play/layout/__tests__/multiplayerLayout.battle.test.ts app/play/components/BattleZoneLayer.tsx
git commit -m "refactor: delete BattleZoneLayer, battleZoneSnap, and battle layout tests"
```

---

### Task 3: Remove `battleActive` from layout calculation

**Files:**
- Modify: `app/play/layout/multiplayerLayout.ts`

- [ ] **Step 1: Remove battle layout profiles**

Delete `NARROW_BATTLE_PROFILE` and `STANDARD_BATTLE_PROFILE` (lines 122–135):

```typescript
// DELETE these entirely:
// const NARROW_BATTLE_PROFILE = { ... };
// const STANDARD_BATTLE_PROFILE = { ... };
```

- [ ] **Step 2: Remove `battleActive` parameter and battle logic from `calculateMultiplayerLayout`**

Change the function signature to remove `battleActive`:

```typescript
export function calculateMultiplayerLayout(
  stageWidth: number,
  stageHeight: number,
  isParagon: boolean = false,
): MultiplayerLayout {
```

Replace the profile selection (line 304–306) with:

```typescript
  const profile = getProfile(stageWidth);
```

Remove the `battleActive` ternary for gap (line 338):

```typescript
  const gap = 2;
```

Remove the `fieldOfBattle` zone creation (lines 372–380):

```typescript
// DELETE:
// const fieldOfBattle: ZoneRect | undefined = battleActive ? { ... } : undefined;
```

Remove `fieldOfBattle` from the return object zones (line 462):

```typescript
    zones: {
      opponentHand,
      opponentTerritory,
      opponentLob,
      divider,
      playerLob,
      playerTerritory,
      playerHand,
    },
```

- [ ] **Step 3: Remove `fieldOfBattle` from the `MultiplayerLayout` interface**

Remove line 52 (`fieldOfBattle?: ZoneRect;`) from the `zones` type in the interface.

- [ ] **Step 4: Remove the battle profile comment from the divider JSDoc**

Update the function JSDoc to remove the `@param battleActive` line.

- [ ] **Step 5: Verify layout tests still pass**

Run: `npx vitest run app/play/layout/__tests__/multiplayerLayout --reporter=verbose 2>&1 | tail -20`

Expected: All remaining layout tests pass (the battle-specific test file was already deleted).

- [ ] **Step 6: Commit**

```bash
git add app/play/layout/multiplayerLayout.ts
git commit -m "refactor: remove battleActive param and battle profiles from layout calculation"
```

---

### Task 4: Remove battle zone logic from MultiplayerCanvas

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

This is the largest change. Remove battle-related code in this exact order:

- [ ] **Step 1: Remove battle imports (lines 50–55)**

Delete these two imports:

```typescript
// DELETE:
import { BattleZoneLayer } from './BattleZoneLayer';
import {
  getCharacterSnapPosition,
  getEnhancementSnapPosition,
  absoluteToNormalized,
} from '../layout/battleZoneSnap';
```

- [ ] **Step 2: Remove `'field-of-battle'` from `isFreeFormZone` helper (line 137)**

Change from:

```typescript
function isFreeFormZone(zone: string): boolean {
  return zone === 'territory' || zone === 'field-of-battle';
}
```

To:

```typescript
function isFreeFormZone(zone: string): boolean {
  return zone === 'territory';
}
```

- [ ] **Step 3: Remove battle phase detection and auto-return effect (lines 184–222)**

Delete the entire block:

```typescript
// DELETE all of this:
//   // ---- Battle phase detection ----
//   const currentPhase = ...
//   const isBattlePhase = ...
//   // ---- Auto-return cards from field of battle ...
//   const prevBattlePhaseRef = ...
//   ... entire useEffect ...
```

Note: `myCardsRef`, `opponentCardsRef`, and `moveCardRef` are used ONLY by the battle auto-return effect. If they have no other consumers, delete them too. Verify by searching for `myCardsRef`, `opponentCardsRef`, `moveCardRef` in the file — if their only usage is in this battle effect block, remove the refs and their assignments.

- [ ] **Step 4: Remove `isBattlePhase` from layout calculation (lines 225–228)**

Change from:

```typescript
  const mpLayout = useMemo(
    () => calculateMultiplayerLayout(virtualWidth, VIRTUAL_HEIGHT, false, isBattlePhase),
    [virtualWidth, isBattlePhase],
  );
```

To:

```typescript
  const mpLayout = useMemo(
    () => calculateMultiplayerLayout(virtualWidth, VIRTUAL_HEIGHT, false),
    [virtualWidth],
  );
```

- [ ] **Step 5: Remove `fieldOfBattle` from zone maps (lines 255, 270)**

In `myZones` useMemo, remove:

```typescript
      ...(mpLayout.zones.fieldOfBattle ? { 'field-of-battle': mpLayout.zones.fieldOfBattle } : {}),
```

In `opponentZones` useMemo, remove the same line.

- [ ] **Step 6: Remove field-of-battle hit detection from `findZoneAtPosition` (lines 654–662)**

Delete:

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

- [ ] **Step 7: Remove field-of-battle snap handling from drag end (lines 1238–1308)**

Delete the entire `if (targetZone === 'field-of-battle' && mpLayout.zones.fieldOfBattle)` block (lines 1238–1308). The code after it (line 1310: `if (isGroupDrag) {`) should remain.

- [ ] **Step 8: Remove field-of-battle from card bounds calculation (lines 1528–1544)**

Delete:

```typescript
    // My cards in field of battle
    if (mpLayout?.zones.fieldOfBattle) {
      const cards = myCards['field-of-battle'] ?? [];
      const zone = mpLayout.zones.fieldOfBattle;
      for (const card of cards) {
        const x = card.posX ? parseFloat(card.posX) * zone.width + zone.x : zone.x;
        const y = card.posY ? parseFloat(card.posY) * zone.height + zone.y : zone.y;
        bounds.push({
          instanceId: String(card.id),
          x,
          y,
          width: cardWidth,
          height: cardHeight,
          rotation: 0,
        });
      }
    }
```

- [ ] **Step 9: Remove BattleZoneLayer rendering (lines 1713–1724)**

Delete:

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

- [ ] **Step 10: Remove field-of-battle card rendering — My cards (lines 2033–2080)**

Delete:

```typescript
          {/* ================================================================
              Cards in field of battle — My cards
              ================================================================ */}
          {mpLayout.zones.fieldOfBattle && (() => { ... })()}
```

- [ ] **Step 11: Remove field-of-battle card rendering — Opponent cards (lines 2082–2132)**

Delete:

```typescript
          {/* ================================================================
              Cards in field of battle — Opponent cards (Y mirrored)
              ================================================================ */}
          {mpLayout.zones.fieldOfBattle && (() => { ... })()}
```

- [ ] **Step 12: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -40`

Expected: Clean (no errors).

- [ ] **Step 13: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "refactor: remove all battle zone logic from MultiplayerCanvas"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run all play-related tests**

Run: `npx vitest run app/play/ --reporter=verbose 2>&1 | tail -30`

Expected: All tests pass.

- [ ] **Step 2: Run full TypeScript check**

Run: `npx tsc --noEmit --pretty 2>&1 | tail -20`

Expected: No errors.

- [ ] **Step 3: Grep for any remaining references**

Run: `grep -rn 'field-of-battle\|fieldOfBattle\|BattleZone\|battleZoneSnap\|BATTLE_PROFILE\|battleActive' app/ --include='*.ts' --include='*.tsx'`

Expected: No results (docs/ references are fine to keep).

- [ ] **Step 4: Commit if any stragglers were found and fixed**
