# Delivered "Discard Top of Opponent's Deck" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-click ability on the `Delivered` (PoC) card that discards the top card of the opponent's deck, gated by opponent consent.

**Architecture:** Reuses the existing `request_opponent_action` / `ZoneSearchRequest` consent infrastructure. One new `CardAbility` variant (`discard_opponent_deck`) is added; the client menu router translates it into the existing `discard_deck_top` action string, which is already wired through the consent dialog and post-approval dispatch (`moveOpponentDeckCardsToZone('top', N, 'discard')`). No schema changes, no new server reducer.

**Tech Stack:** TypeScript, React 19, Next.js 15, SpacetimeDB (TS module), Vitest. Spec: `docs/superpowers/specs/2026-04-26-delivered-discard-opponent-deck-ability-design.md`.

---

## File Structure

| File | Change | Purpose |
|------|--------|---------|
| `lib/cards/cardAbilities.ts` | modify | Add union variant, `abilityLabel()` case, registry entry |
| `spacetimedb/src/cardAbilities.ts` | modify | Mirror union + registry entry (parity-required) |
| `spacetimedb/src/index.ts` | modify | Add unreachable `case 'discard_opponent_deck'` in `execute_card_ability` switch (TS exhaustiveness) |
| `app/goldfish/state/gameReducer.ts` | modify | No-op fallthrough in `EXECUTE_CARD_ABILITY` switch |
| `app/play/components/MultiplayerCanvas.tsx` | modify | Menu router: translate ability variant → `requestOpponentAction('discard_deck_top', ...)` |
| `lib/cards/__tests__/cardAbilities.test.ts` | modify | Add `abilityLabel` cases for new variant |
| `app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts` | modify | Add no-op test for `discard_opponent_deck` in goldfish |

---

## Task 1: Add `discard_opponent_deck` variant to the lib-side `CardAbility` union

**Files:**
- Modify: `lib/cards/cardAbilities.ts`
- Test: `lib/cards/__tests__/cardAbilities.test.ts`

- [ ] **Step 1: Write the failing label test**

Append to `lib/cards/__tests__/cardAbilities.test.ts` inside the existing `describe('abilityLabel', ...)` block (just before the closing `});` of that block — currently right after the `'uses explicit label for custom abilities'` test):

```typescript
  it('formats discard_opponent_deck for top position singular', () => {
    expect(abilityLabel({ type: 'discard_opponent_deck', position: 'top', count: 1 }))
      .toBe("Discard top 1 card of opponent's deck");
  });

  it('formats discard_opponent_deck for top position plural', () => {
    expect(abilityLabel({ type: 'discard_opponent_deck', position: 'top', count: 3 }))
      .toBe("Discard top 3 cards of opponent's deck");
  });

  it('formats discard_opponent_deck for bottom position', () => {
    expect(abilityLabel({ type: 'discard_opponent_deck', position: 'bottom', count: 2 }))
      .toBe("Discard bottom 2 cards of opponent's deck");
  });

  it('formats discard_opponent_deck for random position', () => {
    expect(abilityLabel({ type: 'discard_opponent_deck', position: 'random', count: 4 }))
      .toBe("Discard 4 random cards of opponent's deck");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/cards/__tests__/cardAbilities.test.ts`
Expected: FAIL — TypeScript error "Type '\"discard_opponent_deck\"' is not assignable to type ..." OR runtime test failures because the case isn't in `abilityLabel`.

- [ ] **Step 3: Add the variant to the union and the `abilityLabel` case**

In `lib/cards/cardAbilities.ts`, replace the existing `CardAbility` union declaration:

```typescript
export type CardAbility =
  | { type: 'spawn_token'; tokenName: string; count?: number; defaultZone?: ZoneId }
  | { type: 'shuffle_and_draw'; shuffleCount: number; drawCount: number }
  | { type: 'all_players_shuffle_and_draw'; shuffleCount: number; drawCount: number }
  | { type: 'reveal_own_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'look_at_own_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'look_at_opponent_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'discard_opponent_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'reserve_top_of_deck'; count: number }
  | { type: 'draw_bottom_of_deck'; count: number }
  | { type: 'custom'; reducerName: string; label: string };
```

In the same file, in the `abilityLabel()` switch, immediately after the `case 'look_at_opponent_deck'` block, add:

```typescript
    case 'discard_opponent_deck': {
      const where = a.position === 'random' ? `${a.count} random` : `${a.position} ${a.count}`;
      return `Discard ${where} card${a.count === 1 ? '' : 's'} of opponent's deck`;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/cards/__tests__/cardAbilities.test.ts`
