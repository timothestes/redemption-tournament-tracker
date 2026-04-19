# Per-Card Custom Abilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a per-card custom-ability system for the goldfish practice mode (PR 1) and the SpacetimeDB multiplayer mode (PR 2), starting with a `spawn_token` ability that lets players right-click cards like *Two Possessed (GoC)* to atomically spawn one or more named token cards.

**Architecture:** A single shared TypeScript registry maps each card's `identifier` to an array of typed abilities. The shared `CardContextMenu` reads the registry and renders one menu item per ability. Goldfish dispatches via a new reducer action; multiplayer dispatches via a new SpacetimeDB reducer that re-reads the registry server-side for authority. Both paths are atomic — either all tokens spawn or none do. Future ability kinds (shuffle-and-draw, counter manipulations, `custom` escape hatch) slot into the same dispatch without refactoring.

**Tech Stack:** TypeScript, React 19, Next.js 15 App Router, Vitest, SpacetimeDB 1.11 (TypeScript module), shared `GameActions` interface at `app/shared/types/gameActions.ts`.

**Spec:** [`docs/superpowers/specs/2026-04-18-card-custom-abilities-design.md`](../specs/2026-04-18-card-custom-abilities-design.md)

---

## File Structure

**PR 1 — Goldfish (new files):**
- `lib/cards/cardAbilities.ts` — the ability registry, types, and label helper.
- `lib/cards/__tests__/cardAbilities.test.ts` — registry integrity tests.
- `app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts` — reducer tests for `EXECUTE_CARD_ABILITY` + `spawnTokenInState`.

**PR 1 — Goldfish (modified):**
- `app/shared/types/gameActions.ts` — add optional `executeCardAbility` method.
- `app/shared/types/gameCard.ts` — add `EXECUTE_CARD_ABILITY` to `ActionType`; add `abilityIndex?` to `GameAction.payload`.
- `app/goldfish/state/gameActions.ts` — new action creator `executeCardAbility`.
- `app/goldfish/state/gameReducer.ts` — new `EXECUTE_CARD_ABILITY` case + `spawnTokenInState` helper.
- `app/goldfish/state/GameContext.tsx` — wire `executeCardAbility` into the context.
- `app/shared/components/CardContextMenu.tsx` — render one menu item per registered ability at the top of the menu.

**PR 2 — Multiplayer (modified):**
- `spacetimedb/src/schema.ts` — add `isToken: t.bool()` to `CardInstance`.
- `spacetimedb/src/index.ts` — new `execute_card_ability` reducer + `spawnTokenImpl` helper; extend `move_card` with token cleanup branch.
- `lib/spacetimedb/module_bindings/` — regenerated via `spacetime generate` (never hand-edited).
- `app/play/hooks/useGameState.ts` — wire `executeCardAbility` through the multiplayer `GameActions` adapter.

---

# PR 1 — Goldfish

## Task 1: Create the ability registry

**Files:**
- Create: `lib/cards/cardAbilities.ts`

- [ ] **Step 1: Create the registry file**

```ts
// lib/cards/cardAbilities.ts
import type { ZoneId } from '@/app/shared/types/gameCard';

export type CardAbility =
  | { type: 'spawn_token'; tokenName: string; count?: number; defaultZone?: ZoneId }
  | { type: 'shuffle_and_draw'; shuffleCount: number; drawCount: number }
  | { type: 'custom'; reducerName: string; label: string };

/**
 * Registry keyed by CardData.identifier (see lib/cards/lookup.ts).
 * Each entry lists the abilities exposed on that card's right-click menu.
 * `count` defaults to 1 when omitted; cards that spawn multiple tokens per
 * effect set count explicitly so one click produces all of them atomically.
 */
export const CARD_ABILITIES: Record<string, CardAbility[]> = {
  'Two Possessed (GoC)':        [{ type: 'spawn_token', tokenName: 'Violent Possessor Token', count: 2 }],
  'The Accumulator (GoC)':      [{ type: 'spawn_token', tokenName: 'Wicked Spirit Token' }],
  'The Proselytizers (GoC)':    [{ type: 'spawn_token', tokenName: 'Proselyte Token' }],
  'The Church of Christ (GoC)': [{ type: 'spawn_token', tokenName: 'Follower Token' }],
  'Angel of the Harvest (GoC)': [{ type: 'spawn_token', tokenName: 'Heavenly Host Token' }],
  'The Heavenly Host (GoC)':    [{ type: 'spawn_token', tokenName: 'Heavenly Host Token' }],
};

export function getAbilitiesForCard(identifier: string): CardAbility[] {
  return CARD_ABILITIES[identifier] ?? [];
}

export function abilityLabel(a: CardAbility): string {
  switch (a.type) {
    case 'spawn_token': {
      const n = a.count ?? 1;
      return n > 1 ? `Create ${n}× ${a.tokenName}` : `Create ${a.tokenName}`;
    }
    case 'shuffle_and_draw':
      return `Shuffle ${a.shuffleCount} from hand, draw ${a.drawCount}`;
    case 'custom':
      return a.label;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/cards/cardAbilities.ts
git commit -m "feat(cards): add per-card ability registry"
```

---

## Task 2: Registry integrity tests

