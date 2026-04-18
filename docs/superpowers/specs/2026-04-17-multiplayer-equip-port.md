# Multiplayer Equip Port — Spec

**Status:** Ready to plan. Fresh context can start here.

**Goal:** Bring the goldfish "equip weapon to warrior" feature to multiplayer mode (`/play/[code]`), backed by SpacetimeDB. Same UX as goldfish: drag weapon onto warrior → attach, unlink icon → detach, warrior-drag carries weapons, cross-zone moves auto-unattach (LOB cascades weapons to discard).

**Out of scope:** Re-designing the equip mechanic. The rules, UX, and data model are already nailed down in goldfish. This is a faithful port.

---

## Background — how equip works in goldfish

Implemented in commits `e81dad4 .. 648254c` (plus post-merge fixes), summarized here so the multiplayer port matches exactly.

### Data model (goldfish)

One optional pointer on each card: `equippedTo?: string` holds the warrior's instance id. Unidirectional — the warrior's "attached weapons" list is derived by scanning the zone for cards pointing at it.

See [`app/shared/types/gameCard.ts`](../../../app/shared/types/gameCard.ts) — the field was added to the cross-mode `GameCard` type, so `CardInstance` in multiplayer is the only missing piece.

### Rules (encoded in reducer + UI)

| Situation | Behavior |
|-----------|----------|
| Weapon dropped on warrior in Territory (rect overlap ≥ 25%) | Attach — set `equippedTo = warrior.id` |
| Warrior dragged within Territory | Attached weapons follow at constant offset |
| Warrior leaves Territory (any destination ≠ Territory) | Auto-unlink |
| Warrior → LOB | Cascade: weapons go to **Discard** (not LOB) |
| Batch move with warrior + weapons together → LOB | Same cascade: warrior to LOB, weapons to Discard |
| Batch move warrior + weapons → any other non-territory zone | Both move to that zone, unlinked |
| Click unlink icon at seam | Detach, weapon stays at rendered position |
| Attach triggered from non-Territory source (e.g. from Hand) | Weapon moves to Territory as part of attach |
| One weapon per warrior | `MAX_EQUIPPED_WEAPONS_PER_WARRIOR = 1` (UI gate; reducer doesn't enforce) |

### Render order (goldfish)

Territory cards are rendered per-cluster: for each non-attached card, its attached weapons render first (behind), then the card itself. See `GoldfishCanvas.tsx` — look for the `flatMap` block in the territory-zone render.

Detach reorders the zone array so the detached weapon sits just before its former warrior, keeping it visually behind after the link breaks.

### Key goldfish files to mirror

| Concern | Goldfish file | What the multiplayer port needs |
|---------|---------------|--------------------------------|
| Types (shared) | [`app/shared/types/gameCard.ts`](../../../app/shared/types/gameCard.ts) | Already extended — no change needed. |
| Class helpers | [`lib/cards/lookup.ts`](../../../lib/cards/lookup.ts) — `isWarrior` / `isWeapon` | Already in shared lib — no change needed. |
| Reducer | [`app/goldfish/state/gameReducer.ts`](../../../app/goldfish/state/gameReducer.ts) — `ATTACH_CARD`, `DETACH_CARD`, MOVE_CARD cascade, MOVE_CARDS_BATCH LOB-split | **Must be reimplemented as SpacetimeDB reducers.** |
| Equip layout utility | [`app/goldfish/utils/equipLayout.ts`](../../../app/goldfish/utils/equipLayout.ts) — offset calc, rect-overlap hit test, constants | Pure module — reuse directly or move to `app/shared/`. |
| Canvas render + drag | [`app/goldfish/components/GoldfishCanvas.tsx`](../../../app/goldfish/components/GoldfishCanvas.tsx) — two-pass render, attach-on-drop, warrior-drag carries weapons, detach overlay | Mirror in the multiplayer canvas. |
| Context menu | [`app/shared/components/CardContextMenu.tsx`](../../../app/shared/components/CardContextMenu.tsx) — optional `onDetach` prop | Already shared — just thread `onDetach` at the multiplayer call site. |

---

## Multiplayer landscape — what exists

- `/play/[code]` route exists. Deck-select, lobby, playing states are all shipped.
- SpacetimeDB module at [`spacetimedb/src/`](../../../spacetimedb/src/) — `schema.ts` + `index.ts` + `utils.ts`. ~3200 lines of reducers already.
- Bindings generated via `spacetime generate`. Client consumes via `useTable(tables.cardInstance)` etc.
- **Before editing any SpacetimeDB code, read [`spacetimedb/CLAUDE.md`](../../../spacetimedb/CLAUDE.md).** It documents common SDK mistakes and hallucinated APIs.

### `CardInstance` table today (schema.ts)

```ts
export const CardInstance = table(
  {
    name: 'card_instance',
    public: true,
    indexes: [
      { accessor: 'card_instance_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
      { accessor: 'card_instance_owner_id', algorithm: 'btree' as const, columns: ['ownerId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    ownerId: t.u64(),
    zone: t.string(),
    zoneIndex: t.u64(),
    posX: t.string(),
    posY: t.string(),
    isMeek: t.bool(),
    isFlipped: t.bool(),
    cardName: t.string(),
    cardSet: t.string(),
    cardImgFile: t.string(),
    cardType: t.string(),
    brigade: t.string(),
    strength: t.string(),
    toughness: t.string(),
    alignment: t.string(),
    identifier: t.string(),
    specialAbility: t.string(),
    reference: t.string(),
    notes: t.string(),
  }
);
```

No `equippedTo` field. That's the one schema addition we need.

---

## Implementation plan

### Task 1 — Schema: add `equippedToInstanceId` to `CardInstance`

**File:** `spacetimedb/src/schema.ts`

Add a single column:

```ts
equippedToInstanceId: t.u64(),
```

SpacetimeDB doesn't have a native `Option<u64>` in the current schema syntax, so use `0n` as the "not equipped" sentinel. This matches how the codebase treats `posX`/`posY` (empty string = unset). Document the sentinel explicitly in a comment.

**Gotcha:** adding a column is NOT a breaking schema change for SpacetimeDB in the sense that it requires data migration — but existing deployments need a republish. Old client sessions will see the new column as `0n` (default) until they reconnect and subscribe.

### Task 2 — Reducers: `attach_card`, `detach_card`, and move-cascade

**File:** `spacetimedb/src/index.ts`

Mirror the goldfish reducer logic. Read `spacetimedb/CLAUDE.md` first — important patterns:
- Reducer calls use object syntax (`conn.reducers.attachCard({ weaponId, warriorId, gameId })`)
- `ctx.db.cardInstance.id.update({ ...existing, equippedToInstanceId: warriorId })` — spread existing row
- Use `ctx.sender` to validate ownership; never trust caller-supplied identity
- BigInt literals for u64 fields (`0n`, not `0`)

**2a. `attach_card` reducer**

```ts
export const attach_card = spacetimedb.reducer(
  { gameId: t.u64(), weaponInstanceId: t.u64(), warriorInstanceId: t.u64() },
  (ctx, { gameId, weaponInstanceId, warriorInstanceId }) => {
    // Validate game + ownership
    const game = ctx.db.game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player || player.gameId !== gameId) throw new SenderError('Not in this game');

    const weapon = ctx.db.cardInstance.id.find(weaponInstanceId);
    const warrior = ctx.db.cardInstance.id.find(warriorInstanceId);
    if (!weapon || !warrior) throw new SenderError('Card not found');
    if (weapon.ownerId !== player.id || warrior.ownerId !== player.id) {
      throw new SenderError('Cannot attach opponent cards');
    }
    if (warrior.zone !== 'territory') {
      throw new SenderError('Warrior not in territory');
    }

    // Move weapon into territory with equippedTo set and inherit warrior position
    ctx.db.cardInstance.id.update({
      ...weapon,
      zone: 'territory',
      equippedToInstanceId: warriorInstanceId,
      posX: warrior.posX,
      posY: warrior.posY,
      isFlipped: false,
    });
  }
);
```

**2b. `detach_card` reducer**

```ts
export const detach_card = spacetimedb.reducer(
  { gameId: t.u64(), weaponInstanceId: t.u64(), posX: t.string(), posY: t.string() },
  (ctx, { gameId, weaponInstanceId, posX, posY }) => {
    const weapon = ctx.db.cardInstance.id.find(weaponInstanceId);
    if (!weapon || weapon.gameId !== gameId) throw new SenderError('Card not found');
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player || weapon.ownerId !== player.id) throw new SenderError('Not your card');

    ctx.db.cardInstance.id.update({
      ...weapon,
      equippedToInstanceId: 0n,
      posX: posX || weapon.posX,
      posY: posY || weapon.posY,
    });
  }
);
```

**2c. Extend existing `move_card` reducer with cascade logic**

Find the existing `move_card` reducer (context-menu / keyboard move). When a card leaves Territory:
- Clear its own `equippedToInstanceId` (if any).
- Scan `cardInstance` by `gameId` index for rows with `equippedToInstanceId === movingCard.id`.
- If destination is `land-of-bondage`, move each matching weapon to `discard` (update row).
- Otherwise, just clear `equippedToInstanceId` on matching rows (they stay in territory).

```ts
// After updating the mover's zone/position, before committing:
if (toZone !== 'territory') {
  const attachedWeapons = [...ctx.db.cardInstance.card_instance_game_id.filter(gameId)]
    .filter(c => c.equippedToInstanceId === movingCard.id);
  for (const w of attachedWeapons) {
    if (toZone === 'land-of-bondage') {
      ctx.db.cardInstance.id.update({
        ...w,
        zone: 'discard',
        equippedToInstanceId: 0n,
        posX: '',
        posY: '',
      });
    } else {
      ctx.db.cardInstance.id.update({ ...w, equippedToInstanceId: 0n });
    }
  }
  if (movingCard.equippedToInstanceId !== 0n) {
    // Update was already dispatched above with new zone; now clear the attach
    // ... be careful: if the mover is a weapon, don't double-update.
    // Simplest: merge into the main update call by setting equippedToInstanceId: 0n there.
  }
}
```

Consolidate into the primary `update` call so the mover's own `equippedToInstanceId` is cleared in the same mutation.

**2d. Extend `move_cards_batch` (if it exists) or equivalent**

Multiplayer probably has a batch-move reducer too (check `index.ts`). Mirror the goldfish pattern:
- Pre-compute `finalZoneById` for each card.
- Redirect: weapons whose `equippedToInstanceId` is also in the batch and `toZone === 'land-of-bondage'` → final zone = `discard`.
- Always clear `equippedToInstanceId` on non-territory destinations.
- For weapons not in the batch whose warrior is being moved to LOB: update them to `discard`.

Goldfish reference: [`app/goldfish/state/gameReducer.ts`](../../../app/goldfish/state/gameReducer.ts) — `MOVE_CARDS_BATCH` case.

### Task 3 — Publish + regenerate bindings

Standard SpacetimeDB flow:

```bash
cd spacetimedb
spacetime publish <db-name> --module-path .
spacetime generate --lang typescript --out-dir ../spacetimedb/module_bindings --module-path .
```

Confirm the new reducer names `attach_card` / `detach_card` appear in the generated `module_bindings/index.ts` under `tables` and under the reducers object. Confirm `CardInstance` row type now includes `equippedToInstanceId: bigint`.

### Task 4 — Client adapter: `attachCard` / `detachCard` in multiplayer `GameActions`

The client calls reducers via a `GameActions` interface that's shared between goldfish and multiplayer (`app/shared/types/gameActions.ts`). Goldfish currently omits `attachCard` / `detachCard` from that shared interface (the goldfish port threaded them via a separate `onDetach` prop on `CardContextMenu`).

For multiplayer, there are two paths:
1. **Add optional `attachCard` / `detachCard` to `GameActions`.** Goldfish implements them, multiplayer implements them (both adapters). Then `CardContextMenu` can read them off `actions` instead of the separate `onDetach` prop. Cleanest long-term, minor refactor in goldfish.
2. **Thread separate props at the multiplayer call site.** Matches what goldfish currently does.

Recommend path 1 during this port — it removes the special-case prop for goldfish and unifies the API. If the port is already getting large, path 2 is a safe alternative.

Client reducer calls:

```ts
// In the multiplayer adapter
attachCard(cardId: string, warriorId: string) {
  conn.reducers.attachCard({
    gameId: BigInt(gameId),
    weaponInstanceId: BigInt(cardId),
    warriorInstanceId: BigInt(warriorId),
  });
},
detachCard(cardId: string, posX?: number, posY?: number) {
  conn.reducers.detachCard({
    gameId: BigInt(gameId),
    weaponInstanceId: BigInt(cardId),
    posX: posX !== undefined ? String(posX) : '',
    posY: posY !== undefined ? String(posY) : '',
  });
},
```

### Task 5 — Multiplayer canvas: render, drag, and overlay

Find the multiplayer canvas component (likely `app/play/[code]/client.tsx` or `app/play/components/...` — grep for `Stage` + `Layer` from `react-konva`). Mirror goldfish changes:

- **Render**: replicate the per-cluster territory render from `GoldfishCanvas.tsx`. Use `computeEquipOffset` and the `derivedWeaponPositions` memo pattern. **The multiplayer canvas is mirrored for the opponent side — the opponent's territory cards need the same per-cluster order.**
- **Drag attach**: in `handleCardDragEnd` (or equivalent), insert the attach-check block that uses `hitTestWarrior` with ≥25% rect overlap threshold. Only the LOCAL PLAYER can attach (multiplayer: validate via `ownerId === myPlayerId`). Call `conn.reducers.attachCard({...})` on hit.
- **Warrior-drag carries weapons**: mirror the goldfish `followerIds` logic. Use `moveCardsBatch` (via the multiplayer batch reducer) on drag-end.
- **Detach icon overlay**: mirror the HTML overlay. Position using `virtualToScreen` (or whatever the multiplayer coord transform is — see `app/play/utils/coordinateTransforms.ts`). Only render for cards the local player owns — don't let a player detach the opponent's weapons.

### Task 6 — Multiplayer context-menu integration

The shared `CardContextMenu` already supports `onDetach`. At the multiplayer call site, thread it:

```tsx
<CardContextMenu
  card={menu.card}
  ...
  onDetach={(id) => {
    const derived = derivedWeaponPositions.get(id);
    gameActions.detachCard(id, derived?.x, derived?.y);
  }}
/>
```

Gate on ownership — don't let players see "Unequip" on opponent cards.

### Task 7 — Spectator + opponent view

Spectator mode (`app/play/[code]/spectate`) should render attached weapons correctly too. Reuse the same render pattern.

Opponent-owned attached pairs:
- Render correctly on both sides of the board (mirrored).
- Opponent's unlink icons are NOT visible to the local player.
- Hover/click on opponent cards already has restrictions — follow the same pattern for equip.

### Task 8 — Tests

Multiplayer reducers are harder to unit-test than goldfish because they run inside the SpacetimeDB runtime. Options:
1. Smoke-test via the existing `app/play/utils/__tests__` pattern (test coordinate math, etc.) — doesn't cover reducer behavior directly.
2. Write reducer-level tests in `spacetimedb/src/__tests__/` if that's already set up.
3. Manual E2E: two browser windows, both connected to the same `<code>`, one player attaches, observe the other player sees the update.

Minimum bar: at least a manual E2E checklist (attach, detach, move-to-LOB cascade, spectator-sees-attach, etc.) analogous to goldfish Task 11.

---

## Open design questions

### Q1. Should `MAX_EQUIPPED_WEAPONS_PER_WARRIOR` be enforced server-side?

Goldfish only enforces in UI. For multiplayer, a malicious client could call `attach_card` many times. Recommend enforcing in the `attach_card` reducer too:

```ts
const existing = [...ctx.db.cardInstance.card_instance_game_id.filter(gameId)]
  .filter(c => c.equippedToInstanceId === warriorInstanceId);
if (existing.length >= 1) {
  throw new SenderError('Warrior already has a weapon equipped');
}
```

### Q2. Should `attach_card` require the weapon is actually classed as "Weapon" in card data?

Goldfish only gates at the drag layer. For multiplayer, the server can't call `findCard` (Redemption card data isn't bundled into the SpacetimeDB module). Options:
- Check `CardInstance.cardType` heuristically (e.g. starts with "GE" and name contains a weapon-like keyword) — fragile.
- Trust the client's UI gate — pragmatic, and matches how the game already trusts client validation for most other moves.
- Bundle a minimal card-data table in the SpacetimeDB module. Over-engineering for this feature.

