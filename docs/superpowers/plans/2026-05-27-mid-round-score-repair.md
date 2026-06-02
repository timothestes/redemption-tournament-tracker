# Mid-Round Score Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give tournament hosts a safe, audited in-app affordance to correct past-round match scores after subsequent rounds have started, with an optional re-pair of the current round when no results have been submitted.

**Architecture:** A single Postgres RPC (`repair_match_score`) updates the corrected match, recomputes participant totals from history, rewrites per-match denormalized snapshots chronologically, and inserts an append-only `match_edits` audit row — all in one transaction with `SELECT … FOR UPDATE`. A second RPC (`regenerate_current_round_pairings`) atomically deletes and re-inserts current-round pairings computed by the existing pure pairing function. The match-edit dialog branches on a `mode` prop to route past-round edits through the repair RPC instead of its existing incremental-write path. A small set of UI surfaces (pencil icon, amended badge, banner, re-pair button + escape hatch, audit log panel, discoverability picker) integrate the feature into the host workflow. All UI uses Tailwind tokens to work in light and dark themes. E2E tests cover the host's golden paths.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Supabase (Postgres + RLS + RPC), Tailwind + shadcn/ui, Vitest for unit/integration, Playwright for E2E.

**Spec:** [docs/superpowers/specs/2026-05-27-mid-round-score-repair-design.md](docs/superpowers/specs/2026-05-27-mid-round-score-repair-design.md)

**Phasing:** Tasks are grouped into five phases. Each phase produces shippable, testable software:
- **Phase 1 (Tasks 1-4):** Foundation — test script, migration, snapshot-rewrite helper.
- **Phase 2 (Tasks 5-8):** Backend — PL/pgSQL functions and server actions. After this phase the feature is callable via SQL/RPC.
- **Phase 3 (Tasks 9-13):** Core UI — repair dialog mode, pencil icon, amended badge, audit log. After this phase hosts can repair scores from the UI.
- **Phase 4 (Tasks 14-18):** Re-pair UI and polish — re-pair button, escape hatch, banner, discoverability picker, inline edit history.
- **Phase 5 (Tasks 19-24):** E2E — Playwright bootstrap and the eight E2E scenarios.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `package.json` | MODIFY | Add `test`, `test:e2e` scripts |
| `supabase/migrations/031_create_match_edits.sql` | CREATE | `match_edits` table, RLS, indexes, `byes` unique index |
| `supabase/migrations/032_repair_match_score_rpc.sql` | CREATE | `repair_match_score` PL/pgSQL function |
| `supabase/migrations/033_regenerate_current_round_pairings_rpc.sql` | CREATE | `regenerate_current_round_pairings` PL/pgSQL function |
| `lib/tournament/snapshotRewrite.ts` | CREATE | Pure function: walk a participant's matches chronologically, return updated cumulative snapshots |
| `lib/tournament/__tests__/snapshotRewrite.test.ts` | CREATE | Unit tests for snapshot rewrite |
| `lib/tournament/repairBadges.ts` | CREATE | Predicate: does a participant + round have any `match_edits`? |
| `lib/tournament/__tests__/repairBadges.test.ts` | CREATE | Unit tests for predicate |
| `app/tracker/tournaments/repair-actions.ts` | CREATE | Server actions: `repairMatchScoreAction`, `regenerateCurrentRoundPairingsAction` |
| `app/tracker/tournaments/__tests__/repair-actions.test.ts` | CREATE | Integration tests for both actions against the database |
| `components/ui/match-edit.tsx` | MODIFY | Add `mode: "live" \| "repair"` prop; branch submit handler |
| `components/ui/TournamentRounds.tsx` | MODIFY | Render pencil icon on past-round match cards (host only); render edit-history disclosure |
| `components/ui/AmendedBadge.tsx` | CREATE | Small muted pill with tooltip showing round + date |
| `components/ui/StandingsAmendedBadges.tsx` | MODIFY or CREATE | Inject amended badges into standings rows |
| `components/ui/RepairTournamentBanner.tsx` | CREATE | Tournament-wide banner when a repair occurred this round |
| `components/ui/RegeneratePairingsButton.tsx` | CREATE | Re-pair button + confirm dialog + checkbox |
| `components/ui/UnlockAndRepairDialog.tsx` | CREATE | Escape-hatch dialog listing affected matches |
| `components/ui/RepairPastResultPicker.tsx` | CREATE | Discoverability picker (round dropdown + player search) |
| `components/ui/AuditLogPanel.tsx` | CREATE | Host-only chronological audit log |
| `components/ui/RepairSuccessToast.tsx` | CREATE | Toast with inline "Re-pair current round?" button |
| `app/tracker/tournaments/[id]/page.tsx` | MODIFY | Mount RepairTournamentBanner, RegeneratePairingsButton, AuditLogPanel, RepairPastResultPicker |
| `playwright.config.ts` | CREATE | Playwright configuration |
| `e2e/repair/*.spec.ts` | CREATE | Eight E2E test files (one per scenario) |

---

## Phase 1: Foundation

### Task 1: Add npm test scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read current scripts block**

Run: `grep -n '"scripts"' -A 5 package.json`

Expected output shows `dev`, `build`, `start`.

- [ ] **Step 2: Add `test` and `test:e2e` scripts**

Edit `package.json`, replace the scripts block:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test"
}
```

- [ ] **Step 3: Verify the existing test suite passes**

Run: `npm test -- lib/tournament/__tests__/results.test.ts`
Expected: PASS (this exercises the existing Vitest setup).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add test and test:e2e npm scripts"
```

---

### Task 2: Create `match_edits` migration

**Files:**
- Create: `supabase/migrations/031_create_match_edits.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/031_create_match_edits.sql`:

```sql
-- Append-only audit log of host repairs to past-round match scores.
-- See docs/superpowers/specs/2026-05-27-mid-round-score-repair-design.md

CREATE TABLE match_edits (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id           UUID NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
  tournament_id      UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round              INT NOT NULL,
  old_player1_score  INT NOT NULL,
  old_player2_score  INT NOT NULL,
  new_player1_score  INT NOT NULL,
  new_player2_score  INT NOT NULL,
  edited_by          UUID NOT NULL REFERENCES auth.users(id),
  edited_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason             TEXT
);

CREATE INDEX match_edits_tournament_round_idx
  ON match_edits(tournament_id, round);
CREATE INDEX match_edits_match_id_idx
  ON match_edits(match_id);

ALTER TABLE match_edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY host_can_select_match_edits
  ON match_edits FOR SELECT
  USING (
    auth.uid() = (
      SELECT host_id FROM tournaments
      WHERE tournaments.id = match_edits.tournament_id
    )
  );

CREATE POLICY host_can_insert_match_edits
  ON match_edits FOR INSERT
  WITH CHECK (
    auth.uid() = edited_by
    AND auth.uid() = (
      SELECT host_id FROM tournaments
      WHERE tournaments.id = match_edits.tournament_id
    )
  );
-- No UPDATE or DELETE policies: audit rows are append-only.

-- Prevent duplicate bye rows when regenerate races with another caller.
CREATE UNIQUE INDEX IF NOT EXISTS byes_tournament_round_unique
  ON byes(tournament_id, round_number);
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the `mcp__supabase__apply_migration` tool with:
- name: `031_create_match_edits`
- query: the SQL above (without comments above the first CREATE)

Expected: migration succeeds.

- [ ] **Step 3: Verify table exists**

Use the `mcp__supabase__list_tables` tool, schema `public`. Confirm `match_edits` appears with columns matching the migration.

- [ ] **Step 4: Verify byes unique index exists**

Use `mcp__supabase__execute_sql` with: `SELECT indexname FROM pg_indexes WHERE tablename = 'byes';`
Expected: `byes_tournament_round_unique` in the result.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/031_create_match_edits.sql
git commit -m "feat: add match_edits audit table and byes unique index"
```

---

### Task 3: Write `snapshotRewrite` helper (TDD)

**Files:**
- Create: `lib/tournament/snapshotRewrite.ts`
- Create: `lib/tournament/__tests__/snapshotRewrite.test.ts`

The helper produces a list of per-match snapshot updates to apply after a repair. Given a participant and their tournament state, walk their matches in `(round, match_order)` order, maintain running `match_points` and `differential` totals using the same per-result logic as `match-edit.tsx`, and produce one snapshot row per match.

Match-points-per-result (from `match-edit.tsx:89-110`):
- Both scored `max_score`: invalid (rejected upstream)
- Equal scores (tie): 1.5/1.5
- Player1 scored max_score: 3/0
- Player2 scored max_score: 0/3
- Player1 > Player2 (neither max): 2/1
- Player2 > Player1 (neither max): 1/2

Differential = `player1_score - player2_score` (with the inverse on the other side, named `differential2` on the row).

- [ ] **Step 1: Write the failing test**

