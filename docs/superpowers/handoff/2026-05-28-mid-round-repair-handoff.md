# Mid-Round Repair Feature — Handoff

**Date:** 2026-05-28
**Branch:** `add-repair-option` (39 commits ahead of `main`)
**Spec:** [docs/superpowers/specs/2026-05-27-mid-round-score-repair-design.md](../specs/2026-05-27-mid-round-score-repair-design.md)
**Plan:** [docs/superpowers/plans/2026-05-27-mid-round-score-repair.md](../plans/2026-05-27-mid-round-score-repair.md)

## TL;DR

A 24-task implementation landed. **Three real bugs the user reported during testing remain only partially fixed.** The most visible one — "Re-pair current round" producing identical pairings — is **not actually fixed**: the regenerate flow doesn't trigger a client-side refresh of the matches table even though the DB does get new pairings. There are also two known **data corruption issues** in production (duplicate byes / matches in three tournaments) that the repair feature amplifies rather than causes.

Pick this up by: (1) wiring the regenerate flow to refresh the matches table, (2) addressing the byes/matches dedupe before any host runs repair on the affected tournaments, (3) tackling the UI/UX punch list.

---

## What's working

- `repair_match_score` RPC: atomically updates a past-round match, recomputes participant totals from history (bye-aware as of migration 032b), rewrites per-match cumulative snapshots chronologically, inserts an append-only audit row. Security-hardened against anon bypass.
- `regenerate_current_round_pairings` RPC: replaces current-round pairings atomically with checkbox-gated unlock for in-flight results. Uses a fresh random seed per call.
- Past-round repair pencil (host-only) on completed rounds in the Rounds tab.
- "Amended" badge on Standings rows for participants whose match was edited (uses `match_edits_public` view; visible to all viewers).
- Host-only audit log panel below tournament controls.
- "Repair past result" picker (round dropdown + player search).
- Tournament-wide banner when a repair occurs mid-round (fetch-once limitation — see Open Issues).
- 7 unit tests passing. Integration + E2E tests gated behind `SUPABASE_SERVICE_ROLE_KEY` (committed, ready to run when env is set).

## What's broken (with severity)

### 🔴 BLOCKER — "Re-pair current round" appears to do nothing in the UI

**User's report:** Clicking "Re-pair current round" with checkbox confirm doesn't change the visible pairings in the Rounds tab, even after the latest fixes.

**Why:** The regenerate flow has the SAME refresh gap that the repair flow had, but in a different component path. I fixed the repair flow's refresh (commits `e0a26d5`, `4e9c3df`) but not the regenerate flow's.

- `RegeneratePairingsButton` ([components/ui/RegeneratePairingsButton.tsx](../../../components/ui/RegeneratePairingsButton.tsx)) calls `regenerateCurrentRoundPairingsAction`. On success it calls `onComplete?.()`.
- In `page.tsx` line ~826, `onComplete` is wired to `fetchTournamentDetails` — which only re-fetches the **tournament** row, NOT the matches table.
- The matches table lives in `TournamentRounds.tsx` and is refreshed only by its own `fetchCurrentRoundData`, which the page doesn't have a reference to.

**The DB does get the new pairings** — confirmed via direct SQL query against the same tournament after the regenerate. The browser just keeps showing the old data.

**Fix path:** Same pattern as the participants-refresh wiring I did for repair:
1. Add an `onRegenerateCompleted?: () => void` (or reuse `onRepairCompleted`) on `TournamentRounds` that the parent passes
2. Move the regenerate button INTO `TournamentRounds` so it has direct access to `fetchCurrentRoundData`, OR
3. Hoist `fetchCurrentRoundData` into a ref/imperative handle the page can call

Easiest is option 1: lift the `RegeneratePairingsButton` mount into `TournamentRounds` and let it call `fetchCurrentRoundData` directly on success. The button is rendered above tabs currently — that placement was per the spec but it's the root cause of the refresh gap.

### 🔴 BLOCKER — Pre-existing data corruption: duplicate byes/matches in 3 tournaments

