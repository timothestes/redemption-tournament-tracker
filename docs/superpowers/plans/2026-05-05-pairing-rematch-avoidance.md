# Pairing Rematch Avoidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the greedy + rematch-fallback step in `pairLaterRound` with a depth-first backtracking search that finds a no-rematch perfect matching whenever one exists, while preserving rank priority, determinism, and the existing fallback when no such matching exists.

**Architecture:** Add a private `findNoRematchPairing` helper to `lib/tournament/pairing.ts`. Modify `pairLaterRound` to call the helper; on success, emit its pairings; on null, fall back to pool-order pairing (rematches accepted). The helper preserves the existing top-down rank-priority traversal so its first solution matches greedy whenever greedy already worked. No other modules touched.

**Tech Stack:** TypeScript, Vitest.

**Spec authority:** [`docs/superpowers/specs/2026-05-05-pairing-rematch-avoidance-design.md`](../specs/2026-05-05-pairing-rematch-avoidance-design.md).

**Test command:** `npx vitest run <path>`. Full module: `npx vitest run lib/tournament`.

**Commit style:** lowercase, short. Examples: `tournament: add no-rematch backtracking helper`, `tournament: tighten simulator-scenarios rematch bounds`.

---

## File Structure

**Modified:**
- `lib/tournament/pairing.ts` — add `findNoRematchPairing` helper (private); replace step 3 of `pairLaterRound`; update docstring
- `lib/tournament/__tests__/simulator-scenarios.test.ts` — tighten rematch upper bounds from `≤4`/`≤8` to `0`
- `lib/tournament/__tests__/pairing.test.ts` — add determinism test for `pairLaterRound`
- `prompt_context/algorithm.md` — replace v1-acceptance paragraph in section "Round Pairing — Later Rounds"

**Not modified:**
- `pairFirstRound`, `selectBye`, `comparePlayers`, `playedKey`, `totalsForRound`, `ScoredPlayer` — unchanged
- All other files in `lib/tournament/` and `utils/tournament/`

---

## Task 1: Tighten `simulator-scenarios` rematch bounds (TDD red)

This task converts the relaxed `≤4`/`≤8` upper bounds into strict `0`. The test will FAIL on current code; Task 2 will make it pass.

**Files:**
- Modify: `lib/tournament/__tests__/simulator-scenarios.test.ts:165` (16p/5r bound)
- Modify: `lib/tournament/__tests__/simulator-scenarios.test.ts:225` (32p/6r bound)

- [ ] **Step 1: Replace the 16p/5r rematch bound**

In `lib/tournament/__tests__/simulator-scenarios.test.ts`, find this line (currently at line 165):

```ts
    expect(rematchPairs / 2).toBeLessThanOrEqual(4);
```

Replace with:

```ts
    expect(rematchPairs).toBe(0);
```

- [ ] **Step 2: Replace the 32p/6r rematch bound**

Find this line (currently at line 225):

```ts
    expect(rematchPairs / 2).toBeLessThanOrEqual(8);
```

Replace with:

```ts
    expect(rematchPairs).toBe(0);
```

- [ ] **Step 3: Run the test file to confirm it fails**

Run: `npx vitest run lib/tournament/__tests__/simulator-scenarios.test.ts`

Expected: 16p/5r and/or 32p/6r tests FAIL with `expected <some number> to be 0`. Other scenarios (drops, ties, forfeit, 8-player) still pass.

If a test passes unexpectedly, do not proceed — surface it. The current greedy is documented to produce avoidable rematches in roughly half of realistic tournaments; both seeded scenarios reliably exercise this. If somehow neither hits a rematch, the change has nothing to verify.

- [ ] **Step 4: Do not commit yet**

The failing test stays in the working tree. Task 2 implements the fix and commits both files together.

---

## Task 2: Implement `findNoRematchPairing` and integrate into `pairLaterRound`

This task adds the backtracking helper and wires it into `pairLaterRound`, replacing the existing greedy + rematch fallback (steps 3-5 of the current implementation). The Task 1 test must turn green; all existing pairing tests must continue to pass.

**Files:**
- Modify: `lib/tournament/pairing.ts:194-278` (`pairLaterRound` and the docstring above it)

- [ ] **Step 1: Add the `findNoRematchPairing` helper**

