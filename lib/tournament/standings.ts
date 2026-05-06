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
