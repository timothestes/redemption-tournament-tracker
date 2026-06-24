# The Forge — Phase 1a.5: Sets, Lifecycle & Progress

**Date:** 2026-06-24
**Status:** Draft
**Slice of:** `docs/superpowers/specs/2026-06-19-forge-card-design-playtesting-design.md` (master spec)
**Builds on:** 1a.1–1a.4 (merged: access foundation, invites/members, private art, card studio + ideas library). Latest migration on `main` is `051`; this slice owns `052`.

## Why this slice

1a.4 shipped the single-author studio and the private "ideas" sketchbook. Cards still live only as private ideas — there is no **set** to gather them into, no **lifecycle** beyond `private_idea`, and no way to **track progress** toward a target. This slice closes the remaining creation-side gap of Phase 1a so a designer can take cards from sketch → set → published → approved, write set-level notes, declare targets, and watch a set fill in against them.

This is the largest Phase 1a slice (it introduces the `card_versions` immutable-history machinery). Print export + public-pool promotion (and the `promoted` status/transition) are explicitly **deferred to a later slice**; `approved` is the terminal lifecycle state here.

## Scope

**In:**
- `forge_sets`, `forge_set_elders`, `forge_set_grants` tables (grants ships dormant for Phase 2 forward-compat).
- `card_versions` immutable, append-only history table + version pointers on `forge_cards`.
- Set-aware RLS + the **I1 write-authz fix** (close the loose owner-or-any-elder write path inherited from 050/051).
- Sets index, set card-library grid, set notes (markdown, autosave), declared targets editor, progress dashboard.
- Lifecycle RPCs: **share** (move private→set), **send-back** (move set→private), **publish**, **approve** (+ reverse), **archive** (+ restore), **delete**.
- Lightweight set-elder (designer) management: add/remove an existing elder on a set.
- One **context-aware studio**: rename `/forge/ideas/[cardId]` → `/forge/cards/[cardId]`; it adapts to private-idea vs in-set context.

**Out (deferred):**
- Print export / "download all for printer", public-pool promotion, `promoted` status + promote transition (next slice).
- Realtime/presence/live comments, proposals, single-field suggestions, review queue (Phase 1b).
- Playtester deckbuilder/games (Phase 2). `forge_set_grants` ships but no playtester can reach it yet.

## Locked decisions (this slice)

1. **One context-aware studio route.** Rename `/forge/ideas/[cardId]` → `/forge/cards/[cardId]`. It loads the card; if `set_id` is set it shows set breadcrumb + lifecycle controls, otherwise it's the private-idea editor. No duplicated editor. A redirect from the old path is added (mirrors the `/forge/art` → redirect precedent from 1a.4). `/forge/ideas` (grid) stays as the private sketchbook.
2. **Lightweight set-elder management.** Set creator becomes the set's first elder; superadmin implicitly sees/edits all sets. A small control adds/removes another *existing elder* as a set designer (RPC + UI). The table also satisfies RLS + forward-compat.
3. **No Realtime.** Dashboard and notes use refetch-on-focus / `revalidatePath`, per master spec (live updates are 1b).
4. **Fold in the I1 write-authz fix.** Introducing `forge_set_elders` is exactly when reads *and* writes get gated by set-elder membership. The write RPCs change from `owner OR any-elder` to `owner OR set-elder-of-this-card's-set OR superadmin`. Closes the documented 1a.4 follow-up.
5. **Promote/print deferred.** No `promoted_version_id`, no `fk_promoted`, no promote RPC in migration 052; they ship with the export/promotion slice.

## Data model — migration 052

Self-contained, schema+functions only, no card data. Follows the established Forge migration shape (definer helpers with `set search_path=''`, explicit `revoke ... from anon`, `grant ... to authenticated`).

### New tables

