# Phase Stops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MTGO-style opponent-turn priority stops for multiplayer `/play`: the non-active player marks phases of the opponent's turn where the server freezes turn progression until they pass (or a 60s backstop fires).

**Architecture:** Two new SpacetimeDB tables (`TurnStop` one-row-per-game keyed by gameId, `StopHoldTimeout` scheduled backstop), a pure decision module `stopFlow.ts` (csv parsing + stop-scan), three new reducers, and stop-scan/hold-guard wiring in the seven existing phase movers. Client: two new subscriptions in `useGameState`/`useSpectatorGameState`, stop toggling + hold UI in `TurnIndicator`, wiring in `client.tsx`/`GameToolbar`/spectate, and two new action-log types in `ChatPanel`.

**Tech Stack:** SpacetimeDB TypeScript module (SDK 2.x — read `spacetimedb/CLAUDE.md` FIRST), Next.js 15 / React 19 client, vitest for unit tests, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-08-15-phase-stops-design.md` (in this repo — read it alongside each task; section refs below point into it).

## Global Constraints

- **Worktree:** ALL work happens in `/Users/timestes/projects/rtt-phase-stops` (branch `feat/phase-stops`). Never touch `/Users/timestes/projects/redemption-tournament-tracker` — a sibling agent may own it. Use absolute paths everywhere.
- **Goldfish untouched:** nothing under `app/goldfish/**` changes.
- **No `Game`/`Player` columns** — BSATN shape must not change (spec §4).
- **Card plays are never gated** by a hold — only `set_phase`, `end_turn`, `end_battle`, `resolve_battle`, `surrender_soul` refuse while held (spec §5.4). `enter_battle` is NOT hold-guarded (blocking during a hold is legal).
- **Stop toggles are never logged** to GameAction; hold engage/release ARE (spec §6.1/§7).
- **BigInt literals** everywhere in the module (`0n`, `1n`); `.find()` returns `null` on miss — test truthiness, never `!== undefined`.
- **Object-syntax reducer calls** on the client: `conn.reducers.setTurnStop({ gameId, phase, enabled })`.
- Phase whitelist / order: `['draw', 'upkeep', 'preparation', 'battle', 'discard']`.
- Timeout constant: `STOP_HOLD_TIMEOUT_MICROS = 60_000_000n` (60s).
- Git: stage only your own files (`git add <paths>` — never `-A`/`.`). Commit after each task.
- Verify commands run from the worktree root: unit tests `npx vitest run stopFlow`, module typecheck `npx tsc --noEmit -p spacetimedb/tsconfig.json`, app typecheck `npx tsc --noEmit`.

---

### Task 1: Pure module `stopFlow.ts` + unit tests

**Files:**
- Create: `spacetimedb/src/stopFlow.ts`
- Test: `spacetimedb/__tests__/stopFlow.test.ts`

**Interfaces:**
- Produces: `STOP_PHASES: readonly ['draw','upkeep','preparation','battle','discard']`, `parseStops(csv: string): string[]`, `serializeStops(list: string[]): string`, `toggleStop(csv: string, phase: string, enabled: boolean): string`, `firstStopInRange(fromIdx: number, toIdx: number, stopsCsv: string, firedCsv: string): string | null`. Consumed by Tasks 3–4 (`import { ... } from './stopFlow'`).

- [ ] **Step 1: Write the failing tests**

Follow the house pattern of `spacetimedb/__tests__/pregameFlow.test.ts` (vitest, imports from `../src/`, file lives outside `spacetimedb/src` so `spacetime publish` never sees the vitest import — copy that file's 3-line comment explaining this).

```ts
import { describe, it, expect } from 'vitest';
// Lives outside spacetimedb/src (the module's tsconfig `include`) so its vitest
// import is never pulled into `spacetime publish`; root vitest still runs it
// via the **/__tests__/** glob.
import {
  STOP_PHASES,
  parseStops,
  serializeStops,
  toggleStop,
  firstStopInRange,
} from '../src/stopFlow';

describe('parseStops / serializeStops', () => {
  it('round-trips a csv', () => {
    expect(parseStops('draw,battle')).toEqual(['draw', 'battle']);
    expect(serializeStops(['draw', 'battle'])).toBe('draw,battle');
  });
  it('empty csv parses to empty list; empty list serializes to empty string', () => {
    expect(parseStops('')).toEqual([]);
    expect(serializeStops([])).toBe('');
  });
  it('drops unknown phases on parse', () => {
    expect(parseStops('draw,bogus,battle')).toEqual(['draw', 'battle']);
  });
  it('serializes in canonical phase order and dedupes', () => {
    expect(serializeStops(['battle', 'draw', 'battle'])).toBe('draw,battle');
  });
});

describe('toggleStop', () => {
  it('adds a phase', () => {
    expect(toggleStop('', 'battle', true)).toBe('battle');
    expect(toggleStop('draw', 'battle', true)).toBe('draw,battle');
  });
  it('removes a phase', () => {
    expect(toggleStop('draw,battle', 'draw', false)).toBe('battle');
  });
  it('is idempotent both ways', () => {
    expect(toggleStop('battle', 'battle', true)).toBe('battle');
    expect(toggleStop('', 'battle', false)).toBe('');
  });
});

describe('firstStopInRange', () => {
  // PHASE indices: draw=0, upkeep=1, preparation=2, battle=3, discard=4
  it('finds the first qualifying stop, in order', () => {
    // draw→discard jump with stops on upkeep AND battle: upkeep wins (E1)
    expect(firstStopInRange(0, 4, 'upkeep,battle', '')).toBe('upkeep');
  });
  it('from is exclusive, to is inclusive', () => {
    expect(firstStopInRange(1, 3, 'upkeep', '')).toBeNull();   // upkeep == from
    expect(firstStopInRange(1, 3, 'battle', '')).toBe('battle'); // battle == to
  });
  it('fired phases are excluded', () => {
    expect(firstStopInRange(0, 4, 'upkeep,battle', 'upkeep')).toBe('battle');
    expect(firstStopInRange(0, 4, 'battle', 'battle')).toBeNull(); // E5
  });
  it('empty stops csv never matches', () => {
    expect(firstStopInRange(0, 4, '', '')).toBeNull();
  });
  it('end-turn range i+1..4 catches a discard stop from battle', () => {
    expect(firstStopInRange(3, 4, 'discard', '')).toBe('discard'); // E2/E15 range
  });
  it('turn-flip / finishPregame draw check uses (-1, 0)', () => {
    expect(firstStopInRange(-1, 0, 'draw', '')).toBe('draw');   // E3, §5.8
    expect(firstStopInRange(-1, 0, 'upkeep', '')).toBeNull();
  });
  it('clamps to the phase list length', () => {
    expect(firstStopInRange(3, 99, 'discard', '')).toBe('discard');
  });
  it('exports the canonical 5-phase order', () => {
    expect([...STOP_PHASES]).toEqual(['draw', 'upkeep', 'preparation', 'battle', 'discard']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/timestes/projects/rtt-phase-stops && npx vitest run stopFlow`
Expected: FAIL — cannot resolve `../src/stopFlow`.

- [ ] **Step 3: Implement**

```ts
/**
 * Phase Stops (opponent-turn priority stops) — pure decision logic.
 * Pure — no ctx, no DB — so the scan/toggle rules are unit-testable and every
 * phase mover (set_phase, end_turn, end_battle, surrender_soul, enter_battle,
 * finishPregame) shares one implementation. See
 * docs/superpowers/specs/2026-08-15-phase-stops-design.md §5/§6.5.
 */

