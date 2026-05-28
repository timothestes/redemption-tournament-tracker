# Mid-Round Score Repair

**Status:** Design
**Date:** 2026-05-27
**Owner:** Host workflow

## Problem

A player reports a wrong score for a previous round. Nobody catches the mistake until the next round is already underway. Today there is no in-app affordance for the tournament host to correct the past result, so standings stay wrong, and (depending on when the error is caught) the current round may have been paired off bad data.

We want hosts to be able to repair past-round scores mid-tournament, with predictable behavior and a visible audit trail.

## Goals

- Let the tournament host correct any past-round match score at any time during the tournament — including after subsequent rounds have started or completed.
- After a repair, standings recompute correctly from full match history.
- When safe (current round has no submitted results), let the host optionally regenerate the current round's pairings from the corrected standings.
- Provide a quiet, trust-building signal to players that a correction occurred, without exposing administrative detail.
- Provide a complete audit log to hosts (who, when, old → new, optional reason).

## Non-goals

- **No full unwind ("Tier C").** Rolling the tournament back to an earlier round, invalidating in-flight games, and re-pairing forward is explicitly out of scope. Every consumer Swiss tool surveyed (Melee, EventLink, SwissSys, AetherHub, Swiss-Manager) treats in-progress paired matches as inviolable; FIDE C.04.2 codifies the same rule. A paired match in progress is a social contract between two players at a table, and software-driven reseating is more harmful than the underlying mis-pairing.
- **No "provisional round" lockout pattern.** Optimizes for a problem that happens rarely while adding friction every round.
- **No undo-toast for fresh score entries.** Worth considering separately, but not part of this feature.
- **No co-host / judge role.** Only the existing `tournament.host_id` can repair. If multi-judge support is needed later, it's a separate feature.

## Background

Two existing facts from the codebase shape this design:

