# Tracker Host View UI/UX Audit — 2026-05-28

## Summary

The host view is **functional but unrefined**. The core flows work, dark mode is coherent, the timer is solid, and the mobile pairing/standings cards are a clear improvement over the desktop table. But the experience is shot through with friction that punishes a distracted mid-round organizer: pairings are rendered twice per match (one row per player) which doubles every scroll, destructive actions (End Tournament, drop player) fire on a single click with no confirmation, the round-status badge in the header desyncs from the actual round state until a full reload, and the "Repair past result" picker appears completely broken — it shows "No matches found" for valid completed rounds. The top three issues to fix are (1) the duplicated pairing rows, (2) End Tournament / drop without confirmation, and (3) the broken Repair past result picker.

Things working well that should not be lost in the rewrite: the duplicate-name confirmation in Add Participant, the crown icon for the winner on the ended-tournament standings, the dark-mode polish on the cards, the countdown timer's expiring color states (warning → urgent → expired), and the mobile pairing-card layout in `TournamentRounds.tsx`.

## Method

- **Seed:** Wrote a small `node --env-file=.env.local` script modeled on `e2e/seed.ts::seedTournamentWithCompletedRound1` that produces an 8-player tournament with R1 completed and R2 pairings ready. Also built a tournament from scratch in the UI (4 players → start → R1 score → end round → R2) to verify the live-state behavior. Tournaments and test users were cleaned up at the end.
- **Routes explored:** Only `/tracker/tournaments/[id]` — host POV — and necessary modal/dialog overlays attached to it. The tournaments list and brief navigation through it were used only to reach the detail page.
- **Viewports:** 1280×900 (desktop, primary) and 390×844 (mobile, light incidental pass). Tested both light and dark mode.
- **States explored:** Pre-start (empty + with participants), mid-round (scores incomplete), end of round (with one match unscored, then all scored), round transition (R1 → R2), tournament ended, invalid tournament ID. Drove every visible button at least once; opened every modal/dialog; tabbed through the four tabs.

## Findings

### Navigation & Information Architecture

#### F1: Pairings table renders every match TWICE — once per player

- **Severity:** Critical
- **Where:** `components/ui/TournamentRounds.tsx` lines 894–1067 (`hidden md:table` desktop pairings table). Each `matches.map((match, index) => ...)` block emits two `<tr>` rows: lines 921–990 (player1-perspective) and lines 991–1043 (player2-perspective).
- **Observation:** On an 8-player round, the pairings table shows 16 rows (8 matches × 2). Table 1 appears twice: row A = "Alice Anderson vs Carol Chen", row B = "Carol Chen vs Alice Anderson". Same data, two rows, two edit buttons that open the same modal. The same is true in the completed-round view.
- **End-user impact:** Every scroll, every print pairings preview, every "find me my match" attempt is twice as long as it needs to be. At a 28-player table count the user has to skim 56 rows. The duplicate also creates visual confusion — you can't tell at a glance if "Alice vs Carol" and "Carol vs Alice" are the same match or two different matches.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/04-rounds-table-duplicated.png`, `37-round-1-completed-view.png`
- **Suggested direction:** One row per match, with both players visible side-by-side, no perspective duplication.

#### F2: Header banner consumes ~290 px of vertical space before the tabs

- **Severity:** High
- **Where:** `app/tracker/tournaments/[id]/page.tsx` lines 618–800 (title + status badge + dates + timer + end/repair buttons all stacked).
- **Observation:** On a 900 px-tall viewport during an active round, the tab strip starts at y≈294 px — about 33% of the screen is consumed by chrome before any tab content appears. The chrome includes: breadcrumb, title row with status pill, dates line, 80 px timer block, End Tournament + Re-pair current round + Repair past result buttons.
- **End-user impact:** The TO has to scroll just to see whose match they're entering, especially on a laptop. The "above the fold" mid-round view shows almost no pairings.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/23-round-active.png`, `26-after-score-entry.png`
- **Suggested direction:** Condense the chrome into one sticky strip; let the table breathe.

#### F3: Status badge desyncs from real round state after End Round

