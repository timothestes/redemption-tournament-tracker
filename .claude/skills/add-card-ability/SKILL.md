---
name: add-card-ability
description: >
  Add a new right-click custom ability to a card. Covers two scenarios:
  (A) register a new card with an EXISTING ability type (most common — e.g.
  "make X spawn Y tokens"), and (B) add a NEW ability type for non-token
  effects (shuffle+draw, counter manipulation, draw, discard, or a one-off
  custom reducer). Use when the user asks to make a card do anything special
  on right-click. Always updates BOTH registry copies (lib + spacetimedb) and
  redeploys the module via the spacetimedb-deploy skill.
---

# Add a Card Ability

Adds a new entry to the per-card custom-ability system, OR extends the
system with a new ability type. V1 ships with `spawn_token`; non-token
abilities (shuffle+draw, counter effects, custom reducers) use the same
plumbing — add a new variant to the `CardAbility` union and implement
one helper per side.

## Two modes

**Mode A — New card, existing ability type** (most common, 5–10 min)
Example: "make The Accumulator spawn 7 Wicked Spirits". Add a row to
`CARD_ABILITIES` in both registry copies, pick an existing `type` like
`spawn_token`, republish. **See §"Mode A steps" below.**

**Mode B — New ability type** (1–2 hours; touches dispatch layer)
Example: "make card X shuffle 6 from hand and draw 6". Extend the
`CardAbility` union, update `abilityLabel()`, add dispatch cases in both
reducers, write two new helpers (goldfish pure + server transactional).
**See §"Mode B steps" below.**

## Architecture

