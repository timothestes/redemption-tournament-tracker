-- 072: Forge version history — version notes, lifecycle audit events,
-- undeletable proposal reasons.
-- (1) card_versions.note: the "why" of a release, stamped atomically.
-- (2) forge_publish_card gains p_note. SIGNATURE CHANGE: the old 1-arg
--     function must be DROPPED first — CREATE OR REPLACE would create an
--     overload and PostgREST rpc() calls would fail with PGRST203 ambiguity.
--     Dropping loses grants: re-revoke/re-grant explicitly (cf. 048/052).
-- (3) Five lifecycle RPCs gain a one-line forge_audit insert (pattern:
--     forge_delete_card in 052) — approve/unapprove/archive/unarchive/return
--     flip or destroy state that is otherwise unrecoverable.
-- (4) forge_delete_comment refuses proposal-anchored comments: deny reasons
--     and accept notes are records, not chatter.

-- 1) Version note column
alter table public.card_versions add column if not exists note text;

-- 2) forge_publish_card with p_note (body = 061 verbatim + note)
drop function if exists public.forge_publish_card(uuid);

create or replace function public.forge_publish_card(p_card_id uuid, p_note text default null)
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
    (card_id, version_number, status, data, art_key, art_is_placeholder, art_original_key, finished_key, created_by, note)
  values
    (p_card_id, v_next, 'published', v_card.working_snapshot,
     v_card.working_art_key, v_card.working_art_is_placeholder, v_card.working_art_original_key,
     v_card.working_finished_key, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_version_id;
  update public.forge_cards
     set published_version_id = v_version_id, status = 'playtesting', updated_at = now()
   where id = p_card_id;
  return v_version_id;
end; $$;

revoke execute on function public.forge_publish_card(uuid, text) from public, anon;
grant execute on function public.forge_publish_card(uuid, text) to authenticated;

-- 3) Lifecycle audit events (bodies = 052 verbatim + one insert each;
--    same signatures, so CREATE OR REPLACE preserves existing grants)

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
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_approved', p_card_id::text);
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
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_unapproved', p_card_id::text);
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
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_archived', p_card_id::text);
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
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_unarchived', p_card_id::text);
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
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_returned_to_ideas', p_card_id::text);
end; $$;

-- 4) Proposal-anchored comments are records of decisions — not deletable
--    (body = 053 verbatim + the proposal_id guard)
create or replace function public.forge_delete_comment(p_comment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.card_comments%rowtype; v_card public.forge_cards%rowtype;
begin
  select * into v_c from public.card_comments where id = p_comment_id;
  if not found then raise exception 'comment not found'; end if;
  if v_c.proposal_id is not null then
    raise exception 'comments attached to a proposal are part of its history and cannot be deleted';
  end if;
  select * into v_card from public.forge_cards where id = v_c.card_id;
  if not (v_c.created_by = auth.uid() or public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized';
  end if;
  delete from public.card_comments where id = p_comment_id;
end; $$;
