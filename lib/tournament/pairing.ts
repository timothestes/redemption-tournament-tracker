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
