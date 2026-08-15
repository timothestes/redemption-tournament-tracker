# Phase Stops — Opponent-Turn Priority Stops — Design Spec

**Date:** 2026-08-15
**Status:** Design rev 1 (pre adversarial review)
**Scope:** Multiplayer only (`/play`). Goldfish is untouched. Spectators see holds but can never set stops.

> Adapted from MTGO's "stops" and Arena's phase-bar stop markers: a player flags
> phases of the **opponent's turn** where the turn must pause so they get a
> guaranteed window to act before play continues. Per product decision: stops
> apply to the opponent's turn only, and every game starts with all stops OFF
> (no persistence across games).

---

## 1. Summary

Today the active player can click through Draw → Discard and end their turn as
fast as they can tap, and the non-active player has no mechanical way to say
"wait — I want to act here." The existing **Action Priority** button
(`GameToolbar.tsx:202-217`) is purely a request banner: it grants nothing and
pauses nothing.

Phase Stops adds an MTGO-style mechanism, adapted to this app's honor-system
model:

- The **non-active player** taps phases on the `TurnIndicator` bar to toggle
  **stop markers** on phases of the opponent's turn. Off by default each game;
  sticky for the rest of the game once set (toggle off any time).
- When the active player's turn **enters** a stopped phase (by clicking a
  phase, by a forward jump that crosses it, or at turn start for Draw), the
  server engages a **hold**: `set_phase` and `end_turn` throw until the
  stopping player releases the hold ("Pass") or a **60-second server backstop**
  auto-releases it.
- A hold blocks **only phase movement and End Turn**. Card actions stay
  ungated, consistent with the module's honor-system design (only 2 of the
  module's reducers are turn-gated: `set_phase` at `spacetimedb/src/index.ts:2505`
  and `end_turn` at `:2563`).
- Each stop fires **at most once per phase per turn** (re-entering a phase
  after a backward jump does not re-fire a stop that already fired this turn).

MTGO semantics kept: per-phase toggles on the opponent's turn, "no stop = the
turn flows past," stops are sticky once set, a stop set *after* the turn has
already entered that phase does not fire retroactively. MTGO semantics
deliberately dropped: own-turn stops, yield-until modes, full-control mode,
per-step granularity (Redemption has 5 phases, not MTG's ~12 steps), and stop
privacy (see §11 Risks).

---

## 2. Goals / Non-goals

### Goals

- A guaranteed, server-enforced response window on the opponent's turn — the
  active player *cannot* race the phase bar past a stop.
- Zero friction when unused: no stops set ⇒ literally no behavior change.
- All state in rows, reconstructible on reconnect/spectator join (the
  battle-zone spec invariant).
- Liveness: no hold can wedge a game — 60s scheduled backstop, mirroring the
  pregame idle-timeout pattern (`index.ts:1105-1119`).

### Non-goals

- **No own-turn stops** (product decision).
- **No persistence** across games or rematches — every game starts clean.
- **No gating of card actions** during a hold — the honor system stands.
- **No goldfish support** — `app/goldfish/**` and its `PhaseBar.tsx` are not
  touched.
- **No auto-yield-if-nothing-to-do** (Arena-style auto-pass needs a rules
  engine; this app plays cards manually).
- **No private stops.** Rows are public like every other game table; the
  default UI never renders the opponent's markers, but a modified client could
  read them. Documented in §11, not fixed.

---

## 3. State machine

Hold state is a single string column, `holdPhase`, on a new per-game row
(`''` = no hold). Firing history for the current turn is `firedPhases`.

```
                       set_phase / end_turn (active player)
                        movement enters stopped phase P
                        (P ∉ firedPhases, P ∈ opponent stops)
  ┌──────────────┐ ───────────────────────────────────────────► ┌──────────────────┐
  │ holdPhase='' │        currentPhase := P                     │ holdPhase = P    │
  │  (flowing)   │        firedPhases += P                      │ (turn is held)   │
  └──────────────┘        arm StopHoldTimeout (60s)             └──────────────────┘
         ▲                                                                │
         │   release_turn_stop (stopping seat)                            │
         │   OR set_turn_stop(P, false) by holder                         │
         │   OR StopHoldTimeout fires                                     │
         └────────────────────────────────────────────────────────────────┘
                          holdPhase := ''  (turn resumes; movement free)

  end_turn (no stop in remaining phases):
      firedPhases := ''  → flip turn → currentPhase := 'draw'
      → if new non-active seat has a 'draw' stop: engage hold at 'draw'
```

While `holdPhase !== ''`: `set_phase` and `end_turn` throw for the active
player. Everything else is unaffected.

---

## 4. Schema changes

Two new tables in `spacetimedb/src/schema.ts`. **No new columns on `Game` or
`Player`** — adding a column changes those rows' BSATN shape and breaks
deployed clients' subscriptions during the publish window (the documented
reason `PregameState` and `ForgeGame` are separate tables, `schema.ts:455-465`,
`:518-528`).

