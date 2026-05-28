import { describe, it, expect } from 'vitest';
import { computeSnapshotRewrites } from '../snapshotRewrite';

type ParticipantId = string;

interface MatchRow {
  id: string;
  round: number;
  match_order: number;
  player1_id: ParticipantId;
  player2_id: ParticipantId;
  player1_score: number;
  player2_score: number;
}

describe('computeSnapshotRewrites', () => {
  it('produces correct chronological cumulative snapshots for a 3-round history', () => {
    const matches: MatchRow[] = [
      { id: 'm1', round: 1, match_order: 1, player1_id: 'A', player2_id: 'B', player1_score: 5, player2_score: 2 },
      { id: 'm2', round: 2, match_order: 1, player1_id: 'A', player2_id: 'C', player1_score: 3, player2_score: 3 },
      { id: 'm3', round: 3, match_order: 1, player1_id: 'D', player2_id: 'A', player1_score: 0, player2_score: 5 },
    ];
    const result = computeSnapshotRewrites('A', matches, { maxScore: 5 });

    // After m1: A has 3 match points (full win), differential +3
    // After m2: A has 4.5 match points (tie 3-3), differential +3 (no change)
    // After m3: A has 7.5 match points (full win), differential +8

    expect(result).toEqual([
      { match_id: 'm1', is_player1: true,  cumulative_match_points: 3,   cumulative_differential: 3 },
      { match_id: 'm2', is_player1: true,  cumulative_match_points: 4.5, cumulative_differential: 3 },
      { match_id: 'm3', is_player1: false, cumulative_match_points: 7.5, cumulative_differential: 8 },
    ]);
  });

  it('orders by (round, match_order) not insertion order', () => {
    const matches: MatchRow[] = [
      { id: 'late', round: 2, match_order: 1, player1_id: 'A', player2_id: 'B', player1_score: 5, player2_score: 0 },
      { id: 'early', round: 1, match_order: 2, player1_id: 'A', player2_id: 'C', player1_score: 2, player2_score: 4 },
      { id: 'earlier', round: 1, match_order: 1, player1_id: 'A', player2_id: 'D', player1_score: 5, player2_score: 0 },
    ];
    const result = computeSnapshotRewrites('A', matches, { maxScore: 5 });
    expect(result.map(r => r.match_id)).toEqual(['earlier', 'early', 'late']);
  });

  it('skips matches the participant did not play', () => {
    const matches: MatchRow[] = [
      { id: 'm1', round: 1, match_order: 1, player1_id: 'B', player2_id: 'C', player1_score: 5, player2_score: 0 },
      { id: 'm2', round: 1, match_order: 2, player1_id: 'A', player2_id: 'D', player1_score: 5, player2_score: 0 },
    ];
    const result = computeSnapshotRewrites('A', matches, { maxScore: 5 });
    expect(result.length).toBe(1);
    expect(result[0].match_id).toBe('m2');
  });

  it('returns empty when participant played no matches', () => {
    const matches: MatchRow[] = [
      { id: 'm1', round: 1, match_order: 1, player1_id: 'B', player2_id: 'C', player1_score: 5, player2_score: 0 },
    ];
    expect(computeSnapshotRewrites('A', matches, { maxScore: 5 })).toEqual([]);
  });

  it('includes bye points in cumulative totals', () => {
    const matches: MatchRow[] = [
      { id: 'm2', round: 2, match_order: 1, player1_id: 'A', player2_id: 'B', player1_score: 5, player2_score: 0 },
    ];
    const byes = [{ participant_id: 'A', round_number: 1 }];
    const result = computeSnapshotRewrites('A', matches, { maxScore: 5, byes });
    // After bye in round 1: A has 3 MP (no match row written)
    // After m2 in round 2: A wins → 3+3 = 6 MP, differential +5
    expect(result).toEqual([
      { match_id: 'm2', is_player1: true, cumulative_match_points: 6, cumulative_differential: 5 },
    ]);
  });
});
