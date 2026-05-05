# Tournament Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Redemption tournament algorithm and lifecycle logic from Supabase-coupled call sites into a `lib/tournament/` directory of pure modules, lock correct behavior in via Vitest, then refactor existing call sites to delegate to those modules. The refactor fixes three known bugs along the way: result-edit double-counting, missing head-to-head tiebreaker, and over-concentration of byes.

**Architecture:** Pure functions + thin DB shell. All algorithm logic moves to `lib/tournament/*.ts` (no Supabase imports). The existing files (`utils/tournament/pairingUtilsV2.ts`, the match-result handler in `app/tracker/tournaments/[id]/page.tsx`, and `app/tracker/tournaments/actions.ts`) become thin wrappers that load state from Supabase, call a pure function, and persist results. Tests work against the pure modules with in-memory state. An in-memory simulator (`lib/tournament/simulator.ts`) provides an end-to-end `pairRound → submitResult → standings` API for scenario tests.

**Tech Stack:** TypeScript, Vitest (already installed), Next.js 15 + Supabase (existing infra, not modified).

**Spec authorities:**
- [`prompt_context/algorithm.md`](../../../prompt_context/algorithm.md) — rules of Redemption Swiss tournaments. If code disagrees with this doc, the doc wins.
- [`docs/superpowers/specs/2026-05-05-tournament-test-harness-design.md`](../specs/2026-05-05-tournament-test-harness-design.md) — design rationale.

**Test command:** `npx vitest run <path>` (no test script in `package.json`; invoke vitest directly).

**Commit message style:** lowercase, short, descriptive. Match existing repo style — examples: `"tournament: add types module"`, `"tournament: implement bye selection"`. No Conventional Commits prefix.

---

## File Structure

**Created:**
- `lib/tournament/types.ts` — plain data types
- `lib/tournament/rng.ts` — seeded PRNG
- `lib/tournament/scoring.ts` — game-score / lost-soul-score per round
- `lib/tournament/pairing.ts` — first-round + later-round pairing + bye selection
- `lib/tournament/results.ts` — apply match results, recompute totals from history
- `lib/tournament/standings.ts` — final standings with head-to-head
- `lib/tournament/lifecycle.ts` — validators + state-transition predicates
- `lib/tournament/simulator.ts` — in-memory test/repro harness
- `lib/tournament/__tests__/rng.test.ts`
- `lib/tournament/__tests__/scoring.test.ts`
- `lib/tournament/__tests__/pairing.test.ts`
- `lib/tournament/__tests__/results.test.ts`
- `lib/tournament/__tests__/standings.test.ts`
- `lib/tournament/__tests__/lifecycle.test.ts`
- `lib/tournament/__tests__/simulator.test.ts`

**Modified:**
- `utils/tournament/pairingUtilsV2.ts` — refactor to delegate to `lib/tournament/`
- `app/tracker/tournaments/[id]/page.tsx` — refactor match-result handler to use `lib/tournament/results.ts`
- `app/tracker/tournaments/actions.ts` — refactor placement calculation to use `lib/tournament/standings.ts`

**Deleted:**
- `utils/tournament/pairingUtils.ts` (dead code, no callers)

---

## Task 1: Baseline + types module

**Files:**
- Create: `lib/tournament/types.ts`

- [ ] **Step 1: Verify existing tests are green before starting**

Run: `npx vitest run lib/cards/__tests__/cardAbilities.test.ts lib/pricing/__tests__ utils/deckcheck/__tests__`
Expected: all tests pass. If any are already failing, stop and surface that to the user before continuing — we don't want to be debugging unrelated failures while doing this work.

- [ ] **Step 2: Create `lib/tournament/types.ts`**

```ts
// lib/tournament/types.ts
//
// Plain data types for the tournament algorithm. No Supabase, no I/O.
// These mirror the DB schema described in prompt_context/algorithm.md
// but use the official terminology from the Redemption Host Guide:
//   match_points (DB) === gameScore (here) === "game score" (official)
//   differential (DB) === lostSoulScore (here) === "lost soul score" (official)

export type ParticipantId = string;
export type MatchId = string;
export type TournamentId = string;

export type MatchOutcome =
  | "full_win"
  | "partial_win"
  | "tie"
  | "partial_loss"
  | "full_loss"
  | "bye"
  | "forfeit"          // outcome for the player who forfeits
  | "forfeit_opponent" // outcome for the player whose opponent forfeits
  | "no_show";         // missed the round entirely (different from forfeit)

export interface Participant {
  id: ParticipantId;
  name: string;
  joinedAt: string; // ISO timestamp; used as deterministic tiebreaker
  droppedOut: boolean;
  /** Round at which the drop took effect (this round's result still counted). */
  dropAfterRound?: number;
}

export interface MatchResult {
  /** Lost souls rescued by player1 (capped at soulCap). */
  p1Souls: number;
  /** Lost souls rescued by player2 (capped at soulCap). */
  p2Souls: number;
  p1Outcome: MatchOutcome;
  p2Outcome: MatchOutcome;
}

export interface Match {
  id: MatchId;
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
  id: TournamentId;
  nRounds: number;
  /** 0 before tournament starts; otherwise the round currently in progress (1..nRounds). */
  currentRound: number;
  /** Win threshold: 5 for Type 1, 7 for Type 2. */
  soulCap: number;
  hasStarted: boolean;
  hasEnded: boolean;
  participants: Participant[];
  matches: Match[];
  byes: Bye[];
}

/** Per-participant aggregate computed from match history. */
export interface ParticipantTotals {
  participantId: ParticipantId;
  gameScore: number;
  lostSoulScore: number;
}

/** A single placement entry in the final standings. */
export interface Placement {
  participantId: ParticipantId;
  /** 1-indexed. Players in a true tie share the same place. */
  place: number;
  gameScore: number;
  lostSoulScore: number;
}
```

- [ ] **Step 3: Type-check the file**

Run: `npx tsc --noEmit lib/tournament/types.ts`
Expected: exits with no output (success). If errors, fix them before continuing.

- [ ] **Step 4: Commit**

```bash
git add lib/tournament/types.ts
git commit -m "tournament: add types module"
```

---

## Task 2: Seeded RNG (`rng.ts`)

**Files:**
- Create: `lib/tournament/rng.ts`
- Test: `lib/tournament/__tests__/rng.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/tournament/__tests__/rng.test.ts
import { describe, it, expect } from 'vitest';
import { fnv1a32, mulberry32, rngForRound } from '../rng';

describe('fnv1a32', () => {
  it('returns 0 hash for empty string', () => {
    expect(fnv1a32('')).toBe(2166136261);
  });

  it('produces stable hashes', () => {
    expect(fnv1a32('hello')).toBe(fnv1a32('hello'));
    expect(fnv1a32('hello')).not.toBe(fnv1a32('world'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = fnv1a32('some-tournament-id:3');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
    expect(Number.isInteger(h)).toBe(true);
  });
});

describe('mulberry32', () => {
  it('returns values in [0, 1)', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces identical sequences for the same seed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });
});

describe('rngForRound', () => {
  it('produces identical sequences for the same (tournamentId, round)', () => {
    const a = rngForRound('tournament-abc', 3);
    const b = rngForRound('tournament-abc', 3);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });

  it('produces different sequences for different rounds', () => {
    const r1 = rngForRound('t', 1);
    const r2 = rngForRound('t', 2);
    expect(r1()).not.toBe(r2());
  });

  it('produces different sequences for different tournaments', () => {
    const a = rngForRound('tournament-a', 1);
    const b = rngForRound('tournament-b', 1);
    expect(a()).not.toBe(b());
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run lib/tournament/__tests__/rng.test.ts`
Expected: FAIL with "Cannot find module '../rng'" or similar.

- [ ] **Step 3: Implement `rng.ts`**

```ts
// lib/tournament/rng.ts
//
// Seeded PRNG for deterministic tournament randomness.
// See prompt_context/algorithm.md "Seeded Randomness" section for rationale.

/** FNV-1a 32-bit hash. Stable across runs and platforms. */
export function fnv1a32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG. Returns a function that emits values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** PRNG seeded from (tournamentId, roundNumber). Same inputs → same sequence. */
export function rngForRound(tournamentId: string, round: number): () => number {
  return mulberry32(fnv1a32(`${tournamentId}:${round}`));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run lib/tournament/__tests__/rng.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/tournament/rng.ts lib/tournament/__tests__/rng.test.ts
git commit -m "tournament: add seeded rng helpers"
```

---

## Task 3: Scoring (`scoring.ts`)

**Files:**
- Create: `lib/tournament/scoring.ts`
- Test: `lib/tournament/__tests__/scoring.test.ts`

This module encodes the per-round game score and lost soul score values from `algorithm.md`. It's pure value-mapping — no state.

- [ ] **Step 1: Write the failing test**

```ts
// lib/tournament/__tests__/scoring.test.ts
import { describe, it, expect } from 'vitest';
import { gameScoreFor, lostSoulScoreFor } from '../scoring';
import type { MatchOutcome } from '../types';

describe('gameScoreFor', () => {
  const cases: Array<[MatchOutcome, number]> = [
    ['full_win', 3],
    ['partial_win', 2],
    ['tie', 1.5],
    ['partial_loss', 1],
    ['full_loss', 0],
    ['bye', 3],
    ['forfeit', 0],
    ['forfeit_opponent', 3],
    ['no_show', 0],
  ];
  it.each(cases)('outcome %s → game score %d', (outcome, score) => {
    expect(gameScoreFor(outcome)).toBe(score);
  });
});

describe('lostSoulScoreFor', () => {
  it('played match: returns own_souls − opponent_souls (Type 1, cap 5)', () => {
    expect(lostSoulScoreFor('full_win', 5, 3, 5)).toBe(2);
    expect(lostSoulScoreFor('full_loss', 3, 5, 5)).toBe(-2);
    expect(lostSoulScoreFor('partial_win', 4, 1, 5)).toBe(3);
    expect(lostSoulScoreFor('partial_loss', 1, 4, 5)).toBe(-3);
  });

  it('played match: returns own_souls − opponent_souls (Type 2, cap 7)', () => {
    expect(lostSoulScoreFor('full_win', 7, 4, 7)).toBe(3);
    expect(lostSoulScoreFor('partial_win', 6, 2, 7)).toBe(4);
  });

  it('caps souls at the win threshold N before subtracting', () => {
    // Even if a wild input had souls beyond cap, they are capped first.
    expect(lostSoulScoreFor('full_win', 99, 0, 5)).toBe(5);
    expect(lostSoulScoreFor('full_loss', 0, 99, 5)).toBe(-5);
  });

  it('tied game returns 0 regardless of souls', () => {
    expect(lostSoulScoreFor('tie', 4, 4, 5)).toBe(0);
    expect(lostSoulScoreFor('tie', 2, 2, 7)).toBe(0);
  });

  it('bye returns 0', () => {
    expect(lostSoulScoreFor('bye', 0, 0, 5)).toBe(0);
  });

  it('forfeiter returns literal -5 (per official rules, not scaled to N)', () => {
    expect(lostSoulScoreFor('forfeit', 0, 0, 5)).toBe(-5);
    expect(lostSoulScoreFor('forfeit', 0, 0, 7)).toBe(-5);
  });

  it('forfeit_opponent returns 0', () => {
    expect(lostSoulScoreFor('forfeit_opponent', 0, 0, 5)).toBe(0);
  });

  it('no_show returns 0', () => {
    expect(lostSoulScoreFor('no_show', 0, 0, 5)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run lib/tournament/__tests__/scoring.test.ts`