**Files:**
- Create: `lib/cards/__tests__/cardAbilities.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/cards/__tests__/cardAbilities.test.ts
import { describe, it, expect } from 'vitest';
import { findCard } from '../lookup';
import { CARD_ABILITIES, abilityLabel, getAbilitiesForCard } from '../cardAbilities';

describe('CARD_ABILITIES registry', () => {
  it('every key resolves to a real card via findCard()', () => {
    const bad: string[] = [];
    for (const identifier of Object.keys(CARD_ABILITIES)) {
      if (!findCard(identifier)) bad.push(identifier);
    }
    expect(bad).toEqual([]);
  });

  it('every spawn_token.tokenName resolves to a real card via findCard()', () => {
    const bad: Array<{ source: string; tokenName: string }> = [];
    for (const [source, abilities] of Object.entries(CARD_ABILITIES)) {
      for (const a of abilities) {
        if (a.type === 'spawn_token' && !findCard(a.tokenName)) {
          bad.push({ source, tokenName: a.tokenName });
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('getAbilitiesForCard returns [] for unknown identifiers', () => {
    expect(getAbilitiesForCard('Nonexistent Card')).toEqual([]);
  });
});

describe('abilityLabel', () => {
  it('formats singular spawn_token without multiplier', () => {
    expect(abilityLabel({ type: 'spawn_token', tokenName: 'Proselyte Token' }))
      .toBe('Create Proselyte Token');
  });

  it('formats spawn_token with count > 1 using ×N prefix', () => {
    expect(abilityLabel({ type: 'spawn_token', tokenName: 'Violent Possessor Token', count: 2 }))
      .toBe('Create 2× Violent Possessor Token');
  });

  it('formats shuffle_and_draw', () => {
    expect(abilityLabel({ type: 'shuffle_and_draw', shuffleCount: 6, drawCount: 6 }))
      .toBe('Shuffle 6 from hand, draw 6');
  });

  it('uses explicit label for custom abilities', () => {
    expect(abilityLabel({ type: 'custom', reducerName: 'foo', label: 'Do Thing' }))
      .toBe('Do Thing');
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run lib/cards/__tests__/cardAbilities.test.ts`
Expected: all 7 tests pass. The registry entries should all resolve because every token was confirmed present in `carddata.txt` during spec prep.

- [ ] **Step 3: Commit**

```bash
git add lib/cards/__tests__/cardAbilities.test.ts
git commit -m "test(cards): registry integrity + label formatter tests"
```

---

## Task 3: Extend shared action types

**Files:**
- Modify: `app/shared/types/gameCard.ts:88-135`

- [ ] **Step 1: Add `EXECUTE_CARD_ABILITY` to the ActionType union**

Find the `ActionType` union (around line 88-114) and add `'EXECUTE_CARD_ABILITY'` as a new member. The updated union:

```ts
export type ActionType =
  | 'MOVE_CARD'
  | 'DRAW_CARD'
  | 'DRAW_MULTIPLE'
  | 'SHUFFLE_DECK'
  | 'SHUFFLE_SOUL_DECK'
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
  | 'DETACH_CARD'
  | 'EXECUTE_CARD_ABILITY';
```

- [ ] **Step 2: Add `abilityIndex` to the shared payload**

Find the `GameAction.payload` interface (around line 121-134) and add the new optional field:

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
    abilityIndex?: number;
  };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no new errors in `app/shared/types/gameCard.ts`. (Pre-existing errors in the rest of the repo are out of scope — rerun on a clean branch to compare if unsure.)

- [ ] **Step 4: Commit**

```bash
git add app/shared/types/gameCard.ts
git commit -m "feat(types): reserve EXECUTE_CARD_ABILITY action + abilityIndex payload"
```

---

## Task 4: Add `executeCardAbility` to the `GameActions` interface

**Files:**
- Modify: `app/shared/types/gameActions.ts:28-40`

- [ ] **Step 1: Add the method signature**

Append to the interface, right after the existing token operations block:

```ts
  // Token operations (optional — not all modes may support)
  spawnLostSoul?(testament: 'NT' | 'OT', posX?: string, posY?: string): void;
  removeToken?(cardId: string): void;
  removeOpponentToken?(cardId: string): void;

  // Custom per-card abilities (optional — registry-driven right-click actions).
  // Implemented by both goldfish and multiplayer. See lib/cards/cardAbilities.ts.
  executeCardAbility?(sourceInstanceId: string, abilityIndex: number): void;
```

The method is marked optional (`?`) so the multiplayer adapter can ship in PR 2 without tripping type-checks in PR 1.

- [ ] **Step 2: Commit**

```bash
git add app/shared/types/gameActions.ts
git commit -m "feat(types): add optional executeCardAbility to GameActions"
```

---

## Task 5: Goldfish reducer TDD — write the failing tests

**Files:**
- Create: `app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts`

These tests exercise `EXECUTE_CARD_ABILITY` end-to-end through the reducer. They'll fail until Task 6 adds the case.

- [ ] **Step 1: Write the tests**

