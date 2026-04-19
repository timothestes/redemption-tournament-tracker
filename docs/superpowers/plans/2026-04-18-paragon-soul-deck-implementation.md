# Paragon Soul Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 21-card shared Paragon Soul Deck — a format-owned deck that refills a shared Land of Bondage to 3 soul-deck-origin souls at turn start and on rescue. Works in both goldfish and multiplayer.

**Architecture:** Shared-owner sentinel approach. Widen the ownership model to include `'shared'` (goldfish) / `0n` (SpacetimeDB). Add a new `'soul-deck'` zone and mark Soul-Deck-origin cards with `isSoulDeckOrigin: true` so a single refill helper (pure function, reused by goldfish + server) can count correctly alongside captured characters and LS tokens that also live in the shared LoB. All new logic is gated on `format === 'Paragon'`.

**Tech Stack:** TypeScript, Next.js 15, React 19, Vitest for unit tests, SpacetimeDB (TypeScript module + generated client bindings), Konva (canvas rendering).

**Source spec:** `docs/superpowers/specs/2026-04-18-paragon-soul-deck-design.md`

---

## Pre-flight

Before starting: confirm you are in a clean git working tree on a dedicated branch (the current branch `spacetime-dbt-thoughts-with-new-display` is fine if no unrelated work is in progress; otherwise create a feature branch off `main`).

Run commands:
- Unit tests: `npx vitest run <path-to-test>`
- Build: `npm run build` (only at end of phases; spec note says to avoid after small changes)
- SpacetimeDB deploy: invoke the `spacetimedb-deploy` skill (see Task 12)

---

## File Structure

Files created/modified by this plan:

**Created:**
- `app/shared/paragon/soulDeck.ts` — 21 soul defs + back image constant
- `app/shared/paragon/refill.ts` — pure `refillSoulDeck(zones)` helper
- `app/shared/paragon/__tests__/refill.test.ts` — unit tests for the helper
- `app/goldfish/state/__tests__/gameInitializer.paragon.test.ts` — init test for Paragon
- `app/goldfish/state/__tests__/gameReducer.paragon.test.ts` — reducer refill/rescue tests

**Modified:**
- `app/shared/types/gameCard.ts` — zone id, label, `GameCard` fields, `ZoneId` constant
- `app/goldfish/types.ts` — no structural change (auto-reexports)
- `app/goldfish/state/gameInitializer.ts` — Paragon soul-deck build + reveal
- `app/goldfish/state/gameReducer.ts` — refill triggers (turn start, post-move), shared-owner rescue
- `app/goldfish/layout/zoneLayout.ts` — Soul Deck pile tile when Paragon
- `app/goldfish/components/GoldfishCanvas.tsx` — render Soul Deck pile + context menu handler
- `app/play/layout/multiplayerLayout.ts` — shared centered LoB + Soul Deck pile when Paragon
- `app/play/components/MultiplayerCanvas.tsx` — render shared LoB + Soul Deck pile
- `app/shared/components/DeckContextMenu.tsx` — `hideDiscardActions`, `hideReserveActions` flags
- `spacetimedb/src/schema.ts` — `isSoulDeckOrigin` field on `CardInstance`
- `spacetimedb/src/index.ts` — `initialize_soul_deck` + auth/refill hooks

---

## Phase 1 — Shared data and types

### Task 1: Paragon soul deck data module

**Files:**
- Create: `app/shared/paragon/soulDeck.ts`

- [ ] **Step 1: Create the file**

```typescript
// app/shared/paragon/soulDeck.ts

export interface ParagonSoulDef {
  identifier: string;   // 'paragon-soul-01' .. 'paragon-soul-21'
  cardName: string;     // 'Lost Soul 01' .. 'Lost Soul 21'
  cardImgFile: string;  // '/paragon-souls/Lost Soul 01.png' etc.
  cardSet: 'ParagonSoul';
  type: 'Lost Soul';
  alignment: 'Evil';
  brigade: '';
  strength: '';
  toughness: '';
  specialAbility: '';
  reference: '';
}

export const SOUL_DECK_BACK_IMG = '/paragon-souls/Lost Soul Back.png';

function buildSoul(n: number): ParagonSoulDef {
  const padded = String(n).padStart(2, '0');
  return {
    identifier: `paragon-soul-${padded}`,
    cardName: `Lost Soul ${padded}`,
    cardImgFile: `/paragon-souls/Lost Soul ${padded}.png`,
    cardSet: 'ParagonSoul',
    type: 'Lost Soul',
    alignment: 'Evil',
    brigade: '',
    strength: '',
    toughness: '',
    specialAbility: '',
    reference: '',
  };
}

export const PARAGON_SOULS: readonly ParagonSoulDef[] = Array.from(
  { length: 21 },
  (_, i) => buildSoul(i + 1)
) as readonly ParagonSoulDef[];
```

- [ ] **Step 2: Verify image files exist at the referenced paths**

Run: `ls public/paragon-souls/ | wc -l`
Expected: `22` (21 souls + 1 back image)

- [ ] **Step 3: Commit**

```bash
git add app/shared/paragon/soulDeck.ts
git commit -m "feat(paragon): add soul deck card defs and back image constant"
```

---

### Task 2: Widen shared types — soul-deck zone, shared owner, isSoulDeckOrigin

**Files:**
- Modify: `app/shared/types/gameCard.ts:8-35` (zone id + labels)
- Modify: `app/shared/types/gameCard.ts:57-83` (GameCard interface)

- [ ] **Step 1: Add `'soul-deck'` to `ZoneId`, `ALL_ZONES`, and `ZONE_LABELS`**

Replace the current `ZoneId`/`ALL_ZONES`/`ZONE_LABELS` block with:

```typescript
export type ZoneId =
  | 'deck'
  | 'hand'
  | 'reserve'
  | 'discard'
  | 'paragon'
  | 'land-of-bondage'
  | 'soul-deck'
  | 'territory'
  | 'land-of-redemption'
  | 'banish';

export const ALL_ZONES: ZoneId[] = [
  'deck', 'hand', 'reserve', 'discard', 'paragon',
  'land-of-bondage', 'soul-deck', 'territory',
  'land-of-redemption', 'banish',
];

export const ZONE_LABELS: Record<ZoneId, string> = {
  'deck': 'Deck',
  'hand': 'Hand',
  'reserve': 'Reserve',
  'discard': 'Discard',
  'paragon': 'Paragon',
  'land-of-bondage': 'Land of Bondage',
  'soul-deck': 'Soul Deck',
  'territory': 'Territory',
  'land-of-redemption': 'Land of Redemption',
  'banish': 'Banish Zone',
};
```

- [ ] **Step 2: Widen `ownerId` and add `isSoulDeckOrigin` to `GameCard`**

Find:

```typescript
  ownerId: 'player1' | 'player2';
  notes: string;
```

Replace with:

```typescript
  ownerId: 'player1' | 'player2' | 'shared';
  isSoulDeckOrigin?: boolean;
  notes: string;
```

(Made optional on the interface because serialized/legacy cards may lack the field. Treat absent as `false` everywhere downstream.)

- [ ] **Step 3: Type-check compiles — run the existing equip test to verify nothing broke**

Run: `npx vitest run app/goldfish/state/__tests__/gameReducer.equip.test.ts`
Expected: PASS (all existing tests still green after widening types)

- [ ] **Step 4: Commit**

```bash
git add app/shared/types/gameCard.ts
git commit -m "feat(shared): widen game types for Paragon soul deck zone and shared owner"
```

---

## Phase 2 — Shared refill helper (pure, tested)

### Task 3: `refillSoulDeck` pure helper