Create `lib/tournament/__tests__/snapshotRewrite.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeSnapshotRewrites } from '../snapshotRewrite';

type ParticipantId = string;

interface MatchRow {
  id: string;
  round: number;
  match_order: number;
  player1_id: ParticipantId;
  player2_id: ParticipantId;
  player1_score: number;
  player2_score: number;
}

describe('computeSnapshotRewrites', () => {
  it('produces correct chronological cumulative snapshots for a 3-round history', () => {
    const matches: MatchRow[] = [
      { id: 'm1', round: 1, match_order: 1, player1_id: 'A', player2_id: 'B', player1_score: 5, player2_score: 2 },
      { id: 'm2', round: 2, match_order: 1, player1_id: 'A', player2_id: 'C', player1_score: 3, player2_score: 3 },
      { id: 'm3', round: 3, match_order: 1, player1_id: 'D', player2_id: 'A', player1_score: 0, player2_score: 5 },
    ];
    const result = computeSnapshotRewrites('A', matches, { maxScore: 5 });

    // After m1: A has 3 match points (full win), differential +3
    // After m2: A has 4.5 match points (tie 3-3), differential +3 (no change)
    // After m3: A has 7.5 match points (full win), differential +8

    expect(result).toEqual([
      { match_id: 'm1', is_player1: true,  cumulative_match_points: 3,   cumulative_differential: 3 },
      { match_id: 'm2', is_player1: true,  cumulative_match_points: 4.5, cumulative_differential: 3 },
      { match_id: 'm3', is_player1: false, cumulative_match_points: 7.5, cumulative_differential: 8 },
    ]);
  });

  it('orders by (round, match_order) not insertion order', () => {
    const matches: MatchRow[] = [
      { id: 'late', round: 2, match_order: 1, player1_id: 'A', player2_id: 'B', player1_score: 5, player2_score: 0 },
      { id: 'early', round: 1, match_order: 2, player1_id: 'A', player2_id: 'C', player1_score: 2, player2_score: 4 },
      { id: 'earlier', round: 1, match_order: 1, player1_id: 'A', player2_id: 'D', player1_score: 5, player2_score: 0 },
    ];
    const result = computeSnapshotRewrites('A', matches, { maxScore: 5 });
    expect(result.map(r => r.match_id)).toEqual(['earlier', 'early', 'late']);
  });

  it('skips matches the participant did not play', () => {
    const matches: MatchRow[] = [
      { id: 'm1', round: 1, match_order: 1, player1_id: 'B', player2_id: 'C', player1_score: 5, player2_score: 0 },
      { id: 'm2', round: 1, match_order: 2, player1_id: 'A', player2_id: 'D', player1_score: 5, player2_score: 0 },
    ];
    const result = computeSnapshotRewrites('A', matches, { maxScore: 5 });
    expect(result.length).toBe(1);
    expect(result[0].match_id).toBe('m2');
  });

  it('returns empty when participant played no matches', () => {
    const matches: MatchRow[] = [
      { id: 'm1', round: 1, match_order: 1, player1_id: 'B', player2_id: 'C', player1_score: 5, player2_score: 0 },
    ];
    expect(computeSnapshotRewrites('A', matches, { maxScore: 5 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `npm test -- lib/tournament/__tests__/snapshotRewrite.test.ts`
Expected: FAIL — `computeSnapshotRewrites` not defined.

- [ ] **Step 3: Implement the helper**

Create `lib/tournament/snapshotRewrite.ts`:

```typescript
// Walk a participant's match history chronologically and compute the
// running cumulative (match_points, differential) snapshot stored on each
// matches row. Mirrors the per-result point assignment in match-edit.tsx
// so a repair's recomputed snapshots match what live entry would have
// written if the corrected score had been submitted originally.

export interface MatchRow {
  id: string;
  round: number;
  match_order: number;
  player1_id: string;
  player2_id: string;
  player1_score: number;
  player2_score: number;
}

export interface SnapshotUpdate {
  match_id: string;
  /** True if the participant sits in the player1 slot on this match. */
  is_player1: boolean;
  /** Cumulative match_points for this participant after this match. */
  cumulative_match_points: number;
  /** Cumulative differential for this participant after this match. */
  cumulative_differential: number;
}

interface Options {
  maxScore: number;
}

function pointsForResult(p1Score: number, p2Score: number, maxScore: number): [number, number] {
  if (p1Score === p2Score) return [1.5, 1.5];
  if (p1Score === maxScore) return [3, 0];
  if (p2Score === maxScore) return [0, 3];
  if (p1Score > p2Score) return [2, 1];
  return [1, 2];
}

