# Per-Card Custom Abilities (Goldfish + Multiplayer)

**Date:** 2026-04-18
**Status:** Design approved, ready for implementation plan
**Scope:** Goldfish and multiplayer (SpacetimeDB) together

## Motivation

Goldfish and multiplayer modes currently support a fixed menu of card actions (meek, flip, counters, move to zone, notes, exchange, equipment). A small set of cards need per-card custom actions — most commonly, spawning a named token card in play.

The existing Land of Bondages flow hardcodes a single opponent-lost-soul spawn inside the goldfish reducer. The pattern doesn't scale: every new card ability would require a bespoke reducer branch, hardcoded UI, and its own SpacetimeDB reducer. This design introduces a single extensible system so any card can declare one or more custom right-click abilities in a shared registry, and both modes dispatch those abilities through a uniform code path.

V1 ships the `spawn_token` ability type, enough to cover every card in the GoC token-spawning set the user called out:

| Source card | Token |
|---|---|
| Two Possessed (GoC) | Violent Possessor Token |
| The Accumulator (GoC) | Wicked Spirit Token |
| The Proselytizers (GoC) | Proselyte Token |
| The Church of Christ (GoC) | Follower Token |
| Angel of the Harvest (GoC) | Heavenly Host Token |
| The Heavenly Host (GoC) | Heavenly Host Token |

All five token cards are confirmed present in `lib/cards/generated/cardData.ts` (verified via grep during spec prep — Follower, Heavenly Host, Proselyte, Violent Possessor, and Wicked Spirit Token entries all exist). No data import step is needed. If `make update-cards` ever pulls down a version of `carddata.txt` that drops one of these rows, the registry integrity unit test (see §Testing) will fail and the implementation will catch it.

The ability model is designed so future ability kinds (e.g., "shuffle N from hand, draw N") drop into the same framework without changing the dispatch path.

## Goals

1. One shared ability registry in TypeScript, consumed by both the Next.js client and the SpacetimeDB module.
2. Right-click menu on any card whose identifier has a registered ability shows one menu item per ability.
3. Goldfish reducer and SpacetimeDB reducer both dispatch the same ability definition.
4. Server-authoritative in multiplayer: the client sends only `(sourceInstanceId, abilityIndex)`; the server looks up the ability and validates ownership.
5. Extensible to non-token abilities (shuffle/draw, counter effects, one-off custom reducers) without refactoring the dispatch layer.

## Non-goals

- Once-per-game enforcement, targeting UIs, or in-game rules validation.
- An admin-editable ability catalog. Abilities live in TypeScript and ship with the app.
- Ability definitions attached to card data (`carddata.txt`). Abilities are app-level, not data-level.

## Architecture

### Ability registry

New file: `lib/cards/cardAbilities.ts`.

```ts
import type { Zone } from '@/app/goldfish/state/gameTypes';

export type CardAbility =
  | { type: 'spawn_token'; tokenName: string; count?: number; defaultZone?: Zone }
  | { type: 'shuffle_and_draw'; shuffleCount: number; drawCount: number }   // reserved
  | { type: 'custom'; reducerName: string; label: string };                 // reserved

export const CARD_ABILITIES: Record<string, CardAbility[]> = {
  'Two Possessed (GoC)':         [{ type: 'spawn_token', tokenName: 'Violent Possessor Token' }],
  'The Accumulator (GoC)':       [{ type: 'spawn_token', tokenName: 'Wicked Spirit Token' }],
  'The Proselytizers (GoC)':     [{ type: 'spawn_token', tokenName: 'Proselyte Token' }],
  'The Church of Christ (GoC)':  [{ type: 'spawn_token', tokenName: 'Follower Token' }],
  'Angel of the Harvest (GoC)':  [{ type: 'spawn_token', tokenName: 'Heavenly Host Token' }],
  'The Heavenly Host (GoC)':     [{ type: 'spawn_token', tokenName: 'Heavenly Host Token' }],
};

export function getAbilitiesForCard(identifier: string): CardAbility[] {
  return CARD_ABILITIES[identifier] ?? [];
}

export function abilityLabel(a: CardAbility): string {
  switch (a.type) {
    case 'spawn_token':      return `Create ${a.tokenName}${a.count && a.count > 1 ? ` ×${a.count}` : ''}`;
    case 'shuffle_and_draw': return `Shuffle ${a.shuffleCount} from hand, draw ${a.drawCount}`;
    case 'custom':           return a.label;
  }
}
```