**Files:**
- Create: `app/shared/paragon/refill.ts`
- Create: `app/shared/paragon/__tests__/refill.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// app/shared/paragon/__tests__/refill.test.ts
import { describe, it, expect } from 'vitest';
import type { GameCard, ZoneId } from '@/app/shared/types/gameCard';
import { ALL_ZONES } from '@/app/shared/types/gameCard';
import { refillSoulDeck } from '../refill';

type Zones = Record<ZoneId, GameCard[]>;

function makeCard(overrides: Partial<GameCard>): GameCard {
  return {
    instanceId: overrides.instanceId ?? Math.random().toString(36).slice(2),
    cardName: 'X',
    cardSet: 'T',
    cardImgFile: 'X',
    type: 'Lost Soul',
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
    zone: 'soul-deck',
    ownerId: 'shared',
    notes: '',
    isSoulDeckOrigin: true,
    ...overrides,
  };
}

function emptyZones(): Zones {
  const z = {} as Zones;
  for (const id of ALL_ZONES) z[id] = [];
  return z;
}

describe('refillSoulDeck', () => {
  it('moves cards from soul-deck to land-of-bondage until LoB has 3 soul-origin souls', () => {
    const zones = emptyZones();
    zones['soul-deck'] = [
      makeCard({ instanceId: 's1' }),
      makeCard({ instanceId: 's2' }),
      makeCard({ instanceId: 's3' }),
      makeCard({ instanceId: 's4' }),
    ];
    const next = refillSoulDeck(zones);
    expect(next['soul-deck']).toHaveLength(1);
    expect(next['land-of-bondage']).toHaveLength(3);
    expect(next['land-of-bondage'].every(c => c.isSoulDeckOrigin && c.zone === 'land-of-bondage' && !c.isFlipped)).toBe(true);
  });

  it('is a no-op when 3 soul-origin souls are already in LoB', () => {
    const zones = emptyZones();
    zones['soul-deck'] = [makeCard({ instanceId: 'top' })];
    zones['land-of-bondage'] = [
      makeCard({ instanceId: 'l1', zone: 'land-of-bondage', isFlipped: false }),
      makeCard({ instanceId: 'l2', zone: 'land-of-bondage', isFlipped: false }),
      makeCard({ instanceId: 'l3', zone: 'land-of-bondage', isFlipped: false }),
    ];
    const next = refillSoulDeck(zones);
    expect(next['soul-deck']).toHaveLength(1);
    expect(next['land-of-bondage']).toHaveLength(3);
  });

  it('ignores captured humans and LS tokens in LoB when counting', () => {
    const zones = emptyZones();
    zones['soul-deck'] = [
      makeCard({ instanceId: 's1' }),
      makeCard({ instanceId: 's2' }),
      makeCard({ instanceId: 's3' }),
    ];
    zones['land-of-bondage'] = [
      makeCard({ instanceId: 'token1', isToken: true, isSoulDeckOrigin: false, zone: 'land-of-bondage', ownerId: 'player1' }),
      makeCard({ instanceId: 'human1', isSoulDeckOrigin: false, type: 'Hero', zone: 'land-of-bondage', ownerId: 'player2' }),
    ];
    const next = refillSoulDeck(zones);
    // LoB still has the 2 originals plus 3 refilled soul-deck souls
    expect(next['land-of-bondage']).toHaveLength(5);
    expect(next['soul-deck']).toHaveLength(0);
    const soulOriginCount = next['land-of-bondage'].filter(c => c.isSoulDeckOrigin).length;
    expect(soulOriginCount).toBe(3);
  });

  it('stops refilling when the soul-deck is empty', () => {
    const zones = emptyZones();
    zones['soul-deck'] = [makeCard({ instanceId: 'only' })];
    const next = refillSoulDeck(zones);
    expect(next['soul-deck']).toHaveLength(0);
    expect(next['land-of-bondage']).toHaveLength(1);
  });

  it('draws from the top of the soul-deck (index 0)', () => {
    const zones = emptyZones();
    zones['soul-deck'] = [
      makeCard({ instanceId: 'top' }),
      makeCard({ instanceId: 'middle' }),
      makeCard({ instanceId: 'bottom' }),
    ];
    const next = refillSoulDeck(zones);
    expect(next['land-of-bondage'].map(c => c.instanceId)).toEqual(['top', 'middle', 'bottom']);
    expect(next['soul-deck']).toHaveLength(0);
  });

  it('returns a new zones object and does not mutate inputs', () => {
    const zones = emptyZones();
    zones['soul-deck'] = [makeCard({ instanceId: 's1' })];
    const originalSoulDeck = zones['soul-deck'];
    const originalLob = zones['land-of-bondage'];
    refillSoulDeck(zones);
    expect(zones['soul-deck']).toBe(originalSoulDeck);
    expect(zones['land-of-bondage']).toBe(originalLob);
    expect(zones['soul-deck']).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test — expect all to fail with "module not found"**

Run: `npx vitest run app/shared/paragon/__tests__/refill.test.ts`
Expected: FAIL with "Cannot find module '../refill'"

- [ ] **Step 3: Implement the helper**

```typescript
// app/shared/paragon/refill.ts
import type { GameCard, ZoneId } from '@/app/shared/types/gameCard';

type Zones = Record<ZoneId, GameCard[]>;

const TARGET_IN_PLAY = 3;

/**
 * Move cards from 'soul-deck' to 'land-of-bondage' until the LoB contains
 * TARGET_IN_PLAY Soul-Deck-origin souls, or the soul-deck is empty. Captured
 * characters and LS tokens in the LoB are ignored by the counter.
 *
 * Returns a new zones record — inputs are not mutated.
 */
export function refillSoulDeck(zones: Zones): Zones {
  const soulDeck = zones['soul-deck'];
  const lob = zones['land-of-bondage'];

  const inPlay = lob.filter(c => c.isSoulDeckOrigin === true).length;
  const needed = Math.max(0, TARGET_IN_PLAY - inPlay);
  if (needed === 0 || soulDeck.length === 0) return zones;

  const take = Math.min(needed, soulDeck.length);
  const revealed = soulDeck.slice(0, take).map(c => ({
    ...c,
    zone: 'land-of-bondage' as ZoneId,
    isFlipped: false,
  }));
  const nextSoulDeck = soulDeck.slice(take);
  const nextLob = [...lob, ...revealed];

  return { ...zones, 'soul-deck': nextSoulDeck, 'land-of-bondage': nextLob };
}
```

- [ ] **Step 4: Run tests — expect all green**

Run: `npx vitest run app/shared/paragon/__tests__/refill.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add app/shared/paragon/refill.ts app/shared/paragon/__tests__/refill.test.ts
git commit -m "feat(paragon): add refillSoulDeck helper with tests"
```

---

## Phase 3 — Goldfish integration

### Task 4: Paragon soul-deck initialization in goldfish

**Files:**
- Modify: `app/goldfish/state/gameInitializer.ts`
- Create: `app/goldfish/state/__tests__/gameInitializer.paragon.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// app/goldfish/state/__tests__/gameInitializer.paragon.test.ts
import { describe, it, expect } from 'vitest';
import { buildInitialGameState } from '../gameInitializer';
import type { DeckDataForGoldfish } from '../../types';

function makeDeck(format: string): DeckDataForGoldfish {
  // Minimal deck with 50 non-LS cards to avoid opening-hand LS routing
  return {
    id: 'd1',
    name: 'Test',
    format,
    cards: Array.from({ length: 50 }, (_, i) => ({
      card_name: `Card ${i}`,
      card_set: 'T',
      card_img_file: `/card-${i}.png`,
      card_type: 'Hero',
      card_brigade: '',
      card_strength: '1',
      card_toughness: '1',
      card_special_ability: '',
      card_identifier: `c${i}`,
      card_reference: '',
      card_alignment: 'Good',
      quantity: 1,
      is_reserve: false,
    })),
  };
}

