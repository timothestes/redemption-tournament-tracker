# Pre-Game Star Phase + Lost Soul Activation — Design

**Date:** 2026-08-13
**Status:** Design (approved for planning)
**Scope:** Online play (`/play/[code]`), SpacetimeDB module, spectator view

---

## 1. Summary

Online play currently jumps from the "who goes first" reveal straight into turn 1's Draw
Phase. The REG Pre-Game Phase has two steps in between that the app has never modelled:

> **2.** After selecting a player to take the first turn, BEFORE the Lost Souls abilities
> activate, starting with the selected player and continuing clockwise until each player has
> had an opportunity, players may reveal any number of star cards from their hand to use the
> star ability.
>
> **3.** After each player has used any star abilities they want to activate, starting with
> the selected player and continuing clockwise until each player activates the Lost Souls they
> control, players activate the abilities on the Lost Souls they control.

This design adds both as explicit, server-authoritative sub-phases, and relabels the header
so the pre-game is never mistaken for the Upkeep Phase.

REG step 1 ("each player draws 8 and replaces any Lost Souls") is **already implemented** —
`drawCardsForPlayer` auto-routes drawn Lost Souls to the Land of Bondage at join time. Step 4
("the selected player begins the first turn") is the existing `status: 'playing'` transition,
which simply moves later.

---

## 2. Goals / Non-goals

**Goals**

- Model REG steps 2 and 3 as real, ordered, server-authoritative game state.
- Let a player choose *all* the stars they want to reveal, then resolve them *in the order
  chosen* — the user's explicit requirement.
- Never block the board. Star abilities manipulate decks, hands, and the Land of Bondage; the
  player must retain full normal interaction (drag, right-click, deck search, modals) while
  the pre-game UI is on screen.
- Surface the existing right-click ability shortcuts during the star phase, unchanged.
- Make the header read `PRE-GAME PHASE`, not a normal turn phase.
- Untimed, with a long idle backstop so a disconnected or idle player cannot hang the game.

**Non-goals**

- **No changes to `lib/cards/cardAbilities.ts` or `spacetimedb/src/cardAbilities.ts`.** The
  star phase offers exactly the abilities that are already hand-legal today. Cards whose star
  ability is unregistered (or registered only for its in-play half) resolve as manual,
  text-only entries. This keeps the feature's diff free of any change to what a card *does*.
  (Two apparent misregistrations were noticed during design — `The Coming Prince` and
  `The Thankful Leper (GoC)` print "a deck" but are registered `look_at_own_deck`, against the
  registry's own documented convention at `lib/cards/cardAbilities.ts:157`. They are **out of
  scope** and deliberately untouched.)
- No automation of star ability *effects* beyond what the registry already automates.
- No enforcement that a revealed star's ability was actually used — REG says "may".
- No changes to the roll / choose-first / reveal ceremony, which stays exactly as it is.
- No production SpacetimeDB publish (see §12).

---

## 3. State machine

`Game.pregamePhase` gains two values. This is a **value** change to an existing
`t.string()` column, not a shape change, so the game row's BSATN layout is untouched.

```
Before:  rolling → choosing → revealing → [status='playing', currentPhase='draw']
After:   rolling → choosing → revealing → stars → souls → [status='playing', currentPhase='draw']
```

`status` stays `'pregame'` throughout `stars` and `souls`.

The existing `revealing` step — its ~1.5s client auto-ack and its 8s `RevealTimeout` server
backstop — is unchanged. What changes is its *destination*: `startGameFromReveal` no longer
starts the game; it enters the star phase.

Within `stars` and `souls`, turn order is REG order: the selected first player
(`game.currentTurn`) acts, then the other seat.

**Auto-skip is server-side and cascading.** On entering `stars`, if neither player holds a
star card in hand, the server advances immediately; if it then finds neither player controls
an ability-bearing Lost Soul, it advances again and starts the game. A game with no stars and
no soul text therefore behaves exactly as it does today, with no extra clicks.

---

## 4. Schema changes

Two new tables. **Not new `Game` columns** — per the `ForgeGame` precedent at
`spacetimedb/src/schema.ts:455-459`, adding a column changes the game row's BSATN shape and
breaks deployed clients' game subscriptions during the publish window. That risk is sharper
here because `.github/workflows/deploy-spacetimedb.yml` publishes on push to *any* branch.

