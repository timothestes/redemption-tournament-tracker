# Multi-Type Tournament Hosting

**Date:** 2026-06-30

## Problem

When a host runs a real-world event that offers several formats/types (e.g. Type 1,
Type 2, Booster Draft), the "Host This Event" flow only lets them create **one**
tournament at a time. They pick a single category in the Add Tournament modal,
submit, then have to click "Host another category" and repeat for every remaining
type. For an event with 4 types that's 4 separate passes through the modal.

The recently-added category picker (PR #141, migration 060) already records a
per-tournament `category`, prefills settings from `categoryDefaults`, and groups
tournaments sharing a `listing_id` under one event card. The infrastructure for
many-tournaments-per-event already exists — only the create UI is single-shot.

## Goal

Let a host select **multiple** offered types in one pass and create one tournament
per selected type with a single submit. The created tournaments share the listing
and group under one event card, exactly as if they'd been added one at a time.

## Scope

- No DB schema change. `tournaments.category` + `tournaments.listing_id` already
  support this.
- Two files change:
  - `components/ui/tournament-form-modal.tsx` — single `<select>` → checkbox list.
  - `app/tracker/tournaments/page.tsx` — `handleAddTournament` creates N rows.

## Design

### Modal (`tournament-form-modal.tsx`)

- Replace the single Category `<select>` with a **checkbox list** of the offered
  types (the listing's `categoryOptions`, or `STANDARD_CATEGORIES` when none).
- `onSubmit` signature changes from `(name, category)` to
  `(items: { name: string; category: string | null }[])` — the modal owns all
  naming so the create handler just maps items to insert rows. Selection drives it:
  - **0 checked** ("No specific category" still possible): one tournament with the
    typed name and `null` category — preserves today's behavior.
  - **1 checked:** the name field stays editable and auto-builds from that one type
    (unchanged behavior). One tournament created.
  - **2+ checked:** hide the free-text name field. Each tournament is auto-named
    `"<Date> <Type> Tournament"`. Show a small read-only preview list of the names
    that will be created. Hosts rename individually later via the existing edit
    pencil. (Decision: auto-name + rename-later, not per-row editing — keeps the
    modal simple.)
- Submit button label reflects the count: "Add" for 0/1, "Add N tournaments" for 2+.
- A listing-provided `defaultName` still wins for the single-selection case.

### Create logic (`handleAddTournament`)

- Accept `(items: { name: string; category: string | null }[])`.
- Map each item to an insert row: `name`, `host_id`, the shared `listing_id` when
  hosting from a listing, and — when `category` is set — `category` +
  `categoryDefaults` (deck_format / max_score / round_length).
- Insert all rows in one `.insert(rows).select("id")` call (drops the old
  `.single()`).
- When created from a listing, point the listing's `linked_tournament_id` at the
  first created tournament (so the public page still shows "Already linked"), then
  clear the from-listing URL params as today.

## Non-goals

- No per-type entry-fee / settings editing in the modal (defaults only; edit later).
- No dedup of types already hosted for the listing (a host can intentionally run a
  format twice). Out of scope for this pass.
- "Host another category" keeps working unchanged; it now also benefits from
  multi-select since it shares the modal.

## Verification

- Type-check / build passes.
- Manual flow: from a listing offering 3 formats, check all 3, submit once → 3
  tournaments appear grouped under one event card with correct per-type pills and
  prefilled souls/round-length.
- Single-select and "No specific category" paths behave exactly as before.
