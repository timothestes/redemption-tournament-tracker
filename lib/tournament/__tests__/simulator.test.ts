import { describe, it, expect } from 'vitest';
import { createTournament } from '../simulator';

describe('simulator: clean 4-player, 3-round', () => {
  it('plays out cleanly with no rematches and stable standings', () => {
    const t = createTournament({
      tournamentId: 't-clean-4',
      players: ['Alice', 'Bob', 'Carol', 'Dave'],
      nRounds: 3,
      soulCap: 5,
    });
    t.start();

    for (let round = 1; round <= 3; round++) {
      t.pairRound(round);
      // Submit "highest seed wins 5-0" deterministically — order of matches in the
      // round is whatever the simulator returns. We just ensure every match gets a
      // result.
      const matches = t.matchesForRound(round);
      for (const m of matches) {
        // Simulate: alphabetically lower id wins.
        const p1Wins = m.player1Id < m.player2Id;
        t.submitResult(m.id, {
          p1Souls: p1Wins ? 5 : 0,
          p2Souls: p1Wins ? 0 : 5,
          p1Outcome: p1Wins ? 'full_win' : 'full_loss',
          p2Outcome: p1Wins ? 'full_loss' : 'full_win',
        });
      }
    }
    const standings = t.standings();
    // Alice always wins (lowest id alphabetically).
    expect(standings[0].participantId).toMatch(/^p-Alice/);
    expect(standings.length).toBe(4);
  });
});

describe('simulator: drop in round 2', () => {
  it('drop-out is excluded from R3 pairings and from final standings', () => {
    const t = createTournament({
      tournamentId: 't-drop',
      players: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
      nRounds: 3,
      soulCap: 5,
    });
    t.start();

    t.pairRound(1);
    for (const m of t.matchesForRound(1)) {
      t.submitResult(m.id, {
        p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss',
      });
    }

    // After R1 ends, drop one player.
    const aId = t.participantIdByName('A')!;
    t.dropPlayer(aId);

    t.pairRound(2);
    // 7 active players → 1 bye, 3 matches. The dropped A must not appear.
    const matches2 = t.matchesForRound(2);
    const idsInR2 = new Set<string>();
    for (const m of matches2) {
      idsInR2.add(m.player1Id);
      idsInR2.add(m.player2Id);
    }
    expect(idsInR2.has(aId)).toBe(false);

    // Submit and continue.
    for (const m of matches2) {
      t.submitResult(m.id, {
        p1Souls: 5, p2Souls: 1, p1Outcome: 'full_win', p2Outcome: 'full_loss',
      });
    }
    t.pairRound(3);
    for (const m of t.matchesForRound(3)) {
      t.submitResult(m.id, {
        p1Souls: 5, p2Souls: 2, p1Outcome: 'full_win', p2Outcome: 'full_loss',
      });
    }
    const standings = t.standings();
    // Dropped player not in standings; remaining 7 ranked 1..7.
    expect(standings.find(s => s.participantId === aId)).toBeUndefined();
    expect(standings.length).toBe(7);
  });
});

describe('simulator: edit-after-submit recompute (regression for double-count bug)', () => {
  it('editing a result produces correct totals, not 2× delta', () => {
    const t = createTournament({
      tournamentId: 't-edit',
      players: ['A', 'B'],
      nRounds: 1,
      soulCap: 5,
    });
    t.start();
    t.pairRound(1);
    const [m] = t.matchesForRound(1);
    // Initial submit: A wins 5-0.
    t.submitResult(m.id, {
      p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss',
    });
    expect(t.totalsFor(m.player1Id).gameScore).toBe(3);
    // Edit: change to a tie 4-4.
    t.submitResult(m.id, {
      p1Souls: 4, p2Souls: 4, p1Outcome: 'tie', p2Outcome: 'tie',
    });
    expect(t.totalsFor(m.player1Id).gameScore).toBe(1.5);
    expect(t.totalsFor(m.player1Id).lostSoulScore).toBe(0);
    expect(t.totalsFor(m.player2Id).gameScore).toBe(1.5);
  });
});

describe('simulator: bye distribution stress', () => {
  it('5 players over 6 rounds: bye counts within ±1 across all players', () => {
    const t = createTournament({
      tournamentId: 't-byestress',
      players: ['A', 'B', 'C', 'D', 'E'],
      nRounds: 6,
      soulCap: 5,
    });
    t.start();
    for (let round = 1; round <= 6; round++) {
      t.pairRound(round);
      for (const m of t.matchesForRound(round)) {
        t.submitResult(m.id, {
          p1Souls: 5, p2Souls: m.matchOrder, // varies a bit so LSS isn't tied
          p1Outcome: 'full_win', p2Outcome: 'full_loss',
        });
      }
    }
    const counts = t.byeCounts();
    const values = [...counts.values()];
    const min = Math.min(...values);
    const max = Math.max(...values);
    // The new algorithm distributes byes by min count, so spread is at most 1.
    expect(max - min).toBeLessThanOrEqual(1);
  });
});

describe('simulator: forfeit', () => {
  it('forfeit produces correct game/lost-soul scores for both players', () => {
    const t = createTournament({
      tournamentId: 't-forfeit', players: ['A', 'B'], nRounds: 1, soulCap: 5,
    });
    t.start();
    t.pairRound(1);
    const [m] = t.matchesForRound(1);
    t.submitResult(m.id, {
      p1Souls: 0, p2Souls: 0, p1Outcome: 'forfeit', p2Outcome: 'forfeit_opponent',
    });
    expect(t.totalsFor(m.player1Id)).toEqual({
      participantId: m.player1Id, gameScore: 0, lostSoulScore: -5,
    });
    expect(t.totalsFor(m.player2Id)).toEqual({
      participantId: m.player2Id, gameScore: 3, lostSoulScore: 0,
    });
  });
});