- **Severity:** High
- **Where:** `app/tracker/tournaments/[id]/page.tsx` lines 643–655 — the status pill reads from `tournament.current_round`, which is updated by `TournamentRounds.handleEndRound` but the parent `tournament` state isn't refetched on End Round.
- **Observation:** Reproduced cleanly: started R1, scored both matches, clicked "End Round" in the Rounds tab. The Rounds panel correctly shows "Round 2 of 2", but the title-row status badge still says **"Round 1 of 2"** and stays wrong until a full page reload. The Round Timer block continues to show the old timer value (`00:45:00`) without the new round's start state.
- **End-user impact:** After ending a round, the page lies to the user about where the tournament is. A TO checking "did the round end?" gets contradictory signals.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/29-end-round-no-confirm.png` (state immediately after End Round — title says R1, panel says R2)
- **Suggested direction:** End Round should refresh `tournament` from the server before re-rendering header.

#### F4: "Round Timer" block displays a fake-looking time when no round is active

- **Severity:** Medium
- **Where:** `app/tracker/tournaments/[id]/page.tsx` lines 719–728. The CountdownTimer renders whenever `tournament.has_started && !tournament.has_ended && round_length` are all truthy — regardless of whether the current round has been Started.
- **Observation:** Between rounds (after End Round, before Start Round) the timer block shows `00:45:00` in big monospace numerals next to a "Round Timer" label. It looks like the timer is paused or about to start, but actually it's just the static "duration if started now" value. Same problem when the page first loads R2 pre-start.
- **End-user impact:** Glanceable confusion. A TO might think the timer is running.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/21-after-start.png` (`00:45:00` shown but round not yet started), `32-round-2-active.png` vs `29-end-round-no-confirm.png`
- **Suggested direction:** Hide or visually deactivate the timer block when no round is currently in-progress.

#### F5: Three different "round" labels stack on the same screen

- **Severity:** Medium
- **Where:** `app/tracker/tournaments/[id]/page.tsx` (status badge), `components/ui/TournamentRounds.tsx` lines 817–831 (h3 + dates), and the Flowbite Pagination at the bottom.
- **Observation:** On the Rounds tab the user sees: "Round 2 of 3" (status pill in header), "Round 2 of 3" (h3 inside Rounds panel), and "1 | 2 | 3" (pagination at the bottom). Three controls, three different visual treatments, redundant information.
- **End-user impact:** Hierarchy is unclear. The user has to figure out which one of the three is interactive.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/04-rounds-table-duplicated.png`, `37-round-1-completed-view.png`

#### F6: "Repair past result" button text mashes against "Tournament has ended" with no separator

- **Severity:** Low
- **Where:** `app/tracker/tournaments/[id]/page.tsx` lines 748–799. The "Tournament has ended" span and the "Repair past result" button are both direct children of the title block but rendered inline without a separator or wrapper that adds spacing on the same line.
- **Observation:** On the ended tournament screen the text reads literally "Tournament has endedRepair past result" with no space between them (visible in the body text dump of the live UI; visually the button border helps but the layout still reads as one line with no breathing room).
- **End-user impact:** Looks like a typo or unfinished UI.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/12-end-tournament-after.png`, `43-ended-loaded.png`

### Round Controls

#### F7: End Tournament fires on one click with no confirmation

- **Severity:** Critical
- **Where:** `app/tracker/tournaments/[id]/page.tsx` lines 206–263 (`handleTournamentStatusToggle`) wired to the "End Tournament" button at lines 731–747.
- **Observation:** Clicked the red "End Tournament" button mid-round. **No confirmation modal appeared.** The tournament immediately flipped to "Ended", the page re-rendered with "Tournament has ended" inline text, and the only path back is for the host to remember they can't undo this.
- **End-user impact:** A mid-round mis-click ends the entire tournament. There's no undo in the UI. This is the kind of bug that destroys trust the first time it happens at an event.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/12-end-tournament-after.png` (immediately post-click; no dialog appeared)
- **Suggested direction:** Confirmation modal with the tournament name, current round, and a "type to confirm" or explicit acknowledgement.

#### F8: End Round fires with no confirmation when scores are complete

- **Severity:** High
- **Where:** `components/ui/TournamentRounds.tsx` lines 313–469 (`handleEndRound`).
- **Observation:** After entering both match scores for R1, clicked "End Round" — no confirmation. The round immediately ended, R2 pairings auto-generated, and tab refreshed. Unlike End Tournament, this is reversible (via Re-pair / Repair past result), but the friction of fixing a mis-clicked End Round is high.
- **End-user impact:** A TO who clicks End Round before the last reporter has finished scoring will trigger the auto-drop-handling fill-in (lines 273–294) and create paired matchups they didn't intend.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/29-end-round-no-confirm.png`
- **Suggested direction:** Quick "End round and lock results?" confirmation, ideally inline (toast-style with Undo).

#### F9: Dropping a player fires on one click with no confirmation

