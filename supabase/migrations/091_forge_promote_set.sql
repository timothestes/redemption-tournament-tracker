-- 091_forge_promote_set.sql
-- Forge "big red button": promote an entire set into the public card catalog.
-- Design: docs/superpowers/specs/2026-08-22-forge-public-set-release-design.md
--
-- Adds the release manifest tables (forge_public_releases + per-card frozen rows +
-- deck-migration backups), the staged release state machine RPCs
-- (staged -> images_done -> live_verified -> decks_migrated), the promoted-card
-- guards on existing lifecycle RPCs, and widens the 057 SELECT policy so promoted
-- cards STAY member-visible and deck-resolvable (the anti-Roots-2 clause; the code
-- half of that clause is app/forge/lib/play.ts widening its own status filter).
--
-- Catalog rows are built in TypeScript (designCardToCatalogRow) and passed in as
-- jsonb; forge_promote_set VALIDATES them against each card's approved version but
-- never constructs field values itself — reimplementing the TS serializer in
-- PL/pgSQL invites drift. Column is named set_code (not `set`): SET is reserved.
--
-- SCHEMA + FUNCTIONS ONLY — no data.

-- 1) Release manifest -----------------------------------------------------------

create table if not exists public.forge_public_releases (
  id           uuid primary key default gen_random_uuid(),
  set_id       uuid not null references public.forge_sets(id),
  set_code     text not null,               -- becomes CardData.set
  official_set text not null,               -- becomes CardData.officialSet
  status       text not null default 'staged', -- staged | images_done | live_verified | decks_migrated
  card_count   int  not null,
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Deliberately NOT unique on set_code/official_set: a set can be released in
-- waves, or re-released after an abort. Cross-release (set_code, name)
-- uniqueness is enforced in forge_promote_set.

create table if not exists public.forge_public_release_cards (
  release_id      uuid not null references public.forge_public_releases(id) on delete cascade,
  card_id         uuid not null references public.forge_cards(id),
  version_id      uuid not null references public.card_versions(id), -- the frozen source
  -- The public CardData fields, frozen at promote time (set/officialSet live on
  -- the release row and are denormalized here so a manifest row IS a catalog row):
  name            text not null,
  set_code        text not null,
  img_file        text not null,
  official_set    text not null,
  type            text not null default '',
  brigade         text not null default '',
  strength        text not null default '',
  toughness       text not null default '',
  class           text not null default '',
  identifier      text not null default '',
  special_ability text not null default '',
  rarity          text not null default '',
  reference       text not null default '',
  alignment       text not null default '',
  legality        text not null default '',
  image_transform jsonb,                                -- crop decision for §6 class-3 images (null = auto)
  image_uploaded  boolean not null default false,       -- per-card resumability
  primary key (release_id, card_id),
  unique (release_id, img_file),
  unique (release_id, name)
);

-- Pre-migration deck contents, written once per (release, deck) before the deck
-- rewrite. INSERT ... ON CONFLICT DO NOTHING so a re-run after partial failure
-- can never overwrite the true pre-migration backup.
create table if not exists public.forge_deck_migration_backups (
  release_id uuid not null references public.forge_public_releases(id) on delete cascade,
  deck_id    uuid not null references public.forge_decks(id) on delete cascade,
  cards      jsonb not null,
  created_at timestamptz not null default now(),
  primary key (release_id, deck_id)
);

-- 2) RLS: default-deny; manifest is member-read (consistency with the forge spine
--    is cheaper than a special case), backups hold member deck contents and are
--    superadmin-only. All writes go through the definer RPCs below.

alter table public.forge_public_releases      enable row level security;
alter table public.forge_public_release_cards enable row level security;
alter table public.forge_deck_migration_backups enable row level security;

drop policy if exists "forge_public_releases_select" on public.forge_public_releases;
create policy "forge_public_releases_select" on public.forge_public_releases
  for select to authenticated using (public.is_forge_member());

drop policy if exists "forge_public_release_cards_select" on public.forge_public_release_cards;
create policy "forge_public_release_cards_select" on public.forge_public_release_cards
  for select to authenticated using (public.is_forge_member());

drop policy if exists "forge_deck_migration_backups_select" on public.forge_deck_migration_backups;
create policy "forge_deck_migration_backups_select" on public.forge_deck_migration_backups
  for select to authenticated using (public.is_forge_superadmin());

