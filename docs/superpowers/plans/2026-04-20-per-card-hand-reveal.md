# Per-Card Hand Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-card, 30-second, auto-expiring reveal action to hand cards. Right-click a card in your hand → "Reveal for 30s" → opponents/spectators see the card's face for 30 seconds; you see a badge + countdown; the reveal clears if the card leaves hand.

**Architecture:** Store `revealUntil` (ms epoch) on the shared `GameCard` type. Goldfish dispatches a new `REVEAL_CARD_IN_HAND` reducer action with `Date.now() + 30_000`. Multiplayer adds a `reveal_expires_at` column to the SpacetimeDB `CardInstance` table plus a `reveal_card_in_hand` reducer; all existing reducers that move a card out of hand clear the field. A 1-second ticker hook drives countdown re-renders. The multiplayer `cardInstanceToGameCard` adapter maps the server timestamp to `revealUntil`.

**Tech Stack:** Next.js 15, React 19, TypeScript, SpacetimeDB 2.0 (TypeScript SDK), Vitest for unit tests. Goldfish uses a plain React reducer; multiplayer uses SpacetimeDB reducers called via `conn.reducers.*`.

**Spec:** [docs/superpowers/specs/2026-04-20-per-card-hand-reveal-design.md](../specs/2026-04-20-per-card-hand-reveal-design.md)

---

## File Structure Overview

**New files:** none.

**Modified files:**

| File | Responsibility |
|------|----------------|
| `app/shared/types/gameCard.ts` | Add `revealUntil?: number` to `GameCard`; add `REVEAL_CARD_IN_HAND` to `ActionType`. |
| `app/shared/types/gameActions.ts` | Add `revealCardInHand(cardId: string)` to `GameActions`. |
| `app/goldfish/state/gameReducer.ts` | New `REVEAL_CARD_IN_HAND` case; clear `revealUntil` in every reducer that moves a card out of `hand`. |
| `app/goldfish/state/gameActions.ts` | New action creator that supplies `Date.now() + 30_000`. |
| `app/goldfish/state/__tests__/gameReducer.revealCard.test.ts` (new) | Vitest unit tests for the reducer action and lifecycle clears. |
| `app/goldfish/components/GoldfishCanvas.tsx` | Wire `revealCardInHand` into `goldfishActions` adapter; pass `isHandRevealed={false}` to `CardContextMenu`. |
| `app/shared/components/CardContextMenu.tsx` | New menu entry with visibility gate; display countdown if already revealed. |
| `app/shared/components/GameCardNode.tsx` | Add props + rendering for reveal badge (owner) and face-up override (opponent) based on `revealUntil`. |
| `app/shared/hooks/useRevealTick.ts` (new) | 1-second interval that forces re-renders while any visible card has an active reveal. |
| `spacetimedb/src/schema.ts` | Add `revealExpiresAt` column to `CardInstance`. |
| `spacetimedb/src/index.ts` | New `reveal_card_in_hand` reducer; clear `revealExpiresAt` in every reducer that moves a card out of hand. |
| `app/play/hooks/useGameState.ts` | New `revealCardInHand(cardInstanceId: bigint)` wrapper around the SpacetimeDB reducer. |
| `app/play/components/MultiplayerCanvas.tsx` | Map `revealExpiresAt` → `revealUntil` in `cardInstanceToGameCard`; wire `revealCardInHand` into `multiplayerActions`; adjust hand face-down rule to respect `revealUntil`; pass `isHandRevealed` to `CardContextMenu`. |

**SpacetimeDB deploy:** After schema/reducer changes, run the `spacetimedb-deploy` skill to publish the module and regenerate TypeScript client bindings.

---

## Task 1: Add `revealUntil` to shared `GameCard` and `ActionType`

**Files:**
- Modify: `app/shared/types/gameCard.ts`

- [ ] **Step 1: Add field and action type**

Open `app/shared/types/gameCard.ts`. In the `GameCard` interface (the block starting `export interface GameCard {` around line 59), add a new field after `equippedTo`:

```ts
  equippedTo?: string;
  /** Unix ms epoch when this card's temporary per-card reveal expires.
   *  A card is "currently revealed" iff revealUntil !== undefined &&
   *  revealUntil > Date.now(). Cleared whenever the card changes zone. */
  revealUntil?: number;
}
```

In the `ActionType` union (starts `export type ActionType =` around line 88), add the new action:

```ts
  | 'EXECUTE_CARD_ABILITY'
  | 'REVEAL_CARD_IN_HAND';
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors introduced; the unused type is fine).

- [ ] **Step 3: Commit**

```bash
git add app/shared/types/gameCard.ts
git commit -m "feat(reveal): add revealUntil to GameCard and REVEAL_CARD_IN_HAND action type"
```

---

## Task 2: Add `revealCardInHand` to `GameActions` interface

**Files:**
- Modify: `app/shared/types/gameActions.ts`

- [ ] **Step 1: Add the method to the interface**

Open `app/shared/types/gameActions.ts`. Add one line near the end of the `GameActions` interface, just before the closing brace:

```ts
  // Per-card hand reveal (optional — implemented by both goldfish and multiplayer).
  // Temporarily reveals a single hand card to opponents/spectators for 30 seconds.
  // Duration is fixed at the callee — callers don't pass it.
  revealCardInHand?(cardId: string): void;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/shared/types/gameActions.ts
