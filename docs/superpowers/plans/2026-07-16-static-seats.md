# Static Seats & Seat-Numbering Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hosts can pin a participant to a static table (or chair, in seat-numbering mode); every pairing generation places that player's match at their pin, with deterministic conflict handling.

**Architecture:** Pure post-pairing assignment function (`assignTables`) in `lib/tournament/`, persisted to a new `matches.table_number` column by all three match-writing paths (createPairing, regenerate RPC, repair handlers). Display and print read the persisted number with an index-math fallback for legacy rounds. Spec: `docs/superpowers/specs/2026-07-15-static-seats-design.md`.

**Tech Stack:** Next.js 15 / React 19 / TypeScript (strict:false), Supabase (Postgres + RLS), vitest.

## Global Constraints

- All work in the worktree `/Users/timestes/projects/rtt-seats` on branch `feat/static-seats`. Use absolute paths. Never touch `/Users/timestes/projects/redemption-tournament-tracker` (a sibling agent owns it).
- `git add` only the specific files you changed — never `-A`/`.`.
- tsconfig has `strict: false`: union narrowing via `if (x.ok)` does not narrow — use explicit comparisons (`=== null`, `=== "seats"`).
- No `focus:ring-2 focus:ring-ring` on form controls (project convention).
- Type gate is `npx tsc --noEmit -p tsconfig.json` (pre-existing errors exist in `__tests__/forge-anon-leak.test.ts` and `app/forge/lib/__tests__/playDecksAuthorize.test.ts` — ignore those two files only).
- Tests: `npx vitest run <path>` (vitest, not jest).
- Seat math: table *k* ↔ seats *2k−1* (player1 chair) and *2k* (player2 chair). A pin is a table number in `tables` mode, a seat number in `seats` mode.

---

### Task 1: Migration `078_static_seats.sql`

**Files:**
- Create: `supabase/migrations/078_static_seats.sql`

**Interfaces:**
- Consumes: existing `regenerate_current_round_pairings` definition (migration 036).
- Produces: columns `tournaments.numbering_mode`, `participants.assigned_seat`, `matches.table_number`; RPC now inserts `table_number` from each `p_pairings` element (JSON key `table_number`, may be absent → NULL).

- [ ] **Step 1: Write the migration file**

```sql
-- Static seats & seat-numbering mode.
-- Spec: docs/superpowers/specs/2026-07-15-static-seats-design.md
--
-- 1. tournaments.numbering_mode: 'tables' (default, current behavior) or
--    'seats' (numbered chairs, two per table: table k = seats 2k-1, 2k).
-- 2. participants.assigned_seat: optional static pin. Interpreted per mode
--    (table number in tables mode, seat number in seats mode).
-- 3. matches.table_number: the match's physical table, persisted at pairing
--    time. NULL for legacy rounds (display falls back to index math).
-- 4. regenerate_current_round_pairings: accepts table_number per pairing.

ALTER TABLE tournaments
  ADD COLUMN numbering_mode text NOT NULL DEFAULT 'tables'
  CHECK (numbering_mode IN ('tables', 'seats'));

ALTER TABLE participants
  ADD COLUMN assigned_seat integer
  CHECK (assigned_seat IS NULL OR assigned_seat >= 1);

-- One pin value per tournament. Blocks two players pinned to the same
-- table/seat. Seats-mode couples sharing a table use different values (9, 10).
CREATE UNIQUE INDEX participants_assigned_seat_unique
  ON participants (tournament_id, assigned_seat)
  WHERE assigned_seat IS NOT NULL;

ALTER TABLE matches ADD COLUMN table_number integer;

-- Redefine the regenerate RPC (body from migration 036) with table_number
-- added to the INSERT. ->> yields NULL when the key is absent, so old
-- callers keep working.
CREATE OR REPLACE FUNCTION regenerate_current_round_pairings(
  p_tournament_id  UUID,
  p_pairings       JSONB,
  p_bye_id         UUID DEFAULT NULL,
  p_unlock         BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_host_id      UUID;
  v_current_rnd  INT;
  v_round_id     UUID;
  v_is_completed BOOLEAN;
  v_scored_count INT;
  v_inserted     INT := 0;
  v_pair         JSONB;
BEGIN
  SELECT host_id, current_round INTO v_host_id, v_current_rnd
  FROM tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  IF v_host_id IS NULL THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: tournament % not found', p_tournament_id;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> v_host_id THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: not the tournament host';
  END IF;

  SELECT id, is_completed INTO v_round_id, v_is_completed
  FROM rounds
  WHERE tournament_id = p_tournament_id
    AND round_number = v_current_rnd;

  IF v_round_id IS NULL THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: no rounds row for round % (tournament state inconsistent)', v_current_rnd;
  END IF;

  IF v_is_completed THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: round % is already completed', v_current_rnd;
  END IF;

  SELECT COUNT(*) INTO v_scored_count
  FROM matches
  WHERE tournament_id = p_tournament_id
    AND round = v_current_rnd
    AND player1_score IS NOT NULL;

  IF v_scored_count > 0 AND NOT p_unlock THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: % match(es) already scored; pass p_unlock=true to override', v_scored_count;
  END IF;

  DELETE FROM matches
   WHERE tournament_id = p_tournament_id
     AND round = v_current_rnd;
  DELETE FROM byes
   WHERE tournament_id = p_tournament_id
     AND round_number = v_current_rnd;

  FOR v_pair IN SELECT * FROM jsonb_array_elements(p_pairings)
  LOOP
    INSERT INTO matches (
      tournament_id, round, player1_id, player2_id,
      player1_score, player2_score, match_order, table_number
    ) VALUES (
      p_tournament_id,
      v_current_rnd,
      (v_pair->>'player1_id')::UUID,
      (v_pair->>'player2_id')::UUID,
      NULL, NULL,
      (v_pair->>'match_order')::INT,
      (v_pair->>'table_number')::INT
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  IF p_bye_id IS NOT NULL THEN
    INSERT INTO byes (
      tournament_id, round_number, participant_id,
      match_points, differential
    ) VALUES (
      p_tournament_id, v_current_rnd, p_bye_id, 3, 0
    );
  END IF;

  RETURN jsonb_build_object(
    'tournament_id', p_tournament_id,
    'round', v_current_rnd,
    'matches_inserted', v_inserted,
    'bye_id', p_bye_id
  );
END;
$$;

REVOKE ALL ON FUNCTION regenerate_current_round_pairings(UUID, JSONB, UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION regenerate_current_round_pairings(UUID, JSONB, UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION regenerate_current_round_pairings(UUID, JSONB, UUID, BOOLEAN) TO authenticated;
```