**Affected tournaments:**
- `5cea9b69` — duplicate byes (round 3, 3 dupes)
- `69ac6bf6` — duplicate byes (round 2, 2 dupes)
- `b5112189` — duplicate byes (round 2, 2 dupes)
- `04293e75-8391-42df-9838-32aec585a1e6` — duplicate `matches` AND duplicate `byes` rows. Player 3 in this tournament has stored `match_points = 3` but recomputed-from-history is `6` (because the bye-counting query counts both bye rows).

**Why it matters:** `repair_match_score`'s recompute step sums `3 * COUNT(byes WHERE participant_id = ...)`. Duplicates → inflated match_points. **Any repair on these tournaments will silently corrupt totals.**

This is NOT caused by the repair feature — it was pre-existing. But the repair feature amplifies it.

**Fix path:**
1. Write a cleanup migration: dedupe `byes` by `(tournament_id, round_number, participant_id)` keeping the earliest row. Dedupe `matches` by `(tournament_id, round, match_order)` keeping the earliest.
2. Apply `byes_tournament_round_unique` index (deferred from migration 031).
3. Add a `(tournament_id, round, match_order)` unique constraint on `matches`.
4. Run `recomputeTotalsFromHistory` on every participant in the affected tournaments to fix stored totals.

Until this runs, **do not advertise the repair feature to hosts of those tournaments**.

### 🟠 IMPORTANT — `RepairTournamentBanner` only fetches once on mount