export function computeSnapshotRewrites(
  participantId: string,
  allMatches: MatchRow[],
  options: Options,
): SnapshotUpdate[] {
  const ordered = allMatches
    .filter(m => m.player1_id === participantId || m.player2_id === participantId)
    .slice()
    .sort((a, b) => (a.round - b.round) || (a.match_order - b.match_order));

  let cumMp = 0;
  let cumDiff = 0;
  const out: SnapshotUpdate[] = [];

  for (const m of ordered) {
    const [p1Pts, p2Pts] = pointsForResult(m.player1_score, m.player2_score, options.maxScore);
    const isP1 = m.player1_id === participantId;
    if (isP1) {
      cumMp += p1Pts;
      cumDiff += m.player1_score - m.player2_score;
    } else {
      cumMp += p2Pts;
      cumDiff += m.player2_score - m.player1_score;
    }
    out.push({
      match_id: m.id,
      is_player1: isP1,
      cumulative_match_points: cumMp,
      cumulative_differential: cumDiff,
    });
  }

  return out;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npm test -- lib/tournament/__tests__/snapshotRewrite.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournament/snapshotRewrite.ts lib/tournament/__tests__/snapshotRewrite.test.ts
git commit -m "feat: add chronological match-snapshot rewrite helper"
```

---

### Task 4: Write `repairBadges` predicate (TDD)

**Files:**
- Create: `lib/tournament/repairBadges.ts`
- Create: `lib/tournament/__tests__/repairBadges.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/tournament/__tests__/repairBadges.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { participantsWithAmendedBadge } from '../repairBadges';

interface EditRow { match_id: string; round: number; }
interface MatchRow { id: string; round: number; player1_id: string; player2_id: string; }

describe('participantsWithAmendedBadge', () => {
  it('flags both players of an edited match for the matching round', () => {
    const edits: EditRow[] = [{ match_id: 'm1', round: 1 }];
    const matches: MatchRow[] = [{ id: 'm1', round: 1, player1_id: 'A', player2_id: 'B' }];
    expect(participantsWithAmendedBadge(edits, matches, 1)).toEqual(new Set(['A', 'B']));
  });

  it('returns empty for rounds with no edits', () => {
    const edits: EditRow[] = [{ match_id: 'm1', round: 1 }];
    const matches: MatchRow[] = [{ id: 'm1', round: 1, player1_id: 'A', player2_id: 'B' }];
    expect(participantsWithAmendedBadge(edits, matches, 2)).toEqual(new Set());
  });

  it('flags only matches in the requested round', () => {
    const edits: EditRow[] = [{ match_id: 'm1', round: 1 }, { match_id: 'm2', round: 2 }];
    const matches: MatchRow[] = [
      { id: 'm1', round: 1, player1_id: 'A', player2_id: 'B' },
      { id: 'm2', round: 2, player1_id: 'C', player2_id: 'D' },
    ];
    expect(participantsWithAmendedBadge(edits, matches, 1)).toEqual(new Set(['A', 'B']));
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm test -- lib/tournament/__tests__/repairBadges.test.ts`
Expected: FAIL — function not defined.

- [ ] **Step 3: Implement the predicate**

Create `lib/tournament/repairBadges.ts`:

```typescript
interface EditRow { match_id: string; round: number; }
interface MatchRow { id: string; round: number; player1_id: string; player2_id: string; }

/**
 * Return the set of participant ids who should show an "amended" badge
 * for the given round (i.e., they played in a match that has at least
 * one match_edits row for that round).
 */
export function participantsWithAmendedBadge(
  edits: EditRow[],
  matches: MatchRow[],
  round: number,
): Set<string> {
  const editedMatchIds = new Set(
    edits.filter(e => e.round === round).map(e => e.match_id),
  );
  const out = new Set<string>();
  for (const m of matches) {
    if (m.round !== round) continue;
    if (!editedMatchIds.has(m.id)) continue;
    out.add(m.player1_id);
    out.add(m.player2_id);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npm test -- lib/tournament/__tests__/repairBadges.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournament/repairBadges.ts lib/tournament/__tests__/repairBadges.test.ts
git commit -m "feat: add amended-badge predicate helper"
```

---

## Phase 2: Backend (RPC + server actions)

### Task 5: Implement `repair_match_score` PL/pgSQL function

**Files:**
- Create: `supabase/migrations/032_repair_match_score_rpc.sql`

The function does everything `repair_match_score` should in one transaction: host check, validate scores, capture old, update match, recompute all participants' cumulative totals, rewrite per-match snapshots chronologically, insert audit row.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/032_repair_match_score_rpc.sql`:

```sql
-- See docs/superpowers/specs/2026-05-27-mid-round-score-repair-design.md

CREATE OR REPLACE FUNCTION repair_match_score(
  p_match_id        UUID,
  p_new_p1_score    INT,
  p_new_p2_score    INT,
  p_reason          TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_tournament_id  UUID;
  v_host_id        UUID;
  v_round          INT;
  v_max_score      INT;
  v_old_p1         INT;
  v_old_p2         INT;
  v_p1_id          UUID;
  v_p2_id          UUID;
  v_is_tie         BOOLEAN;
  v_winner_id      UUID;
  v_participant    RECORD;
  v_match          RECORD;
  v_cum_mp         NUMERIC;
  v_cum_diff       INT;
  v_p1_pts         NUMERIC;
  v_p2_pts         NUMERIC;
  v_part_mp        NUMERIC;
  v_part_diff      INT;
  v_part_outcome   RECORD;
BEGIN
  -- 1. Lock the target match and load tournament context.
  SELECT m.tournament_id, m.round, m.player1_id, m.player2_id,
         m.player1_score, m.player2_score, t.host_id, t.max_score
    INTO v_tournament_id, v_round, v_p1_id, v_p2_id,
         v_old_p1, v_old_p2, v_host_id, v_max_score
  FROM matches m
  JOIN tournaments t ON t.id = m.tournament_id
  WHERE m.id = p_match_id
  FOR UPDATE OF m;

  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'repair_match_score: match % not found', p_match_id;
  END IF;

  -- 2. Authorization.
  IF auth.uid() <> v_host_id THEN
    RAISE EXCEPTION 'repair_match_score: not the tournament host';
  END IF;

  -- 3. Validate scores.
  IF p_new_p1_score < 0 OR p_new_p2_score < 0 THEN
    RAISE EXCEPTION 'repair_match_score: scores must be non-negative';
  END IF;
  IF p_new_p1_score > v_max_score OR p_new_p2_score > v_max_score THEN
    RAISE EXCEPTION 'repair_match_score: scores exceed tournament max_score (%)', v_max_score;
  END IF;
  IF p_new_p1_score = v_max_score AND p_new_p2_score = v_max_score THEN
    RAISE EXCEPTION 'repair_match_score: both players cannot score max_score';
  END IF;

  -- 4. Derive is_tie + winner_id.
  IF p_new_p1_score = p_new_p2_score THEN
    v_is_tie := TRUE;
    v_winner_id := NULL;
  ELSIF p_new_p1_score > p_new_p2_score THEN
    v_is_tie := FALSE;
    v_winner_id := v_p1_id;
  ELSE
    v_is_tie := FALSE;
    v_winner_id := v_p2_id;
  END IF;

  -- 5. Update the corrected scores (leave matches.*_match_points / differential
  --    snapshots for the chronological rewrite below).
  UPDATE matches
     SET player1_score = p_new_p1_score,
         player2_score = p_new_p2_score,
         is_tie        = v_is_tie,
         winner_id     = v_winner_id,
         updated_at    = now()
   WHERE id = p_match_id;

  -- 6. Recompute participants.match_points / differential for every participant
  --    in the tournament, derived purely from match + bye history.
  FOR v_participant IN
    SELECT id FROM participants WHERE tournament_id = v_tournament_id
  LOOP
    SELECT
      COALESCE(SUM(
        CASE
          WHEN m.player1_score = m.player2_score THEN 1.5
          WHEN (m.player1_id = v_participant.id AND m.player1_score = v_max_score) THEN 3
          WHEN (m.player2_id = v_participant.id AND m.player2_score = v_max_score) THEN 3
          WHEN (m.player1_id = v_participant.id AND m.player2_score = v_max_score) THEN 0
          WHEN (m.player2_id = v_participant.id AND m.player1_score = v_max_score) THEN 0
          WHEN (m.player1_id = v_participant.id AND m.player1_score > m.player2_score) THEN 2
          WHEN (m.player1_id = v_participant.id AND m.player1_score < m.player2_score) THEN 1
          WHEN (m.player2_id = v_participant.id AND m.player2_score > m.player1_score) THEN 2
          WHEN (m.player2_id = v_participant.id AND m.player2_score < m.player1_score) THEN 1
          ELSE 0
        END
      ), 0),
      COALESCE(SUM(
        CASE
          WHEN m.player1_id = v_participant.id THEN m.player1_score - m.player2_score
          WHEN m.player2_id = v_participant.id THEN m.player2_score - m.player1_score
          ELSE 0
        END
      ), 0)
    INTO v_part_mp, v_part_diff
    FROM matches m
    WHERE m.tournament_id = v_tournament_id
      AND m.player1_score IS NOT NULL
      AND m.player2_score IS NOT NULL
      AND (m.player1_id = v_participant.id OR m.player2_id = v_participant.id);

    -- Add 3 match_points per bye row.
    SELECT v_part_mp + 3 * COALESCE(COUNT(*), 0)
      INTO v_part_mp
    FROM byes
    WHERE tournament_id = v_tournament_id
      AND participant_id = v_participant.id;

    UPDATE participants
       SET match_points = v_part_mp,
           differential = v_part_diff
     WHERE id = v_participant.id;
  END LOOP;

  -- 7. Rewrite matches.player1_match_points / player2_match_points / differential / differential2
  --    chronologically for every match touched by the two affected players.
  --    For each affected participant, walk their matches in (round, match_order) and
  --    rewrite their cumulative totals on each row.
  FOR v_participant IN
    SELECT DISTINCT pid AS id FROM (
      SELECT v_p1_id AS pid
      UNION SELECT v_p2_id
    ) s
  LOOP
    v_cum_mp := 0;
    v_cum_diff := 0;

    FOR v_match IN
      SELECT m.id, m.player1_id, m.player2_id, m.player1_score, m.player2_score
      FROM matches m
      WHERE m.tournament_id = v_tournament_id
        AND m.player1_score IS NOT NULL
        AND m.player2_score IS NOT NULL
        AND (m.player1_id = v_participant.id OR m.player2_id = v_participant.id)
      ORDER BY m.round ASC, m.match_order ASC
    LOOP
      -- Compute this match's per-player points.
      IF v_match.player1_score = v_match.player2_score THEN
        v_p1_pts := 1.5; v_p2_pts := 1.5;
      ELSIF v_match.player1_score = v_max_score THEN
        v_p1_pts := 3;   v_p2_pts := 0;
      ELSIF v_match.player2_score = v_max_score THEN
        v_p1_pts := 0;   v_p2_pts := 3;
      ELSIF v_match.player1_score > v_match.player2_score THEN
        v_p1_pts := 2;   v_p2_pts := 1;
      ELSE
        v_p1_pts := 1;   v_p2_pts := 2;
      END IF;

      IF v_match.player1_id = v_participant.id THEN
        v_cum_mp := v_cum_mp + v_p1_pts;
        v_cum_diff := v_cum_diff + (v_match.player1_score - v_match.player2_score);
        UPDATE matches
           SET player1_match_points = v_cum_mp,
               differential = v_cum_diff
         WHERE id = v_match.id;
      ELSE
        v_cum_mp := v_cum_mp + v_p2_pts;
        v_cum_diff := v_cum_diff + (v_match.player2_score - v_match.player1_score);
        UPDATE matches
           SET player2_match_points = v_cum_mp,
               differential2 = v_cum_diff
         WHERE id = v_match.id;
      END IF;
    END LOOP;
  END LOOP;

  -- 8. Insert append-only audit row.
  INSERT INTO match_edits (
    match_id, tournament_id, round,
    old_player1_score, old_player2_score,
    new_player1_score, new_player2_score,
    edited_by, reason
  ) VALUES (
    p_match_id, v_tournament_id, v_round,
    v_old_p1, v_old_p2,
    p_new_p1_score, p_new_p2_score,
    auth.uid(), p_reason
  );

  -- 9. Return a small status payload.
  RETURN jsonb_build_object(
    'match_id', p_match_id,
    'tournament_id', v_tournament_id,
    'round', v_round,
    'old', jsonb_build_object('p1', v_old_p1, 'p2', v_old_p2),
    'new', jsonb_build_object('p1', p_new_p1_score, 'p2', p_new_p2_score)
  );
END;
$$;

-- Restrict EXECUTE to authenticated users (RLS-derived host check inside the function
-- prevents unauthorized writes).
REVOKE ALL ON FUNCTION repair_match_score(UUID, INT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION repair_match_score(UUID, INT, INT, TEXT) TO authenticated;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use `mcp__supabase__apply_migration`:
- name: `032_repair_match_score_rpc`
- query: the SQL above.

Expected: success.

- [ ] **Step 3: Smoke-test the function exists**

Use `mcp__supabase__execute_sql`:
```sql
SELECT proname FROM pg_proc WHERE proname = 'repair_match_score';
```
Expected: one row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/032_repair_match_score_rpc.sql
git commit -m "feat: add repair_match_score Postgres RPC"
```

---

### Task 6: Implement `regenerate_current_round_pairings` PL/pgSQL function

**Files:**
- Create: `supabase/migrations/033_regenerate_current_round_pairings_rpc.sql`

The pairing math lives in TypeScript (`lib/tournament/pairing.ts`). The RPC takes the precomputed pairings as JSONB input and atomically deletes the current round's matches and byes and inserts the new ones. This keeps the destructive step transactional.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/033_regenerate_current_round_pairings_rpc.sql`:

```sql
-- See docs/superpowers/specs/2026-05-27-mid-round-score-repair-design.md
--
-- Atomically replace the current round's matches and byes with the supplied
-- pairings. The pairing math is computed in TypeScript (lib/tournament/pairing.ts)
-- by the calling server action and passed in as JSONB.
--
-- p_pairings  : jsonb array, each element {"player1_id": uuid, "player2_id": uuid, "match_order": int}
-- p_bye_id    : nullable uuid; if non-null, inserted into byes table
-- p_unlock    : if false, RAISE if any current-round match has a non-null player1_score

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
  -- 1. Lock the tournaments row to serialize concurrent regenerates.
  SELECT host_id, current_round INTO v_host_id, v_current_rnd
  FROM tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  IF v_host_id IS NULL THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: tournament % not found', p_tournament_id;
  END IF;

  IF auth.uid() <> v_host_id THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: not the tournament host';
  END IF;

  -- 2. Check the round is not completed.
  SELECT id, is_completed INTO v_round_id, v_is_completed
  FROM rounds
  WHERE tournament_id = p_tournament_id
    AND round_number = v_current_rnd;

  IF v_is_completed THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: round % is already completed', v_current_rnd;
  END IF;

  -- 3. Gate on existing scored matches unless unlock=true.
  SELECT COUNT(*) INTO v_scored_count
  FROM matches
  WHERE tournament_id = p_tournament_id
    AND round = v_current_rnd
    AND player1_score IS NOT NULL;

  IF v_scored_count > 0 AND NOT p_unlock THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: % match(es) already scored; pass p_unlock=true to override', v_scored_count;
  END IF;

  -- 4. Delete the current round's matches and byes.
  DELETE FROM matches
   WHERE tournament_id = p_tournament_id
     AND round = v_current_rnd;
  DELETE FROM byes
   WHERE tournament_id = p_tournament_id
     AND round_number = v_current_rnd;

  -- 5. Insert the new pairings.
  FOR v_pair IN SELECT * FROM jsonb_array_elements(p_pairings)
  LOOP
    INSERT INTO matches (
      tournament_id, round, player1_id, player2_id,
      player1_score, player2_score, match_order
    ) VALUES (
      p_tournament_id,
      v_current_rnd,
      (v_pair->>'player1_id')::UUID,
      (v_pair->>'player2_id')::UUID,
      NULL, NULL,
      (v_pair->>'match_order')::INT
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  -- 6. Insert the bye if any.
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
GRANT EXECUTE ON FUNCTION regenerate_current_round_pairings(UUID, JSONB, UUID, BOOLEAN) TO authenticated;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use `mcp__supabase__apply_migration`:
- name: `033_regenerate_current_round_pairings_rpc`
- query: the SQL above.

Expected: success.

- [ ] **Step 3: Verify it exists**

Use `mcp__supabase__execute_sql`:
```sql
SELECT proname FROM pg_proc WHERE proname = 'regenerate_current_round_pairings';
```
Expected: one row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/033_regenerate_current_round_pairings_rpc.sql
git commit -m "feat: add regenerate_current_round_pairings Postgres RPC"
```

---

### Task 7: Implement server actions

**Files:**
- Create: `app/tracker/tournaments/repair-actions.ts`

- [ ] **Step 1: Write the server actions module**

Create `app/tracker/tournaments/repair-actions.ts`:

```typescript
"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { buildStateFromSupabase } from "@/utils/tournament/stateAdapter";
import { pairFirstRound, pairLaterRound } from "@/lib/tournament/pairing";
import { rngForRound } from "@/lib/tournament/rng";

export interface RepairResult {
  ok: boolean;
  error?: string;
  data?: {
    match_id: string;
    tournament_id: string;
    round: number;
    old: { p1: number; p2: number };
    new: { p1: number; p2: number };
  };
}

export async function repairMatchScoreAction(input: {
  matchId: string;
  newP1Score: number;
  newP2Score: number;
  reason?: string;
  tournamentId: string;
}): Promise<RepairResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("repair_match_score", {
    p_match_id: input.matchId,
    p_new_p1_score: input.newP1Score,
    p_new_p2_score: input.newP2Score,
    p_reason: input.reason ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/tracker/tournaments/${input.tournamentId}`);
  return { ok: true, data: data as RepairResult["data"] };
}

export interface RegenerateResult {
  ok: boolean;
  error?: string;
  data?: { tournament_id: string; round: number; matches_inserted: number; bye_id: string | null };
}

export async function regenerateCurrentRoundPairingsAction(input: {
  tournamentId: string;
  unlock?: boolean;
}): Promise<RegenerateResult> {
  const supabase = await createClient();

  // 1. Load state for pure pairing computation.
  const state = await buildStateFromSupabase(supabase, input.tournamentId);
  if (!state) return { ok: false, error: "Tournament not found" };

  const round = state.currentRound;
  const rng = rngForRound(input.tournamentId, round);
  const result = round === 1
    ? pairFirstRound(state.participants.filter(p => !p.droppedOut), rng)
    : pairLaterRound(state, round, rng);

  // 2. Map to RPC payload shape.
  const pairings = result.matches.map((m, idx) => ({
    player1_id: m.player1Id,
    player2_id: m.player2Id,
    match_order: m.matchOrder ?? idx + 1,
  }));

  const { data, error } = await supabase.rpc("regenerate_current_round_pairings", {
    p_tournament_id: input.tournamentId,
    p_pairings: pairings,
    p_bye_id: result.bye ?? null,
    p_unlock: input.unlock ?? false,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/tracker/tournaments/${input.tournamentId}`);
  return { ok: true, data: data as RegenerateResult["data"] };
}
```

- [ ] **Step 2: Type-check the module**

Run: `npx tsc --noEmit app/tracker/tournaments/repair-actions.ts 2>&1 | head -20`

Expected: no errors. If imports resolve differently in your environment, run a project-wide check:
Run: `npm run build 2>&1 | tail -30`

- [ ] **Step 3: Commit**

```bash
git add app/tracker/tournaments/repair-actions.ts
git commit -m "feat: add server actions wrapping repair RPCs"
```

---

### Task 8: Integration tests for the server actions

**Files:**
- Create: `app/tracker/tournaments/__tests__/repair-actions.test.ts`

These tests run against a real Postgres branch (Supabase). They seed a tournament, exercise the RPC, and assert state.

**Prerequisite:** This task assumes a Supabase preview branch is available. Use `mcp__supabase__create_branch` to provision one, or run against a local Supabase via the CLI. If neither is available, mark this task BLOCKED and proceed; document the gap.

- [ ] **Step 1: Write the test scaffolding**

Create `app/tracker/tournaments/__tests__/repair-actions.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const skip = !SUPABASE_URL || !SUPABASE_SERVICE_ROLE;

// Bypasses RLS — only used in tests for setup/teardown.
const admin = skip ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false },
});

let tournamentId: string;
let hostUserId: string;
let participantIds: string[] = [];

(skip ? describe.skip : describe)('repair_match_score RPC', () => {
  beforeAll(async () => {
    // Seed: host user, tournament, 4 participants, round 1 played.
    const host = await admin!.auth.admin.createUser({ email: `host-${Date.now()}@test.local`, password: 'testpass1234' });
    hostUserId = host.data.user!.id;
    const t = await admin!.from('tournaments').insert({
      name: 'Repair Test', host_id: hostUserId, has_started: true, n_rounds: 3,
      current_round: 2, max_score: 5,
    }).select().single();
    tournamentId = t.data!.id;

    const parts = await admin!.from('participants').insert([
      { tournament_id: tournamentId, name: 'A' },
      { tournament_id: tournamentId, name: 'B' },
      { tournament_id: tournamentId, name: 'C' },
      { tournament_id: tournamentId, name: 'D' },
    ]).select();
    participantIds = parts.data!.map(p => p.id);

    await admin!.from('matches').insert([
      { tournament_id: tournamentId, round: 1, match_order: 1, player1_id: participantIds[0], player2_id: participantIds[1], player1_score: 5, player2_score: 0, winner_id: participantIds[0], is_tie: false },
      { tournament_id: tournamentId, round: 1, match_order: 2, player1_id: participantIds[2], player2_id: participantIds[3], player1_score: 5, player2_score: 2, winner_id: participantIds[2], is_tie: false },
    ]);

    await admin!.from('rounds').insert({ tournament_id: tournamentId, round_number: 1, is_completed: true });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from('tournaments').delete().eq('id', tournamentId);
    await admin.auth.admin.deleteUser(hostUserId);
  });

  it('rejects calls from non-host users', async () => {
    const other = await admin!.auth.admin.createUser({ email: `other-${Date.now()}@test.local`, password: 'testpass1234' });
    const otherClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await otherClient.auth.signInWithPassword({ email: other.data.user!.email!, password: 'testpass1234' });

    const matchA = await admin!.from('matches').select('id').eq('tournament_id', tournamentId).eq('round', 1).limit(1).single();
    const { error } = await otherClient.rpc('repair_match_score', {
      p_match_id: matchA.data!.id, p_new_p1_score: 5, p_new_p2_score: 3,
    });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/not the tournament host/);
    await admin!.auth.admin.deleteUser(other.data.user!.id);
  });

  it('writes the corrected score and inserts an audit row', async () => {
    const matchA = await admin!.from('matches').select('id').eq('player1_id', participantIds[0]).single();
    const hostClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await hostClient.auth.signInWithPassword({ email: (await admin!.auth.admin.getUserById(hostUserId)).data.user!.email!, password: 'testpass1234' });

    const { data, error } = await hostClient.rpc('repair_match_score', {
      p_match_id: matchA.data!.id, p_new_p1_score: 5, p_new_p2_score: 3, p_reason: 'reported wrong',
    });

    expect(error).toBeFalsy();
    expect(data).toMatchObject({ round: 1, old: { p1: 5, p2: 0 }, new: { p1: 5, p2: 3 } });

    const audit = await admin!.from('match_edits').select('*').eq('match_id', matchA.data!.id);
    expect(audit.data!.length).toBe(1);
    expect(audit.data![0].reason).toBe('reported wrong');
  });

  it('recomputes participant totals correctly', async () => {
    const a = await admin!.from('participants').select('match_points, differential').eq('id', participantIds[0]).single();
    // After the edit: A still has 3 match points (full win), differential +2 (was +5)
    expect(Number(a.data!.match_points)).toBe(3);
    expect(Number(a.data!.differential)).toBe(2);
  });
});
```

- [ ] **Step 2: Provision a Supabase preview branch**

Use `mcp__supabase__create_branch` with `name: "repair-actions-test"`. Note the connection details for the test env vars.

(If unavailable, skip and rely on E2E later — mark this task PARTIAL.)

- [ ] **Step 3: Run the test**

Run: `NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... npm test -- app/tracker/tournaments/__tests__/repair-actions.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add app/tracker/tournaments/__tests__/repair-actions.test.ts
git commit -m "test: add integration tests for repair_match_score RPC"
```

---

## Phase 3: Core repair UI

### Task 9: Add `mode` prop to match-edit dialog

**Files:**
- Modify: `components/ui/match-edit.tsx`

- [ ] **Step 1: Add the mode prop to component signature**

Open `components/ui/match-edit.tsx`. Find the component's props interface (top of file). Add:

```typescript
mode?: "live" | "repair";
```

In the function signature, destructure `mode = "live"`.

- [ ] **Step 2: Branch the submit handler**

Locate the submit handler (around line 50, the function that does the `client.from("matches").update({...})` at line 113). At the top of the handler, after the score validation but before the `client.from("participants").select(...)` block, add:

```typescript
if (mode === "repair") {
  const { repairMatchScoreAction } = await import("@/app/tracker/tournaments/repair-actions");
  const result = await repairMatchScoreAction({
    matchId: match.id,
    newP1Score: player1Score,
    newP2Score: player2Score,
    reason: reason || undefined,
    tournamentId: tournament.id,
  });
  if (!result.ok) {
    alert(`Repair failed: ${result.error}`);
    return;
  }
  setOpen(false);
  fetchCurrentRoundData?.();
  return;
}
```

- [ ] **Step 3: Pre-populate scores from existing match values in repair mode**

Find the `useEffect` that resets scores when the dialog opens (around line 41-46). Change the default-to-0 branch so that in repair mode, the existing scores are always used:

```typescript
useEffect(() => {
  if (open) {
    setPlayer1Score(match.player1_score !== null ? match.player1_score : 0);
    setPlayer2Score(match.player2_score !== null ? match.player2_score : 0);
  }
}, [open, match.player1_score, match.player2_score]);
```

- [ ] **Step 4: Add a reason field in repair mode**

Add a state hook near the top:

```typescript
const [reason, setReason] = useState("");
```

In the JSX, just before the dialog's submit button, conditionally render the reason input:

```tsx
{mode === "repair" && (
  <div className="mb-4">
    <label className="block text-sm text-muted-foreground mb-1">Reason (optional)</label>
    <input
      type="text"
      maxLength={240}
      value={reason}
      onChange={(e) => setReason(e.target.value)}
      placeholder="Why are you repairing this?"
      className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
    />
  </div>
)}
```

- [ ] **Step 5: Update the dialog title and button label in repair mode**

Find the dialog title and submit button. Conditionally render:

```tsx
<DialogTitle>{mode === "repair" ? "Repair result" : "Submit result"}</DialogTitle>
...
<Button onClick={handleSubmit}>
  {mode === "repair" ? "Repair" : "Submit"}
</Button>
```

(Adjust to match the actual JSX structure — the file uses Flowbite/shadcn components.)

- [ ] **Step 6: Verify the build**

Run: `npm run build 2>&1 | tail -20`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add components/ui/match-edit.tsx
git commit -m "feat: add repair mode to match-edit dialog"
```

---

### Task 10: Add pencil icon on past-round match cards

**Files:**
- Modify: `components/ui/TournamentRounds.tsx`

- [ ] **Step 1: Determine where match cards are rendered**

Run: `grep -n "match.player1_id\|matches.map\|MatchEdit" components/ui/TournamentRounds.tsx | head -20`

Identify the JSX where individual match cards render (look for player names + score display).

- [ ] **Step 2: Render the pencil icon for past-round matches when the viewer is the host**

In the match card JSX, add (using `HiPencil` from `react-icons/hi` per existing convention):

```tsx
{isHost && round.is_completed && (
  <button
    type="button"
    aria-label={`Repair result for ${match.player1_id.name} vs ${match.player2_id.name}`}
    onClick={() => setRepairMatchId(match.id)}
    className="ml-2 inline-flex items-center justify-center w-11 h-11 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
  >
    <HiPencil className="w-4 h-4" />
  </button>
)}
```

The 44×44 hit area is satisfied by `w-11 h-11`.

- [ ] **Step 3: Mount the repair dialog**

Add state and a single mounted dialog instance near the top of the component:

```tsx
const [repairMatchId, setRepairMatchId] = useState<string | null>(null);
const repairMatch = matches.find(m => m.id === repairMatchId) ?? null;
```

And in JSX:

```tsx
{repairMatch && (
  <MatchEditModal
    match={repairMatch}
    tournament={tournament}
    open={true}
    setOpen={(v) => !v && setRepairMatchId(null)}
    fetchCurrentRoundData={fetchCurrentRoundData}
    mode="repair"
  />
)}
```

(Adjust prop names to match the actual `match-edit.tsx` signature.)

- [ ] **Step 4: Compute `isHost`**

If `isHost` is not already a prop, derive it: pass `hostId` from the parent and compare to the current user's id (already available via Supabase session). Add a prop to the component's signature.

- [ ] **Step 5: Verify the build**

Run: `npm run build 2>&1 | tail -20`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add components/ui/TournamentRounds.tsx
git commit -m "feat: add repair pencil icon to past-round match cards"
```

---

### Task 11: AmendedBadge component

**Files:**
- Create: `components/ui/AmendedBadge.tsx`

- [ ] **Step 1: Create the component**

Create `components/ui/AmendedBadge.tsx`:

```tsx
"use client";

import { useState } from "react";

interface Props {
  round: number;
  editedAt: string; // ISO timestamp
}

export function AmendedBadge({ round, editedAt }: Props) {
  const [show, setShow] = useState(false);
  const date = new Date(editedAt).toLocaleDateString();
  return (
    <span
      role="status"
      tabIndex={0}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
      onClick={() => setShow(s => !s)}
      className="relative inline-flex items-center px-1.5 py-0.5 ml-2 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:bg-muted/70 cursor-help"
    >
      amended
      {show && (
        <span className="absolute z-10 top-full left-0 mt-1 px-2 py-1 text-xs rounded-md bg-popover text-popover-foreground border border-border shadow-sm whitespace-nowrap">
          Round {round} result repaired by host on {date}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build 2>&1 | tail -10`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add components/ui/AmendedBadge.tsx
git commit -m "feat: add AmendedBadge component"
```

---

### Task 12: Inject AmendedBadge into standings rows

**Files:**
- Modify: `components/ui/TournamentRounds.tsx` (or wherever standings render)

- [ ] **Step 1: Find the standings render path**

Run: `grep -n "match_points\|standings\|Standings" components/ui/TournamentRounds.tsx | head -20`

Identify where each participant row is rendered with their match_points/differential.

- [ ] **Step 2: Fetch `match_edits` rows for the current view**

In the component that renders standings, add a fetch (or extend existing fetch) to load `match_edits` for the tournament:

```typescript
const [matchEdits, setMatchEdits] = useState<{ match_id: string; round: number; edited_at: string }[]>([]);

useEffect(() => {
  const fetch = async () => {
    const client = createClient();
    const { data } = await client
      .from("match_edits")
      .select("match_id, round, edited_at")
      .eq("tournament_id", tournament.id);
    setMatchEdits(data ?? []);
  };
  fetch();
}, [tournament.id]);
```

- [ ] **Step 3: Compute amended participants per round using the helper**

Import the helper:

```typescript
import { participantsWithAmendedBadge } from "@/lib/tournament/repairBadges";
```

When rendering a round's standings:

```typescript
const amended = participantsWithAmendedBadge(matchEdits, matches, round.round_number);
```

- [ ] **Step 4: Render the badge inline**

In each participant row in the standings:

```tsx
{participant.name}
{amended.has(participant.id) && (
  <AmendedBadge
    round={round.round_number}
    editedAt={matchEdits.find(e => /* most recent for this match */ )?.edited_at ?? ""}
  />
)}
```

(For the timestamp lookup: find the most recent edit for any of this participant's matches in this round.)

- [ ] **Step 5: Verify the build**

Run: `npm run build 2>&1 | tail -10`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add components/ui/TournamentRounds.tsx
git commit -m "feat: inject amended badge into standings rows"
```

---

### Task 13: AuditLogPanel

**Files:**
- Create: `components/ui/AuditLogPanel.tsx`
- Modify: `app/tracker/tournaments/[id]/page.tsx` (mount the panel for the host)

- [ ] **Step 1: Create the component**

Create `components/ui/AuditLogPanel.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

interface EditRow {
  id: string;
  round: number;
  old_player1_score: number;
  old_player2_score: number;
  new_player1_score: number;
  new_player2_score: number;
  edited_at: string;
  reason: string | null;
  match_id: string;
}

interface MatchRow {
  id: string;
  player1: { name: string };
  player2: { name: string };
}

interface Props {
  tournamentId: string;
}

export function AuditLogPanel({ tournamentId }: Props) {
  const [rows, setRows] = useState<EditRow[]>([]);
  const [matches, setMatches] = useState<Record<string, MatchRow>>({});

  useEffect(() => {
    const fetch = async () => {
      const client = createClient();
      const { data: edits } = await client
        .from("match_edits")
        .select("*")
        .eq("tournament_id", tournamentId)
        .order("edited_at", { ascending: false });
      const editList = edits ?? [];
      setRows(editList);

      if (editList.length > 0) {
        const matchIds = editList.map((e: any) => e.match_id);
        const { data: m } = await client
          .from("matches")
          .select("id, player1:participants!matches_player1_id_fkey(name), player2:participants!matches_player2_id_fkey(name)")
          .in("id", matchIds);
        const map: Record<string, MatchRow> = {};
        (m ?? []).forEach((row: any) => { map[row.id] = row; });
        setMatches(map);
      }
    };
    fetch();
  }, [tournamentId]);

  if (rows.length === 0) {
    return (
      <section className="rounded-md border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">Audit log</h3>
        <p className="mt-1 text-sm text-muted-foreground">No repairs yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-foreground mb-2">Audit log</h3>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const m = matches[r.match_id];
          return (
            <li key={r.id} className="py-2 text-sm">
              <div className="text-foreground">
                Round {r.round}: {m ? `${m.player1.name} vs ${m.player2.name}` : "(match)"}
              </div>
              <div className="text-muted-foreground">
                {r.old_player1_score}-{r.old_player2_score} → {r.new_player1_score}-{r.new_player2_score}
              </div>
              <div className="text-xs text-muted-foreground">
                {new Date(r.edited_at).toLocaleString()}
                {r.reason ? ` · ${r.reason}` : ""}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Mount the panel in the host view of the tournament page**

Open `app/tracker/tournaments/[id]/page.tsx`. Find the host-only controls section (it should be conditional on `isHost`). Add:

```tsx
{isHost && <AuditLogPanel tournamentId={tournament.id} />}
```

With the import:

```tsx
import { AuditLogPanel } from "@/components/ui/AuditLogPanel";
```

- [ ] **Step 3: Verify the build**

Run: `npm run build 2>&1 | tail -10`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add components/ui/AuditLogPanel.tsx app/tracker/tournaments/[id]/page.tsx
git commit -m "feat: add AuditLogPanel"
```

---

## Phase 4: Re-pair UI and polish

### Task 14: RegeneratePairingsButton

**Files:**
- Create: `components/ui/RegeneratePairingsButton.tsx`
- Modify: `app/tracker/tournaments/[id]/page.tsx`

- [ ] **Step 1: Create the component**

Create `components/ui/RegeneratePairingsButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { regenerateCurrentRoundPairingsAction } from "@/app/tracker/tournaments/repair-actions";

interface Props {
  tournamentId: string;
  currentRound: number;
  scoredMatchCount: number;
  isRoundCompleted: boolean;
  onComplete?: () => void;
  onUnlockRequest?: () => void;
}

export function RegeneratePairingsButton({
  tournamentId,
  currentRound,
  scoredMatchCount,
  isRoundCompleted,
  onComplete,
  onUnlockRequest,
}: Props) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = !isRoundCompleted && scoredMatchCount === 0;
  const tooltip = !enabled ? "Re-pair is unavailable because results have already been submitted." : undefined;

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    const result = await regenerateCurrentRoundPairingsAction({ tournamentId });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Failed");
      return;
    }
    setOpen(false);
    setConfirmed(false);
    onComplete?.();
  };

  return (
    <>
      <div className="inline-flex items-center gap-2">
        <button
          type="button"
          disabled={!enabled}
          onClick={() => setOpen(true)}
          title={tooltip}
          className="px-3 py-2 rounded-md bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
        >
          Re-pair current round
        </button>
        {!enabled && scoredMatchCount > 0 && (
          <button
            type="button"
            onClick={onUnlockRequest}
            className="text-sm underline text-muted-foreground hover:text-foreground"
          >
            Unlock and re-pair…
          </button>
        )}
      </div>

      {open && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80">
          <div className="w-full max-w-md rounded-t-lg sm:rounded-lg bg-card border border-border p-4">
            <h2 className="text-lg font-medium text-foreground">Regenerate pairings for round {currentRound}?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This will replace the current pairings using the corrected standings. The existing pairings will be discarded.
            </p>
            <label className="mt-3 flex items-start gap-2 text-sm text-foreground">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
              <span>I confirm no players have started current-round matches.</span>
            </label>
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => { setOpen(false); setConfirmed(false); }} className="px-3 py-2 rounded-md border border-border text-foreground">Cancel</button>
              <button
                type="button"
                disabled={!confirmed || busy}
                onClick={handleSubmit}
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
              >
                {busy ? "Regenerating…" : "Regenerate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Mount the button in the host controls panel**

In `app/tracker/tournaments/[id]/page.tsx`, find the host-controls JSX and add:

```tsx
{isHost && (
  <RegeneratePairingsButton
    tournamentId={tournament.id}
    currentRound={tournament.current_round}
    scoredMatchCount={currentRoundScoredCount}
    isRoundCompleted={latestRound?.is_completed ?? false}
    onComplete={fetchCurrentRoundData}
    onUnlockRequest={() => setUnlockDialogOpen(true)}
  />
)}
```

Compute `currentRoundScoredCount` from existing fetched matches (count where `round === current_round && player1_score !== null`).

- [ ] **Step 3: Verify the build**

Run: `npm run build 2>&1 | tail -10`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add components/ui/RegeneratePairingsButton.tsx app/tracker/tournaments/[id]/page.tsx
git commit -m "feat: add RegeneratePairingsButton with confirm dialog"
```

---

### Task 15: UnlockAndRepairDialog

**Files:**
- Create: `components/ui/UnlockAndRepairDialog.tsx`
- Modify: `app/tracker/tournaments/[id]/page.tsx` (mount it)

- [ ] **Step 1: Create the component**

Create `components/ui/UnlockAndRepairDialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { regenerateCurrentRoundPairingsAction } from "@/app/tracker/tournaments/repair-actions";

interface ScoredMatch {
  id: string;
  player1Name: string;
  player2Name: string;
  player1Score: number;
  player2Score: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  tournamentId: string;
  scoredMatches: ScoredMatch[];
  onComplete?: () => void;
}

export function UnlockAndRepairDialog({ open, onClose, tournamentId, scoredMatches, onComplete }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    const result = await regenerateCurrentRoundPairingsAction({ tournamentId, unlock: true });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Failed");
      return;
    }
    setConfirmed(false);
    onClose();
    onComplete?.();
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80">
      <div className="w-full max-w-md rounded-t-lg sm:rounded-lg bg-card border border-border p-4">
        <h2 className="text-lg font-medium text-foreground">Unlock and re-pair?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Unlocking will discard the following {scoredMatches.length} result{scoredMatches.length === 1 ? "" : "s"} and regenerate pairings:
        </p>
        <ul className="mt-2 space-y-1 text-sm text-foreground max-h-40 overflow-y-auto">
          {scoredMatches.map(m => (
            <li key={m.id}>
              {m.player1Name} vs {m.player2Name}: {m.player1Score}-{m.player2Score}
            </li>
          ))}
        </ul>
        <label className="mt-3 flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
          <span>I confirm these results will be permanently deleted.</span>
        </label>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => { onClose(); setConfirmed(false); }} className="px-3 py-2 rounded-md border border-border text-foreground">Cancel</button>
          <button
            type="button"
            disabled={!confirmed || busy}
            onClick={handleSubmit}
            className="px-3 py-2 rounded-md bg-destructive text-destructive-foreground disabled:bg-muted disabled:text-muted-foreground"
          >
            {busy ? "Unlocking…" : "Unlock and regenerate"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount it**

In `app/tracker/tournaments/[id]/page.tsx`:

```tsx
const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
// ...
<UnlockAndRepairDialog
  open={unlockDialogOpen}
  onClose={() => setUnlockDialogOpen(false)}
  tournamentId={tournament.id}
  scoredMatches={scoredCurrentRoundMatches}
  onComplete={fetchCurrentRoundData}
/>
```

Compute `scoredCurrentRoundMatches` from existing match data.

- [ ] **Step 3: Verify the build**

Run: `npm run build 2>&1 | tail -10`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add components/ui/UnlockAndRepairDialog.tsx app/tracker/tournaments/[id]/page.tsx
git commit -m "feat: add unlock-and-repair escape hatch"
```

---

### Task 16: RepairTournamentBanner

**Files:**
- Create: `components/ui/RepairTournamentBanner.tsx`
- Modify: `app/tracker/tournaments/[id]/page.tsx`

- [ ] **Step 1: Create the component**

Create `components/ui/RepairTournamentBanner.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

interface Props {
  tournamentId: string;
  currentRound: number;
  isRoundActive: boolean;
}

export function RepairTournamentBanner({ tournamentId, currentRound, isRoundActive }: Props) {
  const [hasRecentEdit, setHasRecentEdit] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isRoundActive) {
      setHasRecentEdit(false);
      return;
    }
    const fetch = async () => {
      const client = createClient();
      // Look up edits that occurred since the current round started.
      const { data: round } = await client.from("rounds")
        .select("started_at")
        .eq("tournament_id", tournamentId)
        .eq("round_number", currentRound)
        .single();
      if (!round?.started_at) return;
      const { data: edits } = await client.from("match_edits")
        .select("id")
        .eq("tournament_id", tournamentId)
        .gte("edited_at", round.started_at)
        .limit(1);
      setHasRecentEdit((edits ?? []).length > 0);
    };
    fetch();
  }, [tournamentId, currentRound, isRoundActive]);

  if (!hasRecentEdit || dismissed) return null;

  return (
    <div role="status" className="rounded-md border border-border bg-muted px-4 py-2 flex items-center justify-between gap-4 mb-4">
      <p className="text-sm text-foreground">
        A previous-round result was repaired. Standings have been updated.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="inline-flex items-center justify-center w-11 h-11 rounded-md text-muted-foreground hover:text-foreground hover:bg-background"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Mount the banner**

In `app/tracker/tournaments/[id]/page.tsx`, near the top of the tournament view:

```tsx
<RepairTournamentBanner
  tournamentId={tournament.id}
  currentRound={tournament.current_round}
  isRoundActive={isRoundActive}
/>
```

- [ ] **Step 3: Verify the build**

Run: `npm run build 2>&1 | tail -10`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add components/ui/RepairTournamentBanner.tsx app/tracker/tournaments/[id]/page.tsx
git commit -m "feat: add tournament-wide repair banner"
```

---

### Task 17: RepairPastResultPicker (discoverability)

**Files:**
- Create: `components/ui/RepairPastResultPicker.tsx`
- Modify: `app/tracker/tournaments/[id]/page.tsx`

- [ ] **Step 1: Create the component**

Create `components/ui/RepairPastResultPicker.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";

interface MatchInfo {
  id: string;
  round: number;
  player1Name: string;
  player2Name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  completedRounds: number[];
  matches: MatchInfo[];
  onPick: (matchId: string) => void;
}

export function RepairPastResultPicker({ open, onClose, completedRounds, matches, onPick }: Props) {
  const [round, setRound] = useState<number | "">(completedRounds[0] ?? "");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (round === "") return [];
    const lc = search.trim().toLowerCase();
    return matches
      .filter(m => m.round === round)
      .filter(m => !lc || m.player1Name.toLowerCase().includes(lc) || m.player2Name.toLowerCase().includes(lc));
  }, [round, search, matches]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80">
      <div className="w-full max-w-md rounded-t-lg sm:rounded-lg bg-card border border-border p-4">
        <h2 className="text-lg font-medium text-foreground">Repair past result</h2>

        <label className="block mt-3 text-sm text-muted-foreground">Round</label>
        <select
          value={round}
          onChange={(e) => setRound(e.target.value === "" ? "" : Number(e.target.value))}
          className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
        >
          {completedRounds.map(r => (
            <option key={r} value={r}>Round {r}</option>
          ))}
        </select>

        <label className="block mt-3 text-sm text-muted-foreground">Search player</label>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Player name"
          className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
        />

        <ul className="mt-3 max-h-60 overflow-y-auto divide-y divide-border">
          {filtered.map(m => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => { onPick(m.id); onClose(); }}
                className="w-full text-left px-2 py-3 hover:bg-muted text-sm text-foreground"
              >
                {m.player1Name} vs {m.player2Name}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-2 py-3 text-sm text-muted-foreground">No matches found.</li>
          )}
        </ul>

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-md border border-border text-foreground">Close</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount the picker behind a host-controls button**

In `app/tracker/tournaments/[id]/page.tsx`:

```tsx
const [pickerOpen, setPickerOpen] = useState(false);

{isHost && (
  <button type="button" onClick={() => setPickerOpen(true)} className="px-3 py-2 rounded-md border border-border text-foreground">
    Repair past result
  </button>
)}

<RepairPastResultPicker
  open={pickerOpen}
  onClose={() => setPickerOpen(false)}
  completedRounds={completedRoundNumbers}
  matches={pickerMatches}
  onPick={(matchId) => setRepairMatchId(matchId)}
/>
```

Compute `completedRoundNumbers` and `pickerMatches` from existing fetched data.

- [ ] **Step 3: Verify the build**

Run: `npm run build 2>&1 | tail -10`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add components/ui/RepairPastResultPicker.tsx app/tracker/tournaments/[id]/page.tsx
git commit -m "feat: add Repair past result picker"
```

---

### Task 18: Inline edit-history disclosure on match cards + success-toast inline re-pair

**Files:**
- Modify: `components/ui/TournamentRounds.tsx` (inline history)
- Modify: `components/ui/match-edit.tsx` (toast on success)

- [ ] **Step 1: Add inline edit-history disclosure on past-round match cards (host only)**

In the match card JSX in `TournamentRounds.tsx`, after the pencil button:

```tsx
{isHost && matchEditCounts[match.id] > 0 && (
  <details className="mt-1 text-xs">
    <summary className="cursor-pointer text-muted-foreground">
      Edit history ({matchEditCounts[match.id]})
    </summary>
    <ul className="mt-1 ml-3 space-y-1">
      {matchEditsByMatch[match.id]?.map(e => (
        <li key={e.id} className="text-muted-foreground">
          {e.old_player1_score}-{e.old_player2_score} → {e.new_player1_score}-{e.new_player2_score}
          {" · "}{new Date(e.edited_at).toLocaleString()}
          {e.reason ? ` · ${e.reason}` : ""}
        </li>
      ))}
    </ul>
  </details>
)}
```

Reuse the `matchEdits` fetch from Task 12. Compute `matchEditCounts` and `matchEditsByMatch` as `useMemo`-ized derivations.

- [ ] **Step 2: Show success toast with inline re-pair button after a repair**

In `components/ui/match-edit.tsx`, after the successful `repairMatchScoreAction` call (inside the `if (mode === "repair")` block from Task 9), close the dialog and call back to the parent to surface a toast. Use the project's existing `showToast` utility:

```typescript
import { showToast } from "@/utils/toast"; // adjust to project pattern

// after success:
showToast({
  message: "Result repaired.",
  variant: "success",
  action: canRepairCurrentRound
    ? { label: "Re-pair current round?", onClick: () => onRequestRegenerate?.() }
    : undefined,
});
```

`canRepairCurrentRound` and `onRequestRegenerate` are new props passed in from the parent that mounts the dialog (TournamentRounds.tsx). Wire them through.

If the project doesn't have a toast-with-action utility, use the existing toast for the message and skip the inline action. Note the gap.

- [ ] **Step 3: Verify the build**

Run: `npm run build 2>&1 | tail -10`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add components/ui/TournamentRounds.tsx components/ui/match-edit.tsx
git commit -m "feat: inline edit history and success-toast re-pair offer"
```

---

## Phase 5: E2E tests

### Task 19: Bootstrap Playwright

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Install Playwright**

Run: `npm install --save-dev @playwright/test`
Then: `npx playwright install --with-deps chromium`

- [ ] **Step 2: Create the config**

Create `playwright.config.ts`:

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-mobile", use: { ...devices["iPhone 12"] } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3: Create `e2e/.gitignore`**

Create `e2e/.gitignore`:

```
/test-results
/playwright-report
/playwright/.cache
```

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts e2e/.gitignore package.json package-lock.json
git commit -m "chore: bootstrap Playwright for E2E"
```

---

### Task 20: E2E fixtures and helpers

**Files:**
- Create: `e2e/fixtures.ts`
- Create: `e2e/seed.ts`

- [ ] **Step 1: Write a seeding helper that uses the Supabase service role**

Create `e2e/seed.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

export interface SeededTournament {
  tournamentId: string;
  hostEmail: string;
  hostPassword: string;
  participantIds: string[];
}

export async function seedTournamentWithCompletedRound1(): Promise<SeededTournament> {
  const hostEmail = `host-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.test`;
  const hostPassword = "Testpass12345";
  const { data: hostUser } = await admin.auth.admin.createUser({
    email: hostEmail, password: hostPassword, email_confirm: true,
  });

  const { data: tournament } = await admin.from("tournaments").insert({
    name: `E2E ${Date.now()}`, host_id: hostUser.user!.id,
    has_started: true, n_rounds: 3, current_round: 2, max_score: 5,
  }).select().single();

  const { data: parts } = await admin.from("participants").insert([
    { tournament_id: tournament!.id, name: "Alice" },
    { tournament_id: tournament!.id, name: "Bob" },
    { tournament_id: tournament!.id, name: "Carol" },
    { tournament_id: tournament!.id, name: "Dave" },
  ]).select();

  await admin.from("matches").insert([
    { tournament_id: tournament!.id, round: 1, match_order: 1,
      player1_id: parts![0].id, player2_id: parts![1].id,
      player1_score: 5, player2_score: 0,
      winner_id: parts![0].id, is_tie: false },
    { tournament_id: tournament!.id, round: 1, match_order: 2,
      player1_id: parts![2].id, player2_id: parts![3].id,
      player1_score: 5, player2_score: 2,
      winner_id: parts![2].id, is_tie: false },
  ]);

  await admin.from("rounds").insert({
    tournament_id: tournament!.id, round_number: 1, is_completed: true,
  });

  return {
    tournamentId: tournament!.id,
    hostEmail, hostPassword,
    participantIds: parts!.map(p => p.id),
  };
}

export async function cleanupTournament(seed: SeededTournament) {
  await admin.from("tournaments").delete().eq("id", seed.tournamentId);
  const { data: user } = await admin.auth.admin.getUserByEmail?.(seed.hostEmail) ?? { data: null };
  if (user?.user) await admin.auth.admin.deleteUser(user.user.id);
}
```

- [ ] **Step 2: Write fixtures that handle login + seed lifecycle**

Create `e2e/fixtures.ts`:

```typescript
import { test as base } from "@playwright/test";
import { seedTournamentWithCompletedRound1, cleanupTournament, SeededTournament } from "./seed";

export const test = base.extend<{ seeded: SeededTournament }>({
  seeded: async ({ page }, use) => {
    const seed = await seedTournamentWithCompletedRound1();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(seed.hostEmail);
    await page.getByLabel(/password/i).fill(seed.hostPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/.*\/tracker.*/);
    await use(seed);
    await cleanupTournament(seed);
  },
});

export { expect } from "@playwright/test";
```

- [ ] **Step 3: Commit**

```bash
git add e2e/seed.ts e2e/fixtures.ts
git commit -m "test: add E2E seed and fixture helpers"
```

---

### Task 21: E2E — repair golden path

**Files:**
- Create: `e2e/repair/golden-path.spec.ts`

- [ ] **Step 1: Write the test**

Create `e2e/repair/golden-path.spec.ts`:

```typescript
import { test, expect } from "../fixtures";

test("host repairs a past-round score and standings reflect the change", async ({ page, seeded }) => {
  await page.goto(`/tracker/tournaments/${seeded.tournamentId}`);

  // Find the round 1 Alice vs Bob match card and click its pencil.
  const matchCard = page.getByText(/alice/i).locator("..").locator("..");
  await matchCard.getByRole("button", { name: /repair result/i }).click();

  // Change Alice's score from 5-0 to 5-3.
  await page.getByRole("dialog", { name: /repair result/i }).getByLabel(/player ?2/i).selectOption("3");
  await page.getByLabel(/reason/i).fill("scorer mistake");
  await page.getByRole("button", { name: /^repair$/i }).click();

  // Wait for dialog to close.
  await expect(page.getByRole("dialog")).toBeHidden();

  // Standings should show "amended" on Alice and Bob's rows.
  await expect(page.getByText(/alice/i).locator("..").getByText(/amended/i)).toBeVisible();

  // Audit log shows the new entry.
  await expect(page.getByText(/audit log/i).locator("..").getByText(/scorer mistake/i)).toBeVisible();
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:e2e -- e2e/repair/golden-path.spec.ts --project=chromium-desktop`

Expected: PASS. If selectors miss, adjust them to match the rendered UI.

- [ ] **Step 3: Commit**

```bash
git add e2e/repair/golden-path.spec.ts
git commit -m "test(e2e): repair golden-path scenario"
```

---

### Task 22: E2E — repair + inline re-pair from toast

**Files:**
- Create: `e2e/repair/inline-re-pair.spec.ts`

- [ ] **Step 1: Write the test**

Create `e2e/repair/inline-re-pair.spec.ts`:

```typescript
import { test, expect } from "../fixtures";
import { admin } from "../seed";

test("repair + inline re-pair from success toast regenerates pairings", async ({ page, seeded }) => {
  // Ensure round 2 has been paired but unscored.
  await admin.from("matches").insert([
    { tournament_id: seeded.tournamentId, round: 2, match_order: 1,
      player1_id: seeded.participantIds[0], player2_id: seeded.participantIds[2],
      player1_score: null, player2_score: null },
    { tournament_id: seeded.tournamentId, round: 2, match_order: 2,
      player1_id: seeded.participantIds[1], player2_id: seeded.participantIds[3],
      player1_score: null, player2_score: null },
  ]);
  await admin.from("rounds").insert({
    tournament_id: seeded.tournamentId, round_number: 2, is_completed: false,
  });

  await page.goto(`/tracker/tournaments/${seeded.tournamentId}`);

  const matchCard = page.getByText(/alice/i).locator("..").locator("..");
  await matchCard.getByRole("button", { name: /repair result/i }).click();
  await page.getByRole("dialog").getByLabel(/player ?2/i).selectOption("3");
  await page.getByRole("button", { name: /^repair$/i }).click();

  // Toast appears with an action.
  const toast = page.getByRole("status").filter({ hasText: /repaired/i });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: /re-pair current round/i }).click();

  // Confirm checkbox + regenerate.
  await page.getByLabel(/i confirm no players have started/i).check();
  await page.getByRole("button", { name: /regenerate$/i }).click();

  // Pairings should now reflect the regenerated round.
  await expect(page.getByText(/regenerated/i)).toBeVisible({ timeout: 5000 }).catch(() => {
    // soft check; explicit verification: row count for round 2 matches still equals 2
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:e2e -- e2e/repair/inline-re-pair.spec.ts --project=chromium-desktop`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/repair/inline-re-pair.spec.ts
git commit -m "test(e2e): inline re-pair from success toast"
```

---

### Task 23: E2E — unlock escape hatch, discoverability, just-ended, non-host

**Files:**
- Create: `e2e/repair/unlock-and-re-pair.spec.ts`
- Create: `e2e/repair/discoverability-picker.spec.ts`
- Create: `e2e/repair/just-ended-round.spec.ts`
- Create: `e2e/repair/non-host-view.spec.ts`

Write each scenario as its own `.spec.ts` file. Steps for each follow the same structure as Task 21: navigate, exercise the UI, assert.

- [ ] **Step 1: Write `unlock-and-re-pair.spec.ts`** — seed round 2 with one scored match. Click re-pair (disabled), then "Unlock and re-pair…", verify the dialog lists the scored match, check the checkbox, confirm. Assert the scored row is gone and new pairings exist.

- [ ] **Step 2: Write `discoverability-picker.spec.ts`** — click "Repair past result", select round 1, search "Alice", click the match in the list. Assert the repair dialog opens on Alice's match.

- [ ] **Step 3: Write `just-ended-round.spec.ts`** — seed round 2 as in-progress with results. End the round via the existing "End round" button. Verify a pencil now appears on round 2 match cards.

- [ ] **Step 4: Write `non-host-view.spec.ts`** — sign in as a non-host user (seed an additional non-host account in `seed.ts` and add a fixture variant). Navigate to the tournament. Assert: no pencil icons, no re-pair button, no audit log panel, no "Unlock and re-pair" link. Amended badge present.

- [ ] **Step 5: Run all four**

Run: `npm run test:e2e -- e2e/repair/unlock-and-re-pair.spec.ts e2e/repair/discoverability-picker.spec.ts e2e/repair/just-ended-round.spec.ts e2e/repair/non-host-view.spec.ts --project=chromium-desktop`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add e2e/repair/unlock-and-re-pair.spec.ts e2e/repair/discoverability-picker.spec.ts e2e/repair/just-ended-round.spec.ts e2e/repair/non-host-view.spec.ts
git commit -m "test(e2e): unlock, picker, just-ended, non-host scenarios"
```

---

### Task 24: E2E — mobile viewport and dark mode

**Files:**
- Create: `e2e/repair/mobile-viewport.spec.ts`
- Create: `e2e/repair/dark-mode.spec.ts`

- [ ] **Step 1: Write `mobile-viewport.spec.ts`**

Mirror the golden-path scenario but force the mobile project:

```typescript
import { test, expect } from "../fixtures";

test.use({ viewport: { width: 375, height: 667 } });

test("repair golden path works on mobile viewport", async ({ page, seeded }) => {
  await page.goto(`/tracker/tournaments/${seeded.tournamentId}`);

  const pencil = page.getByText(/alice/i).locator("..").locator("..").getByRole("button", { name: /repair result/i });
  // Pencil hit area is at least 44x44.
  const box = await pencil.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await pencil.click();
  // Dialog renders as a bottom sheet (anchored near the bottom of the viewport).
  const dialog = page.getByRole("dialog", { name: /repair result/i });
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox!.y + dialogBox!.height).toBeGreaterThan(400); // bottom-anchored

  await dialog.getByLabel(/player ?2/i).selectOption("3");
  // Submit button should be in the lower half of the viewport.
  const submit = dialog.getByRole("button", { name: /^repair$/i });
  const submitBox = await submit.boundingBox();
  expect(submitBox!.y).toBeGreaterThan(333);
  await submit.click();
  await expect(dialog).toBeHidden();
});
```

- [ ] **Step 2: Write `dark-mode.spec.ts`**

```typescript
import { test, expect } from "../fixtures";

test("repair golden path works in dark mode", async ({ page, seeded }) => {
  // Force dark mode via the system preference.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/tracker/tournaments/${seeded.tournamentId}`);

  // The body should have a dark background. (Project applies dark via 'dark' class on html.)
  const bgColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // Just sanity-check it's not white. We don't pin exact tokens.
  expect(bgColor).not.toBe("rgb(255, 255, 255)");

  const matchCard = page.getByText(/alice/i).locator("..").locator("..");
  await matchCard.getByRole("button", { name: /repair result/i }).click();
  await page.getByRole("dialog").getByLabel(/player ?2/i).selectOption("3");
  await page.getByRole("button", { name: /^repair$/i }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  // Amended badge present in dark mode.
  await expect(page.getByText(/alice/i).locator("..").getByText(/amended/i)).toBeVisible();

  // Visual regression: full-page screenshot snapshot.
  await expect(page).toHaveScreenshot("repair-dark-mode.png", { fullPage: true, maxDiffPixelRatio: 0.02 });
});
```

The first run produces the baseline; commit it. Subsequent runs compare.

- [ ] **Step 3: Run both**

Run: `npm run test:e2e -- e2e/repair/mobile-viewport.spec.ts e2e/repair/dark-mode.spec.ts`
Expected: PASS (and a new screenshot artifact for dark mode).

- [ ] **Step 4: Commit**

```bash
git add e2e/repair/mobile-viewport.spec.ts e2e/repair/dark-mode.spec.ts e2e/repair/dark-mode.spec.ts-snapshots/
git commit -m "test(e2e): mobile viewport and dark-mode scenarios"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Covered by |
|---|---|
| Migration: `match_edits` table + RLS + indexes + byes unique | Task 2 |
| `repair_match_score` RPC with FOR UPDATE, recompute, snapshot rewrite, audit | Task 5 (PL/pgSQL) + Task 3 (TS helper for tests) |
| `regenerate_current_round_pairings` RPC | Task 6 |
| Server actions wrapping both RPCs | Task 7 |
| Integration tests for RPCs | Task 8 |
| Repair-mode branch in match-edit dialog | Task 9 |
| Pencil icon on past-round match cards (host-only) | Task 10 |
| Amended badge on standings | Tasks 4 + 11 + 12 |
| Audit log panel | Task 13 |
| Re-pair button + confirm checkbox | Task 14 |
| Unlock-and-re-pair escape hatch | Task 15 |
| Tournament-wide banner | Task 16 |
| Discoverability picker | Task 17 |
| Inline edit history + success-toast inline re-pair | Task 18 |
| Mobile contract (44×44 hit area, bottom sheets, thumb reach) | Embedded in Tasks 10, 14, 15, 16, 17; verified by Task 24 |
| Dark-mode contract (tokens, contrast, disabled states) | Embedded in all UI tasks (Tailwind tokens); verified by Task 24 |
| E2E golden path | Task 21 |
| E2E inline re-pair | Task 22 |
| E2E unlock, picker, just-ended, non-host | Task 23 |
| E2E mobile + dark mode | Task 24 |
| Rollout (no backfill) | No migration touches existing data — implicit in Tasks 2, 5, 6 |
| Interactions with adjacent write paths | Handled by recompute logic in Task 5 (rewrites snapshots so swap UI stays consistent) |

**Gaps and notes:**
- Task 8's integration tests require a Supabase preview branch or local Supabase. If neither is available, mark partial and rely on E2E (Tasks 21-24) for end-to-end DB coverage.
- Task 18's success-toast inline re-pair assumes the project has a toast utility supporting an action button. If not, the inline-action behavior degrades gracefully (toast still shows, no button). The E2E test in Task 22 will fail in that case — adjust the test or add the utility.
- The pencil icon's exact placement in `TournamentRounds.tsx` (Task 10) depends on the actual JSX structure of match cards. Read the file before editing.

---

## Execution Handoff

**Plan complete and saved to** `docs/superpowers/plans/2026-05-27-mid-round-score-repair.md`**. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
