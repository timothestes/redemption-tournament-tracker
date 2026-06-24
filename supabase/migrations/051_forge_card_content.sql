-- 051_forge_card_content.sql
-- Forge phase 1a.4: add card CONTENT to the identity-only forge_cards (mig 050).
-- Adds working_snapshot (autosave draft) + status, FIXES the SELECT policy to
-- owner-or-superadmin (050's member-wide policy would leak private ideas once
-- content lands), and adds a column-only, size-capped autosave RPC.
-- Builds on 048 (is_forge_member / is_forge_elder_or_super) and 050 (forge_cards).

-- 1) Card status enum (full lifecycle from the spec; only private_idea is used in 1a.4).
do $$ begin
  create type public.forge_card_status as enum
    ('private_idea','draft','playtesting','approved','promoted','archived');
exception when duplicate_object then null; end $$;

-- 2) Content columns. working_snapshot = the mutable DesignCard draft (autosave target).
alter table public.forge_cards
  add column if not exists working_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists status public.forge_card_status not null default 'private_idea';

-- 3) Superadmin SQL helper (mirrors 048's is_forge_member / is_forge_elder_or_super).
create or replace function public.is_forge_superadmin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.playtest_members m
    where m.user_id = auth.uid() and m.role = 'superadmin'
  );
$$;

-- 4) FIX the SELECT policy: owner-or-superadmin (was is_forge_member() — a leak
--    once working_snapshot holds card names/abilities). A private idea is owner-only;
--    the sets sub-phase later adds set-elder/granted branches via create-or-replace.
drop policy if exists "forge_cards_select" on public.forge_cards;
create policy "forge_cards_select" on public.forge_cards
  for select to authenticated
  using (owner_id = auth.uid() or public.is_forge_superadmin());

-- 5) Autosave RPC. Column-only write (never trusts identity keys inside the jsonb),
--    64 KB cap, syncs the title mirror from name, returns the new updated_at.
create or replace function public.forge_save_card(p_card_id uuid, p_snapshot jsonb)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_updated timestamptz;
begin
  if not exists (
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid() or public.is_forge_elder_or_super())
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

-- 6) Lock down execute: strip anon (Supabase default-grants directly), grant authenticated.
revoke execute on function public.is_forge_superadmin() from public, anon;
revoke execute on function public.forge_save_card(uuid, jsonb) from public, anon;
grant execute on function public.is_forge_superadmin() to authenticated;
grant execute on function public.forge_save_card(uuid, jsonb) to authenticated;
