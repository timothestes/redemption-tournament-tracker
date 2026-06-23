-- 050_forge_cards_art.sql
-- Forge phase 1a.3: minimal card IDENTITY + the private art pipeline.
-- forge_cards ships ONLY what art needs (owner + art refs). The card CONTENT model
-- (working_snapshot jsonb, sets, immutable card_versions) lands in the later studio
-- slice. Builds on 048 (is_forge_member / is_forge_elder_or_super) and 049 (forge_audit).
-- SCHEMA + FUNCTIONS ONLY — no card content.

-- 1) Card identity. Art refs are private-blob PATHNAMES (UUID keys), never URLs.
create table if not exists public.forge_cards (
  id                          uuid primary key default gen_random_uuid(),
  owner_id                    uuid not null references auth.users(id) on delete cascade,
  title                       text,
  working_art_key             text,                       -- private blob pathname (UUID) for the current draft art
  working_art_is_placeholder  boolean not null default false,
  working_art_original_key    text,                       -- full-res original (== working_art_key in 1a.3; studio refines)
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

alter table public.forge_cards enable row level security;

-- 2) RLS: any Forge member may READ any card row (member-vs-non-member is the
--    boundary; single-author Phase 1a has no per-card visibility yet). No direct
--    write policy — writes go through the SECURITY DEFINER RPCs below (cf. 048/049).
drop policy if exists "forge_cards_select" on public.forge_cards;
create policy "forge_cards_select" on public.forge_cards
  for select to authenticated
  using (public.is_forge_member());

revoke all on public.forge_cards from anon;
grant select on public.forge_cards to authenticated;

-- 3) Create a card (elders design cards in Phase 1a; playtesters do not).
create or replace function public.forge_create_card(p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_forge_elder_or_super() then
    raise exception 'only elders may create cards';
  end if;
  insert into public.forge_cards (owner_id, title)
  values (auth.uid(), nullif(btrim(p_title), ''))
  returning id into v_id;
  return v_id;
end; $$;

-- 4) Set the current draft art (key + full-res original). Clears the placeholder
--    flag. Owner or any elder may edit.
create or replace function public.forge_set_working_art(
  p_card_id uuid, p_key text, p_original_key text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid() or public.is_forge_elder_or_super())
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  update public.forge_cards
     set working_art_key = p_key,
         working_art_original_key = p_original_key,
         working_art_is_placeholder = false,
         updated_at = now()
   where id = p_card_id;
end; $$;

-- 5) Toggle the placeholder flag (advisory "art not final" state; no blob needed).
create or replace function public.forge_set_art_placeholder(
  p_card_id uuid, p_is_placeholder boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid() or public.is_forge_elder_or_super())
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  update public.forge_cards
     set working_art_is_placeholder = coalesce(p_is_placeholder, false),
         updated_at = now()
   where id = p_card_id;
end; $$;

-- 6) Audit an art download (member-gated; the proxy calls this on ?download=1).
create or replace function public.forge_log_art_download(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_forge_member() then
    raise exception 'not a member';
  end if;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'art_download', p_card_id::text);
end; $$;

-- 7) Lock down execute: strip anon (Supabase default-grants it directly), grant authenticated.
revoke execute on function public.forge_create_card(text) from public, anon;
revoke execute on function public.forge_set_working_art(uuid, text, text) from public, anon;
revoke execute on function public.forge_set_art_placeholder(uuid, boolean) from public, anon;
revoke execute on function public.forge_log_art_download(uuid) from public, anon;

grant execute on function public.forge_create_card(text) to authenticated;
grant execute on function public.forge_set_working_art(uuid, text, text) to authenticated;
grant execute on function public.forge_set_art_placeholder(uuid, boolean) to authenticated;
grant execute on function public.forge_log_art_download(uuid) to authenticated;