```sql
create type public.version_status as enum ('published','approved','superseded');

create table public.forge_sets (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique not null,            -- slugify(name) + numeric suffix on collision
  notes         text,                            -- holistic markdown set notes, elder-editable
  target_counts jsonb not null default '{}'::jsonb,
  status        text not null default 'open',    -- open | frozen (promoted deferred)
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.forge_set_elders (          -- who designs a set
  set_id  uuid references public.forge_sets(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  primary key (set_id, user_id)
);

create table public.forge_set_grants (          -- who playtests a set (Phase 2; dormant)
  set_id     uuid references public.forge_sets(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  primary key (set_id, user_id)
);

-- Immutable, append-only published snapshots (linear history). Created at publish.
create table public.card_versions (
  id                 uuid primary key default gen_random_uuid(),
  card_id            uuid not null references public.forge_cards(id) on delete cascade,
  version_number     int not null,
  status             public.version_status not null default 'published',
  data               jsonb not null,             -- frozen DesignCard payload
  art_key            text,                       -- private blob key (UUID), never a URL
  art_is_placeholder boolean not null default false,
  art_original_key   text,
  created_by         uuid not null references auth.users(id),
  created_at         timestamptz not null default now(),
  unique (card_id, version_number),
  unique (card_id, id)                            -- enables composite-FK same-card enforcement
);
```

### `forge_cards` additions

```sql
alter table public.forge_cards
  add column if not exists set_id uuid references public.forge_sets(id) on delete set null,
  add column if not exists published_version_id uuid,
  add column if not exists approved_version_id  uuid;

alter table public.forge_cards
  add constraint fk_published foreign key (id, published_version_id)
    references public.card_versions(card_id, id),
  add constraint fk_approved  foreign key (id, approved_version_id)
    references public.card_versions(card_id, id);
```
Pointers are nullable; the publish RPC inserts the card-version row first, then `UPDATE`s the pointer (two-step, documented inline).

### Helpers (definer, `stable`, `search_path=''`)

- `is_forge_set_elder(p_set_id uuid) returns boolean` — caller is in `forge_set_elders` for the set.
- `is_forge_set_granted(p_set_id uuid) returns boolean` — caller is in `forge_set_grants` (Phase 2 read branch; dormant now).

### RLS

