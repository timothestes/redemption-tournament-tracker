# Forge Phase 1a.5 — Sets, Lifecycle & Progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let elders gather cards into sets, take them through a publish/approve lifecycle backed by immutable `card_versions`, write set notes, declare targets, and watch a brigade × card-type progress dashboard fill in — all behind the existing default-deny Forge security spine.

**Architecture:** One self-contained SQL migration (`052`) adds the `forge_sets` / `forge_set_elders` / `forge_set_grants` tables, the append-only `card_versions` history with composite-FK version pointers on `forge_cards`, set-aware RLS, the I1 write-authz fix, and ~16 SECURITY DEFINER RPCs (set management + lifecycle). A thin server-action layer (`sets.ts`, `lifecycle.ts`) wraps the RPCs; a pure `progress.ts` computes the dashboard model; the studio collapses to one context-aware route `/forge/cards/[cardId]`; new `/forge/sets/**` routes render the index, library, notes, and dashboard.

**Tech Stack:** Next.js 15 App Router (RSC + server actions), React 19, TypeScript, Supabase (Postgres + RLS + SECURITY DEFINER RPCs), Vitest, Tailwind.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-24-forge-phase-1a-5-sets-lifecycle-design.md`. Master spec: `docs/superpowers/specs/2026-06-19-forge-card-design-playtesting-design.md`.
- **Security spine (non-negotiable):** every new table has RLS, policies `TO authenticated` only, `revoke all ... from anon`, `grant select ... to authenticated`. Every new function is `security definer ... set search_path = ''` and gets `revoke execute ... from public, anon;` then `grant execute ... to authenticated;` (Supabase default-grants EXECUTE to anon directly — REVOKE FROM PUBLIC alone is insufficient; cf. migration 048).
- **No card secret data ever reaches a non-member.** `card_versions.data` is RLS-gated identically to its parent card. Art stays UUID-key + authed proxy; no `next/image` under `app/forge/**`.
- **Every `/forge/**` route/layout is gate-first:** `const ctx = await requireForge()` (or `requireElder`) is the literal first statement, `notFound()` on null, `export const dynamic = "force-dynamic"`. Enforced by `__tests__/forge-gate-first.test.ts`.
- **Deferred (DO NOT build):** print export, public-pool promotion, the `promoted` status + promote RPC/pointer; Realtime/presence/review (1b); playtester play (2). `forge_set_grants` + the granted RLS branch ship dormant.
- **Migration apply:** migration `052` is authored here and applied to a Supabase **dev branch** for testing. Applying to **prod** is a separate step requiring explicit per-migration user authorization (the autonomous classifier blocks subagent-applied migrations).
- **Commit style:** end commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Work happens on branch `forge-phase-1a-5-sets-lifecycle` (already created).

---

## File Structure

**Create:**
- `supabase/migrations/052_forge_sets_lifecycle.sql` — all schema + RLS + RPCs for this slice.
- `app/forge/lib/progress.ts` — pure dashboard-model computation.
- `app/forge/lib/progress.test.ts` — its unit tests. *(Note: forge lib tests live next to the lib in `app/forge/lib/__tests__/`; see existing `app/forge/lib/__tests__/cards.test.ts`.)* Actual path: `app/forge/lib/__tests__/progress.test.ts`.
- `app/forge/lib/sets.ts` — set server actions + types.
- `app/forge/lib/__tests__/sets.test.ts`.
- `app/forge/lib/lifecycle.ts` — lifecycle server actions.
- `app/forge/lib/__tests__/lifecycle.test.ts`.
- `app/forge/components/ForgeCardGrid.tsx` — shared card-preview grid.
- `app/forge/cards/[cardId]/page.tsx`, `.../StudioEditor.tsx`, `.../FullModeForm.tsx` — the renamed/moved studio (moved from `app/forge/ideas/[cardId]/`).
- `app/forge/cards/[cardId]/LifecycleControls.tsx` — context header + lifecycle buttons + share-to-set.
- `app/forge/sets/page.tsx`, `app/forge/sets/SetsIndex.tsx` — sets index.
- `app/forge/sets/[setId]/layout.tsx` — set sub-nav + gate.
- `app/forge/sets/[setId]/cards/page.tsx` — set library.
- `app/forge/sets/[setId]/notes/page.tsx`, `.../NotesEditor.tsx` — set notes.
- `app/forge/sets/[setId]/progress/page.tsx`, `.../ProgressDashboard.tsx`, `.../TargetsEditor.tsx`, `.../SetEldersPanel.tsx` — dashboard + targets + elder management.

**Modify:**
- `app/forge/lib/cards.ts` — extend `ForgeCardFull` + `getCard`/`listForgeCards`.
- `app/forge/lib/__tests__/cards.test.ts` — update for new columns.
- `app/forge/ideas/[cardId]/page.tsx` — replace with a redirect to `/forge/cards/[cardId]`.
- `app/forge/ideas/IdeasLibrary.tsx` — use `<ForgeCardGrid>`; links/route to `/forge/cards/...`.
- `app/forge/page.tsx` — add Ideas/Sets navigation.
- `__tests__/forge-anon-leak.test.ts` — extend `FORGE_TABLES` + `FORGE_RPCS`.

---

## Task 1: Migration 052 — schema, RLS, helpers, write-authz fix, RPCs

**Files:**
- Create: `supabase/migrations/052_forge_sets_lifecycle.sql`

**Interfaces — Produces (RPC names + signatures the lib layer relies on):**
- Helpers: `is_forge_set_elder(uuid) → bool`, `is_forge_set_granted(uuid) → bool`
- Sets: `forge_create_set(p_name text) → uuid`, `forge_rename_set(p_set_id uuid, p_name text) → void`, `forge_save_set_notes(p_set_id uuid, p_notes text) → timestamptz`, `forge_save_set_targets(p_set_id uuid, p_targets jsonb) → timestamptz`, `forge_add_set_elder(p_set_id uuid, p_user_id uuid) → void`, `forge_remove_set_elder(p_set_id uuid, p_user_id uuid) → void`
- Lifecycle: `forge_share_card_to_set(p_card_id uuid, p_set_id uuid) → void`, `forge_send_card_to_private(p_card_id uuid) → void`, `forge_publish_card(p_card_id uuid) → uuid`, `forge_approve_card(p_card_id uuid) → void`, `forge_unapprove_card(p_card_id uuid) → void`, `forge_archive_card(p_card_id uuid) → void`, `forge_unarchive_card(p_card_id uuid) → void`, `forge_delete_card(p_card_id uuid) → void`
- New tables: `forge_sets`, `forge_set_elders`, `forge_set_grants`, `card_versions`; new `forge_cards` columns `set_id`, `published_version_id`, `approved_version_id`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/052_forge_sets_lifecycle.sql`:

```sql
-- 052_forge_sets_lifecycle.sql
-- Forge phase 1a.5: sets + card lifecycle + immutable versions.
-- Adds forge_sets / forge_set_elders / forge_set_grants (grants dormant for Phase 2),
-- the append-only card_versions history with composite-FK version pointers on
-- forge_cards, set-aware RLS, the I1 write-authz fix, and the set/lifecycle RPCs.
-- Builds on 048 (helpers), 050 (forge_cards + art RPCs), 051 (working_snapshot/status,
-- is_forge_superadmin, forge_save_card). SCHEMA + FUNCTIONS ONLY — no card data.
-- Promotion (promoted status / promoted_version_id / promote RPC) is a later slice.

-- 1) Version-status enum
do $$ begin
  create type public.version_status as enum ('published','approved','superseded');
exception when duplicate_object then null; end $$;

-- 2) Sets
create table if not exists public.forge_sets (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique not null,
  notes         text,
  target_counts jsonb not null default '{}'::jsonb,
  status        text not null default 'open',     -- open | frozen
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.forge_set_elders (
  set_id  uuid references public.forge_sets(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  primary key (set_id, user_id)
);

create table if not exists public.forge_set_grants (   -- Phase 2; ships dormant
  set_id     uuid references public.forge_sets(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  primary key (set_id, user_id)
);

-- 3) Immutable, append-only published snapshots (linear history)
create table if not exists public.card_versions (
  id                 uuid primary key default gen_random_uuid(),
  card_id            uuid not null references public.forge_cards(id) on delete cascade,
  version_number     int not null,
  status             public.version_status not null default 'published',
  data               jsonb not null,
  art_key            text,
  art_is_placeholder boolean not null default false,
  art_original_key   text,
  created_by         uuid not null references auth.users(id),
  created_at         timestamptz not null default now(),
  unique (card_id, version_number),
  unique (card_id, id)
);

-- 4) forge_cards: set membership + version pointers (same-card enforced via composite FK)
alter table public.forge_cards
  add column if not exists set_id uuid references public.forge_sets(id) on delete set null,
  add column if not exists published_version_id uuid,
  add column if not exists approved_version_id  uuid;

do $$ begin
  alter table public.forge_cards
    add constraint fk_published foreign key (id, published_version_id)
      references public.card_versions(card_id, id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.forge_cards
    add constraint fk_approved foreign key (id, approved_version_id)
      references public.card_versions(card_id, id);
exception when duplicate_object then null; end $$;

-- 5) Helpers (definer, stable, pinned search_path — read outside caller RLS; cf. 048)
create or replace function public.is_forge_set_elder(p_set_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.forge_set_elders e
    where e.set_id = p_set_id and e.user_id = auth.uid()
  );
$$;

create or replace function public.is_forge_set_granted(p_set_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.forge_set_grants g
    where g.set_id = p_set_id and g.user_id = auth.uid()
  );
$$;

-- 6) RLS on the new tables
alter table public.forge_sets       enable row level security;
alter table public.forge_set_elders enable row level security;
alter table public.forge_set_grants enable row level security;
alter table public.card_versions    enable row level security;

drop policy if exists "forge_sets_select" on public.forge_sets;
create policy "forge_sets_select" on public.forge_sets
  for select to authenticated
  using (public.is_forge_set_elder(id)
         or public.is_forge_set_granted(id)
         or public.is_forge_superadmin());

drop policy if exists "forge_set_elders_select" on public.forge_set_elders;
create policy "forge_set_elders_select" on public.forge_set_elders
  for select to authenticated
  using (public.is_forge_set_elder(set_id) or public.is_forge_superadmin());

drop policy if exists "forge_set_grants_select" on public.forge_set_grants;
create policy "forge_set_grants_select" on public.forge_set_grants
  for select to authenticated
  using (public.is_forge_set_elder(set_id) or public.is_forge_superadmin());

drop policy if exists "card_versions_select" on public.card_versions;
create policy "card_versions_select" on public.card_versions
  for select to authenticated
  using (exists (
    select 1 from public.forge_cards c
    where c.id = card_versions.card_id
      and (c.owner_id = auth.uid()
           or public.is_forge_superadmin()
           or (c.set_id is not null and public.is_forge_set_elder(c.set_id))
           or (c.set_id is not null and card_versions.status = 'approved'
               and public.is_forge_set_granted(c.set_id)))
  ));

revoke all on public.forge_sets       from anon;
revoke all on public.forge_set_elders from anon;
revoke all on public.forge_set_grants from anon;
revoke all on public.card_versions    from anon;
grant select on public.forge_sets       to authenticated;
grant select on public.forge_set_elders to authenticated;
grant select on public.forge_set_grants to authenticated;
grant select on public.card_versions    to authenticated;

-- 7) forge_cards SELECT: extend 051's owner-or-super stub with set-elder + (dormant) granted branches
drop policy if exists "forge_cards_select" on public.forge_cards;
create policy "forge_cards_select" on public.forge_cards
  for select to authenticated
  using (owner_id = auth.uid()
         or public.is_forge_superadmin()
         or (set_id is not null and public.is_forge_set_elder(set_id))
         or (set_id is not null and status = 'approved' and public.is_forge_set_granted(set_id)));

-- 8) I1 write-authz fix: owner OR set-elder-of-THIS-card's-set OR superadmin
--    (was owner OR any-elder, which let a non-set elder overwrite a foreign card).
create or replace function public.forge_save_card(p_card_id uuid, p_snapshot jsonb)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_updated timestamptz;
begin
  if not exists (
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid()
           or public.is_forge_superadmin()
           or (c.set_id is not null and public.is_forge_set_elder(c.set_id)))
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  if octet_length(p_snapshot::text) > 64000 then
    raise exception 'snapshot too large';
  end if;
  update public.forge_cards
     set working_snapshot = p_snapshot,
         title = nullif(btrim(coalesce(p_snapshot->>'name','')), ''),
         updated_at = now()
   where id = p_card_id
  returning updated_at into v_updated;
  return v_updated;
end; $$;

create or replace function public.forge_set_working_art(
  p_card_id uuid, p_key text, p_original_key text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid()
           or public.is_forge_superadmin()
           or (c.set_id is not null and public.is_forge_set_elder(c.set_id)))
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  update public.forge_cards
     set working_art_key = p_key, working_art_original_key = p_original_key,
         working_art_is_placeholder = false, updated_at = now()
   where id = p_card_id;
end; $$;

create or replace function public.forge_set_art_placeholder(
  p_card_id uuid, p_is_placeholder boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid()
           or public.is_forge_superadmin()
           or (c.set_id is not null and public.is_forge_set_elder(c.set_id)))
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  update public.forge_cards
     set working_art_is_placeholder = coalesce(p_is_placeholder, false), updated_at = now()
   where id = p_card_id;
end; $$;

-- 9) Set-management RPCs
create or replace function public.forge_create_set(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_base text; v_slug text; v_n int := 1;
begin
  if not public.is_forge_elder_or_super() then
    raise exception 'only elders may create sets';
  end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'set name required'; end if;
  v_base := btrim(regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'), '-');
  if v_base = '' then v_base := 'set'; end if;
  v_slug := v_base;
  while exists(select 1 from public.forge_sets where slug = v_slug) loop
    v_n := v_n + 1; v_slug := v_base || '-' || v_n;
  end loop;
  insert into public.forge_sets (name, slug, created_by)
  values (btrim(p_name), v_slug, auth.uid())
  returning id into v_id;
  insert into public.forge_set_elders (set_id, user_id) values (v_id, auth.uid());
  return v_id;
end; $$;

create or replace function public.forge_rename_set(p_set_id uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_forge_set_elder(p_set_id) or public.is_forge_superadmin()) then
    raise exception 'not a designer on this set';
  end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'set name required'; end if;
  update public.forge_sets set name = btrim(p_name), updated_at = now() where id = p_set_id;
end; $$;

create or replace function public.forge_save_set_notes(p_set_id uuid, p_notes text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_updated timestamptz;
begin
  if not (public.is_forge_set_elder(p_set_id) or public.is_forge_superadmin()) then
    raise exception 'not a designer on this set';
  end if;
  if octet_length(coalesce(p_notes,'')) > 64000 then raise exception 'notes too large'; end if;
  update public.forge_sets set notes = p_notes, updated_at = now()
   where id = p_set_id returning updated_at into v_updated;
  return v_updated;
end; $$;

create or replace function public.forge_save_set_targets(p_set_id uuid, p_targets jsonb)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_updated timestamptz;
begin
  if not (public.is_forge_set_elder(p_set_id) or public.is_forge_superadmin()) then
    raise exception 'not a designer on this set';
  end if;
  if jsonb_typeof(p_targets) <> 'object' then raise exception 'targets must be an object'; end if;
  if octet_length(p_targets::text) > 32000 then raise exception 'targets too large'; end if;
  update public.forge_sets set target_counts = p_targets, updated_at = now()
   where id = p_set_id returning updated_at into v_updated;
  return v_updated;
end; $$;

create or replace function public.forge_add_set_elder(p_set_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_forge_set_elder(p_set_id) or public.is_forge_superadmin()) then
    raise exception 'not a designer on this set';
  end if;
  if public.forge_role_of(p_user_id) not in ('elder','superadmin') then
    raise exception 'only elders can design a set';
  end if;
  insert into public.forge_set_elders (set_id, user_id)
  values (p_set_id, p_user_id) on conflict do nothing;
end; $$;

create or replace function public.forge_remove_set_elder(p_set_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_forge_set_elder(p_set_id) or public.is_forge_superadmin()) then
    raise exception 'not a designer on this set';
  end if;
  if (select count(*) from public.forge_set_elders where set_id = p_set_id) <= 1 then
    raise exception 'a set must keep at least one designer';
  end if;
  delete from public.forge_set_elders where set_id = p_set_id and user_id = p_user_id;
end; $$;

-- 10) Lifecycle RPCs
create or replace function public.forge_share_card_to_set(p_card_id uuid, p_set_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if v_card.set_id is not null then raise exception 'card is already in a set'; end if;
  if v_card.owner_id <> auth.uid() and not public.is_forge_superadmin() then
    raise exception 'only the owner can share this idea';
  end if;
  if not (public.is_forge_set_elder(p_set_id) or public.is_forge_superadmin()) then
    raise exception 'not a designer on the target set';
  end if;
  update public.forge_cards set set_id = p_set_id, status = 'draft', updated_at = now()
   where id = p_card_id;
end; $$;

create or replace function public.forge_send_card_to_private(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if v_card.set_id is null then raise exception 'card is not in a set'; end if;
  if not (v_card.owner_id = auth.uid() or public.is_forge_superadmin()
          or public.is_forge_set_elder(v_card.set_id)) then
    raise exception 'not authorized';
  end if;
  update public.card_versions set status = 'superseded'
   where card_id = p_card_id and status <> 'superseded';
  update public.forge_cards
     set set_id = null, status = 'private_idea',
         published_version_id = null, approved_version_id = null, updated_at = now()
   where id = p_card_id;
end; $$;

create or replace function public.forge_publish_card(p_card_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype; v_next int; v_version_id uuid;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (v_card.owner_id = auth.uid() or public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to publish this card';
  end if;
  if v_card.set_id is null then raise exception 'only cards in a set can be published'; end if;
  if v_card.status not in ('draft','playtesting') then
    raise exception 'only a draft or playtesting card can be published';
  end if;
  select coalesce(max(version_number), 0) + 1 into v_next
    from public.card_versions where card_id = p_card_id;
  update public.card_versions set status = 'superseded'
    where card_id = p_card_id and status = 'published';
  insert into public.card_versions
    (card_id, version_number, status, data, art_key, art_is_placeholder, art_original_key, created_by)
  values
    (p_card_id, v_next, 'published', v_card.working_snapshot,
     v_card.working_art_key, v_card.working_art_is_placeholder, v_card.working_art_original_key, auth.uid())
  returning id into v_version_id;
  update public.forge_cards
     set published_version_id = v_version_id, status = 'playtesting', updated_at = now()
   where id = p_card_id;
  return v_version_id;
end; $$;

create or replace function public.forge_approve_card(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to approve this card';
  end if;
  if v_card.status <> 'playtesting' or v_card.published_version_id is null then
    raise exception 'only a playtesting card with a published version can be approved';
  end if;
  update public.card_versions set status = 'approved' where id = v_card.published_version_id;
  update public.forge_cards
     set approved_version_id = published_version_id, status = 'approved', updated_at = now()
   where id = p_card_id;
end; $$;

create or replace function public.forge_unapprove_card(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized';
  end if;
  if v_card.status <> 'approved' then raise exception 'card is not approved'; end if;
  update public.card_versions set status = 'published' where id = v_card.approved_version_id;
  update public.forge_cards
     set approved_version_id = null, status = 'playtesting', updated_at = now()
   where id = p_card_id;
end; $$;

create or replace function public.forge_archive_card(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized';
  end if;
  if v_card.status not in ('draft','playtesting','approved') then
    raise exception 'card cannot be archived from its current state';
  end if;
  update public.forge_cards set status = 'archived', updated_at = now() where id = p_card_id;
end; $$;

create or replace function public.forge_unarchive_card(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized';
  end if;
  if v_card.status <> 'archived' then raise exception 'card is not archived'; end if;
  update public.forge_cards set status = 'draft', updated_at = now() where id = p_card_id;
end; $$;

create or replace function public.forge_delete_card(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (v_card.owner_id = auth.uid() or public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to delete this card';
  end if;
  delete from public.forge_cards where id = p_card_id;  -- cascades card_versions
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_deleted', p_card_id::text);
end; $$;

-- 11) Lock down EXECUTE on every new function (anon stripped explicitly; cf. 048)
revoke execute on function public.is_forge_set_elder(uuid) from public, anon;
revoke execute on function public.is_forge_set_granted(uuid) from public, anon;
revoke execute on function public.forge_create_set(text) from public, anon;
revoke execute on function public.forge_rename_set(uuid, text) from public, anon;
revoke execute on function public.forge_save_set_notes(uuid, text) from public, anon;
revoke execute on function public.forge_save_set_targets(uuid, jsonb) from public, anon;
revoke execute on function public.forge_add_set_elder(uuid, uuid) from public, anon;
revoke execute on function public.forge_remove_set_elder(uuid, uuid) from public, anon;
revoke execute on function public.forge_share_card_to_set(uuid, uuid) from public, anon;
revoke execute on function public.forge_send_card_to_private(uuid) from public, anon;
revoke execute on function public.forge_publish_card(uuid) from public, anon;
revoke execute on function public.forge_approve_card(uuid) from public, anon;
revoke execute on function public.forge_unapprove_card(uuid) from public, anon;
revoke execute on function public.forge_archive_card(uuid) from public, anon;
revoke execute on function public.forge_unarchive_card(uuid) from public, anon;
revoke execute on function public.forge_delete_card(uuid) from public, anon;

grant execute on function public.is_forge_set_elder(uuid) to authenticated;
grant execute on function public.is_forge_set_granted(uuid) to authenticated;
grant execute on function public.forge_create_set(text) to authenticated;
grant execute on function public.forge_rename_set(uuid, text) to authenticated;
grant execute on function public.forge_save_set_notes(uuid, text) to authenticated;
grant execute on function public.forge_save_set_targets(uuid, jsonb) to authenticated;
grant execute on function public.forge_add_set_elder(uuid, uuid) to authenticated;
grant execute on function public.forge_remove_set_elder(uuid, uuid) to authenticated;
grant execute on function public.forge_share_card_to_set(uuid, uuid) to authenticated;
grant execute on function public.forge_send_card_to_private(uuid) to authenticated;
grant execute on function public.forge_publish_card(uuid) to authenticated;
grant execute on function public.forge_approve_card(uuid) to authenticated;
grant execute on function public.forge_unapprove_card(uuid) to authenticated;
grant execute on function public.forge_archive_card(uuid) to authenticated;
grant execute on function public.forge_unarchive_card(uuid) to authenticated;
grant execute on function public.forge_delete_card(uuid) to authenticated;
```

- [ ] **Step 2: Apply to a Supabase dev branch and smoke-check**

Apply via the Supabase MCP `apply_migration` against a **dev branch** (not prod). Then run a smoke SQL check (MCP `execute_sql` on the branch) asserting the objects exist:

```sql
select to_regclass('public.forge_sets'), to_regclass('public.card_versions'),
       to_regclass('public.forge_set_elders'), to_regclass('public.forge_set_grants');
select proname from pg_proc where proname like 'forge_%set%' or proname like 'forge_publish_card';
```
Expected: all four `to_regclass` non-null; the RPC names listed.

- [ ] **Step 3: Verify `get_advisors` shows no new security findings**

Run the Supabase MCP `get_advisors` (security) on the dev branch. Expected: no new ERROR/WARN attributable to the 052 objects (RLS enabled on all four tables; no anon grants).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/052_forge_sets_lifecycle.sql
git commit -m "feat(forge): migration 052 — sets, card_versions, lifecycle RPCs, I1 authz fix"
```

---

## Task 2: Extend the anon-leak guardrail

**Files:**
- Modify: `__tests__/forge-anon-leak.test.ts:16` (FORGE_TABLES) and `:36-55` (FORGE_RPCS)

**Interfaces — Consumes:** the table/RPC names from Task 1.

- [ ] **Step 1: Add the four new tables to `FORGE_TABLES`**

Replace line 16:

```ts
const FORGE_TABLES = [
  "playtest_members", "forge_invites", "forge_audit", "forge_cards",
  "forge_sets", "forge_set_elders", "forge_set_grants", "card_versions",
];
```

- [ ] **Step 2: Add anon-cannot-execute probes for every new RPC**

Append these entries to the `FORGE_RPCS` array (before the closing `];` at line 55):

```ts
    ["is_forge_set_elder", { p_set_id: "00000000-0000-0000-0000-000000000000" }],
    ["is_forge_set_granted", { p_set_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_create_set", { p_name: "x" }],
    ["forge_rename_set", { p_set_id: "00000000-0000-0000-0000-000000000000", p_name: "x" }],
    ["forge_save_set_notes", { p_set_id: "00000000-0000-0000-0000-000000000000", p_notes: "x" }],
    ["forge_save_set_targets", { p_set_id: "00000000-0000-0000-0000-000000000000", p_targets: {} }],
    ["forge_add_set_elder", { p_set_id: "00000000-0000-0000-0000-000000000000", p_user_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_remove_set_elder", { p_set_id: "00000000-0000-0000-0000-000000000000", p_user_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_share_card_to_set", { p_card_id: "00000000-0000-0000-0000-000000000000", p_set_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_send_card_to_private", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_publish_card", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_approve_card", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_unapprove_card", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_archive_card", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_unarchive_card", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_delete_card", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
```

- [ ] **Step 3: Run the security suite against the dev branch**

Run: `FORGE_LEAK_TEST=1 npm run test:security` (with the dev-branch `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` in `.env.local`).
Expected: PASS — anon sees 0 rows in all 8 tables; anon cannot execute any of the listed RPCs.

- [ ] **Step 4: Commit**

```bash
git add __tests__/forge-anon-leak.test.ts
git commit -m "test(forge): extend anon-leak guardrail with sets/versions tables + lifecycle RPCs"
```

---

## Task 3: `progress.ts` — pure dashboard model (TDD)

**Files:**
- Create: `app/forge/lib/progress.ts`
- Test: `app/forge/lib/__tests__/progress.test.ts`

**Interfaces — Produces:**
- `type TargetCounts = { total?: number; cells?: Record<string, Record<string, number>> }`
- `type ProgressCell = { type: string; brigade: string; actual: number; target: number }`
- `type ProgressModel = { headline: { actual: number; target: number; pct: number }; byStatus: Record<string, number>; types: string[]; brigades: string[]; cells: ProgressCell[]; checklist: { type: string; brigade: string; remaining: number }[] }`
- `function computeProgress(cards: { snapshot: { cardType?: string[]; brigades?: string[] }; status: string }[], targets: TargetCounts): ProgressModel`

**Counting rules (from spec "Dashboard counting"):** headline = distinct non-archived cards; a card counts in **every** `(type, brigade)` cell it occupies (cartesian of its `cardType` × `brigades`); brigade-less types use the `"none"` brigade bucket. `byStatus` groups non-archived cards by `status`.

- [ ] **Step 1: Write the failing tests**

Create `app/forge/lib/__tests__/progress.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeProgress } from "../progress";

const card = (cardType: string[], brigades: string[] | undefined, status = "draft") => ({
  snapshot: { cardType, brigades }, status,
});

describe("computeProgress", () => {
  it("headline counts distinct non-archived cards against target total", () => {
    const m = computeProgress(
      [card(["Hero"], ["Blue"]), card(["LostSoul"], undefined), card(["Hero"], ["Green"], "archived")],
      { total: 10 }
    );
    expect(m.headline).toEqual({ actual: 2, target: 10, pct: 20 });
  });

  it("a dual-brigade card counts in each brigade cell but once in the headline", () => {
    const m = computeProgress([card(["Hero"], ["Blue", "Green"])], { total: 5, cells: { Hero: { Blue: 1, Green: 1 } } });
    expect(m.headline.actual).toBe(1);
    const blue = m.cells.find((c) => c.type === "Hero" && c.brigade === "Blue");
    const green = m.cells.find((c) => c.type === "Hero" && c.brigade === "Green");
    expect(blue?.actual).toBe(1);
    expect(green?.actual).toBe(1);
  });

  it("brigade-less types use the 'none' bucket", () => {
    const m = computeProgress([card(["LostSoul"], undefined), card(["Artifact"], [])], { cells: { LostSoul: { none: 3 }, Artifact: { none: 2 } } });
    expect(m.cells.find((c) => c.type === "LostSoul" && c.brigade === "none")?.actual).toBe(1);
    expect(m.cells.find((c) => c.type === "Artifact" && c.brigade === "none")?.actual).toBe(1);
  });

  it("byStatus groups non-archived cards by status", () => {
    const m = computeProgress(
      [card(["Hero"], ["Blue"], "draft"), card(["Hero"], ["Blue"], "playtesting"), card(["Hero"], ["Blue"], "archived")],
      {}
    );
    expect(m.byStatus).toEqual({ draft: 1, playtesting: 1 });
  });

  it("checklist lists per-cell remaining where target exceeds actual", () => {
    const m = computeProgress([card(["Hero"], ["Blue"])], { cells: { Hero: { Blue: 3, Green: 2 } } });
    const blue = m.checklist.find((c) => c.type === "Hero" && c.brigade === "Blue");
    const green = m.checklist.find((c) => c.type === "Hero" && c.brigade === "Green");
    expect(blue?.remaining).toBe(2);
    expect(green?.remaining).toBe(2);
  });

  it("graceful degrade: total-only targets still render actuals with target 0 cells", () => {
    const m = computeProgress([card(["Hero"], ["Blue"])], { total: 4 });
    expect(m.headline.target).toBe(4);
    expect(m.cells.find((c) => c.type === "Hero" && c.brigade === "Blue")?.target).toBe(0);
    expect(m.checklist).toEqual([]); // no per-cell targets declared
  });

  it("pct is 0 when target total is 0 or absent", () => {
    expect(computeProgress([card(["Hero"], ["Blue"])], {}).headline.pct).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/forge/lib/__tests__/progress.test.ts`
Expected: FAIL — `computeProgress` is not defined.

- [ ] **Step 3: Implement `progress.ts`**

Create `app/forge/lib/progress.ts`:

```ts
// Pure dashboard-model computation. No DB, no UI. Counts a card in every
// (type, brigade) cell it occupies; brigade-less types use the "none" bucket.

export type TargetCounts = {
  total?: number;
  cells?: Record<string, Record<string, number>>;
};

export type ProgressCell = { type: string; brigade: string; actual: number; target: number };

export type ProgressModel = {
  headline: { actual: number; target: number; pct: number };
  byStatus: Record<string, number>;
  types: string[];
  brigades: string[];
  cells: ProgressCell[];
  checklist: { type: string; brigade: string; remaining: number }[];
};

type CardLike = { snapshot: { cardType?: string[]; brigades?: string[] }; status: string };

export function computeProgress(cards: CardLike[], targets: TargetCounts): ProgressModel {
  const live = cards.filter((c) => c.status !== "archived");

  const byStatus: Record<string, number> = {};
  for (const c of live) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;

  // actual[type][brigade] = count
  const actual: Record<string, Record<string, number>> = {};
  const bump = (t: string, b: string) => {
    (actual[t] ??= {})[b] = (actual[t]?.[b] ?? 0) + 1;
  };
  for (const c of live) {
    const types = c.snapshot.cardType ?? [];
    const brigades = c.snapshot.brigades ?? [];
    for (const t of types) {
      if (brigades.length === 0) bump(t, "none");
      else for (const b of brigades) bump(t, b);
    }
  }

  const cellTargets = targets.cells ?? {};
  const types = Array.from(new Set([...Object.keys(cellTargets), ...Object.keys(actual)])).sort();
  const brigades = Array.from(
    new Set([
      ...Object.values(cellTargets).flatMap((row) => Object.keys(row)),
      ...Object.values(actual).flatMap((row) => Object.keys(row)),
    ])
  ).sort();

  const cells: ProgressCell[] = [];
  const checklist: { type: string; brigade: string; remaining: number }[] = [];
  for (const t of types) {
    for (const b of brigades) {
      const a = actual[t]?.[b] ?? 0;
      const tgt = cellTargets[t]?.[b] ?? 0;
      cells.push({ type: t, brigade: b, actual: a, target: tgt });
      if (tgt > a) checklist.push({ type: t, brigade: b, remaining: tgt - a });
    }
  }

  const target = targets.total ?? 0;
  const pct = target > 0 ? Math.round((live.length / target) * 100) : 0;

  return { headline: { actual: live.length, target, pct }, byStatus, types, brigades, cells, checklist };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run app/forge/lib/__tests__/progress.test.ts`
Expected: PASS (all 7).

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/progress.ts app/forge/lib/__tests__/progress.test.ts
git commit -m "feat(forge): pure progress-dashboard model computation"
```

---

## Task 4: `sets.ts` — set server actions (TDD)

**Files:**
- Create: `app/forge/lib/sets.ts`
- Test: `app/forge/lib/__tests__/sets.test.ts`

**Interfaces — Consumes:** `requireForge`/`requireElder` (auth), the Task 1 RPCs, `ForgeCardFull`/`toFull`-shaped rows from `cards.ts`.
**Produces:**
- `type ForgeSetSummary = { id: string; name: string; slug: string; status: string; total: number; targetTotal: number }`
- `type ForgeSetDetail = { id: string; name: string; slug: string; notes: string | null; targetCounts: TargetCounts; status: string }`
- `type SetElder = { userId: string; displayName: string | null; role: string }`
- `createSet(name)`, `listSets()`, `getSet(id)`, `renameSet(id,name)`, `saveSetNotes(id,notes)`, `saveSetTargets(id,targets)`, `addSetElder(id,userId)`, `removeSetElder(id,userId)`, `listSetCards(id)`, `listSetElders(id)`.

- [ ] **Step 1: Write the failing tests**

Create `app/forge/lib/__tests__/sets.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn(), requireElder: vi.fn() }));

import { requireForge, requireElder } from "@/app/forge/lib/auth";
import { createSet, saveSetNotes, listSets } from "../sets";

function ctx(opts: { rpc?: any; rows?: any[] } = {}) {
  const order = vi.fn(async () => ({ data: opts.rows ?? [], error: null }));
  const eq = vi.fn(() => ({ order, eq, maybeSingle: vi.fn(async () => ({ data: (opts.rows ?? [])[0] ?? null, error: null })) }));
  const select = vi.fn(() => ({ eq, order }));
  return {
    role: "elder",
    user: { id: "u1", email: "e@x" },
    supabase: {
      rpc: vi.fn(opts.rpc ?? (async () => ({ data: "set-1", error: null }))),
      from: vi.fn(() => ({ select })),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("createSet", () => {
  it("rejects a non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await createSet("Genesis")).ok).toBe(false);
  });
  it("calls forge_create_set and returns the new id", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    const r = await createSet("Genesis");
    expect(r).toEqual({ ok: true, id: "set-1" });
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual(["forge_create_set", { p_name: "Genesis" }]);
  });
});

describe("saveSetNotes", () => {
  it("calls forge_save_set_notes and returns updatedAt", async () => {
    const c = ctx({ rpc: async () => ({ data: "2026-06-24T00:00:00Z", error: null }) });
    (requireElder as any).mockResolvedValue(c);
    const r = await saveSetNotes("set-1", "# themes");
    expect(r.ok).toBe(true);
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual(["forge_save_set_notes", { p_set_id: "set-1", p_notes: "# themes" }]);
  });
});

describe("listSets", () => {
  it("returns [] when not a member", async () => {
    (requireForge as any).mockResolvedValue(null);
    expect(await listSets()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/forge/lib/__tests__/sets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sets.ts`**

Create `app/forge/lib/sets.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireForge, requireElder } from "@/app/forge/lib/auth";
import type { TargetCounts } from "@/app/forge/lib/progress";
import { type ForgeCardFull } from "@/app/forge/lib/cards";
import type { DesignCard } from "@/app/forge/lib/designCard";

export type ForgeSetSummary = { id: string; name: string; slug: string; status: string; total: number; targetTotal: number };
export type ForgeSetDetail = { id: string; name: string; slug: string; notes: string | null; targetCounts: TargetCounts; status: string };
export type SetElder = { userId: string; displayName: string | null; role: string };

type Result = { ok: true } | { ok: false; error: string };

export async function createSet(name: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_create_set", { p_name: name });
  if (error || typeof data !== "string") return { ok: false, error: "Could not create set" };
  revalidatePath("/forge/sets");
  return { ok: true, id: data };
}

export async function listSets(): Promise<ForgeSetSummary[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  // RLS restricts to sets the caller may see.
  const { data: sets } = await ctx.supabase
    .from("forge_sets")
    .select("id, name, slug, status, target_counts")
    .order("created_at", { ascending: false });
  const { data: cards } = await ctx.supabase.from("forge_cards").select("set_id, status");
  const counts = new Map<string, number>();
  for (const c of cards ?? []) {
    if (c.set_id && c.status !== "archived") counts.set(c.set_id, (counts.get(c.set_id) ?? 0) + 1);
  }
  return (sets ?? []).map((s: any) => ({
    id: s.id, name: s.name, slug: s.slug, status: s.status,
    total: counts.get(s.id) ?? 0,
    targetTotal: (s.target_counts?.total as number) ?? 0,
  }));
}

export async function getSet(setId: string): Promise<ForgeSetDetail | null> {
  const ctx = await requireForge();
  if (!ctx) return null;
  const { data } = await ctx.supabase
    .from("forge_sets")
    .select("id, name, slug, notes, target_counts, status")
    .eq("id", setId)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, name: data.name, slug: data.slug, notes: data.notes ?? null, targetCounts: (data.target_counts ?? {}) as TargetCounts, status: data.status };
}

export async function renameSet(setId: string, name: string): Promise<Result> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_rename_set", { p_set_id: setId, p_name: name });
  if (error) return { ok: false, error: "Could not rename set" };
  revalidatePath(`/forge/sets/${setId}`);
  return { ok: true };
}

export async function saveSetNotes(setId: string, notes: string): Promise<{ ok: boolean; error?: string; updatedAt?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_save_set_notes", { p_set_id: setId, p_notes: notes });
  if (error) return { ok: false, error: "Could not save notes" };
  revalidatePath(`/forge/sets/${setId}/notes`);
  return { ok: true, updatedAt: typeof data === "string" ? data : undefined };
}

export async function saveSetTargets(setId: string, targets: TargetCounts): Promise<{ ok: boolean; error?: string; updatedAt?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_save_set_targets", { p_set_id: setId, p_targets: targets });
  if (error) return { ok: false, error: "Could not save targets" };
  revalidatePath(`/forge/sets/${setId}/progress`);
  return { ok: true, updatedAt: typeof data === "string" ? data : undefined };
}

export async function addSetElder(setId: string, userId: string): Promise<Result> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_add_set_elder", { p_set_id: setId, p_user_id: userId });
  if (error) return { ok: false, error: "Could not add designer" };
  revalidatePath(`/forge/sets/${setId}/progress`);
  return { ok: true };
}

export async function removeSetElder(setId: string, userId: string): Promise<Result> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_remove_set_elder", { p_set_id: setId, p_user_id: userId });
  if (error) return { ok: false, error: "Could not remove designer" };
  revalidatePath(`/forge/sets/${setId}/progress`);
  return { ok: true };
}

const CARD_COLS = "id, title, working_snapshot, working_art_key, working_art_is_placeholder, status, updated_at, set_id, published_version_id, approved_version_id";

export async function listSetCards(setId: string): Promise<ForgeCardFull[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("forge_cards")
    .select(CARD_COLS)
    .eq("set_id", setId)
    .order("updated_at", { ascending: false });
  return (data ?? []).map((row: any): ForgeCardFull => ({
    id: row.id, title: row.title, snapshot: (row.working_snapshot ?? {}) as DesignCard,
    hasArt: !!row.working_art_key, isPlaceholder: !!row.working_art_is_placeholder,
    status: row.status, updatedAt: row.updated_at,
    setId: row.set_id ?? null, publishedVersionId: row.published_version_id ?? null,
    approvedVersionId: row.approved_version_id ?? null,
  }));
}

export async function listSetElders(setId: string): Promise<SetElder[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data: rows } = await ctx.supabase.from("forge_set_elders").select("user_id").eq("set_id", setId);
  const ids = (rows ?? []).map((r: any) => r.user_id);
  if (ids.length === 0) return [];
  const { data: members } = await ctx.supabase.from("playtest_members").select("user_id, display_name, role").in("user_id", ids);
  return (members ?? []).map((m: any) => ({ userId: m.user_id, displayName: m.display_name ?? null, role: m.role }));
}
```

*Note:* this introduces the `ForgeCardFull` fields `setId`/`publishedVersionId`/`approvedVersionId` — Task 6 adds them to the type/`toFull` in `cards.ts`. Implement Task 6 if the type errors block compilation; subagent-driven execution runs tasks in order, so by the time the build runs these exist.

- [ ] **Step 4: Run to verify passing**

Run: `npx vitest run app/forge/lib/__tests__/sets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/sets.ts app/forge/lib/__tests__/sets.test.ts
git commit -m "feat(forge): set server actions (create/list/get/notes/targets/elders/cards)"
```

---

## Task 5: `lifecycle.ts` — lifecycle server actions (TDD)

**Files:**
- Create: `app/forge/lib/lifecycle.ts`
- Test: `app/forge/lib/__tests__/lifecycle.test.ts`

**Interfaces — Produces:** `shareToSet(cardId,setId)`, `sendToPrivate(cardId)`, `publish(cardId)`, `approve(cardId)`, `unapprove(cardId)`, `archive(cardId)`, `unarchive(cardId)`, `deleteCard(cardId)` — each `Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Write the failing tests**

Create `app/forge/lib/__tests__/lifecycle.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn(), requireElder: vi.fn() }));

import { requireElder } from "@/app/forge/lib/auth";
import { shareToSet, publish, approve, deleteCard } from "../lifecycle";

function ctx(rpc?: any) {
  return { role: "elder", user: { id: "u1" }, supabase: { rpc: vi.fn(rpc ?? (async () => ({ data: null, error: null }))) } };
}
beforeEach(() => vi.clearAllMocks());

describe("lifecycle actions", () => {
  it("reject a non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await publish("c1")).ok).toBe(false);
  });
  it("shareToSet calls forge_share_card_to_set with both ids", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    expect((await shareToSet("c1", "s1")).ok).toBe(true);
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual(["forge_share_card_to_set", { p_card_id: "c1", p_set_id: "s1" }]);
  });
  it("publish calls forge_publish_card", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    await publish("c1");
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual(["forge_publish_card", { p_card_id: "c1" }]);
  });
  it("approve surfaces an RPC error as ok:false", async () => {
    const c = ctx(async () => ({ data: null, error: { message: "nope" } }));
    (requireElder as any).mockResolvedValue(c);
    expect((await approve("c1")).ok).toBe(false);
  });
  it("deleteCard calls forge_delete_card", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    await deleteCard("c1");
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual(["forge_delete_card", { p_card_id: "c1" }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/forge/lib/__tests__/lifecycle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lifecycle.ts`**

Create `app/forge/lib/lifecycle.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireElder } from "@/app/forge/lib/auth";

type Result = { ok: boolean; error?: string };

async function call(fn: string, args: Record<string, unknown>, fail: string): Promise<Result> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc(fn, args);
  if (error) return { ok: false, error: fail };
  // Card and set views both depend on lifecycle; refresh broadly.
  revalidatePath("/forge", "layout");
  return { ok: true };
}

export async function shareToSet(cardId: string, setId: string): Promise<Result> {
  return call("forge_share_card_to_set", { p_card_id: cardId, p_set_id: setId }, "Could not share card");
}
export async function sendToPrivate(cardId: string): Promise<Result> {
  return call("forge_send_card_to_private", { p_card_id: cardId }, "Could not send card to private");
}
export async function publish(cardId: string): Promise<Result> {
  return call("forge_publish_card", { p_card_id: cardId }, "Could not publish card");
}
export async function approve(cardId: string): Promise<Result> {
  return call("forge_approve_card", { p_card_id: cardId }, "Could not approve card");
}
export async function unapprove(cardId: string): Promise<Result> {
  return call("forge_unapprove_card", { p_card_id: cardId }, "Could not unapprove card");
}
export async function archive(cardId: string): Promise<Result> {
  return call("forge_archive_card", { p_card_id: cardId }, "Could not archive card");
}
export async function unarchive(cardId: string): Promise<Result> {
  return call("forge_unarchive_card", { p_card_id: cardId }, "Could not unarchive card");
}
export async function deleteCard(cardId: string): Promise<Result> {
  return call("forge_delete_card", { p_card_id: cardId }, "Could not delete card");
}
```

- [ ] **Step 4: Run to verify passing**

Run: `npx vitest run app/forge/lib/__tests__/lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/lifecycle.ts app/forge/lib/__tests__/lifecycle.test.ts
git commit -m "feat(forge): card lifecycle server actions"
```

---

## Task 6: Extend `cards.ts` for set context

**Files:**
- Modify: `app/forge/lib/cards.ts` (`ForgeCardFull` type, `toFull`, `CARD_COLS`, `listForgeCards`)
- Modify: `app/forge/lib/__tests__/cards.test.ts`

**Interfaces — Produces:** `ForgeCardFull` gains `setId: string | null; publishedVersionId: string | null; approvedVersionId: string | null`. `listForgeCards` returns only private ideas (`set_id IS NULL`).

- [ ] **Step 1: Update the test expectations**

In `app/forge/lib/__tests__/cards.test.ts`, change the `maps a row into ForgeCardFull` test's `row` and assertion to include the new columns:

```ts
    const row = { id: "c1", title: "Goliath", working_snapshot: { name: "Goliath" }, working_art_key: "k", working_art_is_placeholder: false, status: "private_idea", updated_at: "t", set_id: null, published_version_id: null, approved_version_id: null };
    (requireForge as any).mockResolvedValue(ctx(undefined, [row]));
    const got = await getCard("c1");
    expect(got).toMatchObject({ id: "c1", title: "Goliath", snapshot: { name: "Goliath" }, hasArt: true, status: "private_idea", setId: null });
```

Add a test that `listForgeCards` filters to private ideas:

```ts
  it("listForgeCards selects only private ideas (set_id IS NULL)", async () => {
    const c = ctx(undefined, []);
    (requireForge as any).mockResolvedValue(c);
    await listForgeCards();
    // from().select().eq("owner_id", ...).is("set_id", null).order(...)
    const selectMock = (c.supabase.from as any).mock.results[0].value.select;
    expect(selectMock).toHaveBeenCalled();
  });
```

*Note:* the existing `ctx()` mock in `cards.test.ts` chains `select().eq()` returning `{ order, maybeSingle }`. Add an `is` method to that chain so `listForgeCards` (which now calls `.is("set_id", null)`) resolves. Update the mock's `select` (line 15) to:

```ts
  const isFn = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ order, maybeSingle, is: isFn })) }));
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/forge/lib/__tests__/cards.test.ts`
Expected: FAIL — `setId` missing / `.is` not a function.

- [ ] **Step 3: Update `cards.ts`**

In `app/forge/lib/cards.ts`:

Extend the type (after line 66):
```ts
export type ForgeCardFull = {
  id: string;
  title: string | null;
  snapshot: DesignCard;
  hasArt: boolean;
  isPlaceholder: boolean;
  status: string;
  updatedAt: string;
  setId: string | null;
  publishedVersionId: string | null;
  approvedVersionId: string | null;
};
```

Extend `toFull` (the return object):
```ts
  return {
    id: row.id,
    title: row.title,
    snapshot: (row.working_snapshot ?? {}) as DesignCard,
    hasArt: !!row.working_art_key,
    isPlaceholder: !!row.working_art_is_placeholder,
    status: row.status,
    updatedAt: row.updated_at,
    setId: row.set_id ?? null,
    publishedVersionId: row.published_version_id ?? null,
    approvedVersionId: row.approved_version_id ?? null,
  };
```

Extend `CARD_COLS`:
```ts
const CARD_COLS = "id, title, working_snapshot, working_art_key, working_art_is_placeholder, status, updated_at, set_id, published_version_id, approved_version_id";
```

Restrict `listForgeCards` to private ideas (it's the sketchbook now):
```ts
export async function listForgeCards(): Promise<ForgeCardFull[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("forge_cards")
    .select(CARD_COLS)
    .eq("owner_id", ctx.user.id)
    .is("set_id", null)
    .order("updated_at", { ascending: false });
  return (data ?? []).map(toFull);
}
```

Also update `revalidatePath("/forge/ideas")` calls and the `saveCard` revalidate to also cover the new studio path. Change `saveCard`'s `revalidatePath(`/forge/ideas/${cardId}`)` to `revalidatePath(`/forge/cards/${cardId}`)`.

- [ ] **Step 4: Run to verify passing**

Run: `npx vitest run app/forge/lib/__tests__/cards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/cards.ts app/forge/lib/__tests__/cards.test.ts
git commit -m "feat(forge): carry set context + version pointers on ForgeCardFull; sketchbook = private ideas only"
```

---

## Task 7: Move the studio to `/forge/cards/[cardId]` + redirect

**Files:**
- Create: `app/forge/cards/[cardId]/page.tsx`, `app/forge/cards/[cardId]/StudioEditor.tsx`, `app/forge/cards/[cardId]/FullModeForm.tsx` (moved verbatim from `app/forge/ideas/[cardId]/`)
- Modify: `app/forge/ideas/[cardId]/page.tsx` → redirect
- Modify: `app/forge/ideas/IdeasLibrary.tsx` (route push/links → `/forge/cards/...`)
- Delete: `app/forge/ideas/[cardId]/StudioEditor.tsx`, `app/forge/ideas/[cardId]/FullModeForm.tsx`

- [ ] **Step 1: Move the three studio files**

```bash
mkdir -p app/forge/cards/[cardId]
git mv app/forge/ideas/[cardId]/StudioEditor.tsx app/forge/cards/[cardId]/StudioEditor.tsx
git mv app/forge/ideas/[cardId]/FullModeForm.tsx app/forge/cards/[cardId]/FullModeForm.tsx
git mv app/forge/ideas/[cardId]/page.tsx app/forge/cards/[cardId]/page.tsx
```

- [ ] **Step 2: Re-create `/forge/ideas/[cardId]` as a redirect**

Create `app/forge/ideas/[cardId]/page.tsx`:
```tsx
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LegacyIdeaStudioRedirect({ params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params;
  redirect(`/forge/cards/${cardId}`);
}
```

- [ ] **Step 3: Point the StudioEditor "back" link and IdeasLibrary at the new route**

In `app/forge/cards/[cardId]/StudioEditor.tsx` the back link stays `/forge/ideas` (the sketchbook grid) — no change needed there. In `app/forge/ideas/IdeasLibrary.tsx`, change the two route references:
- `router.push(`/forge/ideas/${r.id}`)` → `router.push(`/forge/cards/${r.id}`)`
- the `<Link href={`/forge/ideas/${c.id}`}>` → `href={`/forge/cards/${c.id}`}` (this moves to `<ForgeCardGrid>` in Task 8; if Task 8 runs first, skip).

- [ ] **Step 4: Verify the gate-first + no-next-image guardrails still pass**

Run: `npx vitest run __tests__/forge-gate-first.test.ts __tests__/forge-no-next-image.test.ts`
Expected: PASS (the moved `page.tsx` keeps `requireForge()` first + `force-dynamic`; the redirect page has no data access).

- [ ] **Step 5: Commit**

```bash
git add app/forge/cards app/forge/ideas/[cardId]/page.tsx app/forge/ideas/IdeasLibrary.tsx
git commit -m "refactor(forge): single context-aware studio at /forge/cards/[cardId] (+ legacy redirect)"
```

---

## Task 8: Extract `<ForgeCardGrid>`

**Files:**
- Create: `app/forge/components/ForgeCardGrid.tsx`
- Modify: `app/forge/ideas/IdeasLibrary.tsx` (consume the grid)

**Interfaces — Produces:** `<ForgeCardGrid cards={ForgeCardFull[]} showStatus?={boolean} />` — renders a responsive preview grid linking each card to `/forge/cards/[id]`.

- [ ] **Step 1: Create the shared grid**

Create `app/forge/components/ForgeCardGrid.tsx`:
```tsx
import Link from "next/link";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import type { ForgeCardFull } from "@/app/forge/lib/cards";

const STATUS_LABEL: Record<string, string> = {
  private_idea: "Idea", draft: "Draft", playtesting: "Playtesting",
  approved: "Approved", archived: "Archived",
};

export default function ForgeCardGrid({ cards, showStatus = false }: { cards: ForgeCardFull[]; showStatus?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((c) => (
        <Link key={c.id} href={`/forge/cards/${c.id}`} className="block transition hover:opacity-90">
          <ForgeCardPreview card={c.snapshot} artUrl={c.hasArt ? `/forge/api/art/${c.id}` : null} />
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="truncate text-xs text-muted-foreground">{c.title ?? "Untitled"}</p>
            {showStatus && (
              <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {STATUS_LABEL[c.status] ?? c.status}
              </span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Use it in `IdeasLibrary`**

In `app/forge/ideas/IdeasLibrary.tsx`, replace the inline `<div className="grid ...">...</div>` block (the non-empty branch) with `<ForgeCardGrid cards={filtered} />` and add `import ForgeCardGrid from "@/app/forge/components/ForgeCardGrid";`. Remove the now-unused `Link` + `ForgeCardPreview` imports.

- [ ] **Step 3: Verify build/guardrails**

Run: `npx vitest run __tests__/forge-no-next-image.test.ts` (the new grid uses `<img>` via `ForgeCardPreview`, no `next/image`).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/forge/components/ForgeCardGrid.tsx app/forge/ideas/IdeasLibrary.tsx
git commit -m "refactor(forge): shared ForgeCardGrid for ideas + set library"
```

---

## Task 9: Studio context header + lifecycle controls

**Files:**
- Create: `app/forge/cards/[cardId]/LifecycleControls.tsx`
- Modify: `app/forge/cards/[cardId]/page.tsx` (fetch the sets the elder can share into; pass to editor)
- Modify: `app/forge/cards/[cardId]/StudioEditor.tsx` (render the header)

**Interfaces — Consumes:** `lifecycle.ts` actions; `listSets()` from `sets.ts`. **Produces:** the in-studio lifecycle UI.

- [ ] **Step 1: Build the controls component**

Create `app/forge/cards/[cardId]/LifecycleControls.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { shareToSet, sendToPrivate, publish, approve, unapprove, archive, unarchive, deleteCard } from "@/app/forge/lib/lifecycle";
import type { ForgeSetSummary } from "@/app/forge/lib/sets";
import type { ForgeCardFull } from "@/app/forge/lib/cards";

const STEPS = ["draft", "playtesting", "approved"] as const;

export default function LifecycleControls({ card, sets }: { card: ForgeCardFull; sets: ForgeSetSummary[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) alert(r.error ?? "Action failed");
      router.refresh();
    });

  const inSet = card.setId !== null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {inSet ? (
        <>
          <ol className="flex items-center gap-1 text-muted-foreground">
            {STEPS.map((s) => (
              <li key={s} className={card.status === s ? "font-semibold text-foreground" : ""}>
                {s === "playtesting" ? "Playtesting" : s[0].toUpperCase() + s.slice(1)}
                {s !== "approved" ? " ›" : ""}
              </li>
            ))}
          </ol>
          <div className="ml-auto flex flex-wrap gap-2">
            {(card.status === "draft" || card.status === "playtesting") && (
              <button disabled={pending} onClick={() => run(() => publish(card.id))} className="rounded-md bg-emerald-600 px-3 py-1 font-medium text-white disabled:opacity-50">Publish</button>
            )}
            {card.status === "playtesting" && (
              <button disabled={pending} onClick={() => run(() => approve(card.id))} className="rounded-md border px-3 py-1">Approve</button>
            )}
            {card.status === "approved" && (
              <button disabled={pending} onClick={() => run(() => unapprove(card.id))} className="rounded-md border px-3 py-1">Unapprove</button>
            )}
            {card.status === "archived" ? (
              <button disabled={pending} onClick={() => run(() => unarchive(card.id))} className="rounded-md border px-3 py-1">Unarchive</button>
            ) : (
              <button disabled={pending} onClick={() => run(() => archive(card.id))} className="rounded-md border px-3 py-1">Archive</button>
            )}
            <button disabled={pending} onClick={() => confirm("Send this card back to your private sketchbook? Its published versions will be retired.") && run(() => sendToPrivate(card.id))} className="rounded-md border px-3 py-1">Send back to private</button>
            <button disabled={pending} onClick={() => confirm("Delete this card and all its versions? This cannot be undone.") && run(() => deleteCard(card.id))} className="rounded-md border border-red-300 px-3 py-1 text-red-600">Delete</button>
          </div>
        </>
      ) : (
        <div className="ml-auto">
          {picking ? (
            <select autoFocus disabled={pending} defaultValue="" onChange={(e) => e.target.value && run(() => shareToSet(card.id, e.target.value))} className="rounded-md border bg-background px-2 py-1">
              <option value="" disabled>Share into set…</option>
              {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : (
            <button onClick={() => setPicking(true)} className="rounded-md border px-3 py-1">Share to a set</button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Fetch sets in the studio page and pass them down**

Replace `app/forge/cards/[cardId]/page.tsx` with:
```tsx
import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getCard } from "@/app/forge/lib/cards";
import { listSets } from "@/app/forge/lib/sets";
import StudioEditor from "./StudioEditor";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ cardId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { cardId } = await params;
  const card = await getCard(cardId);
  if (!card) notFound();
  const sets = card.setId === null ? await listSets() : [];
  return <StudioEditor card={card} sets={sets} />;
}
```

- [ ] **Step 3: Render the header in `StudioEditor`**

In `app/forge/cards/[cardId]/StudioEditor.tsx`: accept `sets` prop, import `LifecycleControls` + `ForgeSetSummary`, and replace the static header row (the `Private idea` pill area, lines ~33-41) with the lifecycle controls. Updated signature + header:
```tsx
import LifecycleControls from "./LifecycleControls";
import type { ForgeSetSummary } from "@/app/forge/lib/sets";
// ...
export default function StudioEditor({ card, sets }: { card: ForgeCardFull; sets: ForgeSetSummary[] }) {
  // ...existing autosave state...
  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="mb-3 flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <Link href={card.setId ? `/forge/sets/${card.setId}/cards` : "/forge/ideas"} className="text-muted-foreground hover:underline">
            ← {card.setId ? "Set" : "Ideas"}
          </Link>
          <span className="text-xs text-muted-foreground">
            {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : saved === "error" ? "Save failed" : ""}
          </span>
        </div>
        <LifecycleControls card={card} sets={sets} />
      </div>
      {/* ...existing preview + form grid unchanged... */}
