# Pairing Rematch Avoidance — Design

**Date:** 2026-05-05
**Status:** Approved, ready for implementation plan
**Scope:** Replace the greedy pairing pass in `lib/tournament/pairing.ts`'s `pairLaterRound` with a depth-first backtracking search that finds a no-rematch perfect matching whenever one exists, while preserving the existing top-down rank-priority semantics and determinism.

## Problem

The current `pairLaterRound` implementation (commit `babc2f5`, `lib/tournament/pairing.ts:218-242`) uses a single-pass greedy approach: walking the active pool top-down by `(gameScore DESC, lostSoulScore DESC)`, it pairs each unassigned player with the highest-ranked unassigned partner they have not previously played. Any leftover unpaired players are then paired in remaining-list order, even if they have already played (the "rematch fallback").

Two independent probes (different PRNGs, different outcome models, different verifiers) confirmed that this approach produces an avoidable rematch in approximately 48-52% of realistic 16-player × 5-round tournaments. Across 405 examined rematched rounds (245 at 16p/5r, 109 at 32p/6r, 51 at 64p/7r), **every single rematch was avoidable** — a no-rematch perfect matching of the same pool always existed, but greedy committed early to a top pairing that stranded unmatchable players at the bottom of the bracket.

`prompt_context/algorithm.md:131-133` explicitly acknowledges this limitation:

> Note: greedy is non-optimal — it can produce a rematch that careful backtracking would have avoided. **This is accepted complexity for v1.**

This design replaces that v1 acceptance with a v2 fix.

## Approach

**Depth-first backtracking search** that preserves the existing rank-priority traversal order. The new step replaces the linear greedy loop with a recursive search that, at each step, finds the topmost unpaired player and tries every legal partner in rank order, unwinding when a sub-pool becomes infeasible.

**Properties:**
- **Returns identical output to greedy whenever greedy already produces a no-rematch pairing.** The "find topmost unpaired and try `j > i` in rank order" structure means the first solution found is the greedy-equivalent solution. Behavior change is invisible whenever greedy was already correct.
- **Finds a no-rematch pairing whenever one exists.** This is the entire stated bug — the bug exists precisely because such a pairing exists but greedy doesn't find it.
- **Falls back to the existing rematch-fallback semantics only when no no-rematch pairing exists** (e.g., late rounds in tiny fields where every pair has played). The fallback's output is unchanged from current behavior.
- **Fully deterministic.** No RNG involved in the search itself; the seeded PRNG is still consumed only by `selectBye`. Same `(state, round, rng)` produces byte-identical output.

## Why backtracking and not weighted matching

The Swiss-tournament literature (FIDE Dutch system, BBP Pairings, JaVaFo) uses weighted minimum-cost perfect matching via Edmonds blossom. We considered it and rejected it for this codebase:

- **Maintenance.** Edmonds blossom is ~300 lines of dense graph code (shrinking blossoms, dual variables, alternating paths). Backtracking reads like the rest of `pairing.ts`.
- **Scope of behavior change.** Weighted matching with a `(rematch, scoreGap, rankGap)` cost vector globally optimizes score-bucket cohesion. It can shuffle pairs *within* a score tier even when no rematch is at stake — visible to hosts and players who rely on the existing top-down rank-priority semantics. Backtracking only changes pairings in rounds where greedy was demonstrably wrong.
- **The chess-world reasoning doesn't fully apply.** FIDE Dutch uses weighted matching primarily because of color balance (white/black assignment), which Redemption doesn't have. Strip that away and the gap between "find any no-rematch matching" and "find optimal weighted matching" narrows substantially.
- **Scale.** Redemption tops out around 64 players in practice. Backtracking is empirically sub-millisecond at that size; the polynomial worst-case argument for blossom doesn't bite until much larger fields.

If the user community ever asks for tighter score-cohesion guarantees beyond what backtracking provides, weighted matching is the v3 upgrade path. The test surface this design builds will make that future swap easier.

## Algorithm

Pseudocode for the replacement of step 3 in `pairLaterRound`:

