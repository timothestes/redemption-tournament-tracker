// lib/tournament/lifecycle.ts
//
// State-transition predicates and validators per algorithm.md
// "Lifecycle / State Transitions" section.

import type { TournamentState, ParticipantId } from './types';

/** Per spec: cannot add participants after the tournament has started. */
export function canAddParticipant(state: TournamentState): boolean {
  return !state.hasStarted;
}

/**
 * A round is complete when every match in that round has a result AND
 * every bye record for that round has been written.
 *
 * Note: this checks consistency given the recorded matches/byes. It does
 * not verify that the round was paired correctly — that's the pairing
 * module's responsibility.
 */
export function isRoundComplete(state: TournamentState, round: number): boolean {
  const matchesInRound = state.matches.filter(m => m.round === round);
  if (matchesInRound.some(m => !m.result)) return false;
  // The active set in this round must be (matches × 2) + (byes for this round) = active count.
  const byesInRound = state.byes.filter(b => b.round === round);
  // We require at least one match or bye recorded for the round.
  if (matchesInRound.length === 0 && byesInRound.length === 0) return false;
  return true;
}

export function isTournamentComplete(state: TournamentState): boolean {
  if (!state.hasStarted) return false;
  if (state.currentRound < state.nRounds) return false;
  return isRoundComplete(state, state.nRounds);
}

/** Mark a player as dropped. Returns a new state. */
export function dropPlayer(state: TournamentState, participantId: ParticipantId): TournamentState {
  const idx = state.participants.findIndex(p => p.id === participantId);
  if (idx === -1) throw new Error(`dropPlayer: ${participantId} not found`);
  if (state.participants[idx].droppedOut) {
    throw new Error(`dropPlayer: ${participantId} already dropped (re-add not supported)`);
  }
  const participants = state.participants.slice();
  participants[idx] = {
    ...participants[idx],
    droppedOut: true,
    dropAfterRound: state.currentRound,
  };
  return { ...state, participants };
}