### 4.1 `TurnStops` — one row per game, created lazily

```ts
// Phase Stops (opponent-turn priority stops). One row per game, inserted
// lazily on the first set_turn_stop call — absence of a row means "no stops,
// no hold". Deliberately a separate table, NOT Game columns (BSATN shape).
export const TurnStops = table(
  {
    name: 'turn_stops',
    public: true,
    indexes: [
      { accessor: 'turn_stops_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    seat0Stops: t.string().default(''),  // csv of phases seat 0 stops on (fires during seat 1's turn)
    seat1Stops: t.string().default(''),  // csv of phases seat 1 stops on (fires during seat 0's turn)
    holdPhase: t.string().default(''),   // '' | phase currently holding the turn
    firedPhases: t.string().default(''), // csv of phases whose stop already fired this turn; reset by end_turn
  }
);
```

- Phase csv values come from the existing whitelist
  (`draw,upkeep,preparation,battle,discard`); parse/serialize lives in the
  pure module (§6.5), never ad-hoc string handling in reducers.
- The holding seat is derivable: it is always the non-active seat
  (`1n - game.currentTurn`); no column needed.

### 4.2 `StopHoldTimeout` — scheduled backstop

House pattern: forward-reference setter in `schema.ts` (the
`PregameIdleTimeout` idiom at `schema.ts:567-592`), registered in `index.ts`
right after the reducer definition.

```ts
let _handleStopHoldTimeout: any;
export const setStopHoldTimeoutReducer = (reducer: any) => {
  _handleStopHoldTimeout = reducer;
};

export const StopHoldTimeout = table(
  {
    name: 'stop_hold_timeout',
    public: true,
    scheduled: () => _handleStopHoldTimeout,
    indexes: [
      { accessor: 'stop_hold_timeout_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    gameId: t.u64(),
    phase: t.string(),  // the phase this row was armed for — stale-row guard at fire time
  }
);
```

Constant in `index.ts`: `const STOP_HOLD_TIMEOUT_MICROS = 60_000_000n;` (60s;
tunable). Arming uses the delete-then-insert helper pattern of
`schedulePregameIdleTimeout` (`index.ts:1105-1119`) so at most one row exists
per game.

---

## 5. Hold-engagement rules (the semantics, precisely)

Let `stops` = the non-active seat's stop set, `fired` = `firedPhases`.

1. **Forward `set_phase`** from index `i` to index `j > i` (indices in
   `PHASE_ORDER = [draw, upkeep, preparation, battle, discard]`): scan phases
   at indices `i+1 … j` **in order**; the first phase `P` with
   `P ∈ stops && P ∉ fired` wins. The game lands on `P` (not `j`), exactly as
   if the active player had clicked `P` — including `P`'s enter side effects
   (entering `battle` opens the battle band, `index.ts:2542-2551`) and the
   origin phase's leave side effects (leaving `battle` runs
   `runBattleAutoReturn`, `index.ts:2537-2540`). Then `holdPhase := P`,
   `fired += P`, arm the timeout, log. If no phase in range qualifies, the
   jump completes normally.
