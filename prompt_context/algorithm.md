# Redemption Swiss Tournament Algorithm

This document specifies the pairing algorithm and tournament rules for Redemption CCG Swiss-style tournaments. It is the authoritative reference for the tournament tracker's behavior.

## Sources of Authority

- **Official Redemption Host Guide** (`tournament_structure.md` and the official PDFs in [Key References]) is authoritative for game rules, scoring, byes, forfeits, and tiebreaker order.
- This document interprets official rules and adds implementation detail where the official guide is silent (e.g., bye selection in later rounds).
- Where this doc adds rules beyond the official guide, those sections are marked **(Implementation policy.)**

## Scope

- 2-player Swiss tournaments only.
- Multi-player events are out of scope.
- Top cut / single-elimination playoffs are out of scope (future addition).
- Power pairings for the final round are out of scope.
- Late-arrival lost-soul penalties (judge action) are out of scope.

## Terminology and Aliases

The official rules and the codebase use different names for the same concepts. This is the canonical mapping:

| Official term | Code/DB term | Description |
|---|---|---|
| Lost souls (per game) | `player1_score` / `player2_score` | The per-game count of lost souls rescued. Win threshold is N (5 in Type 1, 7 in Type 2). |
| Game score | `match_points` | The 3 / 2 / 1.5 / 1 / 0 round award. |
| Lost soul score | `differential` | The cumulative tiebreaker tally. |

## Glossary

- **Lost souls (per game)**: Capped at the win threshold for the tournament category. Anything beyond is not counted. Chosen by host as a tournament setting. Usually 5 or 7.
- **Game score (cumulative)**: 3 / 2 / 1.5 / 1 / 0 awarded per round, summed across rounds. Cannot be negative.
- **Lost soul score (per round)**: For 2-player events, equals `your_souls − opponent_souls`. Bounded by [−N, +N] where N is the win threshold (game cap also applies to the differential).
- **Lost soul score (cumulative)**: Sum of per-round lost soul scores. May be negative.
- **Bye**: Awarded when a player has no opponent in a round. Game score 3, lost soul score 0.
- **Forfeit**: A player abandons a match. Forfeiter receives game score 0 and lost soul score −5. Their opponent receives game score 3 and lost soul score 0.
- **No-show / late**: A player is unavailable for an entire round (different from forfeit). Game score 0, lost soul score 0 for the missed round.
- **Drop-out**: A player exits the tournament. Their previous results are preserved; they are excluded from subsequent pairings and from final placings.

## Game Score (per round)

| Outcome | Game score |
|---|---|
| Full win (reached N souls before time) | 3 |
| Partial win (ahead in souls when time called) | 2 |
| Tie (equal souls when time called) | 1.5 |
| Partial loss (behind in souls when time called) | 1 |
| Full loss (opponent reached N souls) | 0 |
| Bye | 3 |
| Forfeit (forfeiter) | 0 |
| Forfeit (opponent of forfeiter) | 3 |
| No-show / late | 0 |

## Lost Soul Score (per round)

For 2-player events:

- **Played match**: `your_souls − opponent_souls`. The cap rule applies: each player's `souls` value is capped at the win threshold N.
- **Tied game (timed, equal souls)**: 0.
- **Bye**: 0.
- **Forfeit (forfeiter)**: −5.
- **Forfeit (opponent of forfeiter)**: 0.
- **No-show / late**: 0.

Cumulative across rounds. May be negative.

## Round Pairing — First Round

- Pairings are random; if odd number of players, one player is selected at random for the bye.
- Randomness uses the seeded RNG described under "Seeded Randomness" below — derived from `(tournament_id, round_number=1)`. Production behavior is effectively random across tournaments; tests use fixed tournament UUIDs to produce deterministic results.

## Seeded Randomness

All randomized choices in the pairing algorithm (first-round pairings, first-round bye selection, later-round bye tiebreakers) use a deterministic seeded PRNG so that:

- Tests can construct tournaments with known UUIDs and assert exact outcomes.
- A TO accidentally re-pairing the same round produces the same result.

**Implementation:**
1. Compute a 32-bit seed from `${tournament_id}:${round_number}` via FNV-1a.
2. Feed that seed into `mulberry32` to get a PRNG function.
3. All randomized choices for that round draw from the same PRNG instance, so order of consumption matters and must be stable.

```ts
function fnv1a32(s: string): number {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngForRound(tournamentId: string, round: number): () => number {
  return mulberry32(fnv1a32(`${tournamentId}:${round}`));
}
```

## Round Pairing — Later Rounds

1. **Sort active players** (excluding drop-outs) by `(game_score DESC, lost_soul_score DESC)`.

