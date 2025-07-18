I'm going to attempt to describe how the pairing algorithm for a swiss redemption tournament should work.
It is a slightly modified version of a normal swiss pairing system, expect it uses a tiebreaker called a "differential".

First, let's define some terms.

A game is played between two players.
A game can have different outcomes (described in the match points section)
A tournament consists of at least two players.
A tournament's number of rounds is declared by the handbook.

# Game Points
- In a game, players play until "time" in round is called or whoever gets N "game points" first

- The number of game points players playt to is decided at the beginning of the tournament.

- It can be 5 or 7.

# Match Points

If a player wins a match by getting to the full N points in their game before time is called, they are awarded 3 "match points". This is called a full win.
If a player wins by being ahead in "game points" when time is called, they are awared 2 "match points". This is called a partial win.
If both players have the same numer of "game points" when time is called, they are each awared 1.5 "match points". This is called a tie.
If a player loses the round when the opponent gets the full N points in their game, they get 0 "match points". This is called a full loss.
If a player loses the round while behind behhind in "game points" when time is called, they get 1 "match point". This is called a partial loss.


# Round Pairing

Depending on the round, a different pairing method will be used. In each round, players are paired with an opponent and report their game scores that will be used to decide how many match points they are awared for the round. The "differential" they get each game will be kept track of cumulatively throughout the tournament. The differential can be a negative number. Over the rounds, they will also accumulate match points. Match points can never be negative. At the end of the tournament, whoever has the most match points will be declared the winner. If there is a tie, between the players that have the most match points, whoever has the highest "differential" will be declared the winner. If there is still a tie between number of match points and differential, a tie is declared.

## Byes

If there are an odd number of players, a player is chosen to get the "bye", meaning they will not be paired against a player and instead sit out. But they still get match points. They are awarded 3 match points and a 0 differential.

## First Round

For the first round, matchups between players should be randomized. If a bye is present, the person who gets the bye should be assigned randomly. This is the simplest the pairing logic will get. Subsequent rounds have a more involved pairing algorithm.

## Non-first Rounds

Any subsequent rounds played after the first round should follow these pairing rules.

- First, if there is an odd number of players, decide who will get the bye. 

- Sort the list of players from highest number of match points from highest to lowest number of match points.

- Perform a secondary sort on the list so that its sorted by match points, then differential score.

- Starting with the player on the bottom of the list, go through this checklist to decide if they get the bye or not:

```python
# assume "byes" exists: a table that contains information about if a player got a bye in a given round
sorted_list_of_players = [
    {"name": "player_a", "match_points": 10, "differential": 11,},
    {"name": "player_b", "match_points": 10, "differential": 9},
    {"name": "player_c", "match_points": 10, "differential": 4},
    {"name": "player_d", "match_points": 9, "differential": 4},
    {"name": "player_d", "match_points": 9, "differential": -10},
]

for player in reverse(sorted_list_of_players):
    if player hasn't gotten a bye yet:
        give them a bye
    else:
        continue

# if you get to the bottom of the list and have determined all players have already
# gotten a bye, then go through the list again, using a more permissive selection rule
for player in reverse(sorted_list_of_players):
    if player hasn't gotten a bye in the last round:
        give them a bye
    else:
        continue
# this will always generate a bye
```

- After the bye has been decided, remove the player with the bye from the sorted list, then decide on the pairing for the rest of the players.

- Starting with the player on the top of the list, go through this checklist to decide who they are paired against:

```python
# pairing psuedocode

# assume "matches" exists: a table that contains a list of who played who during each round
sorted_list_of_players = [
    {"name": "player_a", "match_points": 10, "differential": 11,},
    {"name": "player_b", "match_points": 10, "differential": 9},
    {"name": "player_c", "match_points": 10, "differential": 4},
    {"name": "player_d", "match_points": 9, "differential": 10},
    {"name": "player_d", "match_points": 9, "differential": 4},
    ...
]

for i, player in enum(sorted_list_of_players)
    if sorted_list_of_players[i+1] havent_played_yet:
        # then pair them
    else: # they have played
        continue # keep going down the line until you find someone you haven't played yet
```

If it comes to the end of the list and its determined that a player has played against everyone in the list,
then use this logic:

```python
# go through the list again, but this time pair the players if the next player in the list didn't play
# each other the previous round. This is a more permissive pairing rule. If you reach the bottom of the list and both players at the bottom already played each other last round, pair them again.
```

# Data Examples

Here are some example tables and rows from the tables that I am using to keep track of the tournament state

## Tournaments Table
```sql
create table public.tournaments (
  id uuid not null default gen_random_uuid (),
  name text not null,
  host_id uuid null,
  code text null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  started_at timestamp with time zone null,
  ended_at timestamp with time zone null,
  has_started boolean null default false,
  has_ended boolean null default false,
  n_rounds integer null,
  current_round integer null,
  round_length integer null,
  max_score smallint null,
  bye_points smallint null,
  bye_differential smallint null,
  starting_table_number bigint null,
  sound_notifications boolean null default false,
  constraint tournaments_pkey primary key (id),
  constraint tournaments_code_key unique (code),
  constraint tournaments_host_id_fkey foreign KEY (host_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;
```
**Relations:**
- `tournaments` 1-to-many `rounds` (`rounds.tournament_id` → `tournaments.id`)
- `tournaments` 1-to-many `participants` (`participants.tournament_id` → `tournaments.id`)
- `tournaments` 1-to-many `matches` (`matches.tournament_id` → `tournaments.id`)
- `tournaments` 1-to-many `byes` (`byes.tournament_id` → `tournaments.id`)