In `lib/tournament/pairing.ts`, after the `playedKey` function (currently at line 192) and before the `pairLaterRound` docstring, insert:

```ts
/**
 * DFS backtracking search for a no-rematch perfect matching of `pool`.
 *
 * Walks the rank-sorted pool top-down: the topmost unpaired player tries
 * each unpaired partner in rank order. Unwinds when a sub-pool admits no
 * legal completion. The "topmost unpaired chooses first, in rank order"
 * structure means the first complete leaf returned is the greedy-equivalent
 * solution — when greedy already produces a no-rematch matching, this
 * function returns the same pairing.
 *
 * Includes a fail-fast prune: if any unpaired player has zero legal
 * partners among the remaining unpaired set, the branch is dead.
 *
 * Returns an array of [poolIndex_a, poolIndex_b] pairs (a < b) describing
 * a complete matching, or `null` if no rematch-free perfect matching
 * exists for this pool. Pure: no side effects, no RNG.
 */
function findNoRematchPairing(
  pool: ScoredPlayer[],
  played: Set<string>,
): Array<[number, number]> | null {
  const n = pool.length;
  if (n === 0) return [];
  if (n % 2 !== 0) return null;
  const partner = new Int32Array(n).fill(-1);

  function recurse(): boolean {
    // Find the top-most unpaired player. Preserves rank-priority: the
    // highest unpaired player chooses first, exactly like greedy.
    let i = 0;
    while (i < n && partner[i] !== -1) i++;
    if (i === n) return true; // all paired

    // Fail-fast: any unpaired player with zero legal partners kills this branch.
    for (let k = i; k < n; k++) {
      if (partner[k] !== -1) continue;
      let hasLegal = false;
      for (let m = i; m < n; m++) {
        if (m === k || partner[m] !== -1) continue;
        if (!played.has(playedKey(pool[k].id, pool[m].id))) { hasLegal = true; break; }
      }
      if (!hasLegal) return false;
    }

    // Try each candidate j > i in rank order.
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

- [ ] **Step 2: Update the `pairLaterRound` docstring**

Find the docstring (currently at lines 194-204):

```ts
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
```

Replace with:

```ts
/**
 * Pair a non-first round per algorithm.md "Round Pairing — Later Rounds":
 *  1. Sort active players by (gameScore DESC, lostSoulScore DESC).
 *  2. If odd, select bye via selectBye().
 *  3. Backtracking search for a no-rematch perfect matching of the pool.
 *     The search preserves rank-priority order, so the first solution
 *     found is identical to greedy whenever greedy already produced a
 *     no-rematch pairing.
 *  4. Rematch fallback: only fires when the pool admits no no-rematch
 *     matching (e.g., late rounds in tiny fields). Pairs the pool in
 *     remaining-list order, even if it produces rematches.
 *  5. Defensive lone-bye: if exactly one player is left unpaired
 *     (shouldn't happen with even pool), give them a bye.
 */
```

- [ ] **Step 3: Replace step 3-5 of `pairLaterRound`**

Find the existing step 3-5 block (currently at lines 238-275):

```ts
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

Replace with:

```ts
  // Step 3: backtracking search for a no-rematch perfect matching.
  // When greedy already produced a no-rematch pairing, this returns the
  // identical pairing (rank-order traversal). When greedy would have
  // produced a rematch, this finds the alternative whenever one exists.
  const matches: PairingResult['matches'] = [];
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
    return { matches, bye };
  }

  // Step 4: no no-rematch matching exists. Pair the pool in remaining-list
  // order, even if it produces rematches. Mirrors the existing rematch-
  // fallback semantics; only fires when the pool truly cannot be matched
  // without rematches (e.g., late rounds in tiny fields where every pair
  // has been played).
  const leftover = [...pool];
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

  // Step 5: defensive lone-bye (only if pool was somehow odd despite bye selection).
  if (leftover.length === 1 && !bye) {
    bye = leftover[0].id;
  }

  return { matches, bye };
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit lib/tournament/pairing.ts`

Expected: no errors related to `pairing.ts`. If errors point at unrelated files (e.g., `components/ui/breadcrumb.tsx` from parallel UI work), ignore them — those are pre-existing and out of scope. Only fix errors in `pairing.ts`.

