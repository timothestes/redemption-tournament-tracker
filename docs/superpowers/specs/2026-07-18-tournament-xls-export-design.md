# Tournament "Export to Excel" — fill the official Tracker 2.6 spreadsheet

**Date:** 2026-07-18
**Status:** Approved design, pre-implementation
**Owner:** Tim Estes

## Goal

From a tournament's host page, download the classic community spreadsheet
("Redemption CCG Tournament Score Tracker 2.6", Bany/Berkenpas) **pre-filled with the
app's tournament data**, such that the file opens in Excel as the real tracker —
macros, pairing buttons, formulas, and formatting intact — and the host can keep
running the event from it (or archive/submit a finished event).

Non-goals: Multi-Player sheets (the app is 2-player Swiss only), filling more than one
`2-Player (N)` sheet, itinerary sheets, generating a macro-free lookalike.

## Why this approach

Nothing in the JS ecosystem can write the legacy `.xls` (BIFF8 + VBA + form buttons)
with fidelity. But Excel itself converts it losslessly to `.xlsm` (OOXML, a zip). We
commit that converted `.xlsm` once as a static asset, and at export time patch **only
entry-cell values** in the `2-Player (1)` sheet XML — everything else in the zip is
untouched, so macros/buttons/formulas/styles survive by construction.

VBA analysis (extracted via `olevba`) confirmed feasibility:

- **No writable macro state.** "Rounds complete" (`A25`), player count (`A31`), and
  LS-to-win (`A34`) are all worksheet formulas derived from the very cells we write
  (opponent-name columns, name column `B`, type cell `A14`). Resume-at-round-N works by
  writing data alone.
- **No auto-run.** `ThisWorkbook` is empty; nothing validates or rewrites on open.
- **Sheet protection has no password** (plain `Unprotect`/`Protect` in code).
- **Opponent names are plain string values** written by the macro; hidden helper
  columns (rank, times-played, table) are derived on demand by the macros and may be
  left empty.
- The sheet supports **10 rounds** and **200 player rows** (Excel rows 3–202).

## Template asset (one-time manual step)

1. On a machine with real Microsoft Excel: open the pristine
   `Redemption-CCG-Tournament-Tracker-2.6.xls`, enable macros, **File → Save As →
   Excel Macro-Enabled Workbook (`.xlsm`)**. Do not touch LibreOffice/Numbers — only
   Excel preserves the VBA project and form buttons.
2. Sanity-check the `.xlsm`: reopen it, confirm buttons render and a macro runs.
3. Commit it as `public/tracker/Redemption-Tracker-2.6.v1.xlsm` (version-suffixed so a
   future re-conversion gets a new name and never fights browser caches).

Until the asset is committed, the export button surfaces a clear "template not
installed" error. The runtime patcher makes **no assumptions about exact XML
serialization** (style indexes, sharedStrings vs inline) beyond OOXML itself — see
Patching rules — so committing a re-converted template later is safe.

## UI

- **Button:** "Export to Excel" in `components/ui/TournamentTabs.tsx`, in the
  Standings tab header row (where "Print Final Standings" appears once the tournament
  ends). Host-only, rendered once the tournament has started (`tournamentStarted`
  prop). Works mid-tournament and after end.
- **Blockers** (error toast, no download):
  - `n_rounds > 10` (sheet maximum),
  - more than 200 participants,
  - `max_score ∉ {5, 7}` — the tracker hard-codes LS-to-win as `IF(A14=2,7,5)`; a
    custom soul cap would make every round-score formula wrong in Excel.
- **Warnings modal:** if the write-map builder produces warnings (see Fidelity), show
  them in a small dialog with "Download anyway" / "Cancel". No warnings → download
  immediately.
- **Filename:** `<Tournament Name> - Tracker 2.6.xlsm` (sanitized).
- A short note near the button mentions Windows' Mark-of-the-Web: downloaded `.xlsm`
  files need "Unblock" / "Enable macros" in Excel, same as the original tracker.

## Data mapping (sheet `2-Player (1)`; all refs are Excel A1, rows 3–202)

