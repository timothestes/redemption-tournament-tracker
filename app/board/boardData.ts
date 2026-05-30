import { createClient } from "@/utils/supabase/client";
import type { CurrentRound } from "@/lib/tournament/roundTimer";

export interface BoardTournament {
  id: string;
  name: string;
  current_round: number;
  n_rounds: number;
  round_length: number;
  created_at: string;
  round: CurrentRound | null;
}

/**
 * Active tournaments for the logged-in host (RLS-scoped), each with its current
 * round row. Sorted by created_at so panel order is stable across refetches.
 */
export async function fetchActiveBoardData(): Promise<BoardTournament[]> {
  const supabase = createClient();

  const { data: tournaments, error } = await supabase
    .from("tournaments")
    .select("id, name, current_round, n_rounds, round_length, created_at")
    .eq("has_started", true)
    .eq("has_ended", false)
    .order("created_at", { ascending: true });

  if (error || !tournaments) return [];

  return Promise.all(
    tournaments.map(async (t) => {
      const { data: round } = await supabase
        .from("rounds")
        .select("started_at, is_completed")
        .eq("tournament_id", t.id)
        .eq("round_number", t.current_round)
        .maybeSingle();
      return { ...t, round: (round as CurrentRound) ?? null } as BoardTournament;
    }),
  );
}