- [ ] **Step 5: Run the previously-failing simulator-scenarios test to confirm it passes**

Run: `npx vitest run lib/tournament/__tests__/simulator-scenarios.test.ts`

Expected: ALL 6 scenarios PASS. The 16p/5r and 32p/6r tests now produce zero rematches.

- [ ] **Step 6: Run the existing pairing tests to confirm no regression**

Run: `npx vitest run lib/tournament/__tests__/pairing.test.ts`

Expected: ALL 15 tests PASS.

In particular, verify that "falls back to rematches when greedy locks up" still passes — that test creates a state where every pair has been played, so `findNoRematchPairing` correctly returns null and the fallback emits two rematches.

- [ ] **Step 7: Run the full lib/tournament suite**

Run: `npx vitest run lib/tournament`

Expected: ALL 73 tests PASS across 8 files (lifecycle, results, standings, scoring, rng, pairing, simulator, simulator-scenarios).

- [ ] **Step 8: Commit**

```bash
git add lib/tournament/pairing.ts lib/tournament/__tests__/simulator-scenarios.test.ts
git commit -m "tournament: replace greedy with no-rematch backtracking in pairLaterRound"
```

---

## Task 3: Add explicit determinism + matchOrder regression tests for `pairLaterRound`

The simulator-scenarios tests cover the happy path implicitly. This task adds explicit assertions that (a) `pairLaterRound` is deterministic given the same `(state, round, rng)`, and (b) `matchOrder` is assigned rank-top-down — both load-bearing properties of the new algorithm.

**Files:**
- Modify: `lib/tournament/__tests__/pairing.test.ts` (append)

- [ ] **Step 1: Append the determinism + matchOrder tests**

At the bottom of `lib/tournament/__tests__/pairing.test.ts`, append:

```ts
describe('pairLaterRound determinism', () => {
  it('produces identical output for the same (state, round, rng)', () => {
    // 6 players, 2 rounds played. R3 has multiple legal pairings; assert
    // that two independent runs produce byte-identical match lists.
    const participants = ['A', 'B', 'C', 'D', 'E', 'F'].map(id => makeParticipant(id));
    const matches = [
      recordedMatch(1, 'A', 'B', 'full_win', 'full_loss'),
      recordedMatch(1, 'C', 'D', 'full_win', 'full_loss'),
      recordedMatch(1, 'E', 'F', 'full_win', 'full_loss'),
      recordedMatch(2, 'A', 'C', 'full_win', 'full_loss'),
      recordedMatch(2, 'B', 'D', 'full_win', 'full_loss'),
      recordedMatch(2, 'E', 'F', 'tie', 'tie', 3, 3),
    ];
    const state = tState(participants, matches);
    const r1 = pairLaterRound(state, 3, rngForRound('det-t', 3));
    const r2 = pairLaterRound(state, 3, rngForRound('det-t', 3));
    expect(r1).toEqual(r2);
  });

  it('assigns matchOrder rank-top-down (top-most pair gets matchOrder 1)', () => {
    // 4 players with clearly-separated standings: A (top), B (mid), C (mid), D (bottom).
    // R2 with no rematches available — backtracking should produce A's pair first.
    const participants = ['A', 'B', 'C', 'D'].map(id => makeParticipant(id));
    // R1: A>B (full), C>D (full). After R1: A=3,+5; B=0,-5; C=3,+5; D=0,-5.
    // Sort: [A, C, B, D] (stable input order within tied buckets).
    const matches = [
      recordedMatch(1, 'A', 'B', 'full_win', 'full_loss'),
      recordedMatch(1, 'C', 'D', 'full_win', 'full_loss'),
    ];
    const state = tState(participants, matches);
    const result = pairLaterRound(state, 2, rngForRound('order-t', 2));
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].matchOrder).toBe(1);
    expect(result.matches[1].matchOrder).toBe(2);
    // The first pair must contain A (the top-most player in the sort).
    const firstPair = [result.matches[0].player1Id, result.matches[0].player2Id];
    expect(firstPair).toContain('A');
  });
});
```

- [ ] **Step 2: Run the test file to confirm both pass**

Run: `npx vitest run lib/tournament/__tests__/pairing.test.ts`

Expected: 17 tests PASS (15 existing + 2 new).

