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
