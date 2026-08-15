# Pre-Game Star Phase + Lost Soul Activation — Design

**Date:** 2026-08-13
**Status:** Design rev 2 (post adversarial review)
**Scope:** Online play (`/play/[code]`), SpacetimeDB module, spectator view

> **Rev 2 changed the central architectural decision.** Rev 1 kept `status: 'pregame'` through
> the new sub-phases. Adversarial review found that ~20 reducers hard-throw
> `'Game is not in playing state'`, including `move_card_to_top_of_deck` — and "Topdeck" is the
> single most common star verb (80 of 244 star cards). The board would have looked interactive
> and silently refused the actions the phase exists to perform. Rev 2 flips `status` to
> `'playing'` and gates the *turn machinery* on `pregamePhase` instead. See §3.

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
`drawCardsForPlayer` auto-routes drawn Lost Souls to the Land of Bondage at join
(`spacetimedb/src/index.ts:354-377`), *conditional on* the per-player `autoRouteLostSouls`
option (default true, `:718`/`:789`). Step 4 ("the selected player begins the first turn") is
the existing turn-1 Draw Phase transition, which simply moves later.

---

## 2. Goals / Non-goals

**Goals**

- Model REG steps 2 and 3 as real, ordered, server-authoritative game state.
- Let a player choose *all* the stars they want to reveal, then resolve them *in the order
  chosen* — the user's explicit requirement.
- **Never block the board — at the DOM layer *and* the reducer layer.** Star abilities
  manipulate decks, hands, and the Land of Bondage. The player must retain full normal
  interaction: drag, right-click, deck search, the toolbar, and every modal.
- Surface the existing right-click ability shortcuts during the star phase.
- Make the header read `PRE-GAME PHASE`, not a normal turn phase.
- Untimed, with a long idle backstop so an idle player cannot hang the game — and without the
  30-second pregame disconnect grace ending the game mid-deliberation.

**Non-goals**

- No automation of star ability *effects* beyond what the registry already automates. 207 of
  the 244 star cards have no registry entry and resolve as manual, text-only entries.
- No enforcement that a revealed star's ability was actually used — REG says "may".
- No enforcement of "Dominants cannot be played and manually triggered effects cannot be used
  during the Pre-Game Phase." The app enforces no rules anywhere; this stays a player
  responsibility. Worth knowing: `Star of Bethlehem (GoC)` is a Dominant *with* a STAR
  ability, where revealing for the star is legal and playing the Dominant is not.
- **Forge star cards are out of scope** — see §5. Forge games run the pre-game phase, but
  their forge cards are invisible to star detection and the step will auto-skip.
- No changes to the roll / choose-first / reveal ceremony, which stays exactly as it is.
- No production SpacetimeDB publish (see §12).

**Decided:** the 19 star cards whose registered star ability is currently unfireable from hand
get `'hand'` added to `sourceZones`, and the server is fixed to honour per-ability
`sourceZones` overrides. See §7.3.

---

## 3. State machine — `status` flips to `'playing'`

`Game.pregamePhase` gains two values, `'stars'` and `'souls'`. This is a **value** change to
an existing `t.string()` column, so the game row's BSATN layout is untouched.

```
Before:  rolling → choosing → revealing → [status='playing', pregamePhase='',      currentPhase='draw']
After:   rolling → choosing → revealing → [status='playing', pregamePhase='stars', currentPhase='draw']
                                        → [status='playing', pregamePhase='souls', currentPhase='draw']
                                        → [status='playing', pregamePhase='',      currentPhase='draw']
```

**`status` becomes `'playing'` when the reveal ends, not when the pre-game ends.** This single
decision resolves three independent blockers at once:

1. All ~20 `status === 'playing'`-gated reducers work with **no edits to any of them** —
   `move_card_to_top_of_deck` (`index.ts:6923`), `move_card_to_bottom_of_deck` (`:6999`),
   `request_opponent_action` (`:7650`, the consent path behind every `look_at_opponent_deck` /
   `reveal_opponent_deck` / `discard_opponent_deck` / `three_nails_reset`), `log_look_at_top`
   (`:7504`), `log_search_deck` (`:7484`), `request_zone_search` (`:7533`), `exchange_from_deck`
   (`:6782`), and the rest. The alternative — threading an `assertInteractive(game)` helper
   through twenty call sites — is a far larger and riskier diff.