2. **Backward or same-phase `set_phase`**: never engages a stop. Backward
   movement is a correction, not turn progression.
3. **`end_turn`** from index `i`: scan indices `i+1 … 4` (through `discard`).
   A qualifying phase snaps the game there and holds — **the turn does not
   end**; after release the active player clicks End Turn again. If nothing
   qualifies: reset `firedPhases := ''`, flip the turn exactly as today
   (`currentTurn`, `currentPhase: 'draw'`, `turnNumber`, auto-draw 3, Paragon
   soul refill) — and then, if the **new** non-active seat has an unfired
   `draw` stop, engage a hold at `draw` (`fired := 'draw'`). The new active
   player's 3 cards are already drawn; the hold sits between their draw and
   their ability to advance.
4. **While `holdPhase !== ''`**: both `set_phase` and `end_turn` throw
   `SenderError('The turn is held by your opponent's stop')` before any other
   movement logic. Backward movement included — release first, then move.
5. **Once per phase per turn**: `fired` accumulates within one player-turn and
   is cleared only at a successful turn flip. Entering a phase without a stop
   set does **not** mark it fired — so a stop toggled on mid-turn can still
   fire on a later re-entry this turn (matches MTGO's "enable it before the
   turn reaches it" in the common case, and errs toward firing on re-entry).
6. **Toggling never fires a hold.** `set_turn_stop(P, true)` while the
   opponent's turn is already in `P` does nothing until the next entry.

---

## 6. Reducers

All new reducers follow module conventions: object-syntax params, BigInt
literals, `findPlayerBySender` for identity (never trust an identity arg),
spread-the-row on update, `SenderError` for user-visible failures.

### 6.1 `set_turn_stop({ gameId: t.u64(), phase: t.string(), enabled: t.bool() })`

- `findPlayerBySender`; game must exist; `status === 'playing'` (pregame OK —
  toggling during `pregamePhase !== ''` is legal prep for turn 1; holds cannot
  engage there because `set_phase`/`end_turn` already throw during pregame).
- `phase` must be in the whitelist.
- Lazy-insert the `TurnStops` row (`id: 0n`) if absent, then update the
  caller's seat csv via the pure module.
- **Special case:** `enabled === false` while `holdPhase === phase` **and**
  the caller is the current holding seat (non-active) ⇒ also release the hold
  (same path as §6.2). Removing the stop you're currently holding on is a
  "never mind" — it must not leave the game wedged behind an orphaned hold.
- **Not logged to `GameAction`.** Toggle events would leak intent into the
  shared chat/log. (Hold engage/release *are* logged — they're public the
  moment they happen.)

### 6.2 `release_turn_stop({ gameId: t.u64() })`

- `findPlayerBySender`; game must exist; `TurnStops` row must exist with
  `holdPhase !== ''`, else `SenderError('No stop is holding the turn')`.
- Caller must be the **non-active** seat (`player.seat !== game.currentTurn`),
  i.e. the stop's owner — the active player cannot release their opponent's
  window.
- Clears `holdPhase`, deletes any `StopHoldTimeout` rows for the game, logs
  `STOP_RELEASE`.

### 6.3 `handle_stop_hold_timeout` — scheduled

```ts
export const handle_stop_hold_timeout = spacetimedb.reducer(
  { arg: StopHoldTimeout.rowType },
  (ctx, { arg }) => { ... }
);
setStopHoldTimeoutReducer(handle_stop_hold_timeout);
```

Defensive early-`return`s (never throw), per `handle_pregame_idle_timeout`
(`index.ts:2208-2232`): game missing → return; `status !== 'playing'` →
return; `TurnStops` row missing or `holdPhase === ''` → return;
`holdPhase !== arg.phase` (stale row) → return. Otherwise clear `holdPhase`
and log `STOP_RELEASE` with a timed-out marker. The scheduled row self-deletes
after the reducer runs.

### 6.4 Modified `set_phase` and `end_turn`

Both get, immediately after their existing `'Not your turn'` guard:

```ts
const stopsRow = findTurnStops(ctx, gameId);           // undefined-safe helper
if (stopsRow && stopsRow.holdPhase !== '') {
  throw new SenderError("The turn is held by your opponent's stop");
}
```

Then, before executing the movement, the scan of §5 via the pure module. On a
hit, the reducer performs the snap-to-P transition (sharing the existing
leave/enter side-effect code), updates the `TurnStops` row (spread + new
`holdPhase`/`firedPhases`), arms the timeout, logs `STOP_HOLD`, and returns —
skipping the rest of the movement. `end_turn` additionally clears
`firedPhases` on every successful flip and runs the turn-start `draw` check
(§5.3); both no-op when the `TurnStops` row doesn't exist — no eager insert.
No other reducer changes: card actions never consult stops.

### 6.5 Pure module: `spacetimedb/src/stopFlow.ts`

House pattern from `pregameFlow.ts`: the decision logic is a pure, unit-tested
module; reducers stay thin.

```ts
export const STOP_PHASES = ['draw', 'upkeep', 'preparation', 'battle', 'discard'] as const;
export function parseStops(csv: string): string[];
export function serializeStops(list: string[]): string;
export function toggleStop(csv: string, phase: string, enabled: boolean): string;
// First qualifying stop strictly after `fromIdx`, up to and including `toIdx`;
// null if none. Used by set_phase (j = target) and end_turn (toIdx = 4).
export function firstStopInRange(
  fromIdx: number, toIdx: number, stopsCsv: string, firedCsv: string
): string | null;
```

Tests in `spacetimedb/__tests__/stopFlow.test.ts` (see §10).

### 6.6 Cleanup

`cleanup_stale_games` (`index.ts:2412`) and any path that deletes `Game` rows
must also delete the game's `TurnStops` and `StopHoldTimeout` rows, following
the `clearPregameRows` precedent (`index.ts:1220-1228`).

---

## 7. Action log

Two new `GameAction` types, both logged with the **stopping player's** id:

- `STOP_HOLD` — "⏸ {name} stopped the turn at {Phase}" (logged inside the
  active player's `set_phase`/`end_turn` call, attributed to the stopper).
- `STOP_RELEASE` — "▶ {name} passed" / "▶ Stop timed out" (payload
  distinguishes manual vs timeout vs toggle-off).

Stop *toggles* are never logged (§6.1).

---

## 8. Client rendering

### 8.1 `app/play/components/TurnIndicator.tsx` — markers, toggling, hold UI

- **Toggling:** the five phase buttons (`:718-757`) currently compute
  `canClick = isMyTurn && !isActive`. New rule: when `!isMyTurn && !readOnly`
  and pregame is over, phase buttons become clickable and toggle the viewer's
  stop for that phase (`onToggleStop(phase)` prop). On your own turn the
  buttons keep their existing jump behavior — no overload. Tooltip on
  non-active hover: "Stop here on {opponent}'s turn".
- **Markers:** a small filled dot rendered beneath a phase label when the
  *viewer's own* seat has a stop there. Rendered on both turns (it's your
  standing preference), but only ever the viewer's own stops — the opponent's
  markers are never rendered, on either client or spectator. Must coexist
  with the sliding-pill measurement (`activeBounds`, `:222-270`) — the dot is
  part of the button, not the pill.
- **Hold state — stopping player (non-active):** the held phase gets an amber
  treatment + pulsing dot; where the End Turn button sits for the active
  player (`:786`), the non-active holder gets a prominent **PASS** button
  (`onReleaseStop`) with the countdown ("Pass · 47s").
- **Hold state — active player:** phase buttons and End Turn render disabled
  with a caption "Held — {opponent} stopped at {Phase} · 47s". Server throws
  anyway; the client just shouldn't offer dead buttons.
- Countdown derives from the `StopHoldTimeout` row's `scheduledAt`
  (`scheduleAt.tag === 'Time'`, micros → `Number(... / 1000n)`) — client
  timestamp math per `spacetimedb/CLAUDE.md` (timestamps are objects, never
  `new Date(row.x)`).
- Note: `TurnIndicator` already carries dead `onRequestPriority` /
  `hasPendingPriority` props (`:125-171`, unused in the body). Leave them;
  removing is out of scope.

### 8.2 `app/play/hooks/useGameState.ts` — data + wrappers

- Subscribe to `turn_stops` and `stop_hold_timeout` filtered by `gameId` in
  the subscription SQL **and** predicate the `useTable` hooks with `.where`
  on `gameId` — subscription-SQL-only filtering leaks stale rows from the
  shared refcounted client cache (known SDK gotcha).
- Expose: `myStops: string[]`, `holdPhase: string`, `holdSeat` (derived:
  non-active seat when `holdPhase !== ''`), `holdDeadlineMicros` (from the
  timeout row), and reducer wrappers `setTurnStop(phase, enabled)` /
  `releaseTurnStop()` (object-syntax `conn.reducers.setTurnStop({...})`).
- Noop stubs added to the disconnected/spectator variants (`:1329-1330`
  pattern).

### 8.3 `app/play/[code]/client.tsx` — wiring

- Pass the new props through to `TurnIndicator` (`:1802-1828`).
- `requestEndTurn` (`:361-367`) is unchanged — the battle-confirm modal still
  intercepts first; the server-side stop scan runs when `end_turn` actually
  fires. Order: confirm → reducer → possible snap-and-hold.
- Enter hotkey: `useGameHotkeys` already turn-gates advance; when the hold is
  against *you* (you're active), the reducer throws and surfaces the standard
  error toast. No client change required beyond the disabled states in §8.1.
  Enter is deliberately **not** mapped to PASS for the holder — an accidental
  Enter must not burn a window the player fought to get.

### 8.4 Spectators — `app/play/spectate/[code]/client.tsx`

Spectator `TurnIndicator` (`:531-550`, `readOnly`) renders the hold treatment
and countdown (public row), never markers or toggles.

### 8.5 What is *not* touched

`app/goldfish/**` (including `PhaseBar.tsx`), `GameToolbar`'s Action Priority
button (kept as-is — it remains the "please act" nudge; stops are the
mechanical guarantee), pause system, initiative system.

---

## 9. Edge cases

| # | Scenario | Behavior |
|---|----------|----------|
| E1 | Active player jumps draw→discard; opponent stops on upkeep **and** battle | Snap to upkeep, hold. After release the player is *in upkeep*; a later jump to discard can still hold at battle (unfired). One hold per movement. |
| E2 | End Turn from battle, stop on discard | Snap to discard (running battle auto-return via the leave-battle path), hold. Turn does not end; End Turn must be clicked again after release. |
| E3 | I end my turn; I have a `draw` stop set | My opponent's turn starts, their 3 cards auto-draw, then the hold engages *for me* at their draw. Working as designed (it's their turn; my stop). |
| E4 | Stop toggled on for the phase the turn is already in | No retro-fire (§5.6). Fires on next entry (possibly this turn via re-entry, else next turn). |
| E5 | Backward jump battle→preparation, then forward to battle again; battle stop already fired this turn | No re-fire (`fired`). Stop fires again next turn. |
| E6 | Stopping player toggles the held phase off mid-hold | Hold releases (§6.1 special case), timeout row deleted. |
| E7 | Stopping player disconnects mid-hold | 60s backstop releases the hold regardless; the existing disconnect-timeout machinery handles the game itself. No deadlock. |
| E8 | Mutual pause (honor-system pause) active while a hold engages | The 60s backstop still runs — scheduled reducers don't consult the pause columns. Accepted simplification; documented, not fixed. |
| E9 | Both `awaiting-soul` End Turn confirm and a discard stop | Client confirm modal first; on confirm, `end_turn` snaps to discard and holds. Two prompts in sequence, each doing its own job. |
| E10 | Mixed versions during rollout | Old client + new module: old clients cannot call `set_turn_stop`, so no stops exist in their games and `set_phase`/`end_turn` behave exactly as before. New client + old module: `setTurnStop` isn't found — the toggle fails with an error toast and nothing else degrades. Both orders safe. |
| E11 | Rematch / new game | New `gameId`, no `TurnStops` row ⇒ all stops off. Product default satisfied lazily. |
| E12 | Spectator loads mid-hold | All state in public rows; banner + countdown render from scratch. Reconnect same. |
| E13 | Active player spams Enter/phase clicks during hold | `SenderError` toast each time; no state change. |
| E14 | All 5 phases stopped, opponent never passes | Worst case +5×60s per turn. Griefing bounded by the backstop; see §11. |

---

## 10. Testing

- **Unit (pure):** `spacetimedb/__tests__/stopFlow.test.ts` — csv
  parse/serialize/toggle round-trips; `firstStopInRange` ordering, exclusive
  `from` / inclusive `to`, fired-set exclusion, empty csvs; end-turn range
  (`i+1…4`); draw-stop-at-flip case expressed as `firstStopInRange(-1, 0, …)`.
- **Server logic (by construction):** reducers stay thin; every branch beyond
  the pure module is an existing house pattern (guards, spread-update,
  delete-then-insert arm, early-return scheduled reducer).
- **E2E (two-browser, follows `e2e/play/pregameStarPhase.spec.ts`):**
  non-active sets a battle stop → active advances draw→battle→hold engages →
  active's End Turn throws → holder passes → active ends turn. Plus: E3
  (draw stop at flip) and E6 (toggle-off releases).
- **Manual (mobile):** toggle targets on a phone-width phase bar; hold banner
  legibility mid-game; countdown behavior on reconnect.

---

## 11. Deployment & risks

**Deployment.** Additive schema (two new tables, two new reducers, two
modified reducers) — no `Game`/`Player` shape change, no `--clear`, no
migration. Standard flow via the `spacetimedb-deploy` skill: publish dev
module + `spacetime generate` bindings on the feature branch (CI publishes
`redemption-multiplayer-dev` automatically on any branch push touching
`spacetimedb/**`); on merge, CI publishes prod — **pair the merge with the
Vercel deploy** so clients and module move together (E10 makes the window
safe in both orders, but same-day is hygiene).

**Risks.**

- **Stops are readable by a modified client** (public table). The default UI
  hides opponent markers, but true privacy needs a private table + view — the
  module currently has zero views and the SDK's view perf pitfalls are real.
  Documented, not fixed. If it ever matters competitively, migrate
  `seat0Stops`/`seat1Stops` behind a per-sender view; `holdPhase` stays
  public.
- **Stall griefing** is bounded (E14) but a determined opponent adds up to
  ~5 min/turn. Tournament timers and the social layer absorb this; if abuse
  shows up, drop `STOP_HOLD_TIMEOUT_MICROS` or add a per-turn hold budget.
- **UI overload on the phase bar** — the same five buttons mean "jump" on
  your turn and "toggle stop" on the opponent's. Mitigated by tooltip, dot
  markers, and the amber hold treatment; watch early feedback.
- **The 60s constant is a guess.** Too short burns real decisions; too long
  rewards stalling. It's one constant; tune after live play.