describe('buildInitialGameState (Paragon)', () => {
  it('creates a 21-card soul deck when format is Paragon', () => {
    const state = buildInitialGameState(makeDeck('Paragon'));
    const totalSoulOrigin =
      state.zones['soul-deck'].length +
      state.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin).length;
    expect(totalSoulOrigin).toBe(21);
  });

  it('reveals exactly 3 souls face-up in Land of Bondage after init', () => {
    const state = buildInitialGameState(makeDeck('Paragon'));
    const lobSoulOrigins = state.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin);
    expect(lobSoulOrigins).toHaveLength(3);
    expect(lobSoulOrigins.every(c => !c.isFlipped && c.zone === 'land-of-bondage')).toBe(true);
  });

  it('leaves 18 face-down cards in the soul-deck zone', () => {
    const state = buildInitialGameState(makeDeck('Paragon'));
    const soulDeck = state.zones['soul-deck'];
    expect(soulDeck).toHaveLength(18);
    expect(soulDeck.every(c => c.isFlipped && c.ownerId === 'shared' && c.isSoulDeckOrigin)).toBe(true);
  });

  it('does NOT create a soul deck for T1 format', () => {
    const state = buildInitialGameState(makeDeck('T1'));
    expect(state.zones['soul-deck']).toHaveLength(0);
    const soulOriginInLob = state.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin);
    expect(soulOriginInLob).toHaveLength(0);
  });

  it('assigns ownerId "shared" to every soul-deck-origin card', () => {
    const state = buildInitialGameState(makeDeck('Paragon'));
    const allSoulOrigins = [
      ...state.zones['soul-deck'],
      ...state.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin),
    ];
    expect(allSoulOrigins).toHaveLength(21);
    expect(allSoulOrigins.every(c => c.ownerId === 'shared')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect failure (soul-deck zone empty, Paragon init missing)**

Run: `npx vitest run app/goldfish/state/__tests__/gameInitializer.paragon.test.ts`
Expected: FAIL — "Expected length 21, received 0" or similar.

- [ ] **Step 3: Add `buildSoulDeckZones` helper and Paragon branch to initializer**

Edit `app/goldfish/state/gameInitializer.ts`:

Add the import at the top:

```typescript
import { PARAGON_SOULS } from '@/app/shared/paragon/soulDeck';
```

Add this helper directly above `export function buildInitialGameState`:

```typescript
function buildSoulDeckZones(): { soulDeck: GameCard[]; lob: GameCard[] } {
  const defs = shuffleArray([...PARAGON_SOULS]);
  const cards: GameCard[] = defs.map(def => ({
    instanceId: crypto.randomUUID(),
    cardName: def.cardName,
    cardSet: def.cardSet,
    cardImgFile: def.cardImgFile,
    type: def.type,
    brigade: def.brigade,
    strength: def.strength,
    toughness: def.toughness,
    specialAbility: def.specialAbility,
    identifier: def.identifier,
    reference: def.reference,
    alignment: def.alignment,
    isMeek: false,
    counters: [],
    isFlipped: true,
    isToken: false,
    zone: 'soul-deck',
    ownerId: 'shared',
    notes: '',
    isSoulDeckOrigin: true,
  }));
  // Reveal top 3 into Land of Bondage
  const revealed = cards.slice(0, 3).map(c => ({ ...c, zone: 'land-of-bondage' as const, isFlipped: false }));
  const remaining = cards.slice(3);
  return { soulDeck: remaining, lob: revealed };
}
```

Inside `buildInitialGameState`, after `zones.reserve = reserve;` and BEFORE the `drawOpeningHand` call, insert:

```typescript
  if (format === 'Paragon') {
    const { soulDeck, lob } = buildSoulDeckZones();
    zones['soul-deck'] = soulDeck;
    zones['land-of-bondage'] = lob;
  }
```

- [ ] **Step 4: Run tests — expect all green**

Run: `npx vitest run app/goldfish/state/__tests__/gameInitializer.paragon.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add app/goldfish/state/gameInitializer.ts app/goldfish/state/__tests__/gameInitializer.paragon.test.ts
git commit -m "feat(goldfish): initialize Paragon soul deck with 3 revealed souls"
```

---

### Task 5: Goldfish refill on turn start

**Files:**
- Modify: `app/goldfish/state/gameReducer.ts` (END_TURN case)
- Create: `app/goldfish/state/__tests__/gameReducer.paragon.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// app/goldfish/state/__tests__/gameReducer.paragon.test.ts
import { describe, it, expect } from 'vitest';
import { gameReducer } from '../gameReducer';
import type { GameCard, GameState, GameAction, ZoneId } from '../../types';

function makeCard(overrides: Partial<GameCard>): GameCard {
  return {
    instanceId: 'x',
    cardName: 'X',
    cardSet: 'T',
    cardImgFile: 'X',
    type: 'Lost Soul',
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
    zone: 'soul-deck',
    ownerId: 'shared',
    notes: '',
    isSoulDeckOrigin: true,
    ...overrides,
  };
}

function makeState(zoneOverrides: Partial<Record<ZoneId, GameCard[]>>, format: 'T1'|'T2'|'Paragon' = 'Paragon'): GameState {
  const zones: GameState['zones'] = {
    deck: [], hand: [], reserve: [], discard: [], paragon: [],
    'land-of-bondage': [], 'soul-deck': [], territory: [], 'land-of-redemption': [], banish: [],
    ...zoneOverrides,
  } as GameState['zones'];
  return {
    sessionId: 's',
    deckId: 'd',
    deckName: 'T',
    isOwner: true,
    format,
    paragonName: null,
    turn: 1,
    phase: 'draw',
    zones,
    history: [],
    options: { format, startingHandSize: 8, autoRouteLostSouls: false, showPhaseReminder: false, showTurnCounter: false, soundEnabled: false, alwaysStartWith: [] },
    isSpreadHand: false,
    drawnThisTurn: false,
  };
}

function act(type: GameAction['type'], payload: GameAction['payload'] = {}): GameAction {
  return { id: 'a', type, playerId: 'player1', timestamp: 0, payload };
}

describe('Paragon refill on END_TURN', () => {
  it('refills LoB to 3 soul-origin souls when one was rescued prior', () => {
    const soulDeck = [makeCard({ instanceId: 's-top' }), makeCard({ instanceId: 's-next' })];
    const lob = [
      makeCard({ instanceId: 'l1', zone: 'land-of-bondage', isFlipped: false }),
      makeCard({ instanceId: 'l2', zone: 'land-of-bondage', isFlipped: false }),
    ];
    // Provide a deck so END_TURN doesn't fail its auto-draw
    const deck: GameCard[] = [];
    const state = makeState({ 'soul-deck': soulDeck, 'land-of-bondage': lob, deck });
    const next = gameReducer(state, act('END_TURN'));
    const lobOrigin = next.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin);
    expect(lobOrigin).toHaveLength(3);
    expect(next.zones['soul-deck']).toHaveLength(1);
  });

  it('is a no-op for non-Paragon formats', () => {
    const t1State = makeState({ 'soul-deck': [makeCard({ instanceId: 's' })], 'land-of-bondage': [] }, 'T1');
    const next = gameReducer(t1State, act('END_TURN'));
    expect(next.zones['soul-deck']).toHaveLength(1);
    expect(next.zones['land-of-bondage']).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run app/goldfish/state/__tests__/gameReducer.paragon.test.ts`
Expected: FAIL — "Expected length 3, received 2" (refill not wired).

- [ ] **Step 3: Hook `refillSoulDeck` into END_TURN**

Edit `app/goldfish/state/gameReducer.ts`:

Add import near the top, after the existing imports:

```typescript
import { refillSoulDeck } from '@/app/shared/paragon/refill';
```

Find the `END_TURN` case (around line 343). After the auto-draw-3 loop completes (just before `return newState;`), insert the refill:

```typescript
      if (newState.format === 'Paragon') {
        newState = { ...newState, zones: refillSoulDeck(newState.zones) };
      }
      return newState;
```

- [ ] **Step 4: Run the new test**

Run: `npx vitest run app/goldfish/state/__tests__/gameReducer.paragon.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the existing equip test to verify no regression**

Run: `npx vitest run app/goldfish/state/__tests__/gameReducer.equip.test.ts`
Expected: PASS (all original tests)

- [ ] **Step 6: Commit**

```bash
git add app/goldfish/state/gameReducer.ts app/goldfish/state/__tests__/gameReducer.paragon.test.ts
git commit -m "feat(goldfish): refill soul deck on turn-start (END_TURN) for Paragon"
```

---

### Task 6: Goldfish refill on rescue + ownership transfer

**Files:**
- Modify: `app/goldfish/state/gameReducer.ts` (MOVE_CARD + MOVE_CARDS_BATCH cases)
- Modify: `app/goldfish/state/__tests__/gameReducer.paragon.test.ts` (append tests)

- [ ] **Step 1: Append failing tests**

Append to `app/goldfish/state/__tests__/gameReducer.paragon.test.ts`:

```typescript
describe('Paragon rescue + refill on MOVE_CARD', () => {
  it('transfers ownership from shared to player1 when rescuing from shared LoB to LoR', () => {
    const soulDeck = [makeCard({ instanceId: 's-top' })];
    const lob = [
      makeCard({ instanceId: 'l1', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l2', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l3', zone: 'land-of-bondage' }),
    ];
    const state = makeState({ 'soul-deck': soulDeck, 'land-of-bondage': lob });
    const next = gameReducer(state, act('MOVE_CARD', {
      cardInstanceId: 'l1',
      toZone: 'land-of-redemption',
    }));
    const rescued = next.zones['land-of-redemption'].find(c => c.instanceId === 'l1');
    expect(rescued?.ownerId).toBe('player1');
    expect(rescued?.isSoulDeckOrigin).toBe(true);
  });

  it('refills LoB back to 3 soul-origin souls after rescue', () => {
    const soulDeck = [makeCard({ instanceId: 's-top' })];
    const lob = [
      makeCard({ instanceId: 'l1', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l2', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l3', zone: 'land-of-bondage' }),
    ];
    const state = makeState({ 'soul-deck': soulDeck, 'land-of-bondage': lob });
    const next = gameReducer(state, act('MOVE_CARD', {
      cardInstanceId: 'l1',
      toZone: 'land-of-redemption',
    }));
    const lobOrigin = next.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin);
    expect(lobOrigin).toHaveLength(3);
    expect(next.zones['soul-deck']).toHaveLength(0);
  });

  it('does NOT refill when a non-soul-origin card leaves LoB', () => {
    const soulDeck = [makeCard({ instanceId: 's-top' })];
    const lob = [
      makeCard({ instanceId: 'l1', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l2', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l3', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'token', zone: 'land-of-bondage', isToken: true, isSoulDeckOrigin: false, ownerId: 'player2' }),
    ];
    const state = makeState({ 'soul-deck': soulDeck, 'land-of-bondage': lob });
    const next = gameReducer(state, act('MOVE_CARD', {
      cardInstanceId: 'token',
      toZone: 'land-of-redemption',
    }));
    expect(next.zones['soul-deck']).toHaveLength(1);
    expect(next.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run app/goldfish/state/__tests__/gameReducer.paragon.test.ts`
Expected: FAIL — ownership still `'shared'`, no refill after MOVE_CARD.

- [ ] **Step 3: Add refill + ownership transfer to `MOVE_CARD`**

Edit `app/goldfish/state/gameReducer.ts` inside the `MOVE_CARD` case. Find the block that sets `result.card.zone = toZone;` (around line 99).

Immediately after that line, add:

```typescript
      // Paragon: rescuing a Soul-Deck-origin card transfers ownership from
      // the shared sentinel to the rescuing player. Marker stays set.
      const movedFromSharedLob =
        result.fromZone === 'land-of-bondage' &&
        result.card.ownerId === 'shared' &&
        result.card.isSoulDeckOrigin === true;
      if (movedFromSharedLob) {
        result.card.ownerId = 'player1'; // goldfish: only player1 is the seat
      }
```

Then, immediately before `return { ...state, zones, history };` at the end of the `MOVE_CARD` case (around line 143), insert:

```typescript
      let finalZones = zones;
      const needsRefill =
        state.format === 'Paragon' &&
        result.fromZone === 'land-of-bondage' &&
        result.card.isSoulDeckOrigin === true &&
        toZone !== 'land-of-bondage';
      if (needsRefill) {
        finalZones = refillSoulDeck(zones);
      }
      return { ...state, zones: finalZones, history };
```

Replace the existing `return { ...state, zones, history };` at the end of the MOVE_CARD case with the block above (do not duplicate — the new block is the replacement).

- [ ] **Step 4: Mirror the refill+transfer logic into `MOVE_CARDS_BATCH`**

Inside the `MOVE_CARDS_BATCH` case, inside the `for (const instanceId of cardInstanceIds)` loop, after `result.card.zone = finalZone;`, add:

```typescript
        const wasSharedSoulFromLob =
          result.fromZone === 'land-of-bondage' &&
          result.card.ownerId === 'shared' &&
          result.card.isSoulDeckOrigin === true;
        if (wasSharedSoulFromLob) {
          result.card.ownerId = 'player1';
        }
```

At the very end of the `MOVE_CARDS_BATCH` case, replace `return { ...state, zones, history };` with:

```typescript
      let finalZones = zones;
      if (state.format === 'Paragon') {
        // A soul-origin card may have left LoB as part of this batch; refill is idempotent.
        finalZones = refillSoulDeck(zones);
      }
      return { ...state, zones: finalZones, history };
```

- [ ] **Step 5: Run all goldfish tests**

Run: `npx vitest run app/goldfish/state/__tests__/`
Expected: PASS (all tests, including 5 new Paragon rescue/refill tests)

- [ ] **Step 6: Commit**

```bash
git add app/goldfish/state/gameReducer.ts app/goldfish/state/__tests__/gameReducer.paragon.test.ts
git commit -m "feat(goldfish): refill soul deck on rescue and transfer ownership"
```

---

### Task 7: Extend DeckContextMenu with hide flags

**Files:**
- Modify: `app/shared/components/DeckContextMenu.tsx`

- [ ] **Step 1: Add two new optional props to `DeckContextMenuProps`**

Edit `app/shared/components/DeckContextMenu.tsx`. Find the props interface (around line 40) and append:

```typescript
  /** When true, hides the Discard row inside each Top/Bottom/Random submenu */
  hideDiscardActions?: boolean;
  /** When true, hides the Reserve row inside each Top/Bottom/Random submenu */
  hideReserveActions?: boolean;
```

- [ ] **Step 2: Destructure the new props**

Find the `DeckContextMenu` function signature (around line 153) and add them to the destructured params:

```typescript
  hideDrawActions,
  hideDiscardActions,
  hideReserveActions,
}: DeckContextMenuProps) {
```

- [ ] **Step 3: Conditionally render Discard and Reserve rows in each submenu**

Inside the JSX (around lines 247-267), update each of the three `SubmenuTrigger` blocks. For `Top Card`:

```tsx
        <SubmenuTrigger label="Top Card">
          {!hideDrawActions && <SubMenuActionRow icon={<Play size={14} />} label="Draw" max={deckSize} onAction={onDrawTop} />}
          {onLookAtTop && <SubMenuActionRow icon={<Eye size={14} />} label="Look" max={deckSize} onAction={onLookAtTop} />}
          <SubMenuActionRow icon={<Sparkles size={14} />} label="Reveal" max={deckSize} onAction={onRevealTop} />
          {!hideDiscardActions && <SubMenuActionRow icon={<Trash2 size={14} />} label="Discard" max={deckSize} onAction={onDiscardTop} />}
          {!hideReserveActions && <SubMenuActionRow icon={<Archive size={14} />} label="Reserve" max={deckSize} onAction={onReserveTop} />}
        </SubmenuTrigger>
```

Apply the same pattern to the `Bottom Card` and `Random Card` blocks (wrap Discard + Reserve rows).

- [ ] **Step 4: Verify existing callers still type-check (no changes needed — new props are optional)**

Run: `npx tsc --noEmit` (only if fast; otherwise skip — the build in Task 14 catches this)
Expected: no errors related to DeckContextMenu.

- [ ] **Step 5: Commit**

```bash
git add app/shared/components/DeckContextMenu.tsx
git commit -m "feat(shared): add hideDiscardActions and hideReserveActions to DeckContextMenu"
```

---

### Task 8: Goldfish Soul Deck pile in zone layout

**Files:**
- Modify: `app/goldfish/layout/zoneLayout.ts`

- [ ] **Step 1: Carve a Soul Deck pile slot from the left edge of the LoB when Paragon**

Edit `app/goldfish/layout/zoneLayout.ts`. Change the `calculateZoneLayout` signature to accept a format arg:

```typescript
export function calculateZoneLayout(
  stageWidth: number,
  stageHeight: number,
  scale: number = 1,
  format: 'T1' | 'T2' | 'Paragon' = 'T1',
): Record<ZoneId, ZoneRect> {
```

After the `landOfBondageZone` definition (around line 79), add:

```typescript
  // Soul Deck pile: occupies the left ~1 card width of the LoB when Paragon.
  // For non-Paragon, render off-canvas (consistent with paragonZone pattern).
  const soulDeckWidth = format === 'Paragon' ? Math.min(CARD_WIDTH + 8, landOfBondageZone.width * 0.2) : 0;
  const soulDeckZone: ZoneRect = format === 'Paragon'
    ? {
        x: landOfBondageZone.x,
        y: landOfBondageZone.y,
        width: soulDeckWidth,
        height: landOfBondageZone.height,
        label: 'Soul Deck',
      }
    : { x: -1000, y: -1000, width: 0, height: 0, label: 'Soul Deck' };

  // Shrink LoB rect to the right of the Soul Deck so cards don't overlap the pile
  const lobZoneFinal: ZoneRect = format === 'Paragon'
    ? {
        ...landOfBondageZone,
        x: landOfBondageZone.x + soulDeckWidth + 4,
        width: landOfBondageZone.width - soulDeckWidth - 4,
      }
    : landOfBondageZone;
```

Then in the return statement (around line 123), replace the `land-of-bondage` entry and add `'soul-deck'`:

```typescript
  return {
    'deck': deckZone,
    'hand': handZone,
    'reserve': reserveZone,
    'discard': discardZone,
    'paragon': paragonZone,
    'land-of-bondage': lobZoneFinal,
    'soul-deck': soulDeckZone,
    'territory': territoryZone,
    'land-of-redemption': landOfRedemptionZone,
    'banish': banishZone,
  };
```

- [ ] **Step 2: Update the single call site in `GoldfishCanvas.tsx` to pass the format**

Find the call to `calculateZoneLayout(` in `app/goldfish/components/GoldfishCanvas.tsx`:

```bash
grep -n "calculateZoneLayout" app/goldfish/components/GoldfishCanvas.tsx
```

Pass the game state's `format` as the fourth arg — something like:

```typescript
const zoneLayout = useMemo(
  () => calculateZoneLayout(stageWidth, stageHeight, scale, state.format),
  [stageWidth, stageHeight, scale, state.format]
);
```

(Use the name the existing call actually uses. Do not invent a new variable.)

- [ ] **Step 3: Manual check**

Run: `npm run dev`
Open goldfish with a Paragon-format deck. Visually verify:
- LoB sits at the bottom of the play area
- A thin pile tile sits at its left edge when Paragon
- The pile does NOT appear when loading a T1/T2 deck

Report the result in your commit message (pass/fail).

- [ ] **Step 4: Commit**

```bash
git add app/goldfish/layout/zoneLayout.ts app/goldfish/components/GoldfishCanvas.tsx
git commit -m "feat(goldfish): carve Soul Deck pile slot in LoB when Paragon"
```

---

### Task 9: Render the goldfish Soul Deck pile + context menu wiring

**Files:**
- Modify: `app/goldfish/components/GoldfishCanvas.tsx`

Context: goldfish canvas already handles per-zone context menus and renders piles (deck/discard/reserve). The Soul Deck pile reuses the same infrastructure with three differences:
1. The pile image is always `SOUL_DECK_BACK_IMG` (never a real card face).
2. The `DeckContextMenu` opened for it passes `hideDrawActions=true`, `hideDiscardActions=true`, `hideReserveActions=true`.
3. Its `onReveal*` actions move the top/bottom/random card to `land-of-bondage` face-up with ownership `'shared'` preserved (the card is already `ownerId: 'shared'`).

- [ ] **Step 1: Import the back-image constant**

At the top of `app/goldfish/components/GoldfishCanvas.tsx`, add:

```typescript
import { SOUL_DECK_BACK_IMG } from '@/app/shared/paragon/soulDeck';
```

- [ ] **Step 2: Render the Soul Deck pile when Paragon**

Find where the existing deck pile is rendered (search for `zoneId === 'deck'` rendering; line ~1349). In that same map/render loop, add a branch for `'soul-deck'` that renders the back image when the zone has cards.

**Exact code (insert alongside the deck rendering branch):**

```tsx
if (zoneId === 'soul-deck' && state.format === 'Paragon') {
  const soulDeckSize = state.zones['soul-deck'].length;
  if (soulDeckSize === 0) return null;
  // Use the existing pile renderer, but substitute the back image as the
  // cardImgFile. If GoldfishCanvas renders piles via a component that takes
  // a "topCard" prop, pass a synthetic top card with cardImgFile = SOUL_DECK_BACK_IMG.
  return (
    <SoulDeckPileAt
      key="soul-deck-pile"
      zone={zoneLayout['soul-deck']}
      count={soulDeckSize}
      onContextMenu={handleSoulDeckContextMenu}
    />
  );
}
```

**Note to implementer:** Match the existing pile-rendering pattern in `GoldfishCanvas.tsx`. If piles render via Konva `<Image>` + `<Text>`, inline that (copy the deck-pile render block and swap the image source + click/context-menu handler). Do NOT extract a new component unless the file already follows that pattern for deck/discard/reserve. Keep the render call-site co-located with the other pile branches so reviewers can diff it against the deck pile easily.

- [ ] **Step 3: Add a context-menu handler for the Soul Deck**

Near `handleDeckContextMenu` (line ~869), add:

```typescript
const handleSoulDeckContextMenu = useCallback(
  (e: any) => {
    e.evt?.preventDefault?.();
    const px = e.evt?.clientX ?? 0;
    const py = e.evt?.clientY ?? 0;
    setContextMenu({ kind: 'soul-deck', x: px, y: py });
  },
  []
);
```

And add a rendering branch that opens the shared `DeckContextMenu` with the Soul Deck actions:

```tsx
{contextMenu?.kind === 'soul-deck' && (
  <DeckContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    deckSize={state.zones['soul-deck'].length}
    onClose={() => setContextMenu(null)}
    hideDrawActions
    hideDiscardActions
    hideReserveActions
    onSearchDeck={() => openZoneSearch('soul-deck')}
    onShuffleDeck={() => dispatchSoulDeckShuffle()}
    onDrawTop={() => {}} /* hidden */
    onDrawBottom={() => {}}
    onDrawRandom={() => {}}
    onDiscardTop={() => {}} /* hidden */
    onDiscardBottom={() => {}}
    onDiscardRandom={() => {}}
    onReserveTop={() => {}} /* hidden */
    onReserveBottom={() => {}}
    onReserveRandom={() => {}}
    onRevealTop={(n) => revealFromSoulDeck('top', n)}
    onRevealBottom={(n) => revealFromSoulDeck('bottom', n)}
    onRevealRandom={(n) => revealFromSoulDeck('random', n)}
    onLookAtTop={(n) => lookAtSoulDeck('top', n)}
    onLookAtBottom={(n) => lookAtSoulDeck('bottom', n)}
    onLookAtRandom={(n) => lookAtSoulDeck('random', n)}
  />
)}
```

**Note to implementer:** Reuse the *existing* goldfish helpers `openZoneSearch`, `revealFromDeck`, `lookAtDeck` as templates — copy them and swap the source zone to `'soul-deck'` (name the new variants `revealFromSoulDeck` and `lookAtSoulDeck`). Do not design new reducer actions; they should dispatch the same `MOVE_CARD`/`MOVE_CARDS_BATCH` actions used by the regular deck pile (with `fromZone`-style logic already living in the reducer via `findAndRemoveCard`).

- [ ] **Step 4: Allow dragging the Soul Deck pile top card into LoB**

Search for where the deck pile accepts drag starts (likely a Konva `onDragStart` / `draggable={true}` branch near the deck-pile render). Mirror that for the Soul Deck pile, but:
- On drop into `'land-of-bondage'` (or any valid reveal target): dispatch `MOVE_CARD` on the top card with `toZone: 'land-of-bondage'`, `isFlipped: false`.
- Reject drops into `'hand'`, `'discard'`, `'reserve'`, `'banish'` — do nothing.

If the existing deck-pile drag implementation is complex, leave drag-from-Soul-Deck out of this task and file a TODO comment in the render block. The right-click reveal path is sufficient for v1; drag can be added later.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`
Load a Paragon deck in goldfish. Verify:
- Soul Deck pile renders on the left of the LoB showing the back image.
- Right-click opens a context menu without Draw / Discard / Reserve rows.
- Clicking Reveal Top 1 moves a face-up soul into the LoB.
- After rescue (drag soul from LoB to LoR), refill fires — a new face-up soul appears in the LoB.
- Turn-end (`End Turn` button) does NOT create extras when LoB already has 3 soul-origins.

- [ ] **Step 6: Commit**

```bash
git add app/goldfish/components/GoldfishCanvas.tsx
git commit -m "feat(goldfish): render Soul Deck pile with context menu and rescue refill"
```

---

## Phase 4 — SpacetimeDB (multiplayer backend)

### Task 10: Add `isSoulDeckOrigin` to `CardInstance` schema

**Files:**
- Modify: `spacetimedb/src/schema.ts:81-116` (CardInstance table)

- [ ] **Step 1: Add the field**

In the `CardInstance` column list, immediately below the `equippedToInstanceId` field, add:

```typescript
    isSoulDeckOrigin: t.bool().default(false),
```

- [ ] **Step 2: Type-check the SpacetimeDB module compiles**

Run: `cd spacetimedb && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit (do NOT publish yet — that's Task 12)**

```bash
git add spacetimedb/src/schema.ts
git commit -m "feat(spacetime): add isSoulDeckOrigin field to CardInstance"
```

---

### Task 11: `initialize_soul_deck` reducer + pregame hook

**Files:**
- Modify: `spacetimedb/src/index.ts`

Context: the server transitions to `status: 'playing'` inside `pregame_acknowledge_first` (around line 663) after both players ack. That's the correct trigger point — by then both players' decks are loaded via `insertCardsShuffleDraw` and opening hands are drawn. The soul deck should be seeded right before flipping status to `'playing'` so clients see a consistent shared LoB from turn 1.

- [ ] **Step 1: Add an `initialize_soul_deck` helper function near the top of `index.ts`**

Place just after the `insertCardsShuffleDraw` function (around line 238):

```typescript
// ---------------------------------------------------------------------------
// Helper: initializeSoulDeck (Paragon only)
// Seeds 21 shared soul cards into 'soul-deck', then reveals 3 to
// 'land-of-bondage' face-up. Uses the game's seeded PRNG for shuffle.
// ---------------------------------------------------------------------------
const PARAGON_SOUL_DEFS: Array<{ identifier: string; cardName: string; cardImgFile: string }> =
  Array.from({ length: 21 }, (_, i) => {
    const padded = String(i + 1).padStart(2, '0');
    return {
      identifier: `paragon-soul-${padded}`,
      cardName: `Lost Soul ${padded}`,
      cardImgFile: `/paragon-souls/Lost Soul ${padded}.png`,
    };
  });

function initializeSoulDeck(ctx: any, game: any) {
  // Insert 21 shared soul cards (ownerId = 0n sentinel)
  for (let i = 0; i < PARAGON_SOUL_DEFS.length; i++) {
    const def = PARAGON_SOUL_DEFS[i];
    ctx.db.CardInstance.insert({
      id: 0n,
      gameId: game.id,
      ownerId: 0n,
      zone: 'soul-deck',
      zoneIndex: BigInt(i),
      posX: '',
      posY: '',
      isMeek: false,
      isFlipped: true,
      cardName: def.cardName,
      cardSet: 'ParagonSoul',
      cardImgFile: def.cardImgFile,
      cardType: 'Lost Soul',
      brigade: '',
      strength: '',
      toughness: '',
      alignment: 'Evil',
      identifier: def.identifier,
      specialAbility: '',
      reference: '',
      notes: '',
      equippedToInstanceId: 0n,
      isSoulDeckOrigin: true,
    });
  }

  // Shuffle soul deck using seeded PRNG (same pattern as insertCardsShuffleDraw)
  const shuffleSeed = makeSeed(
    ctx.timestamp.microsSinceUnixEpoch,
    game.id,
    0n,          // ownerId sentinel — keeps seed distinct from player decks
    game.rngCounter
  );
  const soulCards = [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)].filter(
    (c: any) => c.ownerId === 0n && c.zone === 'soul-deck'
  );
  const indices = soulCards.map((_: any, idx: number) => idx);
  seededShuffle(indices, shuffleSeed);
  for (let i = 0; i < soulCards.length; i++) {
    ctx.db.CardInstance.id.update({ ...soulCards[i], zoneIndex: BigInt(indices[i]) });
  }

  // Bump rngCounter after PRNG use
  const latestGame = ctx.db.Game.id.find(game.id);
  ctx.db.Game.id.update({ ...latestGame, rngCounter: latestGame.rngCounter + 1n });

  // Reveal top 3 shuffled cards into land-of-bondage (face-up)
  const shuffledSoulCards = [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)]
    .filter((c: any) => c.ownerId === 0n && c.zone === 'soul-deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));

  for (let i = 0; i < 3 && i < shuffledSoulCards.length; i++) {
    ctx.db.CardInstance.id.update({
      ...shuffledSoulCards[i],
      zone: 'land-of-bondage',
      zoneIndex: BigInt(i),
      isFlipped: false,
    });
  }

  // Re-index remaining soul-deck cards to 0..N-1
  const remainingSoulDeck = [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)]
    .filter((c: any) => c.ownerId === 0n && c.zone === 'soul-deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
  for (let i = 0; i < remainingSoulDeck.length; i++) {
    if (remainingSoulDeck[i].zoneIndex !== BigInt(i)) {
      ctx.db.CardInstance.id.update({ ...remainingSoulDeck[i], zoneIndex: BigInt(i) });
    }
  }
}
```

- [ ] **Step 2: Call the helper when the game transitions to `'playing'` in Paragon**

Find `pregame_acknowledge_first` around line 637. Inside the `if (bothReady)` branch, BEFORE the `ctx.db.Game.id.update({...updatedGame, status: 'playing', ...})` call, add:

```typescript
      const normalized = normalizeFormat(game.format);
      if (normalized === 'Paragon') {
        initializeSoulDeck(ctx, game);
      }
```

- [ ] **Step 3: Add a general-purpose server refill helper**

Place directly after `initializeSoulDeck`:

```typescript
// ---------------------------------------------------------------------------
// Helper: refillSoulDeck (server-side, Paragon only)
// Mirrors the goldfish client helper — tops up the shared LoB to 3
// soul-origin souls from the soul-deck. Ignores captured characters and
// LS tokens already in LoB (they don't count toward the rule of 3).
// ---------------------------------------------------------------------------
function refillSoulDeck(ctx: any, gameId: bigint) {
  const gameCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)];

  const lob = gameCards.filter((c: any) => c.zone === 'land-of-bondage');
  const inPlayOrigin = lob.filter((c: any) => c.isSoulDeckOrigin === true).length;
  const needed = 3 - inPlayOrigin;
  if (needed <= 0) return;

  const soulDeck = gameCards
    .filter((c: any) => c.ownerId === 0n && c.zone === 'soul-deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
  if (soulDeck.length === 0) return;

  // LoB index assignment — continue after current highest
  let maxLobIdx = -1n;
  for (const c of lob) {
    if (c.zoneIndex > maxLobIdx) maxLobIdx = c.zoneIndex;
  }

  const take = Math.min(needed, soulDeck.length);
  for (let i = 0; i < take; i++) {
    maxLobIdx = maxLobIdx + 1n;
    ctx.db.CardInstance.id.update({
      ...soulDeck[i],
      zone: 'land-of-bondage',
      zoneIndex: maxLobIdx,
      isFlipped: false,
    });
  }

  // Re-index remaining soul-deck cards to close gaps
  const remaining = soulDeck.slice(take);
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].zoneIndex !== BigInt(i)) {
      ctx.db.CardInstance.id.update({ ...remaining[i], zoneIndex: BigInt(i) });
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "feat(spacetime): add initialize_soul_deck + refillSoulDeck helpers"
```

---

### Task 12: Shared-owner auth + refill triggers in move reducers

**Files:**
- Modify: `spacetimedb/src/index.ts`

Context: today, the move-card reducers throw `SenderError('Not your card')` when `card.ownerId !== player.id`. For Paragon, a card with `ownerId === 0n` in a shared zone (`land-of-bondage` or `soul-deck`) must be actionable by either seat. On a rescue from LoB to a player's LoR/territory/etc., the card's ownership transfers to the rescuer. After any soul-origin leaves the LoB, `refillSoulDeck` must run.

Ownership check locations (grep results from survey): lines 1970, 2690, 2816, 2824. There are also filtered loops at 2461 that silently skip non-owned cards — these need to allow shared cards too.

- [ ] **Step 1: Add a `canSenderActOnCard` helper**

Place near other helpers (after `findPlayerBySender` around line 55):

```typescript
// ---------------------------------------------------------------------------
// Helper: canSenderActOnCard
// Normal cards: only the owner can act. Shared cards (ownerId = 0n) in a
// Paragon game can be acted on by either seat when the card is in a shared
// zone (land-of-bondage or soul-deck). Prevents cross-seat interference with
// player-owned cards while allowing both players to interact with the Soul
// Deck and shared LoB.
// ---------------------------------------------------------------------------
function canSenderActOnCard(game: any, card: any, player: any): boolean {
  if (card.ownerId === player.id) return true;
  if (card.ownerId !== 0n) return false;
  const fmt = normalizeFormat(game.format);
  if (fmt !== 'Paragon') return false;
  return card.zone === 'land-of-bondage' || card.zone === 'soul-deck';
}
```

- [ ] **Step 2: Replace `card.ownerId !== player.id` checks inside move reducers**

For every location that currently throws `SenderError('Not your card')` based on ownership inside move-card reducers, replace:

```typescript
if (card.ownerId !== player.id) throw new SenderError('Not your card');
```

with:

```typescript
if (!canSenderActOnCard(game, card, player)) throw new SenderError('Not your card');
```

Do this at: 1970, 2690, 2816 (loop inside `move_cards_batch`). For 2824 (second occurrence in same loop, sometimes `'Card not owned by player: ...'`), keep the detailed message wording but gate with the helper:

```typescript
if (!canSenderActOnCard(game, card, player)) throw new SenderError('Card not owned by player: ' + move.cardId);
```

For 2461 (inside a filter-type loop in batch-move that `continue`s on non-owned), update the condition to also allow shared cards:

```typescript
if (!canSenderActOnCard(game, card, player)) continue;
```

**Do NOT** update ownership checks inside reducers unrelated to zone movement (hand reveal, reserve operations on own-deck cards) — those should still require actual ownership.

- [ ] **Step 3: Add ownership transfer on rescue + refill trigger**

In `move_card` (the reducer that moves a single card — the one containing line 1443 `newOwnerId = targetOwnerId ? BigInt(targetOwnerId) : card.ownerId;`), find where `newOwnerId` is resolved. Add, immediately after it:

```typescript
    // Paragon: rescuing a shared soul transfers ownership to the acting seat.
    let resolvedOwnerId = newOwnerId;
    if (
      card.ownerId === 0n &&
      card.isSoulDeckOrigin === true &&
      card.zone === 'land-of-bondage' &&
      toZone !== 'land-of-bondage' &&
      toZone !== 'soul-deck'
    ) {
      resolvedOwnerId = player.id;
    }
```

Then use `resolvedOwnerId` where the reducer currently writes `newOwnerId` to the updated card row.

Finally, at the end of the `move_card` reducer (after the card has been written and any compacting runs), add:

```typescript
    // Paragon: if a soul-origin card left the shared LoB, refill back to 3.
    const triggeredRefill =
      card.isSoulDeckOrigin === true &&
      card.zone === 'land-of-bondage' &&
      toZone !== 'land-of-bondage';
    if (triggeredRefill) {
      refillSoulDeck(ctx, game.id);
    }
```

Apply the equivalent transfer + refill to `move_cards_batch` — inside the per-card loop, compute `resolvedOwnerId` per card using the same rule; after the loop, call `refillSoulDeck(ctx, game.id)` once if any soul-origin card was moved out of LoB.

- [ ] **Step 4: Call `refillSoulDeck` at turn-start phase transition**

Find the `advance_phase` or turn-end reducer (grep `currentPhase: 'draw'` writes that occur when a turn starts). When a turn transitions to the draw phase for either seat, call:

```typescript
    if (normalizeFormat(game.format) === 'Paragon') {
      refillSoulDeck(ctx, game.id);
    }
```

**Note to implementer:** grep in `spacetimedb/src/index.ts` for `'draw'` phase writes and identify the reducer that advances turns (likely `end_turn` / `advance_phase`). Add the refill there, AFTER the phase update commits. Choose a single location — the one that represents the new active player starting their turn — so refill doesn't double-fire.

- [ ] **Step 5: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "feat(spacetime): auth shared cards for both seats, transfer ownership on rescue, refill on turn start and post-move"
```

---

### Task 13: Deploy SpacetimeDB module and regenerate bindings

**Files:**
- Runs: `spacetimedb-deploy` skill (publishes + regenerates client bindings)

- [ ] **Step 1: Invoke the `spacetimedb-deploy` skill**

Do NOT run `spacetime publish` manually. Use the skill — it encapsulates the deploy steps and is how this project has standardized SpacetimeDB changes.

After deploy: verify the module is live by pulling logs:

Run: `spacetime logs <db-name> --num-lines 20`
Expected: recent entries showing the module has been published without errors.

- [ ] **Step 2: Check generated bindings updated**

Run: `git status spacetimedb/module_bindings/ client/src/module_bindings/` (use whichever path the project uses — the skill will tell you)
Expected: the bindings show `isSoulDeckOrigin` added to `CardInstance` row type.

- [ ] **Step 3: Commit the regenerated bindings**

```bash
git add <bindings-directories>
git commit -m "chore(spacetime): regenerate client bindings after soul deck schema change"
```

---

## Phase 5 — Multiplayer UI

### Task 14: Multiplayer layout — shared centered LoB + Soul Deck pile when Paragon

**Files:**
- Modify: `app/play/layout/multiplayerLayout.ts`

- [ ] **Step 1: Accept a format parameter**

Change the signature of `calculateMultiplayerLayout`:

```typescript
export function calculateMultiplayerLayout(
  stageWidth: number,
  stageHeight: number,
  format: 'T1' | 'T2' | 'Paragon' = 'T1',
): MultiplayerLayout {
```

Update the `MultiplayerLayout` interface `zones` property to add an optional shared LoB zone and a soul-deck pile:

```typescript
  zones: {
    opponentHand: ZoneRect;
    opponentTerritory: ZoneRect;
    opponentLob: ZoneRect;
    divider: ZoneRect;
    playerLob: ZoneRect;
    playerTerritory: ZoneRect;
    playerHand: ZoneRect;
    sharedLob?: ZoneRect;     // NEW — present when Paragon
    soulDeck?: ZoneRect;      // NEW — present when Paragon
  };
```

- [ ] **Step 2: Build the Paragon layout branch**

Inside `calculateMultiplayerLayout`, at the point where the per-seat LoB rects are finalized (after `playerLob` definition, around line 363), add:

```typescript
  // Paragon: collapse both per-seat LoBs into a single shared band sitting
  // on top of the center divider. Soul Deck pile anchors the left end.
  let sharedLob: ZoneRect | undefined;
  let soulDeck: ZoneRect | undefined;
  if (format === 'Paragon') {
    const sharedBandY = oppTerritoryY + oppTerritoryHeight + gap;
    const sharedBandHeight = oppLobHeight + dividerHeight + playerLobHeight - gap * 2;
    const soulDeckWidth = Math.round(Math.min(100, (playAreaWidth - pad * 2) * 0.12));
    sharedLob = {
      x: pad + soulDeckWidth + 4,
      y: sharedBandY,
      width: playAreaWidth - pad * 2 - soulDeckWidth - 4,
      height: sharedBandHeight,
      label: 'Land of Bondage (Shared)',
    };
    soulDeck = {
      x: pad,
      y: sharedBandY,
      width: soulDeckWidth,
      height: sharedBandHeight,
      label: 'Soul Deck',
    };
  }
```

- [ ] **Step 3: Include in the return value**

At the end of `calculateMultiplayerLayout`, adjust the returned `zones` object to include the new entries:

```typescript
    zones: {
      opponentHand,
      opponentTerritory,
      opponentLob,
      divider,
      playerLob,
      playerTerritory,
      playerHand,
      sharedLob,
      soulDeck,
    },
```

- [ ] **Step 4: Update the single caller to pass the format**

In `app/play/components/MultiplayerCanvas.tsx`, find the call to `calculateMultiplayerLayout(` and pass the game's format as the third argument:

```bash
grep -n "calculateMultiplayerLayout" app/play/components/MultiplayerCanvas.tsx
```

Pass `game.format` (or whatever the local state name is — the game row includes a `format` string; normalize it via `normalizeFormatClient()` if that helper exists, otherwise pass as-is and let the layout's own loose comparison handle it).

- [ ] **Step 5: Commit**

```bash
git add app/play/layout/multiplayerLayout.ts app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(play): centered shared LoB + Soul Deck slot in multiplayer layout for Paragon"
```

---

### Task 15: Multiplayer canvas — render shared LoB + Soul Deck pile

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

Context: the existing canvas currently renders `opponentLob` and `playerLob` as two distinct rects. In Paragon, we want to:
- NOT render `opponentLob` / `playerLob` (both empty of player-owned cards when shared).
- Render `sharedLob` and place every LoB card (from either seat's filter) inside it.
- Render the Soul Deck pile with the back image.
- Wire up right-click on the Soul Deck pile to the shared `DeckContextMenu` with the same hide flags used in goldfish (Task 9).

- [ ] **Step 1: Import SOUL_DECK_BACK_IMG + refactor LoB rendering branch**

Add import at the top:

```typescript
import { SOUL_DECK_BACK_IMG } from '@/app/shared/paragon/soulDeck';
```

Inside the canvas render, find the section that maps `opponentLob` + `playerLob` cards to Konva nodes. Add a branch:

```tsx
{game.format === 'Paragon' && layout.zones.sharedLob ? (
  <SharedLobRenderer
    zone={layout.zones.sharedLob}
    cards={cards.filter(c => c.zone === 'land-of-bondage')}
    mySeatPlayerId={mySeatPlayerId}
  />
) : (
  <>
    <OpponentLobRenderer ... />
    <PlayerLobRenderer ... />
  </>
)}
```

**Note to implementer:** Use whatever rendering approach the file already uses — don't add new helper components if none exist. Adapt the shape to match the file's conventions.

- [ ] **Step 2: Render the Soul Deck pile**

Next to the shared LoB rendering, add:

```tsx
{game.format === 'Paragon' && layout.zones.soulDeck && (
  <SoulDeckPileRenderer
    zone={layout.zones.soulDeck}
    count={cards.filter(c => c.zone === 'soul-deck').length}
    onContextMenu={handleSharedSoulDeckContextMenu}
  />
)}
```

The `SoulDeckPileRenderer` should draw a `<Rect>` frame + a `<Image>` using `SOUL_DECK_BACK_IMG` as the source + a count badge. Mirror the existing pile-rendering code for `playerSidebar.deck`.

- [ ] **Step 3: Wire the Soul Deck context menu + reducer calls**

Add `handleSharedSoulDeckContextMenu` similar to the opponent-deck handler, pointing to a `DeckContextMenu` instance with:

```tsx
<DeckContextMenu
  x={...} y={...}
  deckSize={soulDeckCount}
  hideDrawActions
  hideDiscardActions
  hideReserveActions
  onSearchDeck={() => conn.reducers.searchSoulDeck({ gameId })}
  onShuffleDeck={() => conn.reducers.shuffleSoulDeck({ gameId })}
  onRevealTop={(n) => conn.reducers.revealFromSoulDeck({ gameId, position: 'top', count: BigInt(n) })}
  onRevealBottom={(n) => conn.reducers.revealFromSoulDeck({ gameId, position: 'bottom', count: BigInt(n) })}
  onRevealRandom={(n) => conn.reducers.revealFromSoulDeck({ gameId, position: 'random', count: BigInt(n) })}
  onLookAtTop={(n) => conn.reducers.lookAtSoulDeck({ gameId, position: 'top', count: BigInt(n) })}
  onLookAtBottom={(n) => conn.reducers.lookAtSoulDeck({ gameId, position: 'bottom', count: BigInt(n) })}
  onLookAtRandom={(n) => conn.reducers.lookAtSoulDeck({ gameId, position: 'random', count: BigInt(n) })}
  /* Hidden rows still need no-op handlers so the types compile */
  onDrawTop={() => {}} onDrawBottom={() => {}} onDrawRandom={() => {}}
  onDiscardTop={() => {}} onDiscardBottom={() => {}} onDiscardRandom={() => {}}
  onReserveTop={() => {}} onReserveBottom={() => {}} onReserveRandom={() => {}}
  onClose={() => setContextMenu(null)}
/>
```

**IMPORTANT:** If `searchSoulDeck`, `shuffleSoulDeck`, `revealFromSoulDeck`, `lookAtSoulDeck` reducers do not yet exist in `spacetimedb/src/index.ts`, wire them up by *reusing the existing zone-search / reveal / shuffle reducers* — pass them `zone: 'soul-deck'` where the existing reducer already accepts an arbitrary zone string. Only add new reducers if the existing ones hard-code `'deck'`. In that case, take the smallest possible diff — parameterize zone and update callers.

Before adding new reducers, grep:

```bash
grep -n "reveal_from\|reveal_deck\|shuffle_deck\|search_deck\|look_at" spacetimedb/src/index.ts
```

If these accept a `zone` or `targetOwnerId` parameter, use them as-is. If not, that's a schema/reducer addition — add a task for that under this one (or defer per Step 4 below).

- [ ] **Step 4: If new reducers are needed, add them and redeploy**

Any new reducer must:
- Be gated on `normalizeFormat(game.format) === 'Paragon'`.
- Operate on `zone === 'soul-deck'` with `ownerId === 0n`.
- Use the game's seeded PRNG via `makeSeed(...)` + `seededShuffle` (shuffle) or `xorshift64` (random index).
- Call `refillSoulDeck(ctx, game.id)` if they cause a soul-origin card to leave LoB.

After adding: redeploy using the `spacetimedb-deploy` skill, then `git add` the regenerated bindings and commit.

- [ ] **Step 5: Manual verification (two windows)**

Run: `npm run dev`
Open two browser windows, sign in as two different accounts, create a Paragon-format multiplayer game:

Verify:
- Both windows show a single centered shared Land of Bondage after game start.
- The Soul Deck pile shows `Lost Soul Back.png` and a count badge of 18.
- The shared LoB has exactly 3 face-up souls at turn 1.
- Rescuing a soul (drag to my LoR) works from either seat, and both windows see refill happen.
- Right-click on the Soul Deck in either window opens the menu without Draw/Discard/Reserve rows.

- [ ] **Step 6: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(play): render shared LoB + Soul Deck pile and wire reducers for Paragon"
```

---

## Final verification

- [ ] **Run the full test suite**

```bash
npx vitest run
```

Expected: all tests pass, including the three new Paragon test files.

- [ ] **Production build**

```bash
npm run build
```

Expected: successful compile with no TypeScript errors.

- [ ] **End-to-end smoke tests**

1. Goldfish, T1 deck: no Soul Deck pile visible, LoB works as before.
2. Goldfish, Paragon deck: 3 souls in LoB, 18 in soul deck, rescue refill fires, turn-end refill is idempotent.
3. Multiplayer, T1 deck: two per-seat LoBs render as before.
4. Multiplayer, Paragon deck: single shared LoB, both players can rescue souls, refill syncs across windows.

---

## Notes for implementer

- **Why the split of rescue-detection between goldfish and spacetime:** Goldfish detects "left LoB and soul-origin" at the end of the single reducer case. SpacetimeDB runs move-card as a reducer that may span several rows; the refill call goes at the end after the primary write. Keep the check: `card.isSoulDeckOrigin === true && card.zone === 'land-of-bondage' && toZone !== 'land-of-bondage'`.
- **Why `ownerId: 'player1'` (not `'player2'`) in goldfish rescue:** goldfish is single-player. Only player1 exists as a seat. The `'shared'` sentinel exists for architectural symmetry and for the rare case where future code inspects ownership before rescue.
- **Why `normalizeFormat` on server but a plain `format` prop on client:** the `game.format` column in SpacetimeDB stores raw deck format strings (e.g., `"Paragon Type 1"`). `normalizeFormat` collapses them. The goldfish client has already normalized via `parseFormat` in `gameInitializer` and exposes `state.format` as `'T1' | 'T2' | 'Paragon'` — no further normalization needed.
- **Do not add Paragon souls to `lib/cards/lookup.ts`** — spec Q2 explicitly excludes them. Keep souls discoverable only via the soul-deck zone / shared LoB.
- **Skill handoff:** SpacetimeDB publishing and binding regeneration MUST go through the `spacetimedb-deploy` skill (Task 13 and as needed in Task 15 Step 4).
