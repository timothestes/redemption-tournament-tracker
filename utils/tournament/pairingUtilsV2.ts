// Tournament Pairing Utilities v2 (DB shell).
//
// All algorithm decisions live in lib/tournament/. This file is a thin
// Supabase IO layer that:
//   1. Loads TournamentState via stateAdapter.
//   2. Calls a pure pairing function.
//   3. Persists the resulting matches and bye records.

import { createClient } from "../supabase/client";
import { rngForRound } from "../../lib/tournament/rng";
import { pairFirstRound, pairLaterRound } from "../../lib/tournament/pairing";
import { buildStateFromSupabase } from "./stateAdapter";

type AnyClient = {
  from: (table: string) => any;
};

/** Insert a bye record. bye_points/bye_differential are vestigial; always 3/0 per algorithm.md. */
async function persistBye(
  client: AnyClient,
  tournamentId: string,
  round: number,
  participantId: string,
) {
  await client.from("byes").insert({
    tournament_id: tournamentId,
    round_number: round,
    match_points: 3,
    differential: 0,
    participant_id: participantId,
  });
}

/** Insert match records for a round. */
async function persistMatches(
  client: AnyClient,
  tournamentId: string,
  matches: Array<{ round: number; player1Id: string; player2Id: string; matchOrder: number }>,
) {
  if (matches.length === 0) return;
  const rows = matches.map(m => ({
    tournament_id: tournamentId,
    round: m.round,
    player1_id: m.player1Id,
    player2_id: m.player2Id,
    player1_score: null,
    player2_score: null,
    match_order: m.matchOrder,
  }));
  await client.from("matches").insert(rows);
}

/** Public API: create pairings for a Swiss tournament round. */
export const createPairing = async (
  tournamentId: string,
  round: number,
): Promise<boolean> => {
  const client = await createClient();
  try {
    const state = await buildStateFromSupabase(client, tournamentId);
    if (!state) {
      console.error("createPairing: tournament not found");
      return false;
    }
    const rng = rngForRound(tournamentId, round);
    const result = round === 1
      ? pairFirstRound(state.participants.filter(p => !p.droppedOut), rng)
      : pairLaterRound(state, round, rng);

    if (result.bye) {
      await persistBye(client, tournamentId, round, result.bye);
    }
    await persistMatches(client, tournamentId, result.matches);
    return true;
  } catch (error) {
    console.error("Error in createPairing v2:", error);
    return false;
  }
};