2. The disconnect grace becomes 5 minutes instead of 30 seconds. `onDisconnect` sizes the
   timeout off `status === 'playing'` (`index.ts:8078-8080`), and `handle_disconnect_timeout`
   hard-finishes any non-playing game (`:1926-1938`). Under rev 1, a 31-second WiFi blip during
   an untimed deliberation phase would have **ended the game outright**.
3. Clients running older bindings degrade gracefully. They see a normal `playing` board rather
   than falling through to the lobby branch and losing the board entirely.

What must now be gated on `pregamePhase !== ''` instead of on `status`:

- `end_turn` and `set_phase` — rejected while `pregamePhase` is `'stars'` or `'souls'`.
- The turn timer: `playingStartedAtMicros` stays `0n` until the pre-game completes, so
  pre-game deliberation does not count against the round clock. `useGameTimer` already treats
  `0n` as "not started".
- `GAME_STARTED` logging and the turn-1 announcement stay at the *end* of the pre-game.

`currentTurn` is already the selected first player at this point (`index.ts:1040`, `:1184`),
and `currentPhase` is already `'draw'` (`:669`), so neither needs to change.

Within `stars` and `souls`, turn order is REG order: the selected first player
(`game.currentTurn`) acts, then the other seat.

**Auto-skip is server-side and cascading.** On entering `stars`, if neither player holds a
star card in hand, the server advances immediately; if it then finds neither controls an
ability-bearing Lost Soul, it advances again and completes the pre-game. A game with neither
therefore behaves exactly as it does today, with no extra clicks.

---

## 4. Schema changes

Two state tables plus one scheduled table. **Not new `Game` columns** — per the `ForgeGame`
precedent (`spacetimedb/src/schema.ts:454-464`), adding a column changes the game row's BSATN
shape and breaks deployed clients' game subscriptions during the publish window. That risk is
sharper here because `.github/workflows/deploy-spacetimedb.yml` publishes on push to *any*
branch touching `spacetimedb/**`.

