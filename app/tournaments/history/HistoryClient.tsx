"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { SeedData, LeaderboardEntry } from "@/lib/nationals/types";
import { SeedContext } from "./seed-context";
import NavTabs, { type ViewId } from "./NavTabs";
import HistorySkeleton from "./HistorySkeleton";

interface HistoryClientProps {
  initialLeaderboard?: LeaderboardEntry[];
}

export default function HistoryClient({
  initialLeaderboard = [],
}: HistoryClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [seed, setSeed] = useState<SeedData | null>(null);
  const [view, setViewState] = useState<ViewId>(
    (searchParams.get("view") as ViewId | null) ?? "tournaments"
  );
  const [tournamentId, setTournamentId] = useState<string | null>(
    searchParams.get("t")
  );
  const [playerName, setPlayerName] = useState<string | null>(
    searchParams.get("p")
  );
  const backToRef = useRef<ViewId | null>(null);

  // Fetch seed data on mount
  useEffect(() => {
    fetch("/data/nationals-history.json")
      .then((res) => res.json())
      .then((data: SeedData) => setSeed(data));
  }, []);

  function setView(
    nextView: ViewId,
    opts?: {
      tournamentId?: string;
      playerName?: string;
      backTo?: ViewId;
    }
  ) {
    const nextTournamentId = opts?.tournamentId ?? null;
    const nextPlayerName = opts?.playerName ?? null;
    backToRef.current = opts?.backTo ?? null;

    setViewState(nextView);
    setTournamentId(nextTournamentId);
    setPlayerName(nextPlayerName);

    const params = new URLSearchParams();
    params.set("view", nextView);
    if (nextTournamentId) params.set("t", nextTournamentId);
    if (nextPlayerName) params.set("p", nextPlayerName);
    router.replace(`/tournaments/history?${params.toString()}`, {
      scroll: false,
    });
  }

  function back() {
    const target = backToRef.current ?? "tournaments";
    setView(target);
  }

  if (!seed) return <HistorySkeleton />;

  void initialLeaderboard; // used in Task 15

  return (
    <SeedContext.Provider value={seed}>
      <div className="max-w-[1200px] mx-auto px-5 py-6">
        <NavTabs view={view} setView={setView} />
        <div className="mt-4">
          {view === "tournaments" && (
            <div className="p-6 text-muted-foreground">
              tournaments — coming soon
            </div>
          )}
          {view === "champions" && (
            <div className="p-6 text-muted-foreground">
              champions — coming soon
            </div>
          )}
          {view === "players" && (
            <div className="p-6 text-muted-foreground">
              players — coming soon
            </div>
          )}
          {view === "trivia" && (
            <div className="p-6 text-muted-foreground">
              trivia — coming soon
            </div>
          )}
          {view === "stats" && (
            <div className="p-6 text-muted-foreground">
              stats — coming soon
            </div>
          )}
          {view === "tape" && (
            <div className="p-6 text-muted-foreground">
              tape — coming soon
            </div>
          )}
          {view === "search" && (
            <div className="p-6 text-muted-foreground">
              search — coming soon
            </div>
          )}
          {view === "detail" && (
            <div className="p-6 text-muted-foreground">
              detail — coming soon
            </div>
          )}
          {view === "player" && (
            <div className="p-6 text-muted-foreground">
              player — coming soon
            </div>
          )}
        </div>
      </div>
    </SeedContext.Provider>
  );
}
