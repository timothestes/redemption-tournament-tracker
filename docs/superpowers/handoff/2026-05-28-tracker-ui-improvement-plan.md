# Tracker Host View — Improvement Plan

Source audit: [`2026-05-28-tracker-ui-audit.md`](./2026-05-28-tracker-ui-audit.md)

## Strategic read

The 42 findings are largely downstream of **five structural shortcomings**, not 42 independent problems:

1. **No shared confirmation pattern is in use.** A `ConfirmationDialog` component already exists at `components/ui/confirmation-dialog.tsx` (destructive + warning variants, built on the project's `Dialog`), but the destructive actions wired in `page.tsx` and `ParticipantTable.tsx` don't use it. Every "no confirm" finding (F7, F8, F9, F10) is the same omission.
2. **Three modals bypass the shared `Dialog` primitive** and reinvent the overlay by hand: `MatchEditModal` (`match-edit.tsx:252`), `RegeneratePairingsButton`'s inline dialog (`RegeneratePairingsButton.tsx:70–117`), and `RepairPastResultPicker` (`RepairPastResultPicker.tsx:34`). The shared `Dialog` already gives ESC, backdrop close, scroll lock, and `role="dialog"` for free. Every accessibility/keyboard finding (F12, F13, F27) collapses into "stop rolling your own overlay."
3. **The header chrome (`page.tsx` 618–800) duplicates state that lives inside the Rounds tab and never refetches the tournament after mutations.** Status badge desync (F3), three round labels on one screen (F5), 290 px of pre-tabs chrome (F2), mobile control wrap (F41), the timer showing a fake value between rounds (F4), and the "Tournament has ended"+button collision (F6) are all the same architectural issue: the header is trying to be a status panel and an action bar at once.
4. **The desktop pairings table conflates "one match" with "two player perspectives"** (F1) — and once you stop emitting two rows per match, the next-order findings (F16: cumulative vs. round score, F19: no sticky header, F20: review-mode shows no result, F17/F18: ambiguous action icons) all live in the same component rewrite.
5. **There is no real "Standings" concept** — participant table is doing double duty (F21, F22, F24, F25), and `EditParticipantModal` lets the host silently overwrite cumulative totals (F23) outside the audit log. The roster vs. leaderboard mental models need to be separated.

These five workstreams collapse all 42 findings.

## Workstreams

Ordered by recommended sequence. Critical bugs first, then the confirmation/dialog primitives (so subsequent destructive UI is safe to ship), then info architecture, then visual polish.

---

### WS1 — Critical bug triage

**Goal:** Stop the bleeding. Fix the three Critical-severity defects and the High-severity state desync that make the host view actively wrong.

**Findings addressed:** F1, F3, F7, F26

**Approach:**
- **F26 (Repair picker broken):** In `components/ui/RepairPastResultPicker.tsx`, replace the at-mount initialization `useState<number | "">(completedRounds[0] ?? "")` at line 21 with a `useEffect` that resets `round` when `completedRounds` changes from empty to populated. Skip rendering the picker until `matches.length > 0` AND show a small "Loading completed rounds…" state if the user opens it before the fetch in `page.tsx:537–561` settles.
- **F1 (duplicated rows):** Delete the second `<tr>` block in `components/ui/TournamentRounds.tsx` lines 991–1043. Reshape the remaining row to show both players in one row: columns `Table | Player 1 | Player 2 | Match Points (P1 / P2) | Differential (P1 / P2) | Actions`.
- **F7 (End Tournament no confirm):** Wrap the `handleTournamentStatusToggle` "end" path (`page.tsx:217+`) in the existing `ConfirmationDialog` (`variant="destructive"`, title "End {tournament.name}?", body that names the current round).
- **F3 (status badge desync):** Make `handleEndRound` await its DB writes, then call the parent refresh hook before re-rendering.

**Effort:** M (half day)

**Risk / blast radius:** F1 changes the visual layout of every round view; e2e tests under `e2e/` that select rows by index will need to halve their expected counts. F3 fix touches `handleEndRound` in `TournamentRounds.tsx` which also auto-fills dropped-player matches (lines 273–294) — don't refactor that auto-fill in the same diff. F26 has zero blast radius.

---

### WS2 — Confirmation pattern, rolled out everywhere destructive

**Goal:** One reusable confirm pattern for every destructive action. After this lands, no host action with permanent consequences fires on a single click.

**Findings addressed:** F8, F9, F10, F14, F15, F29

**Approach:**
- Reuse `components/ui/confirmation-dialog.tsx` (already has `destructive` and `warning` variants).
- **F8 (End Round):** Wrap `handleEndRound` invocation in `TournamentRounds.tsx:862`. Title "End Round {N}?" Body "All 8 matches will be locked. New pairings will be generated for Round 3."
- **F9 (Drop player):** Wrap the `CircleMinus` click in `ParticipantTable.tsx:166–174` with `variant="warning"`.
- **F10 (Delete participant):** Wrap the trash icon at `ParticipantTable.tsx:177` with `variant="destructive"`. Also fix the bug at `page.tsx:199` where `showToast("Participant deleted successfully!", "error")` uses the wrong toast type.
- **F14 (alert() in MatchEditModal):** Replace the six `alert()` calls in `components/ui/match-edit.tsx` (lines 79, 83, 95, 114, 118, 192) with inline error text styled `text-destructive text-sm` rendered above the Score selectors.
- **F15, F29 (toasts too short):** In `page.tsx:81`, change `setTimeout(..., 2000)` to `4500` for `error`/`warning` types; keep `success` at 2000.

**Effort:** M

**Risk / blast radius:** Low. Pure additive UI. Don't add a confirm to bulk operations (e.g., pod generation) in this workstream — keep scope tight.

---

### WS3 — Migrate hand-rolled overlays to the shared `Dialog` primitive

**Goal:** Every modal in the host view inherits ESC, backdrop close, focus management, `role="dialog"`, and scroll lock for free. Eliminate the three bespoke overlays.

**Findings addressed:** F11, F12, F13, F18, F27

**Approach:**
- **`MatchEditModal` (`match-edit.tsx:252–301`):** Replace the bespoke overlay with `<Dialog open={open} onOpenChange={setOpen}><DialogContent>...</DialogContent></Dialog>`. Drop the custom Escape `useEffect` at lines 46–56.
- **`RegeneratePairingsButton` (lines 70–117):** Same migration. Also fix F11: rename dialog title to "Re-pair Round N?" and action button to "Re-pair" — match the trigger vocabulary.
- **`RepairPastResultPicker` (lines 34–80):** Same migration. Closes F27.
- **F18:** While in `TournamentRounds.tsx` action column, differentiate the two pencil buttons: live edit gets `aria-label={\`Edit score: ${p1} vs ${p2}\`}`; repair pencil gets `aria-label={\`Repair past result: ${p1} vs ${p2}\`}`.

**Effort:** M

**Risk / blast radius:** `MatchEditModal` is opened from multiple places (in-row edit, in-row repair, picker-driven repair at `page.tsx:853`). All three open paths must keep working. After this, backdrop click closes modals — verify it doesn't lose unsaved score edits silently. Consider intercepting `onPointerDownOutside` in `MatchEditModal` only when the score has been changed.

---

### WS4 — Compact, sticky header that doesn't lie

**Goal:** Strip the header to one row of identity + status + primary host actions; let the work area breathe. Header always reflects current tournament state.

**Findings addressed:** F2, F4, F5, F6, F32, F33, F35, F36, F41

**Approach:**
- Rebuild `app/tracker/tournaments/[id]/page.tsx` lines 618–800 as a single sticky strip (`sticky top-0 z-30 backdrop-blur bg-background/80`).
  - Row 1: `[Tournament Name (edit pencil on hover)]  [Status pill]  [Timer pill if active]  [overflow ⋯ menu: Re-pair, Repair past result, End Tournament]`
  - Row 2 (collapses on mobile): "Created … · Started … · Ended …"
- **F4 (fake timer between rounds):** In the `CountdownTimer` conditional at `page.tsx:719–728`, add `&& latestRound?.started_at && !latestRound?.is_completed` to the guard. Replace the timer block with muted "Round not started" or hide entirely.
- **F5 (three round labels):** Drop `<h3>Round N of M</h3>` inside the Rounds tab. Let the round pagination + header pill carry the load.
- **F6:** The overflow menu makes the "Tournament has endedRepair past result" collision disappear.
- **F32 (chrome renders before data):** Gate the header on `if (!tournament) return <HeaderSkeleton />`.
- **F33 (invalid tournament ID hangs):** In `fetchTournamentDetails` (`page.tsx:122`), set an `error` state when the fetch returns no data or 404s, render "Tournament not found" with a back link.
- **F35 (status color hierarchy):** Use one clean color story: amber=not started, neutral/foreground=in progress (drop the green), muted gray=ended.
- **F36 (Re-pair too prominent):** Once in overflow menu, moot. If inline, outline style.
- **F41 (mobile chrome wrap):** Solved by the rebuild.

**Effort:** L

**Risk / blast radius:** Highest blast radius. End-state visuals shift significantly. Sticky positioning interacts with `window.print()` for pairing sheets — add `@media print` rules to hide the sticky strip. WS1's F3 fix and this F4 fix overlap; sequence WS1 first.

---

### WS5 — Pairings table rebuild + result-as-data

**Goal:** One row per match. Round score (`5–2`) visible without opening a modal. Sticky header. Honest column semantics.

**Findings addressed:** F1, F16, F17, F19, F20, F37, F38, F40

**Approach:**
- After WS1 collapses duplicate rows, rebuild columns: `Table | Player 1 | Result | Player 2 | MP (P1/P2) | Diff (P1/P2) | Actions`.
- **F16, F20:** Show round result (`player1_score`–`player2_score`) AND cumulative MP. Add `title="Cumulative match points after this round"` on MP header.
- **F17 (no "Actions" header):** Drop `sr-only` at line 912–914; visible right-aligned label.
- **F19 (no sticky header):** `<thead>` gets `sticky top-[NN] bg-muted z-10`.
- **F37:** Keep "Print" verb on mobile button labels.
- **F38:** Allow tablist to wrap on small viewports, or abbreviate "Audit log" → "History" on mobile.
- **F40:** Replace native `title=` tooltips with the hover-group pattern used in `TournamentTabs.tsx:153–172`.

**Effort:** M

**Risk / blast radius:** The mobile card layout in `TournamentRounds.tsx:1071–1208` is the audit's positive baseline (F42) — do NOT touch. Only rebuild the `hidden md:table` desktop branch.

---

### WS6 — Participants vs. Standings split, with rank + tiebreakers

**Goal:** Roster management and leaderboard are different things. Stop overloading one tab. Surface tiebreakers.

**Findings addressed:** F21, F22, F23, F24, F25

**Approach:**
- **F21:** Add a fifth tab "Standings" to `TournamentTabs.tsx`. Show only when `tournamentStarted` is true. Participants tab keeps roster management; Standings shows rank, name, W-L-T record, MP, differential, tiebreakers.
- **F22:** Surface a "Tiebreaker" column on Standings (opponent match-win % from the algorithm) with a tooltip.
- **F23:** In `EditParticipantModal.tsx`, make `match_points` and `differential` inputs read-only when `isTournamentStarted` is true. Add a "To change scores, use Repair past result" link. Delete the dead `newDroppedOut`/`setNewDroppedOut` prop at line 24 and remove the prop pipe from `page.tsx:814` and `page.tsx:880–881`.
- **F24:** On Standings tab, mark active sort column with a down-arrow icon and stronger header tint.
- **F25:** Hide Pods + Add Participant buttons in `TournamentTabs.tsx:130–170` when `tournamentEnded`. Keep "Print Final Standings".

**Effort:** L

**Risk / blast radius:** F23 read-only change may break a workflow if any host has used direct MP edits as a known workaround. Surface in PR description. Reuse `utils/tournament/pairingUtilsV2.ts` for tiebreaker computation; don't reimplement.

---

### WS7 — Polish pass

**Goal:** Address remaining low-severity items in one batch after structural work has stabilized.

**Findings addressed:** F28, F30, F31, F34, F39

**Approach:**
- **F28:** After WS4, the in-row green pencil becomes the primary repair path. Reduce header repair entry's prominence (overflow menu).
- **F30:** In `match-edit.tsx`'s `handleOpenModal` (lines 60–68), guarantee `setPlayer1Score`/`setPlayer2Score` always run on open. Use an explicit `null` sentinel, not treating `0` as "no choice."
- **F31:** Change heading to `"Player One — Lost Souls (score):"`. Two extra words.
- **F34:** Add loading state ("Ending…" + spinner with `disabled`) to End Round / End Tournament.
- **F39:** In `components/ui/button.tsx`, change `focus-visible:ring-ring` to `focus-visible:ring-foreground/40`. Per the owner's prior feedback about the jarring green ring.

**Effort:** S

**Risk / blast radius:** F39 is global (every Button). Once-over of forms across the app before merging.

---

## Critical hotfixes (do first, can ship same day)

Extracted from WS1 — ship as one small PR before anything else.

1. **F1 — Duplicated pairing rows.** Delete `components/ui/TournamentRounds.tsx` lines 991–1043. Update surviving row's columns to show both players.
2. **F7 — End Tournament fires with no confirmation.** Wrap the end-tournament branch in `handleTournamentStatusToggle` (`page.tsx:206–263`) in the existing `ConfirmationDialog` (`variant="destructive"`).
3. **F26 — Repair past result picker shows no matches.** In `RepairPastResultPicker.tsx`, add a `useEffect(() => { if (round === "" && completedRounds.length > 0) setRound(completedRounds[0]); }, [completedRounds])` so internal `round` state syncs once the parent's fetch resolves.

## Quick wins (under 1 hour each)

- **F6** — Wrap "Tournament has ended" span + Repair button in `flex items-center gap-2`. `page.tsx:748–799`.
- **F11** — Rename `RegeneratePairingsButton.tsx` line 78 dialog title to "Re-pair Round N?" and action button at line 112 to "Re-pair" / "Re-pairing…".
- **F14** — Replace `alert()` calls in `match-edit.tsx` lines 79, 83, 95, 114, 118, 192 with inline `text-destructive text-sm` paragraphs.
- **F17** — Drop `sr-only` at `TournamentRounds.tsx:913`.
- **F18** — Differentiate aria-labels on the two pencil buttons via a `mode` prop in `match-edit.tsx:247`.
- **F25** — Hide Pods + Add Participant when `tournamentEnded` in `TournamentTabs.tsx:130–170`.
- **F29** — Bump toast `setTimeout` in `page.tsx:81` from `2000` to `4500` for `warning`/`error` types only.
- **F31** — Append "(score)" to "Lost Souls" headings in `match-edit.tsx:213–214`.
- **F36** — Outline-style the Re-pair button in `RegeneratePairingsButton.tsx:55`.
- **F37** — Keep "Print" verb on mobile button labels in `TournamentRounds.tsx:849–860`.
- **F38** — Replace `no-scrollbar` on `TournamentTabs.tsx` tablist with `flex-wrap` or scroll fade indicator.
- **F40** — Replace native `title="…"` on swap-pair button in `TournamentRounds.tsx:949, 1019` with hover-group tooltip pattern.
- **`page.tsx:199`** — Bug: `showToast("Participant deleted successfully!", "error")` should be `"success"`.

## Out of scope / explicit non-goals

- **Mobile pairing cards (`TournamentRounds.tsx:1071–1208`)** — Explicitly preserved per F42. Positive baseline. Desktop table should aspire to be more card-like, but don't refactor the mobile component.
- **Pairing algorithm changes.** No edits to `utils/tournament/pairingUtilsV2.ts`. No algorithmic issues found.
- **Round timer countdown vs. count-up.** Countdown is good. Only F4 hide-when-no-round is requested.
- **AuditLogPanel rework.** Only F38 (tab label truncates) addressed in WS5.
- **Tournament list / host modal / pre-start flows.** Audit scoped to `/tracker/tournaments/[id]`.
- **Re-theming `jayden-gradient-bg`.** Not in any finding.
- **DB migrations.** Tiebreaker info should derive from existing fields.

## Open questions for the owner

1. **End Tournament reversibility.** Confirmation dialog only, or also a soft-delete undo window?
2. **End Round confirmation: dialog or undo toast?** Modal confirm vs. lighter "Round ended — Undo (5s)"?
3. **Standings tab — when does it appear?** After R1 starts (live ranking) or only after R1 ends (stable rankings)?
4. **Re-pair vocabulary — "Re-pair" or "Regenerate"?** Recommendation: Re-pair. Confirm.
5. **Tiebreaker display.** Which tiebreaker — opponent match-win %, head-to-head, buchholz? Confirm what `prompt_context/algorithm.md` actually uses.
6. **Direct match_points/differential edits.** Any legitimate workflow (e.g., deck-check penalty) currently using these inputs before we lock them?
7. **Header overflow menu vs. inline buttons (WS4).** `⋯` dropdown for End Tournament + Re-pair + Repair past result, or keep at least End Tournament always visible?

## Effort summary

- S × 1 (WS7)
- M × 4 (WS1, WS2, WS3, WS5)
- L × 2 (WS4, WS6)
- ~5–7 focused engineering days end-to-end if done sequentially.