**Keying:** `card.identifier` (the canonical identifier from `lib/cards/lookup.ts`). It's already present on `GameCard` and `CardInstance`, and it's stable across reprints and sets in a way that a bare card name is not.

**Shared between client and SpacetimeDB module:** preferred location is `lib/cards/cardAbilities.ts` imported directly by `spacetimedb/src/index.ts`. If the SpacetimeDB module's tsconfig cannot reach the app's `lib/`, fallback is to duplicate into `spacetimedb/src/cardAbilities.ts` and add a parity comment plus a simple structural-equality test (same pattern as the existing soul-defs duplication). The plan picks one at implementation time based on what actually builds.

### Context menu integration

File: `app/shared/components/CardContextMenu.tsx`.

1. At render time, call `getAbilitiesForCard(card.identifier)`.
2. If the returned array is non-empty, render a new menu section at the top of the menu (above meek/flip), separated by the existing divider style. One menu item per ability, label derived from `abilityLabel()`.
3. In multiplayer, hide the section when the local player is not the owner of the card (same rule as other player-side actions). In goldfish, always show.
4. Clicking an item calls a single new `GameActions.executeCardAbility(sourceInstanceId, abilityIndex)` method. The shared component stays agnostic of ability shape.

### Goldfish client dispatch

Files: `app/goldfish/state/gameActions.ts`, `app/goldfish/state/gameReducer.ts`.

Add one new action type:

```ts
type ExecuteCardAbilityAction = {
  type: 'EXECUTE_CARD_ABILITY';
  payload: { sourceInstanceId: string; abilityIndex: number };
};
```

Reducer case:

```ts
case 'EXECUTE_CARD_ABILITY': {
  const { sourceInstanceId, abilityIndex } = action.payload;
  const source = findCardInstance(state, sourceInstanceId);
  if (!source) return state;
  const ability = getAbilitiesForCard(source.identifier)[abilityIndex];
  if (!ability) return state;
  switch (ability.type) {
    case 'spawn_token':      return spawnTokenInState(state, source, ability);
    case 'shuffle_and_draw': return shuffleAndDrawInState(state, source, ability); // future
    case 'custom':           return state; // goldfish has no custom dispatch; see §Multiplayer
  }
}
```

`spawnTokenInState(state, source, ability)` is a pure function and follows a **validate-then-build-then-commit** pattern so the reducer is all-or-nothing. Any precondition failure returns the original `state` reference unchanged; no partial mutation is ever observable.

```ts
function spawnTokenInState(state, source, ability) {
  // Phase 1 — validate. Any failure returns state unchanged.
  const tokenData = findCard(ability.tokenName);
  if (!tokenData) { console.warn('Unknown token', ability.tokenName); return state; }
  const targetZone = computeTargetZone(source, ability);
  if (!targetZone) return state;
  const count = ability.count ?? 1;
  if (count < 1) return state;

  // Phase 2 — build the full list of new cards in memory. No state touched yet.
  const newCards: GameCard[] = Array.from({ length: count }, () => ({
    instanceId: nextInstanceId(),
    ownerId: source.ownerId,
    isToken: true,
    cardName: tokenData.name,
    cardSet: tokenData.set,
    cardImgFile: tokenData.imgFile,
    cardType: tokenData.type,
    brigade: tokenData.brigade,
    strength: tokenData.strength,
    toughness: tokenData.toughness,
    alignment: tokenData.alignment,
    identifier: tokenData.identifier,
    specialAbility: tokenData.specialAbility,
    reference: tokenData.reference,
    // …other GameCard fields initialised to their defaults
  }));

  // Phase 3 — commit in a single shallow clone. Same reducer convention used
  // elsewhere in gameReducer.ts. If Phase 2 threw, Phase 3 never runs.
  const zones = cloneZones(state.zones);
  zones[targetZone] = [...zones[targetZone], ...newCards];
  return { ...state, zones };
}
```

