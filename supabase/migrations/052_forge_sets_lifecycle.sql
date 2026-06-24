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
  update public.card_versions set status = 'superseded'
   where card_id = p_card_id and status <> 'superseded';
  update public.forge_cards
     set status = 'archived', published_version_id = null, approved_version_id = null, updated_at = now()
   where id = p_card_id;
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