**Recommended:** trust the client UI gate. If someone cheats and attaches a non-weapon, the game state is still valid (it's just a weird attachment).

### Q3. Cursor visuals during drag

Goldfish hides the HTML overlay during drag because the overlay reads from state which doesn't live-update. Multiplayer has the same constraint — same fix works. The dragged card's Konva node updates live; the icon overlay should still hide during drag.

### Q4. Spectator visibility

Spectators see the whole board. They should see attached pairs correctly rendered, but have NO interactive controls (no attach, no detach).

---

## Estimate

6–10 tasks of medium size. Order them: schema (Task 1) → reducers (Task 2) → publish (Task 3) → adapter (Task 4) → canvas (Task 5 — biggest task, ~2000-line file) → menu (Task 6) → spectator (Task 7) → tests (Task 8).

About 2/3 the size of the goldfish port because the state-shape + UX decisions are already made. The remaining work is all wiring.

---

## Files to read before starting

In priority order:

1. [`spacetimedb/CLAUDE.md`](../../../spacetimedb/CLAUDE.md) — **mandatory** — SDK gotchas, hallucinated APIs warnings.
2. [`spacetimedb/src/schema.ts`](../../../spacetimedb/src/schema.ts) — current schema.
3. [`spacetimedb/src/index.ts`](../../../spacetimedb/src/index.ts) — existing reducers to mirror (especially `move_card` and any `move_cards_batch`).
4. [`app/goldfish/state/gameReducer.ts`](../../../app/goldfish/state/gameReducer.ts) — the ATTACH_CARD, DETACH_CARD, MOVE_CARD cascade, MOVE_CARDS_BATCH split reference implementations.
5. [`app/goldfish/components/GoldfishCanvas.tsx`](../../../app/goldfish/components/GoldfishCanvas.tsx) — drag handlers, render passes, overlay (search for `equippedTo`, `hitTestWarrior`, `derivedWeaponPositions`).
6. [`docs/superpowers/plans/2026-04-17-goldfish-equip.md`](../plans/2026-04-17-goldfish-equip.md) — the goldfish implementation plan, for reference on task decomposition style.

Card-data helpers (already shared, nothing to change):
- [`lib/cards/lookup.ts`](../../../lib/cards/lookup.ts) — `findCard`, `isWeapon`, `isWarrior`.
