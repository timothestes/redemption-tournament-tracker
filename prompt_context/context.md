## Overview

This project aims to develop a sophisticated and visually appealing web application for managing and tracking tournament brackets. The frontend of the application will be built using the Next.js framework, providing a sleek, user-friendly interface with a comprehensive dashboard that allows users to create and join tournaments effortlessly. The backend data will be stored in a PostgreSQL database hosted by Supabase. Key features include:

- **Authentication System**: Secure login and registration managed by Supabase, ensuring user data protection and privacy.
- **Tournament Management**: A dedicated section for hosts to oversee multiple tournaments, access participant details, and monitor progress and pairings seamlessly.
- **Dynamic Brackets**: Interactive tournament brackets that automatically update as matches are played.
- **Engaging Design**: A thoughtfully chosen color scheme and typography to enhance clarity and user engagement throughout the app.

## Features

- **Match Display**: Clear and organized presentation of match pairings, tournament rounds, and the final winner.
- **User Experience**: Consistent design elements to intuitively guide users through the app.
- **Editable Match Results**: Allow tournament hosts to correct match results in case of reporting errors.

## Match Result Tracking

Each match result will record the following details:

1. **Player Points**: The number of points earned by each player.
2. **Opponent Points**: The number of points earned by the opponent.
3. **Point Differential**: The difference between the player's and opponent's points, known as the differential.

## Proposed SQL Database Schema

```sql
create table tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  host_id uuid references auth.users (id) on delete cascade,
  code text unique,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  started_at timestamp with time zone,
  ended_at timestamp with time zone, 
  has_started boolean default false,
  has_ended boolean default false,
  n_rounds int,
  current_round int
);

create table participants (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references tournaments (id) on delete cascade,
  -- user_id uuid references auth.users (id) on delete cascade,
  joined_at timestamp with time zone default now(),
  place int,
  match_points int,
  differential int,
  name text,
  dropped_out bool
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references tournaments (id) on delete cascade,
  round int not null,
  player1_id uuid references participants (id) on delete cascade,
  player2_id uuid references participants (id) on delete cascade,
  player1_score int not null default 0,
  player2_score int not null default 0,
  differential int generated always as (player1_score - player2_score) stored,
  winner_id uuid references participants (id) on delete cascade,
  updated_at timestamp with time zone default now(),
  is_tie boolean default false
);

create table rounds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references tournaments (id) on delete cascade,
  round_number int not null,
  started_at timestamp with time zone default now(),
  ended_at timestamp with time zone,
  is_completed boolean default false,
  unique (tournament_id, round_number)
);
```

# Row-level security policies:
```sql
-- Enable row-level security on all tables
alter table tournaments enable row level security;
alter table participants enable row level security;
alter table matches enable row level security;

-- Create a policy for viewing and editing tournaments (host-only)
create policy host_can_access_tournaments
on tournaments
using (auth.uid() = host_id)
with check (auth.uid() = host_id);

-- Create a policy for viewing and editing participants (host-only)
create policy host_can_access_participants
on participants
using (auth.uid() = (select host_id from tournaments where tournaments.id = participants.tournament_id))
with check (auth.uid() = (select host_id from tournaments where tournaments.id = participants.tournament_id));

-- Create a policy for viewing and editing matches (host-only)
create policy host_can_access_matches
on matches
using (auth.uid() = (select host_id from tournaments where tournaments.id = matches.tournament_id))
with check (auth.uid() = (select host_id from tournaments where tournaments.id = matches.tournament_id));

-- Ensure only authorized users can perform actions
grant select, insert, update, delete on tournaments, participants, matches to authenticated;

-- Enable row-level security on the rounds table
alter table rounds enable row level security;

-- Create a policy for viewing and editing rounds (host-only)
create policy host_can_access_rounds
on rounds
using (auth.uid() = (select host_id from tournaments where tournaments.id = rounds.tournament_id))
with check (auth.uid() = (select host_id from tournaments where tournaments.id = rounds.tournament_id));

-- Ensure only authenticated users can perform actions
grant select, insert, update, delete on rounds to authenticated;
```