export const STOP_PHASES = ['draw', 'upkeep', 'preparation', 'battle', 'discard'] as const;

export function parseStops(csv: string): string[] {
  if (!csv) return [];
  return csv.split(',').filter((p) => (STOP_PHASES as readonly string[]).includes(p));
}

/** Canonical order + dedupe, so csv comparisons are stable. */
export function serializeStops(list: string[]): string {
  return STOP_PHASES.filter((p) => list.includes(p)).join(',');
}

export function toggleStop(csv: string, phase: string, enabled: boolean): string {
  const current = parseStops(csv);
  if (enabled) return serializeStops([...current, phase]);
  return serializeStops(current.filter((p) => p !== phase));
}

/**
 * First phase strictly after `fromIdx`, up to and including `toIdx`, that is
 * in `stopsCsv` and not in `firedCsv`; null if none. Used by set_phase
 * (toIdx = target), end_turn (toIdx = 4), the battle→discard advance
 * (fromIdx = 3, toIdx = 4), and the turn-flip / finishPregame draw check
 * (fromIdx = -1, toIdx = 0).
 */
export function firstStopInRange(
  fromIdx: number,
  toIdx: number,
  stopsCsv: string,
  firedCsv: string,
): string | null {
  const stops = parseStops(stopsCsv);
  if (stops.length === 0) return null;
  const fired = parseStops(firedCsv);
  const last = Math.min(toIdx, STOP_PHASES.length - 1);
  for (let i = Math.max(fromIdx + 1, 0); i <= last; i++) {
    const phase = STOP_PHASES[i];
    if (stops.includes(phase) && !fired.includes(phase)) return phase;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run stopFlow` — Expected: all PASS. Also run the full unit suite once (`npx vitest run`) to confirm nothing else broke.

- [ ] **Step 5: Commit**

```bash
git add spacetimedb/src/stopFlow.ts spacetimedb/__tests__/stopFlow.test.ts
git commit -m "feat(play): stopFlow pure module for Phase Stops"
```

---

### Task 2: Schema — `TurnStop` + `StopHoldTimeout` tables

**Files:**
- Modify: `spacetimedb/src/schema.ts` (append after `PregameIdleTimeout` at ~line 592, and register both in the `schema({...})` export at ~597–620)

**Interfaces:**
- Produces: `TurnStop` (pk `gameId`), `StopHoldTimeout` (scheduled, index `stop_hold_timeout_game_id`), `setStopHoldTimeoutReducer(reducer)`. Server access: `ctx.db.TurnStop.gameId.find/update/delete`, `ctx.db.StopHoldTimeout.stop_hold_timeout_game_id.filter(gameId)`, `.scheduledId.delete(...)`. Consumed by Tasks 3–5; client tables `tables.TurnStop` / `tables.StopHoldTimeout` after Task 6 regen.

- [ ] **Step 1: Add the two tables** (exact code — matches the `PregameState` pk idiom and the `PregameIdleTimeout` forward-reference idiom; note the repo uses `accessor:` for index names, not `name:`):

```ts
// ---------------------------------------------------------------------------
// 20. TurnStop — Phase Stops (opponent-turn priority stops). One row per game,
//     inserted lazily on the first set_turn_stop call — absence of a row means
//     "no stops, no hold". Deliberately a separate table, NOT Game columns:
//     adding a column would change the game row's BSATN shape and break
//     deployed clients' subscriptions during the publish window (cf. ForgeGame
//     / PregameState above). See
//     docs/superpowers/specs/2026-08-15-phase-stops-design.md.
// ---------------------------------------------------------------------------
export const TurnStop = table(
  { name: 'turn_stop', public: true },
  {
    gameId: t.u64().primaryKey(),
    seat0Stops: t.string().default(''),  // csv of phases seat 0 stops on (fires during seat 1's turn)
    seat1Stops: t.string().default(''),  // csv of phases seat 1 stops on (fires during seat 0's turn)
    holdPhase: t.string().default(''),   // '' | phase currently holding the turn
    firedPhases: t.string().default(''), // csv of phases whose stop already fired this turn; reset at turn flip
  }
);

// ---------------------------------------------------------------------------
// 21. StopHoldTimeout (scheduled table) — 60s liveness backstop for a hold.
//     At most one row per game (delete-then-insert arming). `phase` is a
//     stale-row guard: the handler no-ops unless it matches the live holdPhase.
// ---------------------------------------------------------------------------

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
    phase: t.string(),
  }
);
```

- [ ] **Step 2: Register both** in the `schema({...})` call: add `TurnStop,` and `StopHoldTimeout,` after `PregameIdleTimeout,`.

- [ ] **Step 3: Verify** — `npx tsc --noEmit -p spacetimedb/tsconfig.json` → no errors.

- [ ] **Step 4: Commit**

```bash
git add spacetimedb/src/schema.ts
git commit -m "feat(play): TurnStop + StopHoldTimeout tables"
```

---

### Task 3: Server — stop core: helpers + `set_turn_stop` / `release_turn_stop` / `handle_stop_hold_timeout`

**Files:**
- Modify: `spacetimedb/src/index.ts`

**Interfaces:**
- Consumes: Task 1 exports; Task 2 tables; existing `findPlayerBySender`, `logAction`, `SenderError`, `ScheduleAt`.
- Produces (for Task 4/5): `assertTurnNotHeld(ctx, gameId)`, `scanForStop(ctx, game, fromIdx, toIdx): string | null`, `engageHold(ctx, gameId, phase)`, `clearStopHoldRows(ctx, gameId)`, `applyPhaseTransition(ctx, gameId, actingPlayerId, targetPhase)`.

- [ ] **Step 1: Imports + constant.** Extend the existing `from './schema'` import (index.ts line 3) with `StopHoldTimeout, setStopHoldTimeoutReducer`. Add below the pregameFlow import:

```ts
import { STOP_PHASES, parseStops, toggleStop, firstStopInRange } from './stopFlow';
```

Near the other constants (e.g. next to `PREGAME_IDLE_MICROS`):

```ts
// Phase Stops: how long a hold lasts before the server auto-releases it.
// Liveness backstop (spec §12 — tunable after live play).
const STOP_HOLD_TIMEOUT_MICROS = 60_000_000n; // 60s
```

- [ ] **Step 2: Helpers.** Add after `clearPregameRows` (~index.ts:1228):

```ts
// ---------------------------------------------------------------------------
// Phase Stops helpers (opponent-turn priority stops).
// docs/superpowers/specs/2026-08-15-phase-stops-design.md §5–§6.
// The stopping seat is always the non-active seat; no column stores it.
// ---------------------------------------------------------------------------

