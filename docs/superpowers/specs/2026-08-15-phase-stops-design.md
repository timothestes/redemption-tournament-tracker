# Phase Stops — Opponent-Turn Priority Stops — Design Spec

**Date:** 2026-08-15
**Status:** Design rev 4 (one-shot gates + priority-prompt release — see §14; rev 3's gate placement stands, its release/persistence model does not)
**Scope:** Multiplayer only (`/play`). Goldfish is untouched. Spectators see holds but can never set stops.

> Adapted from MTGO's "stops" and Arena's phase-bar stop markers: a player flags
> phases of the **opponent's turn** where the turn must pause so they get a
> guaranteed window to act before play continues. Per product decision: stops
> apply to the opponent's turn only, and every game starts with all stops OFF
> (no persistence across games).
>
> **Rev 2** incorporates the adversarial review. The two blockers: rematch
> reuses the same `gameId` (in-place Game-row reset), so stop/hold rows must be
> cleared on rematch accept or a mid-hold game end wedges the next game (B1);
> and `set_phase`/`end_turn` are not the only phase movers — `end_battle` and
> `surrender_soul` write `currentPhase` and `enter_battle` opens the battle
> band from any phase, so all of them now participate in the stop machinery
> (B2/M1). Also: `finishPregame` runs the turn-1 draw-stop check (M2),
> `gameId` becomes the row's primary key (m3), and the client sections now
> enumerate every advance affordance, the spectator data path, ChatPanel log
> rendering, and mobile toggle feedback (m4–m8).

---

## 1. Summary

Today the active player can click through Draw → Discard and end their turn as
fast as they can tap, and the non-active player has no mechanical way to say
"wait — I want to act here." The existing **Action Priority** button
(`app/shared/components/GameToolbar.tsx:202-217`) is purely a request banner:
it grants nothing and pauses nothing.

Phase Stops adds an MTGO-style mechanism, adapted to this app's honor-system
model:

- The **non-active player** taps phases on the `TurnIndicator` bar to toggle
  **stop markers** on phases of the opponent's turn. Off by default each game;
  sticky for the rest of the game once set (toggle off any time).
- When the active player's turn **enters** a stopped phase (by clicking a
  phase, by a forward jump that crosses it, at turn start for Draw, or by a
  phase-writing battle reducer — §5), the server engages a **hold**: turn
  progression freezes until the stopping player releases the hold ("Pass") or
  a **60-second server backstop** auto-releases it.
- A hold blocks **phase movement and battle conclusion**: `set_phase`,
  `end_turn`, `end_battle`, `resolve_battle`, `surrender_soul`. Card plays
  stay ungated, consistent with the module's honor-system design — both
  players can still act during a hold; what they cannot do is move the turn
  past the window or conclude the open battle inside it.
- Each stop fires **at most once per phase per turn** (re-entering a phase
  after a backward jump does not re-fire a stop that already fired this turn).

MTGO semantics kept: per-phase toggles on the opponent's turn, "no stop = the
turn flows past," stops are sticky once set, a stop set *after* the turn has
already entered that phase does not fire retroactively. MTGO semantics
deliberately dropped: own-turn stops, yield-until modes, full-control mode,
per-step granularity (Redemption has 5 phases, not MTG's ~12 steps), and stop
privacy (see §12 Risks).

---

## 2. Goals / Non-goals

### Goals

- A guaranteed, server-enforced response window on the opponent's turn — the
  active player *cannot* race past a stop, whether via the phase bar, End
  Turn, or the battle reducers that move the phase themselves.
- Zero friction when unused: no stops set ⇒ literally no behavior change.
- All state in rows, reconstructible on reconnect/spectator join (the
  battle-zone spec invariant).
- Liveness: no hold can wedge a game — 60s scheduled backstop, mirroring the
  pregame idle-timeout pattern (`spacetimedb/src/index.ts:1105-1119`), plus
  explicit clearing on rematch.

### Non-goals

- **No own-turn stops** (product decision).
- **No persistence** across games or rematches — every game starts clean
  (enforced explicitly on rematch accept; see §6.6).
- **No gating of card plays** during a hold — the honor system stands.
  Dragging, playing enhancements, blocking: all still possible for both
  players inside a hold window.
- **No goldfish support** — `app/goldfish/**` and its `PhaseBar.tsx` are not
  touched.
- **No auto-yield-if-nothing-to-do** (Arena-style auto-pass needs a rules
  engine; this app plays cards manually).
- **No private stops.** Rows are public like every other game table; the
  default UI never renders the opponent's markers, but a modified client could
  read them. Documented in §12, not fixed.

---

## 3. State machine

*The land-then-hold transition below is superseded by rev 3 — see §13.*

Hold state is a single string column, `holdPhase`, on a new per-game row
(`''` = no hold). Firing history for the current turn is `firedPhases`.

```
                       phase movement by the active player's turn
                        enters stopped phase P
                        (P ∉ firedPhases, P ∈ opponent stops)
                        via set_phase / end_turn snap / turn flip /
                        finishPregame / end_battle / surrender_soul /
                        enter_battle (band-open, §5.7)
  ┌──────────────┐ ───────────────────────────────────────────► ┌──────────────────┐
  │ holdPhase='' │        currentPhase := P                     │ holdPhase = P    │
  │  (flowing)   │        firedPhases += P                      │ (turn is held)   │
  └──────────────┘        arm StopHoldTimeout (60s)             └──────────────────┘
         ▲                                                                │
         │   release_turn_stop (stopping seat)                            │
         │   OR set_turn_stop(P, false) by holder                         │
         │   OR StopHoldTimeout fires                                     │
         └────────────────────────────────────────────────────────────────┘
                          holdPhase := ''  (turn resumes)

  While holdPhase !== '': set_phase, end_turn, end_battle, resolve_battle,
  and surrender_soul all refuse. Card plays are unaffected.

  end_turn (no stop in remaining phases):
      firedPhases := ''  → flip turn → currentPhase := 'draw'
      → if new non-active seat has a 'draw' stop: engage hold at 'draw'
```

---

## 4. Schema changes

Two new tables in `spacetimedb/src/schema.ts`, both registered in the
`schema({...})` export (`schema.ts:597-620`). **No new columns on `Game` or
`Player`** — adding a column changes those rows' BSATN shape and breaks
deployed clients' subscriptions during the publish window (the documented
reason `PregameState` and `ForgeGame` are separate tables, `schema.ts:455-465`,
`:518-528`).