```ts
// ---------------------------------------------------------------------------
// 17. PregameState — one row per game, live only during the 'stars'/'souls'
//     sub-phases. Row absent = pre-game complete. Deliberately a separate
//     table rather than Game columns (see ForgeGame above).
//
//     NOTE: the current step is NOT stored here — Game.pregamePhase is the
//     single source of truth for it. This table holds only the per-seat
//     progress flags and whose window is open.
// ---------------------------------------------------------------------------
export const PregameState = table(
  { name: 'pregame_state', public: true },
  {
    gameId: t.u64().primaryKey(),
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
    slot: t.u64(),           // 0-based resolution order
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

All three go in the `schema({...})` export. `index.ts` must import
`PregameIdleTimeout, setPregameIdleTimeoutReducer` and call
`setPregameIdleTimeoutReducer(handle_pregame_idle_timeout)` after the reducer's definition —
mirroring `setRevealTimeoutReducer` (`index.ts:2019`). Without that call the scheduled binding
resolves to `undefined` and the backstop silently never fires.

Deliberately **derived, not stored**: the current step (`Game.pregamePhase`), the resolution
cursor (lowest unresolved `slot` for `activeSeat`), and the selecting-vs-resolving stage
(during `'stars'` only: any `PregameStar` rows for `activeSeat` ⇒ resolving).

---

## 5. Star detection

All 244 star cards lead their special ability with `(Star)` or `STAR:`. Verified independently
against `lib/cards/generated/cardData.json`: the regex matches exactly 244 rows; the word
"star" never appears in an ability outside that anchor (the only other hits are `start`,
`starts`, `Aristarchus`), so **zero false positives and zero false negatives**. No matched
ability has leading whitespace, quotes, or markup.

```ts
// lib/cards/starCards.ts
export const STAR_ABILITY_RE = /^\s*(\(star\)|star:)/i;
export function isStarAbilityText(specialAbility: string): boolean {
  return STAR_ABILITY_RE.test(specialAbility ?? '');
}
```

Detection reads `CardInstance.specialAbility` — the row's own text — never
`findCard(cardName)`, which reads false for Forge cards.

### Forge cards are out of scope, and cannot be brought in

The Forge leak spine blanks `specialAbility` on the way *into* the STDB row
(`app/forge/lib/playSerialize.ts:31-35`; confirmed at `index.ts:2252` and
`app/play/utils/forgeResolver.ts:49-53`, "Deliberately NOT specialAbility"). The real text
reaches only the granted client, via `mergeForgeDeckData`. So:

- Server-side detection sees `''` for every Forge card → a Forge deck's star cards never
  trigger the star step, which auto-skips.
- Server-side *validation* would reject them even if the client offered them.

There is no server-side fix that preserves the leak spine. Forge playtest games therefore run
the pre-game phase with the star step auto-skipped. This is a real limitation, stated plainly
rather than papered over, and a candidate follow-up (a client-asserted "this is a star"
flag, trusted because Forge games are already a closed playtest group).

A unit test in `lib/cards/__tests__/starCards.test.ts` pins the regex against the generated
`CARDS` data so a card-data regen that changes the convention fails loudly.

---

## 6. Reducers

All new reducers validate `game.status === 'playing'`, the expected `game.pregamePhase`, that
a `PregameState` row exists, and that `findPlayerBySender(ctx, gameId).seat === state.activeSeat`.
Every one re-arms the idle backstop on success via a delete-then-insert helper.

### `pregame_submit_stars({ gameId: t.u64(), cardInstanceIds: t.string() })`

`cardInstanceIds` is a JSON array of stringified u64s, matching the existing
`Player.revealedCards` convention. (`t.array` is used nowhere in this module's reducer params.)
Parsing must be **guarded** — raise `SenderError`, not a raw `SyntaxError` — and length-bounded
before the per-id lookup loop, following `assertValidDeckData` (`index.ts:89-97`) rather than
the unguarded `JSON.parse` at `:3347`/`:5495`.

- Requires `pregamePhase === 'stars'` and that the sender has no `PregameStar` rows yet
  (submission is once per player; a re-submit throws rather than silently replacing).
- For each id: must be a `CardInstance` in this game, `zone === 'hand'`, owned by the sender,
  and `isStarAbilityText(specialAbility)`. Duplicates rejected.
- Inserts one `PregameStar` per id with `slot = index`, `resolved: false`.
- Reveals all submitted cards at once (see §6.1 for the reveal duration).
- Logs `PREGAME_STARS_REVEALED` with the card names and seat.
- **Empty array** = "No stars": marks `starsDone{seat}`, logs `PREGAME_STARS_NONE`, advances.

### 6.1 The reveal must outlast the resolution window

`reveal_card_in_hand` hard-codes a 30-second expiry (`index.ts:6499-6508`), but this phase is
untimed and a player resolving three stars will routinely exceed it — the opponent's view of
the revealed set would vanish mid-resolution, and that reveal is REG's *cost*.

**The opponent's and spectators' view of revealed stars renders from the public `PregameStar`
rows, not from `revealExpiresAt`.** The rows live for the whole phase and are deleted when the
pre-game completes. `revealExpiresAt` is still set on submit so the cards also light up in the
normal hand-reveal treatment, but nothing depends on it not expiring.

### `pregame_resolve_star({ gameId: t.u64(), starId: t.u64() })`

- The row must belong to the sender's seat, be unresolved, and be the **lowest** unresolved
  `slot` for that seat — resolution order is enforced server-side, not merely presented.
- Sets `resolved: true`, logs `PREGAME_STAR_RESOLVED`.
- If no unresolved rows remain for the seat: marks `starsDone{seat}` and advances.

### `pregame_finish_souls({ gameId: t.u64() })`

- Requires `pregamePhase === 'souls'`. Marks `soulsDone{seat}`, logs `PREGAME_SOULS_DONE`,
  advances. The single acknowledgement, as agreed.

### `handle_pregame_idle_timeout({ arg: PregameIdleTimeout.rowType })`

- No-ops when the game is gone, `status !== 'playing'`, or `pregamePhase` is `''`.
- Otherwise force-completes the **active seat's current sub-step**, logs `PREGAME_IDLE_SKIP`,
  and advances. Interval **180s**.
- Armed only through `schedulePregameIdleTimeout(ctx, gameId)`, which **deletes any existing
  rows for the game before inserting**, exactly mirroring `scheduleRevealTimeout`
  (`index.ts:1062-1072`). Insert-only re-arming would accumulate rows and fire a stale one
  180s after a player's *first* click, skipping a seat that acted seconds earlier — the row
  carries only `gameId`, so a stale row is indistinguishable from a live one at fire time.

### Internal: `advancePregame(ctx, gameId)`

The single place the cursor moves — one function so the click path, the auto-skip path, and
the idle path cannot diverge. **It writes `Game.pregamePhase` in lock-step with the progress
flags, in the same transaction.** Rev 1 omitted this, which made the soul step unreachable.

```
game  = ctx.db.Game.id.find(gameId)          // always re-read; never trust a caller snapshot
first = game.currentTurn; other = 1n - first

