"use client";

import { cn } from "@/lib/utils";
import { useRoundCountdown } from "@/components/ui/useRoundCountdown";
import { derivePanelState } from "@/lib/tournament/roundTimer";
import type { BoardTournament } from "./boardData";

export function BoardPanel({ tournament }: { tournament: BoardTournament }) {
  const state = derivePanelState(tournament.round);
  const { timeString, isExpired } = useRoundCountdown(
    tournament.round?.started_at ?? null,
    tournament.round_length,
  );
  const expired = state === "running" && isExpired;

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl border p-6 text-center transition-colors",
        expired ? "border-red-500 bg-red-700" : "border-neutral-800 bg-neutral-900",
      )}
    >
      <h2 className="line-clamp-2 font-cinzel text-2xl font-bold text-neutral-50 sm:text-3xl md:text-4xl">
        {tournament.name}
      </h2>
      <p className="text-lg text-neutral-400 sm:text-xl">
        Round {tournament.current_round} of {tournament.n_rounds}
      </p>

      {state === "running" && !expired && (
        <span className="font-mono text-[12vw] font-bold leading-none tabular-nums text-neutral-50 md:text-[9vw]">
          {timeString}
        </span>
      )}
      {expired && (
        <span className="font-mono text-[12vw] font-extrabold leading-none tabular-nums text-white md:text-[9vw] animate-pulse">
          TIME
        </span>
      )}
      {state === "not-started" && (
        <span className="text-2xl text-neutral-400 sm:text-3xl">
          Round {tournament.current_round} — starting soon
        </span>
      )}
      {state === "between-rounds" && (
        <span className="text-2xl text-neutral-400 sm:text-3xl">
          Round {tournament.current_round} complete — pairings coming
        </span>
      )}
    </div>
  );
}