Target-zone computation:
- If `source.zone` is a play zone (`territory`, `battleArea`, `landOfBondages`), target = `source.zone`.
- Otherwise, target = `ability.defaultZone ?? 'territory'` on `source.ownerId`'s side.

The existing goldfish cleanup rule (`gameReducer.ts:92`) already removes any `isToken: true` card dropped into `reserve/banish/discard/hand/deck`, so newly spawned tokens get cleanup behavior for free. The existing `REMOVE_OPPONENT_TOKEN` path and `ADD_OPPONENT_LOST_SOUL` path both stay — they coexist with the new dispatch system; v1 doesn't migrate them.

### Multiplayer / SpacetimeDB dispatch

**Schema change** (`spacetimedb/src/schema.ts`): add `isToken: t.bool()` to `CardInstance`. Existing rows get `false` at migration time. No index needed — the field is checked only during zone-move and on render, not as a query key.

**New server reducer** (`spacetimedb/src/index.ts`), following the `spacetimedb.reducer(params, fn)` export form used by the rest of the module. The reducer is transactional — all database writes inside it either all commit or all roll back (per SpacetimeDB's per-reducer transaction guarantee, documented in `spacetimedb/CLAUDE.md`). The body is ordered **validate → compute → write** so no row is inserted until all preconditions have passed:

```ts
export const execute_card_ability = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    abilityIndex: t.u64(),
  },
  (ctx, { gameId, cardInstanceId, abilityIndex }) => {
    // Phase 1 — validate. Throw on any failure; SpacetimeDB rolls back.
    const player = findPlayerBySender(ctx, gameId);

    const source = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!source) throw new SenderError('Card not found');
    if (source.gameId !== gameId) throw new SenderError('Card not in this game');
    if (source.ownerId !== player.id) throw new SenderError('Not your card');

    const abilities = getAbilitiesForCard(source.identifier);
    const ability = abilities[Number(abilityIndex)];
    if (!ability) throw new SenderError('No such ability');

    // Phase 2 — dispatch. Each impl follows the same validate-then-write shape.
    // `custom` is not handled here — the client calls the dedicated custom
    // reducer directly, bypassing this one (see §Client dispatch below).
    switch (ability.type) {
      case 'spawn_token':      return spawnTokenImpl(ctx, source, ability, player);
      case 'shuffle_and_draw': return shuffleAndDrawImpl(ctx, source, ability, player); // future
      case 'custom':           throw new SenderError('Custom abilities are dispatched by the client, not this reducer');
    }
  }
);
```

`spawnTokenImpl(ctx, source, ability, player)` is a module-local helper (not its own reducer) and follows the same validate-then-write shape:

1. **Validate.** Resolve token `CardData` from the module's card-data source for `ability.tokenName`. If missing, `throw new SenderError('Unknown token')` — reducer rolls back before any insert.
2. **Compute.** Target zone = `source.zone` if it is a play zone (`territory`, `battle`, `land-of-bondage` — match the strings used elsewhere in the module); otherwise `ability.defaultZone ?? 'territory'`. Compute `maxIdx` for the target (zone, ownerId) — same pattern as `move_card`.
3. **Write.** For `n = ability.count ?? 1` iterations, insert:
   ```ts
   ctx.db.CardInstance.insert({
     id: 0n,
     gameId,
     ownerId: source.ownerId,
     zone: targetZone,
     zoneIndex: ++maxIdx,
     isToken: true,
     isMeek: false,
     isFlipped: false,
     isSoulDeckOrigin: false,
     equippedToInstanceId: 0n,
     notes: '',
     posX: '',
     posY: '',
     cardName: tokenData.name,
     cardSet: tokenData.set,
     cardImgFile: tokenData.imgFile,
     cardType: tokenData.type,
     brigade: tokenData.brigade,
     strength: tokenData.strength,
     toughness: tokenData.toughness,
     alignment: tokenData.alignment,
     identifier: tokenData.identifier,
     specialAbility: tokenData.specialAbility,
     reference: tokenData.reference,
   });
   ```
   (Field list mirrors whatever `CardInstance` actually defines at implementation time; the above is illustrative.)
4. After all inserts succeed, append a `logAction(ctx, gameId, player.id, 'SPAWN_TOKEN', ...)` entry so the game log shows the event. If any insert in step 3 throws (schema mismatch, etc.), the reducer rolls back and no log row is written either — the whole invocation is atomic.

**Zone-change cleanup** — edit the existing `move_card` reducer (`spacetimedb/src/index.ts:1567`): if the moved card has `isToken === true` and the destination zone is one of `reserve`/`banish`/`discard`/`hand`/`deck`, delete the row instead of updating its zone. This generalizes the existing lost-soul redirect to tokens but sends them to oblivion rather than to land-of-bondage.

**Client dispatch** (object syntax, not positional): the client-side `GameActions.executeCardAbility` wrapper inspects the ability type and routes accordingly.

```ts
function executeCardAbility(sourceInstanceId: bigint, abilityIndex: number) {
  const source = findCardInstance(sourceInstanceId);
  if (!source) return;
  const ability = getAbilitiesForCard(source.identifier)[abilityIndex];
  if (!ability) return;

  if (ability.type === 'custom') {
    // Escape hatch: call the dedicated reducer by name. That reducer does its
    // own ownership validation and runs in its own atomic transaction.
    conn.reducers[ability.reducerName]({
      gameId,
      cardInstanceId: sourceInstanceId,
    });
    return;
  }

  // Shared-pattern abilities go through the generic reducer. The server
  // re-reads the registry and rejects if the ability is no longer valid.
  conn.reducers.executeCardAbility({
    gameId,
    cardInstanceId: sourceInstanceId,
    abilityIndex: BigInt(abilityIndex),
  });
}
```

Routing `custom` on the client (rather than making `execute_card_ability` chain into another reducer) keeps each reducer to a single top-level transaction — the idiomatic SpacetimeDB shape. Each custom reducer is responsible for its own ownership check (same `findPlayerBySender` + `ownerId` comparison). Validation-first ordering is part of the template for any future custom reducer added under this hatch.

**Ownership model:** the client sends only `(gameId, cardInstanceId, abilityIndex)`. The server re-reads the registry by the card's `identifier`. A malicious client cannot spawn a token from a card it does not own, cannot spawn from an arbitrary `cardInstanceId` it invented, and cannot spawn an arbitrary token card not declared in the registry for that source.

**Bindings regen:** per `spacetimedb/CLAUDE.md`, schema changes require `spacetime publish` + `spacetime generate`. The multiplayer PR uses the `spacetimedb-deploy` skill (or the same commands) after the schema edit so the generated `module_bindings/` reflect the new `isToken` field and the new reducer. The multiplayer PR bumps nothing in goldfish (PR 1 is already merged by then).

### Visual treatment

- Token-spawned cards render with a small corner tag reading "Token" in both modes. Implemented in the existing card render component by checking `isToken`.
- No change to card size, art, or border style. The tag is visually quiet, in keeping with the "function over form" design principle.
- Token's special ability text is available through the existing card tooltip/info hover path — no new UI needed.

## Data flow

### Goldfish spawn

1. User right-clicks Two Possessed in their Battle Area.
2. `CardContextMenu` reads `getAbilitiesForCard('Two Possessed (GoC)')` → one ability.
3. Menu renders "Create Violent Possessor Token" at the top.
4. Click → `GameActions.executeCardAbility(instanceId, 0)`.
5. Reducer dispatches, `spawnTokenInState` adds a Violent Possessor Token `GameCard` with `isToken: true` to the same Battle Area slot.

### Multiplayer spawn

1. User right-clicks Two Possessed in their Battle Area.
2. `CardContextMenu` reads abilities (same as goldfish) and confirms ownership against the local player identity.
3. Click → `conn.reducers.executeCardAbility(instanceId, 0)`.
4. Server validates ownership, looks up the ability, inserts a new `CardInstance` row with `isToken: true` in the same zone.
5. Both clients receive the row insertion via SpacetimeDB subscription and render the new token.

### Auto-cleanup

- User drags a spawned token into Discard.
- Goldfish: the existing token-cleanup check in the drop reducer fires because `isToken` is true. The instance is deleted rather than moved.
- Multiplayer: same check added to `moveCard` on the server. The instance is deleted.

## Atomicity / ACID guarantees

Ability execution is all-or-nothing in both modes. A partially-spawned pair of tokens, a committed spawn with no log entry, or a reducer that mutates state and then throws are all forbidden.

**Multiplayer (SpacetimeDB):** per `spacetimedb/CLAUDE.md`, each reducer invocation is a single atomic transaction. Every write (`ctx.db.*.insert`, `update`, `delete`, `logAction`) inside `execute_card_ability` either all commits at the end or all rolls back on throw. The reducer body is ordered **validate → compute → write** so no insert runs before every precondition has passed, which minimises the chance of a half-formed rollback being visible even to server logs.

**Goldfish (React reducer):** atomicity is achieved structurally, not by a transaction manager. The `spawnTokenInState` function returns either:
- the **original `state` reference** (any precondition failed — React diffs it as unchanged), or
- a **freshly constructed new state** with all `count` new tokens already appended.

Mutation only happens inside the Phase 3 clone step, and if Phase 2 (building `newCards`) throws, Phase 3 never runs. The reducer never returns a partially-updated state object.

**Custom-reducer escape hatch:** the client routes `type: 'custom'` abilities directly to a dedicated SpacetimeDB reducer. That reducer inherits the same single-transaction atomicity guarantee as `execute_card_ability`. Custom reducers added in the future MUST follow the same validate-then-write ordering — the plan's reviewer should reject any custom reducer that writes before all its preconditions have been checked.

**No optimistic client-side writes:** the Next.js client does NOT speculatively insert into local state before the server acknowledges. Token spawns in multiplayer appear only when the server's `CardInstance` insert propagates through the subscription. This matches the existing patterns in `move_card` / `move_cards_batch` and prevents a rejected server call from leaving a ghost token in the UI.

**Count > 1 atomicity:** if an ability has `count: 2` and the first insert succeeds but the second throws, goldfish's Phase-3 commit never runs (the throw propagates through Phase 2's build loop, and the original `state` is returned unchanged). SpacetimeDB's reducer transaction rolls back both inserts. Either way, 0 or `count` tokens appear — never in between.

