import { describe, it, expect } from 'vitest';
import { computeFinalStandings, orderByTiebreakers } from '../standings';
import type { TournamentState, Participant, Match, Bye } from '../types';

function p(id: string, droppedOut = false): Participant {
  return { id, name: id, joinedAt: '2026-01-01T00:00:00Z', droppedOut };
}

function fullWin(round: number, winner: string, loser: string): Match {
  return {
    id: `${round}-${winner}-${loser}`,
    round,
    player1Id: winner,
    player2Id: loser,
    matchOrder: 1,
    result: { p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss' },
  };
}

function state(participants: Participant[], matches: Match[], byes: Bye[] = []): TournamentState {
  return {
    id: 't1', nRounds: 3, currentRound: 3, soulCap: 5,
    hasStarted: true, hasEnded: true, participants, matches, byes,
  };
}

describe('computeFinalStandings', () => {
  it('orders by game score (no ties)', () => {
    // A 3-0, B 2-1, C 1-2, D 0-3 over 3 rounds.
    const ps = ['A', 'B', 'C', 'D'].map(x => p(x));
    const matches: Match[] = [
      fullWin(1, 'A', 'D'), fullWin(1, 'B', 'C'),
      fullWin(2, 'A', 'C'), fullWin(2, 'B', 'D'),
      fullWin(3, 'A', 'B'), fullWin(3, 'C', 'D'),
    ];
    const standings = computeFinalStandings(state(ps, matches));
    expect(standings.map(s => s.participantId)).toEqual(['A', 'B', 'C', 'D']);
    expect(standings.map(s => s.place)).toEqual([1, 2, 3, 4]);
  });

  it('head-to-head wins over LSS: A and B tied on game score, A beat B → A ranks higher', () => {
    // 3 players, 2 rounds.
    // R1: A beats B (5-3); C has bye.
    // R2: A vs C (C wins 5-0); B has bye.
    // Final game scores:  A=3, B=3 (tied), C=6
    // Final LSS:          A=+2-5=-3, B=-2 (R1) + 0 (R2 bye)=-2, C=0+5=+5
    // Without head-to-head: B (-2) ranks above A (-3) by LSS.
    // With head-to-head:    A beat B directly → A ranks above B.
    const ps = ['A', 'B', 'C'].map(x => p(x));
    const matches: Match[] = [
      { id: '1', round: 1, player1Id: 'A', player2Id: 'B', matchOrder: 1,
        result: { p1Souls: 5, p2Souls: 3, p1Outcome: 'full_win', p2Outcome: 'full_loss' } },
      { id: '2', round: 2, player1Id: 'A', player2Id: 'C', matchOrder: 1,
        result: { p1Souls: 0, p2Souls: 5, p1Outcome: 'full_loss', p2Outcome: 'full_win' } },
    ];
    const byes: Bye[] = [
      { participantId: 'C', round: 1 },
      { participantId: 'B', round: 2 },
    ];
    const standings = computeFinalStandings(state(ps, matches, byes));
    expect(standings.find(s => s.participantId === 'C')?.place).toBe(1);
    expect(standings.find(s => s.participantId === 'A')?.place).toBe(2);
    expect(standings.find(s => s.participantId === 'B')?.place).toBe(3);
  });

  it('falls back to lost soul score when head-to-head has no clean winner', () => {
    // 3-way tie with cyclic head-to-head: A>B, B>C, C>A.
    const ps = ['A', 'B', 'C'].map(x => p(x));
    const matches: Match[] = [
      // R1: A>B
      { id: '1', round: 1, player1Id: 'A', player2Id: 'B', matchOrder: 1,
        result: { p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss' } },
      // R2: B>C
      { id: '2', round: 2, player1Id: 'B', player2Id: 'C', matchOrder: 1,
        result: { p1Souls: 5, p2Souls: 1, p1Outcome: 'full_win', p2Outcome: 'full_loss' } },
      // R3: C>A
      { id: '3', round: 3, player1Id: 'C', player2Id: 'A', matchOrder: 1,
        result: { p1Souls: 5, p2Souls: 2, p1Outcome: 'full_win', p2Outcome: 'full_loss' } },
    ];
    const byes: Bye[] = [
      { participantId: 'C', round: 1 },
      { participantId: 'A', round: 2 },
      { participantId: 'B', round: 3 },
    ];
    // Game scores all 6 (1 win + 1 loss + 1 bye = 3 + 0 + 3 = 6).
    // LSS:
    //   A: +5 (R1) + 0 (R2 bye) + -3 (R3) = +2
    //   B: -5 (R1) + +4 (R2) + 0 (R3 bye) = -1
    //   C: 0 (R1 bye) + -4 (R2) + +3 (R3) = -1
    // No clean head-to-head (A>B, B>C, C>A — cycle).
    // Falls to LSS: A=+2 takes 1st. Then the host guide's "repeat this process
    // (taking the 1st place player out of the group)" restarts at head-to-head
    // for the remaining {B, C}: B beat C, so B is 2nd and C is 3rd. They are
    // NOT jointly placed — the tie clause only applies to players who "did not
    // face each other".
    const standings = computeFinalStandings(state(ps, matches, byes));
    expect(standings.find(s => s.participantId === 'A')?.place).toBe(1);
    expect(standings.find(s => s.participantId === 'B')?.place).toBe(2);
    expect(standings.find(s => s.participantId === 'C')?.place).toBe(3);
  });

  it('breaks an equal-lost-soul-score tie by head-to-head when the two players faced each other', () => {
    // A and B end on identical game score AND identical lost soul score, and
    // played each other in R2 (A won). The joint-placement clause requires
    // "did not face each other", so A must be placed above B.
    // C is kept on a different game score so the tie group is exactly {A, B}.
    const ps = ['A', 'B', 'C', 'D'].map(x => p(x));
    const matches: Match[] = [
      fullWin(1, 'C', 'A'), // A 0MP/-5, C 3MP/+5
      fullWin(1, 'B', 'D'), // B 3MP/+5, D 0MP/-5
      fullWin(2, 'A', 'B'), // A 3MP/0 total, B 3MP/0 total
      fullWin(2, 'C', 'D'), // C 6MP/+10, D 0MP/-10
    ];
    const standings = computeFinalStandings(state(ps, matches));
    expect(standings.find(s => s.participantId === 'C')?.place).toBe(1);
    expect(standings.find(s => s.participantId === 'A')?.place).toBe(2);
    expect(standings.find(s => s.participantId === 'B')?.place).toBe(3);
    expect(standings.find(s => s.participantId === 'D')?.place).toBe(4);
  });

  it('uses joint placement on true ties (next place skips by tie size)', () => {
    // 4 players, all tied on every score (synthetic).
    const ps = ['A', 'B', 'C', 'D'].map(x => p(x));
    const matches: Match[] = [
      // Two ties, equal LSS, no decisive head-to-head.
      { id: '1', round: 1, player1Id: 'A', player2Id: 'B', matchOrder: 1,
        result: { p1Souls: 3, p2Souls: 3, p1Outcome: 'tie', p2Outcome: 'tie' } },
      { id: '2', round: 1, player1Id: 'C', player2Id: 'D', matchOrder: 1,
        result: { p1Souls: 3, p2Souls: 3, p1Outcome: 'tie', p2Outcome: 'tie' } },
    ];
    // Each player: 1.5 game, 0 LSS. Four-way tie. No head-to-head winner.
    const standings = computeFinalStandings(state(ps, matches));
    // All four jointly placed 1st.
    for (const s of standings) {
      expect(s.place).toBe(1);
    }
  });

  it('reports why each player landed where they did', () => {
    // Same shape as the test above: A and B tie on game score, A beat B,
    // C and D sit alone on their own game scores.
    const ps = ['A', 'B', 'C', 'D'].map(x => p(x));
    const matches: Match[] = [
      fullWin(1, 'C', 'A'),
      fullWin(1, 'B', 'D'),
      fullWin(2, 'A', 'B'),
      fullWin(2, 'C', 'D'),
    ];
    const standings = computeFinalStandings(state(ps, matches));
    const byId = (id: string) => standings.find(s => s.participantId === id)!;
    expect(byId('C').tiebreak.by).toBe('none');
    expect(byId('A').tiebreak.by).toBe('head_to_head');
    expect(byId('A').tiebreak.others).toEqual(['B']);
    expect(byId('B').tiebreak.by).toBe('behind');
    expect(byId('B').tiebreak.tiedWith).toEqual(['A']);
  });

  it('excludes dropped players from final standings entirely', () => {
    const ps = [
      p('A'),
      { ...p('B'), droppedOut: true, dropAfterRound: 1 },
      p('C'),
    ];
    const matches: Match[] = [
      fullWin(1, 'A', 'B'),
      fullWin(2, 'A', 'C'),
    ];
    const standings = computeFinalStandings(state(ps, matches));
    expect(standings.map(s => s.participantId).sort()).toEqual(['A', 'C']);
    expect(standings.find(s => s.participantId === 'B')).toBeUndefined();
  });
});

describe('orderByTiebreakers', () => {
  const row = (id: string, gameScore: number, lostSoulScore: number) => ({
    id, gameScore, lostSoulScore,
  });
  /** beat(a, b) from an explicit list of "a beat b" pairs. */
  const beats = (...pairs: string[]) => (a: string, b: string) =>
    pairs.includes(`${a}>${b}`);

  it('applies head-to-head before lost soul score', () => {
    // B has the better lost soul score, but A beat B and they are the whole
    // tie group — head-to-head comes first.
    const ranked = orderByTiebreakers(
      [row('A', 3, -4), row('B', 3, 4)],
      beats('A>B'),
    );
    expect(ranked.map(e => e.row.id)).toEqual(['A', 'B']);
    expect(ranked.map(e => e.place)).toEqual([1, 2]);
  });

  it('needs a win over EVERY other player in the tie group, not just one', () => {
    // A beat B but never played C, so no one "defeated all other tied
    // players" → lost soul score decides.
    const ranked = orderByTiebreakers(
      [row('A', 3, -4), row('B', 3, 4), row('C', 3, 0)],
      beats('A>B'),
    );
    expect(ranked.map(e => e.row.id)).toEqual(['B', 'C', 'A']);
  });

  it('shares a place when nothing separates the players, and skips ahead', () => {
    const ranked = orderByTiebreakers(
      [row('A', 3, 5), row('B', 3, 5), row('C', 1, 0)],
      beats(),
    );
    expect(ranked.map(e => e.place)).toEqual([1, 1, 3]);
    expect(ranked[0].tiebreak.by).toBe('shared');
    expect(ranked[0].tiebreak.others).toEqual(['B']);
    expect(ranked[2].tiebreak.by).toBe('none');
  });

  it('labels a lost-soul-score win with the players it out-scored', () => {
    const ranked = orderByTiebreakers(
      [row('A', 3, 5), row('B', 3, 1), row('C', 3, 0)],
      beats(),
    );
    expect(ranked.map(e => e.row.id)).toEqual(['A', 'B', 'C']);
    expect(ranked[0].tiebreak.by).toBe('lost_soul_score');
    expect(ranked[0].tiebreak.others).toEqual(['B', 'C']);
    expect(ranked[0].tiebreak.tiedWith).toEqual(['B', 'C']);
  });
});