- [ ] **Step 3: Commit**

```bash
git add lib/tournament/__tests__/pairing.test.ts
git commit -m "tournament: add determinism + matchOrder regression tests for pairLaterRound"
```

---

## Task 4: Update `prompt_context/algorithm.md` spec text

The spec currently labels the greedy + rematch behavior as "accepted complexity for v1." After Task 2 lands, that paragraph is wrong. Update it to describe the v2 backtracking behavior.

**Files:**
- Modify: `prompt_context/algorithm.md:125-133` (steps 3 and 4 of "Round Pairing — Later Rounds")

- [ ] **Step 1: Replace step 3 and step 4 text**

In `prompt_context/algorithm.md`, find this block (currently at lines 125-133):

```markdown
3. **Greedy pairing** (top-down) — official rule:
   - For each unassigned player from the top of the list:
     - Find the **highest-ranked unassigned player they have not already played**.
     - If found, pair them. The first pair created appears first in the resulting match list (preserves `match_order`).
     - If no eligible opponent is found (every remaining player has already been played), defer this player.

4. **Rematch fallback**:
   - Any players left unpaired after the greedy pass are paired with each other in remaining-list order, even if they have already played. This matches the official guide's acknowledgement: *"In a smaller tournament field, it will sometimes occur that two players will be matched twice."*
   - **Note**: greedy is non-optimal — it can produce a rematch that careful backtracking would have avoided. This is accepted complexity for v1.
```

Replace with:

```markdown
3. **Backtracking pairing** (top-down) — implementation:
   - The pairer performs a depth-first search over the rank-sorted pool. The topmost unpaired player tries each unpaired partner in rank order; the search unwinds when a sub-pool admits no legal completion.
   - The first complete leaf the search returns is the greedy-equivalent solution — when greedy would already produce a no-rematch pairing, the search returns the identical pairing (and `match_order` is assigned top-down exactly as before).
   - When greedy would have produced an avoidable rematch, the search finds an alternative whenever one exists. A fail-fast prune (any unpaired player with zero legal partners terminates the branch immediately) keeps the common case effectively linear.

4. **Rematch fallback**:
   - Only fires when the pool admits no rematch-free perfect matching at all — a corner case visible only in tiny fields exhausted across many rounds (e.g., 4 players × 4 rounds).
   - When it fires, the pool is paired in remaining-list order, even if it produces rematches. This matches the official guide's acknowledgement: *"In a smaller tournament field, it will sometimes occur that two players will be matched twice."*
```

- [ ] **Step 2: Commit**

```bash
git add prompt_context/algorithm.md
git commit -m "tournament: update algorithm spec to describe backtracking pairing"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run the entire `lib/tournament` test suite**

Run: `npx vitest run lib/tournament`

Expected: ALL 75 tests PASS across 8 files (73 from before + 2 new in pairing.test.ts).

- [ ] **Step 2: Type-check the changed module**

Run: `npx tsc --noEmit lib/tournament/pairing.ts lib/tournament/__tests__/pairing.test.ts lib/tournament/__tests__/simulator-scenarios.test.ts`

Expected: no errors. If `npx tsc --noEmit` (no path filter) reports unrelated errors in `components/ui/breadcrumb.tsx` or other UI files, those are pre-existing from parallel UI work and out of scope for this plan.

- [ ] **Step 3: Spot-check the algorithm.md edit**

Run: `head -140 prompt_context/algorithm.md | tail -25`

Verify the new step 3 and step 4 text reads cleanly and matches the design doc. No commit step — already committed in Task 4.

- [ ] **Step 4: Surface the changes**

Confirm to the user:
- 4 commits added on the branch (Tasks 2, 3, 4 produce one commit each; Task 5 is verification only).
- `lib/tournament/pairing.ts` now uses backtracking; `pairLaterRound`'s public signature is unchanged.
- `simulator-scenarios.test.ts` rematch bounds tightened from `≤4`/`≤8` to `0`.
- 2 new pairing tests added (determinism, matchOrder rank-top-down).
- `prompt_context/algorithm.md` updated to describe the v2 algorithm.
- The DFS backtracking returns identical output to greedy whenever greedy already worked, so existing tournaments running through this code will see identical pairings except in rounds where greedy would have produced an avoidable rematch.