```ts
// ---------------------------------------------------------------------------
// 17. PregameState — one row per game, live only during the 'stars'/'souls'
//     sub-phases. Row absent = not in a star/soul step. Deliberately a
//     separate table rather than Game columns (see ForgeGame above).
// ---------------------------------------------------------------------------
export const PregameState = table(
  { name: 'pregame_state', public: true },
  {
    gameId: t.u64().primaryKey(),
    step: t.string(),        // 'stars' | 'souls'
    activeSeat: t.u64(),     // 0 | 1 — seat whose window is open
    starsDone0: t.bool(),
    starsDone1: t.bool(),
    soulsDone0: t.bool(),
    soulsDone1: t.bool(),
  }
);

// ---------------------------------------------------------------------------
// 18. PregameStar — one row per star card a player revealed, in the order
//     they chose. Public: the reveal is a cost, opponents and spectators see it.
// ---------------------------------------------------------------------------
export const PregameStar = table(
  {
    name: 'pregame_star',
    public: true,
    indexes: [{ accessor: 'pregame_star_game_id', algorithm: 'btree' as const, columns: ['gameId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    seat: t.u64(),
    cardInstanceId: t.u64(),
    slot: t.u64(),           // 0-based resolution order. NOT named `order` — SQL keyword.
    resolved: t.bool(),
  }
);

// ---------------------------------------------------------------------------
// 19. PregameIdleTimeout (scheduled) — untimed phase, long backstop.
// ---------------------------------------------------------------------------
let _handlePregameIdleTimeout: any;
export const setPregameIdleTimeoutReducer = (reducer: any) => {
  _handlePregameIdleTimeout = reducer;
};

export const PregameIdleTimeout = table(
  {
    name: 'pregame_idle_timeout',
    public: true,
    scheduled: () => _handlePregameIdleTimeout,
    indexes: [{ accessor: 'pregame_idle_timeout_game_id', algorithm: 'btree' as const, columns: ['gameId'] }],
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    gameId: t.u64(),
  }
);
```

All three are added to the `schema({...})` export.

Deliberately **derived, not stored**: the resolution cursor (lowest unresolved `slot` for
`activeSeat`) and the selecting-vs-resolving stage (any `PregameStar` rows for `activeSeat`
⇒ resolving). Storing them would create a second source of truth that can drift.

---

## 5. Star detection

All 244 star cards in the card pool lead their special ability with `(Star)` or `STAR:`.
Detection is a single anchored regex — zero false positives across the pool:

```ts
// lib/cards/starCards.ts
export const STAR_ABILITY_RE = /^\s*(\(star\)|star:)/i;
export function isStarAbilityText(specialAbility: string): boolean {
  return STAR_ABILITY_RE.test(specialAbility ?? '');
}
```

**Detection must read `CardInstance.specialAbility` — the row's own text — never
`findCard(cardName)`.** Forge cards are absent from the public card index, so any
`findCard()`-based gate silently reads false for them (see
`reference_forge_findcard_gates_fail`). The row already carries the text; use it.

The server needs the same predicate to validate submissions. Rather than a fourth dual-copy
registry file, the same regex is inlined in `spacetimedb/src/index.ts` with a `keep in sync`
comment. A unit test in `lib/cards/__tests__/starCards.test.ts` pins the behaviour against the
generated `CARDS` data (asserting the matched count and that every match's text starts with a
star marker), so a card-data regen that changes the convention fails loudly.

---

## 6. Reducers

All new reducers validate `game.status === 'pregame'`, the expected `pregamePhase`, that a
`PregameState` row exists, and that `findPlayerBySender(ctx, gameId).seat === state.activeSeat`.
Every one of them re-arms the idle backstop on success.

### `pregame_submit_stars({ gameId: t.u64(), cardInstanceIds: t.string() })`

`cardInstanceIds` is a JSON array of stringified u64s, matching the existing
`Player.revealedCards` convention. (`t.array` is used nowhere in this module's reducer
params; the JSON-string convention is the established pattern here.)

- Requires `pregamePhase === 'stars'` and that the sender has no `PregameStar` rows yet
  (submission is once per player; a re-submit throws rather than silently replacing).
- For each id: must be a `CardInstance` in this game, `zone === 'hand'`, owned by the sender,
  and `isStarAbilityText(specialAbility)`. Duplicates rejected.
- Inserts one `PregameStar` per id with `slot = index`, `resolved: false`.
- Reveals **all** submitted cards at once via the existing per-card hand-reveal mechanism
  (`revealExpiresAt`, 30s) — REG's "reveal any number of star cards from your hand" is a
  single simultaneous reveal, and it lets the opponent see the whole set before responding.
- Logs `PREGAME_STARS_REVEALED` with the card names and seat.
- **Empty array** = "No stars": marks `starsDone{seat}`, logs `PREGAME_STARS_NONE`, advances.

