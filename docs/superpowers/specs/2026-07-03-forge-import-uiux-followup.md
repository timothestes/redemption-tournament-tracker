# Forge Lackey Import — UI/UX Roughness Notes & Follow-up Proposals

**Date:** 2026-07-03
**Status:** Follow-up proposals (nothing here blocks the import feature)
**Companion to:** `2026-07-03-forge-lackey-set-import-design.md`

The import slice was deliberately implementation-first: correct, secure, verified — not
polished. These notes record what's rough, observed during a live end-to-end run with the
real 147-card EoT zip (5,609-row carddata, 37MB), plus concrete proposals for a design pass.

## What already feels good

- Zip parsing + preview is instant and fully local — 5,609 rows / 54 sets summarized in
  under a second, and the matched-cards preview renders straight from zip bytes.
- Import ran 147/147 with zero failures; idempotent re-runs skip cleanly.
- Set grid revisits are instant (browser-cached immutable art, 1ms repeat fetches); first
  visit lazy-loads only the viewport.

## Rough edges, by area

### 1. Wizard flow & layout

- **No real stepper.** The five numbered `<fieldset>`s just stack and appear as state
  accumulates. It works, but there's no sense of place, no way to jump back, and completed
  steps don't collapse. Proposal: a compact vertical stepper (shadcn) with
  collapsed-summary rows ("✓ EoT — 147 cards") and one active section.
- **Set chips hide the likely target.** Chips show the top 12 sets by row count — but a
  playtest zip's *new* set is usually one of the smallest (EoT ranked 13th of 54 and never
  got a chip). Proposal: rank chips by "likelihood this is the set you're importing" —
  e.g. fraction of the set's rows whose images are actually present in the zip (new-set
  images ship in the zip; old sets' mostly don't), falling back to a searchable full list.
- **Second import after a run is non-obvious.** Once a run starts, the destination section
  hides until the filter changes. Fine for the e2e, confusing for a human. Proposal: an
  explicit "Start another import" reset button on the summary panel.
- **No exclusions.** You import all matched cards or none. Proposal: checkboxes on the
  preview grid (default all-on) for the "this one's not ready yet" case.
- **Preview cards aren't inspectable.** 147 thumbnails, no zoom. Proposal: click-to-enlarge
  overlay like the playtest reveal grid already has.

### 2. Import run feedback

- **No progress bar / ETA.** Just a counting summary line ("Imported 39 · …") and a
  scrolling per-card status list. Proposal: progress bar with percent + rolling ETA, and
  an `aria-live="polite"` region so the count is announced.
- **Throughput is ~30 cards/min** (concurrency 3; each card = 4 sequential RPC round-trips
  + a blob upload through the server action). 147 cards ≈ 5 minutes — tolerable, but a
  single `forge_import_card` definer RPC (create+save+share in one transaction) would cut
  round-trips ~4× and also close the "half-created card on mid-failure" window the spec
  documents. Worth doing if imports become routine.
- **Navigation away mid-run loses the run silently.** Proposal: `beforeunload` guard while
  `running`.
- **Raw Postgres error strings** surface directly in the per-card status ("not authorized
  to edit this card"). Acceptable for elders; a small error→copy map would be friendlier.

### 3. Set browsing after import

- **First-load of a big set grid is still N proxy hits** (lazy, ~200KB each). Repeat visits
  are instant, but the first scroll-through streams ~27MB. Proposal: generate a ~30KB
  thumbnail at import time (second blob per card, `forge-thumb/` prefix) and use it in
  grids, full image in the studio/overlay.
- **The playtester reveal grid (`/forge/play/[setId]`) doesn't use the `t=` cache-buster
  yet** — approved-version art is frozen and would benefit even more. Extend the same
  pattern there (needs the version's timestamp or id as the buster).
- **No bulk lifecycle actions.** Imported cards land as `draft`; making a set
  playtester-visible today is publish + approve per card × 147. This is the single biggest
  gap between "cards are in" and "playtesters can build decks" (goals 2–3). Proposal: a
  "Publish & approve all drafts" button on the set progress page, gated to set elders,
  looping the existing RPCs server-side.
- **Sets index gives no hint of card counts/art coverage** on each set tile beyond what
  1a.5 shipped; after an import lands 147 cards it looks the same as before. Minor.

### 4. Card update flow (studio)

- **The confirm dialog is an inline amber box, not a modal** — on mobile it can render
  below the fold after the file input; nothing forces a decision before scrolling away
  (the upload simply doesn't happen until a button is pressed, which is safe but quiet).
  Proposal: shadcn `AlertDialog` modal.
- **`fieldsDirty` is coarse.** Any field edit this session (even the name) suppresses the
  dialog for a subsequent image replace. Matches the requirement as written; a finer rule
  ("rawText changed") may fit the actual intent better.
- **No upload spinner** on either file input — a ~200KB upload is quick locally but on
  tournament-hall Wi-Fi the silent second or two feels broken. Proposal: per-input busy
  state (the wizard's per-card statuses already set the pattern).
- **No re-import/update path.** Importing V5 of a zip into the same set skips existing
  titles rather than updating their text/images. The elder workflow for "new testing
  version" is today: re-import skips everything, then hand-update changed cards (the
  confirm dialog exists precisely for that). Proposal (larger): a diff-mode import —
  "12 cards changed text, 3 changed images, 5 new" with per-card accept.

### 5. Mobile

- The wizard is usable at 375px (grids collapse to 2-col, inputs full-width) but picking a
  37MB zip and holding ~70MB of decompressed state is inherently a desktop job. Not worth
  optimizing; just worth a hint line on the page.

## Suggested priority for a design pass

1. Bulk publish/approve (unblocks playtesters — goal 2)
2. Progress bar + reset-run + beforeunload guard (cheap, high-perceived-quality)
3. Stepper layout + chip ranking (first-impression polish)
4. Thumbnails at import time + reveal-grid caching (perf at scale)
5. Diff-mode re-import (the real long-term workflow)