```ts
// app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts
import { describe, it, expect } from 'vitest';
import { gameReducer } from '../gameReducer';
import { actions } from '../gameActions';
import type { GameCard, GameState, ZoneId } from '../../types';

function makeCard(overrides: Partial<GameCard>): GameCard {
  return {
    instanceId: 'source-1',
    cardName: 'Two Possessed',
    cardSet: 'GoC',
    cardImgFile: 'two-possessed.png',
    type: 'EC',
    brigade: '',
    strength: '',
    toughness: '',
    specialAbility: '',
    identifier: 'Two Possessed (GoC)',
    reference: '',
    alignment: 'Evil',
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
    'land-of-bondage': [], 'soul-deck': [], territory: [], 'land-of-redemption': [], banish: [],
  };
  for (const c of cards) zones[c.zone].push(c);
  return {
    zones,
    history: [],
    turn: 1,
    phase: 'preparation',
  } as GameState;
}

describe('EXECUTE_CARD_ABILITY — spawn_token', () => {
  it('Two Possessed spawns 2 Violent Possessor Tokens in the same zone', () => {
    const source = makeCard({ zone: 'territory', identifier: 'Two Possessed (GoC)' });
    const state = makeState([source]);

    const next = gameReducer(state, actions.executeCardAbility('source-1', 0));

    expect(next.zones.territory).toHaveLength(3); // source + 2 tokens
    const tokens = next.zones.territory.filter(c => c.isToken);
    expect(tokens).toHaveLength(2);
    expect(tokens.every(t => t.cardName === 'Violent Possessor Token')).toBe(true);
    expect(tokens.every(t => t.ownerId === 'player1')).toBe(true);
    // Fresh unique instanceIds
    expect(tokens[0].instanceId).not.toEqual(tokens[1].instanceId);
    expect(tokens[0].instanceId).not.toEqual('source-1');
  });

  it('single-count ability spawns exactly one token', () => {
    const source = makeCard({ identifier: 'The Proselytizers (GoC)', cardName: 'The Proselytizers' });
    const state = makeState([source]);

    const next = gameReducer(state, actions.executeCardAbility('source-1', 0));

    const tokens = next.zones.territory.filter(c => c.isToken);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].cardName).toBe('Proselyte Token');
  });

  it('spawn from a non-play zone falls back to territory', () => {
    const source = makeCard({ zone: 'hand', identifier: 'The Proselytizers (GoC)' });
    const state = makeState([source]);

    const next = gameReducer(state, actions.executeCardAbility('source-1', 0));

    const tokens = next.zones.territory.filter(c => c.isToken);
    expect(tokens).toHaveLength(1);
    expect(next.zones.hand.filter(c => c.isToken)).toHaveLength(0);
  });

  it('unknown source instanceId is a no-op (returns same state reference)', () => {
    const state = makeState([makeCard({})]);
    const next = gameReducer(state, actions.executeCardAbility('does-not-exist', 0));
    expect(next).toBe(state);
  });

  it('out-of-range abilityIndex is a no-op (returns same state reference)', () => {
    const source = makeCard({ identifier: 'Two Possessed (GoC)' });
    const state = makeState([source]);
    const next = gameReducer(state, actions.executeCardAbility('source-1', 99));
    expect(next).toBe(state);
  });

  it('card with no registered abilities is a no-op', () => {
    const source = makeCard({ identifier: 'No Such Ability Card' });
    const state = makeState([source]);
    const next = gameReducer(state, actions.executeCardAbility('source-1', 0));
    expect(next).toBe(state);
  });

  it('ownerId is inherited from source (player2 source → player2 tokens)', () => {
    const source = makeCard({ ownerId: 'player2', identifier: 'The Proselytizers (GoC)' });
    const state = makeState([source]);
    const next = gameReducer(state, actions.executeCardAbility('source-1', 0));
    const tokens = next.zones.territory.filter(c => c.isToken);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].ownerId).toBe('player2');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts`
Expected: all tests fail. Most common failure is `actions.executeCardAbility is not a function` and/or tokens not being created because the reducer has no `EXECUTE_CARD_ABILITY` case. Do NOT proceed until you see the failures.

- [ ] **Step 3: Commit the failing tests**

```bash
git add app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts
git commit -m "test(goldfish): failing tests for EXECUTE_CARD_ABILITY reducer case"
```

---

## Task 6: Implement the action creator + reducer case

**Files:**
- Modify: `app/goldfish/state/gameActions.ts` (add action creator)
- Modify: `app/goldfish/state/gameReducer.ts` (add case + `spawnTokenInState` helper)

- [ ] **Step 1: Add the action creator**

Append to the `actions` object in `app/goldfish/state/gameActions.ts`, right after `detachCard` or wherever fits chronologically:

```ts
  executeCardAbility(cardInstanceId: string, abilityIndex: number): GameAction {
    return createAction('EXECUTE_CARD_ABILITY', { cardInstanceId, abilityIndex });
  },
```

- [ ] **Step 2: Add imports and the `spawnTokenInState` helper to the reducer**

Open `app/goldfish/state/gameReducer.ts`. At the top of the file alongside existing imports, add:

```ts
import { findCard } from '@/lib/cards/lookup';
import {
  type CardAbility,
  getAbilitiesForCard,
} from '@/lib/cards/cardAbilities';
```

Then, below `cloneZones` (around line 33-40) but above the reducer function, add this helper:

```ts
const PLAY_ZONES: ReadonlyArray<ZoneId> = ['territory', 'land-of-bondage', 'land-of-redemption'];

function spawnTokenInState(
  state: GameState,
  source: GameCard,
  ability: Extract<CardAbility, { type: 'spawn_token' }>,
): GameState {
  // Phase 1 — validate. Any failure returns state unchanged.
  const tokenData = findCard(ability.tokenName);
  if (!tokenData) {
    console.warn('[cardAbilities] unknown token', ability.tokenName);
    return state;
  }
  const count = ability.count ?? 1;
  if (count < 1) return state;

  const targetZone: ZoneId = PLAY_ZONES.includes(source.zone)
    ? source.zone
    : (ability.defaultZone ?? 'territory');

  // Phase 2 — build all new cards in memory. No state mutation yet.
  const newCards: GameCard[] = Array.from({ length: count }, () => ({
    instanceId: crypto.randomUUID(),
    cardName: tokenData.name,
    cardSet: tokenData.set,
    cardImgFile: tokenData.imgFile,
    type: tokenData.type,
    brigade: tokenData.brigade ?? '',
    strength: tokenData.strength ?? '',
    toughness: tokenData.toughness ?? '',
    specialAbility: tokenData.specialAbility ?? '',
    identifier: tokenData.identifier ?? '',
    reference: tokenData.reference ?? '',
    alignment: tokenData.alignment ?? '',
    isMeek: false,
    counters: [],
    isFlipped: false,
    isToken: true,
    zone: targetZone,
    ownerId: source.ownerId,
    notes: '',
  }));

  // Phase 3 — commit in a single shallow clone.
  const zones = cloneZones(state.zones);
  zones[targetZone] = [...zones[targetZone], ...newCards];
  return { ...state, zones };
}
```