### `pregame_resolve_star({ gameId: t.u64(), starId: t.u64() })`

- The row must belong to the sender's seat, be unresolved, and be the **lowest** unresolved
  `slot` for that seat — resolution order is enforced server-side, not just presented in the UI.
- Sets `resolved: true`, logs `PREGAME_STAR_RESOLVED`.
- If no unresolved rows remain for the seat: marks `starsDone{seat}` and advances.

### `pregame_finish_souls({ gameId: t.u64() })`

- Requires `pregamePhase === 'souls'`. Marks `soulsDone{seat}`, logs `PREGAME_SOULS_DONE`,
  advances. This is the single acknowledgement per the agreed design.

### `handle_pregame_idle_timeout({ arg: PregameIdleTimeout.rowType })`

- If the game has moved on, no-op. Otherwise force-completes the **active seat's current
  sub-step** (marks its done flag; leaves any unresolved stars unresolved), logs
  `PREGAME_IDLE_SKIP`, and advances. Backstop interval: **180s**, re-armed on every
  successful pregame reducer.

### Internal: `advancePregame(ctx, gameId)`

The single place the sub-phase cursor moves. Deliberately one function so the click path,
the auto-skip path, and the idle path cannot diverge — the same lesson as
`startGameFromReveal`.

```
first = game.currentTurn; other = 1n - first

if step === 'stars':
    for seat in [first, other]:
        if starsDone[seat]: continue
        if seat holds ≥1 star card in hand: activeSeat = seat; persist; return
        starsDone[seat] = true                // auto-skip: nothing to reveal
    step = 'souls'                            // both done — fall through
if step === 'souls':
    for seat in [first, other]:
        if soulsDone[seat]: continue
        if seat controls ≥1 ability-bearing Lost Soul: activeSeat = seat; persist; return
        soulsDone[seat] = true                // auto-skip: nothing to activate
    startGameFromPregame(ctx, game)           // both done
```

### Modified: `startGameFromReveal` → enters the star phase

Its current body (set `status: 'playing'`, `currentPhase: 'draw'`, `turnNumber: 1n`,
`playingStartedAtMicros`, log `GAME_STARTED`) moves verbatim into a new
`startGameFromPregame(ctx, game)`. `startGameFromReveal` instead:

- inserts `PregameState { step: 'stars', activeSeat: game.currentTurn, ...false }`
- sets `game.pregamePhase = 'stars'` (status stays `'pregame'`)
- arms `PregameIdleTimeout`
- logs `PREGAME_STAR_PHASE`
- calls `advancePregame` — which cascades through both auto-skips and may start the game
  outright when there is nothing to do.

`startGameFromPregame` additionally deletes the `PregameState` row, all `PregameStar` rows for
the game, and any pending `PregameIdleTimeout` for the game.

**Timer consequence, intended:** `playingStartedAtMicros` now stamps at the *end* of the
pre-game phase, so pre-game deliberation no longer counts against the round clock. This is the
correct behaviour and should be called out in the PR.

---

## 7. Star resolution and right-click parity

The right-click menu already does the right thing. `app/shared/components/CardContextMenu.tsx`
builds its ability entries from `getEffectiveAbilities(card)` and gates each on
`ability.sourceZones ?? DEFAULT_ABILITY_SOURCE_ZONES` including `card.zone`. Star abilities
that are registered carry `'hand'` in `sourceZones`, so **right-clicking a star card in hand
during the star phase already offers its shortcut, with no change required.** The user's
"make sure those are available too" is satisfied by not blocking the canvas — which is the
central UI constraint below.

`MultiplayerCanvas.executeCardAbility` (line 1836) likewise already handles the hand case: it
reveals the source card for 30s when an ability is fired from hand, and intercepts the
`look_at_*` / `reveal_*` / `*_opponent_*` types client-side. No change.

The rail mirrors the same menu inline for convenience, built from the identical source so the
two can't diverge:

```ts
const handAbilities = getEffectiveAbilities({
  cardName: resolveForgeCardName(card, forgeResolver),
  imitatingName: card.imitatingName,
}).filter(a => (a.sourceZones ?? DEFAULT_ABILITY_SOURCE_ZONES).includes('hand'));
```

labelled with `abilityLabel(a)` and dispatched through the existing
`gameState.executeCardAbility(instanceId, abilityIndex)`. **`abilityIndex` must be the index
into the unfiltered `getEffectiveAbilities` array**, not into the filtered one — the server
and client dispatchers both index the full list. The filter selects which buttons to show; it
must not renumber them.