Expected: FAIL with "Cannot find module '../scoring'" or similar.

- [ ] **Step 3: Implement `scoring.ts`**

```ts
// lib/tournament/scoring.ts
//
// Per-round game score and lost-soul-score values per the table in
// prompt_context/algorithm.md.

import type { MatchOutcome } from './types';

const GAME_SCORE: Record<MatchOutcome, number> = {
  full_win: 3,
  partial_win: 2,
  tie: 1.5,
  partial_loss: 1,
  full_loss: 0,
  bye: 3,
  forfeit: 0,
  forfeit_opponent: 3,
  no_show: 0,
};

export function gameScoreFor(outcome: MatchOutcome): number {
  return GAME_SCORE[outcome];
}

/**
 * Per-round lost soul score for the player whose perspective we're computing.
 * `ownSouls` and `opponentSouls` are first capped at the win threshold N.
 * For non-played outcomes (bye, forfeit, no_show, tie) the souls inputs
 * are ignored and the rule-table value is returned.
 */
export function lostSoulScoreFor(
  outcome: MatchOutcome,
  ownSouls: number,
  opponentSouls: number,
  soulCap: number,
): number {
  switch (outcome) {
    case 'tie':
    case 'bye':
    case 'forfeit_opponent':
    case 'no_show':
      return 0;
    case 'forfeit':
      // Official rule: forfeiter is -5 literal, not scaled to N.
      return -5;
    case 'full_win':
    case 'partial_win':
    case 'full_loss':
    case 'partial_loss': {
      const own = Math.min(ownSouls, soulCap);
      const opp = Math.min(opponentSouls, soulCap);
      return own - opp;
    }
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run lib/tournament/__tests__/scoring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournament/scoring.ts lib/tournament/__tests__/scoring.test.ts
git commit -m "tournament: add per-round scoring functions"
```

---

## Task 4: Bye selection (`pairing.ts` part 1)

**Files:**
- Create: `lib/tournament/pairing.ts` (start with just `selectBye`)
- Test: `lib/tournament/__tests__/pairing.test.ts` (start with bye-selection tests)

This implements the new "fewest byes wins" algorithm from `algorithm.md`. The active sort is `(gameScore DESC, lostSoulScore DESC)`; bye-selection ranks bottom of that list within the candidate subset.

- [ ] **Step 1: Write the failing test for `selectBye`**

```ts
// lib/tournament/__tests__/pairing.test.ts
import { describe, it, expect } from 'vitest';
import { selectBye } from '../pairing';
import { rngForRound } from '../rng';
import type { Participant } from '../types';

// Helper: build a participant with score + bye history.
function p(
  id: string,
  gameScore: number,
  lostSoulScore: number,
  joinedAt = '2026-01-01T00:00:00Z',
): { id: string; gameScore: number; lostSoulScore: number; joinedAt: string } {
  return { id, gameScore, lostSoulScore, joinedAt };
}

describe('selectBye', () => {
  // Sort order in tests: highest-ranked first. selectBye picks bottom-ranked
  // from within the min-bye subset.
  const sorted = [
    p('A', 9, 5),
    p('B', 6, 0),
    p('C', 3, -2),
    p('D', 0, -5),
  ];

  it('picks lowest-ranked when no one has byed', () => {
    const result = selectBye(sorted, new Map(), new Set(), () => 0);
    expect(result).toBe('D');
  });

  it('skips players who have already byed if alternates exist with fewer byes', () => {
    const byeCounts = new Map([['D', 1]]);
    const result = selectBye(sorted, byeCounts, new Set(), () => 0);
    // D has 1 bye; A/B/C have 0. Min is 0; lowest-ranked of those is C.
    expect(result).toBe('C');
  });

  it('once everyone has byed, picks lowest-ranked at min count', () => {
    const byeCounts = new Map([['A', 2], ['B', 1], ['C', 1], ['D', 1]]);
    const result = selectBye(sorted, byeCounts, new Set(), () => 0);
    // Min bye count is 1 (B, C, D). Lowest-ranked of those is D.
    expect(result).toBe('D');
  });

  it('avoids back-to-back byes when an alternate at the same min count exists', () => {
    const byeCounts = new Map([['A', 1], ['B', 1], ['C', 1], ['D', 1]]);
    const prevRoundByes = new Set(['D']);
    const result = selectBye(sorted, byeCounts, prevRoundByes, () => 0);
    // Min is 1. Lowest-ranked is D, but D byed last round. Next-lowest at min is C.
    expect(result).toBe('C');
  });

  it('falls back to lowest-ranked even if they byed last round, when no alternate exists', () => {
    // Only D is at the min count, and D byed last round. Pick D anyway.
    const byeCounts = new Map([['A', 2], ['B', 2], ['C', 2], ['D', 1]]);
    const prevRoundByes = new Set(['D']);
    const result = selectBye(sorted, byeCounts, prevRoundByes, () => 0);
    expect(result).toBe('D');
  });

  it('breaks true ties using the seeded RNG (deterministic)', () => {
    // Two players truly tied: same score, same bye count, same prev-round status.
    const tied = [
      p('A', 5, 0),
      p('B', 5, 0),
    ];
    const byeCounts = new Map([['A', 1], ['B', 1]]);
    const rng1 = rngForRound('tournament-x', 5);
    const rng2 = rngForRound('tournament-x', 5);
    const r1 = selectBye(tied, byeCounts, new Set(), rng1);
    const r2 = selectBye(tied, byeCounts, new Set(), rng2);
    expect(r1).toBe(r2);
    expect(['A', 'B']).toContain(r1);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run lib/tournament/__tests__/pairing.test.ts`
Expected: FAIL with "Cannot find module '../pairing'" or similar.

- [ ] **Step 3: Implement `selectBye` in `pairing.ts`**

```ts
// lib/tournament/pairing.ts
//
// Pairing algorithm per prompt_context/algorithm.md.
// All randomness flows through a passed-in PRNG so tests are deterministic.

/**
 * Minimal player shape for bye selection.
 * The full Participant type isn't needed here — only the sortable score fields.
 */
export interface ByeCandidate {
  id: string;
  gameScore: number;
  lostSoulScore: number;
  joinedAt: string;
}

/**
 * Pick the participant who should receive the bye for the current round.
 *
 * Algorithm per algorithm.md "Round Pairing — Later Rounds, step 2":
 *   1. Filter to candidates with the minimum total bye count.
 *   2. Take the lowest-ranked (bottom of the input sort).
 *   3. If they byed last round and another candidate at min count exists, prefer the other.
 *   4. Final tiebreak: seeded RNG.
 *
 * @param sortedActive - Active (non-dropped) players, already sorted highest-to-lowest by (gameScore DESC, lostSoulScore DESC).
 * @param byeCount - Total byes received per participantId across all prior rounds.
 * @param prevRoundByes - Set of participantIds who byed in the immediately previous round.
 * @param rng - Seeded PRNG (e.g. from rngForRound). Consumed only on true ties.
 * @returns The participantId selected for the bye.
 */
export function selectBye(
  sortedActive: ByeCandidate[],
  byeCount: Map<string, number>,
  prevRoundByes: Set<string>,
  rng: () => number,
): string {
  if (sortedActive.length === 0) {
    throw new Error('selectBye called with empty pool');
  }

  // Step 1: find min bye count and filter to that subset.
  const counts = sortedActive.map(p => byeCount.get(p.id) ?? 0);
  const minCount = Math.min(...counts);
  const atMin = sortedActive.filter(p => (byeCount.get(p.id) ?? 0) === minCount);

  // Step 2: bottom of input sort = last element of atMin
  // (sortedActive is highest-first; atMin preserves that order).
  // Step 3: avoid back-to-back if alternate exists.
  const bottom = atMin[atMin.length - 1];
  if (prevRoundByes.has(bottom.id) && atMin.length > 1) {
    // Find the next-lowest who didn't bye last round.
    for (let i = atMin.length - 2; i >= 0; i--) {
      if (!prevRoundByes.has(atMin[i].id)) {
        return atMin[i].id;
      }
    }
    // Fall through: every candidate in atMin byed last round (extremely rare).
  }

  // Step 4: detect true ties at the bottom (identical scores).
  // A "tie" is multiple atMin entries sharing the same (gameScore, lostSoulScore)
  // as the bottom candidate — the deterministic-by-input-order pick would
  // otherwise be biased by upstream sort stability.
  const ties = atMin.filter(
    p => p.gameScore === bottom.gameScore && p.lostSoulScore === bottom.lostSoulScore,
  );
  if (ties.length === 1) {
    return bottom.id;
  }
  const idx = Math.floor(rng() * ties.length);
  return ties[idx].id;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run lib/tournament/__tests__/pairing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournament/pairing.ts lib/tournament/__tests__/pairing.test.ts
git commit -m "tournament: implement bye selection"
```

---

## Task 5: First-round pairing (`pairing.ts` part 2)

**Files:**
- Modify: `lib/tournament/pairing.ts` (add `pairFirstRound`)
- Modify: `lib/tournament/__tests__/pairing.test.ts` (add tests)

- [ ] **Step 1: Append the failing tests to `pairing.test.ts`**

Append at the bottom of `lib/tournament/__tests__/pairing.test.ts`:

