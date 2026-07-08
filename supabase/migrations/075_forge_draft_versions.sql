-- 075: draft-card iterations become real, elder-only version records.
-- Fixes 073, which folded draft accepts into the working draft WITHOUT minting
-- a version — erasing the iteration history exactly where cards iterate most.
--
-- (a) forge_accept_proposal: the draft branch now mints a card_versions row
--     with status='draft' (invisible to playtesters via 057's whitelist),
--     sets resulting_version_id, and returns the version id (the card-id
--     sentinel from 073 dies; contract: uuid = resulting version, null =
--     stale base). The staleness guard now compares against the card's
--     LATEST version row of any status, so sequential draft rounds are
--     genuinely guarded.
-- (b) forge_create_proposal: base_version_id = the latest version row of any
--     status (was published_version_id). HARD COUPLING with (a): both must
--     use the same base or draft-phase accepts loop "out of date" forever.
--     For playtesting cards the two are provably identical (the published
--     row is always the highest-numbered), so that path is unchanged.
-- (c)/(d) archive + return-to-ideas: supersede only ('published','approved')
--     rows. That sweep exists purely to hide rows from playtesters; draft
--     rows are already hidden, and flipping them would permanently destroy
--     the iteration/release distinction. Positive list on purpose.
-- forge_publish_card is untouched: it supersedes only 'published' rows, so
-- draft rows stay 'draft' forever — immutable pre-release history.
-- All signatures unchanged -> CREATE OR REPLACE preserves existing grants.

-- (a) accept
create or replace function public.forge_accept_proposal(p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_prop public.card_proposals%rowtype; v_card public.forge_cards%rowtype;
        v_latest uuid; v_next int; v_version_id uuid;
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
  -- stale-base guard vs the LATEST version of any status (NULL-aware).
  -- DO NOT raise — a raise would roll back this update.
  select id into v_latest from public.card_versions
   where card_id = v_card.id
   order by version_number desc limit 1;
  if v_prop.base_version_id is distinct from v_latest then
    update public.card_proposals
       set status = 'superseded', closed_at = now(), closed_by = auth.uid()
     where id = p_proposal_id;
    return null;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
    from public.card_versions where card_id = v_card.id;

  if v_card.status = 'draft' then
    -- Draft: record the iteration as an elder-only 'draft' version and fold
    -- it into the working draft. No supersede (nothing published exists; and
    -- prior draft rows keep their label), no pointer changes, no release.
    insert into public.card_versions
      (card_id, version_number, status, data, art_key, art_is_placeholder, art_original_key, finished_key, created_by)
    values
      (v_card.id, v_next, 'draft', v_prop.proposed_snapshot,
       v_card.working_art_key, v_card.working_art_is_placeholder, v_card.working_art_original_key,
       v_card.working_finished_key, auth.uid())
    returning id into v_version_id;
    update public.forge_cards
       set working_snapshot = v_prop.proposed_snapshot,
           title = nullif(btrim(coalesce(v_prop.proposed_snapshot->>'name','')), ''),
           updated_at = now()
     where id = v_card.id;
    update public.card_proposals
       set status = 'accepted', resulting_version_id = v_version_id, closed_at = now(), closed_by = auth.uid()
     where id = p_proposal_id;
    update public.card_proposals
       set status = 'superseded', closed_at = now(), closed_by = auth.uid()
     where card_id = v_card.id and status = 'open' and id <> p_proposal_id;
    return v_version_id;
  end if;

  -- Playtesting: freeze a new published version from the proposed snapshot
  update public.card_versions set status = 'superseded'
    where card_id = v_card.id and status = 'published';
  insert into public.card_versions
    (card_id, version_number, status, data, art_key, art_is_placeholder, art_original_key, finished_key, created_by)
  values
    (v_card.id, v_next, 'published', v_prop.proposed_snapshot,
     v_card.working_art_key, v_card.working_art_is_placeholder, v_card.working_art_original_key,
     v_card.working_finished_key, auth.uid())
  returning id into v_version_id;
  update public.forge_cards
     set published_version_id = v_version_id,
         working_snapshot = v_prop.proposed_snapshot,
         title = nullif(btrim(coalesce(v_prop.proposed_snapshot->>'name','')), ''),
         status = 'playtesting',
         updated_at = now()
   where id = v_card.id;
  update public.card_proposals
     set status = 'accepted', resulting_version_id = v_version_id, closed_at = now(), closed_by = auth.uid()
   where id = p_proposal_id;
  update public.card_proposals
     set status = 'superseded', closed_at = now(), closed_by = auth.uid()
   where card_id = v_card.id and status = 'open' and id <> p_proposal_id;
  return v_version_id;
end; $$;

-- (b) create: base = latest version row of ANY status (draft iterations
-- included), so round-2 draft proposals diff against — and are staleness-
-- checked against — the last accepted iteration. Body = 053 verbatim
-- otherwise.
create or replace function public.forge_create_proposal(p_card_id uuid, p_snapshot jsonb, p_summary text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype; v_base uuid; v_id uuid;
begin
  if not public._forge_can_read_card(p_card_id) then
    raise exception 'not authorized to propose on this card';
  end if;
  if btrim(coalesce(p_summary,'')) = '' then raise exception 'a summary is required'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'snapshot must be an object';
  end if;
  if octet_length(p_snapshot::text) > 64000 then raise exception 'snapshot too large'; end if;
  select * into v_card from public.forge_cards where id = p_card_id for share;
  if not found then raise exception 'card not found'; end if;
  if v_card.set_id is null then raise exception 'only cards in a set can have proposals'; end if;
  if v_card.status not in ('draft','playtesting') then
    raise exception 'proposals are only for draft or playtesting cards';
  end if;
  select id into v_base from public.card_versions
   where card_id = p_card_id
   order by version_number desc limit 1;
  insert into public.card_proposals (card_id, base_version_id, proposed_snapshot, summary, created_by)
  values (p_card_id, v_base, p_snapshot, btrim(p_summary), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- (c) archive: sweep only playtester-visible rows (body = 072 verbatim
-- otherwise). Draft rows keep their label.
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
   where card_id = p_card_id and status in ('published','approved');
  update public.forge_cards
     set status = 'archived', published_version_id = null, approved_version_id = null, updated_at = now()
   where id = p_card_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_archived', p_card_id::text);
end; $$;

-- (d) return to ideas: same sweep change (body = 072 verbatim otherwise).
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
   where card_id = p_card_id and status in ('published','approved');
  update public.forge_cards
     set set_id = null, status = 'private_idea',
         published_version_id = null, approved_version_id = null, updated_at = now()
   where id = p_card_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_returned_to_ideas', p_card_id::text);
end; $$;