```ts
// Returns array of [poolIndex_a, poolIndex_b] pairs, or null if no
// rematch-free perfect matching of `pool` exists.
function findNoRematchPairing(
  pool: ScoredPlayer[],
  played: Set<string>,
): Array<[number, number]> | null {
  const n = pool.length;
  const partner = new Int32Array(n).fill(-1);

  function recurse(): boolean {
    // Find the top-most unpaired player. Preserves rank-priority:
    // the highest unpaired player chooses first, exactly like greedy.
    let i = 0;
    while (i < n && partner[i] !== -1) i++;
    if (i === n) return true; // all paired

    // Fail-fast: if any unpaired player has zero legal partners among
    // the remaining unpaired set, this branch is dead. Cheap pruning.
    for (let k = i; k < n; k++) {
      if (partner[k] !== -1) continue;
      let hasLegal = false;
      for (let m = i; m < n; m++) {
        if (m === k || partner[m] !== -1) continue;
        if (!played.has(playedKey(pool[k].id, pool[m].id))) { hasLegal = true; break; }
      }
      if (!hasLegal) return false;
    }

    // Try each candidate j > i in rank order (same order greedy used).
    for (let j = i + 1; j < n; j++) {
      if (partner[j] !== -1) continue;
      if (played.has(playedKey(pool[i].id, pool[j].id))) continue;
      partner[i] = j; partner[j] = i;
      if (recurse()) return true;
      partner[i] = -1; partner[j] = -1;
    }
    return false;
  }

  if (!recurse()) return null;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) if (partner[i] > i) out.push([i, partner[i]]);
  return out;
}
```

Integration into `pairLaterRound` (replacing steps 3 and 4):

```ts
const found = findNoRematchPairing(pool, played);
if (found) {
  for (const [i, j] of found) {
    matches.push({
      round,
      player1Id: pool[i].id,
      player2Id: pool[j].id,
      matchOrder: matches.length + 1,
    });
  }
} else {
  // No no-rematch perfect matching exists — fall back to the existing
  // greedy + rematch loop verbatim. Only fires when the pool genuinely
  // requires a rematch (e.g., tiny field, late round).
  /* existing step-3 greedy loop + step-4 leftover pairing here */
}
```

## Behavior guarantees

| Scenario | Old behavior | New behavior |
|---|---|---|
| Greedy already finds a no-rematch pairing | Greedy pairing | **Identical** pairing (same output) |
| Greedy locks up but a no-rematch matching exists | Rematch in fallback | No-rematch pairing (the fix) |
| No no-rematch matching exists for the pool | Rematch in fallback | Rematch in fallback (unchanged) |
| Bye selection / drop-out exclusion | Unchanged | Unchanged |
| First-round pairing (`pairFirstRound`) | Unchanged | Unchanged |

The matchOrder assignment remains rank-top-down: the top-most unpaired player's pair gets `matchOrder: 1`, the next gets `2`, etc. Downstream code that depends on match ordering (e.g., the simulator's mixed-outcome test that branches on `match.matchOrder === 1`) is unaffected.

## Performance

Worst case is exponential in pool size, but two structural facts dominate:
1. The "find topmost unpaired" rule makes the search a tree of depth `n/2` with branching that shrinks at each level.
2. Empirically, a no-rematch pairing exists for ~99% of realistic Swiss rounds at sizes ≤ 100 — the first complete leaf the search hits is the answer.

The fail-fast pruning (any unpaired player with zero legal partners terminates the branch immediately) makes the common case effectively linear.

Concrete latency estimates:
- 16 players: sub-millisecond
- 32 players: sub-millisecond typical, single-digit ms worst case
- 64 players: low single-digit ms
- 100 players: low tens of ms worst case; almost always sub-millisecond

These are dwarfed by the surrounding Supabase round-trip in production.

## Determinism

The search is purely deterministic with zero RNG calls. It walks pool indices in fixed order (rank-sorted) and returns the first complete leaf. The existing `rng` parameter remains used only by `selectBye`. Same `(state, round, rng)` produces byte-identical output, so the existing seeded-test infrastructure (`rngForRound`) continues to work unchanged.

## Test plan

**Tests that pass unchanged:**
- All `selectBye` tests in `lib/tournament/__tests__/pairing.test.ts`.
- All `pairFirstRound` tests.
- `pairLaterRound` tests "sorts by ... and pairs top-down", "avoids rematches in the greedy pass", "selects bye for odd active count", "excludes dropped-out players from the pool" — backtracking returns identical output to greedy on these small fixtures.
- "falls back to rematches when greedy locks up" — backtracking correctly returns `null` for that fully-played 4-player state, and the fallback runs unchanged.
- All `simulator-scenarios.test.ts` invariants pass; the bounded rematch counts are upper bounds that get easier, not harder.