// Arm the 60s hold backstop. Delete-then-insert so at most one row exists per
// game (the schedulePregameIdleTimeout idiom — stale rows are otherwise
// indistinguishable at fire time beyond the phase guard).
function armStopHoldTimeout(ctx: any, gameId: bigint, phase: string): void {
  for (const row of ctx.db.StopHoldTimeout.stop_hold_timeout_game_id.filter(gameId)) {
    ctx.db.StopHoldTimeout.scheduledId.delete(row.scheduledId);
  }
  ctx.db.StopHoldTimeout.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + STOP_HOLD_TIMEOUT_MICROS),
    gameId,
    phase,
  });
}

// Lifecycle cleanup: rematch accept + cleanup_stale_games (both branches).
// Without this a hold stranded by a mid-hold game end wedges the rematch —
// the timeout handler early-returns on finished games (spec §6.6).
function clearStopHoldRows(ctx: any, gameId: bigint): void {
  ctx.db.TurnStop.gameId.delete(gameId);
  for (const row of ctx.db.StopHoldTimeout.stop_hold_timeout_game_id.filter(gameId)) {
    ctx.db.StopHoldTimeout.scheduledId.delete(row.scheduledId);
  }
}

// Hold guard for the five blocked reducers (spec §5.4). Card plays never call
// this — the honor system stands.
function assertTurnNotHeld(ctx: any, gameId: bigint): void {
  const stopRow = ctx.db.TurnStop.gameId.find(gameId);
  if (!stopRow || stopRow.holdPhase === '') return;
  const game = ctx.db.Game.id.find(gameId);
  let stopperName = 'your opponent';
  if (game) {
    const stopperSeat = game.currentTurn === 0n ? 1n : 0n;
    for (const p of ctx.db.Player.player_game_id.filter(gameId)) {
      if (p.seat === stopperSeat) stopperName = p.displayName;
    }
  }
  throw new SenderError('The turn is held — waiting on ' + stopperName);
}

// First qualifying stop for a forward movement by the active player's turn
// from index `fromIdx` (exclusive) to `toIdx` (inclusive), or null. Reads the
// NON-ACTIVE seat's stop set — stops apply to the opponent's turn only.
function scanForStop(ctx: any, game: any, fromIdx: number, toIdx: number): string | null {
  const stopRow = ctx.db.TurnStop.gameId.find(game.id);
  if (!stopRow || stopRow.holdPhase !== '') return null;
  const stopsCsv = game.currentTurn === 0n ? stopRow.seat1Stops : stopRow.seat0Stops;
  return firstStopInRange(fromIdx, toIdx, stopsCsv, stopRow.firedPhases);
}

// Engage a hold at `phase`: mark fired, set holdPhase, arm the backstop, log
// STOP_HOLD attributed to the stopping (non-active) player. Callers have
// already moved the game onto `phase`.
function engageHold(ctx: any, gameId: bigint, phase: string): void {
  const stopRow = ctx.db.TurnStop.gameId.find(gameId);
  if (!stopRow) return;
  const game = ctx.db.Game.id.find(gameId);
  if (!game) return;
  ctx.db.TurnStop.gameId.update({
    ...stopRow,
    holdPhase: phase,
    firedPhases: toggleStop(stopRow.firedPhases, phase, true),
  });
  armStopHoldTimeout(ctx, gameId, phase);
  const stopperSeat = game.currentTurn === 0n ? 1n : 0n;
  let stopper: any = null;
  for (const p of ctx.db.Player.player_game_id.filter(gameId)) {
    if (p.seat === stopperSeat) stopper = p;
  }
  logAction(ctx, gameId, stopper ? stopper.id : 0n, 'STOP_HOLD',
    JSON.stringify({ phase, stopperName: stopper ? stopper.displayName : 'Opponent' }),
    game.turnNumber, phase);
}
```

- [ ] **Step 3: New reducers.** Add a `// Phase Stops reducers` section right before the `// Turn / Phase reducers` banner (~index.ts:2498):

