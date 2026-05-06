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

import { pairFirstRound } from '../pairing';

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
    const participants = ['A', 'B', 'C', 'D'].map(id => makeParticipant(id));
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
    const participants = ['A', 'B', 'C'].map(id => makeParticipant(id));
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
    const participants = ['A', 'B', 'C', 'D', 'E', 'F'].map(id => makeParticipant(id));
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
    const participants = ['A', 'B', 'C', 'D'].map(id => makeParticipant(id));
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
    const participants = ['A', 'B', 'C', 'D'].map(id => makeParticipant(id));
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
    const participants = ['A', 'B', 'C', 'D'].map(id => makeParticipant(id));
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
    const participants = ['A', 'B', 'C'].map(id => makeParticipant(id));
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
