"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { buildStateFromSupabase } from "@/utils/tournament/stateAdapter";
import { pairFirstRound, pairLaterRound } from "@/lib/tournament/pairing";
import { rngForRound } from "@/lib/tournament/rng";

export interface RepairResult {
  ok: boolean;
  error?: string;
  data?: {
    match_id: string;
    tournament_id: string;
    round: number;
    old: { p1: number; p2: number };
    new: { p1: number; p2: number };
  };
}

export async function repairMatchScoreAction(input: {
  matchId: string;
  newP1Score: number;
  newP2Score: number;
  reason?: string;
  tournamentId: string;
}): Promise<RepairResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("repair_match_score", {
    p_match_id: input.matchId,
    p_new_p1_score: input.newP1Score,
    p_new_p2_score: input.newP2Score,
    p_reason: input.reason ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/tracker/tournaments/${input.tournamentId}`);
  return { ok: true, data: data as RepairResult["data"] };
}

export interface RegenerateResult {
  ok: boolean;
  error?: string;
  data?: { tournament_id: string; round: number; matches_inserted: number; bye_id: string | null };
}

export async function regenerateCurrentRoundPairingsAction(input: {
  tournamentId: string;
  unlock?: boolean;
}): Promise<RegenerateResult> {
  const supabase = await createClient();

  const state = await buildStateFromSupabase(supabase, input.tournamentId);
  if (!state) return { ok: false, error: "Tournament not found" };

  const round = state.currentRound;
  const rng = rngForRound(input.tournamentId, round);
  const result =
    round === 1
      ? pairFirstRound(state.participants.filter((p) => !p.droppedOut), rng)
      : pairLaterRound(state, round, rng);

  const pairings = result.matches.map((m, idx) => ({
    player1_id: m.player1Id,
    player2_id: m.player2Id,
    match_order: m.matchOrder ?? idx + 1,
  }));

  const { data, error } = await supabase.rpc("regenerate_current_round_pairings", {
    p_tournament_id: input.tournamentId,
    p_pairings: pairings,
    p_bye_id: result.bye ?? null,
    p_unlock: input.unlock ?? false,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/tracker/tournaments/${input.tournamentId}`);
  return { ok: true, data: data as RegenerateResult["data"] };
}