**Tests to tighten:**
- The 16p/5r and 32p/6r scenario tests in `simulator-scenarios.test.ts` should tighten their rematch upper bounds from `≤4` and `≤8` to `0`. Both scenarios use a deterministic outcome function, so the result is reproducible. The verifier's 800-trial probe across 16p/5r, 32p/6r, and 64p/7r found zero cases where a no-rematch matching didn't exist; expecting zero rematches under the deterministic test seeds is safe. This converts the tests from "tolerate the bug" to "regression-proof the fix."

**New tests to add (in `pairing.test.ts`):**
1. **Verifier seed regression.** Reproduce the 16p/5r seed=1 round-5 scenario from the verifier report; assert no rematch in the output.
2. **Backtracking finds what greedy misses.** Hand-crafted small state (6-8 players) where greedy's first choice strands the bottom two as a forced rematch but a different early choice avoids it. Assert no rematches in the output.
3. **Infeasibility fallback.** State where every pair has played; assert the function returns the same output as the current rematch-fallback (specifically, all leftover players get paired in order).
4. **Determinism.** Run `pairLaterRound` twice with the same `(state, round, rng)` and assert deep-equal output. Already covered indirectly, but worth an explicit test now that the search has more decision points.
5. **MatchOrder preservation.** Verify that the topmost-unpaired-first emission rule preserves the rank-top-down `matchOrder` assignment.

## Spec doc updates

`prompt_context/algorithm.md:131-133` currently reads:

> Note: greedy is non-optimal — it can produce a rematch that careful backtracking would have avoided. This is accepted complexity for v1.

This paragraph should be updated to describe the v2 backtracking behavior:

> The pairing pass is a depth-first backtracking search over the rank-sorted pool. The topmost unpaired player tries each unpaired partner in rank order; the search unwinds when a sub-pool admits no legal completion. The search returns the first complete leaf, which is identical to a greedy pairing whenever greedy succeeds. The rematch fallback (pairing leftovers even if previously played) only fires when the pool admits no rematch-free perfect matching at all — a corner case visible only in tiny fields exhausted across many rounds.

## Out of scope

- **Weighted matching / Edmonds blossom.** Discussed and rejected; documented as a possible v3 upgrade.
- **Color balance.** Not applicable to Redemption.
- **Bye selection algorithm.** Untouched. The "fewest byes wins" logic in `selectBye` is unaffected.
- **First-round pairing.** Random per spec; unchanged.
- **Final standings / head-to-head.** Untouched. This design is purely about pairing.
- **Behavior on tournaments scored before this branch landed.** The legacy-data fallback in `stateAdapter.ts:toMatchResult` (commit `7710208`) handles those independently.

## Risks

1. **Hidden ordering dependency in downstream code.** `matchOrder` is assigned in pairing-emission order (rank-top-down). Backtracking emits in the same order, but a single explicit test should lock this down.
2. **Pathological worst-case search depth.** A maliciously constructed `played` set could in theory force a deep search. The fail-fast pruning eliminates this in the common case. As a belt-and-suspenders safeguard, an optional node-visit budget (e.g., 500k recursive calls) could fall back to the current greedy + rematch behavior if exceeded. Not expected to hit at realistic scale, but cheap to add if paranoid.
3. **Behavior change in scenario tests.** The 16p/5r and 32p/6r scenarios will produce different round-5/round-6 pairings than before in the ~50% of cases where greedy was producing an avoidable rematch. Downstream LSS/standings shift slightly. Tests that assert specific final standings would need updating; a grep confirms only invariant-style tests exist for these scenarios, so the impact is limited to tightening the rematch upper bound.
4. **First-feasible-vs-best-feasible semantics.** Backtracking returns the first complete no-rematch pairing it finds in rank-order traversal, not the one that minimizes total rank-gap or score-gap. In the worked example, both `04-08, 07-13, 15-06` (greedy with rematch) and `04-13, 08-06, 07-15` (backtracking, no rematch) are valid no-rematch shapes once committed; backtracking's choice may have larger rank-gaps in the bottom of the bracket than a weighted-matching output would. This is consistent with the algorithm.md priority ("no rematches" trumps "closest scores") but worth flagging if the tournament-organizer community ever asks "why did the bottom four scramble."
5. **Spec drift.** If `prompt_context/algorithm.md` isn't updated, future engineers will read a description that no longer matches the code. Update it as part of the implementation, not as a follow-up.