```ts
// ---------------------------------------------------------------------------
// Reducer: set_turn_stop
// Toggle the caller's stop marker for a phase of the OPPONENT's turn. Lazy
// row insert; toggles are never logged (they'd leak intent — spec §6.1).
// status 'playing' includes the star/soul pregame (pregamePhase !== ''),
// which deliberately lets players prep turn-1 stops; holds cannot engage
// mid-pregame because every phase mover throws during pregame.
// ---------------------------------------------------------------------------
export const set_turn_stop = spacetimedb.reducer(
  { gameId: t.u64(), phase: t.string(), enabled: t.bool() },
  (ctx, { gameId, phase, enabled }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');
    if (!(STOP_PHASES as readonly string[]).includes(phase)) {
      throw new SenderError('Invalid phase: ' + phase);
    }

    let stopRow = ctx.db.TurnStop.gameId.find(gameId);
    if (!stopRow) {
      stopRow = ctx.db.TurnStop.insert({
        gameId, seat0Stops: '', seat1Stops: '', holdPhase: '', firedPhases: '',
      });
    }

    const isSeat0 = player.seat === 0n;
    const updated: any = {
      ...stopRow,
      seat0Stops: isSeat0 ? toggleStop(stopRow.seat0Stops, phase, enabled) : stopRow.seat0Stops,
      seat1Stops: isSeat0 ? stopRow.seat1Stops : toggleStop(stopRow.seat1Stops, phase, enabled),
    };

    // Removing the stop you are currently holding on is a "never mind" — it
    // must also release the hold or the game wedges behind it (spec §6.1, E6).
    const callerIsNonActive = player.seat !== game.currentTurn;
    if (!enabled && callerIsNonActive && stopRow.holdPhase === phase) {
      updated.holdPhase = '';
      for (const row of ctx.db.StopHoldTimeout.stop_hold_timeout_game_id.filter(gameId)) {
        ctx.db.StopHoldTimeout.scheduledId.delete(row.scheduledId);
      }
      logAction(ctx, gameId, player.id, 'STOP_RELEASE',
        JSON.stringify({ phase, reason: 'toggle-off' }),
        game.turnNumber, game.currentPhase);
    }

    ctx.db.TurnStop.gameId.update(updated);
  }
);

// ---------------------------------------------------------------------------
// Reducer: release_turn_stop ("Pass")
// Only the stopping (non-active) seat may release — the active player cannot
// dismiss their opponent's window (spec §6.2).
// ---------------------------------------------------------------------------
export const release_turn_stop = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    const stopRow = ctx.db.TurnStop.gameId.find(gameId);
    if (!stopRow || stopRow.holdPhase === '') {
      throw new SenderError('No stop is holding the turn');
    }
    if (player.seat === game.currentTurn) {
      throw new SenderError('Only the stopping player can release the hold');
    }
    const releasedPhase = stopRow.holdPhase;
    ctx.db.TurnStop.gameId.update({ ...stopRow, holdPhase: '' });
    for (const row of ctx.db.StopHoldTimeout.stop_hold_timeout_game_id.filter(gameId)) {
      ctx.db.StopHoldTimeout.scheduledId.delete(row.scheduledId);
    }
    logAction(ctx, gameId, player.id, 'STOP_RELEASE',
      JSON.stringify({ phase: releasedPhase, reason: 'manual' }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Scheduled reducer: handle_stop_hold_timeout
// Defensive early-returns, never throws (the handle_pregame_idle_timeout
// pattern). `arg.phase` mismatch = stale row → no-op. The scheduled row
// self-deletes after the reducer runs.
// ---------------------------------------------------------------------------
export const handle_stop_hold_timeout = spacetimedb.reducer(
  { arg: StopHoldTimeout.rowType },
  (ctx, { arg }) => {
    const game = ctx.db.Game.id.find(arg.gameId);
    if (!game) return;
    if (game.status !== 'playing') return;
    const stopRow = ctx.db.TurnStop.gameId.find(arg.gameId);
    if (!stopRow || stopRow.holdPhase === '') return;
    if (stopRow.holdPhase !== arg.phase) return;
    ctx.db.TurnStop.gameId.update({ ...stopRow, holdPhase: '' });
    logAction(ctx, arg.gameId, 0n, 'STOP_RELEASE',
      JSON.stringify({ phase: arg.phase, reason: 'timeout' }),
      game.turnNumber, game.currentPhase);
  }
);

setStopHoldTimeoutReducer(handle_stop_hold_timeout);
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit -p spacetimedb/tsconfig.json` clean; `npx vitest run` still green.

- [ ] **Step 5: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "feat(play): Phase Stops core reducers + hold helpers"
```

---

### Task 4: Server — wire the seven phase movers

**Files:**
- Modify: `spacetimedb/src/index.ts` — `set_phase` (~2505), `end_turn` (~2563), `end_battle` (~2890), `resolve_battle` (~3126), `surrender_soul` (~3170), `enter_battle` (~3013), `finishPregame` (~1187)

**Interfaces:**
- Consumes: Task 3 helpers; Task 1 `STOP_PHASES`/`parseStops`/`firstStopInRange`.
- Produces: `applyPhaseTransition(ctx, gameId, actingPlayerId, targetPhase)` — extracted shared phase-write path.

- [ ] **Step 1: Extract `applyPhaseTransition`.** Add just above `set_phase`:

```ts
// ---------------------------------------------------------------------------
// Helper: applyPhaseTransition
// The single phase-write path shared by set_phase and the Phase Stops snaps.
// Runs the leave-battle auto-return and enter-battle band-open side effects,
// writes currentPhase, logs SET_PHASE — exactly what a direct phase click
// does, so a stop-snap is indistinguishable from the player clicking P.
// ---------------------------------------------------------------------------
function applyPhaseTransition(ctx: any, gameId: bigint, actingPlayerId: bigint, targetPhase: string): void {
  let game = ctx.db.Game.id.find(gameId);
  if (!game) return;
  const oldPhase = game.currentPhase;

  // Leaving battle auto-closes any open band; runBattleAutoReturn writes the
  // Game row, so re-read before the currentPhase write below (stale-spread
  // hazard — same comment as the original set_phase body).
  if (oldPhase === 'battle' && targetPhase !== 'battle' && game.battleState !== '') {
    runBattleAutoReturn(ctx, gameId, actingPlayerId);
    game = ctx.db.Game.id.find(gameId) ?? game;
  }

  if (targetPhase === 'battle' && oldPhase !== 'battle' && game.battleState === '') {
    // Entering the battle phase opens the band — same step enter_battle
    // performs when the band starts closed.
    ctx.db.Game.id.update({
      ...game,
      currentPhase: targetPhase,
      battleState: 'active',
      battleAttackerSeat: game.currentTurn.toString(),
      lastBattlePlayBySeat: '',
    });
  } else {
    ctx.db.Game.id.update({ ...game, currentPhase: targetPhase });
  }

  logAction(ctx, gameId, actingPlayerId, 'SET_PHASE', JSON.stringify({ phase: targetPhase }), game.turnNumber, targetPhase);
}
```

- [ ] **Step 2: Rewrite `set_phase`'s body** to use it. Keep the existing guards (pregame, `'Not your turn'`, whitelist) verbatim, then REPLACE everything from `const oldPhase = game.currentPhase;` to the closing `logAction` with:

```ts
    // Phase Stops: refuse any movement while a hold is active (spec §5.4),
    // then scan forward movement for the first unfired stop (spec §5.1–5.2).
    assertTurnNotHeld(ctx, gameId);

    const oldIdx = (STOP_PHASES as readonly string[]).indexOf(game.currentPhase);
    const newIdx = (STOP_PHASES as readonly string[]).indexOf(phase);
    let stopPhase: string | null = null;
    if (newIdx > oldIdx) {
      stopPhase = scanForStop(ctx, game, oldIdx, newIdx);
    }

    applyPhaseTransition(ctx, gameId, player.id, stopPhase ?? phase);
    if (stopPhase !== null) engageHold(ctx, gameId, stopPhase);
```

(The `validPhases` whitelist check stays; `assertTurnNotHeld` goes immediately after the `'Not your turn'` guard.)

- [ ] **Step 3: Wire `end_turn`.** Immediately after its `'Not your turn'` guard add `assertTurnNotHeld(ctx, gameId);`. Then, right after the existing auto-return block (`runBattleAutoReturn` + re-read, ~2587–2590), insert the scan — a hit snaps and holds WITHOUT ending the turn (spec §5.3, E2):

```ts
    // Phase Stops: a stop in the remaining phases snaps the turn there
    // instead of ending it — End Turn must be pressed again after release
    // (spec §5.3). The auto-return above already closed any open band.
    const endTurnFromIdx = (STOP_PHASES as readonly string[]).indexOf(game.currentPhase);
    const endTurnStop = scanForStop(ctx, game, endTurnFromIdx, 4);
    if (endTurnStop !== null) {
      applyPhaseTransition(ctx, gameId, player.id, endTurnStop);
      engageHold(ctx, gameId, endTurnStop);
      return;
    }