- **Severity:** High
- **Where:** `components/ui/ParticipantTable.tsx` lines 166–174; calls `onDropOut(participant.id)` from `app/tracker/tournaments/[id]/page.tsx::dropOutParticipant` (lines 471–483).
- **Observation:** Clicked the minus-circle icon next to "Alice Anderson". The participant was immediately marked dropped — a small uppercase "DROPPED" tag appeared next to her name, she moved in the sort order, and the only feedback was the row visually changing. No confirmation. No toast. No undo prompt.
- **End-user impact:** Misclicks during a chaotic mid-round are easy. Even though there's a Restore button (CirclePlus), the silent state change is jarring and easy to miss until later when the next round's pairing excludes them.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/14-drop-confirm.png` (showing the "DROPPED" tag immediately post-click; no dialog ever appeared)
- **Suggested direction:** A brief confirm or an undo toast ("Alice dropped — Undo").

#### F10: Deleting a participant (pre-start) fires on one click with no confirmation

- **Severity:** High
- **Where:** `components/ui/ParticipantTable.tsx` line 177; calls `onDelete(participant.id)` → `app/tracker/tournaments/[id]/page.tsx::deleteParticipant` (lines 191–204).
- **Observation:** Same shape as F9: clicking the trash icon pre-tournament-start deletes the participant outright with no confirmation. A toast appears ("Participant deleted successfully!" — typed as `"error"` style in code despite being a success outcome).
- **End-user impact:** No undo. If the TO accidentally deletes someone after they paid the entry fee, they have to re-type the name and lose deck attachment.
- **Screenshot:** (no separate capture — same pattern as F9)
- **Suggested direction:** Confirmation or undo toast. Also fix the toast type (`"error"`) at `page.tsx:199`.

#### F11: "Re-pair current round" button uses different vocabulary in the dialog ("Regenerate")

- **Severity:** Low
- **Where:** `components/ui/RegeneratePairingsButton.tsx` line 57 (button: "Re-pair current round") vs line 78 (dialog title: "Regenerate pairings for round N?") vs line 112 (action button: "Regenerate").
- **Observation:** The user clicks something labeled "Re-pair" and gets a dialog asking to "Regenerate". The action button completes the action with "Regenerate" or "Regenerating…". Three terms for the same concept.
- **End-user impact:** Mild trust degradation — labels not matching makes users second-guess they're in the right flow.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/11-repair-current-round-dialog.png`

#### F12: Several dialogs and modals can't be dismissed with ESC

- **Severity:** Medium
- **Where:** `RegeneratePairingsButton.tsx` (lines 70–117), `RepairPastResultPicker.tsx` (lines 34–80) — both render their own `role="dialog" aria-modal="true"` div with no `Escape` handler.
- **Observation:** With the "Regenerate pairings" dialog open, pressing Escape did not close it; Playwright then couldn't click the underlying "End Tournament" button because the dialog intercepted pointer events. Same for the Repair past result picker. Only the legacy `MatchEditModal` (lines 46–56) wires an explicit `keydown` Escape listener, and the shared `Dialog` primitive used by `EditParticipantModal` works because Radix handles it.
- **End-user impact:** Keyboard users and power users can't dismiss these dialogs without aiming at the Cancel/Close button. Combined with the lack of backdrop click-to-close on `MatchEditModal` (see F13), feels like a trap.
- **Screenshot:** None — behavioral.

#### F13: MatchEditModal backdrop click doesn't close, no focus trap, no `role="dialog"`

- **Severity:** Medium
- **Where:** `components/ui/match-edit.tsx` lines 252–301.
- **Observation:** The Edit Match modal is rendered as a `<div className="fixed inset-0 z-50 ...">` overlay with no `role="dialog"`, no `aria-modal`, no `aria-labelledby` pointing at the h2. Clicking the dark backdrop does nothing (verified by dispatching a click event programmatically). Escape DOES close it (explicit listener), but tab order leaks outside the modal — focus can escape onto the page beneath because there is no focus trap.
- **End-user impact:** Inconsistent dialog behavior; the user has to find the Cancel button explicitly. Worse for screen reader users.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/05-match-edit-modal.png`

#### F14: MatchEditModal uses native `alert()` for validation errors

- **Severity:** Medium
- **Where:** `components/ui/match-edit.tsx` lines 79, 83, 95, 114, 118, 192.
- **Observation:** Score-out-of-range and the impossible-5-5 score case use `window.alert()` (e.g., `alert("Score cannot be 5-5.")`). Repair-flow failures also use `alert("Repair failed: ...")`. Errors block the modal until the user dismisses the alert.
- **End-user impact:** Native alerts feel like a defect; they don't match the toast system used elsewhere. Inconsistent error UX.
- **Screenshot:** None — modal text only triggers on edge cases.

#### F15: Submitting End Round with missing scores shows red row tint, but the toast disappears in 2 seconds

- **Severity:** Medium
- **Where:** `app/tracker/tournaments/[id]/page.tsx` line 81 — `setTimeout(() => setToast..., 2000)`.
- **Observation:** Tried to End Round with one match unscored. The unscored rows turned pink (correct), and the warning toast "Please add scores to all matches." flashed briefly. Two seconds later the toast was gone and the only remaining cue was the pink rows — which look like the same style as the "end-round error" highlight. No persistent banner or summary tells the user how many matches still need scoring.
- **End-user impact:** A glance-back-to-screen TO might miss the toast entirely and only see "some rows are pink, why?" There's no recovery affordance.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/27-end-round-incomplete-error.png`
- **Suggested direction:** Persistent banner "2 matches still need scores — Table 2, Table 3" until resolved.

