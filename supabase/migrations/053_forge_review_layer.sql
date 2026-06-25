-- 053_forge_review_layer.sql
-- Forge phase 1b.1: the review layer — proposals + comments/suggestions.
-- Adds card_proposals + card_comments (default-deny RLS, definer-RPC-only writes),
-- the _forge_can_read_card read guard (elder-only; NO granted/Phase-2 branch),
-- a raw-DesignCard-key allowlist helper, and the proposal/comment RPCs.
-- Realtime is NOT enabled here (1b.1 is refetch-only; private-channel Realtime is 1b.2).
-- Builds on 052 (card_versions, set-aware RLS, publish/approve RPCs, helpers).
-- SCHEMA + FUNCTIONS ONLY — no card data.

-- 1) proposal-status enum
do $$ begin
  create type public.proposal_status as enum ('open','accepted','denied','superseded');
exception when duplicate_object then null; end $$;

-- 2) Proposals ("pull request": a candidate change frozen for sign-off)
create table if not exists public.card_proposals (
  id                   uuid primary key default gen_random_uuid(),
  card_id              uuid not null references public.forge_cards(id) on delete cascade,
  base_version_id      uuid references public.card_versions(id),
  proposed_snapshot    jsonb not null,
  proposed_art_key     text,                 -- reserved; unused in 1b.1
  summary              text,
  status               public.proposal_status not null default 'open',
  resulting_version_id uuid references public.card_versions(id),
  created_by           uuid not null references auth.users(id),
  created_at           timestamptz not null default now(),
  closed_at            timestamptz,
  closed_by            uuid references auth.users(id)
);
create index if not exists card_proposals_card_idx on public.card_proposals(card_id);
create index if not exists card_proposals_open_idx on public.card_proposals(card_id) where status = 'open';

-- 3) Comments (threaded; card-level discussion OR field-anchored suggestion OR proposal-level)
create table if not exists public.card_comments (
  id                uuid primary key default gen_random_uuid(),
  card_id           uuid not null references public.forge_cards(id) on delete cascade,
  proposal_id       uuid references public.card_proposals(id) on delete cascade,
  field             text,
  suggested_value   jsonb,
  parent_comment_id uuid references public.card_comments(id) on delete cascade,
  body              text not null,
  resolved          boolean not null default false,
  created_by        uuid not null references auth.users(id),
  created_at        timestamptz not null default now()
);
create index if not exists card_comments_card_idx     on public.card_comments(card_id);
create index if not exists card_comments_proposal_idx on public.card_comments(proposal_id);

-- 4) Read guard — owner / set-elder / superadmin. NO granted (Phase-2) branch:
--    proposals/comments are an elder-only collaboration surface.
create or replace function public._forge_can_read_card(p_card_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid()
           or public.is_forge_superadmin()
           or (c.set_id is not null and public.is_forge_set_elder(c.set_id)))
  );
$$;

-- 4b) Raw-DesignCard-key allowlist. MUST mirror the DesignCard type keys in
--     app/forge/lib/designCard.ts (NOT the synthetic FieldKey union).
create or replace function public._forge_is_card_field(p_field text)
returns boolean language sql immutable security definer set search_path = '' as $$
  select p_field = any (array[
    'name','cardType','alignment','brigades','strength','toughness',
    'strengthModifier','toughnessModifier','class','icons','identifiers',
    'specialAbility','reference','legality','rarity','flavorText','artistCredit','cardFrame'
  ]);
$$;

-- 5) RLS (select-only; all writes via definer RPCs)
alter table public.card_proposals enable row level security;
alter table public.card_comments  enable row level security;

drop policy if exists "card_proposals_select" on public.card_proposals;
create policy "card_proposals_select" on public.card_proposals
  for select to authenticated
  using (public._forge_can_read_card(card_proposals.card_id));

drop policy if exists "card_comments_select" on public.card_comments;
create policy "card_comments_select" on public.card_comments
  for select to authenticated
  using (public._forge_can_read_card(card_comments.card_id));

revoke all on public.card_proposals from anon;
revoke all on public.card_comments  from anon;
grant select on public.card_proposals to authenticated;
grant select on public.card_comments  to authenticated;

-- 6) RPCs