revoke all on public.forge_public_releases        from anon;
revoke all on public.forge_public_release_cards   from anon;
revoke all on public.forge_deck_migration_backups from anon;
grant select on public.forge_public_releases        to authenticated;
grant select on public.forge_public_release_cards   to authenticated;
grant select on public.forge_deck_migration_backups to authenticated;

-- 3) Promote --------------------------------------------------------------------
-- One transaction: validate every payload row against the card's APPROVED version
-- (the payload cannot smuggle unapproved content), enforce cross-release identity
-- rules, insert the manifest, flip cards promoted and the set released.

create or replace function public.forge_promote_set(
  p_set_id uuid, p_set_code text, p_official_set text, p_rows jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_release_id uuid;
  v_row jsonb;
  v_card public.forge_cards%rowtype;
  v_card_id uuid; v_version_id uuid; v_name text; v_img text;
  v_count int;
begin
  if not public.is_forge_superadmin() then
    raise exception 'only a forge superadmin may promote a set';
  end if;
  if btrim(coalesce(p_set_code, '')) = '' then raise exception 'set code required'; end if;
  if length(p_set_code) > 16 then raise exception 'set code too long'; end if;
  if p_set_code ~ '\(AB\)' then
    raise exception 'set code must not match the alternate-art (AB) pattern';
  end if;
  if btrim(coalesce(p_official_set, '')) = '' then raise exception 'official set name required'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 500 then raise exception 'row count out of range'; end if;

  perform 1 from public.forge_sets where id = p_set_id for update;
  if not found then raise exception 'set not found'; end if;

  -- A set code belongs to exactly one forge set across all releases (waves reuse it).
  if exists (
    select 1 from public.forge_public_releases r
    where r.set_code = p_set_code and r.set_id <> p_set_id
  ) then
    raise exception 'set code % is already used by another released set', p_set_code;
  end if;
  -- One release in flight per set; waves start only after the previous release
  -- fully lands (or is aborted, which deletes its manifest).
  if exists (
    select 1 from public.forge_public_releases r
    where r.set_id = p_set_id and r.status <> 'decks_migrated'
  ) then
    raise exception 'a release is already in progress for this set';
  end if;

  insert into public.forge_public_releases (set_id, set_code, official_set, card_count, created_by)
  values (p_set_id, btrim(p_set_code), btrim(p_official_set), v_count, auth.uid())
  returning id into v_release_id;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_card_id    := (v_row->>'card_id')::uuid;
    v_version_id := (v_row->>'version_id')::uuid;
    v_name       := btrim(coalesce(v_row->>'name', ''));
    v_img        := btrim(coalesce(v_row->>'img_file', ''));
    if v_name = '' then raise exception 'a row is missing its card name'; end if;
    if v_img  = '' then raise exception 'row % is missing its image file', v_name; end if;

    select * into v_card from public.forge_cards where id = v_card_id for update;
    if not found then raise exception 'card % not found', v_name; end if;
    if v_card.set_id is distinct from p_set_id then
      raise exception 'card % is not in this set', v_name;
    end if;
    if v_card.status <> 'approved' then
      raise exception 'card % is not approved', v_name;
    end if;
    if v_card.approved_version_id is distinct from v_version_id then
      raise exception 'card % approved version changed — re-run preflight', v_name;
    end if;
    if exists (select 1 from public.forge_public_release_cards c where c.card_id = v_card_id) then
      raise exception 'card % is already part of a release', v_name;
    end if;
    -- Global (set_code, name) uniqueness across all prior releases (waves included).
    if exists (
      select 1 from public.forge_public_release_cards c
      where c.set_code = btrim(p_set_code) and c.name = v_name
    ) then
      raise exception 'a card named % was already released under set code %', v_name, p_set_code;
    end if;

    insert into public.forge_public_release_cards (
      release_id, card_id, version_id, name, set_code, img_file, official_set,
      type, brigade, strength, toughness, class, identifier, special_ability,
      rarity, reference, alignment, legality
    ) values (
      v_release_id, v_card_id, v_version_id, v_name, btrim(p_set_code), v_img, btrim(p_official_set),
      coalesce(v_row->>'type',''), coalesce(v_row->>'brigade',''),
      coalesce(v_row->>'strength',''), coalesce(v_row->>'toughness',''),
      coalesce(v_row->>'class',''), coalesce(v_row->>'identifier',''),
      coalesce(v_row->>'special_ability',''), coalesce(v_row->>'rarity',''),
      coalesce(v_row->>'reference',''), coalesce(v_row->>'alignment',''),
      coalesce(v_row->>'legality','')
    );

    update public.forge_cards set status = 'promoted', updated_at = now()
     where id = v_card_id;
  end loop;

  update public.forge_sets set status = 'released', updated_at = now() where id = p_set_id;

  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'set_promoted', p_set_id::text);

  return v_release_id;