### Pairings

#### F16: Pairing table columns conflate stored cumulative totals with single-round result

- **Severity:** Medium
- **Where:** `components/ui/TournamentRounds.tsx` lines 894–1043 — uses `match.player1_match_points` and `match.differential` columns from the matches table.
- **Observation:** Headers read "Match Points" and "Differential" but what's stored on the match row is **cumulative-after-this-match**. So row 1 Player One shows "3" / "+3" (because they were 0/0 entering R1 and went +3 in this match). In R2, the same column for the same player would show their lifetime running total. No header hint tells the user "this is cumulative", and the raw round score (5-2) is **nowhere in the pairings table** after submission.
- **End-user impact:** A TO trying to verify "did I enter the right score?" can't see "5-2" anywhere in the pairings view — only the cumulative match points (3) and the cumulative differential (3). To verify the score they have to reopen the Edit modal.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/37-round-1-completed-view.png`
- **Suggested direction:** Add a "Result" column that shows the lost-souls score literally (`5–2`, `3–3`, etc.).

#### F17: Row action icons are not labeled in the table header

- **Severity:** Medium
- **Where:** `components/ui/TournamentRounds.tsx` line 912–914 — `<th>` for Actions has `<span className="sr-only">Actions</span>` only.
- **Observation:** The desktop pairings table renders three small icons in the rightmost cells (pencil, up-down swap, sometimes a second pencil in green for repair on completed rounds) with no visible column header. Their purpose is conveyed only by hover tooltips. Worse, when the row is for the second player in a duplicated pair (F1), the green repair pencil is absent — so the same conceptual action has different controls depending on which duplicate row you're on.
- **End-user impact:** Discovery cost. New users see anonymous icons. Inconsistency between row pairs makes it worse.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/37-round-1-completed-view.png`

#### F18: Two action buttons in the same row share the exact same `aria-label="Edit match scores"`

- **Severity:** Medium
- **Where:** `components/ui/match-edit.tsx` line 247 (the pencil button has `aria-label="Edit match scores"` and is used twice in `TournamentRounds.tsx` lines 939–947 and 972–986 — once for live edit and once for repair edit).
- **Observation:** In a completed-round row a screen reader sees two enabled "Edit match scores" buttons in the same row, with no distinction between live-edit (disabled in completed rounds) and repair-edit. Inspected DOM confirms both buttons carry the identical `aria-label`.
- **End-user impact:** AT users can't tell which control they're activating. Visual users are also unsure — they have to read the green tint to distinguish.
- **Screenshot:** None — accessibility property, not visible.

#### F19: No sticky table header on pairings table

- **Severity:** Medium
- **Where:** `components/ui/TournamentRounds.tsx` lines 894 — `<table className="hidden md:table min-w-full ...">` has no sticky-header treatment.
- **Observation:** With duplicate rows (F1) and 8 participants, the table is 16 rows tall and pushes the column headers off-screen as you scroll. At realistic tournament sizes (28–32 players), the headers disappear after about 8 matches.
- **End-user impact:** Scrolling players lose context for what column is what. They have to scroll back up.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/04-rounds-table-duplicated.png` (rows extend past viewport)

#### F20: Past completed round pairings show stored 0/0 totals from seeded data — and there is no "Result" column for review