git commit -m "feat(reveal): add optional revealCardInHand to GameActions"
```

---

## Task 3: Goldfish reducer — `REVEAL_CARD_IN_HAND` + lifecycle clears

**Files:**
- Test: `app/goldfish/state/__tests__/gameReducer.revealCard.test.ts` (new)
- Modify: `app/goldfish/state/gameReducer.ts`

- [ ] **Step 1: Write failing tests**

Create `app/goldfish/state/__tests__/gameReducer.revealCard.test.ts` with this content:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { gameReducer } from '../gameReducer';
import type { GameState, GameAction, GameCard } from '../../types';
import { DEFAULT_OPTIONS } from '../../types';

function makeCard(instanceId: string, zone: GameCard['zone'] = 'hand'): GameCard {
  return {
    instanceId,
    cardName: 'Test Card',
    cardSet: 'X',
    cardImgFile: '',
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
    zone,
    ownerId: 'player1',
    notes: '',
  };
}

function makeState(hand: GameCard[] = [], territory: GameCard[] = []): GameState {
  return {
    sessionId: 's',
    deckId: 'd',
    deckName: 'n',
    isOwner: true,
    format: 'T1',
    paragonName: null,
    turn: 1,
    phase: 'draw',
    zones: {
      deck: [], hand, reserve: [], discard: [], paragon: [],
      'land-of-bondage': [], 'soul-deck': [], territory,
      'land-of-redemption': [], banish: [],
    },
    history: [],
    options: DEFAULT_OPTIONS,
    isSpreadHand: false,
    drawnThisTurn: false,
  };
}

function action(type: GameAction['type'], payload: GameAction['payload'] = {}): GameAction {
  return { id: 't', type, playerId: 'player1', timestamp: 0, payload };
}

describe('REVEAL_CARD_IN_HAND', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-04-20T00:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('sets revealUntil on the target hand card', () => {
    const card = makeCard('c1', 'hand');
    const state = makeState([card]);
    const revealUntil = Date.now() + 30_000;
    const next = gameReducer(state, action('REVEAL_CARD_IN_HAND', { cardInstanceId: 'c1', value: revealUntil }));
    expect(next.zones.hand[0].revealUntil).toBe(revealUntil);
  });

  it('ignores non-hand cards', () => {
    const card = makeCard('c1', 'territory');
    const state = makeState([], [card]);
    const next = gameReducer(state, action('REVEAL_CARD_IN_HAND', { cardInstanceId: 'c1', value: Date.now() + 30_000 }));
    expect(next.zones.territory[0].revealUntil).toBeUndefined();
  });

  it('no-ops on unknown card id', () => {
    const state = makeState([makeCard('c1', 'hand')]);
    const next = gameReducer(state, action('REVEAL_CARD_IN_HAND', { cardInstanceId: 'nope', value: 123 }));
    expect(next).toEqual(state);
  });

  it('re-revealing resets revealUntil', () => {
    const card = { ...makeCard('c1', 'hand'), revealUntil: 100 };
    const state = makeState([card]);
    const next = gameReducer(state, action('REVEAL_CARD_IN_HAND', { cardInstanceId: 'c1', value: 999 }));
    expect(next.zones.hand[0].revealUntil).toBe(999);
  });
});

describe('reveal lifecycle clears when hand card moves', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-04-20T00:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('MOVE_CARD out of hand clears revealUntil', () => {
    const card = { ...makeCard('c1', 'hand'), revealUntil: Date.now() + 10_000 };
    const state = makeState([card]);
    const next = gameReducer(state, action('MOVE_CARD', { cardInstanceId: 'c1', toZone: 'discard' }));
    expect(next.zones.discard[0].revealUntil).toBeUndefined();
  });

  it('SHUFFLE_AND_MOVE_TO_TOP clears revealUntil', () => {
    const card = { ...makeCard('c1', 'hand'), revealUntil: Date.now() + 10_000 };
    const state = makeState([card]);
    const next = gameReducer(state, action('SHUFFLE_AND_MOVE_TO_TOP', { cardInstanceId: 'c1' }));
    expect(next.zones.deck[0].revealUntil).toBeUndefined();
  });

  it('SHUFFLE_AND_MOVE_TO_BOTTOM clears revealUntil', () => {
    const card = { ...makeCard('c1', 'hand'), revealUntil: Date.now() + 10_000 };
    const state = makeState([card]);
    const next = gameReducer(state, action('SHUFFLE_AND_MOVE_TO_BOTTOM', { cardInstanceId: 'c1' }));
    const last = next.zones.deck[next.zones.deck.length - 1];
    expect(last.revealUntil).toBeUndefined();
  });

  it('MOVE_CARDS_BATCH out of hand clears revealUntil', () => {
    const c1 = { ...makeCard('c1', 'hand'), revealUntil: Date.now() + 10_000 };
    const c2 = { ...makeCard('c2', 'hand'), revealUntil: Date.now() + 10_000 };
    const state = makeState([c1, c2]);
    const next = gameReducer(state, action('MOVE_CARDS_BATCH', { cardInstanceIds: ['c1', 'c2'], toZone: 'discard' }));
    expect(next.zones.discard.every(c => c.revealUntil === undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/goldfish/state/__tests__/gameReducer.revealCard.test.ts`