- [ ] **Step 3: Add the reducer case**

Inside the reducer's `switch (action.type)` block, add a new case. Insert alongside the other token-related cases (near `ADD_OPPONENT_LOST_SOUL` at line 484, but place it after the `DETACH_CARD` case or wherever keeps alphabetical/logical ordering consistent with the file):

```ts
    case 'EXECUTE_CARD_ABILITY': {
      const { cardInstanceId, abilityIndex } = action.payload;
      if (!cardInstanceId || abilityIndex === undefined) return state;

      // Locate the source across all zones.
      let source: GameCard | undefined;
      for (const zone of Object.values(state.zones)) {
        const found = zone.find(c => c.instanceId === cardInstanceId);
        if (found) { source = found; break; }
      }
      if (!source) return state;

      const ability = getAbilitiesForCard(source.identifier)[abilityIndex];
      if (!ability) return state;

      switch (ability.type) {
        case 'spawn_token':
          return spawnTokenInState(state, source, ability);
        case 'shuffle_and_draw':
          // Reserved for future — v1 ships spawn_token only.
          return state;
        case 'custom':
          // Custom abilities are dispatched client-side in multiplayer and
          // never reach the goldfish reducer in v1. No-op defensively.
          return state;
      }
      return state;
    }
```

- [ ] **Step 4: Run the failing tests — they should now pass**

Run: `npx vitest run app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts`
Expected: all 7 tests pass.

- [ ] **Step 5: Run the full goldfish reducer suite for regressions**

Run: `npx vitest run app/goldfish/state/__tests__`
Expected: all tests pass, including the pre-existing paragon and equip suites.

- [ ] **Step 6: Commit**

```bash
git add app/goldfish/state/gameActions.ts app/goldfish/state/gameReducer.ts
git commit -m "feat(goldfish): EXECUTE_CARD_ABILITY reducer + spawn_token dispatch"
```

---

## Task 7: Wire `executeCardAbility` through the goldfish context

**Files:**
- Modify: `app/goldfish/state/GameContext.tsx`

- [ ] **Step 1: Locate the context interface**

Open `app/goldfish/state/GameContext.tsx`. Find the context interface where methods like `addOpponentLostSoul` are declared (around line 31). The file also exports a provider that wraps each method in a `useCallback`.

- [ ] **Step 2: Add the method to the context interface**

Insert after `removeOpponentToken: (cardInstanceId: string) => void;`:

```ts
  executeCardAbility: (cardInstanceId: string, abilityIndex: number) => void;
```

- [ ] **Step 3: Add the memoized handler**

Scroll to where `removeOpponentToken` is wrapped in `useCallback` (around line 128). Add the parallel handler just after it:

```ts
  const executeCardAbility = useCallback(
    (cardInstanceId: string, abilityIndex: number) =>
      dispatch(actions.executeCardAbility(cardInstanceId, abilityIndex)),
    [dispatch]
  );
```

- [ ] **Step 4: Include it in the context value**

Find the `useMemo(() => ({...}), [...])` block (around lines 186-207). Add `executeCardAbility` to both the object literal and the dependency array:

```ts
      // … other fields …
      removeOpponentToken,
      executeCardAbility,
      moveCardsBatch,
      // …
```

And the deps array:

```ts
      addNote, addOpponentLostSoul, removeOpponentToken, executeCardAbility,
      moveCardsBatch, addPlayerLostSoul, reorderHand, reorderLob, attachCard,
      detachCard, toggleSpreadHand,
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit` (or run `npm run dev` and confirm no type errors surface).

- [ ] **Step 6: Commit**

```bash
git add app/goldfish/state/GameContext.tsx
git commit -m "feat(goldfish): expose executeCardAbility via GameContext"
```

---

## Task 8: Render ability items in the shared context menu

**Files:**
- Modify: `app/shared/components/CardContextMenu.tsx`

The menu already receives `card` and `actions: GameActions`. Abilities render at the top of the menu, above the existing items.

- [ ] **Step 1: Import the registry helpers**

At the top of `app/shared/components/CardContextMenu.tsx`, add:

```ts
import { getAbilitiesForCard, abilityLabel } from '@/lib/cards/cardAbilities';
```

- [ ] **Step 2: Compute abilities once per render**

Inside the component, right after the props are destructured, compute:

```tsx
  const abilities = getAbilitiesForCard(card.identifier);
  // In multiplayer, hide abilities on opponent cards — matches the existing
  // opponent-token simplified-menu pattern in this file (around lines 145-172).
  // Goldfish is single-seat (everything is "yours"), so this is effectively
  // always true there. Re-use whatever ownership predicate the file already
  // has; if none exists yet, fall back to `true`.
  const isOwnedByLocalPlayer = true; // TODO(plan Task 16): replace with the file's owner predicate when PR 2 lands
  const canExecuteAbilities =
    abilities.length > 0 &&
    typeof actions.executeCardAbility === 'function' &&
    isOwnedByLocalPlayer;
```

