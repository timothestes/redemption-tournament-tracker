// lib/tournament/types.ts
//
// Plain data types for the tournament algorithm. No Supabase, no I/O.
// These mirror the DB schema described in prompt_context/algorithm.md
// but use the official terminology from the Redemption Host Guide:
//   match_points (DB) === gameScore (here) === "game score" (official)
//   differential (DB) === lostSoulScore (here) === "lost soul score" (official)

export type ParticipantId = string;
export type MatchId = string;
export type TournamentId = string;

export type MatchOutcome =
  | "full_win"
  | "partial_win"
  | "tie"
  | "partial_loss"
  | "full_loss"
  | "bye"
  | "forfeit"          // outcome for the player who forfeits
  | "forfeit_opponent" // outcome for the player whose opponent forfeits
  | "no_show";         // missed the round entirely (different from forfeit)

export interface Participant {
  id: ParticipantId;
  name: string;
  joinedAt: string; // ISO timestamp; used as deterministic tiebreaker
  droppedOut: boolean;
  /** Round at which the drop took effect (this round's result still counted). */
  dropAfterRound?: number;
}

export interface MatchResult {
  /** Lost souls rescued by player1 (capped at soulCap). */
  p1Souls: number;
  /** Lost souls rescued by player2 (capped at soulCap). */
  p2Souls: number;
  p1Outcome: MatchOutcome;
  p2Outcome: MatchOutcome;
}

export interface Match {
  id: MatchId;
  round: number;
  player1Id: ParticipantId;
  player2Id: ParticipantId;
  matchOrder: number;
  result?: MatchResult;
}

export interface Bye {
  participantId: ParticipantId;
  round: number;
}

export interface TournamentState {
  id: TournamentId;
  nRounds: number;
  /** 0 before tournament starts; otherwise the round currently in progress (1..nRounds). */
  currentRound: number;
  /** Win threshold: 5 for Type 1, 7 for Type 2. */
  soulCap: number;
  hasStarted: boolean;
  hasEnded: boolean;
  participants: Participant[];
  matches: Match[];
  byes: Bye[];
}

/** Per-participant aggregate computed from match history. */
export interface ParticipantTotals {
  participantId: ParticipantId;
  gameScore: number;
  lostSoulScore: number;
}

/** A single placement entry in the final standings. */
export interface Placement {
  participantId: ParticipantId;
  /** 1-indexed. Players in a true tie share the same place. */
  place: number;
  gameScore: number;
  lostSoulScore: number;
}
