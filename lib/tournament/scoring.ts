// lib/tournament/scoring.ts
//
// Per-round game score and lost-soul-score values per the table in
// prompt_context/algorithm.md.

import type { MatchOutcome } from './types';

const GAME_SCORE: Record<MatchOutcome, number> = {
  full_win: 3,
  partial_win: 2,
  tie: 1.5,
  partial_loss: 1,
  full_loss: 0,
  bye: 3,
  forfeit: 0,
  forfeit_opponent: 3,
  no_show: 0,
};

export function gameScoreFor(outcome: MatchOutcome): number {
  return GAME_SCORE[outcome];
}

/**
 * Per-round lost soul score for the player whose perspective we're computing.
 * `ownSouls` and `opponentSouls` are first capped at the win threshold N.
 * For non-played outcomes (bye, forfeit, no_show, tie) the souls inputs
 * are ignored and the rule-table value is returned.
 */
export function lostSoulScoreFor(
  outcome: MatchOutcome,
  ownSouls: number,
  opponentSouls: number,
  soulCap: number,
): number {
  switch (outcome) {
    case 'tie':
    case 'bye':
    case 'forfeit_opponent':
    case 'no_show':
      return 0;
    case 'forfeit':
      // Official rule: forfeiter is -5 literal, not scaled to N.
      return -5;
    case 'full_win':
    case 'partial_win':
    case 'full_loss':
    case 'partial_loss': {
      const own = Math.min(ownSouls, soulCap);
      const opp = Math.min(opponentSouls, soulCap);
      return own - opp;
    }
  }
}
