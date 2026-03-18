-- Tournament decklists: links participants to decks
create table tournament_decklists (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  deck_id uuid not null references decks(id) on delete cascade,
  created_at timestamptz default now(),
  unique(participant_id)  -- one deck per participant
);

-- Tournament-level columns for deck publishing
alter table tournaments add column decklists_published boolean not null default false;
alter table tournaments add column deck_format text; -- T1, T2, Paragon, Other

-- Enable RLS
alter table tournament_decklists enable row level security;

-- Host can manage decklists for their tournaments
create policy host_can_manage_tournament_decklists
on tournament_decklists
for all
using (
  auth.uid() = (select host_id from tournaments where tournaments.id = tournament_decklists.tournament_id)
)
with check (
  auth.uid() = (select host_id from tournaments where tournaments.id = tournament_decklists.tournament_id)
);

-- Anyone can read published tournament decklists
create policy public_can_read_published_decklists
on tournament_decklists
for select
using (
  (select decklists_published from tournaments where tournaments.id = tournament_decklists.tournament_id) = true
);

-- Grant access to authenticated users
grant select, insert, update, delete on tournament_decklists to authenticated;
-- Allow anonymous reads for published decklists
grant select on tournament_decklists to anon;

-- Index for fast lookups
create index idx_tournament_decklists_tournament on tournament_decklists(tournament_id);
create index idx_tournament_decklists_deck on tournament_decklists(deck_id);