## Rounds Table
```sql
create table public.rounds (
  id uuid not null default gen_random_uuid (),
  tournament_id uuid null,
  round_number integer not null,
  started_at timestamp with time zone null default now(),
  ended_at timestamp with time zone null,
  is_completed boolean null default false,
  constraint rounds_pkey primary key (id),
  constraint rounds_tournament_id_round_number_key unique (tournament_id, round_number),
  constraint rounds_tournament_id_fkey foreign KEY (tournament_id) references tournaments (id) on update CASCADE on delete CASCADE
) TABLESPACE pg_default;
```
**Relations:**
- `rounds` belongs-to `tournaments` via `tournament_id`
- `rounds` 1-to-many `matches` (matches.round refers to `rounds.round_number` within same tournament)
- `rounds` 1-to-many `byes` (`byes.round_id` → `rounds.id`)

## Participants Table
```sql
create table public.participants (
  id uuid not null default gen_random_uuid (),
  tournament_id uuid null,
  joined_at timestamp with time zone null default now(),
  place double precision null,
  match_points double precision null,
  differential double precision null,
  name text null,
  dropped_out boolean not null default false,
  constraint participants_pkey primary key (id),
  constraint participants_tournament_id_fkey foreign KEY (tournament_id) references tournaments (id) on update CASCADE on delete CASCADE
) TABLESPACE pg_default;
```
**Relations:**
- `participants` belongs-to `tournaments` via `tournament_id`
- `participants` 1-to-many `matches` as `player1` and `player2` (`matches.player1_id`, `matches.player2_id`)
- `participants` 1-to-many `byes` (`byes.participant_id`)

## Matches Table
```sql
create table public.matches (
  id uuid not null default gen_random_uuid (),
  tournament_id uuid null,
  round integer not null,
  player1_id uuid null,
  player2_id uuid null,
  player1_score real null,
  player2_score real null,
  winner_id uuid null,
  updated_at timestamp with time zone null default now(),
  is_tie boolean null default false,
  player1_match_points real null,
  player2_match_points real null,
  differential2 double precision null,
  differential double precision null,
  match_order bigint null,
  constraint matches_pkey primary key (id),
  constraint matches_player1_id_fkey foreign KEY (player1_id) references participants (id) on delete CASCADE,
  constraint matches_player2_id_fkey foreign KEY (player2_id) references participants (id) on delete CASCADE,
  constraint matches_tournament_id_fkey foreign KEY (tournament_id) references tournaments (id) on update CASCADE on delete CASCADE,
  constraint matches_winner_id_fkey foreign KEY (winner_id) references participants (id) on delete CASCADE
) TABLESPACE pg_default;
```
**Relations:**
- `matches` belongs-to `tournaments` via `tournament_id`
- `matches` belongs-to two `participants` via `player1_id` and `player2_id`
- `matches` winner is one `participant` via `winner_id`

## Byes Table
```sql
create table public.byes (
  id uuid not null default gen_random_uuid (),
  participant_id uuid not null,
  tournament_id uuid not null,
  round_number real not null,
  round_id uuid null,
  created_at timestamp with time zone not null default now(),
  match_points real not null,
  differential real not null,
  constraint byes_pkey primary key (id),
  constraint byes_participant_id_fkey foreign KEY (participant_id) references participants (id) on update CASCADE on delete CASCADE,
  constraint byes_round_id_fkey foreign KEY (round_id) references rounds (id) on update CASCADE on delete CASCADE,
  constraint byes_tournament_id_fkey foreign KEY (tournament_id) references tournaments (id) on update CASCADE on delete CASCADE
) TABLESPACE pg_default;
```
**Relations:**
- `byes` belongs-to `participants` via `participant_id`
- `byes` belongs-to `rounds` via `round_id`
- `byes` belongs-to `tournaments` via `tournament_id`


# Storing Data Example

For example, if two players have been plaired to play and they finish their match, this is how their match points and differential would be determined.

Sally vs Billy

Sally got the full 5 game points within the time limit.
Billy got 3 game points

Sally is awarded 3 match points and +2 differential
Billy is awared 0 match points and a -2 differential

Before the match, Sally had 3 match points a 5 differential. After this match results are added to her score, she will have 6 match points and a 7 differential.

Before the match, Billy had 5 match points and a 3 differntial. After this match results are added to his score, he will have 5 match points and a 1 differential.

After all the scores of each match have been reported, the current round ends and a new one begins where new pairings will be determined. This happens until the pre-determined number of rounds in the tournament have been reached. The winner is the player with the most number of match points, and if there is a tie there, the highest differential.