end; $$;

-- 4) Abort (the amendment path, only before anything merged or verified) --------
-- Already-uploaded public blobs are deleted by the calling server action BEFORE
-- this runs (it reads image_uploaded rows to know which); this reverts the data.

create or replace function public.forge_abort_release(p_release_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_release public.forge_public_releases%rowtype;
begin
  if not public.is_forge_superadmin() then
    raise exception 'only a forge superadmin may abort a release';
  end if;
  select * into v_release from public.forge_public_releases where id = p_release_id for update;
  if not found then raise exception 'release not found'; end if;
  if v_release.status not in ('staged', 'images_done') then
    raise exception 'a % release can no longer be aborted', v_release.status;
  end if;

  update public.forge_cards set status = 'approved', updated_at = now()
   where status = 'promoted'
     and id in (select card_id from public.forge_public_release_cards where release_id = p_release_id);

  delete from public.forge_public_releases where id = p_release_id; -- cascades card rows

  -- Only revert the set when no other release still references it (waves).
  if not exists (select 1 from public.forge_public_releases r where r.set_id = v_release.set_id) then
    update public.forge_sets set status = 'open', updated_at = now()
     where id = v_release.set_id and status = 'released';
  end if;

  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'release_aborted', p_release_id::text);
end; $$;

-- 5) Image-step RPCs ------------------------------------------------------------

create or replace function public.forge_set_release_image_transform(
  p_release_id uuid, p_card_id uuid, p_transform jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_forge_superadmin() then raise exception 'not authorized'; end if;
  if p_transform is not null and jsonb_typeof(p_transform) <> 'object' then
    raise exception 'transform must be an object';
  end if;
  if p_transform is not null and octet_length(p_transform::text) > 4000 then
    raise exception 'transform too large';
  end if;
  if not exists (
    select 1 from public.forge_public_releases r
    where r.id = p_release_id and r.status = 'staged'
  ) then
    raise exception 'transforms can only change while the release is staged';
  end if;
  update public.forge_public_release_cards
     set image_transform = p_transform
   where release_id = p_release_id and card_id = p_card_id and image_uploaded = false;
  if not found then
    raise exception 'no un-uploaded manifest row for this card';
  end if;
end; $$;

-- Marks one card's public image uploaded; returns how many remain. Flips the
-- release staged -> images_done when the last one lands (idempotent re-runs safe).
create or replace function public.forge_mark_release_image_uploaded(
  p_release_id uuid, p_card_id uuid
) returns int language plpgsql security definer set search_path = '' as $$
declare v_remaining int;
begin
  if not public.is_forge_superadmin() then raise exception 'not authorized'; end if;
  perform 1 from public.forge_public_releases where id = p_release_id for update;
  if not found then raise exception 'release not found'; end if;
  update public.forge_public_release_cards
     set image_uploaded = true
   where release_id = p_release_id and card_id = p_card_id;
  if not found then raise exception 'no manifest row for this card'; end if;
  select count(*) into v_remaining
    from public.forge_public_release_cards
   where release_id = p_release_id and image_uploaded = false;
  if v_remaining = 0 then
    update public.forge_public_releases
       set status = 'images_done', updated_at = now()
     where id = p_release_id and status = 'staged';
  end if;
  return v_remaining;
end; $$;

-- 6) Verify-live ----------------------------------------------------------------
-- The truth of "the set is live" is established by the calling server action on
-- deployed code (exact name/set/imgFile match of every manifest row against its
-- own CARDS); this RPC only records the transition.

create or replace function public.forge_mark_release_live(p_release_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_forge_superadmin() then raise exception 'not authorized'; end if;
  update public.forge_public_releases
     set status = 'live_verified', updated_at = now()
   where id = p_release_id and status = 'images_done';
  if not found then
    raise exception 'release is not in the images_done state';
  end if;
end; $$;

-- 7) Deck migration -------------------------------------------------------------
-- Rewrite {source:'forge', cardId} entries whose card is in this release's
-- manifest to {source:'public', name, set} (Roots 2 rebuild semantics, in code).
-- Post-conversion duplicates merge by summing qty keyed on (name, set, zone) —
-- zone-scoped, or a main-deck copy and a reserve copy would wrongly collapse.
-- Forge entries for other sets keep their position untouched. Idempotent:
-- already-migrated decks contain no matching forge refs.

