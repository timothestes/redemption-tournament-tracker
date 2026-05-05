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