## Error handling

- Unknown `tokenName` in the registry (fat-fingered string): goldfish logs once and returns `state` unchanged; multiplayer throws `SenderError('Unknown token')` before any write. Caught in the registry unit test.
- Unknown `cardIdentifier` in the registry (card referenced doesn't exist): caught in the registry unit test.
- Source card not owned by sender (multiplayer): server rejects with `SenderError('Not your card')` during Phase 1; no writes occur.
- Source card destroyed mid-dispatch: lookup returns undefined; goldfish returns `state` unchanged, multiplayer throws `SenderError('Card not found')`.
- Corrupt `abilityIndex` (out of range): goldfish returns `state` unchanged; multiplayer throws `SenderError('No such ability')`.
- Mid-spawn exception (e.g., insert fails schema validation for token #2 of 2): both modes roll back entirely per the atomicity contract above.

## Testing

**Unit tests:**

- `spawnTokenInState`: same-zone spawn (territory / battle area / land of bondages), fallback when source is in hand, `count > 1`, unknown token no-op, owner inheritance, fresh `instanceId` per spawn.
- **Atomicity — goldfish:** when `findCard()` returns undefined, assert the returned state is strict-equal (`===`) to the input state. When `count > 1` and a hand-rolled throw fires after building the first token, assert the returned state is strict-equal to the input state (no partial commit).
- **Atomicity — multiplayer:** integration-style test against the module (or a careful mock) — invoke `execute_card_ability` with a forged `cardInstanceId` the sender doesn't own; assert the reducer throws `SenderError` and no new `CardInstance` rows exist. Same test for an out-of-range `abilityIndex`.
- `CARD_ABILITIES` registry integrity: every key resolves via `findCard()`; every `spawn_token.tokenName` resolves via `findCard()`.
- If the registry is duplicated into `spacetimedb/`, a parity test asserts the two copies stay in sync.

**Manual QA — goldfish:**

- Import the user's GoC deck.
- Right-click each of the six source cards in the Battle Area; verify the correct token appears with the correct art and metadata.
- Drag a token to Discard; verify it disappears.
- Spawn a token from a source card in Hand; verify it goes to Territory (fallback path).

**Manual QA — multiplayer:**

- Two browser windows, joined to the same game.
- Player A right-clicks their Two Possessed, picks "Create Violent Possessor Token". Token appears on both clients.
- Player A tries to right-click Player B's Two Possessed: either the menu section is hidden (preferred) or the server rejects the action.
- Player A drags their token to Discard; it disappears for both.

## Rollout

1. **PR 1 — goldfish only.** No schema change. Ships the registry, context menu integration, reducer action, `spawnTokenInState`, and the visual token tag. The existing `gameReducer.ts:92` cleanup rule already handles any `isToken: true` card, so spawned tokens inherit cleanup-on-drop for free. Real feedback available immediately.
2. **PR 2 — multiplayer.** Adds `isToken` to `CardInstance`, the server `executeCardAbility` and `spawnToken` reducers, and the token-cleanup check in `moveCard`. Includes `spacetime publish` + `spacetime generate` per the module's deploy rules.

## Future ability kinds (reserved in the type union, not implemented in v1)

- `shuffle_and_draw` — "Shuffle N from hand into deck, draw N." Reducer shuffles the top N of a random permutation of the player's hand back into the deck, deck is shuffled, player draws N.
- `modify_counters` — bulk counter adjustments on the source or a picked target.
- `custom` — escape hatch for one-off abilities that don't fit a shared pattern. The client-side `executeCardAbility` wrapper detects `type === 'custom'` and routes the call directly to `conn.reducers[ability.reducerName]` instead of `execute_card_ability`, keeping each reducer a single top-level transaction. The custom reducer does its own `findPlayerBySender` + `ownerId` check and follows the same validate-then-write ordering as every other reducer in the module.

None of these require changes to the dispatch layer, the registry shape, or the menu integration; they only add reducer branches (or, for `custom`, a new dedicated reducer).

## Open implementation decisions (to be resolved in the plan)

- Preferred vs. duplicated registry location for the SpacetimeDB module (see §Shared registry).
- Exact visual style of the "Token" badge (follow design system; small, quiet, top-right corner is the starting proposal).
- Whether to backfill `isToken = true` onto any currently-live opponent lost souls in existing SpacetimeDB multiplayer games or only apply to new rows (default is new rows only; old rows stay as they are).
