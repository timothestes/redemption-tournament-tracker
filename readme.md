Here’s the web app I’d like to build:

Design a modern and visually appealing web app interface for hosting and tracking tournament brackets. The app should have a clean, user-friendly layout with a dashboard where users can create and join tournaments. Include features such as:

- A login system for authentication. (managed by supabase)
- A section for tournament hosts to manage multiple tournaments, view participant details, and track progress.
- Interactive brackets that dynamically update as games are played.
- A code-based system for users to join specific tournaments. (probably a random sequence of 4-5 characters)
- A color scheme and typography that emphasize clarity and engagement.

The app should also display match pairings, tournament rounds, and the final winner in a clear and organized manner. Use consistent design elements to guide users intuitively through the experience.

The tournament host will need to be able to edit match results if there are errors in reporting.

Each match result needs to keep track of the following:

1. The number of points earned by a player
2. The number of points earned by the opponent
3. The difference between the number of points earned by the player and the number of points earned by the opponent (called the differential)

Here’s the proposes sql database:

```sql
create table users (
  id bigint primary key generated always as identity,
  username text not null,
  email text unique not null,
  password_hash text not null,
  created_at timestamp with time zone default now()
);

create table tournaments (
  id bigint primary key generated always as identity,
  name text not null,
  host_id bigint references users (id) on delete cascade,
  code text unique not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table participants (
  id bigint primary key generated always as identity,
  tournament_id bigint references tournaments (id) on delete cascade,
  user_id bigint references users (id) on delete cascade,
  joined_at timestamp with time zone default now(),
  place int
);

create table matches (
  id bigint primary key generated always as identity,
  tournament_id bigint references tournaments (id) on delete cascade,
  round int not null,
  player1_id bigint references participants (id) on delete cascade,
  player2_id bigint references participants (id) on delete cascade,
  player1_score int not null default 0,
  player2_score int not null default 0,
  differential int generated always as (player1_points - player2_points) stored,
  winner_id bigint references participants (id) on delete cascade,
  updated_at timestamp with time zone default now(),
  is_tie boolean default false
);

# row level security stuff pending 
```