```ts
import { pairFirstRound } from '../pairing';
import type { Participant } from '../types';

function makeParticipant(id: string, name = id): Participant {
  return {
    id,
    name,
    joinedAt: '2026-01-01T00:00:00Z',
    droppedOut: false,
  };
}

describe('pairFirstRound', () => {
  it('pairs an even number of players, no bye', () => {
    const participants = ['A', 'B', 'C', 'D'].map(makeParticipant);
    const rng = rngForRound('t1', 1);
    const result = pairFirstRound(participants, rng);
    expect(result.bye).toBeUndefined();
    expect(result.matches).toHaveLength(2);
    // Each participant appears in exactly one match.
    const ids = new Set<string>();
    for (const m of result.matches) {
      ids.add(m.player1Id);
      ids.add(m.player2Id);
    }
    expect(ids).toEqual(new Set(['A', 'B', 'C', 'D']));
    // match_order is 1..N
    expect(result.matches.map(m => m.matchOrder)).toEqual([1, 2]);
  });

  it('produces a bye when player count is odd', () => {
    const participants = ['A', 'B', 'C'].map(makeParticipant);
    const rng = rngForRound('t1', 1);
    const result = pairFirstRound(participants, rng);
    expect(result.bye).toBeDefined();
    expect(['A', 'B', 'C']).toContain(result.bye!);
    expect(result.matches).toHaveLength(1);
    // The bye player is NOT in any match.
    for (const m of result.matches) {
      expect(m.player1Id).not.toBe(result.bye);
      expect(m.player2Id).not.toBe(result.bye);
    }
  });

  it('is deterministic given the same RNG', () => {
    const participants = ['A', 'B', 'C', 'D', 'E', 'F'].map(makeParticipant);
    const r1 = pairFirstRound(participants, rngForRound('t-fixed', 1));
    const r2 = pairFirstRound(participants, rngForRound('t-fixed', 1));
    expect(r1).toEqual(r2);
  });

  it('throws if fewer than 2 participants', () => {
    expect(() => pairFirstRound([makeParticipant('A')], rngForRound('t', 1)))
      .toThrow();
    expect(() => pairFirstRound([], rngForRound('t', 1)))
      .toThrow();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run lib/tournament/__tests__/pairing.test.ts`
Expected: existing `selectBye` tests still pass; new `pairFirstRound` tests fail with "pairFirstRound is not a function" or "not exported."

- [ ] **Step 3: Implement `pairFirstRound` (append to `pairing.ts`)**

Append to `lib/tournament/pairing.ts`:

```ts
import type { Match, Participant } from './types';

/** Output of a pairing function: a list of matches and an optional bye player. */
export interface PairingResult {
  matches: Array<Pick<Match, 'round' | 'player1Id' | 'player2Id' | 'matchOrder'>>;
  bye?: string;
}

/** Fisher-Yates shuffle using the supplied PRNG. Pure: returns a new array. */
function shuffle<T>(array: T[], rng: () => number): T[] {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Random pairings for the first round. Per algorithm.md:
 * - Pairings are random.
 * - If odd number of players, one is selected at random for the bye.
 *
 * RNG draws are stable order: bye-selection draw first, then shuffle of remaining.
 */
export function pairFirstRound(
  participants: Participant[],
  rng: () => number,
): PairingResult {
  if (participants.length < 2) {
    throw new Error(`pairFirstRound requires at least 2 participants, got ${participants.length}`);
  }

  let pool = [...participants];
  let bye: string | undefined;
  if (pool.length % 2 !== 0) {
    const idx = Math.floor(rng() * pool.length);
    bye = pool[idx].id;
    pool = pool.filter((_, i) => i !== idx);
  }

  const shuffled = shuffle(pool, rng);
  const matches: PairingResult['matches'] = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    matches.push({
      round: 1,
      player1Id: shuffled[i].id,
      player2Id: shuffled[i + 1].id,
      matchOrder: matches.length + 1,
    });
  }
  return { matches, bye };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run lib/tournament/__tests__/pairing.test.ts`
Expected: all tests pass (selectBye + pairFirstRound).

- [ ] **Step 5: Commit**

```bash
git add lib/tournament/pairing.ts lib/tournament/__tests__/pairing.test.ts
git commit -m "tournament: implement first-round pairing"
```

---

## Task 6: Later-round pairing (`pairing.ts` part 3)

**Files:**
- Modify: `lib/tournament/pairing.ts` (add `pairLaterRound`)
- Modify: `lib/tournament/__tests__/pairing.test.ts` (add tests)

This is the heart of the algorithm: sort, select bye if needed, greedy pair top-down avoiding rematches, fall back to rematches if locked.

- [ ] **Step 1: Append the failing tests to `pairing.test.ts`**

Append:

```ts
import { pairLaterRound } from '../pairing';
import type { TournamentState, Match, Bye } from '../types';

function tState(
  participants: Participant[],
  matches: Match[] = [],
  byes: Bye[] = [],
  opts: Partial<TournamentState> = {},
): TournamentState {
  return {
    id: 't1',
    nRounds: 4,
    currentRound: 1,
    soulCap: 5,
    hasStarted: true,
    hasEnded: false,
    participants,
    matches,
    byes,
    ...opts,
  };
}

function recordedMatch(
  round: number,
  p1: string,
  p2: string,
  p1Outcome: any,
  p2Outcome: any,
  p1Souls = 5,
  p2Souls = 0,
): Match {
  return {
    id: `m-${round}-${p1}-${p2}`,
    round,
    player1Id: p1,
    player2Id: p2,
    matchOrder: 1,
    result: { p1Souls, p2Souls, p1Outcome, p2Outcome },
  };
}

describe('pairLaterRound', () => {
  it('sorts by (gameScore DESC, lostSoulScore DESC) and pairs top-down', () => {
    // Pre-state: round 1 played. A>B, C>D.
    const participants = ['A', 'B', 'C', 'D'].map(makeParticipant);
    const matches = [
      recordedMatch(1, 'A', 'B', 'full_win', 'full_loss'),
      recordedMatch(1, 'C', 'D', 'full_win', 'full_loss'),
    ];
    const state = tState(participants, matches);
    const result = pairLaterRound(state, 2, rngForRound('t1', 2));
    expect(result.bye).toBeUndefined();
    expect(result.matches).toHaveLength(2);
    // After R1: A & C have 3 game score, B & D have 0. Sort puts A,C on top.
    // Top-down: A vs C (haven't played); B vs D (haven't played).
    // OR depending on (lostSoulScore): A=+5, C=+5 same; B=-5, D=-5 same.
    // Result is deterministic given input order — A first, then C.
    const pairs = result.matches.map(m => [m.player1Id, m.player2Id].sort()).map(s => s.join(','));
    expect(pairs).toContain('A,C');
    expect(pairs).toContain('B,D');
  });

  it('avoids rematches in the greedy pass', () => {
    // 4 players, 2 rounds played. R1: A-B, C-D. R2: A-C, B-D.
    // R3: greedy must pair A-D and B-C (no rematches).
    const participants = ['A', 'B', 'C', 'D'].map(makeParticipant);
    const matches = [
      recordedMatch(1, 'A', 'B', 'full_win', 'full_loss'),
      recordedMatch(1, 'C', 'D', 'full_win', 'full_loss'),
      recordedMatch(2, 'A', 'C', 'full_win', 'full_loss'),
      recordedMatch(2, 'B', 'D', 'full_win', 'full_loss'),
    ];
    const state = tState(participants, matches);
    const result = pairLaterRound(state, 3, rngForRound('t1', 3));
    const pairs = result.matches.map(m => [m.player1Id, m.player2Id].sort().join(','));
    expect(pairs.sort()).toEqual(['A,D', 'B,C']);
  });

  it('falls back to rematches when greedy locks up', () => {
    // 4 players, 3 rounds played: A-B, C-D / A-C, B-D / A-D, B-C.
    // R4 must rematch — every pair has played.
    const participants = ['A', 'B', 'C', 'D'].map(makeParticipant);
    const matches = [
      recordedMatch(1, 'A', 'B', 'full_win', 'full_loss'),
      recordedMatch(1, 'C', 'D', 'full_win', 'full_loss'),
      recordedMatch(2, 'A', 'C', 'full_win', 'full_loss'),
      recordedMatch(2, 'B', 'D', 'full_win', 'full_loss'),
      recordedMatch(3, 'A', 'D', 'full_win', 'full_loss'),
      recordedMatch(3, 'B', 'C', 'full_win', 'full_loss'),
    ];
    const state = tState(participants, matches);
    const result = pairLaterRound(state, 4, rngForRound('t1', 4));
    expect(result.matches).toHaveLength(2);
    // All 4 players paired exactly once.
    const all = new Set<string>();
    for (const m of result.matches) {
      all.add(m.player1Id);
      all.add(m.player2Id);
    }
    expect(all).toEqual(new Set(['A', 'B', 'C', 'D']));
  });

  it('selects bye for odd active count', () => {
    const participants = ['A', 'B', 'C'].map(makeParticipant);
    const matches = [
      // R1: A had bye, B-C played.
      recordedMatch(1, 'B', 'C', 'full_win', 'full_loss'),
    ];
    const byes = [{ participantId: 'A', round: 1 }];
    const state = tState(participants, matches, byes);
    const result = pairLaterRound(state, 2, rngForRound('t1', 2));
    // After R1: A=3 (bye), B=3, C=0. Min byes: B,C have 0; A has 1.
    // Bye candidates = {B, C}. Bottom of (gs, lss) sort: C (lss = -5).
    expect(result.bye).toBe('C');
    expect(result.matches).toHaveLength(1);
    expect([result.matches[0].player1Id, result.matches[0].player2Id].sort()).toEqual(['A', 'B']);
  });

  it('excludes dropped-out players from the pool', () => {
    const participants: Participant[] = [
      { ...makeParticipant('A'), droppedOut: true, dropAfterRound: 1 },
      makeParticipant('B'),
      makeParticipant('C'),
    ];
    const matches = [
      recordedMatch(1, 'A', 'B', 'full_loss', 'full_win'),
    ];
    const byes = [{ participantId: 'C', round: 1 }];
    const state = tState(participants, matches, byes);
    const result = pairLaterRound(state, 2, rngForRound('t1', 2));
    // Active = {B, C}, even count, no bye.
    expect(result.bye).toBeUndefined();
    expect(result.matches).toHaveLength(1);
    const ids = [result.matches[0].player1Id, result.matches[0].player2Id].sort();
    expect(ids).toEqual(['B', 'C']);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run lib/tournament/__tests__/pairing.test.ts`
Expected: existing tests pass, new `pairLaterRound` tests fail with "pairLaterRound is not a function" or similar.

- [ ] **Step 3: Implement `pairLaterRound` (append to `pairing.ts`)**

Append to `lib/tournament/pairing.ts`:

```ts
import { gameScoreFor, lostSoulScoreFor } from './scoring';
import type { TournamentState } from './types';

interface ScoredPlayer extends ByeCandidate {
  participant: Participant;
}

/**
 * Compute (gameScore, lostSoulScore) for each active participant from
 * match + bye history up through (but not including) the given round.
 * This is identical in spirit to recomputeTotalsFromHistory in results.ts;
 * we duplicate it here to avoid a circular import. (The shared helper
 * would otherwise live in a 4th module.)
 */
function totalsForRound(state: TournamentState, round: number): Map<string, ScoredPlayer> {
  const map = new Map<string, ScoredPlayer>();
  for (const part of state.participants) {
    if (part.droppedOut) continue;
    map.set(part.id, {
      id: part.id,
      gameScore: 0,
      lostSoulScore: 0,
      joinedAt: part.joinedAt,
      participant: part,
    });
  }
  for (const m of state.matches) {
    if (m.round >= round || !m.result) continue;
    const p1 = map.get(m.player1Id);
    const p2 = map.get(m.player2Id);
    if (p1) {
      p1.gameScore += gameScoreFor(m.result.p1Outcome);
      p1.lostSoulScore += lostSoulScoreFor(
        m.result.p1Outcome, m.result.p1Souls, m.result.p2Souls, state.soulCap,
      );
    }
    if (p2) {
      p2.gameScore += gameScoreFor(m.result.p2Outcome);
      p2.lostSoulScore += lostSoulScoreFor(
        m.result.p2Outcome, m.result.p2Souls, m.result.p1Souls, state.soulCap,
      );
    }
  }
  for (const b of state.byes) {
    if (b.round >= round) continue;
    const p = map.get(b.participantId);
    if (p) p.gameScore += 3; // bye = 3 game score, 0 lost soul score
  }
  return map;
}

function comparePlayers(a: ScoredPlayer, b: ScoredPlayer): number {
  // Higher gameScore first, then higher lostSoulScore first.
  if (a.gameScore !== b.gameScore) return b.gameScore - a.gameScore;
  return b.lostSoulScore - a.lostSoulScore;
}

/**
 * Build the set of "already played" pairs across all prior matches.
 * Returns a Set keyed as `${a}|${b}` where a < b lexicographically.
 */
function playedKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Pair a non-first round per algorithm.md "Round Pairing — Later Rounds":
 *  1. Sort active players by (gameScore DESC, lostSoulScore DESC).
 *  2. If odd, select bye via selectBye().
 *  3. Greedy top-down: for each unassigned player from the top, find the
 *     highest-ranked unassigned player they have not played; pair them.
 *  4. Rematch fallback: any leftover unpaired players are paired in
 *     remaining-list order, even if they've played.
 *  5. Defensive lone-bye: if exactly one player is left unpaired (shouldn't
 *     happen with even pool), give them a bye.
 */
export function pairLaterRound(
  state: TournamentState,
  round: number,
  rng: () => number,
): PairingResult {
  // Build totals + sort active.
  const totals = totalsForRound(state, round);
  const active = state.participants
    .filter(p => !p.droppedOut)
    .map(p => totals.get(p.id)!)
    .sort(comparePlayers);

  // Played pairs and bye history.
  const played = new Set<string>();
  for (const m of state.matches) {
    if (m.round < round) played.add(playedKey(m.player1Id, m.player2Id));
  }
  const byeCount = new Map<string, number>();
  const prevRoundByes = new Set<string>();
  for (const b of state.byes) {
    if (b.round >= round) continue;
    byeCount.set(b.participantId, (byeCount.get(b.participantId) ?? 0) + 1);
    if (b.round === round - 1) prevRoundByes.add(b.participantId);
  }

  // Step 2: bye selection if odd.
  let pool = active;
  let bye: string | undefined;
  if (pool.length % 2 !== 0) {
    bye = selectBye(pool, byeCount, prevRoundByes, rng);
    pool = pool.filter(p => p.id !== bye);
  }

  // Step 3: greedy pairing.
  const matches: PairingResult['matches'] = [];
  const assigned = new Set<string>();
  for (let i = 0; i < pool.length; i++) {
    const p1 = pool[i];
    if (assigned.has(p1.id)) continue;
    const partner = pool.slice(i + 1).find(
      p => !assigned.has(p.id) && !played.has(playedKey(p1.id, p.id)),
    );
    if (partner) {
      matches.push({
        round,
        player1Id: p1.id,
        player2Id: partner.id,
        matchOrder: matches.length + 1,
      });
      assigned.add(p1.id);
      assigned.add(partner.id);
    }
  }

  // Step 4: rematch fallback for any leftovers.
  const leftover = pool.filter(p => !assigned.has(p.id));
  while (leftover.length >= 2) {
    const p1 = leftover.shift()!;
    const p2 = leftover.shift()!;
    matches.push({
      round,
      player1Id: p1.id,
      player2Id: p2.id,
      matchOrder: matches.length + 1,
    });
  }

  // Step 5: defensive lone-bye.
  if (leftover.length === 1 && !bye) {
    bye = leftover[0].id;
  }

  return { matches, bye };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run lib/tournament/__tests__/pairing.test.ts`
Expected: all pairing tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/tournament/pairing.ts lib/tournament/__tests__/pairing.test.ts
git commit -m "tournament: implement later-round pairing with greedy + rematch fallback"
```

---

## Task 7: Results — apply + recompute (`results.ts`)

**Files:**
- Create: `lib/tournament/results.ts`
- Test: `lib/tournament/__tests__/results.test.ts`

This is the module that fixes the **double-count bug**: `recomputeTotalsFromHistory` is the single source of truth for participant totals.

- [ ] **Step 1: Write the failing test**

```ts
// lib/tournament/__tests__/results.test.ts
import { describe, it, expect } from 'vitest';
import { applyResult, recomputeTotalsFromHistory } from '../results';
import type { TournamentState, Match, Participant, Bye, MatchResult } from '../types';

function p(id: string, droppedOut = false): Participant {
  return { id, name: id, joinedAt: '2026-01-01T00:00:00Z', droppedOut };
}

function emptyState(participants: Participant[]): TournamentState {
  return {
    id: 't1',
    nRounds: 3,
    currentRound: 1,
    soulCap: 5,
    hasStarted: true,
    hasEnded: false,
    participants,
    matches: [],
    byes: [],
  };
}

const m = (id: string, round: number, p1: string, p2: string): Match => ({
  id, round, player1Id: p1, player2Id: p2, matchOrder: 1,
});

