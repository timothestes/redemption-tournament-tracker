-- 061_forge_finished_card.sql
-- Forge descope (2026-07-03): a card is raw text + artwork + an optional
-- FINISHED-CARD image. Adds a second private-blob slot mirroring the art pipeline
-- (050/052), frozen into card_versions at BOTH version writers (publish + accept).
-- Single key: finished images are never processed and have no placeholder concept.

-- 1) Columns (idempotent).
alter table public.forge_cards   add column if not exists working_finished_key text;
alter table public.card_versions add column if not exists finished_key         text;

-- 2) Set the current draft finished-card image. Owner / set-elder / superadmin only
--    (copies the 052-tightened forge_set_working_art gate — NOT the 050 gate).
create or replace function public.forge_set_working_finished(
  p_card_id uuid, p_key text
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
     set working_finished_key = p_key, updated_at = now()
   where id = p_card_id;
end; $$;

revoke execute on function public.forge_set_working_finished(uuid, text) from public, anon;
grant  execute on function public.forge_set_working_finished(uuid, text) to authenticated;

-- 3) Freeze finished_key at publish (verbatim copy of the 052 body + finished_key).
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
    (card_id, version_number, status, data, art_key, art_is_placeholder, art_original_key, finished_key, created_by)
  values
    (p_card_id, v_next, 'published', v_card.working_snapshot,
     v_card.working_art_key, v_card.working_art_is_placeholder, v_card.working_art_original_key,
     v_card.working_finished_key, auth.uid())
  returning id into v_version_id;
  update public.forge_cards
     set published_version_id = v_version_id, status = 'playtesting', updated_at = now()
   where id = p_card_id;
  return v_version_id;
end; $$;

-- 4) Freeze finished_key at review-accept (verbatim copy of the 053 body + finished_key).
create or replace function public.forge_accept_proposal(p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_prop public.card_proposals%rowtype; v_card public.forge_cards%rowtype;
        v_next int; v_version_id uuid;
begin
  -- initial read to learn the card_id
  select * into v_prop from public.card_proposals where id = p_proposal_id;
  if not found then raise exception 'proposal not found'; end if;
  -- lock the card first, then re-read+lock the proposal under that lock
  select * into v_card from public.forge_cards where id = v_prop.card_id for update;
  if not found then raise exception 'card not found'; end if;
  select * into v_prop from public.card_proposals where id = p_proposal_id for update;
  if v_prop.status <> 'open' then raise exception 'proposal is not open'; end if;
  if not (public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to accept proposals on this card';
  end if;
  if v_card.status not in ('draft','playtesting') then
    raise exception 'unapprove or unarchive this card before accepting changes';
  end if;
  -- stale-base guard (NULL-aware). DO NOT raise — a raise would roll back this update.
  if v_prop.base_version_id is distinct from v_card.published_version_id then
    update public.card_proposals
       set status = 'superseded', closed_at = now(), closed_by = auth.uid()
     where id = p_proposal_id;
    return null;
  end if;
  -- freeze a new published version from the proposed snapshot
  select coalesce(max(version_number), 0) + 1 into v_next
    from public.card_versions where card_id = v_card.id;
  update public.card_versions set status = 'superseded'
    where card_id = v_card.id and status = 'published';
  insert into public.card_versions
    (card_id, version_number, status, data, art_key, art_is_placeholder, art_original_key, finished_key, created_by)
  values
    (v_card.id, v_next, 'published', v_prop.proposed_snapshot,
     v_card.working_art_key, v_card.working_art_is_placeholder, v_card.working_art_original_key,
     v_card.working_finished_key, auth.uid())
  returning id into v_version_id;
  -- point the card at it, sync the working draft + title, advance status
  update public.forge_cards
     set published_version_id = v_version_id,
         working_snapshot = v_prop.proposed_snapshot,
         title = nullif(btrim(coalesce(v_prop.proposed_snapshot->>'name','')), ''),
         status = 'playtesting',
         updated_at = now()
   where id = v_card.id;
  -- close this proposal accepted; supersede sibling open proposals
  update public.card_proposals
     set status = 'accepted', resulting_version_id = v_version_id, closed_at = now(), closed_by = auth.uid()
   where id = p_proposal_id;
  update public.card_proposals
     set status = 'superseded', closed_at = now(), closed_by = auth.uid()
   where card_id = v_card.id and status = 'open' and id <> p_proposal_id;
  return v_version_id;
end; $$;