A star card with no hand-legal registered ability shows its star text and nothing but
`Resolved →`. That is the majority case (207 of 244 star cards have no registry entry at all)
and it is correct — the player performs the effect manually, exactly as they do today.

---

## 8. Lost Soul activation step

A player's soul sub-step is offered only when they control at least one activatable soul:
a `CardInstance` with `zone === 'land-of-bondage'`, `ownerId` = that player's id, and a
non-empty `specialAbility`. 159 of 263 Lost Souls have ability text.

Paragon's 21 shared souls are inserted with `specialAbility: ''` and `ownerId: 0n`
(`spacetimedb/src/index.ts:534`), so **Paragon games skip the soul step automatically** —
no special-casing needed, the eligibility predicate already excludes them.

Activation itself needs no new mechanism: `'land-of-bondage'` is already in
`DEFAULT_ABILITY_SOURCE_ZONES`, so right-clicking a soul in the LoB already offers its
abilities. The step is a bounded window plus a single `Done` acknowledgement, exactly as
agreed. The rail lists the player's activatable souls as chips (clicking one pulses the
corresponding card on the canvas) so nothing is overlooked.

---

## 9. Client rendering

### 9.1 Header — `TurnIndicator`

New optional prop `pregameStep?: 'stars' | 'souls'`. When set, the centre column of the
existing `1fr auto 1fr` grid renders the pre-game treatment instead of the five-phase row:

- A `PRE-GAME PHASE` label in Cinzel gold (`#e8d5a3` on the existing `#c4955a` accent), so it
  reads as categorically different from `DRAW / UPKEEP / PREPARATION / BATTLE / DISCARD`.
- Two chips beneath it — `STARS` and `LOST SOULS` — reusing the existing sliding pill +
  underline animation, keyed on `pregameStep` instead of `currentPhase`.
- The next-phase arrow and `END TURN` are hidden while `pregameStep` is set. They are already
  inert (`isMyTurn={false}`), but hiding them removes the false affordance.

`PHASE_ORDER` / `PHASE_LABELS` are untouched — the pre-game chips are a separate, local list.

### 9.2 The rail — `PregameRail` (new component)

Mounted **from `MultiplayerCanvas`**, following the `BattleResolutionUI` precedent
(`MultiplayerCanvas.tsx:8418`): it needs `mpLayout` band geometry plus `scale`/`offsetX`/
`offsetY`, which only exist in that component.

- Anchored to the territory divider (`multiplayerLayout.ts`, `dividerRatio: 0.005`) via
  `virtualToScreen`. Both territories are empty during the pre-game, so the rail covers no
  live cards and no layout reflow is needed.
- **Non-blocking is the hard requirement.** The wrapper is `pointer-events: none`; only the
  chips and buttons set `pointer-events: auto`. Drag, right-click, deck search, and every
  modal keep working underneath — star abilities need exactly that.
- Horizontally scrollable when a player selects many stars.

States:

| Phase | Active player sees | Other player / spectator sees |
|---|---|---|
| `stars`, selecting | Chips for each star card in hand; click to toggle and set order (1, 2, 3…). `Reveal N stars` / `No stars`. Matching hand cards get a gold glow. | `Waiting for {name} to reveal stars…` |
| `stars`, resolving | Current star named + its star text + hand-legal ability buttons + `Resolved →`. Remaining queue shown greyed with their slot numbers. | The revealed cards (already revealed to them) and whose window is open. |
| `souls` | Chips for each activatable soul; click pulses it on canvas. `Done`. | `Waiting for {name} to activate Lost Souls…` |

Every transition is an **explicit click**. No client-side auto-ack timers anywhere in this
feature — the existing reveal auto-ack has stalled twice
(`PregameScreen.tsx:958-972`, `RevealTimeout`), and its stale-closure failure mode is exactly
what this design avoids by construction.

### 9.3 Board visibility — `app/play/[code]/client.tsx`

The board is already live behind the ceremony overlay. Two gates need the new phases:

- `isCeremonyPhase` (line 1185) — unchanged; `stars`/`souls` are *not* ceremony phases and
  must not mount `PregameCeremonyOverlay`.
- `isAwaitingGameStart` (line 1195) — renamed `isPregameBoardPhase` and extended to include
  `pregamePhase === 'stars' || pregamePhase === 'souls'`. Without this the client falls
  through to the lobby/`PregameScreen` branch at line 1206 and the board disappears.

Both render branches pass the new `pregameStep` to `TurnIndicator`.

### 9.4 Spectator — `app/play/spectate/[code]/client.tsx:510`

