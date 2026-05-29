// lib/tournament/results.ts
//
// Apply match results and recompute participant totals from match history.
// recomputeTotalsFromHistory is the load-bearing fix for the
// "edit doubles the score" bug — totals are derived, never incremented.

import { gameScoreFor, lostSoulScoreFor } from './scoring';
import type { TournamentState, MatchResult, ParticipantId, ParticipantTotals } from './types';

/** Return a new state with the given match's result attached/overwritten. */
export function applyResult(
  state: TournamentState,
  matchId: string,
  result: MatchResult,
): TournamentState {
  const idx = state.matches.findIndex(m => m.id === matchId);
  if (idx === -1) {
    throw new Error(`applyResult: match ${matchId} not found`);
  }
  const matches = state.matches.slice();
  matches[idx] = { ...matches[idx], result };
  return { ...state, matches };
}

/**
 * Recompute (gameScore, lostSoulScore) for one participant from match + bye history.
 * Always derived; never incremented. Editing a match result and re-running this
 * yields the correct total regardless of prior edit history.
 */
export function recomputeTotalsFromHistory(
  participantId: ParticipantId,
  state: TournamentState,
): ParticipantTotals {
  let gameScore = 0;
  let lostSoulScore = 0;
  for (const m of state.matches) {
    if (!m.result) continue;
    if (m.player1Id === participantId) {
      gameScore += gameScoreFor(m.result.p1Outcome);
      lostSoulScore += lostSoulScoreFor(
        m.result.p1Outcome, m.result.p1Souls, m.result.p2Souls, state.soulCap,
      );
    } else if (m.player2Id === participantId) {
      gameScore += gameScoreFor(m.result.p2Outcome);
      lostSoulScore += lostSoulScoreFor(
        m.result.p2Outcome, m.result.p2Souls, m.result.p1Souls, state.soulCap,
      );
    }
  }
  for (const b of state.byes) {
    if (b.participantId !== participantId) continue;
    // A bye only scores once its round has started (Option C), matching the
    // server recompute. When startedRounds is absent (hand-built test states)
    // fall back to counting all byes — the pre-Option-C behavior.
    if (state.startedRounds && !state.startedRounds.includes(b.round)) continue;
    gameScore += 3;
    // bye lost soul score = 0; no change.
  }
  return { participantId, gameScore, lostSoulScore };
}