create or replace function public.forge_count_release_decks(p_release_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.forge_decks d
  where exists (
    select 1 from jsonb_array_elements(d.cards) e
    where e.value->>'source' = 'forge'
      and (e.value->>'cardId') in (
        select c.card_id::text from public.forge_public_release_cards c
        where c.release_id = p_release_id
      )
  );
$$;

create or replace function public.forge_migrate_release_decks(p_release_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_release public.forge_public_releases%rowtype;
  v_deck record;
  v_new jsonb;
  v_migrated int := 0;
begin
  if not public.is_forge_superadmin() then raise exception 'not authorized'; end if;
  select * into v_release from public.forge_public_releases where id = p_release_id for update;
  if not found then raise exception 'release not found'; end if;
  if v_release.status not in ('live_verified', 'decks_migrated') then
    raise exception 'decks can only migrate after the release is verified live';
  end if;

  for v_deck in
    select d.id, d.cards from public.forge_decks d
    where exists (
      select 1 from jsonb_array_elements(d.cards) e
      where e.value->>'source' = 'forge'
        and (e.value->>'cardId') in (
          select c.card_id::text from public.forge_public_release_cards c
          where c.release_id = p_release_id
        )
    )
    for update of d
  loop
    insert into public.forge_deck_migration_backups (release_id, deck_id, cards)
    values (p_release_id, v_deck.id, v_deck.cards)
    on conflict do nothing;

    with elems as (
      select e.value as v, e.ordinality as ord
      from jsonb_array_elements(v_deck.cards) with ordinality e
    ),
    converted as (
      select
        case when e.v->>'source' = 'forge' and m.card_id is not null
          then jsonb_build_object(
                 'source', 'public', 'name', m.name, 'set', m.set_code,
                 'qty', e.v->'qty', 'zone', e.v->>'zone')
          else e.v
        end as v,
        e.ord
      from elems e
      left join public.forge_public_release_cards m
        on m.release_id = p_release_id
       and e.v->>'source' = 'forge'
       and e.v->>'cardId' = m.card_id::text
    ),
    keyed as (
      select v, ord,
        case when v->>'source' = 'public'
          then 'p|' || (v->>'name') || '|' || (v->>'set') || '|' || coalesce(v->>'zone', '')
          else 'x|' || ord::text
        end as k
      from converted
    ),
    merged as (
      select min(ord) as first_ord,
             (array_agg(v order by ord))[1] as base,
             sum(coalesce((v->>'qty')::int, 0)) as total_qty,
             count(*) as n
      from keyed
      group by k
    )
    select coalesce(jsonb_agg(
             case when n > 1 then jsonb_set(base, '{qty}', to_jsonb(total_qty)) else base end
             order by first_ord), '[]'::jsonb)
      into v_new
      from merged;

    update public.forge_decks set cards = v_new, updated_at = now() where id = v_deck.id;
    v_migrated := v_migrated + 1;
  end loop;

  update public.forge_public_releases
     set status = 'decks_migrated', updated_at = now()
   where id = p_release_id;

  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'release_decks_migrated', p_release_id::text);

  return v_migrated;
end; $$;

-- 8) Promoted-card / released-set guards on existing RPCs -----------------------
-- Promoted cards are frozen history: no edits, no lifecycle moves, no deletion.
-- (forge_publish_card, forge_approve_card, forge_unapprove_card, forge_archive_card
-- and forge_create_proposal already reject 'promoted' via their status guards.)

-- Body = 052 verbatim + the promoted guard.
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
  if exists (select 1 from public.forge_cards c where c.id = p_card_id and c.status = 'promoted') then
    raise exception 'a promoted card is read-only';
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

