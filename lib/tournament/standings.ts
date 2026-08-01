// lib/tournament/standings.ts
//
// Final standings per algorithm.md "Determining Final Standings":
//   1. Drop-outs are removed entirely.
//   2. Sort by gameScore DESC.
//   3. Within a game-score tie, apply head-to-head: if one player defeated
//      ALL others in the tie group, they take the top place.
//   4. Otherwise the highest lostSoulScore takes the top place.
//   5. Either way, repeat the whole process on the players left in the group
//      (the host guide's "taking the 1st place player out of the group"), so
//      head-to-head is re-checked after every removal.
//   6. Players who cannot be separated at all share the place, and the next
//      place skips ahead by the size of the tie.
//
// `orderByTiebreakers` is the pure kernel of that. It is exported because the
// live Standings tab has to rank the same players the same way from its own
// client-side totals — two implementations of these rules is exactly how the
// tab and the published placings drifted apart.

import { recomputeTotalsFromHistory } from './results';
import type {
  TournamentState,
  Placement,
  ParticipantId,
  ParticipantTotals,
  Tiebreak,
  TiebreakBy,
} from './types';

export type { Tiebreak, TiebreakBy };

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

// ─── Pure ranking kernel ──────────────────────────────────────────────

/** The minimum a row needs to be ranked. */
export interface RankableRow {
  id: ParticipantId;
  gameScore: number;
  lostSoulScore: number;
}

/** `beat(a, b)` is true iff `a` defeated `b` in a recorded match. */
export type BeatFn = (a: ParticipantId, b: ParticipantId) => boolean;

export interface RankedEntry<T> {
  row: T;
  /** 1-indexed. Players in a true tie share the same place. */
  place: number;
  tiebreak: Tiebreak;
}

/** One emitted block of players who end up on the same place. */
interface Chunk<T> {
  rows: T[];
  by: TiebreakBy;
  others: ParticipantId[];
}

/**
 * Resolve one game-score tie group into placement order.
 *
 * Recursive by design: the host guide says to repeat the *whole* process on
 * the remaining players after each removal, so a group with no outright
 * head-to-head winner can still be decided by head-to-head once the lost soul
 * score has peeled the leader off.
 */
function resolveGroup<T extends RankableRow>(group: T[], beat: BeatFn, out: Chunk<T>[]): void {
  if (group.length === 1) {
    out.push({ rows: group, by: 'behind', others: [] });
    return;
  }

  // Step 1: did anyone defeat every other player still in the group?
  const ids = group.map((r) => r.id);
  const winner = group.find((r) => ids.every((id) => id === r.id || beat(r.id, id)));
  if (winner) {
    out.push({
      rows: [winner],
      by: 'head_to_head',
      others: ids.filter((id) => id !== winner.id),
    });
    resolveGroup(
      group.filter((r) => r.id !== winner.id),
      beat,
      out,
    );
    return;
  }

  // Step 2: highest lost soul score.
  const topScore = Math.max(...group.map((r) => r.lostSoulScore));
  const leaders = group.filter((r) => r.lostSoulScore === topScore);
  if (leaders.length === group.length) {
    // Same game score, same lost soul score, no decisive head-to-head — a
    // true tie. Ranking points and prizes are split.
    out.push({ rows: group, by: 'shared', others: ids });
    return;
  }

  const rest = group.filter((r) => r.lostSoulScore !== topScore);
  if (leaders.length === 1) {
    out.push({ rows: leaders, by: 'lost_soul_score', others: rest.map((r) => r.id) });
  } else {
    // Several players share the top lost soul score — repeat the process on
    // them, which re-checks head-to-head among just those players.
    resolveGroup(leaders, beat, out);
  }
  resolveGroup(rest, beat, out);
}

/**
 * Rank players by game score, then head-to-head, then lost soul score, with
 * shared places for players nothing separates.
 *
 * Rows come back in placement order, each annotated with why it landed there
 * so the UI can explain a surprising placing.
 */
export function orderByTiebreakers<T extends RankableRow>(
  rows: T[],
  beat: BeatFn,
): RankedEntry<T>[] {
  // Stable sort: players nothing separates keep their input order.
  const sorted = [...rows].sort((a, b) => b.gameScore - a.gameScore);

  const entries: RankedEntry<T>[] = [];
  let i = 0;
  let nextPlace = 1;
  while (i < sorted.length) {
    const gameScore = sorted[i].gameScore;
    const group: T[] = [];
    while (i < sorted.length && sorted[i].gameScore === gameScore) {
      group.push(sorted[i]);
      i++;
    }

    if (group.length === 1) {
      entries.push({
        row: group[0],
        place: nextPlace,
        tiebreak: { tiedWith: [], by: 'none', others: [] },
      });
      nextPlace += 1;
      continue;
    }

    const tieGroupIds = group.map((r) => r.id);
    const chunks: Chunk<T>[] = [];
    resolveGroup(group, beat, chunks);
    for (const chunk of chunks) {
      for (const row of chunk.rows) {
        entries.push({
          row,
          place: nextPlace,
          tiebreak: {
            tiedWith: tieGroupIds.filter((id) => id !== row.id),
            by: chunk.by,
            others: chunk.others.filter((id) => id !== row.id),
          },
        });
      }
      nextPlace += chunk.rows.length;
    }
  }
  return entries;
}

// ─── Final standings ──────────────────────────────────────────────────

/** Compute final standings per algorithm.md. */
export function computeFinalStandings(state: TournamentState): Placement[] {
  // Step 1: exclude drop-outs.
  const active = state.participants.filter((p) => !p.droppedOut);
  const rows: (RankableRow & { totals: ParticipantTotals })[] = active.map((p) => {
    const totals = recomputeTotalsFromHistory(p.id, state);
    return {
      id: totals.participantId,
      gameScore: totals.gameScore,
      lostSoulScore: totals.lostSoulScore,
      totals,
    };
  });

  const beat: BeatFn = (a, b) => headToHead(state, a, b) === 'p1_won';

  return orderByTiebreakers(rows, beat).map((entry) => ({
    participantId: entry.row.id,
    place: entry.place,
    gameScore: entry.row.totals.gameScore,
    lostSoulScore: entry.row.totals.lostSoulScore,
    tiebreak: entry.tiebreak,
  }));
}
