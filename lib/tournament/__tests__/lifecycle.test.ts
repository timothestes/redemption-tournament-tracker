import { describe, it, expect } from 'vitest';
import {
  canAddParticipant,
  isRoundComplete,
  isTournamentComplete,
  dropPlayer,
} from '../lifecycle';
import type { TournamentState, Participant, Match, Bye } from '../types';

function p(id: string, droppedOut = false): Participant {
  return { id, name: id, joinedAt: '2026-01-01T00:00:00Z', droppedOut };
}

function st(opts: Partial<TournamentState> = {}): TournamentState {
  return {
    id: 't', nRounds: 3, currentRound: 0, soulCap: 5,
    hasStarted: false, hasEnded: false,
    participants: [], matches: [], byes: [],
    ...opts,
  };
}

describe('canAddParticipant', () => {
  it('true before tournament starts', () => {
    expect(canAddParticipant(st())).toBe(true);
  });
  it('false once tournament has started', () => {
    expect(canAddParticipant(st({ hasStarted: true, currentRound: 1 }))).toBe(false);
  });
});

describe('isRoundComplete', () => {
  it('true when all matches in the round have results and all expected byes exist', () => {
    const state = st({
      hasStarted: true, currentRound: 1, participants: [p('A'), p('B'), p('C')],
      matches: [{
        id: 'm1', round: 1, player1Id: 'A', player2Id: 'B', matchOrder: 1,
        result: { p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss' },
      }],
      byes: [{ participantId: 'C', round: 1 }],
    });
    expect(isRoundComplete(state, 1)).toBe(true);
  });

  it('false when any match in the round lacks a result', () => {
    const state = st({
      hasStarted: true, currentRound: 1, participants: [p('A'), p('B')],
      matches: [{ id: 'm1', round: 1, player1Id: 'A', player2Id: 'B', matchOrder: 1 }],
    });
    expect(isRoundComplete(state, 1)).toBe(false);
  });
});

describe('isTournamentComplete', () => {
  it('true when round nRounds is complete', () => {
    const state = st({
      hasStarted: true, currentRound: 3, nRounds: 3, participants: [p('A'), p('B')],
      matches: [{
        id: 'm1', round: 3, player1Id: 'A', player2Id: 'B', matchOrder: 1,
        result: { p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss' },
      }],
    });
    expect(isTournamentComplete(state)).toBe(true);
  });

  it('false when current round is below nRounds', () => {
    const state = st({ hasStarted: true, currentRound: 1, nRounds: 3 });
    expect(isTournamentComplete(state)).toBe(false);
  });
});

describe('dropPlayer', () => {
  it('marks the participant droppedOut and records dropAfterRound', () => {
    const state = st({
      hasStarted: true, currentRound: 2, participants: [p('A'), p('B')],
    });
    const next = dropPlayer(state, 'A');
    const a = next.participants.find(x => x.id === 'A')!;
    expect(a.droppedOut).toBe(true);
    expect(a.dropAfterRound).toBe(2);
    // Original is unchanged.
    expect(state.participants.find(x => x.id === 'A')!.droppedOut).toBe(false);
  });

  it('throws if participant is already dropped (re-add not supported)', () => {
    const state = st({
      hasStarted: true, currentRound: 1,
      participants: [{ ...p('A'), droppedOut: true, dropAfterRound: 1 }],
    });
    expect(() => dropPlayer(state, 'A')).toThrow();
  });

  it('throws if participant not found', () => {
    const state = st({ hasStarted: true, currentRound: 1, participants: [p('A')] });
    expect(() => dropPlayer(state, 'Z')).toThrow();
  });
});