-- Body = 075 verbatim + the promoted guard.
create or replace function public.forge_send_card_to_private(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if v_card.set_id is null then raise exception 'card is not in a set'; end if;
  if v_card.status = 'promoted' then raise exception 'a promoted card is read-only'; end if;
  if not (v_card.owner_id = auth.uid() or public.is_forge_superadmin()
          or public.is_forge_set_elder(v_card.set_id)) then
    raise exception 'not authorized';
  end if;
  update public.card_versions set status = 'superseded'
   where card_id = p_card_id and status in ('published','approved');
  update public.forge_cards
     set set_id = null, status = 'private_idea',
         published_version_id = null, approved_version_id = null, updated_at = now()
   where id = p_card_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_returned_to_ideas', p_card_id::text);
end; $$;

-- Body = 052 verbatim + the promoted guard (the manifest FK would also block
-- the delete, but this reads as intent instead of a constraint violation).
create or replace function public.forge_delete_card(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if v_card.status = 'promoted' then raise exception 'a promoted card is read-only'; end if;
  if not (v_card.owner_id = auth.uid() or public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to delete this card';
  end if;
  delete from public.forge_cards where id = p_card_id;  -- cascades card_versions
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_deleted', p_card_id::text);
end; $$;

-- Body = 052 verbatim + released-set guard: a released set takes no new cards
-- (wave releases cover cards already in the set).
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
  if exists (select 1 from public.forge_sets s where s.id = p_set_id and s.status = 'released') then
    raise exception 'this set has been released and takes no new cards';
  end if;
  update public.forge_cards set set_id = p_set_id, status = 'draft', updated_at = now()
   where id = p_card_id;
end; $$;

-- Body = 065 verbatim + released-set guard.
create or replace function public.forge_create_card_in_set(p_title text, p_set_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not (public.is_forge_set_elder(p_set_id) or public.is_forge_superadmin()) then
    raise exception 'not a designer on the target set';
  end if;
  if exists (select 1 from public.forge_sets s where s.id = p_set_id and s.status = 'released') then
    raise exception 'this set has been released and takes no new cards';
  end if;
  insert into public.forge_cards (owner_id, title, set_id, status)
  values (auth.uid(), nullif(btrim(p_title), ''), p_set_id, 'draft')
  returning id into v_id;
  return v_id;
end; $$;

-- Body = 063 verbatim + released-set guard (the manifest FKs would break the
-- cascade anyway; fail with intent up front).
create or replace function public.forge_delete_set(p_set_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not (public.is_forge_superadmin() or public.is_forge_set_elder(p_set_id)) then
    raise exception 'not authorized to delete this set';
  end if;

  perform 1 from public.forge_sets where id = p_set_id for update;
  if not found then
    raise exception 'set not found';
  end if;
  if exists (select 1 from public.forge_sets s where s.id = p_set_id and s.status = 'released') then
    raise exception 'a released set cannot be deleted';
  end if;

  for r in select id from public.forge_cards where set_id = p_set_id loop
    perform public.forge_delete_card(r.id);
  end loop;

  delete from public.forge_set_grants where set_id = p_set_id;
  delete from public.forge_set_elders where set_id = p_set_id;

  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'set_deleted', p_set_id::text);

  delete from public.forge_sets where id = p_set_id;
end;
$$;

-- 9) Anti-Roots-2, RLS half: promoted cards stay visible to granted playtesters
--    (their decks keep resolving until migration). Body = 057 verbatim with
--    'promoted' added to the granted branch. The 057 card_versions policy needs
--    no change: a promoted card's approved version keeps status 'approved'.
drop policy if exists "forge_cards_select" on public.forge_cards;
create policy "forge_cards_select" on public.forge_cards
  for select to authenticated
  using (owner_id = auth.uid()
         or public.is_forge_superadmin()
         or (set_id is not null and public.is_forge_set_elder(set_id))
         or (set_id is not null
             and status in ('playtesting','approved','promoted')
             and public.is_forge_set_granted(set_id)));

-- 10) Lock down EXECUTE on every new function (anon stripped explicitly; cf. 048)
revoke execute on function public.forge_promote_set(uuid, text, text, jsonb) from public, anon;
revoke execute on function public.forge_abort_release(uuid) from public, anon;
revoke execute on function public.forge_set_release_image_transform(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.forge_mark_release_image_uploaded(uuid, uuid) from public, anon;
revoke execute on function public.forge_mark_release_live(uuid) from public, anon;
revoke execute on function public.forge_count_release_decks(uuid) from public, anon;
revoke execute on function public.forge_migrate_release_decks(uuid) from public, anon;

grant execute on function public.forge_promote_set(uuid, text, text, jsonb) to authenticated;
grant execute on function public.forge_abort_release(uuid) to authenticated;
grant execute on function public.forge_set_release_image_transform(uuid, uuid, jsonb) to authenticated;
grant execute on function public.forge_mark_release_image_uploaded(uuid, uuid) to authenticated;
grant execute on function public.forge_mark_release_live(uuid) to authenticated;
grant execute on function public.forge_count_release_decks(uuid) to authenticated;
grant execute on function public.forge_migrate_release_decks(uuid) to authenticated;
