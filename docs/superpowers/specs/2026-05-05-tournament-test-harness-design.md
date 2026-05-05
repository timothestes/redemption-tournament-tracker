# Tournament Test Harness Design

**Date:** 2026-05-05
**Status:** Draft, pending review

## Problem

Tournament logic is scattered across three places — `utils/tournament/pairingUtilsV2.ts` (pairing), `app/tracker/tournaments/[id]/page.tsx` (match-result handling, ~750 lines mixing UI, DB, and algorithm), and `app/tracker/tournaments/actions.ts` (final placement) — and is tightly coupled to the Supabase client throughout. There are no tests for any of it.

Two consequences:
- Refactors are scary because behavior is implicit.
- Two known bugs identified during spec review:
  1. **Match-result edits double-count.** `page.tsx` increments `match_points` and `differential` instead of recomputing from history, so editing a submitted result adds again.
  2. **Final standings skip head-to-head.** `actions.ts` sorts by `(match_points, differential)` only; the official Redemption rules require head-to-head as the first tiebreaker after game score.

We also identified a third issue worth fixing as part of this work:
3. **Bye distribution can over-concentrate.** The current two-pass algorithm doesn't prefer "fewest byes" once everyone has had at least one bye — a player can receive a 3rd bye while another player still has only 1.

## Goal

Build a test harness that locks in correct tournament behavior end-to-end, then refactor the code to delegate to pure modules so those tests cover production. Tests should:

- Run as fast unit/integration tests (no Supabase, no network, no clock).
- Be readable as documentation of correct behavior.
- Cover the algorithmic core spec-driven (per `algorithm.md`) and orchestration/lifecycle golden-master.
- Catch the three bugs above; failures drive the fixes.

## Authoritative reference

[`prompt_context/algorithm.md`](../../../prompt_context/algorithm.md). All algorithm tests assert against that document; if the doc and the code disagree, the doc wins and the code is the bug.

## Architecture

**Pattern:** Pure functions + thin DB shell.