2. **If odd count, select bye** (Implementation policy — official guide is silent):
   1. **Filter to fewest byes**: among active players, find the subset with the **minimum total bye count** (across all prior rounds). When no one has byed yet, this is the full pool. Once everyone has byed at least once, this naturally narrows to the players with the fewest byes.
   2. **Lowest-ranked first**: within that subset, pick the **lowest-ranked** player by the sort order — that is, the bottom of `(game_score DESC, lost_soul_score DESC)`.
   3. **Avoid back-to-back byes**: if the lowest-ranked candidate received a bye in the immediately previous round AND another candidate in the subset did not, prefer the one who didn't.
   4. **Final tiebreak (seeded RNG)**: if multiple candidates remain truly tied (same bye count, same rank, same prior-round-bye status), pick using a seeded random number generator. The seed is derived from `(tournament_id, round_number)` so that re-running the pairing for the same round produces the same outcome, and tests can assert deterministic results by using fixed tournament UUIDs. Implementation:
      - Hash `${tournament_id}:${round_number}` via FNV-1a (32-bit) → seed integer.
      - Feed the seed into `mulberry32` → PRNG function.
      - Use the PRNG to pick an index into the tied-candidate array.
   5. Remove the bye player from the pairing pool.

   > **Behavior change vs. current code.** The existing implementation in `pairingUtilsV2.ts` uses two passes — first "no byes yet," then "didn't bye last round" — but the second pass does not prefer fewer byes. That allows over-concentration: a player can get a 3rd bye while another player still only has 1. The single-pass "fewest byes wins" rule above replaces it.

3. **Backtracking pairing** (top-down) — implementation:
   - The pairer performs a depth-first search over the rank-sorted pool. The topmost unpaired player tries each unpaired partner in rank order; the search unwinds when a sub-pool admits no legal completion.
   - The first complete leaf the search returns is the greedy-equivalent solution — when greedy would already produce a no-rematch pairing, the search returns the identical pairing (and `match_order` is assigned top-down exactly as before).
   - When greedy would have produced an avoidable rematch, the search finds an alternative whenever one exists. A fail-fast prune (any unpaired player with zero legal partners terminates the branch immediately) keeps the common case effectively linear.

4. **Rematch fallback**:
   - Only fires when the pool admits no rematch-free perfect matching at all — a corner case visible only in tiny fields exhausted across many rounds (e.g., 4 players × 4 rounds).
   - When it fires, the pool is paired in remaining-list order, even if it produces rematches. This matches the official guide's acknowledgement: *"In a smaller tournament field, it will sometimes occur that two players will be matched twice."*

5. **Defensive case** (Implementation policy): if the greedy + rematch pass leaves exactly one player unpaired (which should not occur with an even pool but is possible if input is inconsistent), assign them a bye.

## Determining Final Standings

Per the official Redemption Host Guide, in this order:

1. **Drop-outs are removed** from final placings entirely. Remaining players move up to fill those slots. Drop-outs retain their match history but receive no `place` value.

2. **Sort remaining players by `game_score DESC`.**

3. **Within a game-score tie, apply the head-to-head rule**:
   - If exactly one tied player defeated all other players in the tie group (head-to-head), they take the top place of the group.
   - Repeat: remove that player from the group and re-check head-to-head among the remaining tied players for the next place.

4. **If no clean head-to-head winner remains**, fall to **`lost_soul_score DESC`** within the tie group.

5. **Joint placement on true ties**: if players are still tied in both game score and lost soul score (and have no decisive head-to-head among them), they share that placement. The next assigned place skips ahead by the size of the tie group. (E.g., two players tied for 3rd → next player is 5th.) Per official rules, ranking points and prizes are split.

> Redemption uses lost soul score as the primary numeric tiebreaker; it does **not** use OMW (opponent match-win percentage) or other strength-of-schedule tiebreakers, despite generic Swiss references mentioning them.

## Lifecycle / State Transitions

- **Tournament start**: `has_started=true`, `current_round=1`. After this point, no new participants may be added.
- **Round complete**: every match in the round has a recorded result, AND every bye for that round is recorded.
- **Tournament end**: `has_ended=true` after round `n_rounds` is complete. The TO may force-end early.
- **Drop timing**: drops are processed between rounds. A drop submitted mid-round still records the current round's result; the drop takes effect for the next round's pairings.
- **Re-adding a dropped player**: not supported.
- **Result edits**: `match_points` and `differential` for participants must be derivable from match history — they are *not* incrementally updated. Editing a match result must trigger recomputation of affected players' totals from match history.
  - **Known bug as of this writing**: the current implementation increments instead of recomputing. Editing a result double-counts. Tests for this behavior must verify correct (recompute) semantics; the test suite is intended to flush this bug out.

## Worked Example (2-player, Type 1)

Sally vs. Billy in round 4. Game cap = 5 lost souls.

- Sally rescues 5 lost souls before time is called → full win.
- Billy rescues 3 lost souls.

| Player | Round game score | Round lost soul score |
|---|---|---|
| Sally | 3 (full win) | +2 (5 − 3) |
| Billy | 0 (full loss) | −2 (3 − 5) |

If before the round Sally had 9 game score and +5 lost soul score, she now has 12 game score and +7 lost soul score.

If before the round Billy had 5 game score and +3 lost soul score, he now has 5 game score and +1 lost soul score.

# Data Reference

The DB tables that store tournament state. Schema reproduced for reference; this is the SQL definition the algorithm operates on.

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

Notes on tournament-level columns:
- `max_score` is the win threshold N (5 for Type 1, 7 for Type 2).
- `bye_points` and `bye_differential` exist as columns but per official rules are always 3 and 0 respectively. Treat as fixed; the columns are vestigial.
- `n_rounds` is set by the TO at tournament creation; the official "rounds by player count" table (5–8 → 3, 9–16 → 4, etc.) is a recommendation, not enforced.

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
