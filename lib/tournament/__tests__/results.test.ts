import { describe, it, expect } from 'vitest';
import { applyResult, recomputeTotalsFromHistory } from '../results';
import type { TournamentState, Match, Participant, MatchResult } from '../types';

function p(id: string, droppedOut = false): Participant {
  return { id, name: id, joinedAt: '2026-01-01T00:00:00Z', droppedOut };
}

function emptyState(participants: Participant[]): TournamentState {
  return {
    id: 't1',
    nRounds: 3,
    currentRound: 1,
    soulCap: 5,
    hasStarted: true,
    hasEnded: false,
    participants,
    matches: [],
    byes: [],
  };
}

const m = (id: string, round: number, p1: string, p2: string): Match => ({
  id, round, player1Id: p1, player2Id: p2, matchOrder: 1,
});

describe('applyResult', () => {
  it('attaches a result to the targeted match without mutating others', () => {
    const state: TournamentState = {
      ...emptyState([p('A'), p('B'), p('C'), p('D')]),
      matches: [m('m1', 1, 'A', 'B'), m('m2', 1, 'C', 'D')],
    };
    const result: MatchResult = {
      p1Souls: 5, p2Souls: 2, p1Outcome: 'full_win', p2Outcome: 'full_loss',
    };
    const next = applyResult(state, 'm1', result);
    expect(next.matches.find(x => x.id === 'm1')?.result).toEqual(result);
    expect(next.matches.find(x => x.id === 'm2')?.result).toBeUndefined();
    // Original state is unchanged (immutability).
    expect(state.matches.find(x => x.id === 'm1')?.result).toBeUndefined();
  });

  it('overwrites an existing result (used for edits)', () => {
    const state: TournamentState = {
      ...emptyState([p('A'), p('B')]),
      matches: [{ ...m('m1', 1, 'A', 'B'), result: { p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss' } }],
    };
    const edited: MatchResult = { p1Souls: 4, p2Souls: 4, p1Outcome: 'tie', p2Outcome: 'tie' };
    const next = applyResult(state, 'm1', edited);
    expect(next.matches[0].result).toEqual(edited);
  });

  it('throws if matchId not found', () => {
    const state = emptyState([p('A'), p('B')]);
    const result: MatchResult = { p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss' };
    expect(() => applyResult(state, 'nonexistent', result)).toThrow();
  });
});

describe('recomputeTotalsFromHistory', () => {
  it('returns zeros when no matches or byes have happened', () => {
    const state = emptyState([p('A'), p('B')]);
    expect(recomputeTotalsFromHistory('A', state)).toEqual({
      participantId: 'A', gameScore: 0, lostSoulScore: 0,
    });
  });

  it('sums game scores and lost soul scores across rounds', () => {
    const state: TournamentState = {
      ...emptyState([p('A'), p('B')]),
      matches: [
        { ...m('m1', 1, 'A', 'B'), result: { p1Souls: 5, p2Souls: 2, p1Outcome: 'full_win', p2Outcome: 'full_loss' } },
        { ...m('m2', 2, 'A', 'B'), result: { p1Souls: 4, p2Souls: 4, p1Outcome: 'tie', p2Outcome: 'tie' } },
      ],
    };
    // R1: A → 3 game, +3 lost soul. R2: A → 1.5 game, 0 lost soul. Total: 4.5 / 3
    expect(recomputeTotalsFromHistory('A', state)).toEqual({
      participantId: 'A', gameScore: 4.5, lostSoulScore: 3,
    });
    // R1: B → 0 game, -3 lost soul. R2: B → 1.5 game, 0 lost soul.
    expect(recomputeTotalsFromHistory('B', state)).toEqual({
      participantId: 'B', gameScore: 1.5, lostSoulScore: -3,
    });
  });

  it('counts byes (3 game score, 0 lost soul score)', () => {
    const state: TournamentState = {
      ...emptyState([p('A'), p('B'), p('C')]),
      matches: [
        { ...m('m1', 1, 'A', 'B'), result: { p1Souls: 5, p2Souls: 1, p1Outcome: 'full_win', p2Outcome: 'full_loss' } },
      ],
      byes: [{ participantId: 'C', round: 1 }],
    };
    expect(recomputeTotalsFromHistory('C', state)).toEqual({
      participantId: 'C', gameScore: 3, lostSoulScore: 0,
    });
  });

  it('REGRESSION: editing a result and re-applying produces correct totals (not 2× delta)', () => {
    // Simulate the historical bug: submit, then edit. With recompute-from-history,
    // the edited totals must equal a fresh compute, regardless of how many times
    // we edited.
    let state: TournamentState = {
      ...emptyState([p('A'), p('B')]),
      matches: [m('m1', 1, 'A', 'B')],
    };
    state = applyResult(state, 'm1', {
      p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss',
    });
    expect(recomputeTotalsFromHistory('A', state).gameScore).toBe(3);
    // Now edit to a tie.
    state = applyResult(state, 'm1', {
      p1Souls: 4, p2Souls: 4, p1Outcome: 'tie', p2Outcome: 'tie',
    });
    expect(recomputeTotalsFromHistory('A', state).gameScore).toBe(1.5);
    expect(recomputeTotalsFromHistory('A', state).lostSoulScore).toBe(0);
  });
});