```

Then, at the END of the reducer (after the existing `logAction(... 'END_TURN' ...)`), add the fired-reset + turn-start draw check (spec §5.3; both no-op when no `TurnStop` row exists — no eager insert):

```ts
    // Phase Stops: fired stops reset at every successful flip; then the NEW
    // non-active seat (the caller) may have a draw stop — their 3 cards are
    // already drawn, the hold sits between the draw and any advance (E3).
    const stopRow = ctx.db.TurnStop.gameId.find(gameId);
    if (stopRow) {
      ctx.db.TurnStop.gameId.update({ ...stopRow, firedPhases: '' });
      const newNonActiveStops = nextSeat === 0n ? stopRow.seat1Stops : stopRow.seat0Stops;
      if (firstStopInRange(-1, 0, newNonActiveStops, '') !== null) {
        engageHold(ctx, gameId, 'draw');
      }
    }
```

- [ ] **Step 4: Wire `end_battle`.** After its `findPlayerBySender` line add `assertTurnNotHeld(ctx, gameId);`. In the `isTurnPlayer && wasBattlePhase` branch, after the existing `currentPhase: 'discard'` write + SET_PHASE log, add:

```ts
        // Phase Stops: battle→discard is forward movement — an unfired discard
        // stop lands the game on discard HELD (spec §5.7, E15). The battle
        // itself already concluded above.
        const stopPhase = scanForStop(ctx, latest, 3, 4);
        if (stopPhase !== null) engageHold(ctx, gameId, stopPhase);
```

- [ ] **Step 5: Wire `resolve_battle`.** After its `findPlayerBySender` line (before the battleState guard is fine either way — keep guard order: game, status, battleState already exist; add the hold guard right after `findPlayerBySender`): `assertTurnNotHeld(ctx, gameId);`

- [ ] **Step 6: Wire `surrender_soul`.** After `findPlayerBySender`: `assertTurnNotHeld(ctx, gameId);`. In its final `if (latestGame && latestGame.currentPhase === 'battle')` branch, after the write + SET_PHASE log, add the same two-line scan+engage as Step 4 (using `latestGame`):

```ts
      const stopPhase = scanForStop(ctx, latestGame, 3, 4);
      if (stopPhase !== null) engageHold(ctx, gameId, stopPhase);
```

- [ ] **Step 7: Wire `enter_battle`** (band-open rule, spec §5.7/E16 — NOT hold-guarded; blocking during a hold is legal). Replace the `if (game.battleState === '')` write block with:

```ts
    // Phase Stops band-open rule (spec §5.7): opening the band IS the attack
    // starting. Turn-player open + opponent has an unfired battle stop +
    // phase hasn't passed battle → snap currentPhase to battle (skipping
    // set_phase's enter-battle side effect — the band-open below IS it),
    // engage the hold after the open, and let the attacker's card commit.
    // Non-turn-player calls (blocking, joining) never trigger stops.
    let engageBattleStop = false;
    if (game.battleState === '') {
      if (player.seat === game.currentTurn && game.pregamePhase === '') {
        const stopRow = ctx.db.TurnStop.gameId.find(gameId);
        if (stopRow && stopRow.holdPhase === '') {
          const stopsCsv = game.currentTurn === 0n ? stopRow.seat1Stops : stopRow.seat0Stops;
          const curIdx = (STOP_PHASES as readonly string[]).indexOf(game.currentPhase);
          const battleIdx = (STOP_PHASES as readonly string[]).indexOf('battle');
          if (
            curIdx <= battleIdx &&
            parseStops(stopsCsv).includes('battle') &&
            !parseStops(stopRow.firedPhases).includes('battle')
          ) {
            engageBattleStop = true;
          }
        }
      }
      ctx.db.Game.id.update({
        ...game,
        currentPhase: engageBattleStop ? 'battle' : game.currentPhase,
        battleState: 'active',
        battleAttackerSeat: game.currentTurn.toString(),
        lastBattlePlayBySeat: '',
      });
    }
    // battleState === 'active': band already open — just move+stamp below.
```

Then after the existing `logAction(... 'ENTER_BATTLE' ...)` at the end of the reducer:

```ts
    if (engageBattleStop) engageHold(ctx, gameId, 'battle');
```

- [ ] **Step 8: Wire `finishPregame`** (spec §5.8): after the existing `logAction(... 'GAME_STARTED' ...)` add:

```ts
  // Phase Stops: turn 1 starts here (no end_turn runs), so run the same
  // turn-start draw-stop check as the turn flip. A draw stop toggled during
  // the star/soul pregame fires at the top of turn 1.
  const stopRow = ctx.db.TurnStop.gameId.find(gameId);
  if (stopRow) {
    const stopsCsv = game.currentTurn === 0n ? stopRow.seat1Stops : stopRow.seat0Stops;
    if (firstStopInRange(-1, 0, stopsCsv, stopRow.firedPhases) !== null) {
      engageHold(ctx, gameId, 'draw');
    }
  }
```

- [ ] **Step 9: Verify** — `npx tsc --noEmit -p spacetimedb/tsconfig.json` clean; `npx vitest run` green. Re-read each modified reducer top-to-bottom checking: (a) no stale-`game`-snapshot spread after a helper that writes the Game row, (b) `assertTurnNotHeld` present in exactly the five blocked reducers and absent from `enter_battle`.

- [ ] **Step 10: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "feat(play): Phase Stops wired into all seven phase movers"
```

---

### Task 5: Server — lifecycle (rematch + cleanup)

**Files:**
- Modify: `spacetimedb/src/index.ts` — `respond_rematch` accept branch (~1502–1615), `cleanup_stale_games` (~2455–2491)

**Interfaces:** Consumes `clearStopHoldRows` from Task 3.

- [ ] **Step 1:** In `respond_rematch`'s accept branch, next to the in-place reset (right before the `logAction(... 'REMATCH_STARTED' ...)`), add:

```ts
      // Phase Stops: rematch reuses the same gameId (in-place reset), so the
      // stop/hold rows must be cleared here or a hold stranded by a mid-hold
      // concede/win wedges the next game (spec §6.6, E11). This is what
      // enforces "all stops off each game."
      clearStopHoldRows(ctx, gameId);
```

- [ ] **Step 2:** In `cleanup_stale_games`, add `clearStopHoldRows(ctx, game.id);` beside the existing `clearPregameRows(ctx, game.id);` in the abandon branch (~2458), and `clearStopHoldRows(ctx, gameId);` beside `clearPregameRows(ctx, gameId);` in the delete branch (~2490).