### 4.1 `TurnStop` — one row per game, created lazily

`gameId` is the **primary key**, exactly like `PregameState`
(`schema.ts:529-539`) — the one-row-per-game invariant is enforced by the
schema and lookups are `ctx.db.turnStop.gameId.find(gameId)`, no extra index
needed. Singular table name per module convention.

```ts
// Phase Stops (opponent-turn priority stops). One row per game, inserted
// lazily on the first set_turn_stop call — absence of a row means "no stops,
// no hold". Deliberately a separate table, NOT Game columns (BSATN shape).
export const TurnStop = table(
  {
    name: 'turn_stop',
    public: true,
  },
  {
    gameId: t.u64().primaryKey(),
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

1. *(superseded by rev 3 — see §13)* **Forward `set_phase`** from index `i` to index `j > i` (indices in
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
3. *(superseded by rev 3 — see §13)* **`end_turn`** from index `i`: first the existing auto-return runs if
   `battleState !== ''` (`index.ts:2587-2590`), closing any open band. Then
   scan indices `i+1 … 4` (through `discard`). A qualifying phase snaps the
   game there and holds — **the turn does not end**; after release the active
   player clicks End Turn again. If nothing qualifies: reset
   `firedPhases := ''`, flip the turn exactly as today (`currentTurn`,
   `currentPhase: 'draw'`, `turnNumber`, auto-draw 3, Paragon soul refill) —
   and then, if the **new** non-active seat has a `draw` stop, engage a hold
   at `draw` (`fired := 'draw'`). The new active player's 3 cards are already
   drawn; the hold sits between their draw and their ability to advance.
4. **While `holdPhase !== ''`**: `set_phase`, `end_turn`, `end_battle`,
   `resolve_battle`, and `surrender_soul` all throw
   `SenderError('The turn is held — waiting on {stopper}')` before any other
   logic. Backward movement included — release first, then move. If the
   stopper themselves needs one of these (e.g. surrendering a soul from a
   battle fought inside their window), they press Pass first; the buttons are
   one tap apart.
5. **Once per phase per turn**: `fired` accumulates within one player-turn and
   is cleared only at a successful turn flip. Entering a phase without a stop
   set does **not** mark it fired — so a stop toggled on mid-turn can still
   fire on a later re-entry this turn (matches MTGO's "enable it before the
   turn reaches it" in the common case, and errs toward firing on re-entry).
6. **Toggling never fires a hold.** `set_turn_stop(P, true)` while the
   opponent's turn is already in `P` does nothing until the next entry
   (exception: the band-open rule below serves the same intent for battle).
7. **Battle reducers are phase movers and follow the same rules:**
   - `end_battle` (`index.ts:2890-2914`, phase write at `:2909`) and
     `surrender_soul` (`index.ts:3170`, phase write at `:3232-3236`) advance
     battle→discard. That advance is forward movement: it runs the scan, so
     an unfired `discard` stop lands the game on discard **held**. The battle
     itself still concludes (band closes, souls move) — only the turn's
     progression pauses.
   - `enter_battle` (`index.ts:3013-3054`) opens the band from **any** phase
     with no phase write — which would otherwise let an attack skip a battle
     stop entirely. New rule: when the **turn player** calls `enter_battle`
     and the opponent has an unfired `battle` stop and
     `currentPhase ≤ battle`, the reducer snaps `currentPhase` to `battle`
     (skipping the §5.1 enter-battle side effect — the band-open *is* this
     reducer), engages the hold, and lets the band-open proceed. The attacker
     is committed; the defender gets their window before choosing how to
     respond. If the phase-bar route already fired the battle stop this turn,
     nothing re-fires. Non-turn-player `enter_battle` calls (blocking,
     joining a live battle) never trigger stops.
8. **Turn 1**: `finishPregame` (`index.ts:1187-1215`) starts turn 1 by
   writing `pregamePhase: ''` — no `set_phase`/`end_turn` runs. It therefore
   performs the same turn-start `draw` check as rule 3, so a draw stop set
   during pregame fires at the top of turn 1.

---

## 6. Reducers

All new reducers follow module conventions: object-syntax params, BigInt
literals, `findPlayerBySender` for identity (never trust an identity arg),
spread-the-row on update, `SenderError` for user-visible failures.

### 6.1 `set_turn_stop({ gameId: t.u64(), phase: t.string(), enabled: t.bool() })`

- `findPlayerBySender`; game must exist; `status === 'playing'` (pregame OK —
  toggling during `pregamePhase !== ''` preps stops for turn 1, which §5.8
  makes real for the draw stop; holds cannot engage mid-pregame because every
  phase mover already throws during pregame).
- `phase` must be in the whitelist.
- Lazy-insert the `TurnStop` row (`gameId` as pk — no autoInc placeholder)
  if absent, then update the caller's seat csv via the pure module.
- **Special case:** `enabled === false` while `holdPhase === phase` **and**
  the caller is the current holding seat (non-active) ⇒ also release the hold
  (same path as §6.2). Removing the stop you're currently holding on is a
  "never mind" — it must not leave the game wedged behind an orphaned hold.
- **Not logged to `GameAction`.** Toggle events would leak intent into the
  shared chat/log. (Hold engage/release *are* logged — they're public the
  moment they happen.)

### 6.2 `release_turn_stop({ gameId: t.u64() })`

- `findPlayerBySender`; game must exist; `TurnStop` row must exist
  (`ctx.db.turnStop.gameId.find(gameId)`) with `holdPhase !== ''`, else
  `SenderError('No stop is holding the turn')`.
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
return; `TurnStop` row missing or `holdPhase === ''` → return;
`holdPhase !== arg.phase` (stale row) → return. Otherwise clear `holdPhase`
and log `STOP_RELEASE` with a timed-out marker. The scheduled row self-deletes
after the reducer runs.

### 6.4 Modified phase movers

One shared internal helper owns the semantics of §5 (scan + snap + hold +
arm + log); the reducers stay thin:

- **`set_phase` (`index.ts:2505`) and `end_turn` (`:2563`):** immediately
  after their existing `'Not your turn'` guard, throw if a hold is active;
  then run the scan before executing the movement. On a hit the reducer
  performs the snap-to-P transition (sharing the existing leave/enter
  side-effect code), updates the `TurnStop` row (spread + new
  `holdPhase`/`firedPhases`), arms the timeout, logs `STOP_HOLD`, and returns
  — skipping the rest of the movement. `end_turn` additionally clears
  `firedPhases` on every successful flip and runs the turn-start `draw` check
  (§5.3); both no-op when the `TurnStop` row doesn't exist — no eager insert.
- **`end_battle` (`:2890`), `resolve_battle` (`:3126`), `surrender_soul`
  (`:3170`):** all three get the hold guard (§5.4). The two that write
  `currentPhase` (`end_battle`, `surrender_soul`) run their battle→discard
  advance through the scan (§5.7), so a discard stop lands held.
- **`enter_battle` (`:3013`):** the band-open stop rule of §5.7 (turn-player
  calls only).
- **`finishPregame` (`:1187`):** the turn-1 draw-stop check (§5.8).

No other reducer changes: card plays never consult stops.

### 6.5 Pure module: `spacetimedb/src/stopFlow.ts`

House pattern from `pregameFlow.ts`: the decision logic is a pure, unit-tested
module; reducers stay thin.

```ts
export const STOP_PHASES = ['draw', 'upkeep', 'preparation', 'battle', 'discard'] as const;
export function parseStops(csv: string): string[];
export function serializeStops(list: string[]): string;
export function toggleStop(csv: string, phase: string, enabled: boolean): string;
// First qualifying stop strictly after `fromIdx`, up to and including `toIdx`;
// null if none. Used by set_phase (j = target), end_turn (toIdx = 4),
// end_battle/surrender_soul (battle→discard), and the turn-flip/finishPregame
// draw check (firstStopInRange(-1, 0, …)).
export function firstStopInRange(
  fromIdx: number, toIdx: number, stopsCsv: string, firedCsv: string
): string | null;
```

Tests in `spacetimedb/__tests__/stopFlow.test.ts` (see §10).

### 6.6 Lifecycle: rematch, cleanup, finished games

**Rematch reuses the same `gameId`.** `respond_rematch` (`index.ts:1481`)
accepts by resetting the Game row **in place** (`:1583-1611`) — no new game
row is ever created. The accept branch must therefore also delete the game's
`TurnStop` row and any `StopHoldTimeout` rows, alongside the battle-field
reset it already does. This is what enforces "all stops off each game."
Without it, a hold engaged when a game ends (concede `resign_game:2015`, win
`checkAndApplyWin:3072`, timeout victory `claim_timeout_victory:2130` — all
set `status:'finished'` without touching stops) would survive into the
rematch and wedge it: the timeout handler early-returns on finished games, so
nothing else would ever clear `holdPhase`.

**Cleanup.** `cleanup_stale_games` (`index.ts:2412`) must delete `TurnStop` +
`StopHoldTimeout` rows in **both** branches that retire a game — the delete
branch and the abandon branch (`:2456-2459`, which already calls
`clearPregameRows`) — following the `clearPregameRows` precedent
(`index.ts:1220-1228`).

**Finished games.** A `holdPhase` stranded on a finished game is inert (every
guarded reducer also requires `status === 'playing'` upstream) and is cleaned
by the two paths above. No reducer needs to clear it at finish time.

---

## 7. Action log

Two new `GameAction` types, both logged with the **stopping player's** id:

- `STOP_HOLD` — "⏸ {name} stopped the turn at {Phase}" (logged inside the
  active player's phase-mover call, attributed to the stopper).
- `STOP_RELEASE` — "▶ {name} passed" / "▶ Stop timed out" (payload
  distinguishes manual vs timeout vs toggle-off).

Stop *toggles* are never logged (§6.1). Rendering: the action-type map in
`app/play/components/ChatPanel.tsx:100-143` gets entries for both types —
unknown types fall through to raw lowercased text there.

---

## 8. Client rendering

### 8.1 `app/play/components/TurnIndicator.tsx` — markers, toggling, hold UI

- **Toggling:** the five phase buttons (`:718-757`) currently compute
  `canClick = isMyTurn && !isActive`. New rule: when `!isMyTurn && !readOnly`
  and pregame is over, phase buttons become clickable and toggle the viewer's
  stop for that phase (`onToggleStop(phase)` prop). On your own turn the
  buttons keep their existing jump behavior — no overload. Desktop hover
  tooltip: "Stop here on {opponent}'s turn".
- **Toggle feedback (mobile-first):** every toggle fires a toast —
  "Stop set: {Phase}. {Opponent}'s turn will pause there — tap again to
  remove." / "Stop removed: {Phase}." Tooltips don't exist on touch; the
  toast is the confirmation that an (easily fat-fingered) tap on the bar did
  something deliberate. The dot marker is the persistent indicator.
- **Markers:** a small filled dot rendered beneath a phase label when the
  *viewer's own* seat has a stop there. Rendered on both turns (it's your
  standing preference), but only ever the viewer's own stops — the opponent's
  markers are never rendered, on either client or spectator. Must coexist
  with the sliding-pill measurement (`activeBounds`, `:244-268`) — the dot is
  part of the button, not the pill.
- **Hold state — stopping player (non-active):** the held phase gets an amber
  treatment + pulsing dot; where the End Turn button sits for the active
  player (`:786`), the non-active holder gets a prominent **PASS** button
  (`onReleaseStop`) with the countdown ("Pass · 47s"), captioned "Your stop —
  act, then pass." (First-time clarity: the E3 case means you can trigger
  your own hold by ending your turn; the caption is what keeps that from
  reading as a freeze.)
- **Hold state — active player:** every advance affordance disables with a
  caption "Held — {opponent} stopped at {Phase} · 47s". That is **all** of:
  the five phase buttons, the prev/next arrows (`:589-605`, `:764-783`), and
  the End Turn button (`:786`). Server throws anyway; the client just
  shouldn't offer dead buttons.
- Countdown derives from the `StopHoldTimeout` row's `scheduledAt`
  (`scheduleAt.tag === 'Time'`, micros → `Number(... / 1000n)`) — client
  timestamp math per `spacetimedb/CLAUDE.md` (timestamps are objects, never
  `new Date(row.x)`).
- Note: `TurnIndicator` already carries dead `onRequestPriority` /
  `hasPendingPriority` props (`:125-171`, unused in the body). Leave them;
  removing is out of scope.

### 8.2 `app/play/hooks/useGameState.ts` — data + wrappers

- Subscribe to `turn_stop` and `stop_hold_timeout` filtered by `gameId` in
  the subscription SQL **and** predicate the `useTable` hooks with `.where`
  on `gameId` — subscription-SQL-only filtering leaks stale rows from the
  shared refcounted client cache (known SDK gotcha).
- Expose: `myStops: string[]`, `holdPhase: string`, `holdSeat` (derived:
  non-active seat when `holdPhase !== ''`), `holdDeadlineMicros` (from the
  timeout row), and reducer wrappers `setTurnStop(phase, enabled)` /
  `releaseTurnStop()` (object-syntax `conn.reducers.setTurnStop({...})`).
- Noop stubs added to the disconnected variant (`:1313-1316` pattern).
- **Spectator variant:** `useSpectatorGameState` mirrors every subscription
  in `useGameState` — it gets the same two subscriptions and `useTable`
  hooks (not just stubs), since §8.4 renders holds from it. `myStops` stays
  empty / `setTurnStop` stays a noop there.

### 8.3 `app/play/[code]/client.tsx` + `app/shared/components/GameToolbar.tsx`

- Pass the new props through to `TurnIndicator` (`client.tsx:1802-1828`).
- `requestEndTurn` (`client.tsx:360-366`) is unchanged — the battle-confirm
  modal still intercepts first; the server-side stop scan runs when
  `end_turn` actually fires. Order: confirm → reducer → possible
  snap-and-hold.
- **GameToolbar** (`app/shared/components/GameToolbar.tsx` — the shared one;
  the goldfish file of the same name is untouched): its far-right End Turn
  button disables during a hold like the TurnIndicator one; the non-active
  player's **Priority** button hides while they hold (`holdPhase !== ''`) —
  requesting a window you already hold is noise.
- Enter hotkey: `useGameHotkeys` already turn-gates advance; when the hold is
  against *you* (you're active), the reducer throws and surfaces the standard
  error toast. No client change required beyond the disabled states above.
  Enter is deliberately **not** mapped to PASS for the holder — an accidental
  Enter must not burn a window the player fought to get.

### 8.4 Spectators — `app/play/spectate/[code]/client.tsx`

Spectator `TurnIndicator` (`:531-550`, `readOnly`) renders the hold treatment
and countdown (public rows, via the mirrored subscriptions of §8.2), never
markers or toggles.

### 8.5 What is *not* touched

`app/goldfish/**` (including `PhaseBar.tsx` and goldfish's `GameToolbar`),
the Action Priority request flow (kept as-is — it remains the "please act"
nudge; stops are the mechanical guarantee), pause system, initiative system.

---

## 9. Edge cases

| # | Scenario | Behavior |
|---|----------|----------|
| E1 | Active player jumps draw→discard; opponent stops on upkeep **and** battle | Snap to upkeep, hold. After release the player is *in upkeep*; a later jump to discard can still hold at battle (unfired). One hold per movement. |
| E2 | End Turn from battle, stop on discard | Auto-return closes the band first (§5.3), then snap to discard, hold. Turn does not end; End Turn must be clicked again after release. |
| E3 | I end my turn; I have a `draw` stop set | My opponent's turn starts, their 3 cards auto-draw, then the hold engages *for me* at their draw. Working as designed (it's their turn; my stop); the PASS caption (§8.1) keeps it from reading as a freeze. |
| E4 | Stop toggled on for the phase the turn is already in | *(superseded — see §13)* No retro-fire (§5.6). Fires on next entry — except a battle stop, which the band-open rule (§5.7) can still fire if the attack hasn't started. |
| E5 | Backward jump battle→preparation, then forward to battle again; battle stop already fired this turn | No re-fire (`fired`). Stop fires again next turn. |
| E6 | Stopping player toggles the held phase off mid-hold | Hold releases (§6.1 special case), timeout row deleted. |
| E7 | Stopping player disconnects mid-hold | 60s backstop releases the hold regardless; the existing disconnect-timeout machinery handles the game itself. No deadlock. |
| E8 | Mutual pause (honor-system pause) active while a hold engages | The 60s backstop still runs — scheduled reducers don't consult the pause columns. Accepted simplification; documented, not fixed. |
| E9 | Both `awaiting-soul` End Turn confirm and a discard stop | Client confirm modal first; on confirm, `end_turn` snaps to discard and holds. Two prompts in sequence, each doing its own job. |
| E10 | Mixed versions during rollout | Old client + new module: old clients cannot call `set_turn_stop`, so no stops exist in their games and every phase mover behaves exactly as before. New client + old module: `setTurnStop` isn't found and the new-table subscriptions target tables the old module lacks — believed to fail per-call/per-hook without wider damage, but **verify a new client against a stale dev module before merge** (§11). |
| E11 | Rematch | Same `gameId`, Game row reset in place (`respond_rematch`, `index.ts:1583-1611`). The accept branch deletes `TurnStop` + `StopHoldTimeout` rows (§6.6), so the rematch starts with all stops off — including clearing any hold stranded by a mid-hold concede/win. |
| E12 | Spectator loads mid-hold | All state in public rows; banner + countdown render from scratch. Reconnect same. |
| E13 | Active player spams Enter/phase clicks during hold | `SenderError` toast each time; no state change. |
| E14 | All 5 phases stopped, opponent never passes | Worst case +5×60s per turn. Griefing bounded by the backstop; see §12. |
| E15 | Active player enters battle phase, immediately presses End Battle | *(superseded — see §13)* `end_battle`'s battle→discard advance runs the scan (§5.7): an unfired discard stop lands the game on discard **held**. The pre-rev-2 design let this skip the stop entirely. |
| E16 | Active player drags an attacker into the band during preparation (never touching the phase bar) | *(superseded — see §13)* `enter_battle` snaps the phase to battle, engages the opponent's unfired battle stop, and the band opens with the attacker committed (§5.7). The defender gets their window before responding. |
| E17 | Attacker tries to resolve/end the battle during the hold | `end_battle` / `resolve_battle` / `surrender_soul` all throw while held (§5.4). The battle concludes only after the stopper passes (or the backstop fires). |
| E18 | Battle fought inside the hold window ends with the *stopper* surrendering a soul | The stopper presses Pass, then `surrender_soul` — two taps. The hold guard applies to both players uniformly (§5.4). |

---

## 10. Testing

- **Unit (pure):** `spacetimedb/__tests__/stopFlow.test.ts` — csv
  parse/serialize/toggle round-trips; `firstStopInRange` ordering, exclusive
  `from` / inclusive `to`, fired-set exclusion, empty csvs; end-turn range
  (`i+1…4`); battle→discard range; draw-stop-at-flip/finishPregame case
  (`firstStopInRange(-1, 0, …)`).
- **Server logic (by construction):** reducers stay thin; every branch beyond
  the pure module is an existing house pattern (guards, spread-update,
  delete-then-insert arm, early-return scheduled reducer).
- **E2E (two-browser, follows `e2e/play/pregameStarPhase.spec.ts`):**
  non-active sets a battle stop → active advances draw→battle→hold engages →
  active's End Turn throws → holder passes → active ends turn. Plus: E3
  (draw stop at flip), E6 (toggle-off releases), and E16 (band-open from
  preparation triggers the battle stop).
- **Manual (mobile):** toggle targets on a phone-width phase bar; toggle
  toast visibility; hold banner legibility mid-game; countdown behavior on
  reconnect.

---

## 11. Deployment

Additive schema (two new tables; new reducers; modified: `set_phase`,
`end_turn`, `end_battle`, `resolve_battle`, `surrender_soul`, `enter_battle`,
`finishPregame`, `respond_rematch`, `cleanup_stale_games`) — no
`Game`/`Player` shape change, no `--clear`, no migration. Standard flow via
the `spacetimedb-deploy` skill: publish dev module + `spacetime generate`
bindings on the feature branch (CI publishes `redemption-multiplayer-dev`
automatically on any branch push touching `spacetimedb/**`); on merge, CI
publishes prod — **pair the merge with the Vercel deploy** so clients and
module move together. Before merge, run one new-client-against-stale-module
session to confirm the E10 degradation mode is as benign as believed.

---

## 12. Risks

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
  your turn and "toggle stop" on the opponent's. Mitigated by the toggle
  toast, dot markers, and the amber hold treatment; watch early feedback.
- **The blocked-battle-conclusion rule (§5.4) is the sharpest edge.** It is
  what makes a battle stop a real window (E17) rather than advisory, but it
  also means a confused stopper can sit on a live battle for 60s. The PASS
  caption and countdown are the mitigation; if it frustrates in practice,
  consider auto-releasing when the stopper takes a battle-concluding action
  of their own.
- **The 60s constant is a guess.** Too short burns real decisions; too long
  rewards stalling. It's one constant; tune after live play.

---

## 13. Rev 3 (2026-08-15) — gate-between-phases correction

> **Partially superseded by rev 4 (§14):** the gate-on-the-boundary model and
> the between-phase markers stand, but rev 3's release paths (PASS /
> toggle-off release), sticky stops + `firedPhases`, the draw gate, and the
> "release always crosses the gate" rule are all replaced.

Product correction from the owner, superseding everything above that assumes
land-then-hold — the §3 state-machine diagram, §5 rules 1 and 3, §5.7, and
edge-case rows E4, E15, and E16: **a stop is a gate on the boundary INTO a
phase, not a pause on the phase itself.** The turn
halts *before* entering the gated phase, and the gated phase's enter side
effects — most visibly, the battle band opening — happen only on release.
Rev 2's "land on P, then hold" gave the active player the phase's benefits
before the stopper ever got their window; the gate model is what a stop was
always meant to be.

Storage and schema are **unchanged**. `TurnStop` still keys stops by the gated
phase name; `holdPhase = P` now *means* "held at the gate before P";
`firedPhases` is unchanged (once per phase per turn, reset at flip, marked when
the gate engages).

**The five semantic deltas:**

1. **Advancing into a gated phase halts short of it.** With a battle gate,
   `set_phase(draw → battle)` legitimately crosses upkeep and preparation
   (their enter/leave effects run) and then stops: `currentPhase` is still
   `preparation`, the pill sits on Preparation, the hold is engaged, and the
   band is **not** open. PASS auto-enters battle and opens the band with no
   further clicks from the active player.
2. **`end_turn` halts too, and does not end the turn.** End Turn from draw with
   a battle gate transitions to *preparation* — crossing upkeep and preparation
   in one hop, with the band-open side effect suppressed so no phantom band
   appears — then holds before battle. The turn is not ended.
3. **Every release path crosses the gate.** `release_turn_stop` (PASS), the
   `set_turn_stop` toggle-off special case, and the 60s timeout all run one
   shared `releaseHold`, which then advances the turn *into* the released phase
   on the turn player's behalf. Toggling a held gate off is therefore an
   auto-advance, identical in effect to PASS.
4. **The band-open rule refuses instead of firing late.** A turn player's
   band-opening `enter_battle` while the opponent has an unfired battle gate
   and `currentPhase` is strictly before battle engages the hold and returns
   **without moving the card or opening the band** — reducers are
   transactional, so engage-then-throw would roll the hold back; the card
   simply snaps back like any refused optimistic drag. Any *subsequent*
   band-opening drag during an active hold throws (`assertTurnNotHeld`) and
   surfaces as an error toast. `currentPhase === 'battle'` no longer triggers
   anything: a stop set while already in battle waits for next turn (no
   retro-fire, §5.6), so rev 2's E4 battle exception is gone. Release then
   enters battle, opens the band, and a re-drag succeeds. `end_battle` /
   `surrender_soul` likewise hold at the discard gate with `currentPhase` left
   on `battle` rather than writing discard.
5. **The draw gate is unchanged.** `end_turn`'s flip and `finishPregame` stay
   flip-then-hold: the hold sits at the top of draw *after* the auto-draw,
   because holding before the flip would invert which seat is holding.
   Release is a no-op transition there (`currentPhase === releasedPhase`).

**Visuals and copy (§8).** The phase buttons revert to plain own-turn jump /
opponent-turn inert — the toggle overload and the on-button dot markers are
gone. In their place, five between-phase **gate markers** (`PhaseGate`,
`data-testid="phase-gate-{phase}"`): one before the Draw button and one in each
gap between adjacent phase buttons, the gate in front of P toggling the
viewer's stop on P. A slim vertical bar inside a 16px invisible hit target —
solid amber-gold `#c4955a` when armed, amber `#fbbf24` + `stopHoldPulse` while
holding, a faint `rgba(196,149,90,0.28)` outline whenever toggling is possible
(discoverability was the complaint), invisible otherwise. All copy moves from
"at {Phase}" to "**before {Phase}**": gate tooltips, the toggle toasts, the
active player's hold caption, and the `STOP_HOLD` chat line ("⏸ stopped the
turn before {Phase}"). The sliding pill is unaffected — gates are siblings of
the buttons, and `buttonRefs` stays buttons-only.

**Testing (supersedes §10's E2E bullet).** `spacetimedb/__tests__/stopFlow.test.ts`
is untouched (the pure module did not change). The two-browser suite
`e2e/play/phaseStops.spec.ts` is rewritten to the gate model: arming clicks
target the gate markers, scenario 1 asserts the halt in preparation with the
band shut and PASS auto-entering battle, scenario 3 asserts the toggle-off
auto-advance, and scenario 4 asserts the discard gate holding with the band
still open (E17's dead conclude buttons moved here — a battle gate's hold has
no band) plus the error toast on a band-open drag during a hold. One
limitation is recorded there: R5's *silent* pre-battle refusal is not reachable
from the client, because the band is phase-driven (`isBattleBandActive`) and
`findZoneAtPosition` only yields the `battle` zone while the band is on screen,
so no drop during preparation can reach `enter_battle` at all. The reachable
half of the same guard — `assertTurnNotHeld` inside `enter_battle` — is what
the suite drives.

---

## 14. Rev 4 (2026-08-16) — one-shot gates, end-of-turn gate, priority-prompt release

Product correction from the owner, on top of rev 3's gate placement. Three
changes: **the hold surfaces as the existing action-priority prompt** (not a
Held caption + PASS button), **the gate set moves** (no draw gate; a new gate
at the end of discard, before the turn flip), and **gates are one-shot**
(tripping consumes the stop; it must be re-toggled to fire again).

**Gate set.** `STOP_PHASES = ['upkeep', 'preparation', 'battle', 'discard',
'end']`. A gate sits on the boundary *before* its phase; `'end'` sits between
discard and the turn flip (boundary index 5). There is no gate before draw —
the flip auto-draws, so the window "before the opponent's draw" is your own
turn's `'end'` gate. Rev 3's flip-then-hold draw special case is deleted
outright (`finishPregame` and the post-flip check are gone).

**One-shot.** `engageHold` removes the tripped stop from the stopping seat's
csv in the same write that sets `holdPhase`. `firedPhases` is dead (kept in
the schema so live rows migrate in place; always written `''`). Re-toggling a
spent gate re-arms it — including mid-hold or later the same turn — and it
will fire again; that is the intended "toggle again" flow.

**The hold IS a priority request.** When a gate trips, the ACTIVE player gets
the same center-board `BoardRequestBanner` the Priority button uses:
"**{stopper}** requests action priority before you move to **{Phase}**"
(`'end'`: "…before you end your turn"), with **Grant** / **Deny**. There is no
Held caption, no PASS button, and the stopper has no release affordance at
all — their gate marker pulses amber for the duration and their stop is
already spent.

- **Grant** (`release_turn_stop(denied:false)`) and **Deny**
  (`release_turn_stop(denied:true)`) both ONLY lift the hold — the turn
  **stays exactly where it halted** (owner correction on top of the initial
  rev 4 cut, which had Deny auto-resume the halted movement). The stopper
  takes their window on the honor system — exactly the existing
  Priority-button contract — and the active player **redoes their move
  themselves**; the consumed gate lets it through. Grant vs Deny differ only
  in the logged courtesy ("granted action priority" vs "declined the
  priority request").
- **Timeout** (60s backstop, unchanged plumbing): same — lifts the hold,
  nothing advances.
- `TurnStop.holdResume` (appended-last column) shipped with the auto-resume
  cut and is now **unused** (always written `''`); it stays because
  auto-migration cannot drop columns.
- Only the **active** player may call `release_turn_stop` now (rev 3 allowed
  only the non-active player — inverted). The toggle-off release special case
  is deleted; toggling during a hold only arms/disarms future boundaries.

**Server shape.** One shared movement engine, `resumeMovement(ctx, gameId,
actingPlayer, target)`, now backs `set_phase`, `end_turn` (target `'end'`),
and the `end_battle`/`surrender_soul` battle→discard advance: scan boundaries
`(cur, target]` for the first armed gate → cross to the gate's near side
(`openBattleBand:false` — crossing battle en route is not an attack) and
hold, else complete the movement (`applyPhaseTransition`, or
`performTurnFlip` — the flip body extracted from `end_turn` — for `'end'`).
`releaseHold` never calls it — a release only clears the hold row and logs.
`assertTurnNotHeld`'s message is now "The turn is held — {stopper} has
priority".

**Visuals and copy.** Gate markers keep rev 3's geometry minus the draw gate,
plus `phase-gate-end` after the Discard button. Marker states are unchanged,
but note the reading changed: an amber pulse means *a hold* (the stop under
it is already consumed), and after release the marker drops to the faint
outline, not gold. The End Turn slot is a plain disabled button while held
(title "Answer the priority request first"). Spectators keep the "Held · Ns"
status span. Chat log: STOP_HOLD → "⏸ requests priority before {Phase}" /
"…before the turn ends"; STOP_RELEASE → "▶ granted action priority" /
"▶ declined the stop — turn resumes" / "▶ stop timed out — turn resumes"
(legacy rev-3 reasons render as "▶ passed — turn resumes").

**Testing.** `stopFlow.test.ts` rewritten for the boundary-index scan and the
gate list (16 cases). The two-browser e2e suite is rewritten to rev 4:
(1) battle gate halts in preparation, Deny stays put, the redone Battle click
enters it (band opens) with no re-fire; (2) no `phase-gate-draw` exists, the
end gate halts End Turn on discard with the band suppressed on the crossing,
a second End Turn completes the flip; (3) Grant lifts the hold without
advancing and a re-click of the gated phase sails through (one-shot);
(4) discard gate at the battle boundary (E17 dead conclude buttons; Deny
leaves the turn on battle with the band intact), a re-armed spent gate
re-fires, and a band-open drag during a hold is refused with the "has
priority" toast.