- **`forge_sets` SELECT** `to authenticated`: `is_forge_set_elder(id) OR is_forge_set_granted(id) OR is_forge_superadmin()`. No direct writes (RPC only).
- **`forge_set_elders` / `forge_set_grants` SELECT**: `is_forge_set_elder(set_id) OR is_forge_superadmin()`. No direct writes.
- **`card_versions` SELECT**: visible iff the parent card is visible — `exists(select 1 from forge_cards c where c.id = card_versions.card_id and (c.owner_id = auth.uid() or is_forge_superadmin() or (c.set_id is not null and is_forge_set_elder(c.set_id)) or (c.set_id is not null and card_versions.status='approved' and is_forge_set_granted(c.set_id))))`. No direct writes.
- **`forge_cards` SELECT** (create-or-replace, extends 051's owner-or-super stub): add `OR (set_id is not null and is_forge_set_elder(set_id)) OR (set_id is not null and status='approved' and is_forge_set_granted(set_id))`. The granted branch is dormant until Phase 2.
- `revoke all ... from anon` + `grant select ... to authenticated` on every new table (belt-and-suspenders).

### Write-authz fix (I1)

`forge_save_card`, `forge_set_working_art`, `forge_set_art_placeholder` currently authorize `owner_id = auth.uid() OR is_forge_elder_or_super()`. Change all three to:
```
owner_id = auth.uid()
  OR public.is_forge_superadmin()
  OR (c.set_id is not null and public.is_forge_set_elder(c.set_id))
```
A private idea (`set_id IS NULL`) is writable only by its owner (or superadmin); an in-set card by the owner, a set-elder, or superadmin. A non-owner elder *not* on the card's set can no longer write — closing I1.

### RPCs (all `security definer set search_path=''`; role/membership checked server-side; `revoke ... from anon`, `grant ... to authenticated`)

**Sets:**
- `forge_create_set(p_name text) returns uuid` — elder/super. Inserts set with a unique slug (slugify + numeric suffix on collision), adds caller to `forge_set_elders`, returns id.
- `forge_rename_set(p_set_id uuid, p_name text)` — set-elder/super.
- `forge_save_set_notes(p_set_id uuid, p_notes text) returns timestamptz` — set-elder/super; size-capped (e.g. 64 KB) like `forge_save_card`.
- `forge_save_set_targets(p_set_id uuid, p_targets jsonb) returns timestamptz` — set-elder/super; size-capped; shape validated loosely (object).
- `forge_add_set_elder(p_set_id uuid, p_user_id uuid)` — set-elder/super; target must be an existing `elder`/`superadmin` member.
- `forge_remove_set_elder(p_set_id uuid, p_user_id uuid)` — set-elder/super; refuses to remove the **last** set-elder (no orphaned set).

**Lifecycle (`forge_cards`):**
- `forge_share_card_to_set(p_card_id uuid, p_set_id uuid)` — caller owns the card AND is a set-elder of the target; only valid from `private_idea` (`set_id IS NULL`). Sets `set_id`, `status='draft'`.
- `forge_send_card_to_private(p_card_id uuid)` — owner/set-elder/super; `set_id=NULL`, `status='private_idea'` (carries version history). UI confirms.
- `forge_publish_card(p_card_id uuid) returns uuid` — owner/set-elder/super of an in-set card. `SELECT ... FOR UPDATE` the card row; allocate next `version_number`; insert a `card_versions` row (`published`) snapshotting `working_snapshot` + `working_art_*`; mark the prior `published` version `superseded`; `UPDATE` `published_version_id`, `status='playtesting'`. Re-publish allowed while `playtesting`.
- `forge_approve_card(p_card_id uuid)` — set-elder/super; marks the current published version `approved`, sets `approved_version_id`, `status='approved'`.
- `forge_unapprove_card(p_card_id uuid)` — reverse: version back to `published`, clear `approved_version_id`, `status='playtesting'`.
- `forge_archive_card(p_card_id uuid)` / `forge_unarchive_card(p_card_id uuid)` — set-elder/super; soft, reversible (`{draft,playtesting,approved} ↔ archived`).
- `forge_delete_card(p_card_id uuid)` — set-elder/super; hard delete (cascade to `card_versions`); logs `card_deleted` to `forge_audit`. UI confirms; archive is the safer presented default.

### Invariant

Exactly one non-`superseded` version per card is `published` or `approved`, pointed at by `published_version_id`/`approved_version_id`. Enforced inside the publish/approve RPCs under the row lock, never by client writes (master spec "Version-status sync").

## Leak-proofing

Extend the keystone CI test (`__tests__/forge-anon-leak.test.ts`, `FORGE_TABLES` extension point) with the 4 new tables (`forge_sets`, `forge_set_elders`, `forge_set_grants`, `card_versions`) → 0 rows for anon and for a logged-in non-member; and add anon-cannot-exec probes for every new RPC. The `forge-gate-first` static scan already covers the new routes; `forge-no-next-image` covers the new components. No new leak surface: art remains UUID-key + authed proxy; `card_versions.data` is RLS-gated identically to the card.

## App layer

### Lib (server actions + pure modules)
- `app/forge/lib/sets.ts` — `createSet`, `listSets` (sets the caller can see + actual/target counts for the index), `getSet`, `renameSet`, `saveSetNotes`, `saveSetTargets`, `addSetElder`, `removeSetElder`, `listSetCards`, `listSetElders`.
- `app/forge/lib/lifecycle.ts` — `shareToSet`, `sendToPrivate`, `publish`, `approve`, `unapprove`, `archive`, `unarchive`, `deleteCard`. Each wraps a single RPC + `revalidatePath`.
- `app/forge/lib/progress.ts` — **pure**: given the set's cards (`working_snapshot` type/brigades + status) and `target_counts`, compute the dashboard model (headline, status breakdown, brigade × card-type actual-vs-target matrix, what's-left checklist). Unit-tested.
- `app/forge/lib/cards.ts` — extend `getCard`/`ForgeCardFull` to carry `setId`, `status`, `publishedVersionId`, `approvedVersionId` so the studio can render context + lifecycle state. `listForgeCards` (ideas grid) already filters `set_id` via owner; restrict it to `set_id IS NULL` for the private sketchbook.