The gate `status === 'pregame' && pregamePhase !== 'rolling' && !== 'choosing' && !== 'revealing'`
currently treats any other pregame phase as "not started". It must also exclude `stars` and
`souls` so spectators watch the pre-game instead of seeing a waiting screen.

### 9.5 Data wiring — `app/play/hooks/useGameState.ts`

- Two `useTable` calls scoped the established way:
  `tables.pregameState.where(r => r.gameId.eq(gameId))` and the same for `pregameStar`.
- Three reducer wrappers: `pregameSubmitStars`, `pregameResolveStar`, `pregameFinishSouls`.
- Bindings regenerated per the `spacetimedb-deploy` skill (typescript, out
  `lib/spacetimedb/module_bindings`, project path `spacetimedb`).

---

## 10. Edge cases

| Case | Behaviour |
|---|---|
| Neither player holds a star | `stars` auto-skips server-side; cascades into the soul check. |
| Neither player controls an ability-bearing soul | `souls` auto-skips; game starts. Always true in Paragon. |
| Player disconnects mid-star-phase | 180s `PregameIdleTimeout` force-completes their sub-step and advances. |
| Player submits, then wants to change | Not allowed. Re-submit throws. Selection is a reveal; REG has no take-backs. |
| Star card leaves hand mid-resolution (its own ability underdecks it) | `PregameStar` holds `cardInstanceId`; the row survives the zone change. The rail reads the live card row for its name/text and still offers `Resolved →`. |
| Concede / abandon during pre-game | Games are never deleted — the concede paths only set `status: 'finished'` — so `startGameFromPregame` never runs and its cleanup never fires. The rows must be reaped explicitly: `cleanup_stale_games` already deletes a stale game's `CardInstance` rows (`spacetimedb/src/index.ts:2088`) and gains the same deletion for `pregame_state`, `pregame_star`, and any pending `pregame_idle_timeout`. The idle-timeout handler must also no-op when `game.status !== 'pregame'`. |
| Forge game | Star detection reads `specialAbility` off the row, so Forge cards with star text participate. Forge cards have no mechanized abilities (`reference_forge_no_mechanized_abilities`), so they resolve as text-only — correct. |
| Rematch | Rematch creates a new game that runs the full pregame afresh. No extra work. |

---

## 11. Testing

**Unit**

- `lib/cards/__tests__/starCards.test.ts` — regex matches exactly the expected star-card set
  in `CARDS`; every match starts with `(Star)`/`STAR:`; no non-star card matches.
- `advancePregame` transition table: both-skip, one-skip, neither-skip, per step.
- Ability-index parity: the rail's filtered button list dispatches the *unfiltered* index.

**Server**

- `pregame_submit_stars` rejects: non-hand cards, cards owned by the other player, non-star
  cards, duplicates, wrong seat, re-submission.
- `pregame_resolve_star` rejects out-of-order resolution.

**E2E** (`e2e/`, dev module) — a two-client game where seat 0 reveals two stars, resolves them
in order, seat 1 declines, both skip souls, and the game reaches `currentPhase: 'draw'` with
`turnNumber: 1`. Assert the board is interactive (a real click-drag succeeds) while the rail
is on screen — the non-blocking requirement is the one most likely to regress, and
`reference_portaled_dialog_wrapper_intercepts` is the precedent for why a real click, not a
dispatched event, is required.

**Manual** — the dev module, two browsers, one Paragon game (expect the soul step to skip) and
one T1 game with a known star card.

---

## 12. Deployment

**Dev module only, per instruction.** `.github/workflows/deploy-spacetimedb.yml` publishes to
`redemption-multiplayer-dev` for any branch other than `main`, and to prod
`redemption-multiplayer` only on `main`. Pushing this branch therefore publishes dev
automatically and touches nothing in production.

**The PR must not be merged without a separate, explicit production decision.** Merging is
what publishes prod, and prod clients would then see two new `pregamePhase` values they do not
handle. The two new tables are additive, so the publish should not require
`--clear-database`; the CI publish succeeding on this branch is the verification of that.

---

## 13. Risks

- **The rail swallowing clicks.** The single highest-risk item, and the one the user called
  out. Mitigated by `pointer-events: none` on the wrapper and an e2e assertion that a real
  drag works while the rail is mounted.
- **Ability index off-by-one** between the filtered display list and the unfiltered dispatch
  list. Mitigated by a unit test.
- **A stalled sub-step.** Mitigated by making every step an explicit click plus a 180s
  server-side backstop — no client timer is on the critical path.
- **Prod clients on an unknown `pregamePhase`.** Contained by not merging; called out in §12.