Data source: the host page does **not** hold byes or past-round scores in memory, so
on click the exporter calls `buildStateFromSupabase(createClient(), tournamentId)`
(`utils/tournament/stateAdapter.ts`) — client-safe, returns participants (incl.
dropped), all matches with scores, byes with round numbers, started rounds, and
tournament config. The tournament display name comes from the `tournamentName` prop.
Guard with `supabase.auth.getUser()` first: per project convention, expired-token
client reads silently return empty and would otherwise export a blank tracker.
Still fully client-side; no new API surface.

A match counts as **played** iff both `player1_score` and `player2_score` are
non-null — the same predicate `stateAdapter` uses (`winner_id`/`is_tie` may be null
on legacy rows). A 0-0 auto-scored double-drop is stored as a tie by the app and
exports as `0/0` (the tracker also scores diff 0 as a tie — consistent).

### Config cells

| Cell | Value |
|------|-------|
| `A14` | `1` if `max_score == 5`, `2` if `7` (blocked otherwise) |
| `A28` | `n_rounds` |

Nothing else in column A is written — `A25`, `A31`, `A34` are formulas; `A36`/`A37`
are the Switch-Rows button inputs, not configuration.

### Row order

- **Ended tournament:** all participants, active ones first in final standings order
  (`computeFinalStandings` — there is no stored `place`), then dropped players
  appended (match points desc, differential desc). Order is cosmetic post-end (the
  macros re-sort by score on demand). No `Bye` row is added.
- **Tournament in progress:** unpaired dropped participants are **omitted** (the
  macro would otherwise pair them; their names persist harmlessly inside opponents'
  historical cells) — but a dropped player who appears in the current round's
  pairings (or holds its bye) **is included**, otherwise their opponent is orphaned
  and pair parity shifts for every later row. Rows are ordered so the **current
  round's pairings are row-adjacent** (match 1 → rows 3–4, match 2 → rows 5–6, …),
  because `scoreBye`, row coloring, and Switch Rows all assume pair adjacency. If the
  current round has a bye, the recipient is the last participant row and a literal
  `Bye` row follows it.
  Completed rounds don't care about row order.

### Per-round column groups (5 columns per round, rounds 1–10)

For each participant row and each round 1..current:

- **Opponent Name** (locked col; macro-written in normal use): opponent's name as a
  plain string, byte-identical to that opponent's `B` cell entry. For a bye: exactly
  `Bye`.