-- Create a proposal: freeze the supplied snapshot against the card's current
-- published version. Caller must be able to read the card; card must be in a set
-- and in the active design loop (draft/playtesting).
create or replace function public.forge_create_proposal(p_card_id uuid, p_snapshot jsonb, p_summary text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype; v_id uuid;
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
  insert into public.card_proposals (card_id, base_version_id, proposed_snapshot, summary, created_by)
  values (p_card_id, v_card.published_version_id, p_snapshot, btrim(p_summary), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- Accept (single-elder, N=1): publish the proposed snapshot as a new immutable
-- version, sync the working draft, advance status, close siblings. Returns the new
-- version id, or NULL if the base is stale (out of date — re-propose).
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
    (card_id, version_number, status, data, art_key, art_is_placeholder, art_original_key, created_by)
  values
    (v_card.id, v_next, 'published', v_prop.proposed_snapshot,
     v_card.working_art_key, v_card.working_art_is_placeholder, v_card.working_art_original_key, auth.uid())
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

-- Deny: requires a reason; closes denied; records the reason as a proposal comment.
create or replace function public.forge_deny_proposal(p_proposal_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_prop public.card_proposals%rowtype; v_card public.forge_cards%rowtype;
begin
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'a reason is required to deny'; end if;
  select * into v_prop from public.card_proposals where id = p_proposal_id for update;
  if not found then raise exception 'proposal not found'; end if;
  if v_prop.status <> 'open' then raise exception 'proposal is not open'; end if;
  select * into v_card from public.forge_cards where id = v_prop.card_id;
  if not (public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to deny proposals on this card';
  end if;
  update public.card_proposals
     set status = 'denied', closed_at = now(), closed_by = auth.uid()
   where id = p_proposal_id;
  insert into public.card_comments (card_id, proposal_id, body, created_by)
  values (v_prop.card_id, p_proposal_id, btrim(p_reason), auth.uid());
end; $$;

-- Add a comment / field-anchored suggestion. Caller must be able to read the card.
create or replace function public.forge_add_comment(
  p_card_id uuid, p_proposal_id uuid, p_parent_id uuid,
  p_field text, p_suggested_value jsonb, p_body text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public._forge_can_read_card(p_card_id) then
    raise exception 'not authorized to comment on this card';
  end if;
  if btrim(coalesce(p_body,'')) = '' then raise exception 'a comment body is required'; end if;
  if octet_length(p_body) > 8000 then raise exception 'comment too long'; end if;
  if p_suggested_value is not null and octet_length(p_suggested_value::text) > 8000 then
    raise exception 'suggested value too large';
  end if;
  if p_field is not null and not public._forge_is_card_field(p_field) then
    raise exception 'unknown card field';
  end if;
  insert into public.card_comments
    (card_id, proposal_id, parent_comment_id, field, suggested_value, body, created_by)
  values
    (p_card_id, p_proposal_id, p_parent_id, p_field, p_suggested_value, btrim(p_body), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- Resolve/unresolve a comment. Author, or set-elder/super of the card.
create or replace function public.forge_resolve_comment(p_comment_id uuid, p_resolved boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.card_comments%rowtype; v_card public.forge_cards%rowtype;
begin
  select * into v_c from public.card_comments where id = p_comment_id;
  if not found then raise exception 'comment not found'; end if;
  select * into v_card from public.forge_cards where id = v_c.card_id;
  if not (v_c.created_by = auth.uid() or public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized';
  end if;
  update public.card_comments set resolved = coalesce(p_resolved, false) where id = p_comment_id;
end; $$;

-- Apply a field-anchored suggestion to the working draft. Owner/set-elder/super.
create or replace function public.forge_apply_suggestion(p_comment_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_c public.card_comments%rowtype; v_card public.forge_cards%rowtype;
        v_new jsonb; v_updated timestamptz;
begin
  select * into v_c from public.card_comments where id = p_comment_id;
  if not found then raise exception 'comment not found'; end if;
  if v_c.field is null or v_c.suggested_value is null then
    raise exception 'this comment is not an applyable suggestion';
  end if;
  if not public._forge_is_card_field(v_c.field) then raise exception 'unknown card field'; end if;
  select * into v_card from public.forge_cards where id = v_c.card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (v_card.owner_id = auth.uid() or public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to edit this card';
  end if;
  v_new := jsonb_set(coalesce(v_card.working_snapshot, '{}'::jsonb), array[v_c.field], v_c.suggested_value, true);
  if octet_length(v_new::text) > 64000 then raise exception 'snapshot too large'; end if;
  update public.forge_cards
     set working_snapshot = v_new,
         title = nullif(btrim(coalesce(v_new->>'name','')), ''),
         updated_at = now()
   where id = v_card.id
  returning updated_at into v_updated;
  update public.card_comments set resolved = true where id = p_comment_id;
  return v_updated;
end; $$;

-- Delete a comment (cascade removes replies). Author, or set-elder/super.
create or replace function public.forge_delete_comment(p_comment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.card_comments%rowtype; v_card public.forge_cards%rowtype;
begin
  select * into v_c from public.card_comments where id = p_comment_id;
  if not found then raise exception 'comment not found'; end if;
  select * into v_card from public.forge_cards where id = v_c.card_id;
  if not (v_c.created_by = auth.uid() or public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized';
  end if;
  delete from public.card_comments where id = p_comment_id;
end; $$;

-- 7) Lock down EXECUTE (anon stripped explicitly; cf. 048/052)
revoke execute on function public._forge_can_read_card(uuid) from public, anon;
revoke execute on function public._forge_is_card_field(text) from public, anon;
revoke execute on function public.forge_create_proposal(uuid, jsonb, text) from public, anon;
revoke execute on function public.forge_accept_proposal(uuid) from public, anon;
revoke execute on function public.forge_deny_proposal(uuid, text) from public, anon;
revoke execute on function public.forge_add_comment(uuid, uuid, uuid, text, jsonb, text) from public, anon;
revoke execute on function public.forge_resolve_comment(uuid, boolean) from public, anon;
revoke execute on function public.forge_apply_suggestion(uuid) from public, anon;
revoke execute on function public.forge_delete_comment(uuid) from public, anon;

grant execute on function public._forge_can_read_card(uuid) to authenticated;
grant execute on function public._forge_is_card_field(text) to authenticated;
grant execute on function public.forge_create_proposal(uuid, jsonb, text) to authenticated;
grant execute on function public.forge_accept_proposal(uuid) to authenticated;
grant execute on function public.forge_deny_proposal(uuid, text) to authenticated;
grant execute on function public.forge_add_comment(uuid, uuid, uuid, text, jsonb, text) to authenticated;
grant execute on function public.forge_resolve_comment(uuid, boolean) to authenticated;
grant execute on function public.forge_apply_suggestion(uuid) to authenticated;
grant execute on function public.forge_delete_comment(uuid) to authenticated;
