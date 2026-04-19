# Goldfish Equip Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a Redemption CCG player in goldfish practice mode to attach weapon cards to warrior cards in the Territory zone, so they visually stack together and drag as a unit. Detach is an explicit click on a link icon at the overlap seam.

**Architecture:**
- Data model: one optional pointer on each `GameCard` — `equippedTo?: string` holds the instance ID of the warrior the weapon is attached to. Unidirectional. The warrior-side list is derived by scanning the zone for cards with `equippedTo === warrior.instanceId`.
- Reducer-driven, same as every other game mutation. New actions `ATTACH_CARD` and `DETACH_CARD`. Attach is auto-cleared in `MOVE_CARD`/`MOVE_CARDS_BATCH` when either card leaves Territory without its partner, so stale attachments cannot survive a discard/banish.
- Visual: warrior renders at its stored `posX/posY`; each attached weapon renders at `(warrior.posX - OFFSET, warrior.posY - OFFSET)`. Weapons draw before warriors (weapons behind, warriors in front). Link icon is an HTML overlay above the canvas at the seam.
- Drag: attach happens on `onDragEnd` — if the dropped card is a weapon and its center lies inside a warrior's card rect, dispatch `ATTACH_CARD` instead of a normal move. Warrior drag piggybacks on the existing multi-card ghost/follower system in `handleCardDragStart` by injecting attached weapons as followers.

**Tech Stack:** Next.js 15, React 19, TypeScript, Konva.js / react-konva for canvas, vitest for unit tests. No new dependencies.

**Scope (explicit):** Goldfish mode only (`app/goldfish/`). Multiplayer SpacetimeDB equip is a separate follow-up plan — schema change + `attach_card`/`detach_card` reducers + bindings regen + publish + client integration. Do not touch `spacetimedb/` or `app/play/` in this plan.

**Constants (shared across tasks):**
- `EQUIP_OFFSET_RATIO = 0.18` — weapon is offset by 18% of the card's width/height, up-and-left, from its warrior.
- `MAX_EQUIPPED_WEAPONS_PER_WARRIOR = 3` — safety cap, prevents accidental infinite stacks. Drop on a warrior with 3 weapons does nothing.

---

## File Structure

**Modify:**
- `app/shared/types/gameCard.ts` — add `equippedTo?: string` to `GameCard`; add `ATTACH_CARD` / `DETACH_CARD` to `ActionType`; extend `GameAction.payload` with `warriorInstanceId?: string`.
- `lib/cards/lookup.ts` — export two helpers: `isWarrior(card: CardData | undefined): boolean` and `isWeapon(card: CardData | undefined): boolean`.
- `app/goldfish/state/gameActions.ts` — add `attachCard(weaponId, warriorId)` and `detachCard(weaponId)` action creators.
- `app/goldfish/state/gameReducer.ts` — handle `ATTACH_CARD` and `DETACH_CARD`; amend `MOVE_CARD` and `MOVE_CARDS_BATCH` to auto-detach when the mover leaves Territory, and to drag-along attached weapons when a warrior is moved as a single `MOVE_CARD`.
- `app/goldfish/state/GameContext.tsx` — expose `attachCard` and `detachCard` on the context value.
- `app/goldfish/components/GoldfishCanvas.tsx` — (a) render-time: compute rendered position and z-order for attached weapons; (b) drag-time: inject attached weapons as followers in `handleCardDragStart`; (c) drop-time: in `handleCardDragEnd`, detect weapon-on-warrior hit and dispatch `ATTACH_CARD`; (d) overlay: render link icon at the seam for each attached pair.

**Create:**
- `app/goldfish/state/__tests__/gameReducer.equip.test.ts` — vitest suite covering attach/detach/auto-detach.
- `lib/cards/__tests__/classHelpers.test.ts` — vitest suite for `isWarrior` / `isWeapon`.
- `app/goldfish/utils/equipLayout.ts` — small pure module: `computeEquipOffset(cardWidth, cardHeight)`, `getAttachedWeapons(card, zoneCards)`, `hitTestWarrior(dropX, dropY, cardWidth, cardHeight, candidates)`. Pure functions are trivial to unit-test and keep `GoldfishCanvas.tsx` from growing more than necessary.
- `app/goldfish/utils/__tests__/equipLayout.test.ts` — vitest suite for the pure module.

---

## Task 1: Type and action surface

**Files:**
- Modify: `app/shared/types/gameCard.ts:57-124`

- [ ] **Step 1: Extend `GameCard` with the `equippedTo` field**

Edit `app/shared/types/gameCard.ts`, find the `GameCard` interface (starts at line 57), and add one field at the end, right before the closing brace on line 79. Do not reorder other fields.

```ts
export interface GameCard {
  instanceId: string;
  cardName: string;
  cardSet: string;
  cardImgFile: string;
  type: string;
  brigade: string;
  strength: string;
  toughness: string;
  specialAbility: string;
  identifier: string;
  reference: string;
  alignment: string;
  isMeek: boolean;
  counters: Counter[];
  isFlipped: boolean;
  isToken: boolean;
  zone: ZoneId;
  ownerId: 'player1' | 'player2';
  notes: string;
  posX?: number;
  posY?: number;
  /** Instance id of the warrior this card (a weapon) is attached to.
   *  Undefined when unattached. Cleared automatically by the reducer when
   *  either card leaves Territory. */
  equippedTo?: string;
}
```

- [ ] **Step 2: Extend `ActionType` with two new actions**

In the same file, find the `ActionType` union (starts line 81). Add `'ATTACH_CARD'` and `'DETACH_CARD'` at the end, before the closing semicolon.

```ts
export type ActionType =
  | 'MOVE_CARD'
  | 'DRAW_CARD'
  | 'DRAW_MULTIPLE'
  | 'SHUFFLE_DECK'
  | 'ADD_COUNTER'
  | 'REMOVE_COUNTER'
  | 'MEEK_CARD'
  | 'UNMEEK_CARD'
  | 'FLIP_CARD'
  | 'RESET_GAME'
  | 'START_GAME'
  | 'ADVANCE_PHASE'
  | 'REGRESS_PHASE'
  | 'END_TURN'
  | 'ADD_NOTE'
  | 'ADD_OPPONENT_LOST_SOUL'
  | 'REMOVE_OPPONENT_TOKEN'
  | 'SHUFFLE_AND_MOVE_TO_TOP'
  | 'SHUFFLE_AND_MOVE_TO_BOTTOM'
  | 'MOVE_CARDS_BATCH'
  | 'ADD_PLAYER_LOST_SOUL'
  | 'REORDER_HAND'
  | 'REORDER_LOB'
  | 'ATTACH_CARD'
  | 'DETACH_CARD';
```

- [ ] **Step 3: Extend `GameAction.payload` with `warriorInstanceId`**