- [ ] **Step 3: Verify** — `npx tsc --noEmit -p spacetimedb/tsconfig.json`; `npx vitest run`.

- [ ] **Step 4: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "feat(play): clear Phase Stops rows on rematch + stale-game cleanup"
```

---

### Task 6: Publish dev module + regenerate client bindings

**Files:**
- Modify (generated): `lib/spacetimedb/module_bindings/**`

**Interfaces:**
- Produces: `tables.TurnStop`, `tables.StopHoldTimeout`, `conn.reducers.setTurnStop({gameId, phase, enabled})`, `conn.reducers.releaseTurnStop({gameId})` for Tasks 7–10.

- [ ] **Step 1:** From the worktree root, publish the DEV module (never prod) and regenerate bindings — the `spacetimedb-deploy` skill's exact commands:

```bash
cd /Users/timestes/projects/rtt-phase-stops
echo "y" | spacetime publish redemption-multiplayer-dev --module-path "$(pwd)/spacetimedb" --no-config --server maincloud
spacetime generate --lang typescript --out-dir lib/spacetimedb/module_bindings --module-path spacetimedb
```

(Additive schema — NO `--clear`. If publish fails on auth, run `spacetime generate` alone — bindings are what the client tasks need; CI publishes dev automatically on branch push anyway.)

- [ ] **Step 2: Verify** — `grep -rl "TurnStop" lib/spacetimedb/module_bindings | head` shows generated files; `npx tsc --noEmit` (root) still clean.

- [ ] **Step 3: Commit**

```bash
git add lib/spacetimedb/module_bindings
git commit -m "chore(play): regenerate bindings for Phase Stops tables/reducers"
```

---

### Task 7: Client — `useGameState` + `useSpectatorGameState`

**Files:**
- Modify: `app/play/hooks/useGameState.ts`

**Interfaces:**
- Consumes: Task 6 bindings.
- Produces (added to `GameState` interface AND both hooks' return objects):
  - `myStops: string[]` — viewer's own stop phases (spectator: always `[]`)
  - `holdPhase: string` — `''` = no hold
  - `holdSeat: bigint | null` — non-active seat while holding, else null
  - `holdDeadlineMicros: bigint | null` — from the timeout row's `scheduledAt`
  - `setTurnStop: (phase: string, enabled: boolean) => void`
  - `releaseTurnStop: () => void`

- [ ] **Step 1: Subscriptions in `useGameState`** — add after the `pregameStarRows` hook (~line 252), same `.where` predicate-on-the-hook pattern (subscription-SQL-only filtering leaks stale rows from the shared refcounted cache):

```ts
  const [turnStopRows] = useTable(
    tables.TurnStop.where((r) => r.gameId.eq(gameId)),
  ) as [any[], boolean];
  const [stopHoldTimeoutRows] = useTable(
    tables.StopHoldTimeout.where((r) => r.gameId.eq(gameId)),
  ) as [any[], boolean];
```

- [ ] **Step 2: Derived state** — add near the other derived `useMemo`s (after `isMyTurn`):

```ts
  // ---- Phase Stops (opponent-turn priority stops) ----
  const turnStopRow = turnStopRows[0] ?? null;

  const myStops = useMemo(() => {
    if (!turnStopRow || !myPlayer) return [] as string[];
    const csv: string = myPlayer.seat === 0n ? turnStopRow.seat0Stops : turnStopRow.seat1Stops;
    return csv ? csv.split(',') : [];
  }, [turnStopRow, myPlayer]);

  const holdPhase: string = turnStopRow?.holdPhase ?? '';

  // The holding seat is always the non-active seat.
  const holdSeat = useMemo(() => {
    if (!game || holdPhase === '') return null;
    return game.currentTurn === 0n ? 1n : 0n;
  }, [game, holdPhase]);

  const holdDeadlineMicros = useMemo(() => {
    if (holdPhase === '') return null;
    const row = stopHoldTimeoutRows[0];
    if (!row) return null;
    const sched: any = row.scheduledAt;
    if (sched?.tag !== 'Time') return null;
    return sched.value.microsSinceUnixEpoch as bigint;
  }, [stopHoldTimeoutRows, holdPhase]);
```

- [ ] **Step 3: Reducer wrappers** — next to `setPhase`/`endTurn` (~650):

```ts
  const setTurnStop = useCallback(
    (phase: string, enabled: boolean) => {
      conn?.reducers.setTurnStop({ gameId, phase, enabled });
    },
    [conn, gameId],
  );

  const releaseTurnStop = useCallback(() => {
    conn?.reducers.releaseTurnStop({ gameId });
  }, [conn, gameId]);
```

- [ ] **Step 4: Interface + returns.** Add the six fields to the `GameState` interface (typed as in Interfaces above, with a `/** Phase Stops */` comment block) and to `useGameState`'s return object.

- [ ] **Step 5: Spectator hook.** In `useSpectatorGameState` (~1137): add the SAME two `useTable` subscriptions (using `effectiveGameId`), the same `holdPhase`/`holdSeat`/`holdDeadlineMicros` derivations (spectator renders holds — spec §8.4), and return `myStops: []`, `setTurnStop` as a noop `useCallback((_p: string, _e: boolean) => {}, [])`, `releaseTurnStop: noop` (reuse its existing noop consts idiom at ~1313).

- [ ] **Step 6: Verify** — `npx tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add app/play/hooks/useGameState.ts
git commit -m "feat(play): Phase Stops state + wrappers in game/spectator hooks"
```

---

### Task 8: Client — `TurnIndicator` stop markers, toggling, hold UI

**Files:**
- Modify: `app/play/components/TurnIndicator.tsx`

**Interfaces:**
- Consumes: nothing new at runtime — all data arrives via props.
- Produces new optional props (wired by Tasks 9–10):

```ts
  /** Phase Stops: phases of the opponent's turn the VIEWER has a stop on. */
  myStops?: string[];
  /** Phase Stops: phase currently holding the turn ('' = no hold). */
  holdPhase?: string;
  /** Phase Stops: server deadline (micros since epoch) when the hold auto-releases. */
  holdDeadlineMicros?: bigint | null;
  /** Phase Stops: toggle the viewer's stop for a phase (non-active player only). */
  onToggleStop?: (phase: string, enabled: boolean) => void;
  /** Phase Stops: release the viewer's active hold ("Pass"). */
  onReleaseStop?: () => void;