if game.pregamePhase === 'stars':
    for seat in [first, other]:
        if starsDone[seat]: continue
        if seat holds ≥1 star card in hand:
            activeSeat = seat; persist state; return
        starsDone[seat] = true                       // auto-skip: nothing to reveal
    persist state; set game.pregamePhase = 'souls'   // both done — fall through
if game.pregamePhase === 'souls':
    for seat in [first, other]:
        if soulsDone[seat]: continue
        if seat controls ≥1 ability-bearing Lost Soul:
            activeSeat = seat; persist state; return
        soulsDone[seat] = true                       // auto-skip: nothing to activate
    finishPregame(ctx, gameId)                       // both done
```

### Modified: `startGameFromReveal` → `startGameFromReveal` + `finishPregame`

`startGameFromReveal` keeps its existing body — including `status: 'playing'`,
`currentPhase: 'draw'`, `turnNumber: 1n` — with three changes:

- sets `pregamePhase: 'stars'` instead of `''`
- leaves `playingStartedAtMicros` at `0n` (the clock starts when the pre-game ends)
- defers the `GAME_STARTED` log to `finishPregame`
- inserts `PregameState { activeSeat: game.currentTurn, ...false }`, arms the idle backstop,
  logs `PREGAME_STAR_PHASE`, then calls `advancePregame` — which cascades through both
  auto-skips and may complete the pre-game outright.

`finishPregame(ctx, gameId)` **takes a gameId and re-reads the row** (`checkAndApplyWin` at
`index.ts:2672-2676` documents exactly this rule; a caller snapshot would revert the
`pregamePhase` writes `advancePregame` just made). It sets `pregamePhase: ''` and
`playingStartedAtMicros`, logs `GAME_STARTED`, and deletes the `PregameState` row, all
`PregameStar` rows for the game, and any pending `PregameIdleTimeout`.

### Cleanup on the paths that end a pregame game

Games are never deleted — the concede paths only set `status: 'finished'` — so `finishPregame`
never runs for an abandoned game. All three tables are `public: true`, so orphan rows sit in
every client's table cache. Deletion is added to `resign_game` (`index.ts:1838-1860`),
`handle_disconnect_timeout` (`:1926-1938`), and `cleanup_stale_games` (alongside the existing
`CardInstance` deletion at `:2088` — note that path only reaps `finished` games older than 24h,
so it is the backstop, not the primary).

---

## 7. Star resolution and the right-click menu

### 7.1 The existing menu already indexes correctly — copy it verbatim

`CardContextMenu.tsx:267-345` does **not** filter. It maps the full
`getEffectiveAbilities(card)` array and *disables* out-of-zone entries:

```tsx
{abilities.map((ability, index) => {
  const allowedZones = ability.sourceZones ?? DEFAULT_ABILITY_SOURCE_ZONES;
  const isInAbilityZone = allowedZones.includes(card.zone);
  const disabled = !isInAbilityZone || opponentRevealMissing;
  ... actions.executeCardAbility?.(card.instanceId, index);
```

That is why its `index` is correct: both the client dispatcher
(`MultiplayerCanvas.tsx:1836`) and the server's `execute_card_ability` index the **unfiltered**
list. **The rail must map-and-disable, never filter-and-map.** Rev 1's snippet used
`.filter(...)`, which discards the index and would dispatch the wrong ability — the exact
off-by-one its own prose warned about.

### 7.2 The 30s hand reveal on ability fire

`MultiplayerCanvas.executeCardAbility` already reveals a source card for 30s when an ability
is fired from hand, and already intercepts the `look_at_*` / `reveal_*` / `*_opponent_*` types
client-side. No change — and with `status: 'playing'` (§3), the consent path those
interceptions route into (`request_opponent_action`) now works.

### 7.3 The `'hand'` gap — 19 of 37 registered star cards

`DEFAULT_ABILITY_SOURCE_ZONES` is `['territory', 'land-of-bondage', 'land-of-redemption',
'battle']` (`lib/cards/cardAbilities.ts:17-19`) — **no `'hand'`**. Only 23 registry entries
carry an explicit `sourceZones` override, all of which include `'hand'`.

Of the 37 star cards with a registry entry, **19 have no override**, so their registered
ability is not fireable from hand and the context menu renders it **greyed out** — including
the deck-manipulation abilities this feature exists to surface:

```
Sign of Jonah        look_at_own_deck top 3     cardAbilities.ts:178
The Three Visitors   look_at_own_deck top 9     cardAbilities.ts:195
Redeeming Branch     look_at_own_deck top 6     cardAbilities.ts:312
Manna (PoC)          discard_opponent_deck      cardAbilities.ts:392
Out of Egypt         discard_opponent_deck      cardAbilities.ts:394
... plus 14 more
```

The server enforces the same restriction independently: `ABILITY_SOURCE_ZONES`
(`spacetimedb/src/index.ts:37`) also lacks `'hand'`, and `execute_card_ability` (`:4722`)
throws `'Source card must be in play'`. The 23 hand-legal entries only work today because they
are all types the client intercepts and never sends to that reducer.

**Decision: add `'hand'` to `sourceZones` on those 19 entries**, in both registry copies
(`lib/cards/cardAbilities.ts` and `spacetimedb/src/cardAbilities.ts`, which the existing parity
test keeps in sync). This changes no ability *semantics* — `sourceZones` encodes **which zone
an ability can be fired from**, not what the effect does. Those are unrelated properties, and
conflating them is what made an earlier pass at this misread the cards.

Excluded from the edit: the 12 registered star cards whose entry encodes the card's **in-play**
half rather than its star half — Manna (PoC), The Outcasts, Ram (LoC), Destructive Sin (GoC),
Choked Seed (GoC), Redeeming Branch, Strong Demon (GoC), Shealtiel (LoC), Out of Egypt,
Conspiring Herodians (GoC), Foolish Builder (GoC), Balaam's Prophecy. Firing those during the
star phase would resolve the wrong ability. **Implementation must re-derive this 12-card list
from the card text and the registry entry rather than trusting it verbatim**, and report the
final split (added / excluded) in the PR.

### 7.4 The server must honour per-ability `sourceZones`

`execute_card_ability` checks a flat list and never consults the ability's own override, even
though the server registry carries the field (`spacetimedb/src/index.ts:4720-4724`):

```ts
if (!ABILITY_SOURCE_ZONES.includes(source.zone)) {
  throw new SenderError('Source card must be in play');
}
```

This is already inconsistent with the client: `Delivered` declares
`sourceZones: ['hand', ...]` (`spacetimedb/src/cardAbilities.ts:154`) and would still be
rejected from hand. It goes unnoticed only because every currently-hand-legal type is
intercepted client-side and never reaches this reducer. Adding 19 more hand-legal entries
makes it reachable.

The fix is **not** to add `'hand'` to the global `ABILITY_SOURCE_ZONES` — that would let any
ability fire from hand. It is to move the zone check *below* the ability lookup and honour the
override, mirroring `CardContextMenu`:

```ts
const allowedZones = ability.sourceZones ?? ABILITY_SOURCE_ZONES;
if (!allowedZones.includes(source.zone)) {
  throw new SenderError('Source card must be in play');
}
```

Applied to `execute_card_ability` (`:4722`) and `execute_card_ability_with_count` (`:4854`)
only. The special-purpose gates — `resurrect_heroes` (`:4903`), `imitate_lost_soul` (`:5011`),
`matthew_draw_brigades` (`:2908`) — are not star paths and stay as they are.

This is a genuine behaviour change to existing cards (it makes `Delivered` and the other 22
pre-existing hand-legal entries actually fireable from hand server-side, as their registry
entries always intended). Call it out in the PR.

---

## 8. Lost Soul activation step

A player's soul sub-step is offered only when they control at least one activatable soul: a
`CardInstance` with `zone === 'land-of-bondage'`, `ownerId` = that player's id, and a non-empty
`specialAbility`. 159 of 263 Lost Souls have ability text.

`ownerId` is the correct notion of control here: auto-routing moves the drawing player's own
row into their Land of Bondage (`index.ts:365-373`), so at pre-game time owner and controller
coincide. (They can diverge mid-game via `spawnForOpponent` tokens — out of scope.)

Paragon's 21 shared souls are inserted with `specialAbility: ''` and `ownerId: 0n`
(`index.ts:510`, `:534`), so **Paragon games skip the soul step automatically** — the
eligibility predicate excludes them with no special-casing. Paragon decks may still contain
star cards, so the *star* step does run in Paragon (see §9.2 for the layout consequence).

Activation needs no new mechanism: `'land-of-bondage'` is already in
`DEFAULT_ABILITY_SOURCE_ZONES`, so right-clicking a soul there already offers its abilities.
The step is a bounded window plus a single `Done`.

**Edge case with no UI today:** a player who has turned `autoRouteLostSouls` off holds their
drawn Lost Souls in hand, leaving the LoB empty — so `advancePregame` skips REG step 3 for
them silently. The rail shows an explanatory line in that case rather than nothing.

---

## 9. Client rendering

### 9.1 Header — `TurnIndicator`

New optional prop `pregameStep?: 'stars' | 'souls'`. When set, the centre column renders the
pre-game treatment instead of the five-phase row: a `PRE-GAME PHASE` label in Cinzel gold,
with `STARS` / `LOST SOULS` chips beneath it. The next-phase arrow and `END TURN` are hidden.

The sliding pill is hard-keyed to `currentPhase` — `buttonRefs.current[currentPhase]` inside a
`useLayoutEffect([currentPhase])` plus a resize/font `useEffect([currentPhase])`
(`TurnIndicator.tsx:243-270`), with refs registered inside `PHASE_ORDER.map` (`:638-645`).
Driving it from the pregame chips means editing both effects to key off an
`activeKey = pregameStep ?? currentPhase`. This is shared code used by the live game, so it
needs care; the current failure mode is benign (`if (!btn) return` freezes stale bounds).
`PHASE_ORDER` / `PHASE_LABELS` themselves are untouched.

The bar is a fixed 48px (`client.tsx:1443`) — tight for a label plus a chip row. If it does not
fit, the label and chips collapse to a single `PRE-GAME · STARS` line rather than growing the bar.

### 9.2 The rail — `PregameRail` (new component)

Mounted from `MultiplayerCanvas`, following the `BattleResolutionUI` precedent
(`MultiplayerCanvas.tsx:8417`): it needs `mpLayout` geometry plus `scale`/`offsetX`/`offsetY`.

**Anchoring — not the divider.** `dividerRatio: 0.005` is ~5 virtual px
(`multiplayerLayout.ts:388`) with no fill and an empty label; there is no band there to anchor
to. And "both territories are empty" is false: **28 star abilities begin "Play"**
(`Manna (PoC)`: "Play a Hero from hand"; `The Manger (GoC)`: "Play a Lost Soul from each
deck"), which put cards into the territory a divider-anchored rail would overlap. In Paragon
the divider is worse still — a zero-height placeholder sitting on the shared Land of Bondage
with the Soul Deck pile at its left end (`multiplayerLayout.ts:583-594`).

The rail therefore docks to the **bottom-left of the canvas viewport**, above the hand and
clear of both territories and the Paragon shared band, sized from `scale` so it tracks the
board. It is a floating panel, not a band overlay.

**Non-blocking, at both layers.** The wrapper is `pointer-events: none`; only chips and
buttons set `pointer-events: auto`. Konva hit-tests on its own canvas element, so a
`pointer-events: none` DOM overlay does not intercept board interaction — the mechanism is
sound and is the same one `BattleResolutionUI.tsx:197` uses. The reducer layer is handled by
§3.

**Stacking: `zIndex: 450`, not 600.** `BattleResolutionUI`'s 600 would float the rail *over*
`ZoneBrowseModal` (overlay `zIndex: 500`, `ZoneBrowseModal.tsx:437-448`) — the deck/reserve
browser a "Topdeck a Covenant from Reserve" star sends you to. 450 sits below it and above the
canvas, matching the zone-label overlay band (`MultiplayerCanvas.tsx:8340`). Everything else
is already clear: toasts 900, card-choice 950, context menu 900, zoom 900, preview 1000/1200.

States:

| Phase | Active player sees | Other player / spectator sees |
|---|---|---|
| `stars`, selecting | Chips for each star card in hand; click to toggle and set order. `Reveal N stars` / `No stars`. Matching hand cards glow. | `Waiting for {name} to reveal stars…` |
| `stars`, resolving | Current star named + its star text + its ability buttons (map-and-disable per §7.1) + `Resolved →`. Remaining queue greyed with slot numbers. | The revealed set, rendered from `PregameStar` rows (§6.1). |
| `souls` | Chips for each activatable soul; click pulses it on canvas. `Done`. | `Waiting for {name} to activate Lost Souls…` |

Every transition is an **explicit click**. No client-side auto-ack timers anywhere in this
feature — the existing reveal auto-ack has stalled twice (`PregameScreen.tsx:958-972`), and its
stale-closure failure mode is what this design avoids by construction.

### 9.3 Board rendering — `app/play/[code]/client.tsx`

Because `status` is now `'playing'` (§3), the pre-game falls through to the **existing playing
branch** (`:1826`) — which already mounts `GameToolbar`. This matters: rev 1 proposed extending
the `isAwaitingGameStart` transitional branch (`:1517-1540`), which deliberately mounts **no
toolbar** ("no overlay, no toolbar", comment at `:1513`), and would have stripped Search Deck,
Draw, Shuffle, and Undo for the entire phase.

So §9.3 reduces to: pass `pregameStep` to `TurnIndicator`, and gate `end_turn` / `set_phase`
affordances on it. `lifecycle` already resolves to `playing`; `isCeremonyPhase` and
`isAwaitingGameStart` are untouched and continue to cover only the roll/choose/reveal window.

`ImageLoadingGate` needs no change on this path — the playing branch already handles it.

### 9.4 Spectator — `app/play/spectate/[code]/client.tsx`

With `status === 'playing'`, the `:510` gate already routes spectators to the board. The
remaining fix is `:550`, which renders `SpectatorPregameCeremonyOverlay` for
`status === 'pregame'` — unchanged and now correctly scoped, since the new sub-phases are no
longer `'pregame'`. Verify no spectator path keys off `pregamePhase === ''` as "game running".

### 9.5 Data wiring — `app/play/hooks/useGameState.ts`

`useGameState` has **two** subscription blocks — the player's (`:195-236`) and the spectator's
(`:1098-1123`, whose comment reads "mirror every subscription in useGameState"). Both need the
two new `useTable` calls, or §9.4's spectator rail renders empty:

```ts
tables.PregameState.where(r => r.gameId.eq(gameId))
tables.PregameStar.where(r => r.gameId.eq(gameId))
```

PascalCase accessors, matching `tables.Game` / `tables.CardInstance` / `tables.ForgeGame` at
`:208-234`. The `.where` belongs on the hook, not only in subscription SQL
(`reference_stdb_usetable_predicate_on_hook`).

Three reducer wrappers: `pregameSubmitStars`, `pregameResolveStar`, `pregameFinishSouls`.
Bindings regenerated per the `spacetimedb-deploy` skill (typescript, out
`lib/spacetimedb/module_bindings`, project path `spacetimedb`).

---

## 10. Edge cases

| Case | Behaviour |
|---|---|
| Neither player holds a star | `stars` auto-skips server-side; cascades into the soul check. |
| Neither controls an ability-bearing soul | `souls` auto-skips; pre-game completes. Always true in Paragon. |
| `autoRouteLostSouls` off | Souls stay in hand, LoB empty, soul step skips for that player. Rail explains rather than showing an empty list. |
| Player disconnects mid-phase | 5-minute grace (`status === 'playing'`, §3) plus the 180s idle backstop, whichever fires first. Rev 1's 30s pregame grace would have ended the game. |
| Player submits, then wants to change | Not allowed. Re-submit throws. Selection is a reveal; REG has no take-backs. |
| Star card leaves hand mid-resolution (its own ability underdecks it) | `PregameStar` holds `cardInstanceId`; the row survives the zone change. The rail reads the live card row and still offers `Resolved →`. |
| Concede / abandon during pre-game | Rows reaped in `resign_game`, `handle_disconnect_timeout`, and `cleanup_stale_games` (§6). |
| Forge game | Star step auto-skips — forge cards' `specialAbility` is blanked on the STDB row (§5). Soul step works normally for non-forge souls. |
| Rematch | Creates a new game that runs the full pre-game afresh. No extra work. |
| Existing e2e | `e2e/spectatorSeed.ts:17-23` seeds five Angel cards, no stars, no Lost Souls — both steps auto-skip and `bothReachPlaying` still resolves. Correct by luck; pin it with a comment. |

---

## 11. Testing

**Unit**

- `lib/cards/__tests__/starCards.test.ts` — regex matches exactly 244 rows in `CARDS`; no
  non-star card matches; no false negatives from the `start`/`Aristarchus` family.
- `advancePregame` transition table: both-skip, one-skip, neither-skip, per step — asserting
  `Game.pregamePhase` advances in lock-step with the flags.
- Ability-index parity: the rail dispatches the **unfiltered** index (§7.1).

**Server**

- `pregame_submit_stars` rejects: non-hand cards, cards owned by the other player, non-star
  cards, duplicates, wrong seat, re-submission, malformed JSON, oversized arrays.
- `pregame_resolve_star` rejects out-of-order resolution.
- `schedulePregameIdleTimeout` leaves exactly one pending row after repeated arming.

**E2E** (`e2e/`, dev module) — a two-client game where seat 0 reveals two stars, resolves them
in order, seat 1 declines, both skip souls, and the game reaches an interactive turn 1. Assert
with a **real click-drag** (not a dispatched event — `reference_portaled_dialog_wrapper_intercepts`)
that the board is interactive while the rail is mounted, that the toolbar is present, and that
a topdeck action **succeeds** rather than throwing `'Game is not in playing state'` — the
regression that rev 1 would have shipped.

**Manual** — dev module, two browsers: one Paragon game (soul step skips, star step runs, rail
does not cover the Soul Deck), one T1 game with a known star card, one deck-search-during-star
check for the z-index fix.

---

## 12. Deployment

**Dev module only, per instruction.** `.github/workflows/deploy-spacetimedb.yml` publishes to
`redemption-multiplayer-dev` for any branch other than `main` (gated on `paths: spacetimedb/**`),
and to prod `redemption-multiplayer` only on `main`. Pushing this branch publishes dev and
touches nothing in production.

**Verification is a live client connect, not a green CI run.** New tables are additive and the
publish should not need `--clear-database` (precedent: the Forge phase-2/3 spec shipped three
new tables to prod without one). But this repo has a documented post-incremental-publish index
panic when new indexes land, and this design adds two. If dev dies on `on_connect`, the known
remediation is a `--clear` publish — which **wipes `forge_config` and breaks Forge playtest
seat auth until `set_forge_server_identity` is re-seeded**
(`reference_forge_config_wiped_on_clear_republish`). Budget for that step.

**Merging is the prod publish, and it is a breaking change requiring a paired deploy.**
`status: 'playing'` + an unknown `pregamePhase` degrades gracefully on old clients (they see a
normal board), which is strictly better than rev 1 — but the new tables and reducers still
need regenerated bindings in the browser. Follow the repo convention: prod module publish
paired with a Vercel deploy carrying the regenerated bindings, scheduled together, with open
sessions needing a refresh. **Do not merge without that plan.**

---

## 13. Risks

- **A star action still hitting a `status` gate.** §3 fixes the class, but the audit was by
  grep. The e2e must assert a real topdeck succeeds, not just that the UI renders.
- **The rail covering something that matters** — the deck-search modal (fixed by z 450), the
  Paragon Soul Deck, or a territory that a "Play a Hero" star just filled (fixed by docking
  bottom-left instead of to the divider). Worth a manual pass in both formats.
- **Ability index off-by-one** between display and dispatch. Mitigated by copying
  `CardContextMenu`'s map-and-disable pattern verbatim, plus a unit test.
- **`TurnIndicator` pill regression** — the effects being edited are shared with the live game.
  Keep the change to an `activeKey` indirection.
- **Forge games quietly having no star phase.** Documented, not fixed. Playtesters are the most
  likely early testers and should be told.
