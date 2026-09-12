-- Backup of every deck description rewritten by scripts/backfill-deck-mentions.ts,
-- which wraps card names the deck plays in `[[ ]]` so they render as card links.
-- Kept as the revert path for that one-time rewrite:
--
--   update decks d set description = b.description
--   from deck_description_backfill_backup b where b.deck_id = d.id;
--
-- (run with the update_decks_updated_at trigger disabled, as the backfill did,
-- to leave the decks' updated_at where the authors left it)
create table if not exists public.deck_description_backfill_backup (
  deck_id uuid primary key references public.decks(id) on delete cascade,
  description text not null,
  backed_up_at timestamptz not null default now()
);

-- Nobody but the service role has business reading other people's drafts.
alter table public.deck_description_backfill_backup enable row level security;
revoke all on public.deck_description_backfill_backup from anon, authenticated;