```

Design notes (spec §8.1): dot marker = viewer's own stops only, rendered inside the phase button (must not disturb the sliding-pill `activeBounds` measurement); held phase gets an amber pulsing treatment; the stopping player gets a PASS button in the End Turn slot with countdown; the active player's five phase buttons + both arrows + End Turn all disable during a hold. Import `showGameToast` from `@/app/shared/components/GameToast` for toggle feedback (mobile-first — tooltips don't exist on touch).

- [ ] **Step 1: Props + derivations.** Add the five props to `TurnIndicatorProps` and the destructure (`myStops = []`, `holdPhase = ''`, `holdDeadlineMicros = null`). Below `isLastPhase` add:

```ts
  // ---- Phase Stops ----
  const isHeld = holdPhase !== '';
  // The hold always belongs to the non-active seat, so on this client:
  // active player → "held against me"; non-active player → "I am the holder".
  const iAmHolder = isHeld && !isMyTurn && !readOnly;
  const heldAgainstMe = isHeld && isMyTurn && !readOnly;
  const canToggleStops = !isMyTurn && !readOnly && !pregameStep && !isFinished;

  // Countdown — recomputed from the server deadline each tick (reconnect-safe;
  // ScheduleAt timestamps are objects, micros → ms via Number(x / 1000n)).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isHeld) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isHeld]);
  const holdSecondsLeft =
    isHeld && holdDeadlineMicros != null
      ? Math.max(0, Math.ceil((Number(holdDeadlineMicros / 1000n) - nowMs) / 1000))
      : null;

  const handleToggleStop = (phase: string) => {
    if (!canToggleStops || !onToggleStop) return;
    const enabling = !myStops.includes(phase);
    onToggleStop(phase, enabling);
    showGameToast(
      enabling
        ? `Stop set: ${PHASE_LABELS[phase]}. ${opponentName}'s turn will pause there — tap again to remove.`
        : `Stop removed: ${PHASE_LABELS[phase]}.`,
    );
  };
```

(`useEffect` is already imported; add `showGameToast` import at top.)

- [ ] **Step 2: Phase buttons** (the `PHASE_ORDER.map` at ~718). Rework the click/disable logic — own-turn jump behavior unchanged, opponent-turn taps toggle stops, everything locks while held:

```ts
            const isActive = phase === currentPhase;
            const canClick = isMyTurn && !isActive && !heldAgainstMe;
            const isHeldPhase = isHeld && phase === holdPhase;
            const hasMyStop = myStops.includes(phase);
```

- `onClick`: `() => { if (readOnly) return; if (canToggleStops) { handleToggleStop(phase); return; } if (canClick) onSetPhase(phase); }`
- `disabled`: `readOnly || (!canToggleStops && !isMyTurn) || heldAgainstMe` — i.e. clickable when it's my turn (not held) OR when I can toggle stops.
- `title`: `canToggleStops ? (hasMyStop ? \`Remove stop on ${PHASE_LABELS[phase]}\` : \`Stop here on ${opponentName}'s turn\`) : PHASE_LABELS[phase]`
- `cursor`: pointer when `canClick || canToggleStops`.
- Held-phase amber treatment on the button style: when `isHeldPhase`, add `border: '1px solid rgba(245, 158, 11, 0.7)'` and `color: '#fbbf24'` (overriding the color ternary).
- Inside the button, after the label, render the marker dot (part of the button so `activeBounds` still measures the button itself):

```tsx
                {(hasMyStop || isHeldPhase) && (
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      bottom: -1,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: isHeldPhase ? '#fbbf24' : '#c4955a',
                      boxShadow: isHeldPhase ? '0 0 6px rgba(245, 158, 11, 0.9)' : '0 0 4px rgba(196, 149, 90, 0.7)',
                      animation: isHeldPhase ? 'stopHoldPulse 1s ease-in-out infinite' : undefined,
                    }}
                  />
                )}
```

Add once, near the component's root `<div>`, a `<style>` tag defining the pulse:

```tsx
      <style>{`@keyframes stopHoldPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }`}</style>
```

- [ ] **Step 3: Arrows.** Both arrow buttons additionally disable during `heldAgainstMe`: add `|| heldAgainstMe` to each `disabled` expression and to the guard inside `handlePrevPhase`/`handleNextPhase` (early-return when `heldAgainstMe`), and to their hover-color guards.

- [ ] **Step 4: End Turn slot.** Replace the End Turn button block (~786) with a three-way render:
  1. `iAmHolder` → PASS button (amber): `onClick={onReleaseStop}`, label `` `Pass${holdSecondsLeft != null ? ` · ${holdSecondsLeft}s` : ''}` ``, `title="Your stop — act, then pass."` Style: same shape as End Turn but `background: 'rgba(245, 158, 11, 0.15)'`, `border: '1px solid rgba(245, 158, 11, 0.6)'`, `color: '#fbbf24'`.
  2. otherwise → the existing End Turn button, with `disabled={!isMyTurn || heldAgainstMe}` and when `heldAgainstMe`: label `` `Held${holdSecondsLeft != null ? ` · ${holdSecondsLeft}s` : ''}` `` and `title={\`Held — ${opponentName} stopped at ${PHASE_LABELS[holdPhase] ?? holdPhase}\`}`.
  Keep the `!readOnly && !pregameStep` outer condition on the whole slot.

- [ ] **Step 5: Verify** — `npx tsc --noEmit` clean. Read the diff top-to-bottom confirming: readOnly (spectator) never gets toggles or PASS but DOES get the amber held-phase treatment + countdown (marker dot suppressed since `myStops` stays `[]`/undefined for spectators).

- [ ] **Step 6: Commit**

```bash
git add app/play/components/TurnIndicator.tsx
git commit -m "feat(play): stop markers, toggling, and hold UI on the phase bar"
```

---

### Task 9: Client — `client.tsx` wiring, `GameToolbar`, `ChatPanel` log types

**Files:**
- Modify: `app/play/[code]/client.tsx` (TurnIndicator props ~1804; GameToolbar props ~1857+)
- Modify: `app/shared/components/GameToolbar.tsx` (the SHARED one — the goldfish file of the same name is untouched)
- Modify: `app/play/components/ChatPanel.tsx` (action-type map ~95–143; `formatActionType` ~172)

**Interfaces:**
- Consumes: Task 7 `GameState` fields, Task 8 props, new `GameToolbar` prop `isTurnHeld?: boolean`.

- [ ] **Step 1: TurnIndicator props in client.tsx** — add to the playing-branch `<TurnIndicator ...>`:

```tsx
            myStops={gameState.myStops}
            holdPhase={gameState.holdPhase}
            holdDeadlineMicros={gameState.holdDeadlineMicros}
            onToggleStop={gameState.setTurnStop}
            onReleaseStop={gameState.releaseTurnStop}
```

- [ ] **Step 2: GameToolbar prop.** In `GameToolbar.tsx` add to `GameToolbarProps`:

