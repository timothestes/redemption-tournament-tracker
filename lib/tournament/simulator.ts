// lib/tournament/simulator.ts
//
// In-memory tournament simulator. Wraps the pure modules to give tests
// (and any local-repro tools) a single object that drives a tournament
// from start to finish with no Supabase or async I/O involved.

import type {
  TournamentState, Match, MatchResult,
  ParticipantId, ParticipantTotals, Placement,
} from './types';
import { rngForRound } from './rng';
import { pairFirstRound, pairLaterRound } from './pairing';
import { applyResult, recomputeTotalsFromHistory } from './results';
import { computeFinalStandings } from './standings';
import { dropPlayer } from './lifecycle';

export interface CreateTournamentOptions {
  tournamentId: string;
  players: string[];     // names; ids are derived as `p-<name>`
  nRounds: number;
  soulCap: number;       // 5 (Type 1) or 7 (Type 2)
}

export interface SimulatedTournament {
  start(): void;
  pairRound(round: number): void;
  matchesForRound(round: number): Match[];
  submitResult(matchId: string, result: MatchResult): void;
  dropPlayer(participantId: ParticipantId): void;
  totalsFor(participantId: ParticipantId): ParticipantTotals;
  byeCounts(): Map<ParticipantId, number>;
  standings(): Placement[];
  participantIdByName(name: string): ParticipantId | undefined;
  /** Read-only snapshot of internal state, for assertions or debugging. */
  state(): TournamentState;
}

/**
 * Build a tournament with the given players. Names are required; ids are
 * generated as `p-<name>` for predictable identification in tests.
 */
export function createTournament(opts: CreateTournamentOptions): SimulatedTournament {
  let state: TournamentState = {
    id: opts.tournamentId,
    nRounds: opts.nRounds,
    currentRound: 0,
    soulCap: opts.soulCap,
    hasStarted: false,
    hasEnded: false,
    participants: opts.players.map((name, i) => ({
      id: `p-${name}`,
      name,
      joinedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      droppedOut: false,
    })),
    matches: [],
    byes: [],
  };

  let nextMatchSeq = 1;

  function newMatchId(): string {
    return `match-${nextMatchSeq++}`;
  }

  return {
    start() {
      state = { ...state, hasStarted: true, currentRound: 0 };
    },

    pairRound(round) {
      if (!state.hasStarted) throw new Error('pairRound called before start()');
      const rng = rngForRound(state.id, round);
      let result;
      if (round === 1) {
        result = pairFirstRound(state.participants, rng);
      } else {
        result = pairLaterRound(state, round, rng);
      }
      const newMatches: Match[] = result.matches.map(m => ({
        id: newMatchId(),
        round: m.round,
        player1Id: m.player1Id,
        player2Id: m.player2Id,
        matchOrder: m.matchOrder,
      }));
      const newByes = result.bye ? [{ participantId: result.bye, round }] : [];
      state = {
        ...state,
        currentRound: round,
        matches: [...state.matches, ...newMatches],
        byes: [...state.byes, ...newByes],
      };
    },

    matchesForRound(round) {
      return state.matches.filter(m => m.round === round);
    },

    submitResult(matchId, result) {
      state = applyResult(state, matchId, result);
    },

    dropPlayer(id) {
      state = dropPlayer(state, id);
    },

    totalsFor(id) {
      return recomputeTotalsFromHistory(id, state);
    },

    byeCounts() {
      const out = new Map<string, number>();
      for (const p of state.participants) out.set(p.id, 0);
      for (const b of state.byes) {
        out.set(b.participantId, (out.get(b.participantId) ?? 0) + 1);
      }
      return out;
    },

    standings() {
      return computeFinalStandings(state);
    },

    participantIdByName(name) {
      return state.participants.find(p => p.name === name)?.id;
    },

    state() {
      return state;
    },
  };
}
