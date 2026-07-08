# Forge Card Version History, Set Changelog & Complete Reasons — Design

**Date:** 2026-07-06
**Status:** Approved design, pending implementation plan
**Audience:** Elders only (user decision). Playtester surfacing is explicitly out of scope.
**Approach:** "B-hardened" — read-mostly feature over existing tables, plus one migration (072) that makes reasons first-class where they are genuinely underivable. Verdict converged by two independent reviewer agents (simplicity-skeptic + data-steward priors), both high confidence.

## 1. Problem

Three gaps in the Forge card-update process (`/forge/cards/[cardId]` studio + set cards page):

1. **No version history.** `card_versions` is an immutable, append-only record (who/what/when per release), but no UI reads it. "Proposal history" shows only proposals — direct Releases, Mark final, Reopen, Shelve, and Restore are invisible.
2. **No "updated since" answer.** An elder cannot ask "what changed in this set since July 1?". `forge_cards.updated_at` is useless for this (autosave bumps it on every keystroke); the right signal is `card_versions.created_at`.
3. **Reasons are incomplete and fragile.**
   - Deny reasons: already mandatory and stored (proposal-anchored comment). Sound.
   - Accept: optional note (comment) + mandatory proposal summary, linked to the released version via `card_proposals.resulting_version_id`. Sound — needs surfacing only.
   - **Superseded proposals: no reason at all.** Two cases exist: superseded-by-sibling-accept and stale-base (both closed inside `forge_accept_proposal`).
   - **Release notes (added 2026-07-06): unsound.** `LifecycleControls.doRelease` saves the note via a *second* server-action round trip after `publish` succeeds and **discards `addComment`'s result** — on partial failure the "why" silently vanishes; on success it is an unmarked, elder-deletable card-level comment tied to its version only by timestamp adjacency.
   - **Deny reasons are erasable.** `forge_delete_comment` (053) lets the author or any set elder delete a proposal-anchored reason comment — the mandatory audit record is not durable.
4. **Comments must stay meaningful across versions.** Comments are already durable (they cascade-delete only with the card or their proposal), but nothing shows which version era a comment was written against.

## 2. Non-goals

- Playtester-facing changelog or timeline (RLS already limits them to `approved` versions; revisit later).
- Set-wide activity-feed page (rejected Approach C — the set filter + per-card timeline cover the need).
- Backfilling reasons/events from before migration 072 (lifecycle events prior to 072 are unrecorded and unrecoverable; the timeline simply starts showing them from deploy day).
- Migrating the handful of release-note comments created between 2026-07-06 and 072 landing (they remain ordinary comments).
- Public card database anything — the Forge stays isolated.

## 3. Migration 072 (`supabase/migrations/072_forge_version_history.sql`)

> Migration numbers 063–071 are taken. Deploy order matters: **migration first, client second** (old client calling with only `p_card_id` works against the new function via the default; a new client sending `p_note` breaks against the old DB).

### 3.1 `card_versions.note`

```sql
alter table public.card_versions add column if not exists note text;
```

### 3.2 `forge_publish_card(p_card_id uuid, p_note text default null)`

**Signature change → must DROP the old function first.** `CREATE OR REPLACE` with a new parameter creates an *overload*; PostgREST then fails with candidate ambiguity (PGRST203) on every existing `rpc("forge_publish_card", {p_card_id})` call — Release breaks in prod.

```sql
drop function if exists public.forge_publish_card(uuid);
create or replace function public.forge_publish_card(p_card_id uuid, p_note text default null) ...
```

Body: verbatim copy of the **current** definition (061 `L35-64` — includes `finished_key`), with one change: the `card_versions` insert also sets `note = nullif(btrim(coalesce(p_note,'')), '')`.

**Re-apply grants** (dropping loses them, and a bare recreate regains default PUBLIC execute — a security regression):

```sql
revoke execute on function public.forge_publish_card(uuid, text) from public, anon;
grant execute on function public.forge_publish_card(uuid, text) to authenticated;
```

`forge_accept_proposal` is **not** changed: accepted proposals already self-describe via `resulting_version_id` + mandatory `summary` (join at read time; no copied column).

### 3.3 Lifecycle events → `forge_audit`

Add one insert (pattern: `forge_delete_card`, 052 L441-442) to each of five functions, recreated verbatim from their current bodies (all live in 052; same signatures, so plain `CREATE OR REPLACE`, no drop):

| Function | `action` value |
|---|---|
| `forge_approve_card` | `card_approved` |
| `forge_unapprove_card` | `card_unapproved` |
| `forge_archive_card` | `card_archived` |
| `forge_unarchive_card` | `card_unarchived` |
| `forge_send_card_to_private` | `card_returned_to_ideas` |

`insert into public.forge_audit (actor, action, target) values (auth.uid(), '<action>', p_card_id::text);`

Rationale: approve flips `card_versions.status` in place (no timestamp); archive/return destructively supersede all version rows. These events are unrecoverable unless captured forward from now. `forge_audit` is already elder-readable under RLS (049).

### 3.4 Protect reasons of record

Recreate `forge_delete_comment` (053 body) with a guard: refuse when the target comment has `proposal_id is not null` (deny reasons and accept notes are records, not chatter):

```sql
if v_comment.proposal_id is not null then
  raise exception 'comments attached to a proposal are part of its history and cannot be deleted';
end if;
```

## 4. Server changes (`app/forge/lib/`)