| File | Purpose |
|------|---------|
| [lib/cards/cardAbilities.ts](../../../lib/cards/cardAbilities.ts) | Shared registry + handcrafted token data. Used by goldfish. |
| [spacetimedb/src/cardAbilities.ts](../../../spacetimedb/src/cardAbilities.ts) | **Duplicate** of the above (tsconfig can't cross the module boundary). Used by multiplayer server. |
| [lib/cards/__tests__/cardAbilities.test.ts](../../../lib/cards/__tests__/cardAbilities.test.ts) | Parity tests enforce the two copies stay in sync. |
| [app/goldfish/state/gameReducer.ts](../../../app/goldfish/state/gameReducer.ts) | `EXECUTE_CARD_ABILITY` case → `spawnTokenInState` helper (goldfish). |
| [spacetimedb/src/index.ts](../../../spacetimedb/src/index.ts) | `execute_card_ability` reducer → `spawnTokenImpl` helper (server). |
| [app/shared/components/CardContextMenu.tsx](../../../app/shared/components/CardContextMenu.tsx) | Renders ability items at the top of the right-click menu. |

**Spec:** [docs/superpowers/specs/2026-04-18-card-custom-abilities-design.md](../../../docs/superpowers/specs/2026-04-18-card-custom-abilities-design.md)

## Key design facts

- **Registry key is `cardName`** (includes the set suffix, e.g. `"Two Possessed (GoC)"`), NOT `identifier`. The `identifier` field is a taxonomy descriptor like `"Generic, Demon"` and isn't unique.
- **Ability source zones**: Territory, Land of Bondage, Land of Redemption. Cards in hand/deck/reserve/discard/banish/paragon/soul-deck can't trigger abilities. Enforced in menu + both reducers.
- **Tokens always spawn in Territory** (the visible free-form play area). Source card's zone only affects the *stagger base*, not the target zone.
- **Stagger coordinate systems differ**: goldfish uses **pixel coords** (100, 200, 300...), multiplayer uses **normalized 0–1 coords**. Each reducer has its own stagger constants.
- **Atomicity**: validate → build → commit. Multiplayer reducer transactionality is automatic; goldfish returns the original `state` reference on any precondition failure.

## Decision tree: real token vs handcrafted token

**Q1: Does the token card exist in `lib/cards/generated/cardData.ts`?**

```bash
grep '"name": "MY Token Name"' lib/cards/generated/cardData.ts
```

**Yes (real carddata token)** → You only need to add a `CARD_ABILITIES` entry in BOTH registries and a `TOKEN_CARD_DATA` entry in the spacetimedb registry (server can't reach `findCard()`).

**No (handcrafted token)** → The token's image lives under `public/gameplay/*.png|jpg`. You must ALSO add a `SPECIAL_TOKEN_CARDS` entry in `lib/cards/cardAbilities.ts` and a matching `TOKEN_CARD_DATA` entry in `spacetimedb/src/cardAbilities.ts`.

## Mode A steps — new card, existing ability type

### 1. Find the source card's exact `cardName`

The registry key must match `GameCard.cardName` byte-for-byte, including set suffixes and quotes.

```bash
grep -n '"name": ".*Angel of the Harvest.*"' lib/cards/generated/cardData.ts
```

Example matches:
- `"name": "Angel of the Harvest (GoC)"` — use exactly this string as the key.
- `"name": "Lost Soul \"Harvest\" [John 4:35]"` — quoted parts are literal; in TS use single-quoted strings so double quotes inside don't need escaping: `'Lost Soul "Harvest" [John 4:35]'`.

### 2. Find (or design) the token

**Real carddata token:** use the `name` field from carddata as `tokenName`. Verify it resolves:

```bash
grep '"name": "Violent Possessor Token"' lib/cards/generated/cardData.ts
```

**Handcrafted token:** pick a stable `tokenName` key (e.g. `"Harvest Soul Token"`). Place the image under `public/gameplay/` with a `.png` or `.jpg` extension. Image path is `/gameplay/<filename>` (leading slash, included in `imgFile`).

### 3. Add the ability entry to BOTH registries

Both files have a `CARD_ABILITIES: Record<string, CardAbility[]>` object. Add the same entry to each:

```ts
// lib/cards/cardAbilities.ts AND spacetimedb/src/cardAbilities.ts
'<exact cardName>': [{ type: 'spawn_token', tokenName: '<token name>', count: <N> }],
```

- `count` is optional; defaults to 1. Set explicitly for cards that spawn multiple tokens per activation (e.g. The Accumulator spawns 7 Wicked Spirits).
- A card can have multiple abilities — the array can hold more than one entry. The context menu renders one item per ability.

**Parity tests will fail** if the two copies drift.

### 4. (Real carddata token) Add `TOKEN_CARD_DATA` entry to `spacetimedb/src/cardAbilities.ts`

The server can't call `findCard()` (its tsconfig can't reach the generated `CARDS`), so token metadata is hardcoded server-side.

Copy the 11 fields from carddata into the format below:

```ts
// spacetimedb/src/cardAbilities.ts → TOKEN_CARD_DATA
'<tokenName>': {
  name: '<name>',
  set: '<set>',
  imgFile: '<imgFile>',          // bare filename for real carddata tokens
  cardType: '<type>',             // e.g. 'Evil Character Token', 'Hero Token'
  brigade: '<brigade>',
  strength: '<strength>',
  toughness: '<toughness>',
  alignment: '<alignment>',
  identifier: '<identifier>',
  specialAbility: '<specialAbility>',
  reference: '<reference>',
},
```

Only add this on the server side — lib-side `resolveTokenCard()` uses `findCard()` which reads the same data from `CARDS`.

### 5. (Handcrafted token ONLY) Add to both `SPECIAL_TOKEN_CARDS` and `TOKEN_CARD_DATA`

**lib/cards/cardAbilities.ts → SPECIAL_TOKEN_CARDS** — uses `CardData` shape (note `type`, not `cardType`):

```ts
'<tokenName>': {
  name: 'Lost Soul Token "Harvest"',  // display name
  set: '',
  imgFile: '/gameplay/harvest_soul_token.jpg',  // FULL path with leading slash and extension
  officialSet: '',
  type: 'Lost Soul',
  brigade: '',
  strength: '',
  toughness: '',
  class: '',
  identifier: '',
  specialAbility: '',
  rarity: 'Token',
  reference: 'John 4:35',
  alignment: 'Neutral',
  legality: '',
},
```

**spacetimedb/src/cardAbilities.ts → TOKEN_CARD_DATA** — uses the server shape (note `cardType`, not `type`):

```ts
'<tokenName>': {
  name: 'Lost Soul Token "Harvest"',
  set: '',
  imgFile: '/gameplay/harvest_soul_token.jpg',
  cardType: 'Lost Soul',
  brigade: '',
  strength: '',
  toughness: '',
  alignment: 'Neutral',
  identifier: '',
  specialAbility: '',
  reference: 'John 4:35',
},
```

### 6. Run the parity tests

```bash
npx vitest run lib/cards/__tests__/cardAbilities.test.ts
```

Expected: all tests pass. Key tests:
- `every key resolves to a real card via findCard()` — source cardName must exist in `CARDS`.
- `every spawn_token.tokenName resolves via resolveTokenCard()` — token must be in `SPECIAL_TOKEN_CARDS` OR in `CARDS`.
- `SpacetimeDB duplicate of CARD_ABILITIES stays in sync` — the two registries must match.
- `every spawn_token in the registry has metadata in TOKEN_CARD_DATA` — server-side metadata must exist for every token.
- `every SPECIAL_TOKEN_CARDS image path resolves to a public/gameplay asset` — imgFile must match `/gameplay/*.{png|jpg|jpeg|svg|webp}`.

### 7. Republish the SpacetimeDB module

Invoke the `spacetimedb-deploy` skill (publishes dev + prod and regenerates bindings). Required whenever `spacetimedb/src/` changes — even a registry edit.

Since this is a behavior-only change (no schema change), the publish is in-place with no data loss. No `--clear-database` needed.

### 8. Hard-refresh the client

Client bundles are cached. Tell the user to hard-refresh (Cmd+Shift+R / Ctrl+Shift+R) to pick up any client-side registry changes.

### 9. Manual QA

- Open goldfish, load a deck containing the source card, right-click it in play. Ability item appears at the top of the menu.
- Click the item. Token(s) spawn in Territory, staggered if count > 1.
- In multiplayer (2 browsers), verify the spawn syncs to both clients.

## Common pitfalls

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Right-click menu shows no ability item | `cardName` mismatch (wrong set suffix, wrong quote style, typo) | Re-grep carddata for the exact `name` field |
| Ability item appears but clicking does nothing visible | Stale client JS | Hard-refresh |
| Ability item appears on cards in hand/deck | Should be zone-gated — check `ABILITY_SOURCE_ZONES` in CardContextMenu | Re-check the zone allowlist |
| Multiplayer spawn inserts rows but tokens render off-screen | Pixel coords instead of normalized 0–1 on the server | Server stagger must use fractions (~0.05), not pixels (~55) |
| Parity test fails with registry diff | Only updated one copy | Copy the new entry into the other file; test error message shows the diff |
| `SenderError: Unknown token` from server | Token name in `CARD_ABILITIES` doesn't match `TOKEN_CARD_DATA` key | Make sure the `tokenName` strings are byte-identical |
| Card name has `"quotes"` and you used double-quoted TS string | Need to escape inner quotes | Use single-quoted TS string: `'Lost Soul "Harvest" [John 4:35]'` |

## Mode B steps — add a new ability type

Pick this mode when the user wants a non-token effect: "shuffle 6 from
hand and draw 6", "add 3 red counters to a target", "discard the top
card of opponent's deck", etc.

Decision sub-fork:

**B1: Pattern that could apply to many future cards** (e.g.
`shuffle_and_draw`, `modify_counters`, `draw_cards`). Add a new variant
to the `CardAbility` union so any future card can reuse it. Most work
happens in the shared reducer dispatch.

**B2: One-off, truly unique to a single card** (e.g. a card whose text
is genuinely unique and won't be reused). Use the `custom` escape hatch
— write a dedicated SpacetimeDB reducer and have the client route
directly to it. No changes to the shared dispatch.

### B1 — Add a reusable ability variant

Worked example: `shuffle_and_draw` (shuffle N cards from hand into
deck, then draw N). The spec reserves this variant but it isn't
implemented yet — this is the template for it.

#### Step 1. Extend the `CardAbility` union (both copies)

Both [lib/cards/cardAbilities.ts](../../../lib/cards/cardAbilities.ts) and
[spacetimedb/src/cardAbilities.ts](../../../spacetimedb/src/cardAbilities.ts)
already declare the variant:

```ts
export type CardAbility =
  | { type: 'spawn_token'; ... }
  | { type: 'shuffle_and_draw'; shuffleCount: number; drawCount: number }   // already reserved
  | { type: 'custom'; reducerName: string; label: string };
```

If your variant isn't there yet, add it to BOTH files. The parity test
will fail if they drift.

#### Step 2. Give it a human-readable label in `abilityLabel()`

Edit [lib/cards/cardAbilities.ts](../../../lib/cards/cardAbilities.ts) → `abilityLabel`. Already done for `shuffle_and_draw`:

```ts
case 'shuffle_and_draw':
  return `Shuffle ${a.shuffleCount} from hand, draw ${a.drawCount}`;
```

For a new variant, add a `case` that returns the text the context menu
should render (e.g. `` `Add ${a.count} red counters` ``).

#### Step 3. Write a goldfish helper (pure function)

In [app/goldfish/state/gameReducer.ts](../../../app/goldfish/state/gameReducer.ts), add a helper next to
`spawnTokenInState`. Same validate → build → commit pattern:

```ts
function shuffleAndDrawInState(
  state: GameState,
  source: GameCard,
  ability: Extract<CardAbility, { type: 'shuffle_and_draw' }>,
  history: GameState[],
): GameState {
  // Phase 1 — validate. Return original state reference on any failure.
  if (ability.shuffleCount < 0 || ability.drawCount < 0) return state;
  const ownerId = source.ownerId;
  const myHand = state.zones.hand.filter(c => c.ownerId === ownerId);
  const myDeck = state.zones.deck.filter(c => c.ownerId === ownerId);
  if (myHand.length < ability.shuffleCount) return state; // not enough to shuffle
  // ...check drawCount <= myDeck.length + myHand.length if you want strictness

  // Phase 2 — build new zones in memory. No mutation yet.
  const shuffleIds = new Set(
    [...myHand]
      .sort(() => Math.random() - 0.5)  // non-deterministic is fine for goldfish
      .slice(0, ability.shuffleCount)
      .map(c => c.instanceId)
  );
  const remainingHand = state.zones.hand.filter(c => !shuffleIds.has(c.instanceId));
  const reshuffled = [
    ...state.zones.deck,
    ...state.zones.hand.filter(c => shuffleIds.has(c.instanceId)),
  ].sort(() => Math.random() - 0.5);

  const drawn = reshuffled.slice(-ability.drawCount);
  const newDeck = reshuffled.slice(0, reshuffled.length - ability.drawCount);
  const newHand = [...remainingHand, ...drawn];

  // Phase 3 — commit.
  const zones = cloneZones(state.zones);
  zones.deck = newDeck;
  zones.hand = newHand;
  return { ...state, zones, history };
}
```

(Real implementation should use a seeded PRNG for determinism — see
`makeSeed()` in the SpacetimeDB module for the pattern — but goldfish
is client-only so `Math.random()` is acceptable.)

#### Step 4. Wire the helper into the goldfish dispatch switch

In the same file, find the `EXECUTE_CARD_ABILITY` reducer case's inner
switch on `ability.type`. The TypeScript exhaustiveness check will
force this edit — adding a new variant to the union breaks compilation
at the `const _exhaustive: never = ability` line until every case is
handled. Add:

```ts
case 'shuffle_and_draw':
  return shuffleAndDrawInState(state, source, ability, history);
```

#### Step 5. Write a server helper (transactional)

In [spacetimedb/src/index.ts](../../../spacetimedb/src/index.ts), add a helper next to
`spawnTokenImpl`. SpacetimeDB reducers are atomic — any `throw` inside
rolls back all writes made in the reducer so far:

```ts
function shuffleAndDrawImpl(
  ctx: any,
  source: any,
  ability: Extract<CardAbility, { type: 'shuffle_and_draw' }>,
  player: any,
  gameId: bigint,
) {
  if (ability.shuffleCount < 0 || ability.drawCount < 0) {
    throw new SenderError('Invalid counts');
  }

  // Gather my hand + deck (single-column index, manual filter)
  const myHand: any[] = [];
  const myDeck: any[] = [];
  for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
    if (c.ownerId !== source.ownerId) continue;
    if (c.zone === 'hand') myHand.push(c);
    else if (c.zone === 'deck') myDeck.push(c);
  }
  if (myHand.length < ability.shuffleCount) {
    throw new SenderError('Not enough cards in hand to shuffle');
  }

  // Seeded PRNG so replay is deterministic
  const seed = makeSeed(
    ctx.timestamp.microsSinceUnixEpoch,
    gameId,
    player.id,
    BigInt(myHand.length),
  );
  // ...use seed to pick `ability.shuffleCount` from myHand, mark them for
  // zone-move to 'deck', then reshuffle deck indices and draw top N.

  // Commit writes. Each update() MUST spread the existing row — partial
  // updates null out other fields (see spacetimedb/CLAUDE.md §Update pattern).
  for (const c of selectedFromHand) {
    ctx.db.CardInstance.id.update({ ...c, zone: 'deck', zoneIndex: ... });
  }
  // ...reindex deck, assign zoneIndex values, then move top N to hand...

  const game = ctx.db.Game.id.find(gameId);
  if (game) {
    logAction(
      ctx, gameId, player.id, 'SHUFFLE_AND_DRAW',
      JSON.stringify({ shuffleCount: ability.shuffleCount, drawCount: ability.drawCount }),
      game.turnNumber, game.currentPhase,
    );
  }
}
```

(Fill in the PRNG-driven selection using the `makeSeed()` /
`seededShuffle()` helpers already in `index.ts` — search for existing
`makeSeed(` calls for the canonical pattern.)

#### Step 6. Wire the server dispatch

In the same file, find `execute_card_ability`'s switch on
`ability.type`. It currently throws `SenderError('shuffle_and_draw not
yet implemented')`. Replace with:

```ts
case 'shuffle_and_draw':
  return shuffleAndDrawImpl(ctx, source, ability, player, gameId);
```

#### Step 7. Add a ChatPanel log renderer

In [app/play/components/ChatPanel.tsx](../../../app/play/components/ChatPanel.tsx),
add a case inside `formatActionType()` for the new action type you
logged in step 5. Mirror the `SPAWN_TOKEN` handler — parse the payload
JSON and return JSX with human-readable text. Without this, the log
renders `"PlayerName shuffle and draw"` via the default snake-case
fallback, which looks half-broken.

#### Step 8. Register the card(s) in the registry

Now that the variant exists, wire actual cards to it per Mode A §3:

```ts
'<exact cardName>': [{ type: 'shuffle_and_draw', shuffleCount: 6, drawCount: 6 }],
```

A card can have multiple abilities — the array supports mixing types:
one entry could be `spawn_token`, another `shuffle_and_draw`, and they
render as separate menu items.

#### Step 9. Tests

- Goldfish: add a test file or append to
  `app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts`
  covering the happy path, count-zero / negative rejection, not-enough-
  cards rejection (returns same state reference), owner inheritance.
- Registry integrity tests in
  `lib/cards/__tests__/cardAbilities.test.ts` already cover every
  `spawn_token.tokenName`; add a parallel assertion for your new variant
  if it references external data.

#### Step 10. Redeploy + hard-refresh

Invoke `spacetimedb-deploy`. Schema hasn't changed so publish is
in-place. Hard-refresh the browser.

### B2 — Use the `custom` escape hatch for a one-off

Pick this when an ability is genuinely unique to one card and adding a
reusable variant would be over-engineering. Example: a card whose text
is "your opponent randomly loses a card from their hand and you gain a
soul" — weird enough that it doesn't belong in a generic `transfer`
variant.

#### Step 1. Write a dedicated server reducer

In [spacetimedb/src/index.ts](../../../spacetimedb/src/index.ts):

```ts
export const my_unique_effect = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    // Phase 1 — validate (mirror execute_card_ability's shape).
    const player = findPlayerBySender(ctx, gameId);
    const source = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!source) throw new SenderError('Card not found');
    if (source.gameId !== gameId) throw new SenderError('Card not in this game');
    if (source.ownerId !== player.id) throw new SenderError('Not your card');
    const ABILITY_SOURCE_ZONES = ['territory', 'land-of-bondage', 'land-of-redemption'];
    if (!ABILITY_SOURCE_ZONES.includes(source.zone)) {
      throw new SenderError('Source card must be in play');
    }

    // Phase 2/3 — compute + write, validate-then-write ordering.
    // ...the unique effect logic here...

    // Log with an action type the ChatPanel knows (see step 3 below).
    const game = ctx.db.Game.id.find(gameId);
    if (game) logAction(ctx, gameId, player.id, 'MY_UNIQUE_EFFECT', '{}', game.turnNumber, game.currentPhase);
  },
);
```

Custom reducers do their own ownership + zone validation because they
bypass `execute_card_ability`.

#### Step 2. Register the card with `type: 'custom'`

In BOTH registry copies:

```ts
'<exact cardName>': [{
  type: 'custom',
  reducerName: 'myUniqueEffect',      // camelCase name as generated by spacetime generate
  label: 'Do the unique thing',        // exact menu text
}],
```

The `reducerName` is the **camelCase** version that appears in
`lib/spacetimedb/module_bindings/index.ts` after regeneration — NOT
the snake_case export name from `index.ts`. Bindings generation
auto-converts `my_unique_effect` → `myUniqueEffect`.

#### Step 3. Client-side routing is automatic

The wrapper in [app/play/hooks/useGameState.ts](../../../app/play/hooks/useGameState.ts)
already inspects the ability variant client-side. If you add a
`type: 'custom'` path, extend the wrapper to route directly to the
named reducer instead of `executeCardAbility`:

```ts
const executeCardAbility = useCallback(
  (sourceInstanceId: string, abilityIndex: number) => {
    // Look up the ability shape client-side so we can route custom
    // abilities to their dedicated reducer. Avoids a round-trip through
    // execute_card_ability (which would reject custom anyway).
    // (Use card.cardName to find the source — the wrapper currently only
    // has instanceId so this branch needs a bit of plumbing to look up
    // the card from the live CardInstance table.)
    conn?.reducers.executeCardAbility({
      gameId,
      cardInstanceId: BigInt(sourceInstanceId),
      abilityIndex: BigInt(abilityIndex),
    });
  },
  [conn, gameId],
);
```

When you add the first `custom` entry, flesh this wrapper out to
distinguish the two paths.

#### Step 4. Goldfish equivalent

If the effect should also work in goldfish, write a `doMyUniqueEffectInState`
helper in [app/goldfish/state/gameReducer.ts](../../../app/goldfish/state/gameReducer.ts)
following the spawnTokenInState atomicity pattern, and add
`case 'custom':` handling in the inner switch that reads
`ability.reducerName` and dispatches to the right helper.

If the effect is multiplayer-only, leave the goldfish `case 'custom'`
as its existing no-op.

#### Step 5. Log renderer + redeploy

Same as B1 steps 7 and 10. Don't forget the ChatPanel renderer for the
new action type, or the log will show snake_case gibberish.

## Configuration

| Setting | Value |
|---------|-------|
| Allowed source zones | `'territory'`, `'land-of-bondage'`, `'land-of-redemption'` |
| Default target zone | `'territory'` (override via `ability.defaultZone`) |
| Goldfish stagger | `STAGGER_X = 55, STAGGER_Y = 15` (pixel coords) |
| Multiplayer stagger | `STAGGER_X = 0.05, STAGGER_Y = 0.03` (normalized 0–1) |
| Fallback base position (goldfish) | `(200, 200)` if source not in territory |
| Fallback base position (multiplayer) | `(0.3, 0.4)` if source not in territory |