In the same file, find the `GameAction` interface (starts line 106) and add `warriorInstanceId?: string` to the payload object. Put it right after `cardInstanceId`:

```ts
export interface GameAction {
  id: string;
  type: ActionType;
  playerId: 'player1' | 'player2';
  timestamp: number;
  payload: {
    cardInstanceId?: string;
    warriorInstanceId?: string;
    cardInstanceIds?: string[];
    fromZone?: ZoneId;
    toZone?: ZoneId;
    toIndex?: number;
    quantity?: number;
    value?: number | string;
    color?: CounterColorId;
    posX?: number;
    posY?: number;
    positions?: Record<string, { posX: number; posY: number }>;
  };
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors; the new field and actions are unused so far but shouldn't regress anything).

- [ ] **Step 5: Commit**

```bash
git add app/shared/types/gameCard.ts
git commit -m "feat(goldfish): extend game types with equippedTo field and attach/detach actions"
```

---

## Task 2: Card class helpers (`isWarrior` / `isWeapon`)

**Files:**
- Modify: `lib/cards/lookup.ts`
- Create: `lib/cards/__tests__/classHelpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/cards/__tests__/classHelpers.test.ts` with this content:

```ts
import { describe, it, expect } from 'vitest';
import type { CardData } from '../generated/cardData';
import { isWarrior, isWeapon } from '../lookup';

function makeCard(overrides: Partial<CardData> = {}): CardData {
  return {
    name: 'Test',
    set: 'T',
    imgFile: 'Test',
    officialSet: 'Test',
    type: 'Hero',
    brigade: 'White',
    strength: '',
    toughness: '',
    class: '',
    identifier: '',
    specialAbility: '',
    rarity: 'Common',
    reference: '',
    alignment: 'Good',
    legality: '',
    ...overrides,
  };
}

describe('isWarrior', () => {
  it('is true for plain Warrior class', () => {
    expect(isWarrior(makeCard({ class: 'Warrior' }))).toBe(true);
  });
  it('is true for compound classes containing Warrior', () => {
    expect(isWarrior(makeCard({ class: 'Warrior, Cloud' }))).toBe(true);
    expect(isWarrior(makeCard({ class: 'Territory, Warrior' }))).toBe(true);
    expect(isWarrior(makeCard({ class: 'Territory / Warrior' }))).toBe(true);
    expect(isWarrior(makeCard({ class: 'Territory/Warrior' }))).toBe(true);
    expect(isWarrior(makeCard({ class: 'Warrior, Weapon' }))).toBe(true);
  });
  it('is false when class is empty or unrelated', () => {
    expect(isWarrior(makeCard({ class: '' }))).toBe(false);
    expect(isWarrior(makeCard({ class: 'Cloud' }))).toBe(false);
    expect(isWarrior(makeCard({ class: 'Weapon' }))).toBe(false);
  });
  it('is false for undefined', () => {
    expect(isWarrior(undefined)).toBe(false);
  });
});