- [ ] **Step 2: Sanity-check against 036**

Run: `diff <(sed -n '/^CREATE OR REPLACE FUNCTION/,/^\$\$;/p' /Users/timestes/projects/rtt-seats/supabase/migrations/036_regenerate_pairings_require_rounds_row.sql) <(sed -n '/^CREATE OR REPLACE FUNCTION/,/^\$\$;/p' /Users/timestes/projects/rtt-seats/supabase/migrations/078_static_seats.sql)`
Expected: the only differences are the `table_number` column in the INSERT column list and `(v_pair->>'table_number')::INT` in VALUES.

- [ ] **Step 3: Commit**

```bash
cd /Users/timestes/projects/rtt-seats
git add supabase/migrations/078_static_seats.sql
git commit -m "feat(db): static seats schema + regenerate RPC accepts table_number"
```

**Note:** Do NOT apply the migration to the live DB in this task; the coordinator applies it via Supabase MCP during final verification (Task 10), keeping schema changes paired with the code that uses them.

---

### Task 2: Pure assignment function `assignTables` (TDD)

**Files:**
- Modify: `lib/tournament/types.ts` (add `NumberingMode`, `Participant.assignedSeat`, `TournamentState.startingTableNumber/numberingMode`)
- Create: `lib/tournament/tableAssignment.ts`
- Test: `lib/tournament/__tests__/tableAssignment.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 3, 4, 5):

```ts
export type NumberingMode = 'tables' | 'seats';                    // types.ts
export interface AssignOptions { startingTableNumber: number; mode: NumberingMode; }
export interface AssignableMatch { player1Id: string; player2Id: string; matchOrder: number; }
export function assignTables<M extends AssignableMatch>(
  matches: M[],
  pins: Map<string, number>,          // participantId -> assigned_seat
  opts: AssignOptions,
): { matches: Array<M & { tableNumber: number }>; overriddenPins: string[] };
// Returned matches are in matchOrder order; player1Id/player2Id may be
// swapped relative to input (seats-mode chair sides).
```

- [ ] **Step 1: Add types to `lib/tournament/types.ts`**

In the `Participant` interface, after `dropAfterRound?: number;` add:

```ts
  /** Static table (tables mode) or seat (seats mode) pin. Undefined = none. */
  assignedSeat?: number;
```

After the `Bye` interface, add:

```ts
/** How a tournament numbers physical locations: one number per match
 * ('tables') or one number per chair, two per table ('seats'). */
export type NumberingMode = "tables" | "seats";
```

In `TournamentState`, after `startedRounds?: number[];` add:

```ts
  /** First table number used by unpinned fill. Optional for back-compat with
   * hand-built test states; defaults to 1. */
  startingTableNumber?: number;
  /** Defaults to 'tables' when absent. */
  numberingMode?: NumberingMode;
```

- [ ] **Step 2: Write the failing tests**

Create `lib/tournament/__tests__/tableAssignment.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assignTables } from '../tableAssignment';
import type { NumberingMode } from '../types';

const m = (order: number, p1: string, p2: string) => ({
  matchOrder: order, player1Id: p1, player2Id: p2,
});
const opts = (start = 1, mode: NumberingMode = 'tables') => ({
  startingTableNumber: start, mode,
});
const tableOf = (r: ReturnType<typeof assignTables>, id: string) =>
  r.matches.find(x => x.player1Id === id || x.player2Id === id)!.tableNumber;

describe('assignTables — tables mode', () => {
  it('no pins → identity fill from startingTableNumber in rank order', () => {
    const r = assignTables([m(1, 'A', 'B'), m(2, 'C', 'D'), m(3, 'E', 'F')], new Map(), opts(5));
    expect(r.matches.map(x => x.tableNumber)).toEqual([5, 6, 7]);
    expect(r.overriddenPins).toEqual([]);
  });

  it('single pin places that match at the pinned table; fill skips it', () => {
    const r = assignTables([m(1, 'A', 'B'), m(2, 'C', 'D'), m(3, 'E', 'F')],
      new Map([['C', 2]]), opts(1));
    expect(tableOf(r, 'C')).toBe(2);
    expect(tableOf(r, 'A')).toBe(1);
    expect(tableOf(r, 'E')).toBe(3);
  });

  it('sparse pin beyond match count is honored', () => {
    const r = assignTables([m(1, 'A', 'B'), m(2, 'C', 'D')], new Map([['A', 50]]), opts(1));
    expect(tableOf(r, 'A')).toBe(50);
    expect(tableOf(r, 'C')).toBe(1);
  });

  it('pin below startingTableNumber is honored', () => {
    const r = assignTables([m(1, 'A', 'B'), m(2, 'C', 'D')], new Map([['C', 3]]), opts(5));
    expect(tableOf(r, 'C')).toBe(3);
    expect(tableOf(r, 'A')).toBe(5);
  });

  it('two pinned players in one match: lower value wins, other overridden', () => {
    const r = assignTables([m(1, 'A', 'B')], new Map([['A', 7], ['B', 4]]), opts(1));
    expect(r.matches[0].tableNumber).toBe(4);
    expect(r.overriddenPins).toEqual(['A']);
  });
});

