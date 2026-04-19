---
name: add-card-ability
description: >
  Add a new right-click custom ability to a card (currently supports spawn_token
  — e.g., "Two Possessed (GoC)" → creates 2 Violent Possessor Tokens). Use
  when the user asks to make a card spawn a token, create a token card, or
  add a right-click option for a specific card. Handles real carddata tokens
  AND handcrafted tokens (images under public/gameplay/ that aren't in
  carddata.txt). Always updates BOTH registry copies (lib + spacetimedb) and
  redeploys the module.
---

# Add a Card Ability

Adds a new entry to the per-card custom-ability system. V1 only supports
`spawn_token`; future ability kinds (shuffle_and_draw, custom one-offs) use
the same plumbing.

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

## Steps

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

## Extending to new ability types (future work)

The `CardAbility` union currently reserves two non-spawn variants:
- `{ type: 'shuffle_and_draw'; shuffleCount: number; drawCount: number }` — not yet implemented.
- `{ type: 'custom'; reducerName: string; label: string }` — escape hatch for one-off reducers.

To add one, update:
1. Both `CardAbility` type unions (lib + spacetimedb).
2. `abilityLabel()` (lib) to render a menu label for the new variant.
3. The `ability.type` switch in both `spawnTokenInState` (goldfish) and `execute_card_ability` (server) — the `never` exhaustiveness check will point you here.

For `custom` specifically: the client wrapper in `useGameState.ts` routes `type: 'custom'` abilities directly to `conn.reducers[ability.reducerName]` instead of `execute_card_ability`, keeping each reducer a single atomic transaction. The custom reducer does its own ownership + zone validation.

## Configuration

| Setting | Value |
|---------|-------|
| Allowed source zones | `'territory'`, `'land-of-bondage'`, `'land-of-redemption'` |
| Default target zone | `'territory'` (override via `ability.defaultZone`) |
| Goldfish stagger | `STAGGER_X = 55, STAGGER_Y = 15` (pixel coords) |
| Multiplayer stagger | `STAGGER_X = 0.05, STAGGER_Y = 0.03` (normalized 0–1) |
| Fallback base position (goldfish) | `(200, 200)` if source not in territory |
| Fallback base position (multiplayer) | `(0.3, 0.4)` if source not in territory |
