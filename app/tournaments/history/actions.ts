"use server";

import { createClient } from "@/utils/supabase/server";
import type { TriviaScoreEntry } from "@/lib/nationals/types";

export async function loadLeaderboard(limit = 20): Promise<TriviaScoreEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("nationals_trivia_scores")
    .select("name, score, created_at")
    .order("score", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return [];
  return (data as TriviaScoreEntry[]) ?? [];
}

export async function submitTriviaScore(input: { name: string; score: number }): Promise<
  { ok: true; leaderboard: TriviaScoreEntry[] } | { ok: false; error: string }
> {
  const name = (input.name ?? "").trim().slice(0, 12);
  const score = Math.max(0, Math.min(150, Math.floor(input.score ?? 0)));
  if (!name) return { ok: false as const, error: "Enter a name first" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("nationals_trivia_scores")
    .insert({ name, score });
  if (error) return { ok: false as const, error: "Could not submit score" };
  const leaderboard = await loadLeaderboard(20);
  return { ok: true as const, leaderboard };
}
