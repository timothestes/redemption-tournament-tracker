-- 056_forge_decks.sql
-- Phase 2.2: private mixed-pool decks. Owner-scoped personal data.
-- Forge cards are stored as opaque card_id refs (resolved live under RLS on load);
-- public cards as name|set. Writes go through the owner's RLS client (server action),
-- NOT a definer RPC — single-owner data, no cross-author authz. Anon has no policy → 0 rows.

create table if not exists public.forge_decks (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  format     text not null default 'Type 1',
  paragon    text,
  cards      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists forge_decks_owner_idx on public.forge_decks (owner_id);

alter table public.forge_decks enable row level security;

drop policy if exists "forge_decks_select" on public.forge_decks;
create policy "forge_decks_select" on public.forge_decks
  for select to authenticated
  using (owner_id = auth.uid() and public.is_forge_member());

drop policy if exists "forge_decks_insert" on public.forge_decks;
create policy "forge_decks_insert" on public.forge_decks
  for insert to authenticated
  with check (owner_id = auth.uid() and public.is_forge_member());

drop policy if exists "forge_decks_update" on public.forge_decks;
create policy "forge_decks_update" on public.forge_decks
  for update to authenticated
  using (owner_id = auth.uid() and public.is_forge_member())
  with check (owner_id = auth.uid() and public.is_forge_member());

drop policy if exists "forge_decks_delete" on public.forge_decks;
create policy "forge_decks_delete" on public.forge_decks
  for delete to authenticated
  using (owner_id = auth.uid() and public.is_forge_member());