describe('applyResult', () => {
  it('attaches a result to the targeted match without mutating others', () => {
    const state: TournamentState = {
      ...emptyState([p('A'), p('B'), p('C'), p('D')]),
      matches: [m('m1', 1, 'A', 'B'), m('m2', 1, 'C', 'D')],
    };
    const result: MatchResult = {
      p1Souls: 5, p2Souls: 2, p1Outcome: 'full_win', p2Outcome: 'full_loss',
    };
    const next = applyResult(state, 'm1', result);
    expect(next.matches.find(x => x.id === 'm1')?.result).toEqual(result);
    expect(next.matches.find(x => x.id === 'm2')?.result).toBeUndefined();
    // Original state is unchanged (immutability).
    expect(state.matches.find(x => x.id === 'm1')?.result).toBeUndefined();
  });

  it('overwrites an existing result (used for edits)', () => {
    const state: TournamentState = {
      ...emptyState([p('A'), p('B')]),
      matches: [{ ...m('m1', 1, 'A', 'B'), result: { p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss' } }],
    };
    const edited: MatchResult = { p1Souls: 4, p2Souls: 4, p1Outcome: 'tie', p2Outcome: 'tie' };
    const next = applyResult(state, 'm1', edited);
    expect(next.matches[0].result).toEqual(edited);
  });

  it('throws if matchId not found', () => {
    const state = emptyState([p('A'), p('B')]);
    const result: MatchResult = { p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss' };
    expect(() => applyResult(state, 'nonexistent', result)).toThrow();
  });
});

describe('recomputeTotalsFromHistory', () => {
  it('returns zeros when no matches or byes have happened', () => {
    const state = emptyState([p('A'), p('B')]);
    expect(recomputeTotalsFromHistory('A', state)).toEqual({
      participantId: 'A', gameScore: 0, lostSoulScore: 0,
    });
  });

  it('sums game scores and lost soul scores across rounds', () => {
    const state: TournamentState = {
      ...emptyState([p('A'), p('B')]),
      matches: [
        { ...m('m1', 1, 'A', 'B'), result: { p1Souls: 5, p2Souls: 2, p1Outcome: 'full_win', p2Outcome: 'full_loss' } },
        { ...m('m2', 2, 'A', 'B'), result: { p1Souls: 4, p2Souls: 4, p1Outcome: 'tie', p2Outcome: 'tie' } },
      ],
    };
    // R1: A → 3 game, +3 lost soul. R2: A → 1.5 game, 0 lost soul. Total: 4.5 / 3
    expect(recomputeTotalsFromHistory('A', state)).toEqual({
      participantId: 'A', gameScore: 4.5, lostSoulScore: 3,
    });
    // R1: B → 0 game, -3 lost soul. R2: B → 1.5 game, 0 lost soul.
    expect(recomputeTotalsFromHistory('B', state)).toEqual({
      participantId: 'B', gameScore: 1.5, lostSoulScore: -3,
    });
  });

  it('counts byes (3 game score, 0 lost soul score)', () => {
    const state: TournamentState = {
      ...emptyState([p('A'), p('B'), p('C')]),
      matches: [
        { ...m('m1', 1, 'A', 'B'), result: { p1Souls: 5, p2Souls: 1, p1Outcome: 'full_win', p2Outcome: 'full_loss' } },
      ],
      byes: [{ participantId: 'C', round: 1 }],
    };
    expect(recomputeTotalsFromHistory('C', state)).toEqual({
      participantId: 'C', gameScore: 3, lostSoulScore: 0,
    });
  });

  it('REGRESSION: editing a result and re-applying produces correct totals (not 2× delta)', () => {
    // Simulate the historical bug: submit, then edit. With recompute-from-history,
    // the edited totals must equal a fresh compute, regardless of how many times
    // we edited.
    let state: TournamentState = {
      ...emptyState([p('A'), p('B')]),
      matches: [m('m1', 1, 'A', 'B')],
    };
    state = applyResult(state, 'm1', {
      p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss',
    });
    expect(recomputeTotalsFromHistory('A', state).gameScore).toBe(3);
    // Now edit to a tie.
    state = applyResult(state, 'm1', {
      p1Souls: 4, p2Souls: 4, p1Outcome: 'tie', p2Outcome: 'tie',
    });
    expect(recomputeTotalsFromHistory('A', state).gameScore).toBe(1.5);
    expect(recomputeTotalsFromHistory('A', state).lostSoulScore).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run lib/tournament/__tests__/results.test.ts`
Expected: FAIL with "Cannot find module '../results'."

- [ ] **Step 3: Implement `results.ts`**

```ts
// lib/tournament/results.ts
//
// Apply match results and recompute participant totals from match history.
// recomputeTotalsFromHistory is the load-bearing fix for the
// "edit doubles the score" bug — totals are derived, never incremented.

import { gameScoreFor, lostSoulScoreFor } from './scoring';
import type { TournamentState, MatchResult, ParticipantId, ParticipantTotals } from './types';

/** Return a new state with the given match's result attached/overwritten. */
export function applyResult(
  state: TournamentState,
  matchId: string,
  result: MatchResult,
): TournamentState {
  const idx = state.matches.findIndex(m => m.id === matchId);
  if (idx === -1) {
    throw new Error(`applyResult: match ${matchId} not found`);
  }
  const matches = state.matches.slice();
  matches[idx] = { ...matches[idx], result };
  return { ...state, matches };
}

/**
 * Recompute (gameScore, lostSoulScore) for one participant from match + bye history.
 * Always derived; never incremented. Editing a match result and re-running this
 * yields the correct total regardless of prior edit history.
 */
export function recomputeTotalsFromHistory(
  participantId: ParticipantId,
  state: TournamentState,
): ParticipantTotals {
  let gameScore = 0;
  let lostSoulScore = 0;
  for (const m of state.matches) {
    if (!m.result) continue;
    if (m.player1Id === participantId) {
      gameScore += gameScoreFor(m.result.p1Outcome);
      lostSoulScore += lostSoulScoreFor(
        m.result.p1Outcome, m.result.p1Souls, m.result.p2Souls, state.soulCap,
      );
    } else if (m.player2Id === participantId) {
      gameScore += gameScoreFor(m.result.p2Outcome);
      lostSoulScore += lostSoulScoreFor(
        m.result.p2Outcome, m.result.p2Souls, m.result.p1Souls, state.soulCap,
      );
    }
  }
  for (const b of state.byes) {
    if (b.participantId === participantId) {
      gameScore += 3;
      // bye lost soul score = 0; no change.
    }
  }
  return { participantId, gameScore, lostSoulScore };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run lib/tournament/__tests__/results.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournament/results.ts lib/tournament/__tests__/results.test.ts
git commit -m "tournament: implement applyResult + recomputeTotalsFromHistory"
```

---

## Task 8: Final standings with head-to-head (`standings.ts`)

**Files:**
- Create: `lib/tournament/standings.ts`
- Test: `lib/tournament/__tests__/standings.test.ts`

This module fixes the **missing head-to-head bug**. After sorting by `gameScore DESC`, players tied on game score have their tie broken by head-to-head first, then lost soul score, then joint placement.

- [ ] **Step 1: Write the failing test**

```ts
// lib/tournament/__tests__/standings.test.ts
import { describe, it, expect } from 'vitest';
import { computeFinalStandings } from '../standings';
import type { TournamentState, Participant, Match, Bye } from '../types';

function p(id: string, droppedOut = false): Participant {
  return { id, name: id, joinedAt: '2026-01-01T00:00:00Z', droppedOut };
}

function fullWin(round: number, winner: string, loser: string): Match {
  return {
    id: `${round}-${winner}-${loser}`,
    round,
    player1Id: winner,
    player2Id: loser,
    matchOrder: 1,
    result: { p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss' },
  };
}

function state(participants: Participant[], matches: Match[], byes: Bye[] = []): TournamentState {
  return {
    id: 't1', nRounds: 3, currentRound: 3, soulCap: 5,
    hasStarted: true, hasEnded: true, participants, matches, byes,
  };
}

describe('computeFinalStandings', () => {
  it('orders by game score (no ties)', () => {
    // A 3-0, B 2-1, C 1-2, D 0-3 over 3 rounds.
    const ps = ['A', 'B', 'C', 'D'].map(x => p(x));
    const matches: Match[] = [
      fullWin(1, 'A', 'D'), fullWin(1, 'B', 'C'),
      fullWin(2, 'A', 'C'), fullWin(2, 'B', 'D'),
      fullWin(3, 'A', 'B'), fullWin(3, 'C', 'D'),
    ];
    const standings = computeFinalStandings(state(ps, matches));
    expect(standings.map(s => s.participantId)).toEqual(['A', 'B', 'C', 'D']);
    expect(standings.map(s => s.place)).toEqual([1, 2, 3, 4]);
  });

  it('head-to-head wins over LSS: A and B tied on game score, A beat B → A ranks higher', () => {
    // 3 players, 2 rounds.
    // R1: A beats B (5-3); C has bye.
    // R2: A vs C (C wins 5-0); B has bye.
    // Final game scores:  A=3, B=3 (tied), C=6
    // Final LSS:          A=+2-5=-3, B=-2 (R1) + 0 (R2 bye)=-2, C=0+5=+5
    // Without head-to-head: B (-2) ranks above A (-3) by LSS.
    // With head-to-head:    A beat B directly → A ranks above B.
    const ps = ['A', 'B', 'C'].map(x => p(x));
    const matches: Match[] = [
      { id: '1', round: 1, player1Id: 'A', player2Id: 'B', matchOrder: 1,
        result: { p1Souls: 5, p2Souls: 3, p1Outcome: 'full_win', p2Outcome: 'full_loss' } },
      { id: '2', round: 2, player1Id: 'A', player2Id: 'C', matchOrder: 1,
        result: { p1Souls: 0, p2Souls: 5, p1Outcome: 'full_loss', p2Outcome: 'full_win' } },
    ];
    const byes: Bye[] = [
      { participantId: 'C', round: 1 },
      { participantId: 'B', round: 2 },
    ];
    const standings = computeFinalStandings(state(ps, matches, byes));
    expect(standings.find(s => s.participantId === 'C')?.place).toBe(1);
    expect(standings.find(s => s.participantId === 'A')?.place).toBe(2);
    expect(standings.find(s => s.participantId === 'B')?.place).toBe(3);
  });

  it('falls back to lost soul score when head-to-head has no clean winner', () => {
    // 3-way tie with cyclic head-to-head: A>B, B>C, C>A.
    const ps = ['A', 'B', 'C'].map(x => p(x));
    const matches: Match[] = [
      // R1: A>B
      { id: '1', round: 1, player1Id: 'A', player2Id: 'B', matchOrder: 1,
        result: { p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss' } },
      // R2: B>C
      { id: '2', round: 2, player1Id: 'B', player2Id: 'C', matchOrder: 1,
        result: { p1Souls: 5, p2Souls: 1, p1Outcome: 'full_win', p2Outcome: 'full_loss' } },
      // R3: C>A
      { id: '3', round: 3, player1Id: 'C', player2Id: 'A', matchOrder: 1,
        result: { p1Souls: 5, p2Souls: 2, p1Outcome: 'full_win', p2Outcome: 'full_loss' } },
    ];
    const byes: Bye[] = [
      { participantId: 'C', round: 1 },
      { participantId: 'A', round: 2 },
      { participantId: 'B', round: 3 },
    ];
    // Game scores all 6 (1 win + 1 loss + 1 bye = 3 + 0 + 3 = 6).
    // LSS:
    //   A: +5 (R1) + 0 (R2 bye) + -3 (R3) = +2
    //   B: -5 (R1) + +4 (R2) + 0 (R3 bye) = -1
    //   C: 0 (R1 bye) + -4 (R2) + +3 (R3) = -1
    // No clean head-to-head (A>B, B>C, C>A — cycle).
    // Falls to LSS: A=+2 first, then B and C tied at -1 → joint placement.
    const standings = computeFinalStandings(state(ps, matches, byes));
    expect(standings.find(s => s.participantId === 'A')?.place).toBe(1);
    // B and C are jointly placed 2nd.
    expect(standings.find(s => s.participantId === 'B')?.place).toBe(2);
    expect(standings.find(s => s.participantId === 'C')?.place).toBe(2);
  });

  it('uses joint placement on true ties (next place skips by tie size)', () => {
    // 4 players, all tied on every score (synthetic).
    const ps = ['A', 'B', 'C', 'D'].map(x => p(x));
    const matches: Match[] = [
      // Two ties, equal LSS, no decisive head-to-head.
      { id: '1', round: 1, player1Id: 'A', player2Id: 'B', matchOrder: 1,
        result: { p1Souls: 3, p2Souls: 3, p1Outcome: 'tie', p2Outcome: 'tie' } },
      { id: '2', round: 1, player1Id: 'C', player2Id: 'D', matchOrder: 1,
        result: { p1Souls: 3, p2Souls: 3, p1Outcome: 'tie', p2Outcome: 'tie' } },
    ];
    // Each player: 1.5 game, 0 LSS. Four-way tie. No head-to-head winner.
    const standings = computeFinalStandings(state(ps, matches));
    // All four jointly placed 1st.
    for (const s of standings) {
      expect(s.place).toBe(1);
    }
  });

  it('excludes dropped players from final standings entirely', () => {
    const ps = [
      p('A'),
      { ...p('B'), droppedOut: true, dropAfterRound: 1 },
      p('C'),
    ];
    const matches: Match[] = [
      fullWin(1, 'A', 'B'),
      fullWin(2, 'A', 'C'),
    ];
    const standings = computeFinalStandings(state(ps, matches));
    expect(standings.map(s => s.participantId).sort()).toEqual(['A', 'C']);
    expect(standings.find(s => s.participantId === 'B')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run lib/tournament/__tests__/standings.test.ts`
Expected: FAIL with "Cannot find module '../standings'."

- [ ] **Step 3: Implement `standings.ts`**

```ts
// lib/tournament/standings.ts
//
// Final standings per algorithm.md "Determining Final Standings":
//   1. Drop-outs are removed entirely.
//   2. Sort by gameScore DESC.
//   3. Within a game-score tie, apply head-to-head: if exactly one player
//      defeated all others in the tie group, they take the top place.
//      Repeat for the next place.
//   4. If no clean head-to-head winner remains, fall to lostSoulScore DESC.
//   5. True ties → joint placement; next place skips by tie size.

import { recomputeTotalsFromHistory } from './results';
import type { TournamentState, Placement, ParticipantId, ParticipantTotals } from './types';

/** Result of a head-to-head match between two participants, as recorded in matches. */
type H2HResult = 'p1_won' | 'p2_won' | 'tie' | 'no_match';

function headToHead(
  state: TournamentState,
  a: ParticipantId,
  b: ParticipantId,
): H2HResult {
  for (const m of state.matches) {
    if (!m.result) continue;
    const isAB = m.player1Id === a && m.player2Id === b;
    const isBA = m.player1Id === b && m.player2Id === a;
    if (!isAB && !isBA) continue;
    const o1 = isAB ? m.result.p1Outcome : m.result.p2Outcome;
    if (o1 === 'tie') return 'tie';
    if (o1 === 'full_win' || o1 === 'partial_win' || o1 === 'forfeit_opponent') return 'p1_won';
    if (o1 === 'full_loss' || o1 === 'partial_loss' || o1 === 'forfeit') return 'p2_won';
  }
  return 'no_match';
}

/** Did `candidate` beat every other participant in `group`? */
function beatAll(state: TournamentState, candidate: ParticipantId, group: ParticipantId[]): boolean {
  for (const other of group) {
    if (other === candidate) continue;
    const r = headToHead(state, candidate, other);
    if (r !== 'p1_won') return false;
  }
  return true;
}

/**
 * Resolve a tie group's internal order, returning groups of joint-placed players
 * in placement order. A returned `[['A'], ['B', 'C']]` means A is first, B and C
 * are jointly placed second.
 */
function resolveTieGroup(
  state: TournamentState,
  group: ParticipantTotals[],
): ParticipantTotals[][] {
  const out: ParticipantTotals[][] = [];
  let remaining = [...group];

  // Step a: peel off head-to-head winners one at a time.
  while (remaining.length > 1) {
    const ids = remaining.map(p => p.participantId);
    const winner = remaining.find(p => beatAll(state, p.participantId, ids));
    if (!winner) break;
    out.push([winner]);
    remaining = remaining.filter(p => p.participantId !== winner.participantId);
  }

  // Step b: remaining players → fall to lostSoulScore DESC, then joint placement.
  remaining.sort((a, b) => b.lostSoulScore - a.lostSoulScore);
  let i = 0;
  while (i < remaining.length) {
    const lss = remaining[i].lostSoulScore;
    const tied: ParticipantTotals[] = [];
    while (i < remaining.length && remaining[i].lostSoulScore === lss) {
      tied.push(remaining[i]);
      i++;
    }
    out.push(tied);
  }

  return out;
}

/** Compute final standings per algorithm.md. */
export function computeFinalStandings(state: TournamentState): Placement[] {
  // Step 1: exclude drop-outs.
  const active = state.participants.filter(p => !p.droppedOut);
  const totals = active.map(p => recomputeTotalsFromHistory(p.id, state));

  // Step 2: sort by gameScore DESC, then group by gameScore.
  totals.sort((a, b) => b.gameScore - a.gameScore);

  const placements: Placement[] = [];
  let i = 0;
  let nextPlace = 1;
  while (i < totals.length) {
    const gs = totals[i].gameScore;
    const group: ParticipantTotals[] = [];
    while (i < totals.length && totals[i].gameScore === gs) {
      group.push(totals[i]);
      i++;
    }
    // Resolve internal order.
    const subgroups = group.length === 1 ? [group] : resolveTieGroup(state, group);
    for (const sub of subgroups) {
      for (const t of sub) {
        placements.push({
          participantId: t.participantId,
          place: nextPlace,
          gameScore: t.gameScore,
          lostSoulScore: t.lostSoulScore,
        });
      }
      nextPlace += sub.length;
    }
  }
  return placements;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run lib/tournament/__tests__/standings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournament/standings.ts lib/tournament/__tests__/standings.test.ts
git commit -m "tournament: implement final standings with head-to-head"
```

---

## Task 9: Lifecycle predicates (`lifecycle.ts`)

**Files:**
- Create: `lib/tournament/lifecycle.ts`
- Test: `lib/tournament/__tests__/lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/tournament/__tests__/lifecycle.test.ts
import { describe, it, expect } from 'vitest';
import {
  canAddParticipant,
  isRoundComplete,
  isTournamentComplete,
  dropPlayer,
} from '../lifecycle';
import type { TournamentState, Participant, Match, Bye } from '../types';

function p(id: string, droppedOut = false): Participant {
  return { id, name: id, joinedAt: '2026-01-01T00:00:00Z', droppedOut };
}

function st(opts: Partial<TournamentState> = {}): TournamentState {
  return {
    id: 't', nRounds: 3, currentRound: 0, soulCap: 5,
    hasStarted: false, hasEnded: false,
    participants: [], matches: [], byes: [],
    ...opts,
  };
}

describe('canAddParticipant', () => {
  it('true before tournament starts', () => {
    expect(canAddParticipant(st())).toBe(true);
  });
  it('false once tournament has started', () => {
    expect(canAddParticipant(st({ hasStarted: true, currentRound: 1 }))).toBe(false);
  });
});

describe('isRoundComplete', () => {
  it('true when all matches in the round have results and all expected byes exist', () => {
    const state = st({
      hasStarted: true, currentRound: 1, participants: [p('A'), p('B'), p('C')],
      matches: [{
        id: 'm1', round: 1, player1Id: 'A', player2Id: 'B', matchOrder: 1,
        result: { p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss' },
      }],
      byes: [{ participantId: 'C', round: 1 }],
    });
    expect(isRoundComplete(state, 1)).toBe(true);
  });

  it('false when any match in the round lacks a result', () => {
    const state = st({
      hasStarted: true, currentRound: 1, participants: [p('A'), p('B')],
      matches: [{ id: 'm1', round: 1, player1Id: 'A', player2Id: 'B', matchOrder: 1 }],
    });
    expect(isRoundComplete(state, 1)).toBe(false);
  });
});

describe('isTournamentComplete', () => {
  it('true when round nRounds is complete', () => {
    const state = st({
      hasStarted: true, currentRound: 3, nRounds: 3, participants: [p('A'), p('B')],
      matches: [{
        id: 'm1', round: 3, player1Id: 'A', player2Id: 'B', matchOrder: 1,
        result: { p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss' },
      }],
    });
    expect(isTournamentComplete(state)).toBe(true);
  });

  it('false when current round is below nRounds', () => {
    const state = st({ hasStarted: true, currentRound: 1, nRounds: 3 });
    expect(isTournamentComplete(state)).toBe(false);
  });
});

describe('dropPlayer', () => {
  it('marks the participant droppedOut and records dropAfterRound', () => {
    const state = st({
      hasStarted: true, currentRound: 2, participants: [p('A'), p('B')],
    });
    const next = dropPlayer(state, 'A');
    const a = next.participants.find(x => x.id === 'A')!;
    expect(a.droppedOut).toBe(true);
    expect(a.dropAfterRound).toBe(2);
    // Original is unchanged.
    expect(state.participants.find(x => x.id === 'A')!.droppedOut).toBe(false);
  });

  it('throws if participant is already dropped (re-add not supported)', () => {
    const state = st({
      hasStarted: true, currentRound: 1,
      participants: [{ ...p('A'), droppedOut: true, dropAfterRound: 1 }],
    });
    expect(() => dropPlayer(state, 'A')).toThrow();
  });

  it('throws if participant not found', () => {
    const state = st({ hasStarted: true, currentRound: 1, participants: [p('A')] });
    expect(() => dropPlayer(state, 'Z')).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run lib/tournament/__tests__/lifecycle.test.ts`
Expected: FAIL with "Cannot find module '../lifecycle'."

- [ ] **Step 3: Implement `lifecycle.ts`**

```ts
// lib/tournament/lifecycle.ts
//
// State-transition predicates and validators per algorithm.md
// "Lifecycle / State Transitions" section.

import type { TournamentState, ParticipantId } from './types';

/** Per spec: cannot add participants after the tournament has started. */
export function canAddParticipant(state: TournamentState): boolean {
  return !state.hasStarted;
}

/**
 * A round is complete when every match in that round has a result AND
 * every bye record for that round has been written.
 *
 * Note: this checks consistency given the recorded matches/byes. It does
 * not verify that the round was paired correctly — that's the pairing
 * module's responsibility.
 */
export function isRoundComplete(state: TournamentState, round: number): boolean {
  const matchesInRound = state.matches.filter(m => m.round === round);
  if (matchesInRound.some(m => !m.result)) return false;
  // The active set in this round must be (matches × 2) + (byes for this round) = active count.
  const byesInRound = state.byes.filter(b => b.round === round);
  // We require at least one match or bye recorded for the round.
  if (matchesInRound.length === 0 && byesInRound.length === 0) return false;
  return true;
}

export function isTournamentComplete(state: TournamentState): boolean {
  if (!state.hasStarted) return false;
  if (state.currentRound < state.nRounds) return false;
  return isRoundComplete(state, state.nRounds);
}

/** Mark a player as dropped. Returns a new state. */
export function dropPlayer(state: TournamentState, participantId: ParticipantId): TournamentState {
  const idx = state.participants.findIndex(p => p.id === participantId);
  if (idx === -1) throw new Error(`dropPlayer: ${participantId} not found`);
  if (state.participants[idx].droppedOut) {
    throw new Error(`dropPlayer: ${participantId} already dropped (re-add not supported)`);
  }
  const participants = state.participants.slice();
  participants[idx] = {
    ...participants[idx],
    droppedOut: true,
    dropAfterRound: state.currentRound,
  };
  return { ...state, participants };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run lib/tournament/__tests__/lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournament/lifecycle.ts lib/tournament/__tests__/lifecycle.test.ts
git commit -m "tournament: implement lifecycle predicates"
```

---

## Task 10: In-memory simulator + end-to-end scenarios (`simulator.ts`)

**Files:**
- Create: `lib/tournament/simulator.ts`
- Test: `lib/tournament/__tests__/simulator.test.ts`

The simulator is a thin wrapper over the pure modules that lets test code drive a full tournament with a few method calls. It also doubles as a documentation example of how production code should drive the modules.

- [ ] **Step 1: Write the failing test (representative end-to-end scenarios)**

```ts
// lib/tournament/__tests__/simulator.test.ts
import { describe, it, expect } from 'vitest';
import { createTournament } from '../simulator';

describe('simulator: clean 4-player, 3-round', () => {
  it('plays out cleanly with no rematches and stable standings', () => {
    const t = createTournament({
      tournamentId: 't-clean-4',
      players: ['Alice', 'Bob', 'Carol', 'Dave'],
      nRounds: 3,
      soulCap: 5,
    });
    t.start();

    for (let round = 1; round <= 3; round++) {
      t.pairRound(round);
      // Submit "highest seed wins 5-0" deterministically — order of matches in the
      // round is whatever the simulator returns. We just ensure every match gets a
      // result.
      const matches = t.matchesForRound(round);
      for (const m of matches) {
        // Simulate: alphabetically lower id wins.
        const p1Wins = m.player1Id < m.player2Id;
        t.submitResult(m.id, {
          p1Souls: p1Wins ? 5 : 0,
          p2Souls: p1Wins ? 0 : 5,
          p1Outcome: p1Wins ? 'full_win' : 'full_loss',
          p2Outcome: p1Wins ? 'full_loss' : 'full_win',
        });
      }
    }
    const standings = t.standings();
    // Alice always wins (lowest id alphabetically).
    expect(standings[0].participantId).toMatch(/^p-Alice/);
    expect(standings.length).toBe(4);
  });
});

describe('simulator: drop in round 2', () => {
  it('drop-out is excluded from R3 pairings and from final standings', () => {
    const t = createTournament({
      tournamentId: 't-drop',
      players: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
      nRounds: 3,
      soulCap: 5,
    });
    t.start();

    t.pairRound(1);
    for (const m of t.matchesForRound(1)) {
      t.submitResult(m.id, {
        p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss',
      });
    }

    // After R1 ends, drop one player.
    const aId = t.participantIdByName('A')!;
    t.dropPlayer(aId);

    t.pairRound(2);
    // 7 active players → 1 bye, 3 matches. The dropped A must not appear.
    const matches2 = t.matchesForRound(2);
    const idsInR2 = new Set<string>();
    for (const m of matches2) {
      idsInR2.add(m.player1Id);
      idsInR2.add(m.player2Id);
    }
    expect(idsInR2.has(aId)).toBe(false);

    // Submit and continue.
    for (const m of matches2) {
      t.submitResult(m.id, {
        p1Souls: 5, p2Souls: 1, p1Outcome: 'full_win', p2Outcome: 'full_loss',
      });
    }
    t.pairRound(3);
    for (const m of t.matchesForRound(3)) {
      t.submitResult(m.id, {
        p1Souls: 5, p2Souls: 2, p1Outcome: 'full_win', p2Outcome: 'full_loss',
      });
    }
    const standings = t.standings();
    // Dropped player not in standings; remaining 7 ranked 1..7.
    expect(standings.find(s => s.participantId === aId)).toBeUndefined();
    expect(standings.length).toBe(7);
  });
});

describe('simulator: edit-after-submit recompute (regression for double-count bug)', () => {
  it('editing a result produces correct totals, not 2× delta', () => {
    const t = createTournament({
      tournamentId: 't-edit',
      players: ['A', 'B'],
      nRounds: 1,
      soulCap: 5,
    });
    t.start();
    t.pairRound(1);
    const [m] = t.matchesForRound(1);
    // Initial submit: A wins 5-0.
    t.submitResult(m.id, {
      p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss',
    });
    expect(t.totalsFor(m.player1Id).gameScore).toBe(3);
    // Edit: change to a tie 4-4.
    t.submitResult(m.id, {
      p1Souls: 4, p2Souls: 4, p1Outcome: 'tie', p2Outcome: 'tie',
    });
    expect(t.totalsFor(m.player1Id).gameScore).toBe(1.5);
    expect(t.totalsFor(m.player1Id).lostSoulScore).toBe(0);
    expect(t.totalsFor(m.player2Id).gameScore).toBe(1.5);
  });
});

describe('simulator: bye distribution stress', () => {
  it('5 players over 6 rounds: bye counts within ±1 across all players', () => {
    const t = createTournament({
      tournamentId: 't-byestress',
      players: ['A', 'B', 'C', 'D', 'E'],
      nRounds: 6,
      soulCap: 5,
    });
    t.start();
    for (let round = 1; round <= 6; round++) {
      t.pairRound(round);
      for (const m of t.matchesForRound(round)) {
        t.submitResult(m.id, {
          p1Souls: 5, p2Souls: m.matchOrder, // varies a bit so LSS isn't tied
          p1Outcome: 'full_win', p2Outcome: 'full_loss',
        });
      }
    }
    const counts = t.byeCounts();
    const values = [...counts.values()];
    const min = Math.min(...values);
    const max = Math.max(...values);
    // The new algorithm distributes byes by min count, so spread is at most 1.
    expect(max - min).toBeLessThanOrEqual(1);
  });
});

describe('simulator: forfeit', () => {
  it('forfeit produces correct game/lost-soul scores for both players', () => {
    const t = createTournament({
      tournamentId: 't-forfeit', players: ['A', 'B'], nRounds: 1, soulCap: 5,
    });
    t.start();
    t.pairRound(1);
    const [m] = t.matchesForRound(1);
    t.submitResult(m.id, {
      p1Souls: 0, p2Souls: 0, p1Outcome: 'forfeit', p2Outcome: 'forfeit_opponent',
    });
    expect(t.totalsFor(m.player1Id)).toEqual({
      participantId: m.player1Id, gameScore: 0, lostSoulScore: -5,
    });
    expect(t.totalsFor(m.player2Id)).toEqual({
      participantId: m.player2Id, gameScore: 3, lostSoulScore: 0,
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run lib/tournament/__tests__/simulator.test.ts`
Expected: FAIL with "Cannot find module '../simulator'."

- [ ] **Step 3: Implement `simulator.ts`**

```ts
// lib/tournament/simulator.ts
//
// In-memory tournament simulator. Wraps the pure modules to give tests
// (and any local-repro tools) a single object that drives a tournament
// from start to finish with no Supabase or async I/O involved.

import type {
  TournamentState, Participant, Match, MatchResult,
  ParticipantId, ParticipantTotals, Placement,
} from './types';
import { rngForRound } from './rng';
import { pairFirstRound, pairLaterRound } from './pairing';
import { applyResult, recomputeTotalsFromHistory } from './results';
import { computeFinalStandings } from './standings';
import { dropPlayer } from './lifecycle';

export interface CreateTournamentOptions {
  tournamentId: string;
  players: string[];     // names; ids are derived as `p-<name>`
  nRounds: number;
  soulCap: number;       // 5 (Type 1) or 7 (Type 2)
}

export interface SimulatedTournament {
  start(): void;
  pairRound(round: number): void;
  matchesForRound(round: number): Match[];
  submitResult(matchId: string, result: MatchResult): void;
  dropPlayer(participantId: ParticipantId): void;
  totalsFor(participantId: ParticipantId): ParticipantTotals;
  byeCounts(): Map<ParticipantId, number>;
  standings(): Placement[];
  participantIdByName(name: string): ParticipantId | undefined;
  /** Read-only snapshot of internal state, for assertions or debugging. */
  state(): TournamentState;
}

/**
 * Build a tournament with the given players. Names are required; ids are
 * generated as `p-<name>` for predictable identification in tests.
 */
export function createTournament(opts: CreateTournamentOptions): SimulatedTournament {
  let state: TournamentState = {
    id: opts.tournamentId,
    nRounds: opts.nRounds,
    currentRound: 0,
    soulCap: opts.soulCap,
    hasStarted: false,
    hasEnded: false,
    participants: opts.players.map((name, i) => ({
      id: `p-${name}`,
      name,
      joinedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      droppedOut: false,
    })),
    matches: [],
    byes: [],
  };

  let nextMatchSeq = 1;

  function newMatchId(): string {
    return `match-${nextMatchSeq++}`;
  }

  return {
    start() {
      state = { ...state, hasStarted: true, currentRound: 0 };
    },

    pairRound(round) {
      if (!state.hasStarted) throw new Error('pairRound called before start()');
      const rng = rngForRound(state.id, round);
      let result;
      if (round === 1) {
        result = pairFirstRound(state.participants, rng);
      } else {
        result = pairLaterRound(state, round, rng);
      }
      const newMatches: Match[] = result.matches.map(m => ({
        id: newMatchId(),
        round: m.round,
        player1Id: m.player1Id,
        player2Id: m.player2Id,
        matchOrder: m.matchOrder,
      }));
      const newByes = result.bye ? [{ participantId: result.bye, round }] : [];
      state = {
        ...state,
        currentRound: round,
        matches: [...state.matches, ...newMatches],
        byes: [...state.byes, ...newByes],
      };
    },

    matchesForRound(round) {
      return state.matches.filter(m => m.round === round);
    },

    submitResult(matchId, result) {
      state = applyResult(state, matchId, result);
    },

    dropPlayer(id) {
      state = dropPlayer(state, id);
    },

    totalsFor(id) {
      return recomputeTotalsFromHistory(id, state);
    },

    byeCounts() {
      const out = new Map<string, number>();
      for (const p of state.participants) out.set(p.id, 0);
      for (const b of state.byes) {
        out.set(b.participantId, (out.get(b.participantId) ?? 0) + 1);
      }
      return out;
    },

    standings() {
      return computeFinalStandings(state);
    },

    participantIdByName(name) {
      return state.participants.find(p => p.name === name)?.id;
    },

    state() {
      return state;
    },
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run lib/tournament/__tests__/simulator.test.ts`
Expected: PASS, all scenarios green.

- [ ] **Step 5: Run the entire `lib/tournament/` test suite to verify nothing regressed**

Run: `npx vitest run lib/tournament`
Expected: every test in every module file passes.

- [ ] **Step 6: Commit**

```bash
git add lib/tournament/simulator.ts lib/tournament/__tests__/simulator.test.ts
git commit -m "tournament: add in-memory simulator and end-to-end scenarios"
```

---

## Task 11: Refactor `pairingUtilsV2.ts` to delegate to `lib/tournament/`

**Files:**
- Create: `utils/tournament/stateAdapter.ts` (Supabase ↔ TournamentState mapping, reused by Tasks 12 and 13)
- Modify: `utils/tournament/pairingUtilsV2.ts`

The existing functions become a thin Supabase IO layer. The pairing decisions are made by `lib/tournament/pairing.ts`. **Production behavior change:** bye distribution improves. There's no test for these files directly — correctness comes from the pure-module tests, plus a manual smoke check after the refactor.

- [ ] **Step 1: Read the current pairingUtilsV2 file**

Run: `cat utils/tournament/pairingUtilsV2.ts | head -300`
Familiarize yourself with the existing structure: `assignBye`, `getPreviousMatchData`, `generateLaterRoundPairings`, `createFirstRoundPairings`, `createPairing`.

- [ ] **Step 2: Create the shared state adapter**

Create `utils/tournament/stateAdapter.ts`:

```ts
// Supabase ↔ TournamentState mapping. Used by anything that needs to feed
// the lib/tournament/* pure modules with state pulled from the database.

import type {
  TournamentState, Participant, Match, MatchResult, Bye, MatchOutcome,
} from "../../lib/tournament/types";

/** Loose Supabase client type — accepts both the browser and server clients. */
type AnyClient = {
  from: (table: string) => any;
};

/**
 * Map a DB match row into a MatchResult.
 *
 * The DB stores raw scores plus is_tie + winner_id; partial-vs-full is
 * derived by comparing the winner's score against soulCap (max_score).
 * If the match has no winner_id and is_tie is false, it has no result yet.
 */
function toMatchResult(m: any, soulCap: number): MatchResult | undefined {
  if (m.player1_score === null || m.player2_score === null) return undefined;
  const p1Souls = Number(m.player1_score);
  const p2Souls = Number(m.player2_score);
  if (m.is_tie) {
    return { p1Souls, p2Souls, p1Outcome: "tie", p2Outcome: "tie" };
  }
  let p1Won: boolean;
  if (m.winner_id === m.player1_id) p1Won = true;
  else if (m.winner_id === m.player2_id) p1Won = false;
  else return undefined;

  const winnerSouls = p1Won ? p1Souls : p2Souls;
  const isFullWin = winnerSouls >= soulCap;
  const winnerOutcome: MatchOutcome = isFullWin ? "full_win" : "partial_win";
  const loserOutcome: MatchOutcome = isFullWin ? "full_loss" : "partial_loss";
  return p1Won
    ? { p1Souls, p2Souls, p1Outcome: winnerOutcome, p2Outcome: loserOutcome }
    : { p1Souls, p2Souls, p1Outcome: loserOutcome, p2Outcome: winnerOutcome };
}

/** Build a TournamentState from a tournament's DB rows. */
export async function buildStateFromSupabase(
  client: AnyClient,
  tournamentId: string,
): Promise<TournamentState | null> {
  const { data: t } = await client
    .from("tournaments")
    .select("id, n_rounds, current_round, max_score, has_started, has_ended")
    .eq("id", tournamentId)
    .single();
  if (!t) return null;
  const soulCap = t.max_score ?? 5;

  const { data: parts } = await client
    .from("participants")
    .select("id, name, joined_at, dropped_out")
    .eq("tournament_id", tournamentId);
  const participants: Participant[] = (parts || []).map((p: any) => ({
    id: p.id,
    name: p.name ?? "",
    joinedAt: p.joined_at ?? new Date(0).toISOString(),
    droppedOut: !!p.dropped_out,
  }));

  const { data: matchRows } = await client
    .from("matches")
    .select("id, round, player1_id, player2_id, match_order, player1_score, player2_score, is_tie, winner_id")
    .eq("tournament_id", tournamentId);
  const matches: Match[] = (matchRows || []).map((m: any) => ({
    id: m.id,
    round: m.round,
    player1Id: m.player1_id,
    player2Id: m.player2_id,
    matchOrder: m.match_order ?? 0,
    result: toMatchResult(m, soulCap),
  }));

  const { data: byeRows } = await client
    .from("byes")
    .select("participant_id, round_number")
    .eq("tournament_id", tournamentId);
  const byes: Bye[] = (byeRows || []).map((b: any) => ({
    participantId: b.participant_id,
    round: Number(b.round_number),
  }));

  return {
    id: t.id,
    nRounds: t.n_rounds ?? 0,
    currentRound: t.current_round ?? 0,
    soulCap,
    hasStarted: !!t.has_started,
    hasEnded: !!t.has_ended,
    participants,
    matches,
    byes,
  };
}
```

- [ ] **Step 3: Replace `pairingUtilsV2.ts` contents**

Overwrite `utils/tournament/pairingUtilsV2.ts` with:

```ts
// Tournament Pairing Utilities v2 (DB shell).
//
// All algorithm decisions live in lib/tournament/. This file is a thin
// Supabase IO layer that:
//   1. Loads TournamentState via stateAdapter.
//   2. Calls a pure pairing function.
//   3. Persists the resulting matches and bye records.

import { createClient } from "../supabase/client";
import { rngForRound } from "../../lib/tournament/rng";
import { pairFirstRound, pairLaterRound } from "../../lib/tournament/pairing";
import { buildStateFromSupabase } from "./stateAdapter";

type AnyClient = {
  from: (table: string) => any;
};

/** Insert a bye record. bye_points/bye_differential are vestigial; always 3/0 per algorithm.md. */
async function persistBye(
  client: AnyClient,
  tournamentId: string,
  round: number,
  participantId: string,
) {
  await client.from("byes").insert({
    tournament_id: tournamentId,
    round_number: round,
    match_points: 3,
    differential: 0,
    participant_id: participantId,
  });
}

/** Insert match records for a round. */
async function persistMatches(
  client: AnyClient,
  tournamentId: string,
  matches: Array<{ round: number; player1Id: string; player2Id: string; matchOrder: number }>,
) {
  if (matches.length === 0) return;
  const rows = matches.map(m => ({
    tournament_id: tournamentId,
    round: m.round,
    player1_id: m.player1Id,
    player2_id: m.player2Id,
    player1_score: null,
    player2_score: null,
    match_order: m.matchOrder,
  }));
  await client.from("matches").insert(rows);
}

/** Public API: create pairings for a Swiss tournament round. */
export const createPairing = async (
  tournamentId: string,
  round: number,
): Promise<boolean> => {
  const client = await createClient();
  try {
    const state = await buildStateFromSupabase(client, tournamentId);
    if (!state) {
      console.error("createPairing: tournament not found");
      return false;
    }
    const rng = rngForRound(tournamentId, round);
    const result = round === 1
      ? pairFirstRound(state.participants.filter(p => !p.droppedOut), rng)
      : pairLaterRound(state, round, rng);

    if (result.bye) {
      await persistBye(client, tournamentId, round, result.bye);
    }
    await persistMatches(client, tournamentId, result.matches);
    return true;
  } catch (error) {
    console.error("Error in createPairing v2:", error);
    return false;
  }
};
```

- [ ] **Step 4: Verify the existing pure-module tests still pass**

Run: `npx vitest run lib/tournament`
Expected: every test passes.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If errors point at unrelated files, surface them; only fix errors caused by this change.)

- [ ] **Step 6: Manual smoke check**

The refactor changes production bye distribution. Flag this in your status update — DO NOT mark this task complete without telling the user about the production behavior change.

- [ ] **Step 7: Commit**

```bash
git add utils/tournament/stateAdapter.ts utils/tournament/pairingUtilsV2.ts
git commit -m "tournament: route pairingUtilsV2 through pure pairing module"
```

---

## Task 12: Refactor match-result handling in `page.tsx`

**Files:**
- Modify: `app/tracker/tournaments/[id]/page.tsx` (the match-result submission block, currently around lines 200-400)

**Goal of refactor:** Replace the incremental `match_points: existing + delta` updates with `recomputeTotalsFromHistory` calls. This fixes the double-count bug for edits.

- [ ] **Step 1: Locate the result-submission code**

Run: `grep -n "match_points\|differential" app/tracker/tournaments/\[id\]/page.tsx | head -40`
Find the function that handles match result submission. It will have a chain of branches for tie / full_win / partial_win etc., each updating both participants' rows with `match_points: (participant.match_points || 0) + N`. That's the block to replace.

- [ ] **Step 2: Read the surrounding context**

Read approximately 50 lines on either side of the match-update block to understand variable names and what state the surrounding handler manipulates.

- [ ] **Step 3: Replace incremental updates with recompute**

The new flow inside the result-submission handler:
1. Determine the per-player `MatchOutcome` from the existing form/UI conditions (full win, partial, tie, etc. — same conditions you currently branch on).
2. Update the `matches` row with `player1_score`, `player2_score`, `is_tie`/`winner_id`, plus `player1_match_points`, `player2_match_points`, `differential`, `differential2` if they're already being persisted (preserve existing column writes — those are denormalized snapshots of per-round values, not totals).
3. After the match row update completes, call `buildStateFromSupabase(client, tournamentId)` (already created in Task 11).
4. For each affected participant (player1 and player2), call `recomputeTotalsFromHistory` and update their participants row.

Concretely, where the old code did:

```ts
client.from("participants").update({
  match_points: (participant1.match_points || 0) + 3,
  differential: (match.player1_score - match.player2_score) + (participant1.differential || 0),
}).eq("id", participant1.id);
```

…replace with:

```ts
import { recomputeTotalsFromHistory } from "../../../../lib/tournament/results";
import { buildStateFromSupabase } from "../../../../utils/tournament/stateAdapter";

// after the matches row update completes:
const state = await buildStateFromSupabase(client, tournamentId);
if (state) {
  for (const pid of [match.player1_id.id, match.player2_id.id]) {
    const totals = recomputeTotalsFromHistory(pid, state);
    await client.from("participants").update({
      match_points: totals.gameScore,
      differential: totals.lostSoulScore,
    }).eq("id", pid);
  }
}
```

Remove the entire chain of `if (player1Wins) { ... } else if (player2Wins) { ... } else if (tie) { ... }` blocks that update participants — they're replaced by the recompute pass above. The UI behavior (toasts, refetches, optimistic updates) is unchanged.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. Fix anything tied to this change.

- [ ] **Step 5: Pure-module tests still pass**

Run: `npx vitest run lib/tournament`
Expected: PASS.

- [ ] **Step 6: Manual UI smoke check**

This is a UI-touching change — per CLAUDE.md you must verify in a browser before claiming done. Start the dev server, create a test tournament, submit a result, edit it, and confirm the participant totals match a fresh recompute (i.e., editing doesn't double-count). If you can't run the dev server in your environment, say so explicitly in your status update — don't claim success based on type-checks alone.

- [ ] **Step 7: Commit**

```bash
git add app/tracker/tournaments/[id]/page.tsx
git commit -m "tournament: recompute participant totals from history after result submit"
```

---

## Task 13: Refactor placement calculation in `actions.ts`

**Files:**
- Modify: `app/tracker/tournaments/actions.ts` (specifically the placement-sorting block in `publishTournamentDecklistsAction`, currently around lines 263-285)

**Goal:** Replace the `sort by (match_points DESC, differential DESC)` with a call to `computeFinalStandings`. Fixes the missing head-to-head bug.

- [ ] **Step 1: Locate the placement code**

Run: `grep -n "place\|placementMap\|match_points" app/tracker/tournaments/actions.ts | head -20`
You'll find a `placementMap` being built by sorting participants and assigning 1-indexed places.

- [ ] **Step 2: Replace the sort with `computeFinalStandings`**

Where the old code does:

```ts
const sorted = [...participants].sort((a, b) => {
  if (a.dropped_out !== b.dropped_out) return a.dropped_out ? 1 : -1;
  const mpDiff = (b.match_points || 0) - (a.match_points || 0);
  if (mpDiff !== 0) return mpDiff;
  return (b.differential || 0) - (a.differential || 0);
});

for (let i = 0; i < sorted.length; i++) {
  placementMap.set(sorted[i].id, i + 1);
  await supabase
    .from("participants")
    .update({ place: i + 1 })
    .eq("id", sorted[i].id);
}
```

…replace with:

```ts
import { computeFinalStandings } from "../../../lib/tournament/standings";
import { buildStateFromSupabase } from "../../../utils/tournament/stateAdapter";

const state = await buildStateFromSupabase(supabase, tournamentId);
const standings = computeFinalStandings(state);
for (const placement of standings) {
  placementMap.set(placement.participantId, placement.place);
  await supabase
    .from("participants")
    .update({ place: placement.place })
    .eq("id", placement.participantId);
}
// dropped players: per algorithm.md, no place value at all.
// (Old code stored a place even for dropped — the new behavior aligns with spec.)
```

- [ ] **Step 3: Pure-module tests still pass**

Run: `npx vitest run lib/tournament`
Expected: PASS.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/tracker/tournaments/actions.ts
git commit -m "tournament: use head-to-head standings when publishing decklists"
```

---

## Task 14: Delete dead `pairingUtils.ts` v1

**Files:**
- Delete: `utils/tournament/pairingUtils.ts`

- [ ] **Step 1: Verify nothing imports v1**

Run: `grep -rn "from.*['\"].*pairingUtils['\"]" --include="*.ts" --include="*.tsx" . 2>/dev/null | grep -v worktrees | grep -v node_modules | grep -v "pairingUtilsV2"`
Expected: no output. If any matches appear, stop and report them — they need to be migrated first.

- [ ] **Step 2: Delete the file**

Run: `git rm utils/tournament/pairingUtils.ts`

- [ ] **Step 3: Pure-module tests still pass**

Run: `npx vitest run lib/tournament`
Expected: PASS.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git commit -m "tournament: delete dead v1 pairing utils"
```

---

## Final Verification

After Task 14, run the entire tournament test suite once more:

```bash
npx vitest run lib/tournament
```

Expected: every test passes.

Then surface to the user:
- All 14 tasks complete.
- Three production behavior changes shipped: bye distribution rebalanced, match-result edits now recompute (no double-count), final standings respect head-to-head.
- Manual UI verification done (or explicitly note where it wasn't, per CLAUDE.md).