[components/ui/RepairTournamentBanner.tsx:16-38](../../../components/ui/RepairTournamentBanner.tsx#L16-L38) fetches once when the round changes. If a host repairs a past round while the current round is active, the banner won't appear until the page is reloaded — defeating the "tell players standings changed mid-round" goal. Subscribe to `match_edits` via Supabase realtime, or re-fetch after `onRepairSuccess`.

### 🟠 IMPORTANT — Two pencil icons side-by-side on completed rounds

In [TournamentRounds.tsx](../../../components/ui/TournamentRounds.tsx) around lines 937-984 (desktop) and 1109-1136 (mobile), each completed-round match renders BOTH the live-mode `MatchEditModal` (disabled-styled) AND the repair-mode `MatchEditModal`. Two pencils side-by-side, no visual differentiation. On mobile they're stacked and almost touching — high mis-tap risk.

Don't render the live-mode pencil for completed rounds. Render only the repair pencil, possibly with a different icon (wrench, pencil-with-dot) to communicate "repair" vs "edit".

### 🟠 IMPORTANT — Discoverability: "Repair past result" picker button is buried

In page.tsx around line 791-799 the picker entry-point sits below "End Tournament" (a destructive button — bad neighbor) and is only visible from the top of the page. A host on the Rounds tab who realizes a past score is wrong has to scroll up to find it. Move the picker button into the Rounds tab header area, give it a pencil icon, and remove the page-level placement.

### 🟠 IMPORTANT — Repair dialog has no busy/loading state

[components/ui/match-edit.tsx:86-101](../../../components/ui/match-edit.tsx#L86-L101) (repair branch). No `busy` state, no disabled submit button, no spinner. On a slow connection a host can double-tap and submit duplicates.

### 🟠 IMPORTANT — Repair dialog uses native `alert()` for validation errors

[components/ui/match-edit.tsx:79, 83, 95, 111](../../../components/ui/match-edit.tsx#L79) — native `alert()` is a giant disruptive system dialog on mobile mid-flow. Replace with inline error text using the same `text-red-500` pattern already in the file.

### 🟡 MINOR — Several smaller things

- `RegeneratePairingsButton` checkbox copy is misleading: "I confirm no players have started current-round matches" — the host genuinely can't know this. Rephrase as "I have told players not to begin this round."
- `RepairPastResultPicker` round dropdown defaults to most recent (round 3 in a 3-round tournament) — for a host who just realized round 1 is wrong, this is the wrong default. Either default to oldest, or show a placeholder.
- `AmendedBadge` tooltip uses `whitespace-nowrap` + `absolute top-full left-0` — on mobile near a card's right edge it overflows the viewport. Clamp with `max-w-[200px] whitespace-normal`.
- `UnlockAndRepairDialog` list of affected matches has no round context and the scroll box is only 160px tall.
- `RepairTournamentBanner` dismiss state is per-mount — refreshing the page brings the banner back. Persist `dismissed_at` to localStorage keyed by `tournamentId:roundNumber:lastEditId`.
- `AuditLogPanel` and `match-edit.tsx` modal backdrop use `bg-black/60` in one place and `bg-background/80` elsewhere. Inconsistent.
- `match-edit.tsx` repair dialog has no `max-h-[90dvh] overflow-y-auto` — on landscape phones with keyboard open, the buttons can scroll off-screen.

---

## Bugs found and fixed during testing

| Commit | What | Why |
|---|---|---|
| `c2e162b` | `repair_match_score` security hardening (032a) | NULL-bypass + explicit anon revoke; original RPC let unauthenticated requests through silently |
| `5cdd6c9` | `regenerate_current_round_pairings` same security pattern (033) | Proactive same fix |
| `4c3b48b` | Created `match_edits_public` view (034) | Original RLS blocked the player-facing badge entirely |
| `bcd9e6e` | Added `tournament_id` to public view (035) | Banner needed to filter by tournament without a join |
| `d495829` | Bye-aware snapshot rewrite (032b) | Step 7 of the repair RPC was missing bye points; participants with byes had snapshot match_points 3 short per bye |
| `a9f7002` | Picker-flow repair refresh | Picker flow's MatchEditModal had no onRepairSuccess; standings stayed stale after picker-driven repair |
| `73d73b1` | Random seed for regenerate | `rngForRound` was deterministic on `(tournamentId, round)`; round-1 regenerate produced identical pairings each click |
| `3327c52` | `.maybeSingle()` + RPC NULL guard (036) | Tournament `16019ee8` had no rounds row → 406 + silent RPC no-op |
| `f061049` | `TournamentRounds` empty-id guard | First render fired fetch with `tournament_id=""` → 400 |
| `e0a26d5` | Await `fetchCurrentRoundData` before `setOpen(false)` | Repair worked but rounds tab kept old data until manual refresh |
| `4e9c3df` | `onRepairCompleted` plumbed through `TournamentTabs` → `TournamentRounds` | Standings tab stayed stale after repair |
| `4f06a76` | Lock down `match_edits_public` writes (037) | Anon could DELETE audit rows through the view (PUBLIC default writes + SECURITY DEFINER bypassed RLS) |

---

## Migrations applied to production

031, 032, 032a, 032b, 033, 034, 035, 036, 037 — all applied to `dhxxsolhgvimxtusepht` (the main project ref). All function grants verified: `authenticated` has EXECUTE, `anon` does not.

`match_edits_public` view: SELECT for anon/authenticated; INSERT/UPDATE/DELETE revoked from PUBLIC, anon, authenticated.

`byes_tournament_round_unique` index — **NOT applied** (deferred because production has duplicates; see Blocker #2).

---

## File layout

| File | Purpose | Status |
|---|---|---|
| `supabase/migrations/031_create_match_edits.sql` | Audit table + RLS | Applied (byes unique index intentionally commented out) |
| `supabase/migrations/032_repair_match_score_rpc.sql` | Original RPC | Superseded by 032a |
| `supabase/migrations/032a_repair_match_score_security_fix.sql` | NULL guard + anon revoke | Applied |
| `supabase/migrations/032b_repair_match_score_bye_aware_snapshots.sql` | Bye-aware snapshot rewrite | Applied (current authoritative version) |
| `supabase/migrations/033_regenerate_current_round_pairings_rpc.sql` | Regenerate RPC | Applied |
| `supabase/migrations/034_match_edits_public_view.sql` | Public view (initial) | Applied |
| `supabase/migrations/035_match_edits_public_view_add_tournament_id.sql` | Added tournament_id to view | Applied |
| `supabase/migrations/036_regenerate_pairings_require_rounds_row.sql` | RAISE when rounds row missing | Applied |
| `supabase/migrations/037_lock_down_match_edits_public.sql` | Revoke writes on view | Applied |
| `lib/tournament/snapshotRewrite.ts` | TS twin of step-7 snapshot rewrite (bye-aware) | 5 unit tests passing |
| `lib/tournament/repairBadges.ts` | Amended-badge predicate | 3 unit tests passing |
| `app/tracker/tournaments/repair-actions.ts` | Server action wrappers around both RPCs | tsc clean |
| `app/tracker/tournaments/__tests__/repair-actions.test.ts` | Integration tests | Skip-gated on `SUPABASE_SERVICE_ROLE_KEY` |
| `components/ui/match-edit.tsx` | Added `mode: "live" \| "repair"` + external open control + onRepairSuccess | |
| `components/ui/TournamentRounds.tsx` | Per-match repair pencil (host-only, `is_completed = true`), inline edit history disclosure, fetches `match_edits` for badges | |
| `components/ui/AmendedBadge.tsx` | New | |
| `components/ui/AuditLogPanel.tsx` | New (host-only, mounted at page.tsx ~line 691) | |
| `components/ui/RegeneratePairingsButton.tsx` | New (mounted in page.tsx host controls) | **Doesn't refresh matches table after success — see Blocker #1** |
| `components/ui/UnlockAndRepairDialog.tsx` | New escape hatch | |
| `components/ui/RepairTournamentBanner.tsx` | New (banner during in-progress round) | Fetch-once limitation |
| `components/ui/RepairPastResultPicker.tsx` | New (host discoverability) | |
| `app/tracker/tournaments/[id]/page.tsx` | Mounts all the above | `onRepairCompleted` wired for per-match repair; **regenerate flow not wired to refresh matches** |
| `e2e/` | Playwright config, fixtures, 6 spec files | Skip-gated on env |

---

## Recommended next steps (in order)

1. **Fix the regenerate refresh bug.** Move `RegeneratePairingsButton` inside `TournamentRounds` and have its `onComplete` call `fetchCurrentRoundData` directly. The page-level mounting was the spec's suggestion but it's structurally wrong because the matches state lives one component deeper.

2. **Write the dedupe migration** for the 4 affected tournaments. Dedupe byes by `(tournament_id, round_number, participant_id)`, dedupe matches by `(tournament_id, round, match_order)`, then run `recomputeTotalsFromHistory` on each participant. Then apply the deferred unique indexes.

3. **Investigate WHY some tournaments are missing `rounds` rows** (tournament `16019ee8` was the smoking gun). The tournament-start path that should insert `rounds` is bypassed somewhere. Likely a code path that creates matches without writing the rounds row. Find and fix that — band-aiding via `.maybeSingle()` masks an upstream bug.

4. **Tackle UI/UX punch list** in priority order: duplicate pencils → busy state on dialog → banner refresh after repair → picker discoverability → alert() removal.

5. **Verify integration + E2E tests work** by setting `SUPABASE_SERVICE_ROLE_KEY` against a preview branch and running them. The selectors in the E2E specs are best-effort and will likely need tuning on first run.

---

## Open questions / known limitations

- **Tier C (full unwind) is intentionally out of scope.** Bye reassignment after a repair that would have changed bye recipient is NOT corrected — the original bye row stays. Acknowledged in the spec.
- **Realtime push for non-host viewers is out of scope.** The "amended" badge and banner refresh on standings query revalidation, not via Supabase realtime channels. v2 candidate.
- **Single-host model.** No co-host / judge role. If multi-judge is needed, that's a separate feature.
- **The `match_edits.edited_by` column is exposed via `select('*')` in `AuditLogPanel`** but not displayed — minor over-fetch. Tighten to enumerated columns if it matters.

---

## What I'd do differently if doing this again

- **Build the regenerate flow inside the component that owns the matches table from the start.** The spec's structural decomposition put it in `page.tsx`, but that decision is what created the refresh-gap bug.
- **Write a migration scaffold that includes the safety check for the byes unique index before adding the index itself.** "Add unique index if dedupe succeeds, fail loudly if not" rather than the implementer needing to choose.
- **Demand a smoke-test environment.** The integration + E2E tests are committed but were never actually run because no service-role key was available. That's a huge gap — every bug the user found in testing would have surfaced in a smoke test.
- **Verify view privileges explicitly.** `REVOKE ALL ON FUNCTION ... FROM PUBLIC` ≠ `REVOKE EXECUTE FROM anon` in Supabase. Same for views. Always check `information_schema.role_table_grants` after creating a new view or function.