```ts
  /** Phase Stops: a hold is freezing turn progression (multiplayer only).
   *  Disables End Turn for the active player and hides Priority for the
   *  holder — requesting a window you already hold is noise. */
  isTurnHeld?: boolean;
```

In the far-right button block (~202–217): End Turn entry gains `disabled: !!isTurnHeld`; the Priority branch condition becomes `isMultiplayer && !isMyTurn && !isFinished && !isTurnHeld`. In `client.tsx`, pass `isTurnHeld={gameState.holdPhase !== ''}` to the playing-branch `<GameToolbar>`.

- [ ] **Step 3: ChatPanel.** Add fallback map entries (after the battle-action entries):

```ts
  // Phase Stops — payloads rendered in formatActionType; these are the
  // parse-failure fallbacks.
  STOP_HOLD: 'stopped the turn',
  STOP_RELEASE: 'passed',
```

Add to `formatActionType` (same try/parse/fall-through idiom as `ROLL_DICE`):

```ts
  if (actionType === 'STOP_HOLD' && payload) {
    try {
      const data = JSON.parse(payload);
      const label = typeof data.phase === 'string' && data.phase
        ? data.phase.charAt(0).toUpperCase() + data.phase.slice(1)
        : 'a phase';
      return `⏸ stopped the turn at ${label}`;
    } catch { /* fall through */ }
  }
  if (actionType === 'STOP_RELEASE' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.reason === 'timeout') return '▶ stop timed out — turn resumes';
      return '▶ passed — turn resumes';
    } catch { /* fall through */ }
  }
```

(`STOP_RELEASE` with `reason: 'timeout'` is logged with playerId `0n`; check how ChatPanel renders an unknown-actor row for existing `PREGAME_IDLE_SKIP` — which also logs `0n` — and follow that exact precedent for the name prefix.)

- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add "app/play/[code]/client.tsx" app/shared/components/GameToolbar.tsx app/play/components/ChatPanel.tsx
git commit -m "feat(play): wire Phase Stops through client, toolbar, and action log"
```

---

### Task 10: Spectator wiring

**Files:**
- Modify: `app/play/spectate/[code]/client.tsx` (TurnIndicator at ~532–550)

**Interfaces:** Consumes Task 7 spectator-hook fields + Task 8 props.

- [ ] **Step 1:** Add to the spectator `<TurnIndicator readOnly ...>`:

```tsx
                  holdPhase={gameState.holdPhase}
                  holdDeadlineMicros={gameState.holdDeadlineMicros}
```

(No `myStops`/`onToggleStop`/`onReleaseStop` — spectators see holds, never markers or toggles; `readOnly` already suppresses the interactive paths.)

- [ ] **Step 2: Verify** — `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit**

```bash
git add "app/play/spectate/[code]/client.tsx"
git commit -m "feat(play): spectators render Phase Stops holds"
```

---

### Task 11: E2E spec

**Files:**
- Create: `e2e/play/phaseStops.spec.ts`
- Reference (read first): `e2e/play/pregameStarPhase.spec.ts` (two-browser harness, session minting, game setup), the repo `verify` skill notes.

- [ ] **Step 1:** Following `pregameStarPhase.spec.ts`'s harness verbatim (auth minting, two contexts, game create/join, pregame fast-forward), write these scenarios (spec §10):
  1. **Battle stop end-to-end:** non-active player clicks the Battle phase button (toggles stop; assert the marker dot appears) → active player advances draw→battle via the phase bar → assert hold UI (amber phase + PASS button on the non-active client; "Held" End Turn on the active client) → active player clicks End Turn → assert the error toast ("The turn is held") and phase unchanged → non-active clicks PASS → active ends turn successfully.
  2. **E3 draw stop at flip:** player A sets a draw stop, then ends their own turn → assert hold engages at B's draw with A as holder (PASS visible on A's client).
  3. **E6 toggle-off releases:** engage a hold as in (1), holder taps the held phase button (toggle off) → assert hold clears and the active player can advance.
  4. **E16 band-open:** non-active sets a battle stop; active player drags an attacker into the band during preparation (use the Konva drive helpers from `e2e` utils per `reference_multiplayer_konva_e2e_driving`) → assert phase snapped to battle + hold engaged + attacker's card is in the band.
- [ ] **Step 2:** Attempt a run: `npx playwright test e2e/play/phaseStops.spec.ts` with the dev server running and the dev module published (Task 6). Known environment risks: localhost→dev-module WebSocket connects can stall; no CI runs e2e. If the run is blocked by infrastructure (not by the feature), record the exact failure output and report it honestly in the PR as "e2e written, run blocked by X" — do NOT claim it passed.
- [ ] **Step 3: Commit**

```bash
git add e2e/play/phaseStops.spec.ts
git commit -m "test(play): Phase Stops two-browser e2e"
```

---

### Task 12: Full verification + PR

- [ ] **Step 1:** `npx vitest run` — all unit tests pass.
- [ ] **Step 2:** `npx tsc --noEmit -p spacetimedb/tsconfig.json` and `npx tsc --noEmit` — both clean.
- [ ] **Step 3:** `npm run build` — production build succeeds (worktree has no dev server, plain build is safe).
- [ ] **Step 4:** Push and open the PR:

```bash
git push -u origin feat/phase-stops
gh pr create --base main --title "feat(play): Phase Stops — opponent-turn priority stops" --body "<summary per template below>"
```

PR body must include: spec link, the state machine one-liner, the seven wired phase movers, lifecycle clearing (rematch/cleanup), client surfaces, test evidence (vitest/tsc/build output summaries), e2e status (honest), and the two pre-merge manual items from spec §11: (a) new-client-vs-stale-module session (E10), (b) pair the merge with a Vercel deploy since CI publishes prod on merge.

---

## Self-Review (completed)

- **Spec coverage:** §4 → Task 2; §5.1–5.6 → Tasks 3–4; §5.7 → Task 4 steps 4/6/7; §5.8 → Task 4 step 8; §6.1–6.3 → Task 3; §6.4 → Task 4; §6.5 → Task 1; §6.6 → Task 5; §7 → Tasks 3 (logging) + 9 (rendering); §8.1 → Task 8; §8.2 → Task 7; §8.3 → Task 9; §8.4 → Task 10; §10 → Tasks 1 + 11; §11 → Tasks 6 + 12.
- **Type consistency:** `setTurnStop(phase: string, enabled: boolean)` / `releaseTurnStop()` / `myStops: string[]` / `holdPhase: string` / `holdDeadlineMicros: bigint | null` consistent across Tasks 7–10; server helper names consistent across Tasks 3–5.
- **Known simplifications:** `holdSeat` is exposed by the hooks but not consumed by TurnIndicator (holder-ness derives from `isMyTurn`); kept because the spec names it and spectate may want it later — cheap, derived, no dead reducer surface.