describe('assignTables — seats mode', () => {
  it('even-seat pin maps to table ceil(s/2) and forces the player2 chair', () => {
    // B pinned to seat 10 → table 5, even → player2 slot (input has B as player1).
    const r = assignTables([m(1, 'B', 'A')], new Map([['B', 10]]), opts(1, 'seats'));
    expect(r.matches[0].tableNumber).toBe(5);
    expect(r.matches[0].player1Id).toBe('A');
    expect(r.matches[0].player2Id).toBe('B');
  });

  it('odd-seat pin keeps/forces the player1 chair', () => {
    const r = assignTables([m(1, 'A', 'B')], new Map([['A', 9]]), opts(1, 'seats'));
    expect(r.matches[0].tableNumber).toBe(5);
    expect(r.matches[0].player1Id).toBe('A');
  });

  it('seats 9+10 pinned and paired together: both honored, no override', () => {
    const r = assignTables([m(1, 'X', 'Y')], new Map([['X', 10], ['Y', 9]]), opts(1, 'seats'));
    expect(r.matches[0].tableNumber).toBe(5);
    expect(r.matches[0].player1Id).toBe('Y'); // seat 9 = odd chair
    expect(r.matches[0].player2Id).toBe('X');
    expect(r.overriddenPins).toEqual([]);
  });

  it('cross-match same-table claims: lower seat wins, other bumped + overridden', () => {
    // A pinned seat 9, C pinned seat 10 — both table 5, different matches.
    const r = assignTables([m(1, 'A', 'B'), m(2, 'C', 'D')],
      new Map([['A', 9], ['C', 10]]), opts(1, 'seats'));
    expect(tableOf(r, 'A')).toBe(5);
    expect(tableOf(r, 'C')).toBe(1); // bumped to normal fill
    expect(r.overriddenPins).toEqual(['C']);
  });
});