```
Keep the preview/form grid below exactly as-is.

- [ ] **Step 4: Verify guardrails + typecheck**

Run: `npx vitest run __tests__/forge-gate-first.test.ts __tests__/forge-no-next-image.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/forge/cards
git commit -m "feat(forge): studio context header + lifecycle controls + share-to-set"
```

---

## Task 10: Sets index `/forge/sets`

**Files:**
- Create: `app/forge/sets/page.tsx`, `app/forge/sets/SetsIndex.tsx`

- [ ] **Step 1: Server page (gate-first)**

Create `app/forge/sets/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listSets } from "@/app/forge/lib/sets";
import SetsIndex from "./SetsIndex";

export const dynamic = "force-dynamic";

export default async function SetsPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const sets = await listSets();
  return <SetsIndex sets={sets} canCreate={ctx.role === "elder" || ctx.role === "superadmin"} />;
}
```

- [ ] **Step 2: Client index with "New set"**

Create `app/forge/sets/SetsIndex.tsx`:
```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSet, type ForgeSetSummary } from "@/app/forge/lib/sets";

export default function SetsIndex({ sets, canCreate }: { sets: ForgeSetSummary[]; canCreate: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const r = await createSet(name.trim());
    setBusy(false);
    if (r.ok) router.push(`/forge/sets/${r.id}/cards`);
    else alert(r.error);
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Sets</h1>
        {canCreate && (
          <form onSubmit={onCreate} className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New set name…" className="rounded-md border bg-background px-3 py-1.5 text-sm" />
            <button disabled={busy} className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">Create</button>
          </form>
        )}
      </div>
      {sets.length === 0 ? (
        <div className="mx-auto mt-16 max-w-xs text-center">
          <div className="mx-auto mb-4 aspect-[750/1050] w-40 rounded-lg border-2 border-dashed" />
          <p className="text-sm text-muted-foreground">No sets yet. Create one to gather cards toward print.</p>
        </div>
      ) : (
        <ul className="divide-y rounded-md border">
          {sets.map((s) => (
            <li key={s.id}>
              <Link href={`/forge/sets/${s.id}/cards`} className="flex items-center justify-between p-3 hover:bg-muted/50">
                <span className="font-medium">{s.name}</span>
                <span className="text-sm text-muted-foreground">
                  {s.total}{s.targetTotal ? ` / ${s.targetTotal}` : ""} cards
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify gate-first guardrail**

Run: `npx vitest run __tests__/forge-gate-first.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/forge/sets/page.tsx app/forge/sets/SetsIndex.tsx
git commit -m "feat(forge): sets index with create + actual/target rollup"
```

---

## Task 11: Set sub-nav layout + library `/forge/sets/[setId]/cards`

**Files:**
- Create: `app/forge/sets/[setId]/layout.tsx`, `app/forge/sets/[setId]/cards/page.tsx`

- [ ] **Step 1: Set layout (gate-first + sub-nav + 404 on unreadable set)**

Create `app/forge/sets/[setId]/layout.tsx`:
```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireForge } from "@/app/forge/lib/auth";
import { getSet } from "@/app/forge/lib/sets";

export const dynamic = "force-dynamic";

export default async function SetLayout({ children, params }: { children: React.ReactNode; params: Promise<{ setId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { setId } = await params;
  const set = await getSet(setId);
  if (!set) notFound(); // RLS hides sets the caller can't see → 404
  const tabs = [
    { href: `/forge/sets/${setId}/cards`, label: "Cards" },
    { href: `/forge/sets/${setId}/notes`, label: "Notes" },
    { href: `/forge/sets/${setId}/progress`, label: "Progress" },
  ];
  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-4">
        <Link href="/forge/sets" className="text-xs text-muted-foreground hover:underline">← Sets</Link>
        <h1 className="text-lg font-semibold">{set.name}</h1>
        <nav className="mt-2 flex gap-3 text-sm">
          {tabs.map((t) => <Link key={t.href} href={t.href} className="text-muted-foreground hover:text-foreground hover:underline">{t.label}</Link>)}
        </nav>
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Library page**

Create `app/forge/sets/[setId]/cards/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listSetCards } from "@/app/forge/lib/sets";
import ForgeCardGrid from "@/app/forge/components/ForgeCardGrid";

export const dynamic = "force-dynamic";

export default async function SetCardsPage({ params }: { params: Promise<{ setId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { setId } = await params;
  const cards = await listSetCards(setId);
  if (cards.length === 0) {
    return (
      <div className="mx-auto mt-12 max-w-xs text-center">
        <div className="mx-auto mb-4 aspect-[750/1050] w-40 rounded-lg border-2 border-dashed" />
        <p className="text-sm text-muted-foreground">No cards in this set yet. Share an idea from your sketchbook.</p>
      </div>
    );
  }
  return <ForgeCardGrid cards={cards} showStatus />;
}
```

- [ ] **Step 3: Verify gate-first**

Run: `npx vitest run __tests__/forge-gate-first.test.ts`
Expected: PASS (layout + page both call `requireForge()` first).

- [ ] **Step 4: Commit**

```bash
git add app/forge/sets/[setId]/layout.tsx app/forge/sets/[setId]/cards/page.tsx
git commit -m "feat(forge): set sub-nav + card library grid"
```

---

## Task 12: Set notes `/forge/sets/[setId]/notes`

**Files:**
- Create: `app/forge/sets/[setId]/notes/page.tsx`, `app/forge/sets/[setId]/notes/NotesEditor.tsx`

- [ ] **Step 1: Server page**

Create `app/forge/sets/[setId]/notes/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getSet } from "@/app/forge/lib/sets";
import NotesEditor from "./NotesEditor";

export const dynamic = "force-dynamic";

export default async function SetNotesPage({ params }: { params: Promise<{ setId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { setId } = await params;
  const set = await getSet(setId);
  if (!set) notFound();
  const canEdit = ctx.role === "elder" || ctx.role === "superadmin";
  return <NotesEditor setId={setId} initial={set.notes ?? ""} canEdit={canEdit} />;
}
```

- [ ] **Step 2: Autosave editor (mirrors the studio debounce)**

Create `app/forge/sets/[setId]/notes/NotesEditor.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { saveSetNotes } from "@/app/forge/lib/sets";

export default function NotesEditor({ setId, initial, canEdit }: { setId: string; initial: string; canEdit: boolean }) {
  const [notes, setNotes] = useState(initial);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaved("saving");
      const r = await saveSetNotes(setId, notes);
      setSaved(r.ok ? "saved" : "error");
    }, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [notes, setId]);

  if (!canEdit) {
    return <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-sm">{notes || "No notes yet."}</pre>;
  }
  return (
    <div>
      <div className="mb-1 text-right text-xs text-muted-foreground">
        {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : saved === "error" ? "Save failed" : ""}
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Direction, themes, open questions, decisions… (markdown)"
        className="h-[60vh] w-full rounded-md border bg-background p-4 font-mono text-sm"
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify gate-first**

Run: `npx vitest run __tests__/forge-gate-first.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/forge/sets/[setId]/notes
git commit -m "feat(forge): set-level design notes with autosave"
```

---

## Task 13: Targets editor + set-elders panel

**Files:**
- Create: `app/forge/sets/[setId]/progress/TargetsEditor.tsx`, `app/forge/sets/[setId]/progress/SetEldersPanel.tsx`

**Interfaces — Consumes:** `saveSetTargets`, `addSetElder`, `removeSetElder`, `listSetElders`, `CARD_TYPES`/`BRIGADES`. **Produces:** `<TargetsEditor>` and `<SetEldersPanel>` for Task 14's page.

- [ ] **Step 1: Targets editor**

Create `app/forge/sets/[setId]/progress/TargetsEditor.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSetTargets } from "@/app/forge/lib/sets";
import type { TargetCounts } from "@/app/forge/lib/progress";
import { CARD_TYPES } from "@/app/forge/lib/designCard";

export default function TargetsEditor({ setId, initial }: { setId: string; initial: TargetCounts }) {
  const router = useRouter();
  const [total, setTotal] = useState<number>(initial.total ?? 0);
  const [cells, setCells] = useState<Record<string, Record<string, number>>>(initial.cells ?? {});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const setCell = (type: string, brigade: string, value: number) =>
    setCells((c) => ({ ...c, [type]: { ...(c[type] ?? {}), [brigade]: value } }));

  async function save() {
    setBusy(true);
    // prune zero/NaN cells before persisting
    const pruned: Record<string, Record<string, number>> = {};
    for (const [t, row] of Object.entries(cells)) {
      for (const [b, v] of Object.entries(row)) {
        if (v > 0) (pruned[t] ??= {})[b] = v;
      }
    }
    const r = await saveSetTargets(setId, { total: total || undefined, cells: pruned });
    setBusy(false);
    if (r.ok) { setOpen(false); router.refresh(); } else alert(r.error);
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className="rounded-md border px-3 py-1 text-sm">Edit targets</button>;
  }
  return (
    <div className="rounded-md border p-3 text-sm">
      <label className="mb-2 flex items-center gap-2">
        Total target
        <input type="number" min={0} value={total} onChange={(e) => setTotal(Number(e.target.value))} className="w-24 rounded-md border bg-background px-2 py-1" />
      </label>
      <p className="mb-1 text-xs text-muted-foreground">Per-type, per-brigade targets (use the "none" column for brigade-less types):</p>
      <div className="max-h-72 overflow-auto">
        {CARD_TYPES.map((t) => (
          <details key={t} className="border-b py-1">
            <summary className="cursor-pointer">{t}</summary>
            <div className="flex flex-wrap gap-2 py-2">
              {["none", "Blue", "Clay", "GoodGold", "Green", "Purple", "Silver", "White", "Black", "Brown", "Crimson", "Gray", "Orange", "PaleGreen"].map((b) => (
                <label key={b} className="flex items-center gap-1 text-xs">
                  {b}
                  <input type="number" min={0} value={cells[t]?.[b] ?? 0} onChange={(e) => setCell(t, b, Number(e.target.value))} className="w-14 rounded border bg-background px-1 py-0.5" />
                </label>
              ))}
            </div>
          </details>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <button disabled={busy} onClick={save} className="rounded-md bg-emerald-600 px-3 py-1 font-medium text-white disabled:opacity-50">Save targets</button>
        <button onClick={() => setOpen(false)} className="rounded-md border px-3 py-1">Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Set-elders panel**

Create `app/forge/sets/[setId]/progress/SetEldersPanel.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addSetElder, removeSetElder, type SetElder } from "@/app/forge/lib/sets";

type MemberOpt = { userId: string; displayName: string | null };

export default function SetEldersPanel({ setId, elders, addable }: { setId: string; elders: SetElder[]; addable: MemberOpt[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) router.refresh(); else alert(r.error);
  };
  return (
    <div className="rounded-md border p-3 text-sm">
      <p className="mb-2 font-medium">Designers</p>
      <ul className="space-y-1">
        {elders.map((e) => (
          <li key={e.userId} className="flex items-center justify-between">
            <span>{e.displayName ?? e.userId}</span>
            {elders.length > 1 && (
              <button disabled={busy} onClick={() => run(() => removeSetElder(setId, e.userId))} className="text-xs text-red-600 hover:underline">remove</button>
            )}
          </li>
        ))}
      </ul>
      {addable.length > 0 && (
        <select disabled={busy} defaultValue="" onChange={(e) => e.target.value && run(() => addSetElder(setId, e.target.value))} className="mt-2 rounded-md border bg-background px-2 py-1 text-xs">
          <option value="" disabled>Add a designer…</option>
          {addable.map((m) => <option key={m.userId} value={m.userId}>{m.displayName ?? m.userId}</option>)}
        </select>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify no-next-image guardrail (client components, no `<Image>`)**

Run: `npx vitest run __tests__/forge-no-next-image.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/forge/sets/[setId]/progress/TargetsEditor.tsx app/forge/sets/[setId]/progress/SetEldersPanel.tsx
git commit -m "feat(forge): targets editor + lightweight set-elder management"
```

---

## Task 14: Progress dashboard `/forge/sets/[setId]/progress`

**Files:**
- Create: `app/forge/sets/[setId]/progress/page.tsx`, `app/forge/sets/[setId]/progress/ProgressDashboard.tsx`

**Interfaces — Consumes:** `computeProgress` + `ProgressModel` (Task 3), `getSet`/`listSetCards`/`listSetElders` (Task 4), `TargetsEditor`/`SetEldersPanel` (Task 13), `playtest_members` list for addable designers.

- [ ] **Step 1: Server page assembles the model + designer options**

Create `app/forge/sets/[setId]/progress/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getSet, listSetCards, listSetElders } from "@/app/forge/lib/sets";
import { computeProgress } from "@/app/forge/lib/progress";
import ProgressDashboard from "./ProgressDashboard";

export const dynamic = "force-dynamic";

export default async function SetProgressPage({ params }: { params: Promise<{ setId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { setId } = await params;
  const set = await getSet(setId);
  if (!set) notFound();
  const cards = await listSetCards(setId);
  const model = computeProgress(cards.map((c) => ({ snapshot: c.snapshot, status: c.status })), set.targetCounts);
  const canEdit = ctx.role === "elder" || ctx.role === "superadmin";

  const elders = await listSetElders(setId);
  let addable: { userId: string; displayName: string | null }[] = [];
  if (canEdit) {
    const { data: members } = await ctx.supabase.from("playtest_members").select("user_id, display_name, role").in("role", ["elder", "superadmin"]);
    const onSet = new Set(elders.map((e) => e.userId));
    addable = (members ?? []).filter((m: any) => !onSet.has(m.user_id)).map((m: any) => ({ userId: m.user_id, displayName: m.display_name ?? null }));
  }

  return <ProgressDashboard setId={setId} model={model} targets={set.targetCounts} elders={elders} addable={addable} canEdit={canEdit} />;
}
```

- [ ] **Step 2: Dashboard rendering (headline, status bar, heatmap, checklist)**

Create `app/forge/sets/[setId]/progress/ProgressDashboard.tsx`:
```tsx
"use client";

import Link from "next/link";
import type { ProgressModel, TargetCounts } from "@/app/forge/lib/progress";
import type { SetElder } from "@/app/forge/lib/sets";
import TargetsEditor from "./TargetsEditor";
import SetEldersPanel from "./SetEldersPanel";

const STATUS_ORDER = ["draft", "playtesting", "approved"];
const STATUS_COLOR: Record<string, string> = { draft: "bg-zinc-400", playtesting: "bg-amber-500", approved: "bg-emerald-600" };

function cellTone(actual: number, target: number): string {
  if (target === 0) return actual > 0 ? "bg-emerald-50 dark:bg-emerald-950" : "";
  if (actual >= target) return "bg-emerald-200 dark:bg-emerald-900";
  if (actual === 0) return "bg-muted";
  return "bg-amber-100 dark:bg-amber-950";
}

export default function ProgressDashboard({
  setId, model, targets, elders, addable, canEdit,
}: {
  setId: string; model: ProgressModel; targets: TargetCounts; elders: SetElder[];
  addable: { userId: string; displayName: string | null }[]; canEdit: boolean;
}) {
  const live = model.headline.actual;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-3xl font-semibold tabular-nums">
            {model.headline.actual}{model.headline.target ? <span className="text-muted-foreground"> / {model.headline.target}</span> : null}
            {model.headline.target ? <span className="ml-2 text-base text-muted-foreground">· {model.headline.pct}%</span> : null}
          </div>
          <p className="text-xs text-muted-foreground">cards in set</p>
        </div>
        {canEdit && <TargetsEditor setId={setId} initial={targets} />}
      </div>

      {/* status breakdown bar */}
      {live > 0 && (
        <div>
          <div className="flex h-3 overflow-hidden rounded-full border">
            {STATUS_ORDER.map((s) => {
              const n = model.byStatus[s] ?? 0;
              return n > 0 ? <div key={s} className={STATUS_COLOR[s]} style={{ width: `${(n / live) * 100}%` }} /> : null;
            })}
          </div>
          <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
            {STATUS_ORDER.map((s) => <span key={s}>{s}: {model.byStatus[s] ?? 0}</span>)}
          </div>
        </div>
      )}

      {/* brigade × card-type heatmap */}
      {model.types.length > 0 && (
        <div className="overflow-x-auto">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-background p-1 text-left">Type \ Brigade</th>
                {model.brigades.map((b) => <th key={b} className="p-1 font-normal">{b}</th>)}
              </tr>
            </thead>
            <tbody>
              {model.types.map((t) => (
                <tr key={t}>
                  <th className="sticky left-0 bg-background p-1 text-left font-normal">{t}</th>
                  {model.brigades.map((b) => {
                    const cell = model.cells.find((c) => c.type === t && c.brigade === b)!;
                    return (
                      <td key={b} className={`p-1 text-center ${cellTone(cell.actual, cell.target)}`}>
                        <Link href={`/forge/sets/${setId}/cards`} className="block tabular-nums">
                          {cell.actual}{cell.target ? `/${cell.target}` : ""}
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* what's-left checklist */}
      {model.checklist.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium">What's left</p>
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            {model.checklist.map((c) => (
              <li key={`${c.type}-${c.brigade}`}>
                {c.remaining} more {c.brigade === "none" ? "" : `${c.brigade} `}{c.type}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canEdit && <SetEldersPanel setId={setId} elders={elders} addable={addable} />}
    </div>
  );
}
```

- [ ] **Step 3: Verify guardrails**

Run: `npx vitest run __tests__/forge-gate-first.test.ts __tests__/forge-no-next-image.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/forge/sets/[setId]/progress/page.tsx app/forge/sets/[setId]/progress/ProgressDashboard.tsx
git commit -m "feat(forge): set progress dashboard (headline, status bar, heatmap, checklist)"
```

---

## Task 15: Forge desk navigation

**Files:**
- Modify: `app/forge/page.tsx`

- [ ] **Step 1: Add Ideas/Sets/Admin links to the desk**

Replace `app/forge/page.tsx`'s `<main>` body with role-aware navigation:
```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireForge } from "./lib/auth";

export const dynamic = "force-dynamic";

export default async function ForgeDeskPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const isElder = ctx.role === "elder" || ctx.role === "superadmin";
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>The Forge</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {ctx.user.email ?? ctx.user.id} · role: <span className="font-medium">{ctx.role}</span>
      </p>
      <nav className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link href="/forge/ideas" className="rounded-lg border p-4 hover:bg-muted/50">
          <div className="font-medium">Ideas</div>
          <div className="text-sm text-muted-foreground">Your private sketchbook.</div>
        </Link>
        <Link href="/forge/sets" className="rounded-lg border p-4 hover:bg-muted/50">
          <div className="font-medium">Sets</div>
          <div className="text-sm text-muted-foreground">Collective work, lifecycle & progress.</div>
        </Link>
        {ctx.role === "superadmin" && (
          <Link href="/forge/admin" className="rounded-lg border p-4 hover:bg-muted/50">
            <div className="font-medium">Admin</div>
            <div className="text-sm text-muted-foreground">Invites & roles.</div>
          </Link>
        )}
      </nav>
    </main>
  );
}
```

- [ ] **Step 2: Verify gate-first**

Run: `npx vitest run __tests__/forge-gate-first.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/forge/page.tsx
git commit -m "feat(forge): desk navigation to ideas + sets"
```

---

## Task 16: Full verification + prod migration + smoke

**Files:** none (verification + ops)

- [ ] **Step 1: Full unit suite**

Run: `npm test`
Expected: PASS, except the known pre-existing unrelated `store-route.test.ts` failure documented in the 1a.4 notes (confirm it's the only failure and it's not Forge-related).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean — all new `/forge/sets/**`, `/forge/cards/[cardId]`, and the `/forge/ideas/[cardId]` redirect compile.

- [ ] **Step 3: Security suite against the dev branch**

Run: `FORGE_LEAK_TEST=1 npm run test:security`
Expected: PASS — 8 tables show 0 anon rows; all lifecycle/set RPCs reject anon.

- [ ] **Step 4: Apply migration 052 to PROD (gated)**

STOP and get explicit user authorization. Then apply `supabase/migrations/052_forge_sets_lifecycle.sql` to prod via Supabase MCP `apply_migration`. Re-run `get_advisors` (security) on prod → no new findings.

- [ ] **Step 5: Signed-in manual smoke on the Vercel preview**

As an elder: desk → Sets → create "Smoke Set" → Ideas → jot an idea → open it → Share to a set → set library shows it as Draft → open it → Publish (status → Playtesting) → Approve (status → Approved) → Progress tab shows headline 1, status bar all-approved, the heatmap cell populated. Then Send back to private → it returns to the sketchbook. Confirm a non-member still gets 404 on `/forge/sets` and `/forge/sets/<id>/progress`.

- [ ] **Step 6: Final whole-branch review**

Use `superpowers:requesting-code-review` (opus) over the whole branch before opening the PR, matching prior slices. Address findings, then open the PR.

---

## Self-Review (completed by plan author)

**Spec coverage:** sets tables ✓ (T1), `card_versions` + pointers ✓ (T1), set-aware RLS + I1 fix ✓ (T1), leak test ✓ (T2), progress model ✓ (T3), set actions ✓ (T4), lifecycle actions ✓ (T5), card context ✓ (T6), single studio route ✓ (T7), shared grid ✓ (T8), studio lifecycle UI + share ✓ (T9), sets index ✓ (T10), library ✓ (T11), notes ✓ (T12), targets + set-elders ✓ (T13), dashboard ✓ (T14), nav ✓ (T15), verification + gated prod apply ✓ (T16). Deferred items (print/promote/realtime/playtester) correctly absent.

**Type consistency:** `ForgeCardFull` extended once (T6) and consumed by `sets.ts`/grid/lifecycle UI with the same `setId`/`publishedVersionId`/`approvedVersionId` fields. RPC names match between T1 (definitions), T2 (probes), T4/T5 (callers). `ProgressModel`/`TargetCounts` defined in T3, consumed in T13/T14. `SetElder`/`ForgeSetSummary` defined in T4, consumed in T9/T10/T13/T14.

**Placeholders:** none — every step carries real SQL/TS/TSX and exact commands.