Expected: All `REVEAL_CARD_IN_HAND` tests FAIL ("reducer returns state unchanged" or similar — the action isn't handled yet). Lifecycle tests FAIL because `revealUntil` is preserved rather than cleared.

- [ ] **Step 3: Add the reducer case for `REVEAL_CARD_IN_HAND`**

In `app/goldfish/state/gameReducer.ts`, inside the main `switch (action.type)` block, add a new case just before the `default:` branch. (The existing file has a `default: return state;` around line 873.)

```ts
    case 'REVEAL_CARD_IN_HAND': {
      const { cardInstanceId, value } = action.payload;
      if (!cardInstanceId || typeof value !== 'number') return state;
      // Only reveal cards that are actually in hand — silently no-op otherwise.
      const idx = zones.hand.findIndex(c => c.instanceId === cardInstanceId);
      if (idx === -1) return state;
      zones.hand = [...zones.hand];
      zones.hand[idx] = { ...zones.hand[idx], revealUntil: value };
      return { ...state, zones, history };
    }
```

- [ ] **Step 4: Clear `revealUntil` when cards leave hand**

In the same file, add `revealUntil: undefined` to four places where cards move out of hand.

**4a. `MOVE_CARD` case (around line 230–314).** At the point where `result.card.zone = toZone;` is set (around line 251), add an adjacent clear right after. The full replacement block is:

```ts
      result.card.zone = toZone;
      // Per-card hand reveals are ephemeral — clear when the card changes zone.
      if (result.fromZone !== toZone) {
        result.card.revealUntil = undefined;
      }
```

**4b. `SHUFFLE_AND_MOVE_TO_TOP` case (around line 386).** Replace:

```ts
      if (result.card.isToken) return { ...state, zones, history };
      zones.deck = shuffleArray(zones.deck);
      result.card.zone = 'deck';
      zones.deck.unshift(result.card);
```

with:

```ts
      if (result.card.isToken) return { ...state, zones, history };
      zones.deck = shuffleArray(zones.deck);
      result.card.zone = 'deck';
      result.card.revealUntil = undefined;
      zones.deck.unshift(result.card);
```

**4c. `SHUFFLE_AND_MOVE_TO_BOTTOM` case (around line 398).** Replace:

```ts
      if (result.card.isToken) return { ...state, zones, history };
      zones.deck = shuffleArray(zones.deck);
      result.card.zone = 'deck';
      zones.deck.push(result.card);
```

with:

```ts
      if (result.card.isToken) return { ...state, zones, history };
      zones.deck = shuffleArray(zones.deck);
      result.card.zone = 'deck';
      result.card.revealUntil = undefined;
      zones.deck.push(result.card);
```

**4d. `MOVE_CARDS_BATCH` case (around line 545).** Inside the per-card loop, at the point where `result.card.zone = finalZone;` is set (around line 579), add a clear right after:

```ts
        result.card.zone = finalZone;
        if (result.fromZone !== finalZone) {
          result.card.revealUntil = undefined;
        }
```

Note: the reveal only exists on hand cards, so clearing only matters when `fromZone === 'hand'`. Clearing on every cross-zone move is safe (idempotent when already undefined) and simpler than gating on source zone.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run app/goldfish/state/__tests__/gameReducer.revealCard.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Run the full goldfish reducer test suite for regressions**

Run: `npx vitest run app/goldfish/state/__tests__`
Expected: PASS (existing tests unaffected — the clears only touch `revealUntil`).

- [ ] **Step 7: Commit**

```bash
git add app/goldfish/state/gameReducer.ts app/goldfish/state/__tests__/gameReducer.revealCard.test.ts
git commit -m "feat(reveal): goldfish reducer action + lifecycle clears"
```

---

## Task 4: Goldfish action creator

**Files:**
- Modify: `app/goldfish/state/gameActions.ts`

- [ ] **Step 1: Add the creator**

Open `app/goldfish/state/gameActions.ts`. Add a new entry to the `actions` object, placed near `flipCard` for discoverability:

```ts
  revealCardInHand(cardInstanceId: string): GameAction {
    // Duration is fixed at 30 seconds. Kept as a constant here so the reducer
    // stays pure (no Date.now() inside the reducer).
    const revealUntil = Date.now() + 30_000;
    return createAction('REVEAL_CARD_IN_HAND', { cardInstanceId, value: revealUntil });
  },
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/goldfish/state/gameActions.ts
git commit -m "feat(reveal): goldfish action creator for reveal-in-hand"
```

---

## Task 5: Shared tick hook for reveal countdowns

**Files:**
- Create: `app/shared/hooks/useRevealTick.ts`

- [ ] **Step 1: Create the hook**

```ts
'use client';

import { useEffect, useState } from 'react';

/**
 * Forces a re-render once per second as long as `active` is true.
 * Used to drive countdown rendering for per-card hand reveals without
 * mutating shared state. Call sites pass `active = zones.hand.some(c =>
 * c.revealUntil && c.revealUntil > Date.now())` (or the opponent-side
 * equivalent).
 */
export function useRevealTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/shared/hooks/useRevealTick.ts
git commit -m "feat(reveal): useRevealTick hook for countdown re-renders"
```

---

## Task 6: `CardContextMenu` — add "Reveal for 30s" entry

**Files:**
- Modify: `app/shared/components/CardContextMenu.tsx`

- [ ] **Step 1: Extend props**

At the top of the file, update the `CardContextMenuProps` interface to accept the new optional prop:

```ts
interface CardContextMenuProps {
  card: GameCard;
  x: number;
  y: number;
  actions: GameActions;
  onClose: () => void;
  onExchange?: (cardIds: string[]) => void;
  onDetach?: (cardInstanceId: string) => void;
  onEditNote?: (card: GameCard) => void;
  zones?: Record<ZoneId, GameCard[]>;
  /** When true, the whole-hand reveal is active — suppress the per-card
   *  "Reveal for 30s" entry as redundant. Optional; defaults to false. */
  isHandRevealed?: boolean;
}
```

And add it to the destructured args in the component signature:

```ts
export function CardContextMenu({ card: initialCard, x, y, actions, onClose, onExchange, onDetach, onEditNote, zones, isHandRevealed }: CardContextMenuProps) {
```

- [ ] **Step 2: Compute visibility gate**

Just after the existing `canExecuteAbilities` computation (around line 162), add:

```ts
  // Per-card hand reveal — gated to local player's own hand cards and
  // suppressed when the whole hand is already publicly revealed.
  const canRevealInHand =
    card.zone === 'hand' &&
    isOwnedByLocalPlayer &&
    !isHandRevealed &&
    typeof actions.revealCardInHand === 'function';

  const now = Date.now();
  const isActivelyRevealed =
    typeof card.revealUntil === 'number' && card.revealUntil > now;
  const secondsRemaining = isActivelyRevealed
    ? Math.max(0, Math.ceil((card.revealUntil! - now) / 1000))
    : 0;
```

- [ ] **Step 3: Render the menu entry**

Insert the entry inside the main menu return (the non-token render block, below the abilities section, above the counter swatches block — around line 230 in the existing file):

```tsx
      {canRevealInHand && (
        <>
          <button
            style={itemStyle}
            onClick={() => doAction(() => actions.revealCardInHand!(card.instanceId))}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {isActivelyRevealed
              ? `Reveal for 30s (${secondsRemaining}s left — reset)`
              : 'Reveal for 30s'}
          </button>
          <div style={separatorStyle} />
        </>
      )}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/shared/components/CardContextMenu.tsx
git commit -m "feat(reveal): CardContextMenu Reveal for 30s entry"
```

---

## Task 7: Wire `revealCardInHand` into the goldfish actions adapter

**Files:**
- Modify: `app/goldfish/components/GoldfishCanvas.tsx`

- [ ] **Step 1: Pull the action creator through the `useGame` hook**

First, confirm the goldfish game context exposes a dispatch wrapper for each action creator. Open the game context (commonly `app/goldfish/state/GameContext.tsx` — find it with `grep -l "useGame" app/goldfish/state`). Search for the existing `flipCard` export in that file. Add a sibling `revealCardInHand` wrapper next to it using the exact same pattern as `flipCard`:

```ts
const revealCardInHand = useCallback(
  (cardInstanceId: string) => dispatch(actions.revealCardInHand(cardInstanceId)),
  [dispatch],
);
```

Include `revealCardInHand` in the context's provided value and in its exported hook return (follow the `flipCard` precedent exactly — whatever pattern that file uses).

- [ ] **Step 2: Wire it into the `goldfishActions` adapter**

In `app/goldfish/components/GoldfishCanvas.tsx`, locate the `goldfishActions` `useMemo` block (around line 72). Destructure `revealCardInHand` from the `useGame()` hook call earlier in the component alongside `flipCard`, `meekCard`, etc.

Add an entry to the `goldfishActions` object, placed near `flipCard`:

```ts
    flipCard: (cardId) => flipCard(cardId),
    revealCardInHand: (cardId) => revealCardInHand(cardId),
    meekCard: (cardId) => meekCard(cardId),
```

Add `revealCardInHand` to the `useMemo` dependency array at the end of that block.

- [ ] **Step 3: Pass `isHandRevealed={false}` to `CardContextMenu`**

Locate the `<CardContextMenu ...>` render (around line 2137). Goldfish has no whole-hand reveal feature, so pass a literal `false`:

```tsx
      <CardContextMenu
        card={contextMenu.card}
        x={contextMenu.x}
        y={contextMenu.y}
        actions={goldfishActions}
        isHandRevealed={false}
        onClose={() => setContextMenu(null)}
        onEditNote={(c) => { /* existing impl */ }}
        zones={state.zones}
      />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual smoke (goldfish)**

Run: `npm run dev`
In a browser at `localhost:3000/goldfish`, start a goldfish session. Right-click a hand card. The menu should include **"Reveal for 30s"**. Clicking it should dispatch without error. (Visual badge arrives in Task 8 — at this point the click is a no-op visually, which is expected.)

- [ ] **Step 6: Commit**

```bash
git add app/goldfish/components/GoldfishCanvas.tsx app/goldfish/state/GameContext.tsx
git commit -m "feat(reveal): wire revealCardInHand through goldfish adapter"
```

---

## Task 8: `GameCardNode` — render reveal badge + opponent face-up override

**Files:**
- Modify: `app/shared/components/GameCardNode.tsx`

- [ ] **Step 1: Extend the face-face rule**

Open `app/shared/components/GameCardNode.tsx`. Find the line:

```ts
const showFace = !card.isFlipped && image;
```

Replace it with:

```ts
const isActivelyRevealed =
  typeof card.revealUntil === 'number' && card.revealUntil > Date.now();
// A per-card reveal temporarily shows the face even for otherwise-hidden
// hand cards (opponent view, or whenever isFlipped would normally hide it).
const showFace = (!card.isFlipped || isActivelyRevealed) && image;
```

- [ ] **Step 2: Render the owner-side countdown badge**

Locate the main render return (the JSX that wraps `CardImage` / `CardBackShape`). Inside the card group, after the main face/back render but before the group's closing tag, add a conditional badge. Use the existing Konva primitives the file already imports (`Group`, `Text`, `Rect`). If the file uses `react-konva`, add a Konva-compatible badge; if it uses raw DOM, add an HTML overlay.

**Example (react-konva — confirm by reading file imports):**

```tsx
{isActivelyRevealed && (
  <Group x={cardWidth - 44} y={4} listening={false}>
    <Rect
      width={40}
      height={18}
      fill="rgba(20,20,20,0.85)"
      stroke="#f2c94c"
      strokeWidth={1}
      cornerRadius={4}
    />
    <Text
      x={0}
      y={3}
      width={40}
      align="center"
      text={`${Math.max(0, Math.ceil((card.revealUntil! - Date.now()) / 1000))}s`}
      fontSize={11}
      fontStyle="bold"
      fill="#f2c94c"
    />
  </Group>
)}
```

The badge sits in the top-right corner; the `listening={false}` prevents it from intercepting clicks/drags.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Run vitest**

Run: `npx vitest run`
Expected: PASS (no component tests should break; there are no existing tests for `GameCardNode`).

- [ ] **Step 5: Commit**

```bash
git add app/shared/components/GameCardNode.tsx
git commit -m "feat(reveal): GameCardNode countdown badge + face-up override"
```

---

## Task 9: Drive the tick in goldfish canvas

**Files:**
- Modify: `app/goldfish/components/GoldfishCanvas.tsx`

- [ ] **Step 1: Use the hook**

At the top of the `GoldfishCanvas` component function (after existing hook calls), add:

```ts
  const handHasActiveReveal = useMemo(
    () => (state.zones.hand ?? []).some(
      c => typeof c.revealUntil === 'number' && c.revealUntil > Date.now(),
    ),
    // Re-compute when hand changes; the tick hook will re-render on its own
    // so we don't need Date.now() in the dep list.
    [state.zones.hand],
  );
  useRevealTick(handHasActiveReveal);
```

Import the hook at the top of the file:

```ts
import { useRevealTick } from '@/app/shared/hooks/useRevealTick';
```

- [ ] **Step 2: Manual smoke**

Run: `npm run dev`
Right-click a hand card → "Reveal for 30s". A badge should appear in the top-right of the card with a ticking countdown from 30 to 0. At 0, the badge disappears.

- [ ] **Step 3: Commit**

```bash
git add app/goldfish/components/GoldfishCanvas.tsx
git commit -m "feat(reveal): drive reveal tick in goldfish canvas"
```

---

## Task 10: SpacetimeDB schema — `revealExpiresAt` on `CardInstance`

**Files:**
- Modify: `spacetimedb/src/schema.ts`

- [ ] **Step 1: Add the column**

Locate the `CardInstance` table (around line 84). Add a new column as the last entry in the columns object:

```ts
export const CardInstance = table({
  // ... existing options unchanged
}, {
  // ... existing columns unchanged
  equippedToInstanceId: t.u64(),  // existing trailing column — add ours after
  revealExpiresAt: t.timestamp().optional(),
});
```

Use `.optional()` so `undefined` = "never revealed" (cleaner than a 0n sentinel and idiomatic per `spacetimedb/CLAUDE.md`).

- [ ] **Step 2: Type-check the SpacetimeDB module**

Run: `cd spacetimedb && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit (deferred — wait until reducer is added)**

Don't commit yet — the schema change isn't useful on its own. We'll commit after Task 11 + Task 12 so the module stays in a compilable state between commits.

---

## Task 11: SpacetimeDB reducer — `reveal_card_in_hand`

**Files:**
- Modify: `spacetimedb/src/index.ts`

- [ ] **Step 1: Add the reducer**

Add a new reducer near `flip_card` (around line 3325). Model the validation on `flip_card`:

```ts
// ---------------------------------------------------------------------------
// Reducer: reveal_card_in_hand
// ---------------------------------------------------------------------------
// Temporarily reveals a single hand card to opponents/spectators for a fixed
// duration. Server-authoritative via reveal_expires_at; clients check the
// timestamp against their local clock. Clears automatically on any move-out
// reducer (see audit in reveal lifecycle patch).
export const reveal_card_in_hand = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');
    if (card.ownerId !== player.id) throw new SenderError('Not your card');
    if (card.zone !== 'hand') throw new SenderError('Card must be in hand');

    // Fixed 30 second duration. Timestamp uses microseconds since Unix epoch.
    const THIRTY_SECONDS_MICROS = 30_000_000n;
    const expiresAtMicros =
      ctx.timestamp.microsSinceUnixEpoch + THIRTY_SECONDS_MICROS;

    ctx.db.CardInstance.id.update({
      ...card,
      revealExpiresAt: new Timestamp(expiresAtMicros),
    });

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    const payload = {
      cardInstanceId: cardInstanceId.toString(),
      expiresAtMicros: expiresAtMicros.toString(),
    };
    logAction(ctx, gameId, player.id, 'REVEAL_CARD', JSON.stringify(payload), game.turnNumber, game.currentPhase);
  }
);
```

Ensure `Timestamp` is imported at the top of the file. If it isn't, add:

```ts
import { Timestamp } from 'spacetimedb';
```

If it's already imported for other usages, don't duplicate.

- [ ] **Step 2: Type-check**

Run: `cd spacetimedb && npx tsc --noEmit`
Expected: PASS.

---

## Task 12: SpacetimeDB — clear `revealExpiresAt` in move-out-of-hand reducers

**Files:**
- Modify: `spacetimedb/src/index.ts`

From the exploration report, these reducers move cards out of the hand zone (or may, depending on target):

- `move_card` (line ~1659) — generic move
- `move_cards_batch` (line ~1907) — batch move
- `shuffle_card_into_deck` (line ~2837)
- `random_hand_to_zone` (line ~2898)
- `random_opponent_hand_to_zone` (line ~3000)
- `move_card_to_top_of_deck` (line ~3703)
- `move_card_to_bottom_of_deck` (line ~3760)

For each of these reducers, find the `ctx.db.CardInstance.id.update({ ...card, zone: newZone, ... })` call and add `revealExpiresAt: undefined` to the update payload. This is safe for every card (not just hand cards) because non-hand cards never have the field set, and clearing an undefined field is a no-op.

- [ ] **Step 1: Patch `move_card`**

In `move_card`, find the update call where the card's zone is changed. Change:

```ts
ctx.db.CardInstance.id.update({ ...card, zone: toZone, zoneIndex: newIndex, posX, posY });
```

to:

```ts
ctx.db.CardInstance.id.update({
  ...card,
  zone: toZone,
  zoneIndex: newIndex,
  posX,
  posY,
  revealExpiresAt: undefined,
});
```

Use `git blame` or grep to find the exact fields — the update may include more fields. Preserve them exactly; only add `revealExpiresAt: undefined`.

- [ ] **Step 2: Patch `move_cards_batch`**

Same change: find the `ctx.db.CardInstance.id.update({ ...card, zone: ... })` call inside the batch loop and add `revealExpiresAt: undefined` to the payload.

- [ ] **Step 3: Patch `shuffle_card_into_deck`**

Same — on the update that moves the card into the deck, add `revealExpiresAt: undefined`.

- [ ] **Step 4: Patch `random_hand_to_zone`**

Find every `CardInstance.id.update({ ...card, zone: ... })` call inside this reducer (there may be one per iteration of the random loop). Add `revealExpiresAt: undefined` to each.

- [ ] **Step 5: Patch `random_opponent_hand_to_zone`**

Same pattern. Add `revealExpiresAt: undefined`.

- [ ] **Step 6: Patch `move_card_to_top_of_deck`**

Same pattern. Add `revealExpiresAt: undefined`.

- [ ] **Step 7: Patch `move_card_to_bottom_of_deck`**

Same pattern. Add `revealExpiresAt: undefined`.

- [ ] **Step 8: Type-check**

Run: `cd spacetimedb && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit the SpacetimeDB changes together**

```bash
git add spacetimedb/src/schema.ts spacetimedb/src/index.ts
git commit -m "feat(reveal): SpacetimeDB schema, reveal_card_in_hand reducer, lifecycle clears"
```

---

## Task 13: Publish the SpacetimeDB module + regenerate bindings

**Files:**
- Regenerate: `app/play/module_bindings/**`

- [ ] **Step 1: Invoke the spacetimedb-deploy skill**

Use the `spacetimedb-deploy` skill (per `CLAUDE.md`: "Always use this skill after any change to spacetimedb/src/schema.ts or spacetimedb/src/index.ts"). The skill publishes the module to the default server and regenerates the TypeScript client bindings.

- [ ] **Step 2: Verify the generated types include `revealExpiresAt`**

Search the regenerated bindings:

```bash
grep -rn "revealExpiresAt" app/play/module_bindings/
```

Expected: At least one match in the generated `CardInstance` type. Also:

```bash
grep -rn "revealCardInHand" app/play/module_bindings/
```

Expected: A match in the reducers bindings.

- [ ] **Step 3: Commit regenerated bindings**

```bash
git add app/play/module_bindings/
git commit -m "chore(reveal): regenerate SpacetimeDB bindings"
```

---

## Task 14: Multiplayer — normalize `revealExpiresAt` → `revealUntil`

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Map the field in `cardInstanceToGameCard`**

In `cardInstanceToGameCard` (around line 105), add one line at the end of the returned object. The current function ends at a `counters:` line and a closing brace; keep them unchanged and add:

```ts
    counters: counters.map((c) => ({
      color: c.color as Counter['color'],
      count: Number(c.count),
    })),
    revealUntil:
      card.revealExpiresAt === undefined
        ? undefined
        // Server stores microseconds-since-epoch; our client field is ms-since-epoch.
        : Number(card.revealExpiresAt.microsSinceUnixEpoch / 1000n),
  };
}
```

(Confirm exact field access via the regenerated bindings — SpacetimeDB 2.0 TS bindings expose optional timestamps as `Timestamp | undefined` with `.microsSinceUnixEpoch` on the value.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(reveal): map revealExpiresAt to revealUntil in multiplayer adapter"
```

---

## Task 15: Multiplayer — `revealCardInHand` in `useGameState`

**Files:**
- Modify: `app/play/hooks/useGameState.ts`

- [ ] **Step 1: Add the callback**

Near `flipCard` (around line 437), add:

```ts
  const revealCardInHand = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.revealCardInHand({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );
```

- [ ] **Step 2: Export it from the hook**

Locate the hook's return statement (the large object at the end of `useGameState`). Add `revealCardInHand` to the returned object alongside `flipCard`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (the regenerated reducer binding must exist — if this fails, rerun spacetimedb-deploy).

- [ ] **Step 4: Commit**

```bash
git add app/play/hooks/useGameState.ts
git commit -m "feat(reveal): useGameState wrapper for reveal_card_in_hand reducer"
```

---

## Task 16: Multiplayer — wire into `multiplayerActions` adapter

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Destructure and wire**

In `MultiplayerCanvas`, locate where `gameState.flipCard` is destructured (it's called via `gameState.flipCard(BigInt(cardId))` — so `gameState` is the full hook return). Near the `flipCard: (cardId) => { ... }` entry inside the `multiplayerActions` `useMemo` (around line 873), add:

```ts
    revealCardInHand: (cardId) => {
      gameState.revealCardInHand(BigInt(cardId));
    },
```

No undo entry — re-clicking the same action already resets the timer, so undoing would be non-trivial and of low value. YAGNI.

- [ ] **Step 2: Pass `isHandRevealed` to `CardContextMenu`**

Find the `<CardContextMenu ...>` render in `MultiplayerCanvas.tsx` (there may be more than one — one for own cards, potentially one for opponent's zone menus). For the own-card menu, pass the local player's `handRevealed` flag:

```tsx
<CardContextMenu
  card={contextMenu.card}
  x={contextMenu.x}
  y={contextMenu.y}
  actions={multiplayerActions}
  isHandRevealed={myPlayer?.handRevealed ?? false}
  onClose={() => setContextMenu(null)}
  /* ...existing props unchanged... */
/>
```

Confirm the local-player row variable name by grepping the file for `handRevealed` — use whatever variable already holds the local `Player` row.

- [ ] **Step 3: Update the opponent face-down rule for reveals**

Locate the hand face-down rule near line 2952:

```ts
if (card.isFlipped && card.ownerId === 'player2') {
  // opponent's hand card — show back
```

(This logic may already be encapsulated in `GameCardNode`'s `showFace` check after Task 8 — if so, this step is redundant and can be skipped. Verify by searching `MultiplayerCanvas.tsx` for any place that decides between `CardImage` and `CardBackShape` independently of `GameCardNode`. If such a place exists, update its condition to:)

```ts
const isActivelyRevealed =
  typeof card.revealUntil === 'number' && card.revealUntil > Date.now();
const shouldShowBack =
  card.isFlipped && card.ownerId === 'player2' && !isActivelyRevealed;
```

- [ ] **Step 4: Drive the tick in multiplayer canvas**

Add a `useRevealTick` invocation near the top of `MultiplayerCanvas`:

```ts
import { useRevealTick } from '@/app/shared/hooks/useRevealTick';
// ...
const anyHandActiveReveal = useMemo(() => {
  const hands = [
    ...(state.zones.hand ?? []),
    // Opponent hand is rendered by its own computed list — include it too:
    // if the file exposes an opponent-hand array, include it here. Otherwise
    // rely on the single shared hand state.
  ];
  return hands.some(c => typeof c.revealUntil === 'number' && c.revealUntil > Date.now());
}, [state.zones.hand]);
useRevealTick(anyHandActiveReveal);
```

Note: `MultiplayerCanvas` maintains separate own and opponent hand renderings. Grep the file for how the opponent hand is built and include its array in the `hands` union above so opponent-side badges (none in v1, but opponent-side face-up transitions) re-render correctly.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(reveal): wire revealCardInHand + face-up override in multiplayer"
```

---

## Task 17: Manual smoke — goldfish end-to-end

**Files:** none.

- [ ] **Step 1: Run dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify each behavior**

Navigate to `localhost:3000/goldfish`, start a session, then confirm in order:

1. Right-click a hand card → menu shows **"Reveal for 30s"**.
2. Click → a yellow countdown badge appears on the card, starts at `30s`, decrements each second.
3. At `0s`, the badge disappears. Card is otherwise unchanged.
4. Re-click "Reveal for 30s" mid-reveal → countdown resets to `30s`.
5. Drag the card to Territory (or right-click → Discard) mid-reveal → badge disappears immediately.
6. Shuffle the card into deck mid-reveal → badge disappears immediately.

If any step fails, stop and fix before proceeding.

- [ ] **Step 3: No commit (smoke test only)**

---

## Task 18: Manual smoke — multiplayer two-tab test

**Files:** none.

**Prereq:** SpacetimeDB module is published to the default server (Task 13 complete).

- [ ] **Step 1: Run dev server and open two tabs**

Run: `npm run dev`

Open two browser windows (a normal window and an incognito so they have separate identities). In each, sign in as different users, create/join a multiplayer game, and enter `app/play/[code]`.

- [ ] **Step 2: Verify cross-client behavior**

Player A:

1. Right-click a hand card → "Reveal for 30s" appears and is enabled.
2. Click → badge appears on A's side with countdown.
3. On Player B's side (opponent), the card flips face-up within ~1 second and stays face-up until the timer expires.
4. When the countdown hits 0 on A's side, B's card flips back to face-down within ~1 second.

Cross-checks:

5. Player A reveals a card, then immediately plays it to Territory → B sees the card move to Territory (face-up, as it always would be); the reveal badge is gone on A's side; no residual state.
6. Player A reveals a card, then reloads their tab → badge reappears with the remaining time computed from the server timestamp.
7. Player A right-clicks a Player B hand card → "Reveal for 30s" is NOT in the menu (ownership gate).
8. Player A toggles full-hand reveal → per-card "Reveal for 30s" is hidden in the menu for all A's hand cards.

If any cross-client step fails, stop and fix before proceeding.

- [ ] **Step 3: No commit (smoke test only)**

---

## Self-Review Checklist

Before marking the plan complete, re-verify:

- [x] Spec coverage — every behavior in the spec maps to a task:
  - "Right-click option in hand" → Task 6 menu entry + Task 7 goldfish wiring + Task 16 multiplayer wiring.
  - "Reveal face to opponents/spectators for 30s" → Task 8 face-up override + Task 11 server reducer + Task 14 adapter mapping.
  - "Owner-side badge + countdown" → Task 8 badge + Task 5 tick hook + Task 9 goldfish tick + Task 16 multiplayer tick.
  - "Timer reset on re-click" → Task 3 reducer action (sets new `revealUntil`) + Task 11 server reducer (sets new `reveal_expires_at`).
  - "Clear on leaving hand" → Task 3 goldfish clears + Task 12 server clears.
  - "Hide menu when full hand already revealed" → Task 6 visibility gate + Task 16 `isHandRevealed` prop.
- [x] No TBD / TODO / "similar to above" / placeholder text in any task body.
- [x] Type consistency: `revealUntil` (ms epoch, client) vs `revealExpiresAt` (microseconds timestamp, server) — mapping explicit in Task 14.
- [x] Test coverage: goldfish reducer has vitest unit tests (Task 3); UI is covered by manual smoke (Tasks 17–18). SpacetimeDB reducers have no unit tests in this repo — covered by manual cross-tab smoke.
