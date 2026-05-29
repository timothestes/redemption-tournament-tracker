# Mid-Round Score Repair

**Status:** Design, ready for implementation
**Date:** 2026-05-27
**Scope:** Hosts can correct past-round match scores at any point during a tournament; standings recompute correctly; the current round can optionally be re-paired when no results have been submitted.

## Approach

Two Postgres-RPC server actions — `repairMatchScore` and `regenerateCurrentRoundPairings` — give the host an in-app affordance to fix past-round results. Past-round edits route through a "repair mode" of the existing match-edit dialog and write an append-only audit row. The current round can be regenerated only when safe (no scores submitted), behind explicit checkbox confirmation. No Tier C unwind; in-flight paired matches are inviolable.

## Glossary

- **repair** — host action verb. Used for the feature and the RPC (`repairMatchScore`).
- **amended** — player-facing past-tense indicator. Shown on standings rows touched by a repair.
- **edit** — pre-existing dialog name (`match-edit.tsx`). Not renamed.
- **repair mode** — a prop variant of the edit dialog used when the round is completed.
- **live mode** — the original behavior of the edit dialog used when the round is in-progress.

## Problem

A player reports a wrong score for a previous round. Nobody catches the mistake until the next round is already underway. Today there is no in-app affordance for the tournament host to correct the past result, so standings stay wrong, and the current round may have been paired off bad data.

We want hosts to be able to repair past-round scores mid-tournament, with predictable behavior and a visible audit trail.

## Goals

- Let the tournament host correct any past-round match score at any time during the tournament — including after subsequent rounds have started or completed.
- After a repair, standings recompute correctly from full match history.
- When safe (current round has no submitted results), let the host optionally regenerate the current round's pairings from the corrected standings.
- Display a non-administrative "amended" indicator on standings for any round containing a corrected match, so players understand standings movement without exposing administrative detail.
- Provide a complete audit log to hosts (who, when, old → new, optional reason).
- Every new UI surface is fully usable on mobile viewports and in both light and dark themes.
- Load-bearing correctness paths and major user-facing flows are covered by unit + integration + end-to-end tests respectively.

## Non-goals

- **No full unwind ("Tier C").** Rolling the tournament back to an earlier round, invalidating in-flight games, and re-pairing forward is explicitly out of scope. Every surveyed Swiss tool (Melee, EventLink, SwissSys, AetherHub, Swiss-Manager) treats in-progress paired matches as inviolable; FIDE C.04.2 codifies the same rule. Software-driven reseating is more harmful than the underlying mis-pairing.
- **No "provisional round" lockout pattern.** Optimizes for a rare problem at the cost of constant friction.
- **No undo-toast for fresh score entries.** Worth considering separately, but not part of this feature.
- **No co-host / judge role.** Only the existing `tournament.host_id` can repair. Multi-judge support is a separate feature.
- **No realtime push of standings updates.** Out of scope; see Realtime contract below.

## Background

Three existing facts from the codebase shape this design. The repair flow must respect all three.