1. **Pairings already read from match history, not from denormalized participant fields.** `pairLaterRound` → `totalsForRound` ([utils/tournament/pairing.ts](utils/tournament/pairing.ts)) recomputes each participant's game and Lost Soul scores from `state.matches` every time it pairs. As a consequence, correcting a past-round `matches` row automatically feeds into any future pairing run, with no extra wiring needed.
2. **The match-edit dialog does incremental writes to participant totals.** [components/ui/match-edit.tsx:118-125](components/ui/match-edit.tsx#L118-L125) adds `(player1Score - player2Score)` to the existing `participants.differential` and bumps `match_points` by the delta. Reusing this code path to re-edit an already-scored match would **double-count**. This is the central integrity hazard the design must work around.

The load-bearing fix for recomputing participant totals already exists: `recomputeTotalsFromHistory` ([lib/tournament/results.ts](lib/tournament/results.ts)) walks all matches and byes for a participant and returns derived totals. It is called once today, in `handleEndRound` at [app/tracker/tournaments/[id]/page.tsx:339](app/tracker/tournaments/[id]/page.tsx#L339). The repair flow reuses it.

## Design

### Server actions

Two new server actions in `app/tracker/tournaments/actions.ts` (or a new `repair-actions.ts` if file size grows too large; see code organization note below):

**`repairMatchScore(matchId, newPlayer1Score, newPlayer2Score, reason?)`**

Runs inside a single transaction:

1. Load the `matches` row and join to its `tournaments` row.
2. Verify `auth.uid() = tournament.host_id`. Reject with a clear error otherwise. (RLS also enforces this at the database level; the action check exists for early failure and clearer errors.)
3. Validate the scores against `tournament.max_score` (reuses the same constraints as live-round entry).
4. Capture old scores for the audit log.
5. Update the `matches` row: write `player1_score`, `player2_score`, recompute `is_tie` and `winner_id` from the new scores, and bump `updated_at`. Do **not** touch participant totals here.
6. Build full tournament state via `buildStateFromSupabase`.
7. For every participant in the tournament, call `recomputeTotalsFromHistory` and write the resulting `match_points` and `differential` back to `participants`. (Scope: a typical event has a few dozen participants — this is cheap and removes any chance of a stale row.)
8. Insert a `match_edits` row recording old → new, the editor, and the optional reason.
9. Return the updated standings payload for the client to re-render.

**`regenerateCurrentRoundPairings(tournamentId)`**

The Tier B re-pair action. Runs inside a single transaction:

1. Verify host.
2. Load the current round and assert `is_completed = false` AND no `matches` row for the current round has a non-null `player1_score`. If either fails, reject with a clear message.
3. Delete all `matches` rows and `byes` rows for `round = current_round`.
4. Call the existing `createPairing(tournamentId, currentRound)` to regenerate.
5. Return the new pairings.

This is intentionally a separate action from `repairMatchScore`. Re-pairing is an explicit host decision, not a side effect of editing a result, matching the convention every surveyed tool follows.

### Schema

One new table. Additive only — no changes to `matches`, `participants`, `rounds`, or `tournaments`.

```sql
create table match_edits (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round int not null,
  old_player1_score int not null,
  old_player2_score int not null,
  new_player1_score int not null,
  new_player2_score int not null,
  edited_by uuid not null references auth.users(id),
  edited_at timestamptz not null default now(),
  reason text
);

create index match_edits_tournament_round_idx
  on match_edits(tournament_id, round);

alter table match_edits enable row level security;

create policy host_can_select_match_edits
  on match_edits for select
  using (
    auth.uid() = (
      select host_id from tournaments
      where tournaments.id = match_edits.tournament_id
    )
  );

create policy host_can_insert_match_edits
  on match_edits for insert
  with check (
    auth.uid() = edited_by
    and auth.uid() = (
      select host_id from tournaments
      where tournaments.id = match_edits.tournament_id
    )
  );
-- No update or delete policies: audit rows are append-only.
```

Migration filename follows existing convention: next numeric prefix in `supabase/migrations/`.

### UI surfaces

**Past-round match cards (host view only).**
A pencil icon appears on each `matches` card whose round has `is_completed = true`. (This includes prior rounds and the current round if the host has ended it but the tournament is still in progress.) Click opens the existing `match-edit.tsx` dialog in a new "repair mode" variant.

Repair-mode differences from live-mode:
- Both score selectors are pre-populated with the existing scores (not 0).
- An optional single-line "Reason" text input appears below the selectors. Placeholder: "Why are you correcting this? (optional)". 240 char limit.
- On submit, the dialog calls `repairMatchScore` instead of the existing direct-table-update + incremental-writes path. **The incremental write code path at [match-edit.tsx:118-125](components/ui/match-edit.tsx#L118-L125) must not be reached in repair mode.** Implementation: branch on a `mode: "live" | "repair"` prop at the top of the submit handler; the repair branch calls the server action and skips all incremental math.
- The dialog's title is "Repair result" instead of "Submit result".

**Quiet "amended" badge on standings.**
When rendering standings for any round, fetch a per-participant boolean indicating whether any `match_edits` row touches a match that participant played. Show a small muted pill ("amended") next to the affected participant's row in that round's standings. Tap or hover reveals: "Result corrected by host on {date}".

This is the only player-facing surface — no detail, no scores, no who-played-whom. Just enough to make the standings change explainable without exposing administrative content.

**"Re-pair current round" button (host view only).**
Lives in the host's existing current-round controls panel. Always rendered. Disabled state with tooltip ("Available only when no results have been submitted this round") when any `matches` row for the current round has a non-null score, or when the round is already completed. When enabled, clicking opens a confirm dialog:

> Regenerate pairings for round N?
>
> This will replace the current pairings using the corrected standings. The existing pairings will be discarded. Continue only if no players have started their matches.

On confirm, calls `regenerateCurrentRoundPairings`.

**Host-only audit log panel.**
A new section on the host's tournament admin view: a chronological list of `match_edits` rows for the tournament, newest first. Each row shows round, the two participants, old score → new score, who edited, when, and the reason (if provided). No filter/search in v1 — typical events will have a handful of entries at most.

### Code organization

If `app/tracker/tournaments/actions.ts` would grow beyond a comfortable size (currently 456 lines and focused on decklists), split the repair actions into `app/tracker/tournaments/repair-actions.ts`. Both files are server-action modules and can coexist cleanly.

`match-edit.tsx` gets a `mode` prop; no other splits needed.

The "amended" badge logic should live in a small standings helper, not inline in the standings component.

## Edge cases

- **Edit a match in an already-completed round.** Default case. Recompute handles it; standings update; if it was the final round and the tournament has ended, `computeFinalStandings` re-derives placements.
- **Edit a match in the current (in-progress) round.** Routes through the *existing* live-entry flow, not repair. The pencil icon does not appear for the current round while it is active. If a host needs to fix a fresh entry, they use the same dialog they used to submit it.
- **Edit a match whose round is completed but the next round has not yet been generated.** Allowed. Recompute fires. Subsequent pairing run will use the corrected totals automatically (pairings read from history).
- **Edit a match after the tournament has ended.** Allowed. Final standings update. The "amended" badge on the final standings makes the change visible.
- **Concurrent edits to the same match.** The transaction holds a row lock on `matches` for the duration of the action; a second concurrent edit serializes behind the first.
- **Edit then re-pair.** Two separate host actions, in order. Repair first to fix history, then re-pair to regenerate from corrected standings. The UI does not bundle these.
- **Re-pair when no results are in but pairings have been physically posted to a table.** The host's responsibility — the confirm-dialog copy is explicit about the risk. Software cannot detect this.

## Testing

- **Unit:** `recomputeTotalsFromHistory` is idempotent under repeated edits to the same match (regression guard against the double-count hazard).
- **Unit:** `repairMatchScore` rejects non-host callers.
- **Unit:** `repairMatchScore` validates scores against `tournament.max_score`.
- **Integration:** Edit a round-1 score after round 2 has started; assert round-1 match row updated, all participant `match_points`/`differential` match a fresh `recomputeTotalsFromHistory`, and `match_edits` row recorded.
- **Integration:** Edit a round-1 score, then generate pairings for round 3; assert the pairing input reflects the corrected round-1 totals.
- **Integration:** `regenerateCurrentRoundPairings` succeeds when no scores submitted; rejects when any score is non-null.
- **Integration:** RLS rejects a non-host attempting to insert a `match_edits` row or call either action.
- **UI:** Pencil icon appears only for the host, only on rounds where `is_completed = true`. "Re-pair" button gates correctly. Amended badge renders on the right rows.

## Out of scope / future work

- Tier C full unwind.
- Provisional-round lockout pattern.
- 30-second undo toast for fresh entries.
- Co-host / judge role.
- Player-visible audit log detail.
- Filtering or searching the audit log.