- **Severity:** Medium
- **Where:** `components/ui/TournamentRounds.tsx` — the past-round pagination view (pagination button "1" while currentRound is 2).
- **Observation:** On the seeded tournament where R1 was completed with real scores in the matches table (5-0, 5-2, 3-3, 5-1), navigating to the R1 page via pagination showed all four matches with the Match Points and Differential columns *blank* (because the seed didn't denormalize `player1_match_points` and the related snapshot fields). Even when the field was populated (live test), it shows the cumulative running total, not the round result (see F16). The actual `5-2` outcome was nowhere visible.
- **End-user impact:** A TO trying to review what happened in R1 sees a table that conveys almost nothing about who won. They have to click Edit to peek at the score.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/08-round-1-view.png`, `37-round-1-completed-view.png`

### Standings & Participants

#### F21: There is no "Standings" view — participants table doubles as both

- **Severity:** High
- **Where:** `components/ui/TournamentTabs.tsx` lines 124–222 plus `components/ui/ParticipantTable.tsx`.
- **Observation:** The Participants tab is the only place to see ranking. Pre-tournament it's a list of names. Mid-tournament it transforms into a standings table — same component, same column headers. There's no separate Standings tab and no visible "Rank" or position number — players are sorted by match points/differential but the user has to count rows to know "I'm in 4th place".
- **End-user impact:** Players checking their position mid-round have to scroll and count. The conflation of "list of participants" and "current standings" also means the same screen serves two different mental models (manage the roster vs. see the leaderboard).
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/30-standings-after-r1.png`, `42-ended-tournament-view.png`
- **Suggested direction:** Add an explicit Rank column, or split into a separate Standings tab. (Note: this is partly addressed on the ended-tournament view by the Crown icon for the winner — but only the #1 player.)

#### F22: Tied standings show no tiebreaker information

- **Severity:** Medium
- **Where:** `components/ui/ParticipantTable.tsx` lines 78–92 — sort uses `match_points` then `differential` only.
- **Observation:** In the live tournament, Player Two and Player Three both ended R1 with `1.5 / 0` (tied score, tied differential). They appear as adjacent rows with no indication of who's "ahead" — but they ARE ordered (Player Two above Player Three). The order is deterministic but arbitrary from the user's POV. No third tiebreaker is exposed (`/opponent match-win %`, `head-to-head`, etc., per the algorithm docs).
- **End-user impact:** Players asking "why am I 4th and not 3rd?" can't get an answer from the UI.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/30-standings-after-r1.png`, `34-dark-mode-standings.png`

#### F23: EditParticipantModal lets host write match points and differential directly — and the drop-out checkbox prop is destructured but never rendered

- **Severity:** High
- **Where:** `components/ui/EditParticipantModal.tsx` — file is 116 lines; renders inputs for `match_points` and `differential` but never renders a checkbox/toggle for `newDroppedOut`, even though `setNewDroppedOut` is destructured (line 24).
- **Observation:** From the Participants tab during an active tournament, the host can click Edit on any player and change their tournament-wide match points and differential to arbitrary numbers — bypassing the audit log and the per-round repair flows. Meanwhile the `newDroppedOut` toggle that the parent expects to be controlled is just… missing from the rendered form. Drop is handled by a different button (CircleMinus in the row), so the prop is dead code.
- **End-user impact:** A confused TO can silently rewrite history without leaving a paper trail — and the modal's design implies these are valid edits. Separately, the dropped-out prop in the parent state is wired in but the UI control is gone.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/13-edit-participant-modal.png`
- **Suggested direction:** Either move match_points/differential editing into the repair-with-reason flow, or make these fields read-only here. Either way, remove the dead `newDroppedOut` prop wiring.

#### F24: Standings/participants table has no sort affordance even though it IS sorted

- **Severity:** Low
- **Where:** `components/ui/ParticipantTable.tsx` lines 311–319 — `<Table.HeadCell>` for Name, Deck, Match Points, Differential. Plain text, no chevron, `cursor: auto` (verified).
- **Observation:** The table is presorted by `match_points desc, differential desc`, but there's no visual indicator (no down arrow, no underline on the sorting key) and clicking the header does nothing. A user expecting to sort by Name (e.g., to find a player) has no recourse other than Ctrl-F.
- **End-user impact:** Discovery + recovery friction. Looking up "Hank Harris" in a 28-row table requires scanning all rows visually.

#### F25: Print Final Standings / Pods / Add Participant remain visible on an ended tournament

- **Severity:** Low
- **Where:** `components/ui/TournamentTabs.tsx` lines 130–170 — Pods button and Add Participant button only check `participants.length > 1` and `tournamentStarted` respectively, not `tournamentEnded`.
- **Observation:** On the ended-tournament Participants view, the host still sees "Pods" (pod-generation, a pre-tournament feature), "Print Final Standings" (appropriate), and "Add Participant" rendered as a disabled-styled button with the "Cannot add participants after tournament has started" tooltip text — the tooltip is the right idea but the button doesn't belong in an end-state view.
- **End-user impact:** Visual clutter; user has to figure out which controls are relevant post-tournament.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/42-ended-tournament-view.png`

### Repair / Picker / Audit

#### F26: "Repair past result" picker is broken — shows "No matches found" for valid completed rounds

- **Severity:** Critical
- **Where:** `components/ui/RepairPastResultPicker.tsx` (especially the round-state init at line 21 — `useState<number | "">(completedRounds[0] ?? "")` evaluates once at mount, not when `completedRounds` arrives later) combined with how `app/tracker/tournaments/[id]/page.tsx` defers the fetch of `allCompletedMatches`.
- **Observation:** Reproduced twice — once with a freshly seeded tournament whose R1 had four completed matches, once with a tournament I built from scratch in the UI and completed R1 manually. Both times opening the "Repair past result" picker shows the round selector populated correctly (the round dropdown reads "Round 1"), the search input is empty, and the list shows only "No matches found." Confirmed via direct DB query that the matches exist for `round=1`.
- **End-user impact:** This is the entry point to one of the app's most important safety features (fixing a misreported result in a past round) and it appears completely broken from the host's perspective. The Repair Past Result button visible in the header doesn't do anything useful.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/15-repair-past-result-picker.png`, `15c-repair-picker-still-empty.png`, `36-repair-past-result-fresh.png`
- **Suggested direction:** Reset internal `round` state when `completedRounds` prop arrives; also ensure `matches` prop is populated before the picker opens, or show a loading state.

#### F27: Repair past result picker has no ESC handler

- **Severity:** Medium
- **Where:** `components/ui/RepairPastResultPicker.tsx` lines 34–80.
- **Observation:** Same shape as F12 — the picker is a `role="dialog"` overlay but pressing Escape does not close it. The only exit is the Close button.
- **End-user impact:** Keyboard interaction is broken; users expect ESC to dismiss dialogs.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/15-repair-past-result-picker.png`

#### F28: "Repair past result" CTA placement is confusing (header) while the in-row repair pencil is also available

- **Severity:** Low
- **Where:** `app/tracker/tournaments/[id]/page.tsx` lines 791–799 (header Repair button) + `components/ui/TournamentRounds.tsx` lines 971–986 (in-row green pencil).
- **Observation:** A host can repair a past-round result two ways: (a) click "Repair past result" in the header banner, which opens a picker that asks them to choose a round and a match (broken — see F26), or (b) page through the Rounds tab to the past round and click the small green pencil icon on a row. Both paths exist, neither is signposted, and the picker approach is broken.
- **End-user impact:** Mid-round fix path is confusing. If the picker is fixed, two equivalent entry points still beg the question of which to use.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/02-header-controls.png` (header button visible) and `37-round-1-completed-view.png` (in-row green pencil visible)

#### F29: Toasts are 2 seconds long — too short for failure messages

- **Severity:** Low
- **Where:** `app/tracker/tournaments/[id]/page.tsx` line 81.
- **Observation:** The `showToast` helper auto-dismisses after `2000ms`. When clicking End Round with missing scores, the warning "Please add scores to all matches." flashed for 2 s and disappeared.
- **End-user impact:** A distracted TO can miss the only error feedback entirely; the only persistent cue afterwards is the pink-tinted rows.
- **Screenshot:** None — toast was already gone in `07-end-round-no-confirm.png`.

### Forms & Inputs

#### F30: Score selector buttons in MatchEditModal don't preselect the existing score

- **Severity:** Low
- **Where:** `components/ui/match-edit.tsx` lines 60–68 (`handleOpenModal`).
- **Observation:** Initial open preselects scores when `match.player1_score !== null` (good). But re-opening to edit shows zero highlighting until the user clicks again. Actually verified that with an unsubmitted match, both rows show "0" as the default selection — but the selected state isn't visually distinct enough at a glance. Score 0 is colored the same as unselected scores 1–4 because there's no "no choice yet" mode.
- **End-user impact:** Minor — TO might accidentally submit "0-0" if they hit Update too fast.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/25-match-edit-modal-fresh.png`

#### F31: Score row uses jargon "Lost Souls" without context

- **Severity:** Polish (per project conventions this is correct CCG terminology)
- **Where:** `components/ui/match-edit.tsx` line 213–214.
- **Observation:** The heading reads "Player One Lost Souls:" with a row of 0–5 buttons. For Redemption players this is correct vocabulary, but a new TO running their first event might not connect "Lost Souls" to "the score". The Settings tab uses "Maximum Lost Souls Score" which gives some context, but the match modal doesn't.
- **End-user impact:** Onboarding friction for first-time hosts. Existing players will recognize this immediately.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/06-match-modal-score-selected.png`

### Loading & Feedback

#### F32: Initial page-load renders the chrome (tabs, header buttons) with empty/placeholder content for ~1 second

- **Severity:** Medium
- **Where:** `app/tracker/tournaments/[id]/page.tsx` lines 602–893 — the entire layout renders unconditionally; `tournament && (...)` gates the title block but the breadcrumb, tabs, and even the Participants table with "No participants found" empty state render before any data resolves.
- **Observation:** Navigated to the tournament URL fresh. The page briefly shows: title "Loading..." in the breadcrumb, no tournament name, no status badge, no timer block, "Participants" tab active with "No participants found" empty state. ~1 s later the real data loads.
- **End-user impact:** Confusing flash of "empty tournament" before data arrives. A distracted user might briefly think they navigated to the wrong tournament.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/43-ended-loaded.png` (mid-load capture)
- **Suggested direction:** Skeletons for title and key blocks, or hide the tabs until tournament data arrives.

#### F33: Invalid tournament ID shows "Loading…" indefinitely, not a 404

- **Severity:** High
- **Where:** `app/tracker/tournaments/[id]/page.tsx` lines 122–134 (`fetchTournamentDetails` catches but doesn't set an error state).
- **Observation:** Navigated to `/tracker/tournaments/00000000-0000-0000-0000-000000000000`. The page renders with breadcrumb "Tournaments > Loading…" forever; the Participants table renders "No participants found"; nowhere does the page tell the user "This tournament doesn't exist" or redirect them. Console shows fetch errors but UI gives no feedback.
- **End-user impact:** A bad link, a deleted tournament, or a stale bookmark just leaves the user in limbo. They have to manually navigate back.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/44-bad-id.png`

#### F34: No loading state on End Round / End Tournament buttons

- **Severity:** Low
- **Where:** `app/tracker/tournaments/[id]/page.tsx` line 731 (End Tournament Button — no `disabled` while in-flight); `components/ui/TournamentRounds.tsx` line 862 (End Round button — has `disabled={matchEnding}` but no visible "Ending…" label).
- **Observation:** Clicking End Round triggers a ~500ms operation that recomputes participant totals from history and may take longer with more participants. The button has no spinner or "Ending…" state. The toast/state cue arrives after completion.
- **End-user impact:** Risk of double-click during slow networks → double End Round triggers.

### Visual Design

#### F35: Status badge color logic uses amber/primary/muted with no clear hierarchy convention

- **Severity:** Low
- **Where:** `app/tracker/tournaments/[id]/page.tsx` lines 643–655.
- **Observation:** Three states: "Not Started" → amber bg; "Round N of M" → primary (green) bg; "Ended" → muted (grey) bg. The green-for-in-progress feels like a success state, which collides with the "Tournament has ended" → muted grey, which feels like an info state. There's no urgent/warning treatment for, say, "round time expired".
- **End-user impact:** Mild semantic mismatch — "in progress" looking like "success" makes the ended (muted) state look like "stopped/error" by comparison.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/02-header-controls.png`

#### F36: The "Re-pair current round" button is bright green like a primary CTA

- **Severity:** Low
- **Where:** `components/ui/RegeneratePairingsButton.tsx` line 55 — `bg-primary text-primary-foreground`.
- **Observation:** Sitting next to the red "End Tournament" destructive button, the bright green "Re-pair current round" pill looks like the encouraged action. But re-pairing is actually a recovery/repair action — relatively rare and reserved for "pairings were wrong, regenerate".
- **End-user impact:** Visual emphasis on a recovery action makes it look more prominent than it should be. Users might be tempted to click it casually.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/22-after-start-detail.png`

#### F37: "Print Pairings", "Print Match Slips" buttons abbreviate aggressively on mobile

- **Severity:** Low
- **Where:** `components/ui/TournamentRounds.tsx` lines 849–860 — `<span className="hidden sm:inline">Print Pairings</span><span className="sm:hidden">Pairings</span>`.
- **Observation:** On mobile (< sm) the buttons read just "Pairings" and "Slips" — losing the verb "Print". A first-time mobile host might think "Pairings" is a navigation link.
- **End-user impact:** Discovery cost on mobile.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/35-mobile-rounds-dark.png`

#### F38: Mobile breakpoint cuts off the "Audit log" tab label

- **Severity:** Low
- **Where:** `components/ui/TournamentTabs.tsx` lines 98–123 (Tabs theme), `overflow-x-auto no-scrollbar` on the tablist.
- **Observation:** At 390 px width the four tabs (Participants, Rounds, Settings, Audit log) overflow horizontally and "Audit log" is rendered as "Audi…" (truncated). The `no-scrollbar` class also hides the scroll affordance, so the user has to swipe-test to discover the tab exists.
- **End-user impact:** Discoverability — host might not realize there's an Audit log on mobile.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/35-mobile-rounds-dark.png`

### Accessibility

#### F39: Focus ring on `<Button>` uses `focus-visible:ring-2 focus-visible:ring-ring`

- **Severity:** Polish (the user has previously flagged this as jarring)
- **Where:** `components/ui/button.tsx` (the shared Button component is wired with `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`).
- **Observation:** Tab-navigating across End Tournament → Re-pair current round → Repair past result lights up the green primary `ring-ring` glow at 2 px width. Per the user's prior feedback that the green ring is visually jarring on form controls, the same treatment is on every action button.
- **End-user impact:** Aesthetics — already flagged.

#### F40: Several disabled buttons have no `disabled` cursor + tooltip is plain HTML `title` (slow appearance)

- **Severity:** Low
- **Where:** `components/ui/TournamentTabs.tsx` lines 153–172 (the Add Participant button tooltip is a hover-group implementation, OK), but `components/ui/TournamentRounds.tsx` lines 946–970 / 1018–1042 (the swap-pair icon uses `title=` HTML tooltip with 1 s delay).
- **Observation:** When the swap-pair button is disabled (e.g., because round has started), hovering shows the native `title` after the browser's default delay (~700–1000 ms). The visible-tooltip pattern used for "Add Participant" is more responsive.
- **End-user impact:** Inconsistent affordance; users have to wait for the explanatory tooltip.

### Mobile readiness (incidental)

#### F41: Mobile header controls wrap awkwardly and burn vertical space

- **Severity:** Medium
- **Where:** `app/tracker/tournaments/[id]/page.tsx` lines 730–800.
- **Observation:** At 390 px width the three buttons (End Tournament, Re-pair current round, Repair past result) wrap to two rows: "End Tournament + Re-pair" on row 1, "Repair past result" on row 2. Combined with the Round Timer block above, the controls eat ~330 px of vertical space before the tabs appear.
- **End-user impact:** Mobile is even worse than desktop on the chrome/content ratio. A phone in landscape sees almost nothing of the content.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/35-mobile-rounds-dark.png` (controls visible)

#### F42: Mobile pairing cards are good — flag this as a positive baseline

- **Severity:** N/A (kept this in to balance the audit)
- **Where:** `components/ui/TournamentRounds.tsx` lines 1071–1208.
- **Observation:** On mobile the same pairings render as one card per match with two stacked player rows — one card per pairing, not two. The duplication problem (F1) is desktop-only. Player name + match points + differential are clearly labeled per row. Edit and swap icons are tappable size.
- **End-user impact:** Good baseline; the desktop table should adopt this card model.
- **Screenshot:** `screenshots/2026-05-28-tracker-audit/35-mobile-rounds-dark.png`

## Quick wins

The following are likely <1 hour fixes:

- **F1:** Render one row per match in `TournamentRounds.tsx` (delete lines 991–1043).
- **F6:** Wrap "Tournament has ended" + "Repair past result" in a flex container with a gap.
- **F7, F8, F9, F10:** Add a confirmation dialog (or undo toast) for End Tournament, End Round, Drop player, Delete participant.
- **F11:** Rename dialog title and action to match the button: "Re-pair current round" everywhere.
- **F12, F27:** Add a global `Escape` keydown handler in `RegeneratePairingsButton.tsx` and `RepairPastResultPicker.tsx`.
- **F14:** Replace `alert()` calls in `match-edit.tsx` with inline error text.
- **F17:** Add a visible "Actions" label to the column header.
- **F18:** Differentiate aria-labels: "Edit score" vs "Repair past result for {p1} vs {p2}".
- **F29:** Bump toast `setTimeout` from 2000 ms to 4500–5000 ms for warning/error toasts.
- **F31:** Add a small "(score)" or "Game score" hint next to the "Lost Souls" heading in the score modal.
- **F35:** Pick a clearer color story (e.g., neutral pill for in-progress; success only on completion).
- **F36:** Make Re-pair an outline/secondary button.
- **F37:** Keep "Print" verb in mobile button labels (icon + abbreviated text).
- **F38:** Allow the tablist to wrap or show a scroll affordance on mobile.
- **F40:** Use the same hover-group tooltip pattern across all icon buttons.

## Bigger rewrites

These imply structural change:

- **F1 + F16 + F19 + F20:** Replace the two-row-per-match desktop table with one row per match showing `Table | P1 | Score | P2 | Result` plus a sticky header. Surface the actual round score (e.g., `5–2`), not the cumulative-after-this-match snapshot.
- **F2 + F3 + F5 + F41:** Refactor the page-level chrome (`page.tsx` 602–800) into a compact, sticky header that does NOT duplicate round info that already appears inside the Rounds tab; refetch `tournament` after End Round so the header reflects reality.
- **F21 + F22 + F24:** Split "Participants" and "Standings" — or at least add a rank column, sort toggles, and a tiebreaker tooltip.
- **F23:** Move match points / differential edits into the auditable repair flow; remove direct write from `EditParticipantModal`. While there, delete the dead `newDroppedOut` prop pipe.
- **F26:** Fix `RepairPastResultPicker` round-state sync (reset internal `round` when `completedRounds` arrives) AND consider deleting the header entry point in favor of the in-row pencil (F28).
- **F32 + F33:** Add real loading skeletons and an error state for missing/invalid tournaments.
- **F13:** Replace the hand-rolled `MatchEditModal` overlay with the shared `Dialog` primitive used by `EditParticipantModal` so accessibility (focus trap, role, backdrop click, escape) comes for free.