All algorithm and state-transition logic moves into a new `lib/tournament/` directory of pure modules. They take and return plain TypeScript data — never a Supabase client, never `await`. The existing files (`pairingUtilsV2.ts`, the match-result handler in `page.tsx`, `actions.ts`'s placement code) become thin wrappers that:

1. Load relevant state from Supabase into plain data.
2. Call a pure function.
3. Persist the result back to Supabase.

Tests construct plain `TournamentState` values, call pure functions, assert outputs. An in-memory simulator (`lib/tournament/simulator.ts`) wraps the pure functions to provide an end-to-end "construct → run rounds → assert" API for scenario tests.

### Why this over alternatives

- **Domain-model class** (`Tournament` with methods, internal state): adds OO layering with no payoff — you'd test the same logic, just routed through `this`.
- **Event-sourcing / reducer**: overkill at this scale. Tournament state isn't large enough that recomputing from events is a meaningful win, and the persistence model is already mutation-based.

Pure functions give the simplest mental model and the cleanest test surface for this problem.

## Module breakdown — `lib/tournament/`

| Module | Responsibility |
|---|---|
| `types.ts` | Plain data types: `Participant`, `Match`, `MatchResult`, `Bye`, `TournamentState`, the `MatchOutcome` enum |
| `rng.ts` | `fnv1a32`, `mulberry32`, `rngForRound(tournamentId, round)`. Per `algorithm.md` "Seeded Randomness" section. |
| `scoring.ts` | `gameScoreFor(outcome)`, `lostSoulScoreFor(outcome, soulsP1, soulsP2, cap)`, outcome enum. Pure value functions, no state. |
| `pairing.ts` | `pairFirstRound(participants, rng)`, `pairLaterRound(state, round, rng)`, `selectBye(candidates, byeHistory, prevRoundByes, rng)`. Implements the new single-pass "fewest byes wins" bye algorithm. |
| `results.ts` | `applyResult(state, matchId, result)` and the load-bearing **`recomputeTotalsFromHistory(participantId, state)`** — fixes the double-count bug. |
| `standings.ts` | `computeFinalStandings(state)` — implements **head-to-head → lost soul score → joint placement**, fixes the missing head-to-head bug. |
| `lifecycle.ts` | `canStartTournament`, `isRoundComplete`, `isTournamentComplete`, `dropPlayer`, validators. |
| `simulator.ts` | In-memory test helper: `createTournament({ players, nRounds, cap, tournamentId? })` returning an object with `pairRound()`, `submitResult()`, `submitBye()`, `dropPlayer()`, `editResult()`, `standings()`. Pure wrapper around the modules; never touches Supabase. |
| `__tests__/*.test.ts` | Vitest tests, one file per module + `simulator.test.ts` for the end-to-end scenarios. |

### Type sketch (for shared understanding)

```ts
// types.ts (illustrative — final shape may evolve)
export type ParticipantId = string;

export interface Participant {
  id: ParticipantId;
  name: string;
  joined_at: string; // ISO timestamp
  dropped_out: boolean;
  drop_after_round?: number; // round at which drop took effect
}

export type MatchOutcome =
  | "full_win" | "partial_win" | "tie" | "partial_loss" | "full_loss"
  | "bye" | "forfeit" | "no_show";

export interface MatchResult {
  p1Souls: number;       // capped at win threshold per algorithm.md
  p2Souls: number;
  p1Outcome: MatchOutcome;
  p2Outcome: MatchOutcome;
}

export interface Match {
  id: string;
  round: number;
  player1Id: ParticipantId;
  player2Id: ParticipantId;
  matchOrder: number;
  result?: MatchResult;
}

export interface Bye {
  participantId: ParticipantId;
  round: number;
}

export interface TournamentState {
  id: string;
  nRounds: number;
  currentRound: number;
  soulCap: number;       // 5 or 7
  hasStarted: boolean;
  hasEnded: boolean;
  participants: Participant[];
  matches: Match[];
  byes: Bye[];
}
```

## Data flow

```
test code  ──►  simulator API  ──►  pure modules  ──►  TournamentState
                                            ▲                    │
                                            └────── return ──────┘

production page.tsx / actions.ts ──► load from Supabase ──► pure modules ──► persist to Supabase
```

The pure modules are unaware of which path called them. The simulator and the production wrappers are interchangeable consumers.

## Test scenario inventory

### Unit tests (per module)

`scoring.test.ts`:
- All 9 outcomes return correct `(game_score, lost_soul_score_per_round)` per the table in `algorithm.md`
- Lost-soul cap behavior at N=5 and N=7
- Forfeit literal `−5` (not scaled to N)
- Bye, no-show, tie all produce 0 lost soul score per round

`rng.test.ts`:
- Same `(tournamentId, round)` produces identical sequence
- Different rounds produce different sequences
- mulberry32 produces values in `[0, 1)`

`pairing.test.ts`:
- First round: even count, all paired, deterministic with fixed `tournamentId`
- First round: odd count, one bye, deterministic
- Bye selection: nobody has byed yet → lowest-ranked gets bye
- Bye selection: partial coverage → only candidates with min byes considered
- Bye selection: full coverage forces repeat, but among players at min count
- Bye selection: avoid back-to-back when alternate exists at same min count
- Bye selection: truly tied candidates → seeded RNG breaks deterministically
- Later round: greedy pairs avoid rematches
- Later round: locked configuration falls back to rematch
- Later round: defensive lone-bye case (odd unpaired remainder)
- Later round: `match_order` matches greedy order

`results.test.ts`:
- `applyResult` updates only the targeted match
- `recomputeTotalsFromHistory` correctly sums across all rounds (including byes)
- **Double-count regression**: submit R1 result, edit R1 result, totals match a fresh recompute (not 2× delta)
- Match outcomes set the correct per-player game/lost-soul values

`standings.test.ts`:
- Clean game-score order with no ties → expected ranks
- Game-score tie with one head-to-head dominant → that player ranked higher
- Game-score tie with no head-to-head winner → falls to lost soul score
- True tie (game score + lost soul score + no head-to-head) → joint placement, next-rank skip
- Drop-outs excluded from placings (they keep history but receive no `place`)

`lifecycle.test.ts`:
- Cannot add participant after `hasStarted=true`
- `isRoundComplete` true only when every match has result and every bye recorded
- `isTournamentComplete` true after final round complete
- `dropPlayer` mid-round preserves current match; excludes from next round's pool
- Re-add of dropped player rejected

### End-to-end scenarios (`simulator.test.ts`)

1. **Clean 4-player, 3-round** — golden-master pairings + standings
2. **8-player, 4-round, one drop in R2** — drop excluded from R3+ pairings and from final standings; remaining 7 ranked 1–7
3. **Small bracket forcing rematch** — 4 players, 4 rounds: all play all in R1–R3; R4 forces rematches
4. **All-tied final** — every player ends with same game score and lost soul score → joint placement for all
5. **Forfeits and no-shows** — verify scoring, verify forfeit player remains in pool next round (unless dropped)
6. **Edit-after-submit** — submit R1, edit one result, verify totals recompute (would have double-counted under old behavior)
7. **Bye distribution stress** — 5 players, 6 rounds: byes distributed within ±1 across all players (would skew under old algorithm)
8. **Head-to-head decides 1st place** — two players tied on game score, one beat the other directly: that player wins (would have lost under old code that uses lost soul score first)

## Refactor sequencing

The order is "smallest PR first, tests green throughout":

1. **`types.ts` + `rng.ts` + `scoring.ts`** + their tests. Nothing in production calls them yet.
2. **`pairing.ts`** + tests. Includes the new bye algorithm. Still no production calls.
3. **`results.ts` + `standings.ts` + `lifecycle.ts`** + tests.
4. **`simulator.ts`** + end-to-end scenario tests. Now we have full coverage of correct behavior with zero production code touched.
5. **Refactor `pairingUtilsV2.ts`** to load state, call `pairing.ts`, persist results. Production behavior change: bye distribution improves. Existing UI keeps working; tests pass.
6. **Refactor match-result handling in `page.tsx`** to call `results.ts` (recompute, not increment). Fixes the double-count bug.
7. **Refactor placement calculation in `actions.ts`** to call `standings.ts`. Fixes the missing head-to-head bug.
8. **Delete dead `pairingUtils.ts` v1.**

Each step is its own PR-sized unit, tested before moving on. Steps 5–7 are where production behavior actually changes; the test suite already encodes the desired behavior so we know we're going somewhere correct.

## Out of scope

- Multi-player tournament events
- Top cut / single-elimination playoffs
- Power pairings for the final round
- OMW / strength-of-schedule tiebreakers
- Late-arrival lost-soul penalties (judge action, not algorithm)
- UI changes — `page.tsx` keeps its current shape; only the math moves out
- Migration to a different test runner — staying with Vitest

## Open questions / risks

- **Production behavior changes in steps 5–7 will affect live tournaments.** Once those PRs ship, bye distribution shifts, edited results recompute (no longer increment), and final placings respect head-to-head. We should communicate this to TOs / users; not a blocker for the design but worth a heads-up before step 5 merges.
- **`page.tsx` is 750+ lines** and refactoring step 6 will touch a lot of code. The pure module hides the algorithm; the surrounding orchestration may still need cleanup, but that's tracked as follow-up.
- **`bye_points` / `bye_differential` columns** on the `tournaments` table are vestigial per the spec. Leaving them in place; not removing them as part of this work to avoid an unrelated migration.
