// Walk a participant's match history chronologically and compute the
// running cumulative (match_points, differential) snapshot stored on each
// matches row. Mirrors the per-result point assignment in match-edit.tsx
// so a repair's recomputed snapshots match what live entry would have
// written if the corrected score had been submitted originally.

export interface MatchRow {
  id: string;
  round: number;
  match_order: number;
  player1_id: string;
  player2_id: string;
  player1_score: number;
  player2_score: number;
}

export interface SnapshotUpdate {
  match_id: string;
  /** True if the participant sits in the player1 slot on this match. */
  is_player1: boolean;
  /** Cumulative match_points for this participant after this match. */
  cumulative_match_points: number;
  /** Cumulative differential for this participant after this match. */
  cumulative_differential: number;
}

interface Options {
  maxScore: number;
}

function pointsForResult(p1Score: number, p2Score: number, maxScore: number): [number, number] {
  if (p1Score === p2Score) return [1.5, 1.5];
  if (p1Score === maxScore) return [3, 0];
  if (p2Score === maxScore) return [0, 3];
  if (p1Score > p2Score) return [2, 1];
  return [1, 2];
}

export function computeSnapshotRewrites(
  participantId: string,
  allMatches: MatchRow[],
  options: Options,
): SnapshotUpdate[] {
  const ordered = allMatches
    .filter(m => m.player1_id === participantId || m.player2_id === participantId)
    .slice()
    .sort((a, b) => (a.round - b.round) || (a.match_order - b.match_order));

  let cumMp = 0;
  let cumDiff = 0;
  const out: SnapshotUpdate[] = [];

  for (const m of ordered) {
    const [p1Pts, p2Pts] = pointsForResult(m.player1_score, m.player2_score, options.maxScore);
    const isP1 = m.player1_id === participantId;
    if (isP1) {
      cumMp += p1Pts;
      cumDiff += m.player1_score - m.player2_score;
    } else {
      cumMp += p2Pts;
      cumDiff += m.player2_score - m.player1_score;
    }
    out.push({
      match_id: m.id,
      is_player1: isP1,
      cumulative_match_points: cumMp,
      cumulative_differential: cumDiff,
    });
  }

  return out;
}