If the shared component already threads an `isLocalPlayerCard` (or similar) prop, replace the `true` fallback with it during the edit. Otherwise leave the fallback as `true` — the server still rejects unauthorized `execute_card_ability` calls in multiplayer (Task 12, `SenderError('Not your card')`), so this is a UX polish, not a security boundary.

- [ ] **Step 3: Render the abilities section at the top of the menu**

Find the outermost menu `<div>` (the one with `position: 'fixed'` and the grey background). Insert this block as the first child, before the existing meek/flip/counter items:

```tsx
      {canExecuteAbilities && (
        <>
          {abilities.map((ability, index) => (
            <button
              key={index}
              type="button"
              onClick={() => {
                actions.executeCardAbility?.(card.instanceId, index);
                onClose();
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 12px',
                background: 'transparent',
                border: 'none',
                color: 'var(--gf-fg, inherit)',
                textAlign: 'left',
                cursor: 'pointer',
                font: 'inherit',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--gf-bg-hover, rgba(255,255,255,0.06))')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {abilityLabel(ability)}
            </button>
          ))}
          <hr style={{ margin: '4px 0', border: 'none', borderTop: '1px solid var(--gf-border)' }} />
        </>
      )}
```

Match the existing menu item's styling conventions in this file — if the file already uses a shared `MenuItem` component or class name, use that instead of inline styles. (Read the existing items in the same file before pasting; the block above is the visual pattern but should be adapted to the file's actual component style if one exists.)

- [ ] **Step 4: Run dev server and verify in browser**

Run: `npm run dev`
Open goldfish, import any deck, move one of these cards into play: *Two Possessed (GoC)*, *The Proselytizers (GoC)*, *The Church of Christ (GoC)*, *Angel of the Harvest (GoC)*, *The Heavenly Host (GoC)*, or *The Accumulator (GoC)*. Right-click the card.

Expected: the first menu item reads "Create 2× Violent Possessor Token" (for Two Possessed) or "Create <TokenName>" for the others, followed by a divider, then the existing meek/flip/counter items.

Clicking "Create 2× Violent Possessor Token" should drop two Violent Possessor Tokens next to Two Possessed in the Battle Area / Territory, each displaying the existing TOKEN badge rendered by `GameCardNode.tsx` (already implemented at lines 247-280).

- [ ] **Step 5: Commit**

```bash
git add app/shared/components/CardContextMenu.tsx
git commit -m "feat(ui): render per-card abilities at top of right-click menu"
```

---

## Task 9: Manual QA pass for goldfish

**Files:** none — this is pure verification.

- [ ] **Step 1: Test each registered card**

For each source card, drag into Territory / Battle Area and right-click. Verify the menu label and spawn behavior:

- [ ] *Two Possessed (GoC)* → "Create 2× Violent Possessor Token" → 2 tokens appear.
- [ ] *The Accumulator (GoC)* → "Create Wicked Spirit Token" → 1 token.
- [ ] *The Proselytizers (GoC)* → "Create Proselyte Token" → 1 token.
- [ ] *The Church of Christ (GoC)* → "Create Follower Token" → 1 token.
- [ ] *Angel of the Harvest (GoC)* → "Create Heavenly Host Token" → 1 token.
- [ ] *The Heavenly Host (GoC)* → "Create Heavenly Host Token" → 1 token.

- [ ] **Step 2: Verify fallback zone**