### Routes (all `force-dynamic`, gate-first)
- `/forge/cards/[cardId]` — the renamed context-aware studio. Old `/forge/ideas/[cardId]` → redirect.
- `/forge/sets` — sets index (cards-vs-target rollup per set; "New set" for elders).
- `/forge/sets/[setId]/cards` — set library grid (reuses the ideas grid component; adds status badges, owner/updated info, lifecycle entry points).
- `/forge/sets/[setId]/notes` — markdown notes editor (autosave, refetch).
- `/forge/sets/[setId]/progress` — progress dashboard.

### Components
- Extract the card-preview grid from `IdeasLibrary` into a shared `<ForgeCardGrid>` used by both the ideas sketchbook and the set library.
- Studio gains a **context header**: breadcrumb (set name when in-set), status stepper (`Draft → Playtesting → Approved`), and lifecycle controls (Publish / Approve / Archive / Delete / Send back to private), plus a **Share to set** control when the card is a private idea (set picker over sets the elder is on).
- **Targets editor**: a compact grid for `target_counts.cells` (per card-type row → brigade columns + a "none" bucket), elder-editable, autosave.
- **Progress dashboard**: one honest headline (`73/120 · 61%`), a status breakdown bar (draft/playtesting/approved), the hero **brigade × card-type heatmap** (actual vs target per cell), and an auto-generated "what's left" checklist. Mobile: matrix scrolls horizontally with sticky row labels; the rest stacks above. Tap a gap cell → set library filtered + a "new [Brown Lost Soul]" CTA.

### Dashboard counting (made explicit)
- **Headline** = distinct non-archived cards in the set / `target_counts.total`.
- **Status bar** = those cards grouped by `forge_cards.status`.
- **Heatmap cell (type, brigade)** = count of non-archived cards whose `working_snapshot.cardType` includes `type` AND whose `working_snapshot.brigades` includes `brigade`; brigade-less types use a single **"none"** column. A dual-type/dual-brigade card therefore counts in each cell it occupies (honest "appears in both"); the headline still counts it once. `byType`/`byBrigade` roll-ups derive from cells. A set that declares only `total` still renders actual distribution with per-cell targets omitted (graceful degrade).

## Testing & verification
- DB: `npm run test:security` (anon-leak + RPC-exec probes) stays green with the 4 new tables + new RPCs.
- Pure: unit tests for `progress.ts` (multi-type/brigade counting, "none" bucket, graceful degrade), slugify/collision, and the publish version-number allocation logic where extractable.
- Lifecycle: an integration-style test (against a local/branch DB or mocked RPC layer, matching the existing 1a.4 test style) for share → publish → approve → unapprove → archive → delete and the I1 authz boundary (non-set elder cannot write).
- Static guardrails: `forge-gate-first` + `forge-no-next-image` cover new routes/components.
- Build clean; signed-in manual smoke on a Vercel preview (create set → share idea → publish → approve → dashboard reflects it) — the e2e that prior slices deferred.

## Sizing note

This slice is intentionally large (migration 052 alone carries 4 tables, 2 helpers, ~5 policies, the I1 fix, and ~13 RPCs). The implementation plan should expect ~15–18 tasks and will likely run via subagent-driven-development like 1a.2–1a.4, with an opus whole-branch review before merge. Migration 052 must be applied to prod with explicit per-migration user authorization (the autonomous classifier blocks subagent-applied migrations).

## Open follow-ups intentionally NOT addressed here
- Print/promotion + `promoted` status (next slice).
- Realtime/presence + the full review workflow (Phase 1b).
- Playtester role/onboarding + grant-driven `approved`-only visibility going live (Phase 2; the RLS branch ships dormant now).