describe('isWeapon', () => {
  it('is true for plain Weapon class', () => {
    expect(isWeapon(makeCard({ class: 'Weapon' }))).toBe(true);
  });
  it('is true for compound classes containing Weapon', () => {
    expect(isWeapon(makeCard({ class: 'Weapon, Star' }))).toBe(true);
    expect(isWeapon(makeCard({ class: 'Warrior, Weapon' }))).toBe(true);
  });
  it('is false when class is empty or unrelated', () => {
    expect(isWeapon(makeCard({ class: '' }))).toBe(false);
    expect(isWeapon(makeCard({ class: 'Warrior' }))).toBe(false);
  });
  it('is false for undefined', () => {
    expect(isWeapon(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/cards/__tests__/classHelpers.test.ts`
Expected: FAIL — `isWarrior`/`isWeapon` are not exported from `lib/cards/lookup.ts`.

- [ ] **Step 3: Implement the helpers**

Edit `lib/cards/lookup.ts` and append to the end of the file (after the existing `findCard` function):

```ts
function classTokens(card: CardData | undefined): string[] {
  if (!card?.class) return [];
  // Class strings use ',', '/', or ' / ' as separators — split on any run of
  // commas, slashes, or whitespace, then lowercase for case-insensitive matching.
  return card.class
    .split(/[,\/\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export function isWarrior(card: CardData | undefined): boolean {
  return classTokens(card).includes('warrior');
}

export function isWeapon(card: CardData | undefined): boolean {
  return classTokens(card).includes('weapon');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/cards/__tests__/classHelpers.test.ts`
Expected: PASS — all cases in both describe blocks.

- [ ] **Step 5: Commit**

```bash
git add lib/cards/lookup.ts lib/cards/__tests__/classHelpers.test.ts
git commit -m "feat(cards): add isWarrior and isWeapon class helpers"
```

---

## Task 3: Reducer handlers for ATTACH_CARD and DETACH_CARD

**Files:**
- Modify: `app/goldfish/state/gameReducer.ts:479` (add two new cases before the `default` branch)
- Create: `app/goldfish/state/__tests__/gameReducer.equip.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/goldfish/state/__tests__/gameReducer.equip.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { gameReducer } from '../gameReducer';
import type { GameCard, GameState, GameAction, ZoneId } from '../../types';

function makeCard(overrides: Partial<GameCard>): GameCard {
  return {
    instanceId: 'x',
    cardName: 'X',
    cardSet: 'T',
    cardImgFile: 'X',
    type: 'Hero',
    brigade: '',
    strength: '',
    toughness: '',
    specialAbility: '',
    identifier: '',
    reference: '',
    alignment: '',
    isMeek: false,
    counters: [],
    isFlipped: false,
    isToken: false,
    zone: 'territory',
    ownerId: 'player1',
    notes: '',
    ...overrides,
  };
}

function makeState(cards: GameCard[]): GameState {
  const zones: GameState['zones'] = {
    deck: [], hand: [], reserve: [], discard: [], paragon: [],
    'land-of-bondage': [], territory: [], 'land-of-redemption': [], banish: [],
  };
  for (const c of cards) zones[c.zone].push(c);
  return {
    zones,
    history: [],
    turn: 1,
    phase: 'preparation',
    drawnThisTurn: false,
    deckName: 'Test',
    deckFormat: 'T1',
    options: { autoRouteLostSouls: false } as any,
    isSpreadHand: false,
  } as unknown as GameState;
}

function act(type: GameAction['type'], payload: GameAction['payload']): GameAction {
  return { id: 'a', type, playerId: 'player1', timestamp: 0, payload };
}

describe('ATTACH_CARD', () => {
  it('sets equippedTo on the weapon', () => {
    const weapon = makeCard({ instanceId: 'w1', posX: 100, posY: 100 });
    const warrior = makeCard({ instanceId: 'h1', posX: 200, posY: 200 });
    const next = gameReducer(makeState([weapon, warrior]), act('ATTACH_CARD', {
      cardInstanceId: 'w1', warriorInstanceId: 'h1',
    }));
    const out = next.zones.territory.find(c => c.instanceId === 'w1');
    expect(out?.equippedTo).toBe('h1');
  });

  it('is a no-op when warrior is missing', () => {
    const weapon = makeCard({ instanceId: 'w1' });
    const state = makeState([weapon]);
    const next = gameReducer(state, act('ATTACH_CARD', {
      cardInstanceId: 'w1', warriorInstanceId: 'missing',
    }));
    expect(next).toBe(state);
  });

  it('pushes history so the attach can be undone', () => {
    const weapon = makeCard({ instanceId: 'w1' });
    const warrior = makeCard({ instanceId: 'h1' });
    const next = gameReducer(makeState([weapon, warrior]), act('ATTACH_CARD', {
      cardInstanceId: 'w1', warriorInstanceId: 'h1',
    }));
    expect(next.history.length).toBe(1);
  });
});

describe('DETACH_CARD', () => {
  it('clears equippedTo', () => {
    const weapon = makeCard({ instanceId: 'w1', equippedTo: 'h1' });
    const next = gameReducer(makeState([weapon]), act('DETACH_CARD', { cardInstanceId: 'w1' }));
    const out = next.zones.territory.find(c => c.instanceId === 'w1');
    expect(out?.equippedTo).toBeUndefined();
  });
});

describe('auto-detach', () => {
  it('clears equippedTo on the weapon when the warrior leaves territory', () => {
    const weapon = makeCard({ instanceId: 'w1', equippedTo: 'h1' });
    const warrior = makeCard({ instanceId: 'h1' });
    const next = gameReducer(makeState([weapon, warrior]), act('MOVE_CARD', {
      cardInstanceId: 'h1', toZone: 'discard' as ZoneId,
    }));
    const outWeapon = next.zones.territory.find(c => c.instanceId === 'w1');
    expect(outWeapon?.equippedTo).toBeUndefined();
  });

  it('clears equippedTo on the weapon when the weapon itself leaves territory', () => {
    const weapon = makeCard({ instanceId: 'w1', equippedTo: 'h1' });
    const warrior = makeCard({ instanceId: 'h1' });
    const next = gameReducer(makeState([weapon, warrior]), act('MOVE_CARD', {
      cardInstanceId: 'w1', toZone: 'discard' as ZoneId,
    }));
    const outWeapon = next.zones.discard.find(c => c.instanceId === 'w1');
    expect(outWeapon?.equippedTo).toBeUndefined();
  });

  it('leaves equippedTo intact when a warrior is repositioned within territory', () => {
    const weapon = makeCard({ instanceId: 'w1', equippedTo: 'h1' });
    const warrior = makeCard({ instanceId: 'h1', posX: 100, posY: 100 });
    const next = gameReducer(makeState([weapon, warrior]), act('MOVE_CARD', {
      cardInstanceId: 'h1', toZone: 'territory', posX: 300, posY: 300,
    }));
    const outWeapon = next.zones.territory.find(c => c.instanceId === 'w1');
    expect(outWeapon?.equippedTo).toBe('h1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/goldfish/state/__tests__/gameReducer.equip.test.ts`
Expected: FAIL — attach/detach cases throw or return unmodified state because the reducer has no handlers for the new action types.

- [ ] **Step 3: Add ATTACH_CARD and DETACH_CARD cases to the reducer**

Edit `app/goldfish/state/gameReducer.ts`. Find the `default:` branch at line 479 inside the `switch (action.type)` block, and insert these two cases immediately before it:

```ts
    case 'ATTACH_CARD': {
      const { cardInstanceId, warriorInstanceId } = action.payload;
      if (!cardInstanceId || !warriorInstanceId) return state;
      // Validate warrior exists in territory
      const warrior = zones.territory.find(c => c.instanceId === warriorInstanceId);
      const weaponIdx = zones.territory.findIndex(c => c.instanceId === cardInstanceId);
      if (!warrior || weaponIdx === -1) return state;
      zones.territory[weaponIdx] = { ...zones.territory[weaponIdx], equippedTo: warriorInstanceId };
      return { ...state, zones, history };
    }

    case 'DETACH_CARD': {
      const { cardInstanceId } = action.payload;
      if (!cardInstanceId) return state;
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        const idx = zones[zoneId].findIndex(c => c.instanceId === cardInstanceId);
        if (idx >= 0) {
          zones[zoneId][idx] = { ...zones[zoneId][idx], equippedTo: undefined };
          return { ...state, zones, history };
        }
      }
      return state;
    }
```

- [ ] **Step 4: Add auto-detach to `MOVE_CARD`**

Still in `app/goldfish/state/gameReducer.ts`, find the `MOVE_CARD` case (starts line 82). Immediately after the existing body — specifically after the block that assigns `result.card.zone = toZone` and positions the card, but **before** `return { ...state, zones, history };` — insert the auto-detach logic. The easiest way is to replace the whole `MOVE_CARD` case body with this:

```ts
    case 'MOVE_CARD': {
      const { cardInstanceId, toZone, toIndex, posX, posY } = action.payload;
      if (!cardInstanceId || !toZone) return state;

      const result = findAndRemoveCard(zones, cardInstanceId);
      if (!result) return state;

      // Tokens dropped into reserve/banish/discard/hand/deck are removed entirely
      const TOKEN_REMOVE_ZONES: ZoneId[] = ['reserve', 'banish', 'discard', 'hand', 'deck'];
      if (result.card.isToken && TOKEN_REMOVE_ZONES.includes(toZone)) {
        return { ...state, zones, history };
      }

      // Flip face-up only when the card is actually leaving the deck
      if (result.fromZone === 'deck' && toZone !== 'deck') {
        result.card.isFlipped = false;
      }
      result.card.zone = toZone;
      // Store free-form position for territory only (LOB is auto-arranged)
      const FREE_FORM_ZONES: ZoneId[] = ['territory'];
      if (FREE_FORM_ZONES.includes(toZone) && posX !== undefined && posY !== undefined) {
        result.card.posX = posX;
        result.card.posY = posY;
      } else {
        result.card.posX = undefined;
        result.card.posY = undefined;
      }
      // Auto-detach: if the mover is a weapon leaving territory, clear its equippedTo.
      // If the mover is a warrior leaving territory, clear equippedTo on every weapon
      // that pointed at it.
      if (toZone !== 'territory') {
        if (result.card.equippedTo) {
          result.card.equippedTo = undefined;
        }
        for (const zoneId of Object.keys(zones) as ZoneId[]) {
          for (let i = 0; i < zones[zoneId].length; i++) {
            if (zones[zoneId][i].equippedTo === cardInstanceId) {
              zones[zoneId][i] = { ...zones[zoneId][i], equippedTo: undefined };
            }
          }
        }
      }
      if (toIndex !== undefined && toIndex >= 0) {
        zones[toZone].splice(toIndex, 0, result.card);
      } else {
        zones[toZone].push(result.card);
      }

      return { ...state, zones, history };
    }
```

- [ ] **Step 5: Add auto-detach to `MOVE_CARDS_BATCH`**

Still in `app/goldfish/state/gameReducer.ts`, find the `MOVE_CARDS_BATCH` case (starts line 339). Replace the case body with:

```ts
    case 'MOVE_CARDS_BATCH': {
      const { cardInstanceIds, toZone, positions } = action.payload;
      if (!cardInstanceIds || !toZone) return state;

      const movedIds = new Set(cardInstanceIds);
      for (const instanceId of cardInstanceIds) {
        const result = findAndRemoveCard(zones, instanceId);
        if (!result) continue;
        if (result.fromZone === 'deck' && toZone !== 'deck') {
          result.card.isFlipped = false;
        }
        result.card.zone = toZone;
        const pos = positions?.[instanceId];
        result.card.posX = pos?.posX;
        result.card.posY = pos?.posY;
        // Auto-detach on exit from territory, unless the partner is also moving
        // together — e.g. dragging a warrior + its attached weapon as a group.
        if (toZone !== 'territory') {
          if (result.card.equippedTo && !movedIds.has(result.card.equippedTo)) {
            result.card.equippedTo = undefined;
          }
          for (const zoneId of Object.keys(zones) as ZoneId[]) {
            for (let i = 0; i < zones[zoneId].length; i++) {
              if (
                zones[zoneId][i].equippedTo === instanceId &&
                !movedIds.has(zones[zoneId][i].instanceId)
              ) {
                zones[zoneId][i] = { ...zones[zoneId][i], equippedTo: undefined };
              }
            }
          }
        }
        zones[toZone].push(result.card);
      }
      return { ...state, zones, history };
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run app/goldfish/state/__tests__/gameReducer.equip.test.ts`
Expected: PASS — all cases in `ATTACH_CARD`, `DETACH_CARD`, and `auto-detach`.

- [ ] **Step 7: Run the existing test suite to verify nothing regressed**

Run: `npx vitest run`
Expected: PASS — all pre-existing tests still green.

- [ ] **Step 8: Commit**

```bash
git add app/goldfish/state/gameReducer.ts app/goldfish/state/__tests__/gameReducer.equip.test.ts
git commit -m "feat(goldfish): ATTACH_CARD/DETACH_CARD reducer cases with auto-detach"
```

---

## Task 4: Action creators and context exposure

**Files:**
- Modify: `app/goldfish/state/gameActions.ts`
- Modify: `app/goldfish/state/GameContext.tsx`

- [ ] **Step 1: Add action creators**

Edit `app/goldfish/state/gameActions.ts`. Inside the `actions` object, after `reorderLob` (line 102–104), add:

```ts
  attachCard(cardInstanceId: string, warriorInstanceId: string): GameAction {
    return createAction('ATTACH_CARD', { cardInstanceId, warriorInstanceId });
  },

  detachCard(cardInstanceId: string): GameAction {
    return createAction('DETACH_CARD', { cardInstanceId });
  },
```

- [ ] **Step 2: Expose on the context**

Edit `app/goldfish/state/GameContext.tsx`. In the `GameContextValue` interface (line 10–38), add two lines after `reorderLob`:

```ts
  attachCard: (cardInstanceId: string, warriorInstanceId: string) => void;
  detachCard: (cardInstanceId: string) => void;
```

Then inside `GameProvider`, after the existing `reorderLob` useCallback (line 140–143), add:

```ts
  const attachCard = useCallback(
    (cardInstanceId: string, warriorInstanceId: string) =>
      dispatch(actions.attachCard(cardInstanceId, warriorInstanceId)),
    [dispatch]
  );
  const detachCard = useCallback(
    (cardInstanceId: string) => dispatch(actions.detachCard(cardInstanceId)),
    [dispatch]
  );
```

Then add `attachCard` and `detachCard` to the object passed into `useMemo` (line 157–194) and to the dependency array of that `useMemo`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/goldfish/state/gameActions.ts app/goldfish/state/GameContext.tsx
git commit -m "feat(goldfish): attachCard/detachCard action creators and context methods"
```

---

## Task 5: Pure equip-layout utility module

**Files:**
- Create: `app/goldfish/utils/equipLayout.ts`
- Create: `app/goldfish/utils/__tests__/equipLayout.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/goldfish/utils/__tests__/equipLayout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { GameCard } from '../../types';
import {
  EQUIP_OFFSET_RATIO,
  computeEquipOffset,
  getAttachedWeapons,
  hitTestWarrior,
} from '../equipLayout';

function card(partial: Partial<GameCard> & { instanceId: string }): GameCard {
  return {
    cardName: 'C', cardSet: 'T', cardImgFile: 'C',
    type: '', brigade: '', strength: '', toughness: '', specialAbility: '',
    identifier: '', reference: '', alignment: '',
    isMeek: false, counters: [], isFlipped: false, isToken: false,
    zone: 'territory', ownerId: 'player1', notes: '',
    ...partial,
  };
}

describe('computeEquipOffset', () => {
  it('returns OFFSET_RATIO * dimension for both axes', () => {
    const { dx, dy } = computeEquipOffset(100, 140);
    expect(dx).toBeCloseTo(-100 * EQUIP_OFFSET_RATIO);
    expect(dy).toBeCloseTo(-140 * EQUIP_OFFSET_RATIO);
  });
});

describe('getAttachedWeapons', () => {
  it('returns weapons pointing at the given warrior, in order of appearance', () => {
    const warrior = card({ instanceId: 'h1' });
    const w1 = card({ instanceId: 'w1', equippedTo: 'h1' });
    const w2 = card({ instanceId: 'w2', equippedTo: 'h1' });
    const other = card({ instanceId: 'w3', equippedTo: 'h2' });
    const weapons = getAttachedWeapons(warrior, [warrior, w1, other, w2]);
    expect(weapons.map(w => w.instanceId)).toEqual(['w1', 'w2']);
  });

  it('returns an empty array when nothing is attached', () => {
    const warrior = card({ instanceId: 'h1' });
    expect(getAttachedWeapons(warrior, [warrior])).toEqual([]);
  });
});

describe('hitTestWarrior', () => {
  const candidates = [
    card({ instanceId: 'h1', posX: 100, posY: 100 }),
    card({ instanceId: 'h2', posX: 400, posY: 400 }),
  ];

  it('returns the warrior whose rect contains (dropX, dropY)', () => {
    const result = hitTestWarrior(150, 150, 100, 140, candidates, 'skipme');
    expect(result?.instanceId).toBe('h1');
  });

  it('returns null when the point hits no warrior', () => {
    expect(hitTestWarrior(0, 0, 100, 140, candidates, 'skipme')).toBeNull();
  });

  it('excludes the skipInstanceId (the card being dragged)', () => {
    const self = card({ instanceId: 'self', posX: 100, posY: 100 });
    const result = hitTestWarrior(150, 150, 100, 140, [self, ...candidates], 'self');
    expect(result?.instanceId).toBe('h1');
  });

  it('ignores candidates without posX/posY (not yet placed)', () => {
    const ghost = card({ instanceId: 'h3' });
    expect(hitTestWarrior(150, 150, 100, 140, [ghost], 'skipme')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/goldfish/utils/__tests__/equipLayout.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `app/goldfish/utils/equipLayout.ts`:

```ts
import type { GameCard } from '../types';

/** Fraction of the card's width/height used as the visual offset between a
 *  warrior and its attached weapon. Weapon sits up-and-left of the warrior. */
export const EQUIP_OFFSET_RATIO = 0.18;

/** Safety cap on how many weapons can be attached to a single warrior. */
export const MAX_EQUIPPED_WEAPONS_PER_WARRIOR = 3;

export function computeEquipOffset(
  cardWidth: number,
  cardHeight: number,
): { dx: number; dy: number } {
  return {
    dx: -cardWidth * EQUIP_OFFSET_RATIO,
    dy: -cardHeight * EQUIP_OFFSET_RATIO,
  };
}

export function getAttachedWeapons(
  warrior: Pick<GameCard, 'instanceId'>,
  zoneCards: GameCard[],
): GameCard[] {
  return zoneCards.filter((c) => c.equippedTo === warrior.instanceId);
}

/** Return the first card in `candidates` whose rect contains (dropX, dropY),
 *  skipping the card with `skipInstanceId` (usually the card being dragged).
 *  Candidates without posX/posY are treated as unplaced and ignored. */
export function hitTestWarrior(
  dropX: number,
  dropY: number,
  cardWidth: number,
  cardHeight: number,
  candidates: GameCard[],
  skipInstanceId: string,
): GameCard | null {
  for (const c of candidates) {
    if (c.instanceId === skipInstanceId) continue;
    if (c.posX === undefined || c.posY === undefined) continue;
    const left = c.posX;
    const right = c.posX + cardWidth;
    const top = c.posY;
    const bottom = c.posY + cardHeight;
    if (dropX >= left && dropX <= right && dropY >= top && dropY <= bottom) {
      return c;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/goldfish/utils/__tests__/equipLayout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/goldfish/utils/equipLayout.ts app/goldfish/utils/__tests__/equipLayout.test.ts
git commit -m "feat(goldfish): equip layout utility (offset, attached-weapon lookup, hit test)"
```

---

## Task 6: Canvas — render attached weapons at warrior-relative position

**Files:**
- Modify: `app/goldfish/components/GoldfishCanvas.tsx`

This task only touches the territory-zone render pass. Pairing data flows from the `territory` array: for each card, if `equippedTo` is set AND the target warrior exists in territory, position it at the warrior's position + the equip offset. Draw weapons FIRST (before warriors) so the warrior's Group covers the weapon.

- [ ] **Step 1: Find the territory-render block**

In `app/goldfish/components/GoldfishCanvas.tsx`, search for the block that renders `state.zones.territory`. It is the block around lines 1520–1560 that ends in one of the `GameCardNode` elements with `onDragStart={handleCardDragStart}` etc. (Task 7 exploration confirmed there are multiple zone renders; the territory one is the last free-form loop.)

Run: `grep -n "state.zones.territory" /Users/timestes/projects/redemption-tournament-tracker/app/goldfish/components/GoldfishCanvas.tsx`
Expected: several references; find the one inside a `.map(...)` that renders `<GameCardNode>`. That is the render target.

- [ ] **Step 2: Add render-position derivation**

Import `getAttachedWeapons`, `computeEquipOffset` from the new utility at the top of the file:

```ts
import { computeEquipOffset, getAttachedWeapons } from '../utils/equipLayout';
```

Inside the component body (before the JSX return), compute two helper maps once per render:

```ts
// Map weapon instanceId → { posX, posY } derived from the warrior it's attached to.
// Weapons render at warrior.posX + offset. Only applies in Territory.
const derivedWeaponPositions = useMemo(() => {
  const { dx, dy } = computeEquipOffset(cardWidth, cardHeight);
  const result = new Map<string, { x: number; y: number }>();
  for (const card of state.zones.territory) {
    if (!card.equippedTo) continue;
    const warrior = state.zones.territory.find(c => c.instanceId === card.equippedTo);
    if (!warrior || warrior.posX === undefined || warrior.posY === undefined) continue;
    result.set(card.instanceId, {
      x: warrior.posX + dx,
      y: warrior.posY + dy,
    });
  }
  return result;
}, [state.zones.territory, cardWidth, cardHeight]);
```

- [ ] **Step 3: Split the territory render into two passes**

Replace the single `.map` that renders territory cards with two sequential maps: first weapons (attached), then non-weapons. Because Konva draws in array order, later elements appear on top — this puts the warrior visually in front.

```tsx
{/* Weapons first (drawn behind) */}
{state.zones.territory.filter(c => c.equippedTo).map(card => {
  const derived = derivedWeaponPositions.get(card.instanceId);
  if (!derived) return null;
  return (
    <GameCardNode
      key={card.instanceId}
      card={card}
      x={derived.x}
      y={derived.y}
      rotation={0}
      cardWidth={cardWidth}
      cardHeight={cardHeight}
      image={imageCacheRef.current.get(card.cardImgFile)}
      isSelected={selectedIds.has(card.instanceId)}
      nodeRef={setCardNodeRef}
      onDragStart={handleCardDragStart}
      onDragMove={handleCardDragMove}
      onDragEnd={handleCardDragEnd}
      onContextMenu={handleCardContextMenu}
      onClick={handleCardClick}
      onDblClick={handleCardDblClick}
      onMouseEnter={handleCardMouseEnter}
      onMouseLeave={handleCardMouseLeave}
      hoverProgress={hoverProgress.get(card.instanceId)}
    />
  );
})}
{/* Non-attached / warriors second (drawn in front) */}
{state.zones.territory.filter(c => !c.equippedTo).map(card => {
  // [existing render logic, using card.posX / card.posY]
  return (
    <GameCardNode
      key={card.instanceId}
      card={card}
      x={card.posX ?? 0}
      y={card.posY ?? 0}
      rotation={0}
      cardWidth={cardWidth}
      cardHeight={cardHeight}
      image={imageCacheRef.current.get(card.cardImgFile)}
      isSelected={selectedIds.has(card.instanceId)}
      nodeRef={setCardNodeRef}
      onDragStart={handleCardDragStart}
      onDragMove={handleCardDragMove}
      onDragEnd={handleCardDragEnd}
      onContextMenu={handleCardContextMenu}
      onClick={handleCardClick}
      onDblClick={handleCardDblClick}
      onMouseEnter={handleCardMouseEnter}
      onMouseLeave={handleCardMouseLeave}
      hoverProgress={hoverProgress.get(card.instanceId)}
    />
  );
})}
```

**Important:** preserve whatever props the existing territory-map uses (e.g. `lobArrivalGlow`, `isDraggable`, `hoverProgress`). When executing this task, first read the existing territory-render block and copy its prop set verbatim into both halves — don't drop any props. Only `x`/`y` differ between the two passes.

- [ ] **Step 4: Run dev server and eyeball the UI**

Run: `npm run dev` (user's preference is not to run `next build` after each change — just the dev server for manual checks).

Create an attach manually by editing state in the React DevTools or by pre-seeding the reducer — set `equippedTo` on one weapon in territory to point at a warrior there. Verify:
- Weapon renders up-and-left of warrior, visually overlapping.
- Warrior is on top (covers weapon).
- No crashes; no React warnings in console.

- [ ] **Step 5: Commit**

```bash
git add app/goldfish/components/GoldfishCanvas.tsx
git commit -m "feat(goldfish): render attached weapons at warrior-relative position, behind warrior"
```

---

## Task 7: Canvas — attach on drop (weapon dropped on warrior)

**Files:**
- Modify: `app/goldfish/components/GoldfishCanvas.tsx`
- Modify: `app/goldfish/state/GameContext.tsx` (already done in Task 4 — verify the hook is available)

This task extends `handleCardDragEnd` so that dropping a **weapon** card whose center lies inside a **warrior** card's rect (in territory) dispatches `ATTACH_CARD` instead of the normal `MOVE_CARD` / `moveCardsBatch` path.

- [ ] **Step 1: Import helpers**

At the top of `GoldfishCanvas.tsx`:

```ts
import { findCard, isWarrior, isWeapon } from '@/lib/cards/lookup';
import { hitTestWarrior, MAX_EQUIPPED_WEAPONS_PER_WARRIOR } from '../utils/equipLayout';
```

Pull `attachCard` off the game context where the other actions are destructured:

```ts
const { /* existing */, attachCard } = useGame();
```

- [ ] **Step 2: Insert attach-check at the start of the drop handler**

Find `handleCardDragEnd` (starts line 523). Right after the cleanup block (after `setCanvasDragZone(null)`, line 533, and after the follower-visibility restore around line 547) — and BEFORE the block that begins `const node = e.target;` — insert:

```ts
// Equip: if a weapon is dropped on top of a warrior in territory, attach.
// Runs only for single-card drags (group drags are intentional batch moves).
const isGroupDragForEquip = selectedIds.has(card.instanceId) && selectedIds.size > 1;
if (!isGroupDragForEquip) {
  const cardMeta = findCard(card.cardName, card.cardSet, card.cardImgFile);
  if (isWeapon(cardMeta)) {
    const dropNode = e.target;
    const dropCenterX = dropNode.x() + cardWidth / 2;
    const dropCenterY = dropNode.y() + cardHeight / 2;
    const targetZoneForEquip = findZoneAtPosition(dropCenterX, dropCenterY);
    if (targetZoneForEquip === 'territory') {
      // Candidates: territory cards that are themselves warriors, not already
      // over-equipped, and not the card being dragged.
      const warriorCandidates = state.zones.territory.filter(c => {
        if (c.instanceId === card.instanceId) return false;
        if (c.equippedTo) return false; // a weapon attached to someone else isn't a valid target
        const meta = findCard(c.cardName, c.cardSet, c.cardImgFile);
        if (!isWarrior(meta)) return false;
        const attached = state.zones.territory.filter(x => x.equippedTo === c.instanceId);
        return attached.length < MAX_EQUIPPED_WEAPONS_PER_WARRIOR;
      });
      const hit = hitTestWarrior(
        dropCenterX, dropCenterY, cardWidth, cardHeight, warriorCandidates, card.instanceId,
      );
      if (hit) {
        // Consume the drop: attach instead of move.
        attachCard(card.instanceId, hit.instanceId);
        // Reset dragging flags — the main body of the handler assumes a drop
        // that continues into MOVE_CARD, so early-return here.
        isDraggingRef.current = false;
        isCanvasDragging.current = false;
        canvasDragZoneRef.current = null;
        dragSourceZoneRef.current = null;
        dragFollowerOffsets.current = null;
        dragGhostOffsetRef.current = null;
        setCanvasDragZone(null);
        return;
      }
    }
  }
}
```

Note: the existing drop handler already runs the reset block. This inserted block duplicates a few resets in the early-return path to keep state clean. Do not delete the original reset block.

- [ ] **Step 3: Manual sanity check in dev server**

Run: `npm run dev`. In a goldfish session, put a warrior in territory and drag a weapon (from hand, say) onto it. Verify:
- Weapon snaps into attached position (renders offset up-and-left, behind warrior).
- Dragging the weapon off to an empty territory spot behaves as a normal move (no attach).
- Dropping the weapon on an already-attached warrior stacks up to 3 weapons; the 4th drop falls through to a normal move.

- [ ] **Step 4: Commit**

```bash
git add app/goldfish/components/GoldfishCanvas.tsx
git commit -m "feat(goldfish): attach weapon to warrior on drop over warrior rect"
```

---

## Task 8: Canvas — warrior drag carries its attached weapons

**Files:**
- Modify: `app/goldfish/components/GoldfishCanvas.tsx`

When a warrior with attached weapons is dragged (alone, not part of a multi-select), the attached weapons must move with it. Reuse the existing `dragFollowerOffsets` + rasterized ghost mechanism that already handles multi-select group drag.

- [ ] **Step 1: Extend `handleCardDragStart` to include attached weapons as followers**

In `app/goldfish/components/GoldfishCanvas.tsx`, find `handleCardDragStart` (starts line 373). The existing logic at line 386 activates group-drag only when `selectedIds.has(card.instanceId) && selectedIds.size > 1`. Rewrite the top of the function so it also activates for a warrior-with-weapons case:

```ts
const handleCardDragStart = useCallback((card: GameCard) => {
  isDraggingRef.current = true;
  isCanvasDragging.current = true;
  dragSourceZoneRef.current = card.zone;
  if (hoverTimerRef.current) {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }
  setHoverCard(null);
  setHoveredInstanceId(null);
  stopHoverAnimation();

  // Determine the follower set:
  //   - multi-select: every other selected card
  //   - otherwise: if this card is a warrior with attached weapons in territory,
  //     those weapons are followers
  const multiSelectFollowerIds: string[] = (selectedIds.has(card.instanceId) && selectedIds.size > 1)
    ? Array.from(selectedIds).filter(id => id !== card.instanceId)
    : [];
  const equipFollowerIds: string[] = card.zone === 'territory'
    ? state.zones.territory.filter(c => c.equippedTo === card.instanceId).map(c => c.instanceId)
    : [];
  const followerIds = multiSelectFollowerIds.length > 0
    ? multiSelectFollowerIds
    : equipFollowerIds;

  if (followerIds.length > 0) {
    const dragNode = cardNodeRefs.current.get(card.instanceId);
    if (dragNode) {
      const offsets = new Map<string, { dx: number; dy: number }>();
      const baseX = dragNode.x();
      const baseY = dragNode.y();
      const followers: { id: string; node: Konva.Group; dx: number; dy: number }[] = [];
      for (const id of followerIds) {
        const node = cardNodeRefs.current.get(id);
        if (node) {
          const dx = node.x() - baseX;
          const dy = node.y() - baseY;
          offsets.set(id, { dx, dy });
          followers.push({ id, node, dx, dy });
        }
      }
      dragFollowerOffsets.current = offsets;
      // [existing ghost rasterization block below — do not touch]
      // ... (the existing code from the current function that builds offscreen
      //      canvas, rasterizes followers, adds to dragGhostLayerRef, hides
      //      real nodes) ...
    }
  } else {
    dragFollowerOffsets.current = null;
  }
}, [selectedIds, state.zones.territory, cardWidth, cardHeight, scale, offsetX, offsetY]);
```

Preserve the existing rasterize + ghost block verbatim from line 408 onwards — only the top selection logic changes.

Add `state.zones.territory` to the dependency array as shown above.

- [ ] **Step 2: Extend `handleCardDragEnd` to batch-move the warrior + weapons**

Find the existing `else if (targetZone && (targetZone !== card.zone || targetZone === 'territory'))` block (line 615 in the current file). The existing code already checks `isGroupDrag` (multi-select case) and calls `moveCardsBatch`. Adjust it so that `isGroupDrag` is also true when attached weapons followed the warrior drag. Rewrite the `isGroupDrag` line (line 557) and the subsequent body:

```ts
const multiSelectFollowerIds = selectedIds.has(card.instanceId) && selectedIds.size > 1
  ? Array.from(selectedIds)
  : null;
const equipFollowerIds = card.zone === 'territory'
  ? state.zones.territory
      .filter(c => c.equippedTo === card.instanceId)
      .map(c => c.instanceId)
  : [];
const isGroupDrag = multiSelectFollowerIds !== null || equipFollowerIds.length > 0;
const cardIds = multiSelectFollowerIds ?? [card.instanceId, ...equipFollowerIds];
```

Leave the rest of the block (deck drop, hand reorder, LOB, target-zone branch) intact. The existing `moveCardsBatch(cardIds, targetZone, positions)` call will now include the attached weapons.

- [ ] **Step 3: Manual check**

Run: `npm run dev`. With a weapon attached to a warrior in territory:
- Drag the warrior around territory → weapon stays docked at the offset.
- Drag the warrior to discard → weapon auto-detaches and stays in territory (auto-detach from Task 3).
- Drag the weapon itself → the single weapon moves; if dropped back on the warrior, stays attached.

- [ ] **Step 4: Commit**

```bash
git add app/goldfish/components/GoldfishCanvas.tsx
git commit -m "feat(goldfish): dragging a warrior carries its attached weapons"
```

---

## Task 9: Link-icon detach affordance

**Files:**
- Modify: `app/goldfish/components/GoldfishCanvas.tsx`

Render a small unlock-icon button at the seam of each attached pair. Click → dispatch `DETACH_CARD`. Use an HTML overlay positioned absolutely over the canvas (not a Konva node) so the hit target is easy to style and is pointer-event-friendly on touch.

- [ ] **Step 1: Add the icon component**

Still in `GoldfishCanvas.tsx`, find the outer JSX return (the one that renders the `<Stage>`). Immediately **after** the closing `</Stage>` tag, add a sibling overlay div containing one button per attached pair:

```tsx
{/* Equip link/detach icons — one per attached weapon, anchored at the seam */}
<div
  className="pointer-events-none absolute inset-0 z-10"
  aria-hidden="false"
>
  {state.zones.territory
    .filter(c => c.equippedTo)
    .map(weapon => {
      const warrior = state.zones.territory.find(c => c.instanceId === weapon.equippedTo);
      if (!warrior || warrior.posX === undefined || warrior.posY === undefined) return null;
      // Seam is at the warrior's top-left corner, converted from virtual to
      // screen coordinates. Place the button centered on that point.
      const seam = virtualToScreen(warrior.posX, warrior.posY, scale, offsetX, offsetY);
      return (
        <button
          key={weapon.instanceId}
          type="button"
          onClick={() => detachCard(weapon.instanceId)}
          className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1a1510] p-1.5 text-[#c4955a] shadow-md ring-1 ring-[#c4955a]/40 transition hover:bg-[#2a1f14] hover:ring-[#c4955a]"
          style={{ left: `${seam.x}px`, top: `${seam.y}px` }}
          title="Unequip"
          aria-label={`Unequip ${weapon.cardName} from ${warrior.cardName}`}
        >
          <Link2Off size={14} strokeWidth={2} />
        </button>
      );
    })}
</div>
```

- [ ] **Step 2: Import icon and destructure detach**

At the top of `GoldfishCanvas.tsx`, add to the existing `lucide-react` import:

```ts
import { Link2Off } from 'lucide-react';
```

Pull `detachCard` off the context:

```ts
const { /* existing */, detachCard } = useGame();
```

Ensure the parent wrapper around the Konva Stage has `position: relative` so the absolute-positioned overlay aligns with it. Check the existing root wrapper — if it lacks `relative`, add the `relative` class.

- [ ] **Step 3: Manual check**

Run: `npm run dev`. With a weapon attached:
- A small dark round button with an unlink icon is visible at the warrior's top-left corner (the seam).
- Click it → weapon detaches, icon disappears, weapon stays in place (keeps its derived position, but on next render has no `equippedTo`, so it now uses `card.posX/posY`; if those were unset, it appears at `(0, 0)`.)

**Edge case fix:** on detach, set the weapon's `posX/posY` to its currently-rendered (derived) position so it doesn't snap to origin. The reducer has no access to `cardWidth` or the canvas scale, so bake the coords at the call site (the icon click handler) and pass them on the action.

Extend the action creator and payload in `app/goldfish/state/gameActions.ts`, replace `detachCard` with:

```ts
  detachCard(cardInstanceId: string, posX?: number, posY?: number): GameAction {
    return createAction('DETACH_CARD', { cardInstanceId, posX, posY });
  },
```

In `app/goldfish/state/GameContext.tsx`, update the context type and implementation:

```ts
detachCard: (cardInstanceId: string, posX?: number, posY?: number) => void;
```

```ts
const detachCard = useCallback(
  (cardInstanceId: string, posX?: number, posY?: number) =>
    dispatch(actions.detachCard(cardInstanceId, posX, posY)),
  [dispatch]
);
```

Update the reducer DETACH_CARD case from Task 3 to consume the new `posX`/`posY` fields:

```ts
    case 'DETACH_CARD': {
      const { cardInstanceId, posX, posY } = action.payload;
      if (!cardInstanceId) return state;
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        const idx = zones[zoneId].findIndex(c => c.instanceId === cardInstanceId);
        if (idx >= 0) {
          zones[zoneId][idx] = {
            ...zones[zoneId][idx],
            equippedTo: undefined,
            posX: posX ?? zones[zoneId][idx].posX,
            posY: posY ?? zones[zoneId][idx].posY,
          };
          return { ...state, zones, history };
        }
      }
      return state;
    }
```

In the link-icon button's `onClick`, pass the derived position explicitly:

```tsx
onClick={() => {
  const derived = derivedWeaponPositions.get(weapon.instanceId);
  detachCard(weapon.instanceId, derived?.x, derived?.y);
}}
```

- [ ] **Step 4: Re-run reducer tests — they must still pass**

The test `'clears equippedTo'` in Task 3 still calls `DETACH_CARD` without `posX/posY`. Because the new reducer uses `posX ?? zones[zoneId][idx].posX`, the test remains valid.

Run: `npx vitest run app/goldfish/state/__tests__/gameReducer.equip.test.ts`
Expected: PASS.

- [ ] **Step 5: Manual check**

Run: `npm run dev`. Attach a weapon, drag the warrior somewhere, then click the unlink icon. The weapon should now be sitting approximately where it was while attached (at the seam of where it visually was), not snapped to origin.

- [ ] **Step 6: Commit**

```bash
git add app/goldfish/components/GoldfishCanvas.tsx app/goldfish/state/gameReducer.ts app/goldfish/state/gameActions.ts app/goldfish/state/GameContext.tsx
git commit -m "feat(goldfish): link-icon detach button at attach seam"
```

---

## Task 10: Context-menu detach fallback

**Files:**
- Modify: the context-menu component that renders right-click actions on a territory card.

The repo has a context-menu abstraction for cards; at the time of plan-writing the file `app/shared/components/CardContextMenu.tsx` was not verified to exist. Before starting this task, confirm the file:

Run: `find /Users/timestes/projects/redemption-tournament-tracker/app -name "CardContextMenu*" -type f`

If the file is `app/shared/components/CardContextMenu.tsx`, proceed below. If the menu lives elsewhere (or is inlined in `GoldfishCanvas.tsx`), adapt the path but keep the same behavior: show an "Unequip" entry when `card.equippedTo` is set.

- [ ] **Step 1: Read the existing menu component to learn its prop shape**

Read the file and locate where it renders its list of actions.

- [ ] **Step 2: Add an "Unequip" menu entry**

Inside the action list, conditionally render an entry when `card.equippedTo`:

```tsx
{card.equippedTo && (
  <button
    type="button"
    className="[existing menu-item class]"
    onClick={() => {
      onDetach(card.instanceId);
      onClose();
    }}
  >
    <Link2Off size={14} className="mr-2" />
    Unequip
  </button>
)}
```

Add an `onDetach` prop to the menu's prop interface and thread it down from the parent (`GoldfishCanvas.tsx`), wiring to the `detachCard` hook.

- [ ] **Step 3: Manual check**

Run: `npm run dev`. Right-click an attached weapon; "Unequip" should appear in the menu. Right-click an unattached weapon; it should NOT appear.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(goldfish): context-menu unequip entry as link-icon fallback"
```

---

## Task 11: End-to-end manual smoke test

- [ ] **Step 1: Run the dev server**

Run: `npm run dev`

- [ ] **Step 2: Play through the golden path**

In a goldfish session with a deck containing at least one warrior and one weapon:

1. Draw both cards into hand.
2. Drag the warrior into territory — it sits at an arbitrary position.
3. Drag the weapon onto the warrior (drop with center inside warrior's rect). Expect: weapon disappears from its drop point, reappears at warrior top-left, partly covered.
4. Drag the warrior to a new spot. Expect: weapon moves with it, stays at offset, stays behind warrior.
5. Click the unlink icon at the seam. Expect: weapon remains where it was visually, icon disappears, can now be dragged independently.
6. Re-attach (drag weapon back onto warrior). Attach icon reappears.
7. Drag warrior to discard. Expect: weapon stays in territory, loses attachment (no icon), remains at its derived position.
8. Attach again, then drag the weapon to banish. Expect: weapon auto-detaches, warrior remains.
9. Attach two weapons to one warrior. Drop a third — still attaches (cap = 3). Drop a fourth — falls through as a normal move.
10. Press Undo (toolbar or keyboard shortcut). Expect: last attach/detach reverses.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: ALL green.

- [ ] **Step 4: Commit any follow-up tweaks**

If the manual pass surfaced small visual adjustments (offset ratio, icon size/placement), tweak and commit:

```bash
git add .
git commit -m "fix(goldfish): equip feature visual polish"
```

---

## Notes for the executing agent

- **Konva draw order:** cards appear on the stage in the order they are mounted in the parent `<Layer>`. The two-pass territory render in Task 6 relies on this — do not re-sort cards into `zones.territory` order somewhere downstream.
- **Konva refs:** each `GameCardNode` registers itself via `nodeRef` → `cardNodeRefs.current.set(instanceId, groupNode)`. When changing the render pass in Task 6, keep this registration intact (it's already done by the component).
- **Undo:** every action pushes history automatically via `pushHistory` in the reducer. `ATTACH_CARD` and `DETACH_CARD` inherit this.
- **Class string edge case:** a card with class `Warrior, Weapon` (e.g. certain Paragons) matches BOTH `isWarrior` and `isWeapon`. For equip purposes this means it can be the target of an attach (as a warrior) AND be attached to another warrior (as a weapon). This is uncommon and acceptable — no special-casing needed.
- **Do not touch:** `spacetimedb/`, `app/play/`, `app/shared/components/GameCardNode.tsx` (the component is used by both goldfish and multiplayer — changing its drag signature would break the multiplayer canvas). Everything in this plan happens in goldfish-only files.
- **User preferences from prior conversations:** skip full `next build` runs between tasks; trust small edits. Test runs (`npx vitest run`) are still expected at the steps that specify them.