describe('assignTables — general', () => {
  it('pin of a player not in any match (bye/dropped) claims nothing', () => {
    const r = assignTables([m(1, 'A', 'B')], new Map([['Z', 1]]), opts(1));
    expect(r.matches[0].tableNumber).toBe(1);
  });

  it('deterministic: identical inputs → identical outputs', () => {
    const ms = [m(1, 'A', 'B'), m(2, 'C', 'D'), m(3, 'E', 'F')];
    const pins = new Map([['E', 2], ['B', 7]]);
    expect(assignTables(ms, pins, opts(1))).toEqual(assignTables(ms, pins, opts(1)));
  });

  it('returns matches in matchOrder order regardless of claims', () => {
    const r = assignTables([m(1, 'A', 'B'), m(2, 'C', 'D')], new Map([['C', 1]]), opts(1));
    expect(r.matches.map(x => x.matchOrder)).toEqual([1, 2]);
  });

  it('does not mutate its inputs', () => {
    const ms = [m(1, 'B', 'A')];
    const pins = new Map([['B', 10]]);
    assignTables(ms, pins, opts(1, 'seats'));
    expect(ms[0].player1Id).toBe('B'); // swap happened on a copy
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/timestes/projects/rtt-seats && npx vitest run lib/tournament/__tests__/tableAssignment.test.ts`
Expected: FAIL — cannot resolve `../tableAssignment`.

- [ ] **Step 4: Implement `lib/tournament/tableAssignment.ts`**

```ts
// lib/tournament/tableAssignment.ts
//
// Post-pairing table/seat assignment. Pure: no IO, no RNG. Decides WHERE each
// match happens; never changes who plays whom.
// Spec: docs/superpowers/specs/2026-07-15-static-seats-design.md
//
// Seat math (seats mode): table k holds seats 2k-1 (player1 chair) and 2k
// (player2 chair). A pin is a table number in tables mode, a seat number in
// seats mode.

import type { NumberingMode } from "./types";

export interface AssignOptions {
  startingTableNumber: number;
  mode: NumberingMode;
}

export interface AssignableMatch {
  player1Id: string;
  player2Id: string;
  matchOrder: number;
}

export interface AssignResult<M extends AssignableMatch> {
  /** In matchOrder order. player1Id/player2Id may be swapped vs input
   * (seats-mode chair sides). */
  matches: Array<M & { tableNumber: number }>;
  /** Participants whose pin was not honored this round. */
  overriddenPins: string[];
}

/** Table a pin points to: identity in tables mode, ceil(seat/2) in seats mode. */
function pinTable(pin: number, mode: NumberingMode): number {
  return mode === "seats" ? Math.ceil(pin / 2) : pin;
}

export function assignTables<M extends AssignableMatch>(
  matches: M[],
  pins: Map<string, number>,
  opts: AssignOptions,
): AssignResult<M> {
  const { startingTableNumber, mode } = opts;
  const overridden = new Set<string>();

  // Rank order (matchOrder asc); input order isn't guaranteed.
  const ranked = [...matches].sort((a, b) => a.matchOrder - b.matchOrder);

  // Step 1: per-match claims. A match with two pins keeps the lower value
  // (both, when they resolve to the same table — the seats 9+10 happy case).
  interface Claim {
    match: M;
    table: number;
    pinValue: number;
    pinnedIds: string[];
  }
  const claims: Claim[] = [];
  const unclaimed: M[] = [];
  for (const match of ranked) {
    const p1Pin = pins.get(match.player1Id);
    const p2Pin = pins.get(match.player2Id);
    if (p1Pin === undefined && p2Pin === undefined) {
      unclaimed.push(match);
      continue;
    }
    let pinValue: number;
    let pinnedIds: string[];
    if (p1Pin !== undefined && p2Pin !== undefined) {
      if (pinTable(p1Pin, mode) === pinTable(p2Pin, mode)) {
        pinValue = Math.min(p1Pin, p2Pin);
        pinnedIds = [match.player1Id, match.player2Id];
      } else if (p1Pin <= p2Pin) {
        pinValue = p1Pin;
        pinnedIds = [match.player1Id];
        overridden.add(match.player2Id);
      } else {
        pinValue = p2Pin;
        pinnedIds = [match.player2Id];
        overridden.add(match.player1Id);
      }
    } else if (p1Pin !== undefined) {
      pinValue = p1Pin;
      pinnedIds = [match.player1Id];
    } else {
      pinValue = p2Pin as number;
      pinnedIds = [match.player2Id];
    }
    claims.push({ match, table: pinTable(pinValue, mode), pinValue, pinnedIds });
  }

  // Step 2: resolve cross-match claims to the same table — (pin value asc,
  // matchOrder asc); first claimant keeps it, the rest drop to fill.
  claims.sort((a, b) => a.pinValue - b.pinValue || a.match.matchOrder - b.match.matchOrder);
  const taken = new Set<number>();
  const placed: Array<{ match: M; tableNumber: number; pinnedIds: string[] }> = [];
  for (const c of claims) {
    if (taken.has(c.table)) {
      for (const id of c.pinnedIds) overridden.add(id);
      unclaimed.push(c.match);
      continue;
    }
    taken.add(c.table);
    placed.push({ match: c.match, tableNumber: c.table, pinnedIds: c.pinnedIds });
  }

  // Step 3: fill — bumped + unpinned matches take the lowest free tables
  // >= startingTableNumber in rank order, skipping claimed tables.
  unclaimed.sort((a, b) => a.matchOrder - b.matchOrder);
  let next = startingTableNumber;
  for (const match of unclaimed) {
    while (taken.has(next)) next++;
    taken.add(next);
    placed.push({ match, tableNumber: next, pinnedIds: [] });
  }

  // Step 4: seats-mode chair sides — an honored pin to an even seat sits in
  // the player2 slot, odd in player1. Swaps a copy, never the input.
  const out = placed.map(({ match, tableNumber, pinnedIds }) => {
    let result: M = match;
    if (mode === "seats") {
      for (const id of pinnedIds) {
        const pin = pins.get(id) as number;
        const wantsPlayer1 = pin % 2 === 1;
        const isPlayer1 = result.player1Id === id;
        if (wantsPlayer1 !== isPlayer1) {
          result = { ...result, player1Id: result.player2Id, player2Id: result.player1Id };
        }
      }
    }
    return { ...result, tableNumber };
  });

  out.sort((a, b) => a.matchOrder - b.matchOrder);
  return { matches: out, overriddenPins: [...overridden] };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/timestes/projects/rtt-seats && npx vitest run lib/tournament/__tests__/tableAssignment.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 6: Run the full tournament suite (no regressions)**

Run: `cd /Users/timestes/projects/rtt-seats && npx vitest run lib/tournament`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/timestes/projects/rtt-seats
git add lib/tournament/types.ts lib/tournament/tableAssignment.ts lib/tournament/__tests__/tableAssignment.test.ts
git commit -m "feat(tournament): pure assignTables — static pins, seat math, conflict rules"
```

---

### Task 3: Persist table numbers from `createPairing`

**Files:**
- Modify: `utils/tournament/stateAdapter.ts` (selects + mapping)
- Modify: `utils/tournament/pairingUtilsV2.ts` (assign + persist)

**Interfaces:**
- Consumes: `assignTables` from Task 2.
- Produces: `TournamentState` now carries `startingTableNumber`, `numberingMode`, and `Participant.assignedSeat` (Task 4 relies on this); `matches` rows inserted by `createPairing` include `table_number`.

- [ ] **Step 1: Extend `stateAdapter.ts`**

Tournament select (line ~53) becomes:

```ts
    .select("id, n_rounds, current_round, max_score, has_started, has_ended, starting_table_number, numbering_mode")
```

Participants select (line ~61) becomes:

```ts
    .select("id, name, joined_at, dropped_out, assigned_seat")
```

Participant mapping gains:

```ts
    assignedSeat: p.assigned_seat ?? undefined,
```

The returned state object gains (after `startedRounds`):

```ts
    startingTableNumber: t.starting_table_number ?? 1,
    numberingMode: t.numbering_mode === "seats" ? "seats" : "tables",
```

- [ ] **Step 2: Update `pairingUtilsV2.ts`**

Add import:

```ts
import { assignTables } from "../../lib/tournament/tableAssignment";
```

Replace `persistMatches` with:

```ts
/** Insert match records for a round. */
async function persistMatches(
  client: AnyClient,
  tournamentId: string,
  matches: Array<{
    round: number;
    player1Id: string;
    player2Id: string;
    matchOrder: number;
    tableNumber: number;
  }>,
) {
  if (matches.length === 0) return;
  const rows = matches.map(m => ({
    tournament_id: tournamentId,
    round: m.round,
    player1_id: m.player1Id,
    player2_id: m.player2Id,
    player1_score: null,
    player2_score: null,
    match_order: m.matchOrder,
    table_number: m.tableNumber,
  }));
  await client.from("matches").insert(rows);
}
```

In `createPairing`, between computing `result` and persisting, add:

```ts
    // Static seats: place each match at a physical table, honoring pins.
    // Chair-side swaps (seats mode) happen here, before insert, while the
    // match has no scores. Spec: 2026-07-15-static-seats-design.md
    const pins = new Map<string, number>();
    for (const p of state.participants) {
      if (!p.droppedOut && p.assignedSeat != null) pins.set(p.id, p.assignedSeat);
    }
    const assigned = assignTables(result.matches, pins, {
      startingTableNumber: state.startingTableNumber ?? 1,
      mode: state.numberingMode ?? "tables",
    });
```

and change the persist call to:

```ts
    await persistMatches(client, tournamentId, assigned.matches);
```

- [ ] **Step 3: Type-check + full suite**

Run: `cd /Users/timestes/projects/rtt-seats && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "forge-anon-leak\|playDecksAuthorize" | grep "error TS" ; npx vitest run lib/tournament utils`
Expected: no new type errors; all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/timestes/projects/rtt-seats
git add utils/tournament/stateAdapter.ts utils/tournament/pairingUtilsV2.ts
git commit -m "feat(tournament): createPairing assigns and persists table numbers"
```

---

### Task 4: Regenerate path passes `table_number` through the RPC

**Files:**
- Modify: `app/tracker/tournaments/repair-actions.ts:50-87` (`regenerateCurrentRoundPairingsAction`)

**Interfaces:**
- Consumes: `assignTables` (Task 2), extended state (Task 3), RPC accepting `table_number` (Task 1).
- Produces: regenerated rounds have `matches.table_number` set.

- [ ] **Step 1: Update the action**

Add import at the top of the file:

```ts
import { assignTables } from "@/lib/tournament/tableAssignment";
```

(Match the file's existing import style — if it uses relative paths, use `../../../lib/tournament/tableAssignment`.)

In `regenerateCurrentRoundPairingsAction`, replace the `const pairings = ...` block with:

```ts
  // Static seats: honor pins when placing regenerated matches (spec
  // 2026-07-15-static-seats-design.md).
  const pins = new Map<string, number>();
  for (const p of state.participants) {
    if (!p.droppedOut && p.assignedSeat != null) pins.set(p.id, p.assignedSeat);
  }
  const assigned = assignTables(result.matches, pins, {
    startingTableNumber: state.startingTableNumber ?? 1,
    mode: state.numberingMode ?? "tables",
  });

  const pairings = assigned.matches.map((m, idx) => ({
    player1_id: m.player1Id,
    player2_id: m.player2Id,
    match_order: m.matchOrder ?? idx + 1,
    table_number: m.tableNumber,
  }));
```

- [ ] **Step 2: Type-check + existing repair tests**

Run: `cd /Users/timestes/projects/rtt-seats && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "forge-anon-leak\|playDecksAuthorize" | grep "error TS" ; npx vitest run app/tracker/tournaments/__tests__/repair-actions.test.ts`
Expected: no new type errors; repair tests pass (they mock the RPC — extra payload key is inert).

- [ ] **Step 3: Commit**

```bash
cd /Users/timestes/projects/rtt-seats
git add app/tracker/tournaments/repair-actions.ts
git commit -m "feat(tournament): regenerate pairings persists table numbers via RPC"
```

---

### Task 5: `reassignRoundTables` helper + wire into repair swaps

**Files:**
- Create: `utils/tournament/reassignTables.ts`
- Modify: `components/ui/TournamentRounds.tsx` (`handleSwapPlayers` ~line 656, `handleSwapPlayerWithBye` ~line 768)
- Modify: `components/ui/RepairPairingModal.tsx` (`handleRepair` ~lines 83-199)

**Interfaces:**
- Consumes: `assignTables` (Task 2).
- Produces: `reassignRoundTables(client, tournamentId, round): Promise<void>` — reloads the round's matches + pins, recomputes placement, updates `matches.table_number` (and swaps chair sides + their sibling columns where seats mode demands it).

- [ ] **Step 1: Create the helper**

`utils/tournament/reassignTables.ts`:

```ts
// Recompute a round's table numbers after a manual repair (player swap,
// bye swap, re-pair). Deterministic: same helper the pairing paths use.
// Safe only pre-results — all repair flows are already gated to rounds
// with no scores entered.

import { assignTables } from "../../lib/tournament/tableAssignment";

type AnyClient = {
  from: (table: string) => any;
};

export async function reassignRoundTables(
  client: AnyClient,
  tournamentId: string,
  round: number,
): Promise<void> {
  const [{ data: t }, { data: parts }, { data: ms }] = await Promise.all([
    client
      .from("tournaments")
      .select("starting_table_number, numbering_mode")
      .eq("id", tournamentId)
      .single(),
    client
      .from("participants")
      .select("id, assigned_seat")
      .eq("tournament_id", tournamentId)
      .not("assigned_seat", "is", null),
    client
      .from("matches")
      .select(
        "id, player1_id, player2_id, match_order, player1_match_points, player2_match_points, differential, differential2",
      )
      .eq("tournament_id", tournamentId)
      .eq("round", round),
  ]);
  if (!t || !ms || ms.length === 0) return;

  const pins = new Map<string, number>(
    (parts || []).map((p: any) => [p.id as string, p.assigned_seat as number]),
  );
  const rows = (ms || []).map((m: any) => ({
    id: m.id as string,
    player1Id: m.player1_id as string,
    player2Id: m.player2_id as string,
    matchOrder: (m.match_order ?? 0) as number,
  }));
  const byId = new Map((ms || []).map((m: any) => [m.id as string, m]));

  const { matches: assigned } = assignTables(rows, pins, {
    startingTableNumber: t.starting_table_number ?? 1,
    mode: t.numbering_mode === "seats" ? "seats" : "tables",
  });

  for (const m of assigned) {
    const orig = byId.get((m as any).id);
    if (!orig) continue;
    const swapped = orig.player1_id !== m.player1Id;
    const patch: Record<string, unknown> = { table_number: m.tableNumber };
    if (swapped) {
      // Chair-side swap: mirror handleSwapPlayers' same-match flip — swap the
      // per-side sibling columns along with the ids. Scores are null here
      // (repairs are pre-results), so they don't need swapping.
      patch.player1_id = m.player1Id;
      patch.player2_id = m.player2Id;
      patch.player1_match_points = orig.player2_match_points;
      patch.player2_match_points = orig.player1_match_points;
      patch.differential = orig.differential2;
      patch.differential2 = orig.differential;
    }
    await client.from("matches").update(patch).eq("id", (m as any).id);
  }
}
```

- [ ] **Step 2: Wire into `TournamentRounds.tsx`**

Add import (top of file, alongside the other `../../utils` imports):

```ts
import { reassignRoundTables } from "../../utils/tournament/reassignTables";
```

In `handleSwapPlayers` (~line 656) and `handleSwapPlayerWithBye` (~line 768): after the last `await client.from(...)`/`await client.rpc(...)` write of each handler and **before** `await fetchCurrentRoundData()`, insert:

```ts
      await reassignRoundTables(client, tournamentId, currentPage);
```

(`currentPage` is the round being viewed/repaired in this component; both handlers already operate on it. Do NOT add this to `handleSwapPlayersWithBye` (~line 726) — that one swaps two bye holders and touches no matches.)

- [ ] **Step 3: Wire into `RepairPairingModal.tsx`**

Add the same import (path from `components/ui/`: `../../utils/tournament/reassignTables`). In `handleRepair`, after its final DB write and before the success callback/refresh call at the end of the function, insert the same call, using the modal's existing tournament-id and round values (read the surrounding code for their prop/variable names — the handler already filters matches by round).

- [ ] **Step 4: Type-check**

Run: `cd /Users/timestes/projects/rtt-seats && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "forge-anon-leak\|playDecksAuthorize" | grep "error TS"`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-seats
git add utils/tournament/reassignTables.ts components/ui/TournamentRounds.tsx components/ui/RepairPairingModal.tsx
git commit -m "feat(tournament): repairs recompute table numbers (pins follow players)"
```

---

### Task 6: Rounds view — persisted tables, seat display, overridden-pin badge

**Files:**
- Modify: `components/ui/TournamentRounds.tsx` (TournamentInfo type ~106, initial state ~146, tournament fetch ~262, matches fetch ~402-409, desktop table cell ~1094, mobile card ~1271)

**Interfaces:**
- Consumes: `matches.table_number`, `participants.assigned_seat`, `tournaments.numbering_mode` (Tasks 1, 3).
- Produces: `matches` state rows now carry `table_number` and joined `assigned_seat`; print handlers (Task 7) read them.

- [ ] **Step 1: Fetch the new columns**

TournamentInfo type (~line 106): add `numbering_mode: string | null;` — initial state (~146): add `numbering_mode: null,`.

Tournament select (~line 262): append `, numbering_mode`:

```ts
          .select("id, n_rounds, current_round, has_ended, max_score, starting_table_number, name, numbering_mode")
```

Matches select (~line 404): add `table_number` and `assigned_seat` on both joins, and sort by table first:

```ts
      .select(
        "id, match_order, table_number, player1_match_points, player2_match_points, differential, differential2, player1_id:participants!matches_player1_id_fkey(name,id,assigned_seat), player2_id:participants!matches_player2_id_fkey(name,id,assigned_seat), player1_score, player2_score"
      )
      .eq("tournament_id", tournamentId)
      .eq("round", currentPage)
      .order("table_number", { ascending: true, nullsFirst: true })
      .order("match_order", { ascending: true });
```

(A round is either all-legacy (`table_number` null → match_order sort, identical to today) or all-new (table sort); the two never mix within one round.)

- [ ] **Step 2: Display helpers**

Near the other derived consts in the component body (after `noScoresEntered`, ~line 896), add:

```ts
  const isSeatsMode = tournamentInfo.numbering_mode === "seats";

  /** Persisted table with legacy fallback to positional numbering. */
  const displayTable = (match: any, index: number): number =>
    match.table_number ?? index + (tournamentInfo.starting_table_number || 1);

  /** True when a player's static pin was not honored this round. */
  const pinOverridden = (match: any, side: 1 | 2, tableNum: number): boolean => {
    const pin = side === 1 ? match.player1_id?.assigned_seat : match.player2_id?.assigned_seat;
    if (pin == null || match.table_number == null) return false;
    if (isSeatsMode) {
      return pin !== (side === 1 ? 2 * tableNum - 1 : 2 * tableNum);
    }
    return pin !== tableNum;
  };
```

- [ ] **Step 3: Use them at the two display sites**

Desktop table-number cell (~line 1094): replace `{index + (tournamentInfo.starting_table_number || 1)}` with:

```tsx
{isSeatsMode
  ? `${2 * displayTable(match, index) - 1}·${2 * displayTable(match, index)}`
  : displayTable(match, index)}
```

Mobile card (~line 1271): replace `const tableNum = index + (tournamentInfo.starting_table_number || 1);` with:

```tsx
const tableNum = displayTable(match, index);
const tableLabel = isSeatsMode ? `Seats ${2 * tableNum - 1}·${2 * tableNum}` : `Table ${tableNum}`;
```

and use `tableLabel` where the card currently renders `Table {tableNum}` (keep the raw `tableNum` variable for anything else that uses it).

Next to each player-name render inside the desktop row and mobile card (both `matches.map` blocks), append after the name span:

```tsx
{pinOverridden(match, 1, displayTable(match, index)) && (
  <span
    title="Static seat not honored this round (conflicting pins)"
    className="text-amber-500 text-xs flex-shrink-0"
    aria-label="Static seat not honored this round"
  >⚠</span>
)}
```

(and the `side: 2` twin after the player-2 name). In seats mode also prefix each name with its seat number:

```tsx
{isSeatsMode && (
  <span className="text-xs text-muted-foreground tabular-nums mr-1">
    {2 * displayTable(match, index) - 1}
  </span>
)}
```

(player 2 uses `2 * displayTable(match, index)`).

- [ ] **Step 4: Type-check + eyeball**

Run: `cd /Users/timestes/projects/rtt-seats && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "forge-anon-leak\|playDecksAuthorize" | grep "error TS"`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-seats
git add components/ui/TournamentRounds.tsx
git commit -m "feat(tournament): rounds view reads persisted tables, seats mode + pin badges"
```

---

### Task 7: Print pairings + match slips read persisted numbers, seat-aware

**Files:**
- Modify: `utils/printUtils.ts` (`printTournamentPairings` ~166, `printMatchSlips` ~312)
- Modify: `components/ui/TournamentRounds.tsx` (`handlePrintPairings` ~832, `handlePrintMatchSlips` ~842)

**Interfaces:**
- Consumes: `matches` rows carrying `table_number` (Task 6 fetch), `numbering_mode`.
- Produces: both print functions gain a trailing `numberingMode: 'tables' | 'seats' = 'tables'` parameter.

- [ ] **Step 1: `printTournamentPairings`**

Signature becomes:

```ts
export const printTournamentPairings = (
  matches: any[],
  byes: any[],
  roundNumber: number,
  startingTableNumber: number = 1,
  tournamentName?: string | null,
  numberingMode: 'tables' | 'seats' = 'tables',
): void => {
```

Replace the `pairingsHtml` builder with:

```ts
  const pairingsHtml = (matches || [])
    .map((match, index) => {
      const table = match.table_number ?? index + startingTableNumber;
      if (numberingMode === 'seats') {
        // Per-chair numbers replace the single table badge.
        return `
        <li class="pair pair-seats">
          <span class="names">
            <span class="seat">${2 * table - 1}</span>
            <span class="p">${escapeHtml(match.player1_id?.name)}</span>
            <span class="vs">vs</span>
            <span class="seat">${2 * table}</span>
            <span class="p">${escapeHtml(match.player2_id?.name)}</span>
          </span>
        </li>`;
      }
      return `
        <li class="pair">
          <span class="t">${table}</span>
          <span class="names">
            <span class="p">${escapeHtml(match.player1_id?.name)}</span>
            <span class="vs">vs</span>
            <span class="p">${escapeHtml(match.player2_id?.name)}</span>
          </span>
        </li>`;
    })
    .join('');
```

In the `<style>` block, after the `.pair .vs` rule, add:

```css
          .pair.pair-seats { grid-template-columns: 1fr; }
          .pair .seat {
            font-weight: 800; color: #555;
            font-variant-numeric: tabular-nums; font-size: 13px;
          }
```

- [ ] **Step 2: `printMatchSlips`**

Signature gains the same trailing parameter:

```ts
export const printMatchSlips = (
  matches: any[],
  roundNumber: number,
  startingTableNumber: number = 1,
  tournamentName?: string | null,
  numberingMode: 'tables' | 'seats' = 'tables',
): void => {
```

Inside the per-slip map, replace `const tableNumber = index + startingTableNumber;` with:

```ts
    const tableNumber = match.table_number ?? index + startingTableNumber;
    const locationLabel = numberingMode === 'seats'
      ? `Seats ${2 * tableNumber - 1} &amp; ${2 * tableNumber}`
      : `Table ${tableNumber}`;
    const p1Seat = numberingMode === 'seats' ? `<span class="slip-seat">${2 * tableNumber - 1}</span> ` : '';
    const p2Seat = numberingMode === 'seats' ? `<span class="slip-seat">${2 * tableNumber}</span> ` : '';
```

Header line uses the label (replace `Table ${tableNumber}`):

```html
          <strong>${escapeHtml(tournamentName || 'Tournament')}</strong> - Round ${roundNumber} - ${locationLabel}
```

Player-name cells gain the seat prefix and escaping (replace the two `${match.playerN_id.name}` interpolations):

```html
            <td class="player-name">${p1Seat}${escapeHtml(match.player1_id?.name)}</td>
            ...
            <td class="player-name">${p2Seat}${escapeHtml(match.player2_id?.name)}</td>
```

Add to the slips `<style>` block (after `.player-name`):

```css
          .slip-seat { color: #888; font-weight: normal; }
```

- [ ] **Step 3: Callers pass the mode**

In `TournamentRounds.tsx`, both handlers gain a final argument:

```ts
      tournamentInfo.numbering_mode === "seats" ? "seats" : "tables",
```

(`handlePrintPairings` after the tournament-name arg; same for `handlePrintMatchSlips`.)

- [ ] **Step 4: Type-check**

Run: `cd /Users/timestes/projects/rtt-seats && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "forge-anon-leak\|playDecksAuthorize" | grep "error TS"`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-seats
git add utils/printUtils.ts components/ui/TournamentRounds.tsx
git commit -m "feat(print): pairings + match slips read persisted tables, seat-aware"
```

---

### Task 8: Assign pins — edit modal, save handler, roster badge

**Files:**
- Modify: `components/ui/EditParticipantModal.tsx`
- Modify: `app/tracker/tournaments/[id]/page.tsx` (state ~49, `updateParticipant` ~185-203, modal-open handler ~905, modal props ~1074-1076, TournamentTabs props ~897)
- Modify: `components/ui/ParticipantTable.tsx` (interface ~10-30, name renders in mobile ~200 + desktop ~263)
- Modify: `components/ui/TournamentTabs.tsx` (pass-through prop ~229)

**Interfaces:**
- Consumes: `participants.assigned_seat` column (page participants fetch is `select("*")` so the field flows automatically); tournament `numbering_mode` (page's tournament fetch — if it selects explicit columns, add `numbering_mode`; if `select("*")`, nothing to add).
- Produces: `EditParticipantModal` props gain `numberingMode: "tables" | "seats"`, `seatValue: string`, `setSeatValue: (v: string) => void`; `ParticipantTable`/`TournamentTabs` props gain `numberingMode: "tables" | "seats"`.

- [ ] **Step 1: Modal field**

In `EditParticipantModal.tsx`, extend the props interface:

```ts
  numberingMode: "tables" | "seats";
  seatValue: string;
  setSeatValue: (v: string) => void;
```

destructure them, and add below the name field inside `DialogBody`:

```tsx
            <div className="space-y-1">
              <label htmlFor="assigned-seat" className="text-sm font-medium text-foreground">
                Static {numberingMode === "seats" ? "seat" : "table"} #{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                id="assigned-seat"
                name="assigned-seat"
                type="number"
                min={1}
                step={1}
                value={seatValue}
                onChange={(e) => setSeatValue(e.target.value)}
                placeholder="None"
                className="w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm focus:outline-none"
              />
              <p className="text-xs text-muted-foreground">
                Always placed at this {numberingMode === "seats" ? "seat" : "table"} when
                pairings are generated. Leave empty for automatic placement.
              </p>
            </div>
```

- [ ] **Step 2: Page state + save**

In `app/tracker/tournaments/[id]/page.tsx`, next to the `newParticipantName` state (~line 49):

```ts
  const [newParticipantSeat, setNewParticipantSeat] = useState<string>("");
```

Where the edit modal is opened (~line 905, right after `setNewParticipantName(participant.name)`):

```ts
    setNewParticipantSeat(participant.assigned_seat != null ? String(participant.assigned_seat) : "");
```

Derive the mode near the modal render (the page already holds the tournament row):

```ts
  const numberingMode: "tables" | "seats" =
    tournament?.numbering_mode === "seats" ? "seats" : "tables";
```

Replace the body of `updateParticipant` (~185-203) with:

```ts
  const updateParticipant = async () => {
    if (!currentParticipant || !newParticipantName.trim()) return;
    const trimmedSeat = newParticipantSeat.trim();
    const seatNum = trimmedSeat === "" ? null : Number(trimmedSeat);
    if (seatNum !== null && (!Number.isInteger(seatNum) || seatNum < 1)) {
      showToast("Static assignment must be a positive whole number.", "error");
      return;
    }
    try {
      const { error } = await supabase
        .from("participants")
        .update({ name: newParticipantName, assigned_seat: seatNum })
        .eq("id", currentParticipant.id);
      if (error) {
        if ((error as { code?: string }).code === "23505") {
          showToast(
            `${numberingMode === "seats" ? "Seat" : "Table"} ${seatNum} is already assigned to another player.`,
            "error",
          );
          return;
        }
        throw error;
      }
      fetchParticipants();
      setIsEditParticipantModalOpen(false);
      showToast("Participant updated successfully!", "success");
    } catch (error) {
      showToast("Error updating participant.", "error");
      console.error("Error updating participant:", error);
    }
  };
```

Modal usage (~1074-1076) gains:

```tsx
        numberingMode={numberingMode}
        seatValue={newParticipantSeat}
        setSeatValue={setNewParticipantSeat}
```

`TournamentTabs` usage (~897) gains `numberingMode={numberingMode}`.

- [ ] **Step 3: Roster badge**

`TournamentTabs.tsx`: add `numberingMode: "tables" | "seats";` to its props and forward `numberingMode={numberingMode}` to `<ParticipantTable ...>` (~line 229).

`ParticipantTable.tsx`: `Participant` interface gains `assigned_seat?: number | null;`; props gain `numberingMode: "tables" | "seats";`. In both the mobile name row (inside the flex-wrap div, ~line 204) and the desktop name cell (~line 267), after the dropped-out span add:

```tsx
                    {participant.assigned_seat != null && (
                      <span
                        className="text-[11px] font-semibold tabular-nums rounded px-1.5 py-0.5 bg-muted text-muted-foreground border border-border flex-shrink-0"
                        title={`Static ${numberingMode === "seats" ? "seat" : "table"} ${participant.assigned_seat}`}
                      >
                        {numberingMode === "seats" ? "S" : "T"}
                        {participant.assigned_seat}
                      </span>
                    )}
```

- [ ] **Step 4: Type-check**

Run: `cd /Users/timestes/projects/rtt-seats && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "forge-anon-leak\|playDecksAuthorize" | grep "error TS"`
Expected: no new errors. If the page's tournament fetch selects explicit columns (not `*`), add `numbering_mode` to that select in this task.

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-seats
git add components/ui/EditParticipantModal.tsx "app/tracker/tournaments/[id]/page.tsx" components/ui/ParticipantTable.tsx components/ui/TournamentTabs.tsx
git commit -m "feat(tournament): assign static seats from the players tab"
```

---

### Task 9: Settings — numbering-mode toggle with pin warning

**Files:**
- Modify: `components/ui/TournamentSettings.tsx` (interface ~8-19, EMPTY_INFO ~35, EDITABLE_KEYS ~42-50, fetch select ~70-76, form controls)

**Interfaces:**
- Consumes: `tournaments.numbering_mode`, pinned-participant count.
- Produces: hosts can switch modes; the existing dirty-tracking/patch save handles persistence automatically once the key is registered.

- [ ] **Step 1: Register the field**

- `TournamentInfo` interface: add `numbering_mode: string | null;`
- `EMPTY_INFO`: add `numbering_mode: "tables",`
- `EDITABLE_KEYS`: add `"numbering_mode",`
- Fetch select string: append `, numbering_mode`

- [ ] **Step 2: Pinned-count state**

```ts
  const [pinnedCount, setPinnedCount] = useState(0);
```

In the existing fetch effect, after the tournament info loads:

```ts
      const { count } = await client
        .from("participants")
        .select("id", { count: "exact", head: true })
        .eq("tournament_id", tournamentId)
        .not("assigned_seat", "is", null);
      setPinnedCount(count ?? 0);
```

- [ ] **Step 3: Control**

Add alongside the existing numeric settings fields, following the file's field markup/classes exactly (read a neighboring field first and clone its structure):

```tsx
        <div>
          <label className="text-sm font-medium text-foreground" htmlFor="numbering-mode">
            Numbering
          </label>
          <select
            id="numbering-mode"
            value={tournamentInfo.numbering_mode ?? "tables"}
            onChange={(e) =>
              setTournamentInfo((prev) => ({ ...prev, numbering_mode: e.target.value }))
            }
            className="w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm focus:outline-none"
          >
            <option value="tables">Tables — one number per match</option>
            <option value="seats">Seats — numbered chairs, two per table</option>
          </select>
          {pinnedCount > 0 && tournamentInfo.numbering_mode !== savedInfo.numbering_mode && (
            <p className="text-xs text-amber-500 mt-1">
              {pinnedCount} player{pinnedCount === 1 ? " has" : "s have"} a static
              assignment — the number keeps its value but is reinterpreted under the
              new mode. Review assignments after saving.
            </p>
          )}
        </div>
```

- [ ] **Step 4: Type-check + commit**

Run: `cd /Users/timestes/projects/rtt-seats && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "forge-anon-leak\|playDecksAuthorize" | grep "error TS"`
Expected: no new errors.

```bash
cd /Users/timestes/projects/rtt-seats
git add components/ui/TournamentSettings.tsx
git commit -m "feat(tournament): numbering-mode setting (tables vs seats) with pin warning"
```

---

### Task 10: Apply migration + full verification (coordinator)

**Files:** none (verification only)

- [ ] **Step 1: Apply migration 078** to the linked Supabase project via the Supabase MCP `apply_migration` tool (name `static_seats`, content = the file from Task 1). Confirm with `list_migrations`.

- [ ] **Step 2: Gates**

Run: `cd /Users/timestes/projects/rtt-seats && npx vitest run && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "forge-anon-leak\|playDecksAuthorize" | grep "error TS"`
Expected: suite green; no new type errors.

- [ ] **Step 3: Live walkthrough** (dev server in the worktree, Playwright; see `verify` skill for auth):
  1. Create a tournament with ≥6 participants; pin one player to table 3 via the players-tab edit pencil; verify the `T3` badge.
  2. Start the tournament → rounds view: pinned player's match sits at table 3; other matches fill 1, 2, 4….
  3. Regenerate pairings: pin still honored.
  4. Print pairings + match slips: numbers agree with the rounds view.
  5. Settings → switch to Seats: warning appears (1 player pinned). Save; rounds/print show per-chair numbers.
  6. Pin two players to seats 9 and 10; regenerate until they're in different matches: seat-9 match at table 5, seat-10 player badged ⚠.
  7. Swap a pinned player between matches via repair: table numbers follow the pin.

- [ ] **Step 4: Push branch and open PR** against `main` (from the worktree; base `origin/main`).
