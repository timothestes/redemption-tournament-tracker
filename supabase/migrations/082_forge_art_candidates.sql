-- 082_forge_art_candidates.sql
-- Multi-image art candidates for the card studio (spec:
-- docs/superpowers/specs/2026-07-26-forge-art-candidates-crop-design.md).
-- A candidate is one uploaded image in a card's designer-side gallery; the
-- active artwork stays on forge_cards (working_art_key = crop derivative,
-- working_art_original_key = source candidate's key). ADDITIVE ONLY — new
-- table + new functions; nothing existing is redefined (cf. 066 lesson).

-- 1) Candidates. Keys are private-blob PATHNAMES (forge-art/<uuid>), never URLs.
create table if not exists public.forge_card_art_candidates (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references public.forge_cards(id) on delete cascade,
  key        text not null,
  created_at timestamptz not null default now()
);

create index if not exists forge_card_art_candidates_card_idx
  on public.forge_card_art_candidates (card_id, created_at);

alter table public.forge_card_art_candidates enable row level security;

-- 2) RLS: candidates are a DESIGNER workspace — owner or elder/superadmin only
--    (playtesters never see them; the active art they do see lives on
--    forge_cards). No direct write policy — writes go through the SECURITY
--    DEFINER RPCs below (cf. 050).
drop policy if exists "forge_card_art_candidates_select" on public.forge_card_art_candidates;
create policy "forge_card_art_candidates_select" on public.forge_card_art_candidates
  for select to authenticated
  using (exists (
    select 1 from public.forge_cards c
    where c.id = card_id
      and (c.owner_id = auth.uid() or public.is_forge_elder_or_super())
  ));

revoke all on public.forge_card_art_candidates from anon;
grant select on public.forge_card_art_candidates to authenticated;

-- 3) Add a candidate (owner or elder; hard cap 12 per card).
create or replace function public.forge_add_art_candidate(p_card_id uuid, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid() or public.is_forge_elder_or_super())
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  if (select count(*) from public.forge_card_art_candidates a where a.card_id = p_card_id) >= 12 then
    raise exception 'candidate limit reached (12)';
  end if;
  insert into public.forge_card_art_candidates (card_id, key)
  values (p_card_id, p_key)
  returning id into v_id;
  return v_id;
end; $$;

-- 4) Delete a candidate ROW (the blob stays; dangling private+UUID blobs are
--    harmless — cf. app/forge/lib/art.ts). Refuses when the candidate is the
--    source of the current artwork, so re-crop and download-original keep working.
create or replace function public.forge_delete_art_candidate(p_candidate_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card_id uuid; v_key text;
begin
  select a.card_id, a.key into v_card_id, v_key
    from public.forge_card_art_candidates a where a.id = p_candidate_id;
  if v_card_id is null then
    raise exception 'no such candidate';
  end if;
  if not exists (
    select 1 from public.forge_cards c
    where c.id = v_card_id
      and (c.owner_id = auth.uid() or public.is_forge_elder_or_super())
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  if exists (
    select 1 from public.forge_cards c
    where c.id = v_card_id and c.working_art_original_key = v_key
  ) then
    raise exception 'candidate is the source of the current artwork';
  end if;
  delete from public.forge_card_art_candidates where id = p_candidate_id;
end; $$;

-- 5) Key lookup for the /forge/api/art proxy. SECURITY INVOKER on purpose:
--    the select is subject to the policy above, so this cannot return anything
--    the caller couldn't already SELECT (cf. 066).
create or replace function public.forge_candidate_art_key(p_card_id uuid, p_candidate_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select a.key from public.forge_card_art_candidates a
  where a.id = p_candidate_id and a.card_id = p_card_id;
$$;

-- 6) Lock down execute: strip anon (Supabase default-grants it), grant authenticated.
revoke execute on function public.forge_add_art_candidate(uuid, text) from public, anon;
revoke execute on function public.forge_delete_art_candidate(uuid) from public, anon;
revoke execute on function public.forge_candidate_art_key(uuid, uuid) from public, anon;

grant execute on function public.forge_add_art_candidate(uuid, text) to authenticated;
grant execute on function public.forge_delete_art_candidate(uuid) to authenticated;
grant execute on function public.forge_candidate_art_key(uuid, uuid) to authenticated;
