-- 064_forge_deck_sharing.sql
-- Forge deck sharing: a deck is either private (owner only) or shared with the
-- whole Forge. Reads widen to owner-or-shared (still forge-member-gated);
-- writes stay owner-only so nobody can flip or edit someone else's deck.
-- Anon keeps no policy → 0 rows.

alter table public.forge_decks
  add column if not exists is_shared boolean not null default false;

drop policy if exists "forge_decks_select" on public.forge_decks;
create policy "forge_decks_select" on public.forge_decks
  for select to authenticated
  using (public.is_forge_member() and (owner_id = auth.uid() or is_shared));

-- Shared-deck listing is ordered newest-first; partial index keeps it cheap.
create index if not exists forge_decks_shared_idx
  on public.forge_decks (updated_at desc) where is_shared;