- **Player Score / Opponent Score** (entry cells): the recorded souls-rescued values,
  capped at `max_score` (uncapped values trigger the tracker's correction prompts).
  **Unplayed matches keep both cells empty** (played = both scores non-null, see
  above); writing `0/0` for an unplayed match would fabricate a 1.5-point tie.
- **Byes — native tracker convention** (mirrors `scoreBye` exactly):
  - recipient: Player Score = `-4 + (number of byes received in rounds 1..K)`, clamped
    to ≤ 0 (first bye `-3`, second `-2`, …), Opponent Score = `0`. The sheet's formula
    turns `-3` into 3 game points via `ABS`.
  - the `Bye` row itself (current-round bye only): `B` cell exactly `Bye`, its
    current-round Opponent Name cell = the recipient's exact name, Player Score `0`,
    Opponent Score `max_score + 4`. Its past-round columns stay empty (verified
    harmless in the Excel smoke test — bye detection is keyed on name strings, not
    row history).
- Round Score, Round LS Differential, Total points, Total LS Differential: **never
  written** — template formulas recompute them on load.

### Column visibility

The tracker natively shows only the current round ("Next" hides prior rounds). Round
K occupies 1-based columns `6+5(K−1)` … `10+5(K−1)` (F–J, K–O, … AY–BC). Patch the
sheet's `<cols>`: normalize any `<col>` range spanning a group boundary into
per-column entries (preserving `width`/`style`/`customWidth`), then set `hidden` so:

- in progress → Game Summary + current round visible; completed and future rounds hidden;
- ended → rounds 1..`n_rounds` visible, unused rounds hidden.

Leave the template's other column states untouched: helper `C` and `BE`–`BJ` hidden,
`BD` (Overall Rank) and `BK`/`BL` (table/chair) as-template.

## Fidelity caveats (surfaced in the warnings modal)

1. **Byes score differently in the tracker by design.** The tracker gives a first bye
   3 points but **−3 LS differential**, and decaying points for repeat byes (2, 1, 0);
   the app awards a flat 3 points / 0 differential. We write the tracker's own
   convention so the file is internally consistent; one caveat line appears whenever
   the tournament has byes.
2. **Round-trip invariant check.** In this codebase, forfeits are already encoded as
   soul scores (0 vs `max_score`) and match points are always derived from scores, so
   the tracker formulas should reproduce the app's points exactly. As a cheap
   invariant, the exporter still predicts the points the tracker will compute per
   match and lists any mismatch in the modal; this should near-never fire.
3. **Staged-round byes.** A bye in a staged-but-not-started round doesn't score in the
   app yet, but the exported sentinel makes Excel score it immediately; when this
   applies, a caveat line notes the expected totals difference.
4. **Name collisions.** Duplicate participant names get a ` (2)`-style suffix (macro
   pairing history is keyed on exact strings); a participant literally named `Bye` is
   renamed `Bye (player)` with a warning. Names are trimmed; the same exact string is
   used in `B` and in every opponent cell.

## Patching rules (`utils/tournament/exportTracker.ts`)

Client-side, using `fflate` (already a dependency; unzip pattern exists in
`app/forge/lib/spreadsheet.ts`):

1. Fetch `public/tracker/Redemption-Tracker-2.6.v1.xlsm`, unzip.
2. Resolve the `2-Player (1)` sheet part via `xl/workbook.xml` → sheet `r:id` →
   `xl/_rels/workbook.xml.rels`. Never hardcode `sheetN.xml`.
3. Patch cells in the sheet XML:
   - Strings are written as `t="inlineStr"` (`<is><t>…</t></is>`) — valid ECMA-376
     alongside a sharedStrings table; Excel normalizes on next save. XML-escape;
     `xml:space="preserve"` when a value has significant whitespace.
   - Numbers as plain `<v>`.
   - **Existing `<c>` elements are patched in place, preserving their `s=` attribute**
     (cell style). If a target cell has no `<c>` element, insert one in correct column
     order and copy `s=` from the same column in a neighboring player row — a wrong or
     missing style index would re-lock an entry cell under sheet protection.
   - Clearing a cell (e.g. unplayed score) = remove its `<v>`/`<is>` child, keep the
     styled `<c>`.
4. Force recalculation: set `<calcPr fullCalcOnLoad="1"/>` in `xl/workbook.xml`,
   delete `xl/calcChain.xml` plus its `[Content_Types].xml` override and workbook rel.
   This is load-bearing, not hygiene: the macros sort on cached total values; stale
   cached zeros would make the first "Next" click sort garbage.
5. Patch `<cols>` visibility per the rules above.
6. Rezip (stored entries fine), download via the standard Blob + `a.download` pattern.

## Testing

- **Unit tests (vitest-style pure functions):** write-map builder — normal rounds,
  ties, byes (first + repeat, decay), mid-round export with unplayed matches, dropped
  players (both modes), duplicate names, `Bye`-named player, forfeit warning
  detection, row ordering (standings vs pair-adjacent), blockers (rounds > 10,
  players > 200, `max_score = 6`).
- **Patcher tests:** run against a small synthetic `.xlsm` fixture exercising both
  serializations (existing styled empty `<c>` and missing `<c>`), sharedStrings
  present, calcChain present. Assert: zip valid, XML well-formed, untouched parts
  byte-identical (including `vbaProject.bin`), `s=` preserved, calcChain gone,
  `fullCalcOnLoad` set.
- **Manual smoke test in real Excel** (host-performed; template asset required):
  odd player count with a bye, mid-round export, ended export; after each: totals
  match the app (modulo the documented bye divergence), score entry works on unlocked
  cells, and one "Next" click pairs sanely.

## Known limitations

- The exported file reflects the tracker's own scoring rules for byes (see caveats).
- A tournament using a custom soul cap (not 5 or 7) cannot be exported.
- The `2-Player (2..4)` sheets stay blank; multi-event weekends export one file per
  tournament.
- The template's `newRoundStarted` has a latent hardcoded-row bug at ≥101 players
  (upstream tracker bug, not ours; noted for support questions).