Expected: PASS for the four new label tests. (Other tests in the file may now fail because the spacetimedb-side parity test will catch the missing variant — that's addressed in Task 2.)

- [ ] **Step 5: Commit**

```bash
git add lib/cards/cardAbilities.ts lib/cards/__tests__/cardAbilities.test.ts
git commit -m "feat(cards): add discard_opponent_deck ability variant + label"
```

---

## Task 2: Mirror the variant on the SpacetimeDB side and register `Delivered`

**Files:**
- Modify: `spacetimedb/src/cardAbilities.ts`
- Modify: `lib/cards/cardAbilities.ts`

- [ ] **Step 1: Run parity test to confirm it currently fails**

Run: `npx vitest run lib/cards/__tests__/cardAbilities.test.ts -t "SpacetimeDB duplicate"`
Expected: FAIL (registries diverged after Task 1).

- [ ] **Step 2: Mirror the union in the SpacetimeDB copy**

In `spacetimedb/src/cardAbilities.ts`, replace the existing `CardAbility` union with the same shape used on the lib side:

```typescript
export type CardAbility =
  | { type: 'spawn_token'; tokenName: string; count?: number; defaultZone?: ZoneId }
  | { type: 'shuffle_and_draw'; shuffleCount: number; drawCount: number }
  | { type: 'all_players_shuffle_and_draw'; shuffleCount: number; drawCount: number }
  | { type: 'reveal_own_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'look_at_own_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'look_at_opponent_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'discard_opponent_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'reserve_top_of_deck'; count: number }
  | { type: 'draw_bottom_of_deck'; count: number }
  | { type: 'custom'; reducerName: string; label: string };
```

- [ ] **Step 3: Add the `Delivered` registry entry to BOTH files**

In **both** `lib/cards/cardAbilities.ts` AND `spacetimedb/src/cardAbilities.ts`, append this line inside the `CARD_ABILITIES` object (place it near the other PoC-set entry `'False Prophecy (PoC)'` for grouping; trailing comma matters):

```typescript
  'Delivered':                                           [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
```

The exact key `'Delivered'` is taken from `lib/cards/generated/cardData.ts:17932` — bare name, no set suffix.

- [ ] **Step 4: Run all parity + registry tests to verify they pass**

Run: `npx vitest run lib/cards/__tests__/cardAbilities.test.ts`
Expected: PASS — all label tests, all registry-integrity tests including:
- `every key resolves to a real card via findCard()` (verifies `'Delivered'` exists in `CARDS`)
- `SpacetimeDB duplicate of CARD_ABILITIES stays in sync` (verifies parity)

- [ ] **Step 5: Commit**

```bash
git add lib/cards/cardAbilities.ts spacetimedb/src/cardAbilities.ts
git commit -m "feat(cards): register Delivered with discard_opponent_deck ability"
```

---

## Task 3: Add unreachable case to the SpacetimeDB `execute_card_ability` dispatch

**Files:**
- Modify: `spacetimedb/src/index.ts`

The new variant is dispatched client-side (matching the `look_at_opponent_deck` pattern). The server reducer should never receive it, but the TypeScript exhaustiveness check forces a case to keep `_exhaustive: never = ability` valid. Without this case, the spacetimedb module won't typecheck.

- [ ] **Step 1: Verify the typecheck currently fails**

Run: `cd spacetimedb && npx tsc --noEmit && cd ..`
Expected: FAIL — TypeScript reports that `'discard_opponent_deck'` is not handled in the switch and the `_exhaustive: never = ability` line errors with "Type ... is not assignable to type 'never'".

- [ ] **Step 2: Add the case**

In `spacetimedb/src/index.ts`, locate the `execute_card_ability` reducer switch around line 2810. Immediately after `case 'look_at_opponent_deck':` and its `throw new SenderError(...)`, insert:

```typescript
      case 'discard_opponent_deck':
        throw new SenderError('discard_opponent_deck is dispatched by the client, not this reducer');
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd spacetimedb && npx tsc --noEmit && cd ..`
Expected: PASS — no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "feat(spacetimedb): add discard_opponent_deck dispatch case"
```

---

## Task 4: Add goldfish no-op fallthrough for `discard_opponent_deck`

**Files:**
- Modify: `app/goldfish/state/gameReducer.ts`
- Test: `app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts`

Goldfish is single-player — no opponent exists. The variant should be a silent no-op there, consistent with how `look_at_opponent_deck` behaves.

- [ ] **Step 1: Write the failing test**

Append the following to `app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts` at the bottom of the file (before the final EOF; place inside its own new `describe` block):

```typescript
describe("EXECUTE_CARD_ABILITY — discard_opponent_deck (goldfish no-op)", () => {
  it('returns the same state reference when Delivered is activated', () => {
    const source = makeCard({
      cardName: 'Delivered',
      cardSet: 'PoC',
      type: 'GE/EE',
      identifier: '',
      alignment: 'Neutral',
      zone: 'territory',
    });
    const state = makeState([source]);

    const next = gameReducer(state, act('source-1', 0));

    // Single-player goldfish: no opponent → ability is a no-op.
    // Reducer must return the same state reference (no clone, no history push).
    expect(next).toBe(state);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts -t "discard_opponent_deck"`
Expected: FAIL — likely a TypeScript error on the missing switch case (the `_exhaustive: never` guard at the bottom of the switch fires) OR the test runs and fails because the reducer falls through to `default` and returns the original state by accident, which would actually pass — so the more reliable failure here is the typecheck error.

If the test passes accidentally because of the `default` arm returning `state`, that's still acceptable behavior — but the explicit case is required to keep the exhaustiveness check honest. Confirm via:

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: TypeScript error pointing at `_exhaustive: never = ability` until Step 3 lands.

- [ ] **Step 3: Add `discard_opponent_deck` to the no-op fallthrough cluster**

In `app/goldfish/state/gameReducer.ts`, locate the `EXECUTE_CARD_ABILITY` reducer's inner `switch (ability.type)` (around line 909). Replace the existing fallthrough cluster:

```typescript
        case 'reveal_own_deck':
        case 'look_at_own_deck':
        case 'look_at_opponent_deck':
          // Modal-driven effect — GoldfishCanvas intercepts the dispatch and
          // calls setPeekState directly. Reaching the reducer is a bug, no-op.
          return state;
```

with:

```typescript
        case 'reveal_own_deck':
        case 'look_at_own_deck':
        case 'look_at_opponent_deck':
        case 'discard_opponent_deck':
          // Modal-driven or opponent-required — GoldfishCanvas intercepts, or
          // the effect is multiplayer-only. No-op here.
          return state;
```

- [ ] **Step 4: Run test + typecheck to verify pass**

Run: `npx vitest run app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts -t "discard_opponent_deck"`
Expected: PASS — `next` is the same reference as `state`.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS — no exhaustiveness errors. (If the project tsconfig is too broad and slow, scope to the goldfish files only via the editor TS server; tsc on the whole repo is the safe verification.)

- [ ] **Step 5: Commit**

```bash
git add app/goldfish/state/gameReducer.ts app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts
git commit -m "feat(goldfish): no-op discard_opponent_deck (no opponent in goldfish)"
```

---

## Task 5: Add client-side menu router for `discard_opponent_deck`

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

The menu router translates the new ability variant into the existing `discard_deck_top` (or bottom/random) action string and passes it through `requestOpponentAction()`. The downstream consent dialog and post-approval dispatch are already wired up in this file.

- [ ] **Step 1: Locate the existing `look_at_opponent_deck` branch**

In `app/play/components/MultiplayerCanvas.tsx`, find the `look_at_opponent_deck` branch in the right-click ability handler (around line 1061). It looks like:

```typescript
      if (ability?.type === 'look_at_opponent_deck') {
        const action =
          ability.position === 'top' ? 'look_deck_top'
          : ability.position === 'bottom' ? 'look_deck_bottom'
          : 'look_deck_random';
        requestOpponentAction(action, JSON.stringify({ count: ability.count }));
        return;
      }
```

- [ ] **Step 2: Insert the new branch immediately after**

Add immediately after the closing `}` of the `look_at_opponent_deck` block, before the line that calls `gameState.executeCardAbility(...)`:

```typescript
      if (ability?.type === 'discard_opponent_deck') {
        const action =
          ability.position === 'top' ? 'discard_deck_top'
          : ability.position === 'bottom' ? 'discard_deck_bottom'
          : 'discard_deck_random';
        requestOpponentAction(action, JSON.stringify({ count: ability.count }));
        return;
      }
```

The downstream dispatch — line ~1886 in the same file — already handles `'discard_deck_top'` by calling `moveOpponentDeckCardsToZone('top', count, 'discard')`. Both `describeOpponentAction()` (line 188) and `describeRequesterAction()` (line 226) already cover this action string, so consent and denial UX needs no edits.

- [ ] **Step 3: TypeScript sanity check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS — no errors. If the file's switch-style ability handling has a `default`/exhaustiveness check that the new variant fails, fix it inline (it doesn't in current code, the chain is `if`/`return` style).

- [ ] **Step 4: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(play): route discard_opponent_deck ability through opponent consent"
```

---

## Task 6: Deploy SpacetimeDB module + regenerate bindings

**Files:**
- Side effect: redeploy module, regenerate `lib/spacetimedb/module_bindings/`

Behavior-only change — no schema fields were added. The module publishes in-place; no `--clear-database` and no data loss.

- [ ] **Step 1: Run the spacetimedb-deploy skill**

Invoke: `Skill(name='spacetimedb-deploy')`. The skill handles publishing the module, regenerating client bindings, and reloading dev/prod as configured by repo conventions.

Expected: Successful publish, fresh `lib/spacetimedb/module_bindings/` regenerated (the binding regeneration may produce zero diff since no reducers or tables changed — that's fine).

- [ ] **Step 2: Verify the registry change is live (server-side)**

The skill's deploy verification is sufficient. If you want to spot-check:

Run: `spacetime logs <module-name> | tail -20`
Expected: No errors after publish.

- [ ] **Step 3: Commit any binding regen output**

```bash
git status
# If lib/spacetimedb/module_bindings/ changed:
git add lib/spacetimedb/module_bindings/
git commit -m "chore: regenerate spacetimedb bindings after Delivered registry add"
# If no diff (likely — no reducer/table changes), skip this commit.
```

---

## Task 7: Manual QA in two browsers

**Files:** none — runtime verification.

The user prefers skipping `npm run build` for straightforward edits — rely on the dev server already running at localhost:3000.

- [ ] **Step 1: Hard-refresh both browser sessions**

In each open multiplayer client, press Cmd+Shift+R (Mac) / Ctrl+Shift+R to bust client caches and pull the new bundle.

- [ ] **Step 2: Happy-path multiplayer test (both players approve)**

1. Both players load decks containing `Delivered`.
2. Player A draws/plays Delivered into Territory.
3. Player A right-clicks Delivered → menu shows **"Discard top 1 card of opponent's deck"** at the top.
4. Player A clicks it.
5. Player B sees a consent dialog: *"Player A wants to discard the top 1 card of your deck."* with Approve / Deny buttons.
6. Player B clicks Approve.

Expected: Top card of B's deck moves to B's discard pile. The `ZoneSearchRequest` row clears. The action log shows the discard.

- [ ] **Step 3: Denial path**

Repeat steps 1–5. Player B clicks Deny.

Expected: A toast on Player A's screen reads something like *"discard top 1 of opponent's deck — denied"*. No card movement on either side. Request row deletes.

- [ ] **Step 4: Empty-deck edge case**

Reduce Player B's deck to 0 cards (move all to discard via dev tooling, or play through a long match). Then have Player A activate Delivered's ability → Player B approves.

Expected: No card movement (B has no top card). Request completes cleanly. No error toast on either side. (`moveOpponentDeckCardsToZone` already no-ops on an empty deck.)

- [ ] **Step 5: Goldfish (single-player) sanity check**

Open `/goldfish`, load a deck with Delivered, play it into Territory, right-click. The "Discard top 1 card of opponent's deck" item should appear (the menu is not zone-gated by player count). Clicking it is a silent no-op — no error, no state change.

- [ ] **Step 6: Source-zone gating sanity check**

Place Delivered in Hand (don't play it), right-click it. The ability item should NOT appear (the menu only surfaces abilities when the source is in Territory / Land of Bondage / Land of Redemption — enforced in `CardContextMenu.tsx`).

- [ ] **Step 7: Document QA results**

If everything passes, no commit needed for this task. If any QA step fails, file an issue note in the spec doc and stop — do not patch silently.

---

## Self-review notes

- **Spec coverage:** Every section of the spec maps to a task above (Task 1: union variant + label; Task 2: registry entry + parity; Task 3: server unreachable case; Task 4: goldfish no-op; Task 5: client router; Task 6: deploy; Task 7: manual QA mirror).
- **Type consistency:** `discard_opponent_deck` (snake_case) used uniformly across all task code blocks. Action string `discard_deck_top` (the existing one) used uniformly in Tasks 5 and 7.
- **No placeholders:** Every step has the exact code or command required. No "fill in error handling" or "TBD".
- **Frequent commits:** Each of Tasks 1–5 commits independently. Task 6 may or may not commit depending on binding diff.
- **TDD:** Tasks 1 and 4 follow red-green-commit. Tasks 2, 3, 5 are config/dispatch wiring whose correctness is enforced by the parity test (Task 2) and TypeScript exhaustiveness (Tasks 3 + 4 + 5) — no value in writing additional unit tests for those.