Move *The Proselytizers* to your Hand. Right-click it (if right-click on hand cards is supported in goldfish) → the token should appear in Territory, not in Hand. (If Hand doesn't support right-click, drag the source to the reserve/discard area and confirm the same.)

- [ ] **Step 3: Verify atomicity**

Temporarily break the registry by editing `lib/cards/cardAbilities.ts` to point Two Possessed at a nonexistent token: `tokenName: 'NonexistentToken'`. Right-click Two Possessed — no tokens should appear, no partial spawn. Revert the edit.

- [ ] **Step 4: Verify cleanup**

Spawn a Violent Possessor Token. Drag it into your Discard. It should disappear (handled by the existing `gameReducer.ts:92` cleanup rule).

- [ ] **Step 5: Verify card without abilities is unchanged**

Right-click a card that is NOT in the registry (e.g., any Lost Soul or a generic Hero). The menu should show only the existing items — no new ability section, no divider at the top.

---

## Task 10: Open PR 1

- [ ] **Step 1: Run the complete test suite one more time**

```bash
npx vitest run lib/cards/__tests__/cardAbilities.test.ts app/goldfish/state/__tests__
```

Expected: all tests pass.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: per-card custom abilities (goldfish, spawn_token)" --body "$(cat <<'EOF'
## Summary
- Introduce a shared ability registry at `lib/cards/cardAbilities.ts` keyed by card identifier.
- Add `EXECUTE_CARD_ABILITY` reducer case with a `spawnTokenInState` helper that is atomic (validate-then-build-then-commit).
- Render per-card abilities at the top of the shared `CardContextMenu`.
- Ship v1 with `spawn_token` for six GoC cards (Two Possessed spawns 2; the rest spawn 1).

Multiplayer support follows in a separate PR (adds `isToken` to `CardInstance` and an `execute_card_ability` reducer).

Spec: [`docs/superpowers/specs/2026-04-18-card-custom-abilities-design.md`](docs/superpowers/specs/2026-04-18-card-custom-abilities-design.md)

## Test plan
- [x] Registry integrity tests (every key + tokenName resolves via findCard)
- [x] `spawnTokenInState` unit tests (count > 1, fallback zone, no-op on unknown card/ability, owner inheritance, atomic failure)
- [x] Manual QA in goldfish per plan Task 9

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# PR 2 — Multiplayer / SpacetimeDB

**Branch off main after PR 1 merges.** The SpacetimeDB schema change and generated bindings are invasive enough that they should land as a separate, clearly-titled PR.

## Task 11: Add `isToken` to `CardInstance` schema

**Files:**
- Modify: `spacetimedb/src/schema.ts:81-117`

- [ ] **Step 1: Add the field**

Open `spacetimedb/src/schema.ts` and find the `CardInstance` table (starts around line 81). Inside the columns object (second argument to `table(...)`), add `isToken` alongside the other boolean flags:

```ts
    isToken: t.bool(),
```

Place it adjacent to `isMeek`, `isFlipped`, and `isSoulDeckOrigin` so all boolean instance-state fields cluster together.

- [ ] **Step 2: Decide on backfill for existing rows**

Per spec §Open implementation decisions, default behavior is **new rows only** — old rows stay as they are and the existing goldfish opponent-lost-soul flow (which is already `isToken: true` client-side) is not retroactively marked server-side.

SpacetimeDB's handling of added bool columns on existing rows depends on how the module is republished: a plain `spacetime publish` (no `--clear-database`) will attempt a schema migration and may fail if the field has no server-side default. The simplest safe path for this repo:

- If the live SpacetimeDB database has no production games worth preserving, republish with `--clear-database -y` (see Task 14). All rows reset.
- If there are games worth preserving, add `isToken: t.bool()` with a field-level default and accept that every existing row becomes `false` (which is what we want — actual `isToken` rows today are only goldfish-side and have no corresponding SpacetimeDB rows).

Either way, no dedicated backfill reducer is needed. Note the decision made in the PR description.

- [ ] **Step 3: Commit**

```bash
git add spacetimedb/src/schema.ts
git commit -m "feat(spacetime): add isToken bool to CardInstance"
```

---

## Task 12: Add the `execute_card_ability` server reducer

**Files:**
- Modify: `spacetimedb/src/index.ts` (add reducer; add `spawnTokenImpl` helper)

Refer to `move_card` at `spacetimedb/src/index.ts:1569-1621` as the closest existing pattern for validation + insert.

- [ ] **Step 1: Add imports at the top of `index.ts`**

Register the shared card-abilities registry. Start with the shared import; if the SpacetimeDB tsconfig cannot reach `lib/cards/cardAbilities.ts`, fall back to duplicating the registry into `spacetimedb/src/cardAbilities.ts` per the soul-defs precedent (see spec §Shared between client and SpacetimeDB module). Begin with:

```ts
import { findCard } from '../../lib/cards/lookup';
import { getAbilitiesForCard, type CardAbility } from '../../lib/cards/cardAbilities';
```

Try `spacetime publish` (see Task 14). If publish fails with module-resolution errors, revert to the duplication approach:

- Copy the contents of `lib/cards/cardAbilities.ts` into `spacetimedb/src/cardAbilities.ts`.
- Copy a minimal `findCard` shim or inline the `CARDS` lookup into the same file.
- Add a comment block at the top of both files: `// DUPLICATED: keep in sync with ../../lib/cards/cardAbilities.ts — see docs/superpowers/specs/2026-04-18-card-custom-abilities-design.md §Shared registry.`
- Add a simple parity check under `lib/cards/__tests__/cardAbilities.test.ts`:
  ```ts
  it('spacetimedb duplicate of CARD_ABILITIES stays in sync', async () => {
    const spacetimeCopy = await import('@/spacetimedb/src/cardAbilities');
    expect(spacetimeCopy.CARD_ABILITIES).toEqual(CARD_ABILITIES);
  });
  ```

- [ ] **Step 2: Add the `spawnTokenImpl` helper**

Place this helper near the top of `index.ts` alongside other module-local helpers (e.g., above `move_card` at line 1567). The helper is a plain function, not a reducer:

```ts
function spawnTokenImpl(
  ctx: any,
  source: any, // CardInstance row
  ability: Extract<CardAbility, { type: 'spawn_token' }>,
  player: any, // Player row (already resolved in the reducer)
  gameId: bigint,
) {
  // Phase 1 — validate token exists in card data.
  const tokenData = findCard(ability.tokenName);
  if (!tokenData) throw new SenderError(`Unknown token '${ability.tokenName}'`);

  // Phase 2 — compute target zone.
  const PLAY_ZONES = ['territory', 'land-of-bondage', 'land-of-redemption'];
  const targetZone = PLAY_ZONES.includes(source.zone)
    ? source.zone
    : (ability.defaultZone ?? 'territory');

  const count = ability.count ?? 1;
  if (count < 1) throw new SenderError('Invalid count');

  // Compute next zoneIndex based on existing cards for (targetZone, ownerId).
  let maxIdx = -1n;
  for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
    if (c.ownerId === source.ownerId && c.zone === targetZone && c.zoneIndex > maxIdx) {
      maxIdx = c.zoneIndex;
    }
  }

  // Phase 3 — all-or-nothing inserts. SpacetimeDB rolls back the whole
  // reducer if any insert throws, so partial spawns are impossible.
  for (let i = 0; i < count; i++) {
    maxIdx += 1n;
    ctx.db.CardInstance.insert({
      id: 0n,
      gameId,
      ownerId: source.ownerId,
      zone: targetZone,
      zoneIndex: maxIdx,
      posX: '',
      posY: '',
      isMeek: false,
      isFlipped: false,
      isToken: true,
      isSoulDeckOrigin: false,
      equippedToInstanceId: 0n,
      notes: '',
      cardName: tokenData.name,
      cardSet: tokenData.set,
      cardImgFile: tokenData.imgFile,
      cardType: tokenData.type,
      brigade: tokenData.brigade ?? '',
      strength: tokenData.strength ?? '',
      toughness: tokenData.toughness ?? '',
      alignment: tokenData.alignment ?? '',
      identifier: tokenData.identifier ?? '',
      specialAbility: tokenData.specialAbility ?? '',
      reference: tokenData.reference ?? '',
    });
  }

  const game = ctx.db.Game.id.find(gameId);
  if (game) {
    logAction(
      ctx, gameId, player.id, 'SPAWN_TOKEN',
      JSON.stringify({
        sourceInstanceId: source.id.toString(),
        tokenName: tokenData.name,
        count,
        targetZone,
      }),
      game.turnNumber, game.currentPhase,
    );
  }
}
```

(Confirm the exact `CardInstance` field list and types against `schema.ts` during implementation — the insert object MUST include every required field. Missing/incorrectly-named fields cause `spacetime publish` to fail.)

- [ ] **Step 3: Add the reducer**

Append this reducer at a sensible spot near `move_card` (e.g., after `move_cards_batch` around line 1738):

```ts
// ---------------------------------------------------------------------------
// Reducer: execute_card_ability
//
// Server-authoritative dispatch for per-card custom abilities defined in
// lib/cards/cardAbilities.ts. The client sends only (gameId, cardInstanceId,
// abilityIndex); the server re-reads the registry by the source card's
// identifier. Reducer body is ordered validate → compute → write so no row
// is inserted until every precondition passes.
// ---------------------------------------------------------------------------
export const execute_card_ability = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    abilityIndex: t.u64(),
  },
  (ctx, { gameId, cardInstanceId, abilityIndex }) => {
    // Phase 1 — validate.
    const player = findPlayerBySender(ctx, gameId);

    const source = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!source) throw new SenderError('Card not found');
    if (source.gameId !== gameId) throw new SenderError('Card not in this game');
    if (source.ownerId !== player.id) throw new SenderError('Not your card');

    const abilities = getAbilitiesForCard(source.identifier);
    const ability = abilities[Number(abilityIndex)];
    if (!ability) throw new SenderError('No such ability');

    // Phase 2 — dispatch.
    switch (ability.type) {
      case 'spawn_token':
        return spawnTokenImpl(ctx, source, ability, player, gameId);
      case 'shuffle_and_draw':
        throw new SenderError('shuffle_and_draw not yet implemented');
      case 'custom':
        throw new SenderError('Custom abilities are dispatched by the client, not this reducer');
    }
  },
);
```

- [ ] **Step 4: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "feat(spacetime): execute_card_ability reducer + spawn_token impl"
```

---

## Task 13: Extend `move_card` with token cleanup

**Files:**
- Modify: `spacetimedb/src/index.ts:1569-1621`

Tokens dropped into non-play zones (reserve/banish/discard/hand/deck) should be deleted instead of moved. This mirrors the goldfish rule at `gameReducer.ts:92`.

- [ ] **Step 1: Add the token-cleanup branch inside `move_card`**

Just above the existing lost-soul redirect block (around line 1591, the branch that starts with `const isLostSoul = …`), insert:

```ts
    // Tokens dropped into non-play zones are deleted, not moved.
    // Parallels the goldfish cleanup rule at gameReducer.ts:92.
    const TOKEN_REMOVE_ZONES = ['reserve', 'banish', 'discard', 'hand', 'deck'];
    if (card.isToken && TOKEN_REMOVE_ZONES.includes(toZone)) {
      ctx.db.CardInstance.id.delete(cardInstanceId);
      if (fromZone === 'hand') compactHandIndices(ctx, gameId, card.ownerId);
      if (fromZone === 'land-of-bondage') compactLobIndices(ctx, gameId, card.ownerId);
      logAction(
        ctx, gameId, player.id, 'MOVE_CARD',
        JSON.stringify({
          cardInstanceId: cardInstanceId.toString(),
          from: fromZone,
          to: toZone,
          cardName: card.cardName,
          cardImgFile: card.cardImgFile,
          tokenCleanup: true,
        }),
        game.turnNumber, game.currentPhase,
      );
      return;
    }
```

Make sure `game` is resolved before this branch runs — check `move_card`'s existing structure and place the block after `const game = ctx.db.Game.id.find(gameId);` (line 1588).

- [ ] **Step 2: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "feat(spacetime): delete tokens moved to non-play zones in move_card"
```

---

## Task 14: Publish the module and regenerate bindings

**Files:**
- Modify (auto-generated): `lib/spacetimedb/module_bindings/**`

- [ ] **Step 1: Invoke the spacetimedb-deploy skill**

Invoke `Skill("spacetimedb-deploy")` or run the equivalent commands manually. The skill runs `spacetime publish` then `spacetime generate --lang typescript --out-dir lib/spacetimedb/module_bindings --module-path spacetimedb`.

- [ ] **Step 2: Verify the new fields and reducer appear in bindings**

```bash
grep -n "is_token\|isToken" lib/spacetimedb/module_bindings/card_instance_type.ts
grep -rn "execute_card_ability\|executeCardAbility" lib/spacetimedb/module_bindings/
```

Both greps should return matches. If not, the publish/generate step did not succeed — inspect `spacetime publish` output and fix errors (most likely a missing field on the `CardInstance.insert(...)` object from Task 12).

- [ ] **Step 3: Commit generated bindings**

```bash
git add lib/spacetimedb/module_bindings/
git commit -m "chore(spacetime): regenerate client bindings for execute_card_ability"
```

---

## Task 15: Wire `executeCardAbility` through the multiplayer `GameActions` adapter

**Files:**
- Modify: `app/play/hooks/useGameState.ts` (find the object that implements `GameActions`)

- [ ] **Step 1: Locate the adapter**

Open `app/play/hooks/useGameState.ts` and find where the returned object matches the `GameActions` interface — look for existing methods like `moveCard: (…) => conn?.reducers.moveCard({ … })`. That's the pattern to follow.

- [ ] **Step 2: Add the method**

Add a new method on the adapter object, mirroring the reducer-call pattern of existing methods:

```ts
    executeCardAbility: (sourceInstanceId: string, abilityIndex: number) => {
      // V1 has no `custom` abilities in the registry — always route through
      // the generic reducer. When the first `type: 'custom'` ability ships,
      // split this: look up the ability locally and, if custom, call
      // conn.reducers[ability.reducerName]({ ... }) instead.
      conn?.reducers.executeCardAbility({
        gameId: BigInt(gameId),
        cardInstanceId: BigInt(sourceInstanceId),
        abilityIndex: BigInt(abilityIndex),
      });
    },
```

Match the exact casing of `executeCardAbility` / `execute_card_ability` that `spacetime generate` emitted (the bindings auto-convert snake_case → camelCase, but verify against the generated file).

- [ ] **Step 3: Commit**

```bash
git add app/play/hooks/useGameState.ts
git commit -m "feat(play): wire executeCardAbility through multiplayer adapter"
```

---

## Task 16: Manual QA for multiplayer

**Files:** none — pure verification.

- [ ] **Step 1: Start two browser windows**

Run: `npm run dev`. Open two browsers (or one + incognito), sign in as different users, join the same game as Player A and Player B.

- [ ] **Step 2: Verify spawn syncs between clients**

Player A drops Two Possessed into Territory. Player A right-clicks it and picks "Create 2× Violent Possessor Token". Both Player A's and Player B's view should show the two Violent Possessor Tokens appear in Player A's Territory, each with the TOKEN badge.

- [ ] **Step 3: Verify ownership enforcement**

Player B right-clicks Player A's Two Possessed. Expected: either the ability section is hidden (preferred — because the `CardContextMenu` ownership guard in Task 8 / §Context menu integration gates on owner), or the server rejects the reducer call with `SenderError('Not your card')` and Player B's UI shows no tokens.

- [ ] **Step 4: Verify cleanup**

Player A drags a spawned Violent Possessor Token into Discard. It should disappear on both clients.

- [ ] **Step 5: Verify atomicity on server error**

Temporarily break the registry to reference a nonexistent token (e.g., change Two Possessed's tokenName to `'Nonexistent Token'` in `lib/cards/cardAbilities.ts`). Re-run `spacetime publish` + `spacetime generate`. Spawning should now throw `SenderError('Unknown token …')` and produce zero tokens on both clients. Revert the edit and re-publish before completing the PR.

---

## Task 17: Open PR 2

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run lib/cards/__tests__/cardAbilities.test.ts app/goldfish/state/__tests__
```

Expected: all tests pass (including the parity test if the registry was duplicated into the spacetime module).

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: per-card custom abilities — multiplayer (SpacetimeDB)" --body "$(cat <<'EOF'
## Summary
- Add `isToken: bool` to the `CardInstance` table.
- New `execute_card_ability` reducer dispatches ability types from the shared `CARD_ABILITIES` registry; v1 ships `spawn_token`.
- `move_card` now deletes tokens dropped into non-play zones (parallels the goldfish cleanup).
- Multiplayer client adapter wires `GameActions.executeCardAbility` through `conn.reducers.executeCardAbility`.
- Regenerated TypeScript bindings under `lib/spacetimedb/module_bindings/`.

Follows PR 1 which shipped the goldfish implementation of the same feature.

Spec: [`docs/superpowers/specs/2026-04-18-card-custom-abilities-design.md`](docs/superpowers/specs/2026-04-18-card-custom-abilities-design.md)

## Test plan
- [x] `spacetime publish` succeeds with the new `isToken` field + `execute_card_ability` reducer
- [x] Manual QA in two browsers per plan Task 16 (sync, ownership rejection, cleanup, atomic failure)
- [x] Registry integrity + goldfish reducer suites still pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# Deferred / Future Work

Not part of this plan — tracked for reference:

- **`type: 'shuffle_and_draw'` reducer.** The first non-token ability. When the first card needs it (e.g., a card whose effect is "shuffle 6 from hand, draw 6"), add the case in both the goldfish reducer and `execute_card_ability`. The dispatch layer, registry, and menu integration do not change.
- **`type: 'custom'` escape hatch.** When the first one-off ability arrives, (a) write a dedicated SpacetimeDB reducer for it, (b) split the multiplayer adapter's `executeCardAbility` to route `custom` to `conn.reducers[ability.reducerName]`, (c) add a client-side goldfish handler if the ability has a goldfish equivalent.
- **Admin-editable registry.** If the ability list grows beyond ~20 entries or changes frequently, migrate to a Supabase `card_abilities` table per spec §Non-goals. Out of scope for v1.