- **`lifecycle.ts`**: `publish(cardId: string, note?: string)` → `rpc("forge_publish_card", { p_card_id, p_note: note?.trim() || null })`. Bulk release (`BULK_RPC`) keeps calling with no note.
- **`LifecycleControls.tsx`**: `doRelease` passes the dialog note to `publish(card.id, releaseNote)`; **delete the `addComment` fallback and its import** (the note is now atomic with the version insert).
- **New `versions.ts`** (mirrors `comments.ts` patterns — `requireForge`, author-name resolution):
  - `listVersions(cardId)` → `card_versions` ordered by `version_number desc`: `{ id, versionNumber, status, data, note, createdBy, createdAt, authorName }`.
  - `listCardEvents(cardId)` → `forge_audit` rows for `target = cardId`, `action in` (the five actions above), with actor names.
  - `listSetActivity(setId, sinceISO)` → for each card in the set, its releases with `created_at >= since`: `{ cardId, title, latestVersionNumber, latestNote, latestReleasedAt, releaseCount }`. Elder RLS applies naturally.
- **`proposals.ts`**: no schema change. `COLS` and `ProposalRow` currently lack `resulting_version_id` and `closed_by` — add both (the timeline needs them for "→ v5" links and supersede derivation).

## 5. Card studio "History" timeline (replaces "Proposal history" in `ReviewPanel`)

One reverse-chronological list merging three event sources (merge + sort client-side by timestamp; the page is elder-only and already loads proposals + comments):

1. **Version releases** — `v4 · <author> · <timeAgo>` + status pill (`published` → "Current", `approved` → "Final", `superseded` → "Superseded"), the `note` if present, and a summarized field diff vs the previous version (`diffCards`/`summarizeDiff` on consecutive `data` snapshots), expandable to the full before→after list (reuse `ProposalDiff`'s change-list rendering).
2. **Proposal closures** —
   - *Accepted*: summary + optional accept-note comment + "→ v5" (via `resulting_version_id`).
   - *Denied*: summary + its mandatory reason comment.
   - *Superseded* (derived, two cases): if a sibling proposal on the same card has `status='accepted'` and the **same `closed_at`** (transaction-stable `now()` — exact equality, not adjacency) → "Superseded when '<accepted summary>' was accepted"; otherwise → "Out of date — a direct release replaced the version it was based on."
3. **Lifecycle events** (from `forge_audit`, post-072 only) — "Marked final", "Reopened", "Shelved", "Restored", "Returned to ideas" · actor · time.

**Comments stay in their own thread** ("Comments & suggestions" section unchanged in function), with one addition: **era dividers**. Between top-level comments, insert thin marker rows ("— v3 released · Jun 28 —") computed by comparing comment `createdAt` against version `createdAt`s. Replies stay under their parents regardless of era. This is the "preserving previous comments" ask: never deleted (already true), now never orphaned from context.

"Open proposals" section is unchanged.

## 6. Set page "Updated since" filter

On the set cards page toolbar (`app/forge/sets/[setId]/cards/`): a date input, empty by default (= off). When set:

- Grid filters to cards with ≥1 release `created_at >= cutoff` (from `listSetActivity`).
- Matching tiles get a small badge: `v6 · Jul 3` (latest release).
- Sort switches to latest-release-desc while the filter is active.

Two clicks answers "what changed since July 1?"; the studio timeline is the drill-down.

## 7. Testing & rollout

- **Unit** (vitest, mock-Supabase pattern from `lifecycle.test.ts` / `lifecycleCopy.test.ts`): `publish` passes `p_note`; `listVersions` mapping; supersede two-case derivation; era-divider placement (comment/version interleaving); `listSetActivity` since-filtering.
- **Migration verification** on the Supabase dev branch before prod: Release works with and without a note (old 1-arg call shape included); note lands on the version row; audit rows appear on Mark final/Reopen/Shelve/Restore/Return; proposal-anchored comment deletion is refused; grants verified (`anon` cannot execute).
- **E2E smoke** (extends `e2e/forge/`): release with a note → History shows the version with the note; set the date filter → the card appears with badge.
- **Rollout order:** apply 072 → deploy client. Nothing else is order-sensitive.

## 8. Known limitations (accepted)

- Lifecycle events before 072 are permanently absent; the timeline shows them only from deploy day.
- Release-note comments created before 072 remain ordinary comments (no backfill).
- `tsconfig` has `strict: false` — use `=== false` result-narrowing in new server-action call sites (established project gotcha).

## Addendum (2026-07-07): draft iterations are versions; accept never force-releases

Post-ship correction after owner feedback (drafts iterate heavily pre-release;
proposing is the team's normal verb — design converged by two reviewer agents,
implemented in migrations 073–076):

- `version_status` gains `'draft'` (074). Accepting a proposal on a **Draft**
  card mints a `draft` version row — an elder-only iteration record (invisible
  to playtesters via 057's status whitelist), first-class in the History
  timeline ("vN updated", Draft pill, diffs, "Accepted → vN"). The card stays
  in Draft; nothing is released. Playtesting accepts unchanged (075).
- Proposal bases and the accept staleness guard both anchor to the card's
  latest version of ANY status, so round-2+ draft proposals diff against the
  last accepted iteration and the guard is real during draft phase (075).
- Archive/return sweeps supersede only `('published','approved')` — draft
  rows keep their label forever (075). `forge_publish_card` untouched: first
  release may be v5 and diffs against the last draft, by design.
- The propose affordance is a primary outline button, "Propose changes"
  (§ the earlier "Request another elder's review" demotion is reverted).
- 076 backfilled the single 073-era draft accept that folded without minting.