**Fact 1: Pairings and final standings already read from match history.**
[lib/tournament/pairing.ts:143-178](lib/tournament/pairing.ts#L143-L178) (`totalsForRound` called by `pairLaterRound`) recomputes each participant's game and Lost Soul scores from `state.matches` and `state.byes` every time it pairs. [lib/tournament/standings.ts](lib/tournament/standings.ts) (`computeFinalStandings`) calls `recomputeTotalsFromHistory` from [lib/tournament/results.ts](lib/tournament/results.ts). Neither path reads `participants.match_points` or `participants.differential`. Consequence: correcting a past-round `matches` row automatically propagates to any future pairing run and to final standings, with no extra wiring.

**Fact 2: There are two denormalized snapshot layers, with different readers.**

- `participants.match_points` and `participants.differential` (per-participant cumulative totals). Written by [page.tsx:339](app/tracker/tournaments/[id]/page.tsx#L339) inside `handleEndRound` (`recomputeTotalsFromHistory` per participant) and by a manual host-edit UI at [page.tsx:152](app/tracker/tournaments/[id]/page.tsx#L152). Read by: the standings tab sort at [page.tsx:128](app/tracker/tournaments/[id]/page.tsx#L128), [utils/printUtils.ts:32-115](utils/printUtils.ts#L32-L115) (printed standings sheet), and the swap UI in [components/ui/TournamentRounds.tsx](components/ui/TournamentRounds.tsx) for bye-swap math.
- `matches.player1_match_points`, `matches.player2_match_points`, `matches.differential`, `matches.differential2` (per-match running cumulative snapshots). Written by [components/ui/match-edit.tsx:113-130](components/ui/match-edit.tsx#L113-L130) — the dialog reads `participants.match_points`/`differential`, computes the new cumulative, and stores it on the `matches` row. Read by [TournamentRounds.tsx:459-508,573-664](components/ui/TournamentRounds.tsx#L459-L508) — the host's match-swap UI, which displays and re-keys these snapshots when the host swaps players between matches/byes on a completed round.

**Fact 3: Re-editing a match via the existing dialog double-counts both snapshots.**
The dialog reads `participants.match_points` (which already includes this match's contribution after `handleEndRound`), then adds the new delta. Calling `match-edit`'s submit path on an already-scored match would store a doubled cumulative in `matches.*` and would leave `participants.*` untouched until the next `handleEndRound`. This is the core integrity hazard the repair flow must avoid.

The load-bearing recompute primitive — `recomputeTotalsFromHistory` — already exists. The repair flow reuses it and, in addition, rewrites the per-match snapshot columns chronologically (see Server actions below).

## Design

### Server actions

Both server actions are implemented as Postgres functions invoked via Supabase `rpc()`. This is non-negotiable: the Supabase JS client cannot run `BEGIN`/`COMMIT` or `SELECT ... FOR UPDATE`, and the existing `handleEndRound` pattern (serial `.update()` calls with no atomicity) is not acceptable for a feature that touches participant totals across the whole tournament. Server actions in `app/tracker/tournaments/repair-actions.ts` are thin wrappers that authenticate, invoke the RPC, and return the result.

**`repair_match_score(match_id, new_p1_score, new_p2_score, reason)`** (Postgres function):

1. `SELECT ... FOR UPDATE` on the target `matches` row joined to `tournaments`. Verify `auth.uid() = tournament.host_id`. Reject otherwise.
2. Validate scores against `tournament.max_score` (reuses the same constraints as live-round entry).
3. Capture old `player1_score` and `player2_score` for the audit log.
4. Update the `matches` row's `player1_score`, `player2_score`, `is_tie`, `winner_id`, `updated_at`. Leave the `matches.player1_match_points`/`differential` snapshot columns for step 6.
5. For every participant in the tournament, run the equivalent of `recomputeTotalsFromHistory` (reimplemented in PL/pgSQL or invoked via the existing TS path from the server action wrapper — implementer's call; both achieve the same result, but doing it in PL/pgSQL keeps the entire write atomic). Rewrite `participants.match_points` and `participants.differential` accordingly.
6. **Recompute per-match snapshots chronologically.** For each participant whose totals changed (i.e., everyone who shared a round with one of the two players), walk their matches in `(round, match_order)` order, maintain running `match_points` and `differential` accumulators, and rewrite `matches.player1_match_points` / `player2_match_points` / `differential` / `differential2` on each row so the snapshots match history. This is required because the swap UI in `TournamentRounds.tsx` and the printed standings sheet still read these snapshots.
7. Insert a `match_edits` row recording old → new, the editor, and the optional reason.
8. Return the updated standings payload.

**`regenerate_current_round_pairings(tournament_id)`** (Postgres function):

1. Verify host (same pattern).
2. Load the current round. Assert `is_completed = false` AND no `matches` row for the current round has a non-null `player1_score` (unless the unlock flag is set — see UI below).
3. If unlock was passed, delete the existing scored `matches` rows for the current round first.
4. Delete all `matches` rows and `byes` rows for the current round.
5. Inline the pairing logic that lives in `createPairing` ([utils/tournament/pairingUtilsV2.ts](utils/tournament/pairingUtilsV2.ts)). Because `createPairing` opens its own Supabase client (line 58), it cannot participate in an outer transaction; the RPC reimplements its insert step against the local connection. The pure pairing function in `lib/tournament/pairing.ts` is called from the server action wrapper to compute pairings, then the RPC inserts.
6. Return the new pairings.

This is intentionally a separate action from `repair_match_score`. Re-pairing is an explicit host decision, not a side effect of editing a result, matching the convention every surveyed tool follows.

**Audit-log integrity caveat.** Audit-log completeness depends on every repair flowing through these RPCs. A host with direct database access can bypass the audit log via direct table updates; RLS does not enforce audit-log writes, only host-only `match_edits` insert access. This is acceptable given the threat model (the host is the trusted party).

### Schema

Migration filename: `supabase/migrations/031_create_match_edits.sql`. Additive only — no changes to `matches`, `participants`, `rounds`, or `tournaments`.

```sql
create table match_edits (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete restrict,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round int not null,                           -- denormalized from matches.round at insert time; append-only, never mutated
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
create index match_edits_match_id_idx
  on match_edits(match_id);                     -- supports per-match badge lookup

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

Derivable columns (`winner_id`, `is_tie`) are intentionally omitted; they can be reconstructed from old/new scores plus `tournament.max_score`. `tournament_id` is denormalized (also derivable via FK) to support the audit-log-by-tournament index without a join.

**Companion constraint on byes.** Add `unique(tournament_id, round_number)` partial index on the `byes` table to prevent re-pair from inserting a duplicate bye row if the delete step races with another caller:

```sql
create unique index byes_tournament_round_unique
  on byes(tournament_id, round_number);
```

### Interactions with adjacent write paths

The repair flow coexists with several other code paths that mutate match or participant data. Behavior of each in repair mode:

- **`handleEndRound` auto-fill for dropped players** ([page.tsx:264-279](app/tracker/tournaments/[id]/page.tsx#L264-L279)). At round-end, synthetic 0-0 / 0-max scores are written for any unfilled match involving a dropped player. **Repair may overwrite these.** The host is responsible for judging whether to do so; the audit log captures the change either way.
- **`persistBye`** ([utils/tournament/pairingUtilsV2.ts:25-31](utils/tournament/pairingUtilsV2.ts#L25-L31)). Writes vestigial `match_points: 3, differential: 0` on the bye row. Byes themselves are not editable through repair; only `matches` rows are. If a bye assignment needs to change, the host re-pairs.
- **Swap UI in `TournamentRounds.tsx`**. The swap UI reads `matches.player1_match_points`/`differential` snapshots. Step 6 of `repair_match_score` rewrites those snapshots so the swap UI continues to display consistent values after a repair.
- **Manual participant-totals edit UI** ([page.tsx:152](app/tracker/tournaments/[id]/page.tsx#L152)). This existing affordance lets the host write `participants.match_points`/`differential` directly. It is unchanged. A repair will overwrite any manual override, since step 5 recomputes from history. This is correct behavior — repair is the canonical source of truth post-feature.

### UI surfaces

**Past-round match cards (host view only).**
A pencil icon appears on each `matches` card whose round has `is_completed = true`. A round transitions from live-mode to repair-mode exactly when `is_completed` is set to `true` by `handleEndRound` — there is no intermediate state. Click opens the existing `match-edit.tsx` dialog in repair mode.

Repair-mode differences from live-mode:
- Both score selectors are pre-populated with the existing scores (not 0).
- An optional single-line "Reason" text input appears below the selectors. Placeholder: "Why are you repairing this? (optional)". 240-char limit.
- On submit, the dialog calls `repairMatchScore` instead of the existing direct-table-update + incremental-writes path. The dialog branches on a `mode: "live" | "repair"` prop at the top of the submit handler; the repair branch calls the server action and never reaches the incremental write path at lines 113-130.
- Dialog title: "Repair result".

**Discoverability — "Repair past result" entry point.**
A button in the host controls panel that opens a small picker: a round dropdown (showing only completed rounds) and a player-name search. Selecting a player + round jumps to that match card with the pencil pre-highlighted. Cheap to build (single component, reuses participant list); avoids forcing the host to scroll back to find the right card under social pressure.

**Quiet "amended" badge on standings.**
When rendering standings for any round, look up whether any `match_edits` row touches a match that participant played in that round (uses the `match_edits(match_id)` index). Show a small muted pill ("amended") next to the affected participant's row. Tap or hover reveals: "Round N result repaired by host on {date}." This is the only player-facing surface — no opponent name, no scores, no who-changed-what.

Re-fetch happens via the existing standings query revalidation (Next.js `revalidatePath` after the server action returns, plus Supabase's standard client cache refresh). No realtime push.

**Tournament-wide "standings updated" banner.**
When a repair occurs while a round is in progress, display a banner to all viewers (host and players) for the remainder of that round: "A previous-round result was repaired. Standings have been updated." Dismissable per-viewer; reappears for any subsequent repair in the same round. Acknowledges the mid-game standings shift without exposing detail.

**"Re-pair current round" button (host view only).**
Lives in the host's current-round controls panel. Always rendered.

- **Enabled** iff `round.is_completed = false` AND `count(matches WHERE round = current AND player1_score IS NOT NULL) = 0`.
- **Disabled** otherwise with tooltip: "Re-pair is unavailable because results have already been submitted."

When enabled, clicking opens a confirm dialog with an explicit checkbox:

> Regenerate pairings for round N?
>
> This will replace the current pairings using the corrected standings. The existing pairings will be discarded.
>
> [ ] I confirm no players have started current-round matches.

The "Regenerate" button is disabled until the checkbox is ticked. On confirm, calls `regenerateCurrentRoundPairings`.

**"Unlock and re-pair" escape hatch.**
When the button is disabled because results exist, the disabled state includes an "Unlock and re-pair…" link (host only). Clicking opens a dialog listing the affected matches with player names and their current scores, plus a required checkbox:

> Unlocking will discard the following N results and regenerate pairings:
> - {Player A} vs {Player B}: 5-3
> - {Player C} vs {Player D}: 5-0
>
> [ ] I confirm these results will be permanently deleted.

On confirm, calls `regenerateCurrentRoundPairings` with an `unlock: true` flag.

**Inline edit history on match cards (host only).**
Each match card with any `match_edits` rows shows a small disclosure ("Edit history (N)") that expands inline to list the edits for that match. This avoids forcing the host to leave the match view to check what changed.

**Success-toast inline re-pair.**
After `repairMatchScore` succeeds, if the current round currently meets the "no results submitted" gate, the success toast offers an inline "Re-pair current round?" button. Two clicks instead of two navigations; same two confirmations.

**Host-only audit log panel.**
Rendered under the host controls panel in [app/tracker/tournaments/[id]/page.tsx](app/tracker/tournaments/[id]/page.tsx). Chronological list of all `match_edits` rows for the tournament, newest first. Each row shows round, the two participants, old score → new score, who edited, when, and the reason (if provided). No pagination in v1; typical events have a handful of entries.

### Mobile and dark mode

Every UI surface introduced or modified by this feature must work correctly in mobile viewports and in dark mode. The project is mobile-first per [CLAUDE.md](CLAUDE.md) and supports both themes via `next-themes`.

**Mobile contract:**

- **Pencil icon hit area:** minimum 44×44 px.
- **Repair dialog and confirm dialogs:** render as bottom sheets on viewports < 768 px, full-page on smaller phones if more vertical space is needed for the score selectors plus reason input.
- **Primary action placement:** all confirm/save buttons at the bottom of the sheet, within thumb reach.
- **Discoverability picker:** also renders as a bottom sheet on mobile.
- **Audit log panel and inline edit history:** scrollable, with each row collapsible to fit narrow screens.
- **Tournament-wide banner:** wraps cleanly at narrow widths; dismissible with a touch-friendly target.

**Dark mode contract:**

- All new UI uses the project's Tailwind design tokens (semantic colors like `bg-background`, `text-foreground`, `bg-muted`, `text-muted-foreground`, `border-border`) — no hardcoded color values. Tokens already resolve correctly for both themes; staying on tokens means dark mode is automatic.
- The "amended" badge and tournament-wide banner must have sufficient contrast in both themes (verify against WCAG AA at minimum).
- Disabled states (re-pair button when locked, regenerate button before checkbox is ticked) must be visibly disabled in both themes — not just lower opacity, since dark mode swallows opacity reductions.
- Audit log rows, inline edit-history disclosures, and the picker dropdown all match existing dialog/panel surface styling so theme switching is uniform.
- New components are spot-checked in both themes during implementation; the UI test suite verifies render correctness in both (see Testing).

### Realtime contract

Standings updates after a repair propagate via the existing standings revalidation path:
- Host (the actor): immediate re-render from the RPC's returned payload.
- Other viewers (players on phones, projector display): the standings query refreshes on its existing cadence (Next.js cache revalidation on navigation; manual refresh otherwise).
- The tournament-wide banner described above is the explicit acknowledgement that "something has changed."

Realtime push via Supabase realtime channels is out of scope for v1. If players consistently report missing the update, add a `match_edits` channel subscription in v2.

### Code organization

`app/tracker/tournaments/actions.ts` is currently 456 lines and focused on decklists. Add repair actions to a new file `app/tracker/tournaments/repair-actions.ts` to keep concerns separated. Both are server-action modules and coexist cleanly. The exact split is the implementer's call — no spec position beyond "don't bloat `actions.ts`".

The "amended" badge predicate (does this participant + round have any `match_edits`?) lives in a small helper in `lib/tournament/repair-badges.ts` or similar, not inline in the standings component.

## Edge cases

- **Edit a match in an already-completed round.** Default case. Recompute handles it. Standings update on next revalidation; banner appears for the remainder of the current in-progress round.
- **Edit a match in the current (in-progress) round.** Not allowed via repair. The pencil icon does not appear. Edits route through the existing live-entry flow.
- **Just-ended round — host immediately wants to fix a fresh entry.** The round is now `is_completed = true`, so the pencil appears immediately. The edit goes through repair (writes `match_edits`). There is no "re-open round" path. This is the explicit contract: post-`is_completed` edits always go through repair.
- **Edit a match in a completed round whose next round has not yet been generated.** Allowed. Recompute fires. The subsequent pairing run will use the corrected totals (pairings read from history).
- **Edit a match involving a participant who has since `dropped_out = true`.** Allowed. `recomputeTotalsFromHistory` still computes the participant's totals; the next pairing run will exclude them via the existing dropped-player filter. Audit log records the change normally.
- **Edit a match after `tournament.has_ended = true`.** Allowed. Final standings re-derive on view. Any cached standings page is invalidated on the next revalidation. The audit log row is the visible signal.
- **Edit produces a tie (`winner_id = null`).** Supported. Step 5's recompute uses the same head-to-head logic as fresh tournaments. `computeFinalStandings` re-derives placements fully.
- **Concurrent edits to the same match.** The RPC's `SELECT ... FOR UPDATE` lock on the target match row serializes concurrent calls.
- **Repair interleaved with re-pair.** The RPC's transaction prevents partial state, but two distinct actions on the same tournament can serialize. The order matters (repair first to fix history, then re-pair from corrected standings); the UI flows enforce this implicitly because re-pair is offered only after repair completes (toast button) or as a separate explicit action.
- **Re-pair when no results are in but pairings have been physically posted to a table.** The host's responsibility — the confirm checkbox is explicit. Software cannot detect this.
- **Tournament scale.** Designed for the system's existing upper bound of ≤ 128 participants (the value implicit in pairing tests). Full-tournament recompute is O(participants × matches) and remains cheap at this scale; revisit if the bound increases significantly.

## Testing

Coverage is required at three levels: unit (pure functions and RPC inputs/outputs), integration (RPC + DB behavior under realistic conditions), and end-to-end (full host workflow through the UI). Anything load-bearing for correctness gets unit + integration coverage; the major user-facing flows get E2E coverage.

**Unit:**

- `recomputeTotalsFromHistory` is idempotent under repeated edits to the same match (regression guard against the double-count hazard).
- The chronological snapshot rewrite produces correct cumulative `matches.player1_match_points` / `differential` values for a participant's full match history, verified against a hand-computed sequence.
- `repair_match_score` rejects non-host callers.
- `repair_match_score` validates scores against `tournament.max_score`.
- The amended-badge predicate (does this participant + round have any `match_edits`?) returns correct booleans for representative cases.

**Integration:**

- Edit a round-1 score after round 2 has started. Assert: round-1 `matches` row updated; all participant `match_points`/`differential` match a fresh `recomputeTotalsFromHistory`; per-match snapshots on every affected match are correct; `match_edits` row recorded.
- Edit a round-1 score, then generate pairings for round 3. Assert pairing input reflects the corrected round-1 totals.
- `regenerate_current_round_pairings` succeeds when no scores submitted; rejects when any score is non-null (without the unlock flag); succeeds with the unlock flag and deletes the prior scored rows.
- RLS rejects a non-host attempting to insert a `match_edits` row.
- Concurrent calls to `repair_match_score` for the same match serialize via the row lock; the second call sees the first call's writes.

**End-to-end (where it makes sense):**

E2E tests cover the full host workflow through the UI, hitting a real database. Use the existing project E2E harness (Playwright or equivalent); skip E2E for anything already fully covered by unit + integration tests.

- **Repair past-round score, golden path.** Host opens an in-progress tournament with completed rounds. Clicks the pencil on a past-round match card. Edits both scores. Adds a reason. Submits. Asserts: dialog closes, success toast appears, standings reflect the new totals, amended badge appears on the affected participants' standings rows, tournament-wide banner appears, audit log panel shows the new entry.
- **Repair + inline re-pair from toast.** Same as above, but current round has no submitted scores. Click the inline "Re-pair current round?" button in the success toast. Confirm with the checkbox. Asserts: new pairings render, old pairings gone, standings unchanged from the repair.
- **Unlock and re-pair escape hatch.** Current round has one submitted result. Click the re-pair button (disabled state), then the "Unlock and re-pair…" link. Asserts: the dialog lists the affected match with player names and scores; the regenerate button is disabled until the checkbox is ticked; on confirm, the prior result is deleted and new pairings render.
- **Discoverability picker.** Click "Repair past result" in host controls. Select a round and search a player name. Assert: the match card with that player is scrolled into view and the pencil is highlighted.
- **Just-ended round.** Host ends a round, immediately notices a fat-finger entry. Asserts: the just-ended round's matches now show the pencil icon; editing routes through repair (writes a `match_edits` row), not through the live-entry flow.
- **Player view, no host affordances.** Sign in as a non-host participant viewing the same tournament. Asserts: no pencil icons, no re-pair button, no audit log panel, no "Unlock and re-pair" link. Amended badges still visible. Tournament-wide banner visible.
- **Mobile viewport.** Run the repair golden-path test at 375×667 (iPhone SE viewport). Asserts: pencil hit area ≥ 44×44, dialog renders as a bottom sheet, primary action is reachable in the bottom half of the viewport, confirm checkbox is tappable without horizontal scroll.
- **Dark mode.** Run the repair golden-path test with the theme set to dark. Asserts: all new UI renders without contrast or token-resolution issues; disabled-state buttons are visibly disabled; banner and badge meet contrast thresholds. Snapshot or visual-regression check against the light-mode equivalent to catch token-drift.

**UI (component-level, lighter than E2E):**

- Pencil icon appears only for the host, only on rounds where `is_completed = true`.
- Re-pair button is enabled iff `round.is_completed = false` AND no `matches` row for the current round has a non-null `player1_score`; otherwise disabled with the documented tooltip.
- Re-pair confirm button is disabled until the confirmation checkbox is ticked.
- Amended badge renders on the row of any participant who played in a match referenced by a `match_edits` row, and only those rows.
- Tournament-wide banner appears when a `match_edits` row is inserted while a round is in progress, and disappears at the next round-end.

## Rollout

No data backfill required. The pencil icon and "Re-pair current round" button activate immediately for any tournament whose state matches the documented gating rules, including historical tournaments and tournaments in progress at deploy time. The migration adds the `match_edits` table and the `byes` unique index; no existing rows need updating.

## Out of scope / future work

- Tier C full unwind.
- Provisional-round lockout pattern.
- 30-second undo toast for fresh entries.
- Co-host / judge role.
- Player-visible audit log detail.
- Filtering or searching the audit log.
- Realtime push of standings updates after repair.
